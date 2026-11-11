-- ===== idempotent copy of migrations/20261112000100_m2_schema.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M2a · 0100 · Schema for fractional shares, endless levels, the closed
--                     money system, names, the rich list and missions
-- =============================================================================
-- Idempotent (the identical copy in supabase/updates/ is pasted into existing
-- projects any number of times).
--   A. share quantities in millionths (*_e6, 1 share = 1 000 000); existing
--      rows are scaled exactly once (rename + multiply in one guarded step)
--   B. no upper bound on the player level
--   C. system accounts of the closed money system and the ledger guards
--      (world_genesis accepts exactly one transaction, the mint is closed
--      after the genesis); the genesis itself is public.money_genesis()
--   D. blocked name terms (internal), profiles.nickname_changed_at
--   E. AI tycoons, their holdings and rich list snapshots (internal)
--   F. mission templates and player missions for quick/daily/weekly/milestone
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Fractional shares
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('orders',               'quantity',            'quantity_e6'),
      ('orders',               'filled_quantity',     'filled_quantity_e6'),
      ('orders',               'reserved_quantity',   'reserved_quantity_e6'),
      ('positions',            'quantity',            'quantity_e6'),
      ('positions',            'reserved_quantity',   'reserved_quantity_e6'),
      ('position_lots',        'quantity_initial',    'quantity_initial_e6'),
      ('position_lots',        'quantity_open',       'quantity_open_e6'),
      ('trades',               'quantity',            'quantity_e6'),
      ('distribution_payouts', 'quantity',            'quantity_e6'),
      ('security_quotes',      'day_volume',          'day_volume_e6'),
      ('candles',              'volume',              'volume_e6'),
      ('price_ticks',          'volume',              'volume_e6'),
      ('security_sim_state',   'pending_player_flow', 'pending_player_flow_e6'),
      ('ai_investor_holdings', 'quantity',            'quantity_e6')
    ) as t(tbl, old_col, new_col)
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = r.tbl and column_name = r.old_col)
       and not exists (select 1 from information_schema.columns
                        where table_schema = 'public' and table_name = r.tbl and column_name = r.new_col) then
      execute format('alter table public.%I rename column %I to %I', r.tbl, r.old_col, r.new_col);
      if r.tbl = 'trades' then
        execute 'alter table public.trades disable trigger trades_immutable';
      end if;
      execute format('update public.%I set %I = %I * 1000000 where %I <> 0', r.tbl, r.new_col, r.new_col, r.new_col);
      if r.tbl = 'trades' then
        execute 'alter table public.trades enable trigger trades_immutable';
      end if;
      raise notice 'NEXA: %.% -> % (x 1 000 000)', r.tbl, r.old_col, r.new_col;
    end if;
  end loop;
end;
$$;

comment on column public.orders.quantity_e6 is 'Ordered quantity in millionths of a share (1 share = 1 000 000).';
comment on column public.positions.quantity_e6 is 'Held quantity in millionths of a share.';
comment on column public.trades.quantity_e6 is 'Executed quantity in millionths of a share. gross_cents = round_half_even(quantity_e6 x price_e4 / 1e8).';
comment on column public.security_sim_state.pending_player_flow_e6 is 'Net player order flow (millionths of a share) since the last tick; feeds the price impact.';

-- views that expose quantities: recreated with the new column names
drop view if exists public.v_my_positions;
create view public.v_my_positions with (security_invoker = true) as
select
  p.id as position_id, p.security_id, s.ticker, s.name, s.kind as security_kind, s.sector_key,
  p.side, p.leverage, p.quantity_e6, p.reserved_quantity_e6, p.avg_entry_price_e4, p.cost_basis_cents,
  p.margin_cents, p.borrowed_cents, p.liquidation_price_e4, p.realized_pnl_cents,
  p.accrued_financing_cents, p.opened_at,
  q.last_price_e4, q.change_bps,
  round(p.quantity_e6::numeric * q.last_price_e4 / 100000000)::bigint as market_value_cents,
  round(p.quantity_e6::numeric * q.last_price_e4 / 100000000)::bigint - p.cost_basis_cents as unrealized_pnl_cents
from public.positions p
join public.securities s on s.id = p.security_id
left join public.security_quotes q on q.security_id = p.security_id
where p.player_id = (select auth.uid()) and p.status = 'open';
comment on view public.v_my_positions is 'Open positions with mark-to-market values (quantities in millionths of a share).';

