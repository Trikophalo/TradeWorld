-- =============================================================================
-- NEXA · 6230 · Nexamon: Black Label hype (ADR-171)
-- =============================================================================
-- Rule (game_config.nexamon.blackLabelHype; src/config/nexamon-rules.ts; port of nexamonHypeChanceBps,
-- nexamonHypeJumpBps, nexamonHypeAfterJump, nexamonHypeDecay, nexamonHypeStep in src/lib/sim/nexamon-bonuses.ts):
--   the Black Labels of a card are worth its market value x its own factor (start grading.blackLabel.valueBps, 10x).
--   Once per hour per card with a Black Label: first the decay (the factor loses decayBps of what it lies above the
--   base, at least 1 bps), then with chance rarityChanceBps[rarity] x (1 + popularity) x blRef / (blRef + Black Labels
--   - 1) a jump of minJumpBps..maxJumpBps of the factor, at most capBps.
-- Model:
--   nexamon_cards.bl_factor_bps (null = the base), bl_hype_at (the last hour handled), bl_jump_at (the last jump)
--   nexamon_hype_points: the factor per hour it changed (history on the card page)
--   nexamon_black_label_bps(card), nexamon_copy_value_cents(value, condition, grade, card): a Black Label at the card's
--   factor; every current function that values a copy with the card at hand (copy and listing JSON, AI asks and
--   buys, collection and profile value, net worth, news) is patched to the 4-argument form below (regexp on
--   pg_get_functiondef, idempotent)
--   nexamon_hype_run_due(now): job nexa-nexamon-hype (pg_cron, every hour at minute 7); a jump notifies the owners
--   of the card's Black Labels (nexamon_hype); a jump of bigJumpBps or more is a feed item nexamon_hype (friends,
--   gossip for NEXA Nachrichten)
--   nexamon_card_json(): black_label_bps, hype_at (last jump while the factor is above the base)
--   get_nexamon_card(): hype [{at, factor_bps}] (the last historyPoints points)
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

alter table public.nexamon_cards add column if not exists bl_factor_bps integer;
alter table public.nexamon_cards add column if not exists bl_hype_at timestamptz;
alter table public.nexamon_cards add column if not exists bl_jump_at timestamptz;
comment on column public.nexamon_cards.bl_factor_bps is
  'Black Label hype (ADR-171): value factor of this card''s Black Labels in bps; null = grading.blackLabel.valueBps.';

create table if not exists public.nexamon_hype_points (
  card_key   text not null references public.nexamon_cards (card_key) on delete cascade,
  at         timestamptz not null,
  factor_bps integer not null check (factor_bps > 0),
  jump_bps   integer not null default 0 check (jump_bps >= 0),
  primary key (card_key, at)
);
alter table public.nexamon_hype_points enable row level security;
revoke all on public.nexamon_hype_points from public, anon, authenticated;
grant all on public.nexamon_hype_points to service_role;
comment on table public.nexamon_hype_points is
  'Black Label factor of a card per hour it changed (ADR-171), jump_bps > 0 for a jump. Internal.';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('nexamon_hype', 'social', 'Black-Label-Hype', 'Die Black Labels einer deiner Nexamon-Karten sind im Preis gesprungen.',
        'notif_bell', true, true, false, 303)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- A. Rules
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_hype_base_bps()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.nexamon_cfg() #>> '{grading,blackLabel,valueBps}')::integer, 100000);
$$;

create or replace function public.nexamon_black_label_bps(p_card text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select k.bl_factor_bps from public.nexamon_cards k where k.card_key = p_card), public.nexamon_hype_base_bps());
$$;

