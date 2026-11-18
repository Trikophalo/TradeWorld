-- ===== idempotent copy of migrations/20261204009300_vault_level_deposits.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 9300 · The vault grows with the player (ADR-201)
-- =============================================================================
-- * vault_level_factor_bps(level): 10 000 + vault.levelBonusBps per level above 1, up to vault.levelBonusMaxLevel
--   (src/lib/sim/vault.ts, vaultLevelFactorBps).
-- * vault_status(player): full redefinition of the M4i function. The basic income with the upgrades is multiplied
--   with the level bonus (half even) before the treasury factor; new fields income_cents_per_hour (upgrades only),
--   level, level_factor_bps and cap_hours. claim_vault, the portfolio and the "vault full" job read it unchanged.
-- * vault_deposits (Festgeld): cash locked for 1, 3 or 7 days. The principal moves from player_cash to
--   player_reserve (it stays the player's money and counts for net worth and money supply); at maturity it comes back
--   with interest from the treasury (amount x rate x treasury factor, half even; paid as far as the treasury has it).
--   Closing early gives the principal back without interest. All open deposits together hold at most
--   vault.deposits.capCentsPerLevel x level, at most vault.deposits.maxOpen at a time, from vault.deposits.minLevel.
-- * get_vault_deposits(), open_vault_deposit(request, amount, days), close_vault_deposit(request, id): idempotent by
--   request_id, answer the state of the deposits.
-- * A reset of the account (player_private.account_reset_at) voids open deposits: account_wipe has already returned
--   the reserve to the state.
-- Values in game_config "vault" (src/config/balance.ts). Idempotent: runs unchanged as supabase/updates/.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Level bonus of the vault income
-- ---------------------------------------------------------------------------
create or replace function public.vault_level_factor_bps(p_level integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (10000 + public.cfg_num(public.config_jsonb('vault'), '{levelBonusBps}', 0)
                  * (least(greatest(1, coalesce(p_level, 1)),
                           greatest(1, public.cfg_num(public.config_jsonb('vault'), '{levelBonusMaxLevel}', 1))::integer) - 1))::integer;
$$;
comment on function public.vault_level_factor_bps(integer) is
  'Internal (ADR-201): level bonus of the vault income in bps (10 000 = none).';

create or replace function public.vault_status(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_income  bigint := public.player_basic_income_cents_per_hour(p_player);
  v_level   integer := coalesce((select p.level from public.profiles p where p.id = p_player), 1);
  v_lbps    integer;
  v_base    bigint;
  v_hours   double precision := greatest(0, public.player_vault_cap_hours(p_player));
  v_factor  integer := public.basic_income_factor_bps();
  v_rate    bigint;
  v_now     timestamptz := public.game_now();
  v         public.vaults;
  v_ms      double precision;
begin
  select * into v from public.vaults where player_id = p_player;
  if not found then
    return null;
  end if;
  v_lbps := public.vault_level_factor_bps(v_level);
  v_base := public.div_round_half_even(v_income::numeric * v_lbps, 10000)::bigint;
  v_rate := v_base * v_factor / 10000;
  v_ms := least(greatest(0, extract(epoch from (v_now - v.accrual_started_at)) * 1000), v_hours * 3600000);
  return jsonb_build_object(
    'accrued_cents',       floor(v_rate * v_ms / 3600000)::bigint,
    'cap_cents',           round(v_rate * v_hours)::bigint,
    'rate_cents_per_hour', v_rate,
    'base_rate_cents_per_hour', v_base,
    'income_cents_per_hour', v_income,
    'level',               v_level,
    'level_factor_bps',    v_lbps,
    'cap_hours',           v_hours,
    'factor_bps',          v_factor,
    'last_claimed_at',     v.last_claimed_at,
    'full_at',             v.accrual_started_at + make_interval(secs => v_hours * 3600),
    'server_time',         v_now,
    'accrued_seconds',     floor(v_ms / 1000)::bigint);
end;
$$;

-- ---------------------------------------------------------------------------
-- B. Festgeld in the vault
-- ---------------------------------------------------------------------------
create table if not exists public.vault_deposits (
  id             bigint generated always as identity primary key,
  player_id      uuid not null references public.profiles(id) on delete cascade,
  request_id     uuid not null,
  amount_cents   bigint not null check (amount_cents > 0),
  term_days      smallint not null check (term_days > 0),
  rate_bps       integer not null check (rate_bps >= 0),
  created_at     timestamptz not null,
  matures_at     timestamptz not null,
  status         text not null default 'open' check (status in ('open', 'paid', 'broken', 'void')),
  closed_at      timestamptz,
  interest_cents bigint not null default 0 check (interest_cents >= 0),
  unique (player_id, request_id)
);
create index if not exists vault_deposits_open_idx on public.vault_deposits (player_id) where status = 'open';
comment on table public.vault_deposits is
  'Festgeld in the vault (ADR-201): principal held in player_reserve until it is collected (with interest) or broken.';
alter table public.vault_deposits enable row level security;
drop policy if exists vault_deposits_own on public.vault_deposits;
create policy vault_deposits_own on public.vault_deposits for select to authenticated
  using (player_id = (select auth.uid()));
revoke insert, update, delete on public.vault_deposits from anon, authenticated;

-- A reset of the account voids open deposits (account_wipe returned the reserve to the state).
create or replace function public.vault_deposits_on_reset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_reset_at is distinct from old.account_reset_at then
    update public.vault_deposits
       set status = 'void', closed_at = new.account_reset_at
     where player_id = new.player_id and status = 'open';
  end if;
  return new;
end;
$$;
drop trigger if exists vault_deposits_on_reset on public.player_private;
create trigger vault_deposits_on_reset after update of account_reset_at on public.player_private
  for each row execute function public.vault_deposits_on_reset();

-- Interest of a deposit with the treasury factor of now (src/lib/sim/vault.ts, vaultDepositInterestCents).
create or replace function public.vault_deposit_interest_cents(p_amount bigint, p_rate_bps integer, p_factor_bps integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_amount, 0) <= 0 or coalesce(p_rate_bps, 0) <= 0 or coalesce(p_factor_bps, 0) <= 0 then 0
              else public.div_round_half_even(p_amount::numeric * p_rate_bps * p_factor_bps, 100000000)::bigint end;
$$;

create or replace function public.vault_deposits_json(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := coalesce(public.config_jsonb('vault', '{deposits}'), '{}'::jsonb);
  v_level  integer := coalesce((select p.level from public.profiles p where p.id = p_player), 1);
  v_factor integer := public.basic_income_factor_bps();
  v_now    timestamptz := public.game_now();
begin
  return jsonb_build_object(
    'level',          v_level,
    'min_level',      public.cfg_num(v_cfg, '{minLevel}', 5)::integer,
    'min_cents',      public.cfg_num(v_cfg, '{minCents}', 100000)::bigint,
    'cap_cents',      (public.cfg_num(v_cfg, '{capCentsPerLevel}', 0) * v_level)::bigint,
    'max_open',       public.cfg_num(v_cfg, '{maxOpen}', 3)::integer,
    'factor_bps',     v_factor,
    'server_time',    v_now,
    'terms',          coalesce((select jsonb_agg(jsonb_build_object('days', (t ->> 'days')::integer,
                                                                    'rate_bps', (t ->> 'rateBps')::integer)
                                                 order by (t ->> 'days')::integer)
                                  from jsonb_array_elements(coalesce(v_cfg -> 'terms', '[]'::jsonb)) t), '[]'::jsonb),
    'open_cents',     coalesce((select sum(d.amount_cents) from public.vault_deposits d
                                 where d.player_id = p_player and d.status = 'open'), 0)::bigint,
    'earned_cents',   coalesce((select sum(d.interest_cents) from public.vault_deposits d
                                 where d.player_id = p_player and d.status = 'paid'), 0)::bigint,
    'deposits',       coalesce((select jsonb_agg(jsonb_build_object(
                                   'id',             d.id,
                                   'amount_cents',   d.amount_cents,
                                   'term_days',      d.term_days,
                                   'rate_bps',       d.rate_bps,
                                   'created_at',     d.created_at,
                                   'matures_at',     d.matures_at,
                                   'matured',        d.matures_at <= v_now,
                                   'interest_cents', public.vault_deposit_interest_cents(d.amount_cents, d.rate_bps, v_factor))
                                 order by d.matures_at, d.id)
                                  from public.vault_deposits d where d.player_id = p_player and d.status = 'open'), '[]'::jsonb));
end;
$$;
comment on function public.vault_deposits_json(uuid) is
  'Internal (ADR-201): terms, cap and open deposits of a player (interest at the treasury factor of now).';

create or replace function public.get_vault_deposits()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.vault_deposits_json(public.require_player());
end;
$$;
comment on function public.get_vault_deposits() is 'Festgeld in the vault of the signed-in player (ADR-201).';

create or replace function public.open_vault_deposit(p_request_id uuid, p_amount_cents bigint, p_term_days integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_cfg    jsonb := coalesce(public.config_jsonb('vault', '{deposits}'), '{}'::jsonb);
  v_level  integer;
  v_rate   integer;
  v_open   bigint;
  v_count  integer;
  v_cash   bigint;
  v_now    timestamptz := public.game_now();
  v_id     bigint;
begin
  v_player := public.require_player();
  if p_request_id is null or p_amount_cents is null or p_term_days is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'open_vault_deposit');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  perform public.lock_player_accounts(v_player);
  select p.level into v_level from public.profiles p where p.id = v_player;
  if coalesce(v_level, 1) < public.cfg_num(v_cfg, '{minLevel}', 5) then
    perform public.api_error('locked');
  end if;
  select (t ->> 'rateBps')::integer into v_rate
    from jsonb_array_elements(coalesce(v_cfg -> 'terms', '[]'::jsonb)) t
   where (t ->> 'days')::integer = p_term_days
   limit 1;
  if v_rate is null then
    perform public.api_error('invalid_argument');
  end if;
  if p_amount_cents < public.cfg_num(v_cfg, '{minCents}', 100000) then
    perform public.api_error('deposit_too_small');
  end if;
  select coalesce(sum(d.amount_cents), 0)::bigint, count(*)::integer into v_open, v_count
    from public.vault_deposits d where d.player_id = v_player and d.status = 'open';
  if v_count >= public.cfg_num(v_cfg, '{maxOpen}', 3)
     or v_open + p_amount_cents > (public.cfg_num(v_cfg, '{capCentsPerLevel}', 0) * v_level)::bigint then
    perform public.api_error('deposit_limit');
  end if;
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < p_amount_cents then
    perform public.api_error('insufficient_funds');
  end if;

  insert into public.vault_deposits (player_id, request_id, amount_cents, term_days, rate_bps, created_at, matures_at)
  values (v_player, p_request_id, p_amount_cents, p_term_days, v_rate, v_now, v_now + make_interval(days => p_term_days))
  returning id into v_id;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'),
                                 public.ledger_player_account(v_player, 'player_reserve'),
                                 p_amount_cents, 'transfer', 'Festgeld im Tresor angelegt', 'vault_deposit', null,
                                 'vault_deposit:' || v_id::text || ':open', v_player,
                                 jsonb_build_object('deposit_id', v_id, 'term_days', p_term_days));

  return public.request_complete(v_player, p_request_id,
    public.vault_deposits_json(v_player) || jsonb_build_object('deposit_id', v_id,
      'cash_cents', (select a.balance_cents from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash')));
end;
$$;
comment on function public.open_vault_deposit(uuid, bigint, integer) is
  'Locks cash in the vault for a term (ADR-201). Idempotent by request_id.';

create or replace function public.close_vault_deposit(p_request_id uuid, p_deposit_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player   uuid;
  v_replay   jsonb;
  d          public.vault_deposits;
  v_now      timestamptz := public.game_now();
  v_matured  boolean;
  v_interest bigint := 0;
  v_paid     bigint := 0;
  v_key      text;
begin
  v_player := public.require_player();
  if p_request_id is null or p_deposit_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'close_vault_deposit');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  perform public.lock_player_accounts(v_player);
  select * into d from public.vault_deposits
   where id = p_deposit_id and player_id = v_player and status = 'open'
   for update;
  if not found then
    perform public.api_error('deposit_not_found');
  end if;
  v_matured := d.matures_at <= v_now;
  v_key := 'vault_deposit:' || d.id::text;

  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_reserve'),
                                 public.ledger_player_account(v_player, 'player_cash'),
                                 d.amount_cents, 'transfer',
                                 case when v_matured then 'Festgeld aus dem Tresor zurück' else 'Festgeld vorzeitig aufgelöst' end,
                                 'vault_deposit', null, v_key || ':close', v_player,
                                 jsonb_build_object('deposit_id', d.id, 'matured', v_matured));
  if v_matured then
    v_interest := public.vault_deposit_interest_cents(d.amount_cents, d.rate_bps, public.basic_income_factor_bps());
    v_paid := public.state_pay_partial(v_player, v_interest, 'vault_claim', 'Festgeld-Zinsen', v_key || ':interest');
    perform public.loan_withhold(v_player, v_paid, v_key || ':interest');
  end if;
  update public.vault_deposits
     set status = case when v_matured then 'paid' else 'broken' end, closed_at = v_now, interest_cents = v_paid
   where id = d.id;

  return public.request_complete(v_player, p_request_id,
    public.vault_deposits_json(v_player) || jsonb_build_object(
      'closed', jsonb_build_object('id', d.id, 'amount_cents', d.amount_cents, 'interest_cents', v_paid, 'matured', v_matured),
      'cash_cents', (select a.balance_cents from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash')));
end;
$$;
comment on function public.close_vault_deposit(uuid, bigint) is
  'Collects a matured deposit with interest, or breaks an open one without interest (ADR-201). Idempotent by request_id.';

revoke all on function public.vault_level_factor_bps(integer) from public, anon, authenticated;
revoke all on function public.vault_status(uuid) from public, anon, authenticated;
revoke all on function public.vault_deposits_on_reset() from public, anon, authenticated;
revoke all on function public.vault_deposit_interest_cents(bigint, integer, integer) from public, anon, authenticated;
revoke all on function public.vault_deposits_json(uuid) from public, anon, authenticated;
revoke all on function public.get_vault_deposits() from public, anon;
grant execute on function public.get_vault_deposits() to authenticated;
revoke all on function public.open_vault_deposit(uuid, bigint, integer) from public, anon;
grant execute on function public.open_vault_deposit(uuid, bigint, integer) to authenticated;
revoke all on function public.close_vault_deposit(uuid, bigint) from public, anon;
grant execute on function public.close_vault_deposit(uuid, bigint) to authenticated;