drop view if exists public.v_securities;
create view public.v_securities with (security_invoker = true) as
select
  s.id, s.kind, s.ticker, s.name, s.status, s.sector_key, s.company_id,
  s.tick_size_e4, s.is_tradable, s.is_shortable, s.max_leverage, s.listed_at,
  c.is_ai        as company_is_ai,
  c.tier         as company_tier,
  c.logo_key, c.logo_pixels, c.brand_color,
  q.last_price_e4, q.bid_e4, q.ask_e4, q.prev_close_e4, q.day_open_e4, q.day_high_e4, q.day_low_e4,
  q.day_volume_e6, q.day_turnover_cents, q.change_bps, q.market_cap_cents, q.yield_bps,
  q.updated_at   as quote_updated_at
from public.securities s
left join public.security_quotes q on q.security_id = s.id
left join public.companies c on c.id = s.company_id;
comment on view public.v_securities is 'Market list: security master data, issuer branding and the latest quote (volume in millionths).';

grant select on public.v_my_positions, public.v_securities to authenticated;
revoke all on public.v_my_positions, public.v_securities from anon, public;

-- ---------------------------------------------------------------------------
-- B. Endless levels
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_level_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_level_min' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_level_min check (level >= 1);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Closed money system: accounts and guards
-- ---------------------------------------------------------------------------
insert into public.ledger_accounts (kind, system_key, label, allow_negative) values
  ('system', 'world_genesis', 'World genesis: the only source of money, exactly one posting', true),
  ('system', 'treasury',      'State treasury: starting capital, basic income, bonds, fees and taxes', false),
  ('system', 'households',    'Households: customers of all companies (from M4)', false),
  ('system', 'tycoons',       'Cash of the AI tycoons on the rich list', false)
on conflict do nothing;
update public.ledger_accounts set label = 'Financial market: AI investors and market makers, counterparty of player trades'
 where system_key = 'market' and label is distinct from 'Financial market: AI investors and market makers, counterparty of player trades';

-- world_genesis: only the genesis transaction; mint: closed after the genesis
-- (only the one-time re-sourcing transfers may still touch it).
create or replace function public.ledger_money_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_sys text;
begin
  select a.system_key into v_sys from public.ledger_accounts a where a.id = new.account_id;
  if v_sys is null or v_sys not in ('world_genesis', 'mint') then
    return new;
  end if;
  select t.idempotency_key into v_key from public.ledger_transactions t where t.id = new.transaction_id;
  if v_sys = 'world_genesis' then
    if v_key is distinct from 'money:genesis' then
      raise exception 'world_genesis accepts exactly one transaction (the genesis)' using errcode = 'NX003';
    end if;
  elsif exists (select 1 from public.ledger_transactions g where g.idempotency_key = 'money:genesis')
        and coalesce(v_key, '') not like 'money:resource:%' then
    raise exception 'the mint is closed: money is only created once, at the world genesis' using errcode = 'NX003';
  end if;
  return new;
end;
$$;
revoke all on function public.ledger_money_guard() from public, anon, authenticated;

drop trigger if exists ledger_money_guard on public.ledger_entries;
create trigger ledger_money_guard
  before insert on public.ledger_entries
  for each row execute function public.ledger_money_guard();

-- ---------------------------------------------------------------------------
-- D. Names
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists nickname_changed_at timestamptz;
comment on column public.profiles.nickname_changed_at is 'Last nickname change; the next one is allowed names.nicknameChangeDays later (NULL = never changed).';

