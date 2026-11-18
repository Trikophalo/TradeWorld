-- ===== idempotent copy of migrations/20261204011320_player_stock_tiers.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 011320 · Player stocks climb out of the penny stock class (ADR-218)
-- =============================================================================
-- The owner: "Und man soll auch höher kommen als nur eine Pennystock-Aktie."
--
-- Every player stock was listed as 'penny' (ipo_escrow) and stayed there for good: the deepest slippage
-- (playerImpact.depthCentsPer100Bps.penny: 1.000 € move the price 1 %), the widest spread and the strongest noise, even
-- for a company worth billions. Now companies.tier of a listed player company follows its market cap
-- (company_worth_cents, ADR-203) on the ladder trading.playerStockTiers (src/lib/sim/stock-tier.ts):
--   penny (0) → smallcap (50 Mio. €) → midcap (200 Mio. €) → largecap (1 Mrd. €) → bluechip (3 Mrd. €)
-- Up to the highest rung reached; down one rung only below 80 % of the own threshold (hysteresis); at least 6 hours
-- between two changes. player_stock_tiers_run() checks every 10 minutes (cron nexa-player-stock-tiers), writes the new
-- tier, posts stock news (Mr. Doodle reads news_items) and notifies the founder ('stock_tier').
--
-- Every lookup keyed by companies.tier reads the new keys from game_config (impact depth in market_order_plan and the
-- tick, half spread, tick noise, AI weight, borrow fee), so no market function is rewritten.
--
-- NULL tier made explicit: the order plan and the tick read a missing tier as 'midcap'. A trigger now gives every
-- player company with a security an explicit tier ('penny' until the first check), and existing rows are repaired.
-- New enum values (011300) are used only inside PL/pgSQL bodies, cast from text at run time.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. State
-- ---------------------------------------------------------------------------
create table if not exists public.player_stock_tiers (
  company_id        uuid primary key references public.companies (id) on delete cascade,
  tier              text not null,
  changed_at        timestamptz,
  checked_at        timestamptz not null default now(),
  market_cap_cents  bigint not null default 0,
  peak_tier         text not null
);
alter table public.player_stock_tiers enable row level security;
revoke all on public.player_stock_tiers from public, anon, authenticated;
comment on table public.player_stock_tiers is
  'Stock tier of each listed player company (ADR-218): last change (hysteresis clock), last check, highest tier. Internal.';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('stock_tier', 'company', 'Aktienklasse', 'Deine Aktie steigt in eine höhere Klasse auf oder fällt zurück.',
        'notif_company', true, true, false, 216)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. No player stock without an explicit tier
-- ---------------------------------------------------------------------------
create or replace function public.company_player_tier_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_ai and new.security_id is not null and new.tier is null then
    new.tier := 'penny';
  end if;
  return new;
end;
$$;
comment on function public.company_player_tier_guard() is
  'Trigger (ADR-218): a player company with a security always has an explicit stock tier (penny until the first check).';

drop trigger if exists company_player_tier_guard on public.companies;
create trigger company_player_tier_guard
  before insert or update of tier, security_id on public.companies
  for each row execute function public.company_player_tier_guard();

update public.companies set tier = 'penny' where not is_ai and security_id is not null and tier is null;

-- ---------------------------------------------------------------------------
-- C. Rules (src/lib/sim/stock-tier.ts)
-- ---------------------------------------------------------------------------
create or replace function public.player_stock_tier_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.config_jsonb('trading', '{playerStockTiers}'),
                  '{"ladder": [{"tier": "penny", "minMarketCapCents": 0, "label": "Pennystock"}], "downBps": 8000,
                    "minHoursBetweenChanges": 6, "checkEveryMinutes": 10}'::jsonb);
$$;

