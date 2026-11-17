-- =============================================================================
-- NEXA · 8900 · Talente: named specialists for 15 Stellen, talent market, offers, poaching (ADR-199)
-- =============================================================================
-- * talents: the pool from game_config "talents" (src/config/talents.ts), synced by talents_ensure(), plus the state
--   of each talent (employer, contract, satisfaction, rest). Game-generated people, not players; AI companies never
--   employ talents. One talent per Stelle (role) and company.
-- * talent_offer(request, key, wage, benefits): hires a free talent on the market when every demand is met
--   (src/lib/sim/talents.ts talentOfferChecks); for a talent of another player company it opens a poaching offer when
--   the offer beats the current contract by poach.marginBps + loyalty; the owner may counter within
--   poach.counterMinutes (talent_counter); otherwise talent_offers_settle moves the talent.
-- * talent_dismiss(request, key). get_talent_market(role) and get_company_talents() for the page.
-- * talents_run_due(now) (cron every minute): wage and benefits per full hour through the ledger (company cash ->
--   households, sum 0), satisfaction per hour, warning and quitting, awareness (Marketing) through
--   company_awareness_add, reputation (Recht) through company_reputation_bump, then talents_coceo_run (8910 hook).
-- * talents_hour_effect(company): the capped terms; listed_hour_effect (full copy of the 8300 definition) multiplies
--   them in, so the hourly close (7720) and the fair value of listed companies take them without being redefined.
-- Idempotent: runs unchanged as supabase/updates/20261204008900_talents.sql.

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
create table if not exists public.talents (
  talent_key        text primary key check (talent_key ~ '^[a-z0-9_]+$'),
  role_key          text not null,
  tier              smallint not null check (tier between 0 and 4),
  first_name        text not null,
  last_name         text not null,
  avatar_key        text not null,
  traits            text[] not null default '{}',
  wage_demand_cents bigint not null check (wage_demand_cents > 0),
  benefit_demands   text[] not null default '{}',
  min_reputation    integer not null default 0,
  min_awareness_bps integer not null default 0,
  min_form          smallint not null default 0,
  effect_bps        integer not null default 0,
  company_id        uuid references public.companies (id) on delete set null,
  wage_cents        bigint check (wage_cents is null or wage_cents > 0),
  benefits          text[] not null default '{}',
  hired_at          timestamptz,
  paid_until        timestamptz,
  satisfaction_bps  integer not null default 0 check (satisfaction_bps between 0 and 10000),
  warned_at         timestamptz,
  resting_until     timestamptz,
  is_coceo          boolean not null default false,
  coceo_autonomy    text not null default 'advise' check (coceo_autonomy in ('advise', 'decide')),
  coceo_budget_cents bigint not null default 0 check (coceo_budget_cents >= 0),
  coceo_spent_day   date,
  coceo_spent_cents bigint not null default 0,
  updated_at        timestamptz not null default now()
);
create unique index if not exists talents_company_role_idx on public.talents (company_id, role_key) where company_id is not null;
create index if not exists talents_role_idx on public.talents (role_key, tier);
alter table public.talents enable row level security;
drop policy if exists talents_read on public.talents;
create policy talents_read on public.talents for select to authenticated using (true);
revoke insert, update, delete on public.talents from anon, authenticated;
grant select on public.talents to authenticated;
drop trigger if exists set_updated_at on public.talents;
create trigger set_updated_at before update on public.talents for each row execute function public.set_updated_at();
comment on table public.talents is
  'Talente (ADR-199): game-generated specialists for the 15 Stellen; pool from game_config "talents", state server-only.';

create table if not exists public.talent_offers (
  id           uuid primary key default gen_random_uuid(),
  talent_key   text not null references public.talents (talent_key) on delete cascade,
  from_company uuid not null references public.companies (id) on delete cascade,
  to_company   uuid references public.companies (id) on delete cascade,
  wage_cents   bigint not null check (wage_cents > 0),
  benefits     text[] not null default '{}',
  cost_cents   bigint not null,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'countered', 'failed', 'cancelled')),
  expires_at   timestamptz not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create unique index if not exists talent_offers_pending_idx on public.talent_offers (talent_key) where status = 'pending';
create index if not exists talent_offers_talent_idx on public.talent_offers (talent_key);
create index if not exists talent_offers_from_idx on public.talent_offers (from_company);
create index if not exists talent_offers_to_idx on public.talent_offers (to_company);
alter table public.talent_offers enable row level security;
drop policy if exists talent_offers_own on public.talent_offers;
create policy talent_offers_own on public.talent_offers for select to authenticated
  using (exists (select 1 from public.companies c
                  where c.id in (talent_offers.from_company, talent_offers.to_company)
                    and (select auth.uid()) in (c.founder_id, c.ceo_id)));
revoke insert, update, delete on public.talent_offers from anon, authenticated;
grant select on public.talent_offers to authenticated;

create table if not exists public.talent_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  talent_key  text not null references public.talents (talent_key) on delete cascade,
  kind        text not null check (kind ~ '^[a-z_]+$'),
  payload     jsonb not null default '{}'::jsonb,
  cost_cents  bigint not null default 0,
  reversible  boolean not null default false,
  undone_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists talent_events_company_idx on public.talent_events (company_id, created_at desc);
create index if not exists talent_events_talent_idx on public.talent_events (talent_key);
alter table public.talent_events enable row level security;
drop policy if exists talent_events_own on public.talent_events;
create policy talent_events_own on public.talent_events for select to authenticated
  using (exists (select 1 from public.companies c
                  where c.id = talent_events.company_id and (select auth.uid()) in (c.founder_id, c.ceo_id)));
revoke insert, update, delete on public.talent_events from anon, authenticated;
grant select on public.talent_events to authenticated;

