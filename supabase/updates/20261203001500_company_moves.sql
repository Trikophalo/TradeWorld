-- ===== idempotent copy of migrations/20261203001500_company_moves.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1500 · Business moves: many active ways to earn with a company (ADR-127)
-- =============================================================================
-- Every player company gets a choice of moves that fit its product (game_config.companyMoves.moves; product "*" =
-- every company): a cost from the company cash, a duration, a chance and a result. Cash moves pay back the cost with
-- profit on success (part of it on failure); awareness and quality moves make the company better for good. Skills
-- of the move's area in the team raise the chance. Moves run in slots by company tier and rest a while afterwards.
-- Money: cost to the households (company_costs), payouts from the households (company_revenue); closed system.
-- Contract work ("Auftragsarbeit") is no longer a choice: free capacity is always sold.
--
-- Table company_moves (RLS, no client rights). RPCs (authenticated):
--   get_company_moves() -> COMPANY_MOVES of the player's own company
--   start_company_move(p_request_id uuid, p_key text) -> COMPANY_MOVES
--   COMPANY_MOVES = {"slots", "used", "cash_cents", "tier", "product",
--                    "moves": [{"key","kind","risk","branch","minutes","cost_cents","chance_bps","skill_bonus_bps",
--                               "payout_cents","refund_cents","gain","available_at"}],
--                    "running": [{"id","key","started_at","ends_at","cost_cents","chance_bps"}],
--                    "history": [{"id","key","status","cost_cents","payout_cents","gain","resolved_at"}]}
-- Internal: company_moves_run_due(p_now) (cron nexa-company-moves, every minute).
-- Errors: move_unknown NX107, move_busy NX108, move_resting NX109, plus insufficient_funds, forbidden.
-- Idempotent: runs unchanged as supabase/updates/20261203001500_company_moves.sql.

create table if not exists public.company_moves (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies (id) on delete cascade,
  move_key      text not null,
  started_by    uuid references public.profiles (id) on delete set null,
  started_at    timestamptz not null default now(),
  ends_at       timestamptz not null,
  cost_cents    bigint not null check (cost_cents > 0),
  chance_bps    integer not null check (chance_bps between 0 and 10000),
  status        text not null default 'running' check (status in ('running', 'success', 'failure')),
  payout_cents  bigint not null default 0 check (payout_cents >= 0),
  gain          double precision not null default 0,
  resolved_at   timestamptz
);
alter table public.company_moves enable row level security;
revoke all on public.company_moves from public, anon, authenticated;
create index if not exists company_moves_company_idx on public.company_moves (company_id, started_at desc);
create index if not exists company_moves_due_idx on public.company_moves (ends_at) where status = 'running';
create index if not exists company_moves_started_by_idx on public.company_moves (started_by);
comment on table public.company_moves is 'Business moves of player companies (ADR-127). Internal; read through get_company_moves().';

-- error keys (as in the friend code migration plus the moves)
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.api_error(text)'::regprocedure);
  if position('move_unknown' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'friend_code_used'            then 'NX106'
$q$, $q$    when 'friend_code_used'            then 'NX106'
    when 'move_unknown'                then 'NX107'
    when 'move_busy'                   then 'NX108'
    when 'move_resting'                then 'NX109'
$q$);
    if position('move_unknown' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the move error keys by hand';
    end if;
    execute v_def;
  end if;
end;
$$;

-- contract work is always on (ADR-127)
alter table public.player_companies alter column contract_work set default true;
update public.player_companies set contract_work = true where not contract_work;

create or replace function public.company_moves_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('companyMoves'), '{}'::jsonb);
$$;