-- the copy's value with the card's own Black Label factor
create or replace function public.nexamon_copy_value_cents(p_value_e4 bigint, p_condition text, p_grade double precision, p_card text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_grade >= 10.75 and p_card is not null
              then public.div_round_half_even(p_value_e4::numeric * public.nexamon_black_label_bps(p_card), 1000000)
              else public.nexamon_copy_value_cents(p_value_e4, p_condition, p_grade) end;
$$;

-- nexamonHypeChanceBps
create or replace function public.nexamon_hype_chance_bps(p_rarity text, p_popularity integer, p_black_labels bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with h as (select public.nexamon_cfg() -> 'blackLabelHype' as v)
  select case when coalesce(p_black_labels, 0) <= 0 or h.v is null then 0
              else (coalesce((h.v #>> array['rarityChanceBps', p_rarity])::bigint, 0)
                    * (10000 + least(10000, greatest(0, coalesce(p_popularity, 0))))
                    * coalesce((h.v ->> 'blRef')::bigint, 3)
                    / (10000 * (coalesce((h.v ->> 'blRef')::bigint, 3) + greatest(0, p_black_labels - 1))))::integer end
    from h;
$$;

-- nexamonHypeStep: decay, then the roll -> (factor, jump)
create or replace function public.nexamon_hype_step(p_factor integer, p_chance integer, p_u double precision, p_u2 double precision,
                                                    out factor_bps integer, out jump_bps integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h      jsonb := public.nexamon_cfg() -> 'blackLabelHype';
  v_base integer := public.nexamon_hype_base_bps();
  v_min  integer := coalesce((h ->> 'minJumpBps')::integer, 1000);
  v_max  integer := coalesce((h ->> 'maxJumpBps')::integer, 6000);
  v_u2   double precision := least(greatest(coalesce(p_u2, 0), 0), 0.999999999);
begin
  factor_bps := coalesce(p_factor, v_base);
  if factor_bps <= v_base then
    factor_bps := v_base;
  else
    factor_bps := factor_bps - greatest(1, ceil((factor_bps - v_base)::numeric * coalesce((h ->> 'decayBps')::integer, 100) / 10000))::integer;
  end if;
  jump_bps := 0;
  if p_u * 10000 < coalesce(p_chance, 0) then
    jump_bps := v_min + floor(v_u2 * (v_max - v_min + 1))::integer;
    factor_bps := least(coalesce((h ->> 'capBps')::integer, 250000), factor_bps + (factor_bps::bigint * jump_bps / 10000)::integer);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- B. Every function that values a copy with its card at hand uses the card's Black Label factor
-- ---------------------------------------------------------------------------
do $do$
declare
  r     record;
  v_def text;
  v_new text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.prosrc ~ 'nexamon_copy_value_cents\((k|r)\.value_e4, [a-z0-9_]+\.condition, [a-z0-9_]+\.grade\)|nexamon_copy_value_cents\(v_new, c\.condition, c\.grade\)'
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, 'nexamon_copy_value_cents\((k|r)\.value_e4, ([a-z0-9_]+)\.condition, ([a-z0-9_]+)\.grade\)',
                            'nexamon_copy_value_cents(\1.value_e4, \2.condition, \3.grade, \1.card_key)', 'g');
    v_new := replace(v_new, 'nexamon_copy_value_cents(v_new, c.condition, c.grade)', 'nexamon_copy_value_cents(v_new, c.condition, c.grade, p_card)');
    if v_new <> v_def then
      execute v_new;
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'nexamon_copy_json'
                and position('k.card_key)' in p.prosrc) = 0) then
    raise exception 'nexamon_copy_json() has an unexpected shape; value Black Labels with nexamon_copy_value_cents(..., card) (ADR-171) by hand';
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- C. The job
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_hype_run_due(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  h        jsonb := public.nexamon_cfg() -> 'blackLabelHype';
  v_now    timestamptz := coalesce(p_now, public.game_now());
  v_hour   timestamptz := date_trunc('hour', coalesce(p_now, public.game_now()));
  v_base   integer := public.nexamon_hype_base_bps();
  v_names  jsonb := coalesce((select g.value from public.game_config g where g.key = 'nexamon_names'), '{}'::jsonb);
  v_steps  integer;
  v_factor integer;
  v_jump   integer;
  v_best   integer;
  v_chance integer;
  v_n      integer := 0;
  s        record;
  r        record;
  o        record;
begin
  if h is null then
    return 0;
  end if;
  for r in select k.card_key, k.rarity, k.population, k.bl_factor_bps, k.bl_hype_at,
                  (select count(*) from public.nexamon_copies c where c.card_key = k.card_key and c.grade >= 10.75) as bls
             from public.nexamon_cards k
            where (k.bl_hype_at is null or k.bl_hype_at < v_hour)
              and (k.bl_factor_bps is not null
                   or exists (select 1 from public.nexamon_copies c where c.card_key = k.card_key and c.grade >= 10.75))
            order by k.bl_hype_at nulls first, k.card_key
            limit 500
            for update of k skip locked loop
    -- at most two days are caught up on
    v_steps := least(48, greatest(1, coalesce(floor(extract(epoch from (v_hour - r.bl_hype_at)) / 3600)::integer, 1)));
    v_factor := coalesce(r.bl_factor_bps, v_base);
    v_best := 0;
    v_chance := public.nexamon_hype_chance_bps(r.rarity, public.nexamon_popularity_bps(r.rarity, r.population), r.bls);
    for i in 1..v_steps loop
      select * into s from public.nexamon_hype_step(v_factor, v_chance, random(), random());
      v_factor := s.factor_bps;
      v_best := greatest(v_best, s.jump_bps);
    end loop;
    update public.nexamon_cards
       set bl_factor_bps = case when v_factor <= v_base then null else v_factor end, bl_hype_at = v_hour,
           bl_jump_at = case when v_best > 0 then v_now else bl_jump_at end
     where card_key = r.card_key;
    if v_factor <> coalesce(r.bl_factor_bps, v_base) then
      insert into public.nexamon_hype_points (card_key, at, factor_bps, jump_bps)
      values (r.card_key, v_hour, v_factor, v_best)
      on conflict (card_key, at) do update set factor_bps = excluded.factor_bps,
                                               jump_bps = greatest(public.nexamon_hype_points.jump_bps, excluded.jump_bps);
    end if;
    if v_best > 0 then
      v_n := v_n + 1;
      for o in select distinct c.owner_id from public.nexamon_copies c
                where c.card_key = r.card_key and c.grade >= 10.75 and c.owner_id is not null loop
        perform public.social_notify(o.owner_id, 'nexamon_hype', 'Black-Label-Hype!',
          'Die Black Labels von ' || coalesce(v_names ->> r.card_key, r.card_key) || ' sind um '
            || public.nexamon_bps_text(v_best) || ' gestiegen: jetzt das '
            || replace(trim(trailing '.' from trim(trailing '0' from to_char(v_factor / 10000.0, 'FM9990.0'))), '.', ',')
            || '-Fache der Karte.',
          jsonb_build_object('card_key', r.card_key, 'jump_bps', v_best, 'factor_bps', v_factor),
          '/nexamon/' || r.card_key, 'nexamon_hype:' || r.card_key || ':' || to_char(v_hour at time zone 'UTC', 'YYYYMMDDHH24'));
        if v_best >= coalesce((h ->> 'bigJumpBps')::integer, 4000) then
          perform public.feed_post(o.owner_id, 'nexamon_hype',
                                   jsonb_build_object('card_key', r.card_key, 'name', v_names ->> r.card_key,
                                                      'jump_bps', v_best, 'factor_bps', v_factor),
                                   'nexamon:hype:' || o.owner_id::text || ':' || r.card_key || ':'
                                     || to_char(v_hour at time zone 'UTC', 'YYYYMMDDHH24'));
        end if;
      end loop;
    end if;
  end loop;
  return v_n;
end;
$$;
comment on function public.nexamon_hype_run_due(timestamptz) is
  'Internal, cron every hour (ADR-171): Black Label hype of every card with a Black Label: decay toward the base, '
  'a random jump scaled by rarity, popularity and few Black Labels; notifies owners, feed item for a big jump. '
  'Returns the number of jumps.';

do $do$
begin
  revoke all on function public.nexamon_hype_run_due(timestamptz) from public, anon, authenticated;
  revoke all on function public.nexamon_hype_step(integer, integer, double precision, double precision) from public, anon, authenticated;
  revoke all on function public.nexamon_copy_value_cents(bigint, text, double precision, text) from public, anon, authenticated;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-nexamon-hype';
    perform cron.schedule('nexa-nexamon-hype', '7 * * * *', 'select public.nexamon_hype_run_due()');
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- D. Card JSON and card page (latest card JSON: 20261204006210_nexamon_card_bonuses.sql)
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_card_json(p_card text, p_viewer uuid, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'card_key', k.card_key, 'set', k.set_key, 'number', k.number, 'rarity', k.rarity,
           'value_cents', public.div_round_half_even(k.value_e4, 100),
           'start_cents', public.div_round_half_even(k.start_e4, 100),
           'change_bps', case when k.day_ref_on = (p_now at time zone 'Europe/Berlin')::date and k.day_ref_e4 > 0
                              then public.div_round_half_even((k.value_e4 - k.day_ref_e4)::numeric * 10000, k.day_ref_e4) else 0 end,
           'population', k.population,
           'listed', (select count(*) from public.nexamon_listings l where l.card_key = k.card_key),
           'owned', (select count(*) from public.nexamon_copies c where c.card_key = k.card_key and c.owner_id = p_viewer),
           'popularity_bps', public.nexamon_popularity_bps(k.rarity, k.population),
           'floor_cents', public.div_round_half_even(b.floor_e4, 100),
           'cap_cents', public.div_round_half_even(b.cap_e4, 100),
           'bonus', public.nexamon_card_bonus_json(k.card_key, p_viewer),
           'black_label_bps', coalesce(k.bl_factor_bps, public.nexamon_hype_base_bps()),
           'hype_at', case when k.bl_factor_bps is not null then k.bl_jump_at end)
    from public.nexamon_cards k,
         lateral public.nexamon_bounds(k.start_e4, k.first_pulled_at, k.counted_trades, p_now) b
   where k.card_key = p_card;
$$;

do $do$
declare
  v_def text := pg_get_functiondef('public.get_nexamon_card(text)'::regprocedure);
  v_old text := $t$    'server_time', v_now);$t$;
  v_new text := $t$    'hype', (select coalesce(jsonb_agg(jsonb_build_object('at', x.at, 'factor_bps', x.factor_bps, 'jump_bps', x.jump_bps)
                                       order by x.at), '[]'::jsonb)
               from (select h.at, h.factor_bps, h.jump_bps from public.nexamon_hype_points h where h.card_key = k.card_key
                      order by h.at desc limit coalesce((cfg #>> '{blackLabelHype,historyPoints}')::integer, 30)) x),
    'server_time', v_now);$t$;
begin
  if position('nexamon_hype_points' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'get_nexamon_card() has an unexpected shape; add the Black Label hype history (ADR-171) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- E. Feed and NEXA Nachrichten: a big jump is news
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$    when 'nexamon_pull' then$t$;
  v_new text := $t$    when 'nexamon_hype' then 'Black-Label-Hype: ' || coalesce(p_payload ->> 'name', 'eine Nexamon-Karte') || ' springt im Preis'
    when 'nexamon_pull' then$t$;
begin
  if position('nexamon_hype' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'feed_item_label() has an unexpected shape; add the feed kind nexamon_hype (ADR-171) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_old text := $t$'nexamon_pull',$t$;
  v_new text := $t$'nexamon_pull', 'nexamon_hype',$t$;
begin
  if position('nexamon_hype' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'news_show_build() has an unexpected shape; add the feed kind nexamon_hype (ADR-171) to the gossip source by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