create table if not exists public.talent_hours (
  talent_key       text not null references public.talents (talent_key) on delete cascade,
  hour_start       timestamptz not null,
  company_id       uuid not null references public.companies (id) on delete cascade,
  cost_cents       bigint not null,
  paid             boolean not null,
  satisfaction_bps integer not null,
  primary key (talent_key, hour_start)
);
create index if not exists talent_hours_company_idx on public.talent_hours (company_id, hour_start);
alter table public.talent_hours enable row level security;
drop policy if exists talent_hours_own on public.talent_hours;
create policy talent_hours_own on public.talent_hours for select to authenticated
  using (exists (select 1 from public.companies c
                  where c.id = talent_hours.company_id and (select auth.uid()) in (c.founder_id, c.ceo_id)));
revoke insert, update, delete on public.talent_hours from anon, authenticated;
grant select on public.talent_hours to authenticated;

create table if not exists public.talent_company_hours (
  company_id uuid not null references public.companies (id) on delete cascade,
  hour_start timestamptz not null,
  awareness  double precision not null default 0,
  reputation double precision not null default 0,
  primary key (company_id, hour_start)
);
alter table public.talent_company_hours enable row level security;
revoke all on public.talent_company_hours from anon, authenticated;

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('company_talent', 'company', 'Talente', 'Abwerbeversuche, unzufriedene Talente, Kündigungen und Entscheidungen der Mit-Geschäftsführung.',
        'notif_company', true, true, false, 214)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Config, pool and facts
-- ---------------------------------------------------------------------------
create or replace function public.talents_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'talents'), '{}'::jsonb);
$$;

-- Syncs the pool from the config: new talents are added, the generated fields of existing ones follow the config.
create or replace function public.talents_ensure()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pool jsonb := coalesce(public.talents_cfg() -> 'pool', '[]'::jsonb);
  v_n    integer;
begin
  if jsonb_array_length(v_pool) = (select count(*) from public.talents) then
    return 0;
  end if;
  insert into public.talents as t (talent_key, role_key, tier, first_name, last_name, avatar_key, traits, wage_demand_cents,
                                   benefit_demands, min_reputation, min_awareness_bps, min_form, effect_bps)
  select p ->> 'key', p ->> 'role', (p ->> 'tier')::smallint, p ->> 'firstName', p ->> 'lastName', p ->> 'avatar',
         array(select jsonb_array_elements_text(p -> 'traits')), (p ->> 'wageCents')::bigint,
         array(select jsonb_array_elements_text(p -> 'benefits')), (p ->> 'minReputation')::integer,
         (p ->> 'minAwarenessBps')::integer, (p ->> 'minForm')::smallint, (p ->> 'effectBps')::integer
    from jsonb_array_elements(v_pool) p
  on conflict (talent_key) do update
    set role_key = excluded.role_key, tier = excluded.tier, first_name = excluded.first_name,
        last_name = excluded.last_name, avatar_key = excluded.avatar_key, traits = excluded.traits,
        wage_demand_cents = excluded.wage_demand_cents, benefit_demands = excluded.benefit_demands,
        min_reputation = excluded.min_reputation, min_awareness_bps = excluded.min_awareness_bps,
        min_form = excluded.min_form, effect_bps = excluded.effect_bps;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.talent_trait_num(p_traits text[], p_field text)
returns double precision
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((tr ->> p_field)::double precision), 0)
    from jsonb_array_elements(coalesce(public.talents_cfg() -> 'traits', '[]'::jsonb)) tr
   where tr ->> 'key' = any (coalesce(p_traits, '{}'::text[]));
$$;

-- talentOfferCost: wage + Σ wage × benefitCostBps / 10 000 (wages are whole euros, so exact)
create or replace function public.talent_offer_cost(p_wage bigint, p_benefits text[])
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p_wage + coalesce((select sum(p_wage * coalesce((public.talents_cfg() -> 'benefitCostBps' ->> b)::bigint, 0) / 10000)
                              from (select distinct unnest(coalesce(p_benefits, '{}'::text[])) b) x), 0)::bigint;
$$;

create or replace function public.talent_form_rank(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from public.listed_companies l where l.company_id = p_company) then 4
              else coalesce((select case pc.tier::text when 'garage' then 0 when 'small_business' then 1 when 'gmbh' then 2
                                                       when 'ag' then 3 else 4 end
                               from public.player_companies pc where pc.company_id = p_company), 0) end;
$$;

-- Free cash (open bills first), reputation, awareness, legal form, expansion of a player company
create or replace function public.talent_company_facts(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'reputation', coalesce(pc.reputation, 50),
           'awareness_bps', round(coalesce(pc.awareness, 0) * 10000)::integer,
           'form_rank', public.talent_form_rank(p_company),
           'expansion_level', coalesce(pc.expansion_level, 0),
           'free_cash_cents', greatest(0, coalesce((select a.balance_cents from public.ledger_accounts a
                                                     where a.owner_company_id = p_company and a.kind = 'company_cash'), 0)
                                          - coalesce(pc.unpaid_cents, 0)))
    from public.player_companies pc where pc.company_id = p_company;
$$;

