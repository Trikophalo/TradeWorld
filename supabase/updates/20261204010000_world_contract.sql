-- ===== idempotent copy of migrations/20261204010000_world_contract.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 10000 · Weltkarte: locations and country config, the shared contract (ADR-208)
-- =============================================================================
-- From a company value of world.unlockWorthCents (company_worth_cents, ADR-203) a player company places its
-- headquarters in one of the countries of game_config "world".countries (src/config/countries.ts). This migration
-- holds only what other parts read (taxes and external events, ADR-209):
--   company_locations       one row per placed company: country, headquarters tier and style, money invested
--   world_cfg()             game_config "world"
--   country_cfg(country)    the traits of one country (jsonb from the config), null when unknown
--   company_country(company) the country of the headquarters, null when not placed
--   country_market_leader(country) the leading player company of a country (largest company_worth_cents, at least
--                           lobby.minWorthCents), null when none; AI companies never lead
--   company_is_market_leader(company)
-- The signatures are a contract: keep them exactly. Idempotent (if not exists, create or replace).
-- =============================================================================

create table if not exists public.company_locations (
  company_id     uuid primary key references public.companies(id) on delete cascade,
  country_key    text not null,
  placed_at      timestamptz not null default now(),
  hq_tier        smallint not null default 1 check (hq_tier between 1 and 10),
  hq_style       jsonb not null default '{}'::jsonb,
  invested_cents bigint not null default 0 check (invested_cents >= 0),
  moved_at       timestamptz,
  updated_at     timestamptz not null default now()
);
create index if not exists company_locations_country_idx on public.company_locations (country_key);
comment on table public.company_locations is
  'Headquarters of a player company on the world map (ADR-208): country, tier (1..5), style of the pixel building, '
  'money paid for it (base of the relocation price). Readable by every signed-in player (the map shows all).';
alter table public.company_locations enable row level security;
drop policy if exists company_locations_read on public.company_locations;
create policy company_locations_read on public.company_locations for select to authenticated using (true);
revoke insert, update, delete on public.company_locations from anon, authenticated;
drop trigger if exists set_updated_at on public.company_locations;
create trigger set_updated_at before update on public.company_locations
  for each row execute function public.set_updated_at();

create or replace function public.world_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('world'), '{}'::jsonb);
$$;
comment on function public.world_cfg() is 'game_config "world" (ADR-208, src/config/countries.ts).';

create or replace function public.country_cfg(p_country text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select x.c from jsonb_array_elements(coalesce(public.config_jsonb('world', '{countries}'), '[]'::jsonb)) x(c)
   where x.c ->> 'key' = p_country
   limit 1;
$$;
comment on function public.country_cfg(text) is
  'Traits of a country (ADR-208): key, name, map, productionCostBps, labourCostBps, demandPotentialBps, imageBps, '
  'taxRateBps, politicalRisk, tariffExposure, disasterRisk[], warRisk. Null for an unknown key. Contract with ADR-209.';

create or replace function public.company_country(p_company uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select l.country_key from public.company_locations l where l.company_id = p_company;
$$;
comment on function public.company_country(uuid) is
  'Country of the headquarters of a company (ADR-208), null when not placed. Contract with ADR-209.';

create or replace function public.country_market_leader(p_country text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select x.company_id
    from (select l.company_id, public.company_worth_cents(l.company_id) as worth, l.placed_at
            from public.company_locations l
            join public.player_companies pc on pc.company_id = l.company_id and pc.status = 'active'
           where l.country_key = p_country) x
   where x.worth >= coalesce((public.config_jsonb('world', '{lobby,minWorthCents}'))::bigint, 0)
   order by x.worth desc, x.placed_at, x.company_id
   limit 1;
$$;
comment on function public.country_market_leader(text) is
  'Marktführer of a country (ADR-208): the active player company with the largest company_worth_cents among those '
  'with their headquarters there (at least lobby.minWorthCents; ties: placed first). Null when none.';

create or replace function public.company_is_market_leader(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.country_market_leader(public.company_country(p_company)) = p_company, false);
$$;
comment on function public.company_is_market_leader(uuid) is
  'Whether a company leads the country of its headquarters (lobby bonus, ADR-208). Contract with ADR-209.';

revoke all on function public.world_cfg() from public, anon, authenticated;
revoke all on function public.country_cfg(text) from public, anon, authenticated;
revoke all on function public.company_country(uuid) from public, anon, authenticated;
revoke all on function public.country_market_leader(text) from public, anon, authenticated;
revoke all on function public.company_is_market_leader(uuid) from public, anon, authenticated;
