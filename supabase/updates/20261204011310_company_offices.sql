-- ===== idempotent copy of migrations/20261204011310_company_offices.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 011310 · Büroflächen: up to 1.000 seats, paid step by step (ADR-218)
-- =============================================================================
-- The owner: "Man soll mehr Plätze für Mitarbeiter haben. Bis zu 1000. Aber das kostet zu upgraden."
--
-- Seats of a player company were legal form (garage 2 … AG 100) + 10 × expansion level (ADR-083/191, × 1,8 in price
-- per level) + the headquarters (ADR-208, 410 at the Mega-Campus). The expansion level is priced for market and
-- capacity, so 1.000 seats were out of reach (an AG with the full headquarters needed 49 levels, the 49th costing
-- 10^19 €). New: a separate line "Büroflächen" (startups.offices, src/lib/sim/offices.ts) with 12 steps and 500 seats,
-- exponential prices (0,25 Mio. € … 600 Mio. €, 1,55 Mrd. € in all), gated by legal form (steps 1–3 from the GmbH,
-- 4–12 AG) and company value (company_worth_cents, 2 Mio. € … 2,5 Mrd. €). All seats together are capped at
-- maxTotalSeats = 1.000. Every bought office seat costs rent in the hourly close (10 € per seat and hour, from the
-- free cash like the subsidiaries), so empty seats are not free.
--
-- Changed (latest full definitions copied):
--   company_max_employees   from 20261204010010_world_map.sql, + office seats, capped at maxTotalSeats
--   company_seats_sync      from 20261204007350_company_growth_path.sql, + office_level (trigger column list too)
--   company_seats_guard     unchanged (it calls company_max_employees)
--   company_growth_path     from 20261204007350_company_growth_path.sql, + office level and seats
--   world_hour_costs        from 20261204010010_world_map.sql, + the office rent first (for every player company,
--                           placed or not; listed_hour_costs calls it for every player company inside its own guard)
-- New: office_level, company_office_step, company_office_seats, company_offices_json, get_company_offices(),
--      buy_company_office(request_id).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. State
-- ---------------------------------------------------------------------------
alter table public.player_companies add column if not exists office_level integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'player_companies_office_level_check') then
    alter table public.player_companies add constraint player_companies_office_level_check check (office_level >= 0);
  end if;
end;
$$;
comment on column public.player_companies.office_level is 'Bought Büroflächen steps (ADR-218, startups.offices.steps).';