-- talentOfferChecks: [{key, ok}] in the order of the client list; p_extra_cash adds back money already committed
create or replace function public.talent_check_offer(p_talent public.talents, p_wage bigint, p_benefits text[], p_facts jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('key', 'wage', 'ok', p_wage >= p_talent.wage_demand_cents),
    jsonb_build_object('key', 'benefits', 'ok', coalesce(p_talent.benefit_demands <@ coalesce(p_benefits, '{}'::text[]), true)),
    jsonb_build_object('key', 'reputation', 'ok', (p_facts ->> 'reputation')::double precision >= p_talent.min_reputation),
    jsonb_build_object('key', 'awareness', 'ok', (p_facts ->> 'awareness_bps')::integer >= p_talent.min_awareness_bps),
    jsonb_build_object('key', 'form', 'ok', (p_facts ->> 'form_rank')::integer >= p_talent.min_form),
    jsonb_build_object('key', 'office', 'ok', not ('office' = any (coalesce(p_benefits, '{}'::text[])))
                                               or (p_facts ->> 'expansion_level')::integer >= 1),
    jsonb_build_object('key', 'cash', 'ok', (p_facts ->> 'free_cash_cents')::bigint
                         >= public.talent_offer_cost(p_wage, p_benefits)
                            * coalesce((public.talents_cfg() ->> 'cashCoverHours')::integer, 12)));
$$;