create table if not exists public.blocked_name_terms (
  term       text primary key check (term ~ '^[a-z0-9]+$'),
  category   text not null check (category in ('profanity', 'sexual', 'slur', 'extremist', 'code', 'reserved')),
  match_mode text not null check (match_mode in ('substring', 'token', 'code')),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.blocked_name_terms enable row level security;
revoke all on public.blocked_name_terms from public, anon, authenticated;
grant all on public.blocked_name_terms to service_role;
comment on table public.blocked_name_terms is 'Name filter (players, companies, later chat). Terms are stored normalised (see public.name_normalize). Internal.';

-- ---------------------------------------------------------------------------
-- E. Rich list
-- ---------------------------------------------------------------------------
create table if not exists public.rich_tycoons (
  id                 uuid primary key default gen_random_uuid(),
  seed_rank          integer not null unique check (seed_rank > 0),
  name               text not null unique,
  description        text not null,
  cash_cents         bigint not null default 0 check (cash_cents >= 0),
  founder_company_id uuid references public.companies (id) on delete set null,
  created_at         timestamptz not null default now()
);
alter table public.rich_tycoons enable row level security;
create index if not exists rich_tycoons_founder_company_idx on public.rich_tycoons (founder_company_id);
comment on table public.rich_tycoons is 'Fictional AI tycoons of the rich list. cash_cents sums to the balance of the ledger account "tycoons". Internal (read via get_rich_list).';

create table if not exists public.rich_tycoon_holdings (
  tycoon_id   uuid not null references public.rich_tycoons (id) on delete cascade,
  security_id uuid not null references public.securities (id) on delete cascade,
  quantity_e6 bigint not null check (quantity_e6 > 0),
  primary key (tycoon_id, security_id)
);
alter table public.rich_tycoon_holdings enable row level security;
create index if not exists rich_tycoon_holdings_security_idx on public.rich_tycoon_holdings (security_id);
comment on table public.rich_tycoon_holdings is 'Share holdings of the AI tycoons (millionths of a share), static for now. Internal.';

create table if not exists public.rich_list_snapshots (
  taken_at        timestamptz not null,
  entity_kind     text not null check (entity_kind in ('player', 'tycoon')),
  entity_id       uuid not null,
  net_worth_cents bigint not null,
  rank_all        integer not null,
  rank_players    integer,
  primary key (taken_at, entity_kind, entity_id)
);
alter table public.rich_list_snapshots enable row level security;
create index if not exists rich_list_snapshots_entity_idx on public.rich_list_snapshots (entity_id, taken_at desc);
comment on table public.rich_list_snapshots is 'Rich list every richList.snapshotMinutes (8 days kept) for 24 h changes and rank news. Internal.';

revoke all on public.rich_tycoons, public.rich_tycoon_holdings, public.rich_list_snapshots from public, anon, authenticated;
grant all on public.rich_tycoons, public.rich_tycoon_holdings, public.rich_list_snapshots to service_role;

insert into public.news_templates (key, category, headline_template, body_template, sentiment, importance) values
  ('rich_rank_entry',   'player', 'Neu in den Top {rank}: {name} springt auf Platz {position}', 'Mit einem Vermögen von {worth} steht {name} jetzt auf Platz {position} der NEXA-Reichenliste.', 0, 2),
  ('rich_number_one',   'player', '{name} ist die reichste Person der NEXA',                   'Mit {worth} führt {name} die Reichenliste an.', 0, 3),
  ('rich_players_one',  'player', 'Neue Nummer eins unter den Spielern: {name}',                '{name} ist mit {worth} jetzt der reichste Mensch aus Fleisch und Blut in der NEXA.', 0, 2),
  ('rich_overtake',     'player', 'Machtwechsel: {name} überholt {other}',                      '{name} liegt mit {worth} jetzt auf Platz {position} der Reichenliste, vor {other}.', 0, 1),
  ('rich_top_gainer',   'player', 'Aufsteiger des Tages: {name} mit {pct} in 24 Stunden',       'Das Vermögen von {name} wuchs auf {worth}.', 0, 1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- F. Missions: kind as text (new kinds without enum changes inside one
--    transaction), mode/params/chain order on templates, per-mission state
-- ---------------------------------------------------------------------------
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'mission_templates' and column_name = 'kind') = 'USER-DEFINED' then
    alter table public.mission_templates alter column kind type text using kind::text;
  end if;
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'player_missions' and column_name = 'kind') = 'USER-DEFINED' then
    alter table public.player_missions alter column kind type text using kind::text;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mission_templates_kind_check2') then
    alter table public.mission_templates add constraint mission_templates_kind_check2
      check (kind in ('quick', 'daily', 'weekly', 'milestone', 'intro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'player_missions_kind_check2') then
    alter table public.player_missions add constraint player_missions_kind_check2
      check (kind in ('quick', 'daily', 'weekly', 'milestone', 'intro'));
  end if;
end;
$$;

alter table public.mission_templates
  add column if not exists mode             text check (mode in ('count', 'sum', 'max', 'distinct', 'state')),
  add column if not exists params           jsonb not null default '{}'::jsonb,
  add column if not exists chain_order      integer,
  add column if not exists scale_with_level boolean not null default false;
comment on column public.mission_templates.mode is 'How events advance the mission: count (+1), sum (+amount), max (largest single amount), distinct (distinct refs), state (current value, e.g. net worth). NULL = legacy template, never assigned.';
comment on column public.mission_templates.params is 'Filters and options, e.g. {"sector": "energy"} or {"rank": 100}.';
comment on column public.mission_templates.chain_order is 'Order of the milestone story chain.';

alter table public.player_missions add column if not exists state jsonb not null default '{}'::jsonb;
comment on column public.player_missions.state is 'Per-mission bookkeeping (seen refs of distinct missions, baselines).';
create index if not exists player_missions_active_idx on public.player_missions (player_id, status) where status in ('active', 'completed');
