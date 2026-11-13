-- =============================================================================
-- 88 · Time in a rank: one paid hour counts as rankHoursPerRealHour hours (ADR-118)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

begin;
select tests.set_cfg('careers', array['promotion', 'rankHoursPerRealHour'], '24'::jsonb);
select tests.assert(
  (select (r ->> 'have')::int = 12 and (r ->> 'met')::boolean
     from jsonb_array_elements(public.promotion_requirements('junior', 5, '{"it": 2}'::jsonb, 'it', 30)) r
    where r ->> 'key' = 'hours')
  and (select (r ->> 'have')::int = 11 and not (r ->> 'met')::boolean
         from jsonb_array_elements(public.promotion_requirements('junior', 5, '{"it": 2}'::jsonb, 'it', 29)) r
        where r ->> 'key' = 'hours'),
  'promotion_requirements(): 30 paid minutes are 12 hours in the rank at factor 24, 29 minutes are 11');
rollback;
select tests.assert(
  (select (r ->> 'have')::int = 0
     from jsonb_array_elements(public.promotion_requirements('junior', 5, '{"it": 2}'::jsonb, 'it', 30)) r
    where r ->> 'key' = 'hours'),
  'with factor 1 the same 30 minutes are no full hour');