create or replace function public.talent_checks_ok(p_checks jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (select 1 from jsonb_array_elements(p_checks) c where not (c ->> 'ok')::boolean);
$$;

-- talentPoachMinCost
create or replace function public.talent_poach_min_cost(p_talent public.talents)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select ceil(public.talent_offer_cost(p_talent.wage_cents, p_talent.benefits)
              * greatest(0, 10000 + public.cfg_num(public.talents_cfg(), '{poach,marginBps}', 1500)
                            + public.talent_trait_num(p_talent.traits, 'loyaltyBps')) / 10000.0)::bigint;
$$;

-- A free talent is on the market unless resting or rotated out for this Berlin day (market.shareBps)
create or replace function public.talent_status(p_talent public.talents, p_now timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_talent.company_id is not null then 'employed'
    when p_talent.resting_until > p_now then 'resting'
    when abs(hashtext(p_talent.talent_key || ':' || ((p_now at time zone 'Europe/Berlin')::date)::text)) % 10000
         >= public.cfg_num(public.talents_cfg(), '{market,shareBps}', 6500) then 'off_market'
    else 'available' end;
$$;

create or replace function public.talent_name(p_talent public.talents)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_talent.first_name || ' ' || p_talent.last_name;
$$;

create or replace function public.talent_log(p_company uuid, p_talent text, p_kind text, p_payload jsonb,
                                             p_cost bigint default 0, p_reversible boolean default false)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.talent_events (company_id, talent_key, kind, payload, cost_cents, reversible)
  values (p_company, p_talent, p_kind, coalesce(p_payload, '{}'::jsonb), coalesce(p_cost, 0), coalesce(p_reversible, false))
  returning id into v_id;
  begin
    perform public.company_news_add(p_company, 'talent_' || p_kind, coalesce(p_payload, '{}'::jsonb));
  exception when others then
    null;
  end;
  return v_id;
end;
$$;

create or replace function public.talent_notify_founder(p_company uuid, p_title text, p_body text, p_payload jsonb, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.social_notify((select pc.founder_id from public.player_companies pc where pc.company_id = p_company),
                               'company_talent', p_title, p_body, coalesce(p_payload, '{}'::jsonb),
                               '/company?tab=staff&section=talents', p_dedupe);
end;
$$;

-- Internal: the talent starts at the company with this contract
create or replace function public.talent_hire_into(p_key text, p_company uuid, p_wage bigint, p_benefits text[], p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.talents
     set company_id = p_company, wage_cents = p_wage,
         benefits = array(select distinct unnest(coalesce(p_benefits, '{}'::text[])) order by 1),
         hired_at = p_now, paid_until = p_now,
         satisfaction_bps = public.cfg_num(public.talents_cfg(), '{satisfaction,startBps}', 7000)::integer,
         warned_at = null, resting_until = null, is_coceo = false, coceo_autonomy = 'advise', coceo_budget_cents = 0,
         coceo_spent_cents = 0, coceo_spent_day = null
   where talent_key = p_key;
end;
$$;

-- Internal: the talent leaves (quit, dismissed); rests before returning to the market. Pending offers for it end.
create or replace function public.talent_release(p_key text, p_now timestamptz, p_rest boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.talents
     set company_id = null, wage_cents = null, benefits = '{}', hired_at = null, paid_until = null, satisfaction_bps = 0,
         warned_at = null, is_coceo = false, coceo_budget_cents = 0,
         resting_until = case when p_rest then p_now + make_interval(
                           hours => public.cfg_num(public.talents_cfg(), '{market,restHours}', 12)::integer) end
   where talent_key = p_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Effect in the hourly close
-- ---------------------------------------------------------------------------
-- talentsEffectBps + talentsHourFactors: the summed, capped effect of the filled Stellen
create or replace function public.talents_hour_effect(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg jsonb := public.talents_cfg();
  v   jsonb := '{}'::jsonb;
  r   record;
  k   text;
begin
  for r in select ro ->> 'effect' as eff, sum(t.effect_bps) as bps
             from public.talents t
             join jsonb_array_elements(coalesce(cfg -> 'roles', '[]'::jsonb)) ro on ro ->> 'key' = t.role_key
            where t.company_id = p_company
            group by 1
  loop
    v := v || jsonb_build_object(r.eff, least(r.bps, public.cfg_num(cfg, array['capBps', r.eff], 0)));
  end loop;
  foreach k in array array['demand', 'capacity', 'cogs', 'fixed', 'quality', 'awareness', 'reputation', 'morale'] loop
    if not v ? k then
      v := v || jsonb_build_object(k, 0);
    end if;
  end loop;
  return jsonb_build_object('bps', v,
    'demand_factor', 1 + (v ->> 'demand')::double precision / 10000.0,
    'capacity_factor', 1 + (v ->> 'capacity')::double precision / 10000.0,
    'cogs_factor', 1 - (v ->> 'cogs')::double precision / 10000.0,
    'fixed_factor', 1 - (v ->> 'fixed')::double precision / 10000.0,
    'quality_add', (v ->> 'quality')::double precision / 10000.0);
end;
$$;

-- The terms of the hour (7300, 8300): listed companies as before; private companies get their reputation's demand
-- factor (ADR-183); both multiplied with the Fertigkeiten (ADR-194) and, ADR-199, with the Talente.
create or replace function public.listed_hour_effect(p_company uuid, p_hour_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l    public.listed_companies;
  v_df double precision := 1;
  v_r  jsonb;
  v_sk jsonb;
  v_tl jsonb;
begin
  l := public.listed_ensure(p_company);
  if l.company_id is null then
    begin
      v_df := public.company_reputation_demand_factor(
                (select pc.reputation from public.player_companies pc where pc.company_id = p_company));
    exception when others then
      v_df := 1;
    end;
    v_r := jsonb_build_object('awareness_add', 0, 'quality_add', 0, 'demand_factor', coalesce(v_df, 1), 'capacity_factor', 1,
                              'cogs_factor', 1, 'fixed_factor', 1, 'listed', false);
  else
    v_r := public.listed_hour_effect_calc(public.listed_effects(p_company), l.satisfaction, l.reputation)
           || jsonb_build_object('listed', true);
  end if;
  -- ADR-194: Fertigkeiten; a failure never stops the close
  begin
    v_sk := public.company_skills_hour_effect(p_company, p_hour_start);
    v_r := v_r || jsonb_build_object(
      'demand_factor', (v_r ->> 'demand_factor')::double precision * (v_sk ->> 'demand_factor')::double precision,
      'capacity_factor', (v_r ->> 'capacity_factor')::double precision * (v_sk ->> 'capacity_factor')::double precision,
      'cogs_factor', (v_r ->> 'cogs_factor')::double precision * (v_sk ->> 'cogs_factor')::double precision,
      'fixed_factor', (v_r ->> 'fixed_factor')::double precision * (v_sk ->> 'fixed_factor')::double precision,
      'quality_add', (v_r ->> 'quality_add')::double precision + (v_sk ->> 'quality_add')::double precision,
      'skills', v_sk);
  exception when others then
    null;
  end;
  -- ADR-199: Talente of the filled Stellen; a failure never stops the close
  begin
    v_tl := public.talents_hour_effect(p_company);
    v_r := v_r || jsonb_build_object(
      'demand_factor', (v_r ->> 'demand_factor')::double precision * (v_tl ->> 'demand_factor')::double precision,
      'capacity_factor', (v_r ->> 'capacity_factor')::double precision * (v_tl ->> 'capacity_factor')::double precision,
      'cogs_factor', (v_r ->> 'cogs_factor')::double precision * (v_tl ->> 'cogs_factor')::double precision,
      'fixed_factor', (v_r ->> 'fixed_factor')::double precision * (v_tl ->> 'fixed_factor')::double precision,
      'quality_add', (v_r ->> 'quality_add')::double precision + (v_tl ->> 'quality_add')::double precision,
      'talents', v_tl);
  exception when others then
    null;
  end;
  return v_r;
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Reads
-- ---------------------------------------------------------------------------
create or replace function public.talent_json(t public.talents, p_now timestamptz, p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'key', t.talent_key, 'role', t.role_key, 'tier', t.tier, 'first_name', t.first_name, 'last_name', t.last_name,
    'avatar', t.avatar_key, 'traits', to_jsonb(t.traits), 'wage_demand_cents', t.wage_demand_cents,
    'benefit_demands', to_jsonb(t.benefit_demands), 'min_reputation', t.min_reputation,
    'min_awareness_bps', t.min_awareness_bps, 'min_form', t.min_form, 'effect_bps', t.effect_bps,
    'status', case when t.company_id is not null and t.company_id = p_company then 'mine' else public.talent_status(t, p_now) end,
    'employer', case when t.company_id is not null then
                  jsonb_build_object('company_id', t.company_id, 'name', (select c.name from public.companies c where c.id = t.company_id)) end,
    'poach_min_cost_cents', case when t.company_id is not null then public.talent_poach_min_cost(t) end,
    'offer_pending', exists (select 1 from public.talent_offers o where o.talent_key = t.talent_key and o.status = 'pending'),
    'resting_until', case when t.resting_until > p_now then t.resting_until end,
    'is_coceo', t.is_coceo);
$$;

create or replace function public.talent_own_json(t public.talents, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.talent_json(t, p_now, t.company_id) || jsonb_build_object(
    'wage_cents', t.wage_cents, 'benefits', to_jsonb(t.benefits),
    'cost_cents', public.talent_offer_cost(t.wage_cents, t.benefits),
    'hired_at', t.hired_at, 'satisfaction_bps', t.satisfaction_bps, 'warned', t.warned_at is not null,
    'coceo_autonomy', t.coceo_autonomy, 'coceo_budget_cents', t.coceo_budget_cents,
    'coceo_spent_cents', case when t.coceo_spent_day = (p_now at time zone 'Europe/Berlin')::date then t.coceo_spent_cents else 0 end);
$$;

create or replace function public.talent_my_company(p_player uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pc.company_id from public.player_companies pc where pc.founder_id = p_player and pc.status = 'active' limit 1;
$$;

create or replace function public.get_talent_market(p_role text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_co     uuid;
  v_now    timestamptz := public.game_now();
begin
  perform public.talents_ensure();
  v_co := public.talent_my_company(v_player);
  return jsonb_build_object(
    'company_id', v_co,
    'facts', case when v_co is not null then public.talent_company_facts(v_co) end,
    'talents', coalesce((select jsonb_agg(public.talent_json(t, v_now, v_co) order by t.role_key, t.tier desc, t.talent_key)
                           from public.talents t where p_role is null or t.role_key = p_role), '[]'::jsonb));
end;
$$;
comment on function public.get_talent_market(text) is 'RPC: the talent market (ADR-199), one Stelle or all.';

create or replace function public.company_talents_json(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg   jsonb := public.talents_cfg();
  v_now timestamptz := public.game_now();
  v_out jsonb := '[]'::jsonb;
  ro    jsonb;
  t     public.talents;
begin
  for ro in select x from jsonb_array_elements(coalesce(cfg -> 'roles', '[]'::jsonb)) x loop
    t := null;
    select * into t from public.talents x where x.company_id = p_company and x.role_key = ro ->> 'key';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'role', ro ->> 'key', 'effect', ro ->> 'effect',
      'talent', case when t.talent_key is not null then public.talent_own_json(t, v_now) end));
  end loop;
  return jsonb_build_object(
    'company_id', p_company,
    'facts', public.talent_company_facts(p_company),
    'seats', v_out,
    'effect', public.talents_hour_effect(p_company),
    'cap_bps', coalesce(cfg -> 'capBps', '{}'::jsonb),
    'coceo_max', coalesce((cfg #>> '{coCeo,max}')::integer, 2),
    'incoming', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', o.id, 'talent_key', o.talent_key, 'from_name', (select c.name from public.companies c where c.id = o.from_company),
                    'wage_cents', o.wage_cents, 'benefits', to_jsonb(o.benefits), 'cost_cents', o.cost_cents, 'expires_at', o.expires_at)
                    order by o.expires_at)
                  from public.talent_offers o where o.to_company = p_company and o.status = 'pending'), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', o.id, 'talent_key', o.talent_key, 'to_name', (select c.name from public.companies c where c.id = o.to_company),
                    'cost_cents', o.cost_cents, 'expires_at', o.expires_at) order by o.expires_at)
                  from public.talent_offers o where o.from_company = p_company and o.status = 'pending'), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', e.id, 'talent_key', e.talent_key, 'kind', e.kind, 'payload', e.payload, 'cost_cents', e.cost_cents,
                    'reversible', e.reversible and e.undone_at is null, 'created_at', e.created_at) order by e.id desc)
                  from (select * from public.talent_events x where x.company_id = p_company order by x.id desc limit 20) e), '[]'::jsonb));
end;
$$;

create or replace function public.get_company_talents()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_co     uuid;
begin
  perform public.talents_ensure();
  v_co := public.talent_my_company(v_player);
  if v_co is null then
    perform public.api_error('company_not_found');
  end if;
  return public.company_talents_json(v_co);
end;
$$;
comment on function public.get_company_talents() is 'RPC: the 15 Stellen of the own company with their talents (ADR-199).';

-- ---------------------------------------------------------------------------
-- E. Writes
-- ---------------------------------------------------------------------------
create or replace function public.talent_offer(p_request_id uuid, p_talent_key text, p_wage_cents bigint, p_benefits text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  cfg      jsonb := public.talents_cfg();
  v_co     uuid;
  t        public.talents;
  v_now    timestamptz := public.game_now();
  v_ben    text[];
  v_checks jsonb;
  v_cost   bigint;
  v_min    bigint;
  v_offer  uuid;
  v_status text;
begin
  v_player := public.require_player();
  if p_request_id is null or p_talent_key is null or p_wage_cents is null or p_wage_cents <= 0 or p_wage_cents % 100 <> 0 then
    perform public.api_error('invalid_argument');
  end if;
  v_ben := array(select distinct b from unnest(coalesce(p_benefits, '{}'::text[])) b
                  where coalesce(cfg -> 'benefitCostBps', '{}'::jsonb) ? b order by 1);
  if cardinality(v_ben) <> (select count(distinct b) from unnest(coalesce(p_benefits, '{}'::text[])) b) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'talent_offer');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.talents_ensure();
  v_co := public.talent_my_company(v_player);
  if v_co is null then
    perform public.api_error('company_not_found');
  end if;
  perform 1 from public.player_companies where company_id = v_co for update;
  select * into t from public.talents where talent_key = p_talent_key for update;
  if t.talent_key is null then
    perform public.api_error('invalid_argument');
  end if;
  if t.company_id = v_co then
    perform public.api_error('already_hired');
  end if;
  if exists (select 1 from public.talents x where x.company_id = v_co and x.role_key = t.role_key) then
    perform public.api_error('seat_taken');
  end if;
  v_checks := public.talent_check_offer(t, p_wage_cents, v_ben, public.talent_company_facts(v_co));
  v_cost := public.talent_offer_cost(p_wage_cents, v_ben);
  if t.company_id is null then
    v_status := public.talent_status(t, v_now);
    if v_status <> 'available' then
      perform public.api_error('not_available');
    end if;
    if not public.talent_checks_ok(v_checks) then
      perform public.api_error('demands_not_met');
    end if;
    perform public.talent_hire_into(t.talent_key, v_co, p_wage_cents, v_ben, v_now);
    perform public.talent_log(v_co, t.talent_key, 'hired',
      jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'tier', t.tier, 'wage_cents', p_wage_cents));
    return public.request_complete(v_player, p_request_id,
             public.company_talents_json(v_co) || jsonb_build_object('result', 'hired', 'talent_key', t.talent_key));
  end if;
  -- poaching from another player company
  if exists (select 1 from public.talent_offers o where o.talent_key = t.talent_key and o.status = 'pending') then
    perform public.api_error('offer_pending');
  end if;
  if not public.talent_checks_ok(v_checks) then
    perform public.api_error('demands_not_met');
  end if;
  v_min := public.talent_poach_min_cost(t);
  if v_cost < v_min then
    perform public.api_error('offer_too_low');
  end if;
  insert into public.talent_offers (talent_key, from_company, to_company, wage_cents, benefits, cost_cents, expires_at, created_by)
  values (t.talent_key, v_co, t.company_id, p_wage_cents, v_ben, v_cost,
          v_now + make_interval(mins => public.cfg_num(cfg, '{poach,counterMinutes}', 15)::integer), v_player)
  returning id into v_offer;
  perform public.talent_notify_founder(t.company_id, 'Abwerbeversuch',
    (select c.name from public.companies c where c.id = v_co) || ' will ' || public.talent_name(t)
      || ' abwerben. Du kannst innerhalb von ' || public.cfg_num(cfg, '{poach,counterMinutes}', 15)::integer
      || ' Minuten nachbessern.',
    jsonb_build_object('offer_id', v_offer, 'talent_key', t.talent_key), 'talent:poach:' || v_offer::text);
  return public.request_complete(v_player, p_request_id,
           public.company_talents_json(v_co) || jsonb_build_object('result', 'pending', 'talent_key', t.talent_key,
                                                                   'offer_id', v_offer));