-- nextStockTier: up to the highest rung reached, down one rung below downBps of the own threshold, nothing within
-- minHoursBetweenChanges of the last change (null hours = never changed). An unknown tier counts as the bottom rung.
create or replace function public.player_stock_tier_next(p_current text, p_cap numeric, p_hours double precision, p_cfg jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ladder jsonb := coalesce(p_cfg -> 'ladder', '[]'::jsonb);
  v_n      integer := jsonb_array_length(coalesce(p_cfg -> 'ladder', '[]'::jsonb));
  v_rung   integer;
  v_up     integer;
begin
  if v_n = 0 then
    return coalesce(p_current, 'penny');
  end if;
  select (x.n - 1)::integer into v_rung from jsonb_array_elements(v_ladder) with ordinality x(r, n) where x.r ->> 'tier' = p_current;
  v_rung := coalesce(v_rung, 0);
  if p_current is not null and p_hours is not null
     and p_hours < coalesce((p_cfg ->> 'minHoursBetweenChanges')::double precision, 6) then
    return v_ladder -> v_rung ->> 'tier';
  end if;
  v_up := v_rung;
  while v_up + 1 < v_n and coalesce(p_cap, 0) >= (v_ladder -> (v_up + 1) ->> 'minMarketCapCents')::numeric loop
    v_up := v_up + 1;
  end loop;
  if v_up > v_rung then
    return v_ladder -> v_up ->> 'tier';
  end if;
  if v_rung > 0 and coalesce(p_cap, 0) < (v_ladder -> v_rung ->> 'minMarketCapCents')::numeric
                                         * coalesce((p_cfg ->> 'downBps')::numeric, 8000) / 10000 then
    return v_ladder -> (v_rung - 1) ->> 'tier';
  end if;
  return v_ladder -> v_rung ->> 'tier';
end;
$$;
comment on function public.player_stock_tier_next(text, numeric, double precision, jsonb) is
  'nextStockTier (ADR-218): the stock tier after a check, with hysteresis and the minimum time between changes.';

create or replace function public.player_stock_tier_rung(p_tier text, p_cfg jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce((select (x.n - 1)::integer from jsonb_array_elements(coalesce(p_cfg -> 'ladder', '[]'::jsonb))
                                                  with ordinality x(r, n) where x.r ->> 'tier' = p_tier), 0);
$$;

create or replace function public.player_stock_tier_label(p_tier text, p_cfg jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce((select x.r ->> 'label' from jsonb_array_elements(coalesce(p_cfg -> 'ladder', '[]'::jsonb)) x(r)
                    where x.r ->> 'tier' = p_tier), p_tier);
$$;

-- ---------------------------------------------------------------------------
-- D. The periodic check
-- ---------------------------------------------------------------------------
create or replace function public.player_stock_tiers_run(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := coalesce(p_now, now());
  v_cfg     jsonb := public.player_stock_tier_cfg();
  r         record;
  v_cap     bigint;
  v_hours   double precision;
  v_next    text;
  v_up      boolean;
  v_label   text;
  v_head    text;
  v_body    text;
  v_checked integer := 0;
  v_changed integer := 0;
begin
  for r in select c.id, c.name, c.tier::text as tier, c.security_id, c.sector_key, pc.founder_id,
                  st.changed_at, st.peak_tier
             from public.companies c
             join public.player_companies pc on pc.company_id = c.id
             left join public.player_stock_tiers st on st.company_id = c.id
            where not c.is_ai and c.phase = 'listed' and c.security_id is not null
            order by c.id
  loop
    v_checked := v_checked + 1;
    v_cap := greatest(0, coalesce(public.company_worth_cents(r.id), 0));
    v_hours := case when r.changed_at is null then null else extract(epoch from (v_now - r.changed_at)) / 3600.0 end;
    v_next := public.player_stock_tier_next(r.tier, v_cap, v_hours, v_cfg);
    insert into public.player_stock_tiers (company_id, tier, changed_at, checked_at, market_cap_cents, peak_tier)
    values (r.id, coalesce(r.tier, v_next), null, v_now, v_cap, coalesce(r.tier, v_next))
    on conflict (company_id) do update set checked_at = excluded.checked_at, market_cap_cents = excluded.market_cap_cents;
    continue when v_next is not distinct from r.tier;

    v_up := public.player_stock_tier_rung(v_next, v_cfg) > public.player_stock_tier_rung(r.tier, v_cfg);
    update public.companies set tier = v_next::public.company_tier, updated_at = now() where id = r.id;
    update public.player_stock_tiers
       set tier = v_next, changed_at = v_now,
           peak_tier = case when public.player_stock_tier_rung(v_next, v_cfg) > public.player_stock_tier_rung(peak_tier, v_cfg)
                            then v_next else peak_tier end
     where company_id = r.id;
    v_changed := v_changed + 1;

    v_label := public.player_stock_tier_label(v_next, v_cfg);
    if v_up then
      v_head := r.name || ' steigt in den ' || v_label || ' auf';
      v_body := 'Börsenwert ' || public.format_eur(v_cap) || ': Die Aktie spielt jetzt in einer höheren Klasse. '
                || 'Große Orders bewegen den Kurs weniger, mehr Anleger schauen hin.';
    else
      v_head := r.name || ' fällt zurück in den ' || v_label;
      v_body := 'Börsenwert ' || public.format_eur(v_cap) || ': Die Aktie verliert ihre Klasse. '
                || 'Orders bewegen den Kurs wieder stärker.';
    end if;
    -- stock news (Mr. Doodle reads news_items)
    insert into public.news_items (category, headline, body, importance, security_id, company_id, sector_key, published_at)
    values ('market', v_head, v_body, case when v_up then 2 else 1 end, r.security_id, r.id, r.sector_key, v_now);
    perform public.social_notify(r.founder_id, 'stock_tier', v_head, v_body,
                                 jsonb_build_object('company_id', r.id, 'tier', v_next, 'up', v_up, 'market_cap_cents', v_cap),
                                 '/company', 'stock_tier:' || r.id::text || ':' || v_next || ':' || to_char(v_now, 'YYYYMMDDHH24MI'));
    perform public.company_system_message(r.id, v_head || '.');
  end loop;
  return jsonb_build_object('checked', v_checked, 'changed', v_changed);
end;
$$;
comment on function public.player_stock_tiers_run(timestamptz) is
  'Internal, cron every 10 minutes (ADR-218): stock tier of every listed player company from its market cap, with '
  'hysteresis; on a change: companies.tier, stock news and a note to the founder.';

-- ---------------------------------------------------------------------------
-- E. Grants and the cron job
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.company_player_tier_guard()', 'public.player_stock_tier_cfg()',
    'public.player_stock_tier_next(text, numeric, double precision, jsonb)', 'public.player_stock_tier_rung(text, jsonb)',
    'public.player_stock_tier_label(text, jsonb)', 'public.player_stock_tiers_run(timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  grant execute on function public.player_stock_tiers_run(timestamptz) to service_role;
  grant execute on function public.player_stock_tier_next(text, numeric, double precision, jsonb) to service_role;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-player-stock-tiers';
    perform cron.schedule('nexa-player-stock-tiers', '*/10 * * * *', 'select public.player_stock_tiers_run()');
  end if;
end;
$$;
