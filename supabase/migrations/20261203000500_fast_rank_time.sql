-- =============================================================================
-- NEXA · 0500 · Time in a rank runs fast: one paid hour counts as a day (ADR-118)
-- =============================================================================
-- "12 Stunden im Rang gearbeitet" took a day and a half of real time. Game time is fast everywhere else, so the
-- hours in a rank now count careers.promotion.rankHoursPerRealHour times (24: one paid real hour is a whole day).
-- player_jobs.rank_minutes keeps counting paid real minutes; the factor is applied where hours are compared
-- (here) and where they are shown (client). Without the config key the factor is 1.
-- Idempotent: runs unchanged as supabase/updates/20261203000500_fast_rank_time.sql.

create or replace function public.promotion_requirements(p_next text, p_level integer, p_scores jsonb, p_main text,
                                                         p_rank_minutes bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select public.promotion_cfg() as p,
           public.career_tier_min_score(p_next) as score,
           coalesce((select floor(public.cfg_num(t, '{minLevel}', 1))::integer
                       from jsonb_array_elements(public.career_tiers()) t where t ->> 'id' = p_next limit 1), 1) as min_level
  ), r as (
    select 1 as ord, 'level' as key, null::text as branch, c.min_level as need, coalesce(p_level, 0) as have from c
    union all
    select 2, 'branch', p_main, c.score, coalesce((p_scores ->> p_main)::integer, 0) from c
    union all
    select 3, 'management', 'management', c.score / 2, coalesce((p_scores ->> 'management')::integer, 0) from c
     where coalesce(c.p -> 'managementFrom', '[]'::jsonb) ? p_next and p_main is distinct from 'management'
    union all
    -- hours in the rank: paid minutes times rankHoursPerRealHour (ADR-118), whole hours against the hours of the rank
    select 4, 'hours', null, ceil(public.cfg_num(c.p, array['hoursByTier', p_next], 0))::integer,
           floor(greatest(0, coalesce(p_rank_minutes, 0))
                 * greatest(1, public.cfg_num(c.p, '{rankHoursPerRealHour}', 1)) / 60)::integer from c
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', r.key, 'branch', r.branch, 'need', r.need, 'have', r.have,
                                               'met', r.have >= r.need) order by r.ord), '[]'::jsonb)
    from r;
$$;