end;
$$;
comment on function public.talent_offer(uuid, text, bigint, text[]) is
  'RPC: offer to a talent (ADR-199): hires a free one when all demands are met, opens a poaching offer for one of '
  'another player company. Errors demands_not_met, offer_too_low, offer_pending, seat_taken, not_available.';

-- The owner answers a poaching offer: the new contract must cost at least as much as the poacher's offer
create or replace function public.talent_counter(p_request_id uuid, p_offer_id uuid, p_wage_cents bigint, p_benefits text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_co     uuid;
  o        public.talent_offers;
  t        public.talents;
  v_ben    text[];
  v_now    timestamptz := public.game_now();
begin
  v_player := public.require_player();
  if p_request_id is null or p_offer_id is null or p_wage_cents is null or p_wage_cents <= 0 or p_wage_cents % 100 <> 0 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'talent_counter');
  if v_replay is not null then
    return v_replay;
  end if;
  v_co := public.talent_my_company(v_player);
  select * into o from public.talent_offers where id = p_offer_id for update;
  if o.id is null or v_co is null or o.to_company is distinct from v_co then
    perform public.api_error('invalid_argument');
  end if;
  if o.status <> 'pending' or o.expires_at <= v_now then
    perform public.api_error('offer_closed');
  end if;
  select * into t from public.talents where talent_key = o.talent_key for update;
  v_ben := array(select distinct b from unnest(coalesce(p_benefits, '{}'::text[])) b
                  where coalesce(public.talents_cfg() -> 'benefitCostBps', '{}'::jsonb) ? b order by 1);
  if p_wage_cents < t.wage_demand_cents or not (t.benefit_demands <@ v_ben)
     or public.talent_offer_cost(p_wage_cents, v_ben) < o.cost_cents then
    perform public.api_error('offer_too_low');
  end if;
  update public.talents
     set wage_cents = p_wage_cents, benefits = v_ben,
         satisfaction_bps = least(10000, satisfaction_bps
                                 + public.cfg_num(public.talents_cfg(), '{satisfaction,counterBonusBps}', 1000)::integer),
         warned_at = null
   where talent_key = t.talent_key;
  update public.talent_offers set status = 'countered', settled_at = v_now where id = o.id;
  perform public.talent_log(v_co, t.talent_key, 'countered',
    jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'wage_cents', p_wage_cents));
  perform public.talent_notify_founder(o.from_company, 'Abwerben gescheitert',
    public.talent_name(t) || ' bleibt: der Arbeitgeber hat nachgebessert.',
    jsonb_build_object('offer_id', o.id, 'talent_key', t.talent_key), 'talent:countered:' || o.id::text);
  return public.request_complete(v_player, p_request_id, public.company_talents_json(v_co));