-- ---------------------------------------------------------------------------
-- B. Rules (src/lib/sim/offices.ts)
-- ---------------------------------------------------------------------------
-- step n (1-based) of startups.offices.steps, null past the last one
create or replace function public.company_office_step(p_n integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_n >= 1 then public.config_jsonb('startups', '{offices,steps}') -> (p_n - 1) end;
$$;

-- office seats after `level` bought steps (officeSeats)
create or replace function public.company_office_seats(p_level integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((s ->> 'seats')::integer), 0)::integer
    from jsonb_array_elements(coalesce(public.config_jsonb('startups', '{offices,steps}'), '[]'::jsonb))
         with ordinality x(s, n)
   where x.n <= greatest(0, coalesce(p_level, 0));
$$;

-- places: tier + expansion (ADR-083/191) + the seats of the headquarters (ADR-208) + offices (ADR-218), capped
-- (latest definition from 20261204010010_world_map.sql)
create or replace function public.company_max_employees(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(public.config_double('startups', '{offices,maxTotalSeats}', 1000)::integer,
               coalesce((public.company_tier_cfg(pc.tier) ->> 'maxEmployees')::integer, 0)
               + public.config_double('startups', '{expansion,employeesPerLevel}', 10)::integer * pc.expansion_level
               + coalesce((select sum((public.world_hq_tier_cfg(t.n) ->> 'seats')::integer)
                             from public.company_locations l, generate_series(1, l.hq_tier) t(n)
                            where l.company_id = p_company), 0)::integer
               + public.company_office_seats(pc.office_level))
    from public.player_companies pc where pc.company_id = p_company;
$$;
comment on function public.company_max_employees(uuid) is
  'Places for players and AI workers (maxEmployees of the tier + employeesPerLevel × expansion level, ADR-083, + the '
  'seats of every headquarters tier reached, ADR-208, + the Büroflächen, ADR-218), at most offices.maxTotalSeats.';

-- a new legal form, expansion level or office step updates the places (latest definition from 7350)
create or replace function public.company_seats_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tier is distinct from old.tier or new.expansion_level is distinct from old.expansion_level
     or new.office_level is distinct from old.office_level then
    update public.companies set max_employees = public.company_max_employees(new.company_id) where id = new.company_id;
  end if;
  return new;
end;
$$;
comment on function public.company_seats_sync() is
  'Trigger (ADR-191, ADR-218): a new legal form, expansion level or office step updates the places of the company.';

drop trigger if exists company_seats_sync on public.player_companies;
create trigger company_seats_sync
  after update of tier, expansion_level, office_level on public.player_companies
  for each row execute function public.company_seats_sync();

-- The whole path (latest definition from 7350) plus the office line.
create or replace function public.company_growth_path(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'stage', s.stage,
           'stages', s.total,
           'expansion_level', pc.expansion_level,
           'step', s.stage + pc.expansion_level,
           'next', case when s.stage < s.total then jsonb_build_object('kind', 'stage', 'n', s.stage + 1)
                        else jsonb_build_object('kind', 'level', 'n', pc.expansion_level + 1) end,
           'can_expand', public.company_can_expand(pc.tier),
           'next_cost_cents', case when public.company_can_expand(pc.tier)
                                   then public.company_expansion_cost_cents(pc.expansion_level) end,
           'max_employees', public.company_max_employees(pc.company_id),
           'office_level', pc.office_level,
           'office_seats', public.company_office_seats(pc.office_level))
    from public.player_companies pc
    cross join lateral (
      select public.company_stage(pc.company_id) as stage,
             jsonb_array_length(coalesce(public.company_product(pc.company_id) -> 'stages', '[]'::jsonb)) as total) s
   where pc.company_id = p_company;
$$;
comment on function public.company_growth_path(uuid) is
  'Wachstum & Ausbau as one path (ADR-191): stage, stages, expansion level, step = stage + level, next, next cost, places; '
  'office level and seats (ADR-218).';

-- ---------------------------------------------------------------------------
-- C. Read model for the card "Büroflächen"
-- ---------------------------------------------------------------------------
create or replace function public.company_offices_json(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  v_steps  jsonb := coalesce(public.config_jsonb('startups', '{offices,steps}'), '[]'::jsonb);
  v_next   jsonb;
  v_max    integer := public.config_double('startups', '{offices,maxTotalSeats}', 1000)::integer;
  v_seats  integer;
  v_worth  bigint;
  v_free   bigint;
  v_hq     integer;
  v_block  text;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  v_next := public.company_office_step(pc.office_level + 1);
  v_seats := public.company_max_employees(p_company);
  v_worth := coalesce(public.company_worth_cents(p_company), 0);
  select coalesce(a.balance_cents, 0) - pc.unpaid_cents into v_free
    from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash';
  v_free := coalesce(v_free, 0);
  select coalesce(sum((public.world_hq_tier_cfg(t.n) ->> 'seats')::integer), 0)::integer into v_hq
    from public.company_locations l, generate_series(1, l.hq_tier) t(n) where l.company_id = p_company;
  -- officeBlock: all bought, cap reached, legal form, company value, free cash
  v_block := case when v_next is null then 'max_level'
                  when v_seats >= v_max then 'seats_max'
                  when not coalesce(v_next -> 'tiers', '[]'::jsonb) ? pc.tier then 'legal_form'
                  when v_worth < (v_next ->> 'minWorthCents')::bigint then 'worth'
                  when v_free < (v_next ->> 'costCents')::bigint then 'cash' end;
  return jsonb_build_object(
    'level', pc.office_level,
    'steps', jsonb_array_length(v_steps),
    'tier', pc.tier,
    'seats', jsonb_build_object(
      'tier', coalesce((public.company_tier_cfg(pc.tier) ->> 'maxEmployees')::integer, 0),
      'expansion', public.config_double('startups', '{expansion,employeesPerLevel}', 10)::integer * pc.expansion_level,
      'headquarters', coalesce(v_hq, 0),
      'offices', public.company_office_seats(pc.office_level),
      'total', v_seats,
      'max', v_max,
      'used', public.company_headcount(p_company)),
    'rent_cents_per_hour', public.company_office_seats(pc.office_level)::bigint
                           * public.config_double('startups', '{offices,rentCentsPerSeatPerHour}', 1000)::bigint,
    'worth_cents', v_worth,
    'free_cash_cents', v_free,
    'next', case when v_next is not null then jsonb_build_object(
              'n', pc.office_level + 1,
              'seats', (v_next ->> 'seats')::integer,
              'cost_cents', (v_next ->> 'costCents')::bigint,
              'min_worth_cents', (v_next ->> 'minWorthCents')::bigint,
              'tiers', coalesce(v_next -> 'tiers', '[]'::jsonb)) end,
    'block', v_block);
end;
$$;
comment on function public.company_offices_json(uuid) is
  'Büroflächen of a player company (ADR-218): level, seats by source, rent, next step and why it is blocked.';

create or replace function public.get_company_offices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.company_offices_json(public.require_own_company());
end;
$$;
comment on function public.get_company_offices() is 'RPC (founder): the Büroflächen of the own company (ADR-218).';

-- ---------------------------------------------------------------------------
-- D. Buying the next step
-- ---------------------------------------------------------------------------
create or replace function public.buy_company_office(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  pc        public.player_companies;
  v_step    jsonb;
  v_cost    bigint;
  v_free    bigint;
  v_n       integer;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'buy_company_office');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  v_n := pc.office_level + 1;
  v_step := public.company_office_step(v_n);
  if v_step is null then
    perform public.api_error('office_max_level');
  end if;
  if public.company_max_employees(v_company) >= public.config_double('startups', '{offices,maxTotalSeats}', 1000)::integer then
    perform public.api_error('office_seats_max');
  end if;
  if not coalesce(v_step -> 'tiers', '[]'::jsonb) ? pc.tier then
    perform public.api_error('office_legal_form');
  end if;
  if coalesce(public.company_worth_cents(v_company), 0) < (v_step ->> 'minWorthCents')::bigint then
    perform public.api_error('office_worth');
  end if;
  v_cost := (v_step ->> 'costCents')::bigint;
  -- free cash: open bills come first (as expand_company)
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a where a.owner_company_id = v_company and a.kind = 'company_cash' for update;
  if coalesce(v_free, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.company_cash_account(v_company), public.ledger_system_account('treasury'), v_cost,
                                   'company_costs', 'Büroflächen: Stufe ' || v_n, 'company', v_company,
                                   'office:' || v_company::text || ':' || v_n, v_player, jsonb_build_object('cat', 'office'));
  end if;
  update public.player_companies set office_level = v_n where company_id = v_company;  -- company_seats_sync
  perform public.company_system_message(v_company, 'Büroflächen Stufe ' || v_n || ' für ' || public.format_eur(v_cost)
                                                   || ': ' || (v_step ->> 'seats') || ' Plätze mehr.');
  return public.request_complete(v_player, p_request_id,
                                 jsonb_build_object('offices', public.company_offices_json(v_company)));
end;
$$;
comment on function public.buy_company_office(uuid) is
  'RPC (founder, ADR-218): buys the next Büroflächen step from the free company cash (to the treasury). Errors '
  'office_max_level, office_seats_max, office_legal_form, office_worth, insufficient_funds.';

-- ---------------------------------------------------------------------------
-- E. Rent in the hourly close: world_hour_costs (latest definition from 20261204010010_world_map.sql) books the rent
--    of the office seats first, for every player company; then subsidiaries and the Standortgebühr as before.
-- ---------------------------------------------------------------------------
create or replace function public.world_hour_costs(p_company uuid, p_hour_start timestamptz, p_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  l       public.company_locations;
  pc      public.player_companies;
  lb      public.country_lobby;
  v_acc   uuid;
  v_left  bigint;
  v_subs  bigint := 0;
  v_pay   bigint;
  v_rev   bigint;
  v_fee   bigint := 0;
  v_lead  uuid;
  v_name  text;
  v_rent  bigint := 0;
  s       record;
begin
  select * into pc from public.player_companies where company_id = p_company;
  -- ADR-218: rent of the office seats, from the free cash only (never a bill)
  if coalesce(pc.office_level, 0) > 0 then
    v_acc := public.company_cash_account(p_company);
    select greatest(0, a.balance_cents) into v_left from public.ledger_accounts a where a.id = v_acc for update;
    v_rent := least(public.company_office_seats(pc.office_level)::bigint
                    * public.config_double('startups', '{offices,rentCentsPerSeatPerHour}', 1000)::bigint,
                    coalesce(v_left, 0));
    if v_rent > 0 then
      perform public.ledger_transfer(v_acc, public.ledger_system_account('households'), v_rent, 'company_costs',
                                     'Büroflächen: Miete', 'company', p_company, p_key || ':office:rent',
                                     pc.founder_id, jsonb_build_object('cat', 'office'));
    end if;
  end if;
  select * into l from public.company_locations where company_id = p_company for update;
  if l.company_id is null then
    return v_rent;
  end if;
  v_acc := public.company_cash_account(p_company);
  select greatest(0, a.balance_cents) into v_left from public.ledger_accounts a where a.id = v_acc;
  v_left := coalesce(v_left, 0);
  -- subsidiaries: what the cash allows, never a bill
  for s in select x.opened_at from public.company_subsidiaries x where x.company_id = p_company loop
    v_subs := v_subs + public.world_subsidiary_hourly_cost(extract(epoch from (p_hour_start - s.opened_at)) / 3600.0);
  end loop;
  v_pay := least(v_subs, v_left);
  if v_pay > 0 then
    perform public.ledger_transfer(v_acc, public.ledger_system_account('households'), v_pay, 'company_costs',
                                   'Tochterfirmen: laufende Kosten', 'company', p_company, p_key || ':world:subs',
                                   pc.founder_id, jsonb_build_object('cat', 'world'));
    v_left := v_left - v_pay;
  end if;
  -- Standortgebühr: the leader of the HQ country (another company, still leading) takes its share of the own revenue
  v_lead := public.country_market_leader(l.country_key);
  select * into lb from public.country_lobby where country_key = l.country_key;
  if v_lead is not null and v_lead <> p_company and lb.leader_company_id = v_lead and lb.fee_bps > 0 then
    select coalesce(sum(e.amount_cents), 0) into v_rev
      from public.ledger_transactions t join public.ledger_entries e on e.transaction_id = t.id and e.account_id = v_acc
     where t.idempotency_key = p_key || ':revenue';
    v_fee := least(floor(greatest(0, v_rev) * least(lb.fee_bps, public.cfg_num(public.world_cfg(), '{lobby,maxFeeBps}', 300)) / 10000.0)::bigint,
                   v_left);
    if v_fee > 0 then
      v_name := coalesce(public.country_cfg(l.country_key) ->> 'name', l.country_key);
      perform public.ledger_transfer(v_acc, public.company_cash_account(v_lead), v_fee, 'company_costs',
                                     'Standortgebühr ' || v_name, 'company', p_company, p_key || ':world:fee',
                                     pc.founder_id, jsonb_build_object('cat', 'world', 'leader', v_lead));
      update public.company_locations set fees_paid_cents = fees_paid_cents + v_fee where company_id = p_company;
      update public.company_locations set fees_received_cents = fees_received_cents + v_fee where company_id = v_lead;
      update public.country_lobby set collected_cents = collected_cents + v_fee, updated_at = now()
       where country_key = l.country_key;
    end if;
  end if;
  return v_rent + v_pay + v_fee;
end;
$$;
comment on function public.world_hour_costs(uuid, timestamptz, text) is
  'Hourly close (ADR-208, ADR-218): rent of the office seats, running costs of the subsidiaries and the Standortgebühr '
  'to the market leader, all from the free cash only; returns the sum (counted as fixed costs of the hour).';

-- ---------------------------------------------------------------------------
-- F. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.company_office_step(integer)', 'public.company_office_seats(integer)', 'public.company_max_employees(uuid)',
    'public.company_seats_sync()', 'public.company_growth_path(uuid)', 'public.company_offices_json(uuid)',
    'public.world_hour_costs(uuid, timestamptz, text)', 'public.get_company_offices()', 'public.buy_company_office(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  grant execute on function public.company_growth_path(uuid) to service_role;
  grant execute on function public.company_offices_json(uuid) to service_role;
  grant execute on function public.get_company_offices() to authenticated, service_role;
  grant execute on function public.buy_company_office(uuid) to authenticated, service_role;
end;
$$;