-- skills of an area in the team of a company (founder and employees)
create or replace function public.company_move_skill_count(p_company uuid, p_branch text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.company_team_skills(p_company) t
   where t.skill_key like p_branch || '\_%' or (t.skill_key like 'hybrid\_%' and exists (
           select 1 from jsonb_array_elements(coalesce(public.config_jsonb('skills', '{tree}'), '[]'::jsonb)) n
            where n ->> 'key' = t.skill_key and n -> 'branches' ? p_branch));
$$;

-- the moves of a company with their current numbers
create or replace function public.company_moves_state(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := public.company_moves_cfg();
  pc      public.player_companies;
  v_tier  text;
  v_base  bigint;
  v_slots integer;
  v_now   timestamptz := public.game_now();
  v_cash  bigint;
begin
  select * into pc from public.player_companies where company_id = p_company;
  v_tier := case when pc.tier in ('garage', 'small_business', 'gmbh', 'ag') then pc.tier else 'ag' end;
  v_base := coalesce((v_cfg #>> array['costCentsByTier', v_tier])::bigint, 100000);
  v_slots := coalesce((v_cfg #>> array['slotsByTier', v_tier])::integer, 1);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.id = public.company_cash_account(p_company);
  return jsonb_build_object(
    'slots', v_slots,
    'used', (select count(*) from public.company_moves m where m.company_id = p_company and m.status = 'running'),
    'cash_cents', coalesce(v_cash, 0),
    'tier', v_tier,
    'product', pc.product_key,
    'moves', coalesce((
      select jsonb_agg(x.j order by x.ord) from (
        select o.ord, jsonb_build_object(
                 'key', mv ->> 'key', 'kind', mv ->> 'kind', 'risk', mv ->> 'risk', 'branch', mv ->> 'branch',
                 'minutes', (mv ->> 'minutes')::integer,
                 'cost_cents', round(v_base * (mv ->> 'costFactor')::numeric)::bigint,
                 'chance_bps', least(coalesce((v_cfg ->> 'maxChanceBps')::integer, 9500),
                                     (v_cfg #>> array['risk', mv ->> 'risk', 'chanceBps'])::integer + sb.bonus),
                 'skill_bonus_bps', sb.bonus,
                 'payout_cents', case when mv ->> 'kind' = 'cash'
                                      then round(v_base * (mv ->> 'costFactor')::numeric
                                                 * (v_cfg #>> array['risk', mv ->> 'risk', 'payoutBps'])::numeric / 10000)::bigint
                                      else 0 end,
                 'refund_cents', round(v_base * (mv ->> 'costFactor')::numeric
                                       * (v_cfg #>> array['risk', mv ->> 'risk', 'refundBps'])::numeric / 10000)::bigint,
                 'gain', case when mv ->> 'kind' = 'cash' then 0
                              else (v_cfg #>> array['risk', mv ->> 'risk', 'gain'])::double precision end,
                 'available_at', (select max(m.started_at + make_interval(mins => ((mv ->> 'minutes')::integer
                                         * (1 + coalesce((v_cfg ->> 'cooldownFactor')::integer, 2)))))
                                    from public.company_moves m where m.company_id = p_company and m.move_key = mv ->> 'key'
                                     and m.started_at + make_interval(mins => ((mv ->> 'minutes')::integer
                                         * (1 + coalesce((v_cfg ->> 'cooldownFactor')::integer, 2)))) > v_now)) as j
          from jsonb_array_elements(coalesce(v_cfg -> 'moves', '[]'::jsonb)) with ordinality o(mv, ord)
          cross join lateral (select least(coalesce((v_cfg ->> 'maxSkillBonusBps')::integer, 2500),
                                           coalesce((v_cfg ->> 'chancePerSkillBps')::integer, 300)
                                           * public.company_move_skill_count(p_company, o.mv ->> 'branch')) as bonus) sb
         where o.mv ->> 'product' in ('*', coalesce(pc.product_key, ''))) x), '[]'::jsonb),
    'running', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'key', m.move_key, 'started_at', m.started_at, 'ends_at', m.ends_at,
                                          'cost_cents', m.cost_cents, 'chance_bps', m.chance_bps) order by m.ends_at)
        from public.company_moves m where m.company_id = p_company and m.status = 'running'), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'key', h.move_key, 'status', h.status, 'cost_cents', h.cost_cents,
                                          'payout_cents', h.payout_cents, 'gain', h.gain, 'resolved_at', h.resolved_at)
                       order by h.resolved_at desc, h.id desc)
        from (select m.* from public.company_moves m where m.company_id = p_company and m.status <> 'running'
               order by m.resolved_at desc, m.id desc limit coalesce((v_cfg ->> 'historyLimit')::integer, 12)) h), '[]'::jsonb));
end;
$$;

create or replace function public.get_company_moves()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid := public.require_player();
  v_company uuid;
begin
  select pc.company_id into v_company from public.player_companies pc
   where pc.founder_id = v_player and pc.status = 'active';
  if v_company is null then
    perform public.api_error('company_not_found');
  end if;
  return public.company_moves_state(v_company);
end;
$$;
comment on function public.get_company_moves() is 'RPC: the business moves of the own company (ADR-127).';

create or replace function public.start_company_move(p_request_id uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
  v_state   jsonb;
  v_move    jsonb;
  v_cash    bigint;
  v_cost    bigint;
begin
  v_player := public.require_player();
  if p_request_id is null or p_key is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'start_company_move');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where founder_id = v_player and status = 'active' for update;
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  v_state := public.company_moves_state(pc.company_id);
  select m into v_move from jsonb_array_elements(v_state -> 'moves') m where m ->> 'key' = p_key;
  if v_move is null then
    perform public.api_error('move_unknown');
  end if;
  if (v_state ->> 'used')::integer >= (v_state ->> 'slots')::integer then
    perform public.api_error('move_busy');
  end if;
  if v_move ->> 'available_at' is not null and (v_move ->> 'available_at')::timestamptz > public.game_now() then
    perform public.api_error('move_resting');
  end if;
  v_cost := (v_move ->> 'cost_cents')::bigint;
  select a.balance_cents into v_cash from public.ledger_accounts a
   where a.id = public.company_cash_account(pc.company_id) for update;
  if coalesce(v_cash, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.company_cash_account(pc.company_id), public.ledger_system_account('households'),
                                 v_cost, 'company_costs', 'Geschäftszug: ' || p_key, 'company', pc.company_id,
                                 'move:start:' || p_request_id::text, v_player, jsonb_build_object('move', p_key));
  insert into public.company_moves (company_id, move_key, started_by, started_at, ends_at, cost_cents, chance_bps)
  values (pc.company_id, p_key, v_player, public.game_now(),
          public.game_now() + make_interval(mins => (v_move ->> 'minutes')::integer), v_cost, (v_move ->> 'chance_bps')::integer);
  return public.request_complete(v_player, p_request_id, public.company_moves_state(pc.company_id));
end;
$$;
comment on function public.start_company_move(uuid, text) is 'RPC: the founder starts a business move of the own company (ADR-127).';

create or replace function public.company_moves_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb := public.company_moves_cfg();
  v_now     timestamptz := coalesce(p_now, public.game_now());
  m         record;
  v_kind    text;
  v_risk    text;
  v_ok      boolean;
  v_pay     bigint;
  v_gain    double precision;
  v_hh      uuid := public.ledger_system_account('households');
  v_hh_bal  bigint;
  v_done    integer := 0;
begin
  for m in select x.* from public.company_moves x where x.status = 'running' and x.ends_at <= v_now
            order by x.ends_at, x.id for update skip locked loop
    select mv ->> 'kind', mv ->> 'risk' into v_kind, v_risk
      from jsonb_array_elements(coalesce(v_cfg -> 'moves', '[]'::jsonb)) mv where mv ->> 'key' = m.move_key;
    v_kind := coalesce(v_kind, 'cash');
    v_risk := coalesce(v_risk, 'normal');
    v_ok := random() * 10000 < m.chance_bps;
    v_gain := 0;
    if v_ok and v_kind = 'cash' then
      v_pay := round(m.cost_cents * coalesce((v_cfg #>> array['risk', v_risk, 'payoutBps'])::numeric, 15000) / 10000)::bigint;
    elsif v_ok then
      v_pay := 0;
      v_gain := coalesce((v_cfg #>> array['risk', v_risk, 'gain'])::double precision, 0.04);
    else
      v_pay := round(m.cost_cents * coalesce((v_cfg #>> array['risk', v_risk, 'refundBps'])::numeric, 3000) / 10000)::bigint;
    end if;
    if not exists (select 1 from public.player_companies pc where pc.company_id = m.company_id and pc.status = 'active') then
      v_pay := 0;
      v_gain := 0;
    end if;
    if v_pay > 0 then
      select a.balance_cents into v_hh_bal from public.ledger_accounts a where a.id = v_hh for update;
      v_pay := least(v_pay, greatest(0, coalesce(v_hh_bal, 0)));
    end if;
    if v_pay > 0 then
      perform public.ledger_transfer(v_hh, public.company_cash_account(m.company_id), v_pay, 'company_revenue',
                                     'Geschäftszug: ' || m.move_key, 'company', m.company_id,
                                     'move:result:' || m.id::text, null, jsonb_build_object('move', m.move_key, 'success', v_ok));
    end if;
    if v_gain > 0 then
      if v_kind = 'awareness' then
        update public.player_companies set awareness = least(1, awareness + v_gain) where company_id = m.company_id;
      else
        update public.player_companies set quality = least(1, quality + v_gain) where company_id = m.company_id;
      end if;
    end if;
    update public.company_moves set status = case when v_ok then 'success' else 'failure' end, payout_cents = v_pay,
                                    gain = v_gain, resolved_at = v_now where id = m.id;
    perform public.company_system_message(m.company_id,
      case when v_ok and v_kind = 'cash' then 'Geschäftszug geschafft: ' || public.format_eur(v_pay) || ' eingenommen.'
           when v_ok then 'Geschäftszug geschafft: die Firma ist jetzt '
                          || case when v_kind = 'awareness' then 'bekannter' else 'besser' end || '.'
           else 'Geschäftszug daneben gegangen, ' || public.format_eur(v_pay) || ' zurück.' end);
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('resolved', v_done);
end;
$$;
comment on function public.company_moves_run_due(timestamptz) is
  'Internal, cron every minute (ADR-127): resolves due business moves (payout, refund or a lasting gain).';

do $$
declare
  f text;
begin
  foreach f in array array['public.company_moves_cfg()', 'public.company_move_skill_count(uuid, text)',
                           'public.company_moves_state(uuid)', 'public.company_moves_run_due(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.get_company_moves()', 'public.start_company_move(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'nexa-company-moves') then
      perform cron.unschedule('nexa-company-moves');
    end if;
    perform cron.schedule('nexa-company-moves', '* * * * *', 'select public.company_moves_run_due()');
  end if;
end;
$$;