end;
$$;
comment on function public.talent_counter(uuid, uuid, bigint, text[]) is
  'RPC: counter-offer of the current employer within poach.counterMinutes (ADR-199). Errors offer_closed, offer_too_low.';

create or replace function public.talent_dismiss(p_request_id uuid, p_talent_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_co     uuid;
  t        public.talents;
begin
  v_player := public.require_player();
  if p_request_id is null or p_talent_key is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'talent_dismiss');
  if v_replay is not null then
    return v_replay;
  end if;
  v_co := public.talent_my_company(v_player);
  select * into t from public.talents where talent_key = p_talent_key for update;
  if v_co is null or t.company_id is distinct from v_co then
    perform public.api_error('invalid_argument');
  end if;
  perform public.talent_release(t.talent_key, public.game_now(), true);
  perform public.talent_log(v_co, t.talent_key, 'dismissed', jsonb_build_object('name', public.talent_name(t), 'role', t.role_key));
  return public.request_complete(v_player, p_request_id, public.company_talents_json(v_co));
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Background: offers, wages, satisfaction, quitting
-- ---------------------------------------------------------------------------
-- Expired poaching offers: the talent moves when the poacher still meets every demand and the seat is free
create or replace function public.talent_offers_settle(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o    public.talent_offers;
  t    public.talents;
  v_n  integer := 0;
begin
  for o in select * from public.talent_offers where status = 'pending' and expires_at <= p_now order by expires_at for update skip locked loop
    select * into t from public.talents where talent_key = o.talent_key for update;
    if exists (select 1 from public.player_companies pc where pc.company_id = o.from_company and pc.status = 'active')
       and not exists (select 1 from public.talents x where x.company_id = o.from_company and x.role_key = t.role_key)
       and public.talent_checks_ok(public.talent_check_offer(t, o.wage_cents, o.benefits, public.talent_company_facts(o.from_company)))
       and (t.company_id is null or t.company_id = o.to_company) then
      if t.company_id is not null then
        perform public.talent_log(t.company_id, t.talent_key, 'poached',
          jsonb_build_object('name', public.talent_name(t), 'role', t.role_key,
                             'to_name', (select c.name from public.companies c where c.id = o.from_company)));
        perform public.talent_notify_founder(t.company_id, 'Talent abgeworben',
          public.talent_name(t) || ' wechselt zu ' || (select c.name from public.companies c where c.id = o.from_company) || '.',
          jsonb_build_object('talent_key', t.talent_key), 'talent:poached:' || o.id::text);
      end if;
      perform public.talent_hire_into(t.talent_key, o.from_company, o.wage_cents, o.benefits, p_now);
      perform public.talent_log(o.from_company, t.talent_key, 'hired',
        jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'tier', t.tier, 'wage_cents', o.wage_cents,
                           'poached', true));
      perform public.talent_notify_founder(o.from_company, 'Talent gewonnen',
        public.talent_name(t) || ' fängt bei dir an.', jsonb_build_object('talent_key', t.talent_key),
        'talent:won:' || o.id::text);
      update public.talent_offers set status = 'accepted', settled_at = p_now where id = o.id;
    else
      update public.talent_offers set status = 'failed', settled_at = p_now where id = o.id;
      perform public.talent_notify_founder(o.from_company, 'Abwerben gescheitert',
        public.talent_name(t) || ' kommt nicht: Forderungen beim Wechsel nicht mehr erfüllt.',
        jsonb_build_object('talent_key', t.talent_key), 'talent:failed:' || o.id::text);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- One full hour of one talent: wage and benefits through the ledger, satisfaction, warning, quitting
create or replace function public.talent_hour(p_key text, p_hour_start timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.talents_cfg();
  t       public.talents;
  pc      public.player_companies;
  v_facts jsonb;
  v_cost  bigint;
  v_free  bigint;
  v_paid  boolean;
  v_morale double precision;
  v_dec   double precision := 1;
  v_loss  double precision := 0;
  v_sat   integer;
  tr      text;
begin
  select * into t from public.talents where talent_key = p_key for update;
  if t.company_id is null then
    return 'gone';
  end if;
  select * into pc from public.player_companies where company_id = t.company_id;
  if pc.company_id is null or pc.status <> 'active' then
    perform public.talent_release(t.talent_key, p_hour_start + interval '1 hour', true);
    return 'gone';
  end if;
  v_cost := public.talent_offer_cost(t.wage_cents, t.benefits);
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a where a.owner_company_id = t.company_id and a.kind = 'company_cash' for update;
  v_paid := coalesce(v_free, 0) >= v_cost;
  if v_paid and v_cost > 0 then
    perform public.ledger_transfer(public.company_cash_account(t.company_id), public.ledger_system_account('households'),
                                   v_cost, 'company_costs', 'Talent: ' || public.talent_name(t), 'company', t.company_id,
                                   'talent_wage:' || t.talent_key || ':' || t.company_id::text || ':'
                                     || extract(epoch from p_hour_start)::bigint::text, pc.founder_id);
  end if;
  v_facts := public.talent_company_facts(t.company_id);
  -- talentSatisfactionStep
  foreach tr in array t.traits loop
    v_dec := v_dec * coalesce((select (x ->> 'decayPct')::double precision
                                 from jsonb_array_elements(coalesce(cfg -> 'traits', '[]'::jsonb)) x where x ->> 'key' = tr), 100) / 100.0;
  end loop;
  if not v_paid then v_loss := v_loss + public.cfg_num(cfg, '{satisfaction,unpaidBps}', 2500); end if;
  if (v_facts ->> 'reputation')::double precision < t.min_reputation then
    v_loss := v_loss + public.cfg_num(cfg, '{satisfaction,reputationBps}', 800);
  end if;
  if (v_facts ->> 'awareness_bps')::integer < t.min_awareness_bps then
    v_loss := v_loss + public.cfg_num(cfg, '{satisfaction,awarenessBps}', 400);
  end if;
  if not (t.benefit_demands <@ t.benefits) then
    v_loss := v_loss + public.cfg_num(cfg, '{satisfaction,benefitBps}', 600);
  end if;
  v_morale := case when t.role_key = 'hr' then 0
                   else (public.talents_hour_effect(t.company_id) #>> '{bps,morale}')::double precision end;
  v_sat := greatest(0, least(10000, t.satisfaction_bps
             + case when v_loss > 0 then -round(v_loss * v_dec)::integer else public.cfg_num(cfg, '{satisfaction,gainBps}', 250)::integer end
             + greatest(0, coalesce(v_morale, 0))::integer));
  insert into public.talent_hours (talent_key, hour_start, company_id, cost_cents, paid, satisfaction_bps)
  values (t.talent_key, p_hour_start, t.company_id, v_cost, v_paid, v_sat)
  on conflict do nothing;
  update public.talents set satisfaction_bps = v_sat, paid_until = p_hour_start + interval '1 hour' where talent_key = t.talent_key;
  if v_sat <= public.cfg_num(cfg, '{satisfaction,quitBps}', 1000) then
    perform public.talent_release(t.talent_key, p_hour_start + interval '1 hour', true);
    perform public.talent_log(t.company_id, t.talent_key, 'quit',
      jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'paid', v_paid));
    perform public.talent_notify_founder(t.company_id, 'Kündigung', public.talent_name(t) || ' hat gekündigt.',
      jsonb_build_object('talent_key', t.talent_key), 'talent:quit:' || t.talent_key || ':' || extract(epoch from p_hour_start)::bigint::text);
    return 'quit';
  end if;
  if v_sat < public.cfg_num(cfg, '{satisfaction,warnBps}', 3500) and t.warned_at is null then
    update public.talents set warned_at = p_hour_start + interval '1 hour' where talent_key = t.talent_key;
    perform public.talent_log(t.company_id, t.talent_key, 'warned',
      jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'satisfaction_bps', v_sat, 'paid', v_paid));
    perform public.talent_notify_founder(t.company_id, 'Talent unzufrieden',
      public.talent_name(t) || ' ist unzufrieden und denkt über eine Kündigung nach.',
      jsonb_build_object('talent_key', t.talent_key), 'talent:warn:' || t.talent_key || ':' || extract(epoch from p_hour_start)::bigint::text);
  elsif v_sat >= public.cfg_num(cfg, '{satisfaction,warnBps}', 3500) then
    update public.talents set warned_at = null where talent_key = t.talent_key and warned_at is not null;
  end if;
  return case when v_paid then 'paid' else 'unpaid' end;
end;
$$;

-- Marketing (awareness) and Recht (reputation) once per company and hour, capped
create or replace function public.talent_company_hour(p_company uuid, p_hour_start timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bps jsonb := public.talents_hour_effect(p_company) -> 'bps';
  v_aw  double precision := coalesce((v_bps ->> 'awareness')::double precision, 0) / 10000.0;
  v_rp  double precision := coalesce((v_bps ->> 'reputation')::double precision, 0) / 100.0;
  v_ok  boolean;
begin
  if v_aw <= 0 and v_rp <= 0 then
    return;
  end if;
  insert into public.talent_company_hours (company_id, hour_start, awareness, reputation)
  values (p_company, p_hour_start, v_aw, v_rp)
  on conflict do nothing
  returning true into v_ok;
  if not coalesce(v_ok, false) then
    return;
  end if;
  if v_aw > 0 then
    perform public.company_awareness_add(p_company, 'talents', v_aw);
  end if;
  if v_rp > 0 then
    perform public.company_reputation_bump(p_company, v_rp);
  end if;
end;
$$;

-- Hook of the Mit-Geschäftsführung (8910 replaces it)
create or replace function public.talents_coceo_run(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return 0;
end;
$$;

create or replace function public.talents_run_due(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now   timestamptz := coalesce(p_now, public.game_now());
  r       record;
  v_hour  timestamptz;
  v_n     integer := 0;
  v_off   integer := 0;
  v_co    integer := 0;
  v_res   text;
  v_steps integer;
begin
  perform public.talents_ensure();
  v_off := public.talent_offers_settle(v_now);
  for r in select t.talent_key, t.company_id from public.talents t
            where t.company_id is not null and t.paid_until + interval '1 hour' <= v_now
            order by t.paid_until
  loop
    v_steps := 0;
    loop
      select t.paid_until into v_hour from public.talents t where t.talent_key = r.talent_key and t.company_id = r.company_id;
      exit when v_hour is null or v_hour + interval '1 hour' > v_now or v_steps >= 48;
      begin
        v_res := public.talent_hour(r.talent_key, v_hour);
      exception when others then
        perform public.job_run_warn('talent_hour', r.talent_key || ': ' || sqlerrm);
        exit;
      end;
      perform public.talent_company_hour(r.company_id, date_trunc('hour', v_hour));
      v_n := v_n + 1;
      v_steps := v_steps + 1;
      exit when v_res in ('quit', 'gone');
    end loop;
  end loop;
  begin
    v_co := public.talents_coceo_run(v_now);
  exception when others then
    perform public.job_run_warn('talents_coceo', sqlerrm);
  end;
  return jsonb_build_object('hours', v_n, 'offers', v_off, 'coceo', v_co);
end;
$$;

-- warning row in job_runs (as company_hour_step); missing table: ignore
create or replace function public.job_run_warn(p_job text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.job_runs (job_name, run_key, status, finished_at, error)
    values (p_job, gen_random_uuid()::text, 'failed', now(), left(p_message, 500));
  exception when others then
    raise warning '%: %', p_job, p_message;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Grants and schedule
-- ---------------------------------------------------------------------------
do $do$
declare
  f text;
begin
  foreach f in array array['public.talents_cfg()', 'public.talents_ensure()', 'public.talent_trait_num(text[], text)',
                           'public.talent_offer_cost(bigint, text[])', 'public.talent_form_rank(uuid)',
                           'public.talent_company_facts(uuid)',
                           'public.talent_check_offer(public.talents, bigint, text[], jsonb)', 'public.talent_checks_ok(jsonb)',
                           'public.talent_poach_min_cost(public.talents)', 'public.talent_status(public.talents, timestamptz)',
                           'public.talent_name(public.talents)', 'public.talent_log(uuid, text, text, jsonb, bigint, boolean)',
                           'public.talent_notify_founder(uuid, text, text, jsonb, text)',
                           'public.talent_hire_into(text, uuid, bigint, text[], timestamptz)',
                           'public.talent_release(text, timestamptz, boolean)', 'public.talents_hour_effect(uuid)',
                           'public.listed_hour_effect(uuid, timestamptz)',
                           'public.talent_json(public.talents, timestamptz, uuid)', 'public.talent_own_json(public.talents, timestamptz)',
                           'public.talent_my_company(uuid)', 'public.company_talents_json(uuid)',
                           'public.talent_offers_settle(timestamptz)', 'public.talent_hour(text, timestamptz)',
                           'public.talent_company_hour(uuid, timestamptz)', 'public.talents_coceo_run(timestamptz)',
                           'public.talents_run_due(timestamptz)', 'public.job_run_warn(text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.get_talent_market(text)', 'public.get_company_talents()',
                           'public.talent_offer(uuid, text, bigint, text[])', 'public.talent_counter(uuid, uuid, bigint, text[])',
                           'public.talent_dismiss(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-talents';
    perform cron.schedule('nexa-talents', '* * * * *', 'select public.talents_run_due()');
  end if;
end;
$do$;
