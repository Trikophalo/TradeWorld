-- ===== idempotent copy of migrations/20261203000200_skill_prerequisites.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0200 · Skills are learned in order: explicit prerequisites (ADR-115)
-- =============================================================================
-- Until now a skill was open when it was an entry field near the centre or when any neighbouring field was learned
-- (ADR-061). So programming could be learned without the IT basics. Now every skill in game_config.skills.tree names
-- the skills that come before it ("requires", all of them needed); only the eight basics need nothing.
-- Mirrors isReachable() in src/lib/sim/skills.ts. Learned skills stay learned, whatever order they were learned in.
-- A tree without "requires" (an older config) keeps the old rule.
-- Idempotent: runs unchanged as supabase/updates/20261203000200_skill_prerequisites.sql.

create or replace function public.skill_reachable(p_player uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when x.n ? 'requires' then
             not exists (
               select 1
                 from jsonb_array_elements_text(x.n -> 'requires') r(skill_key)
                where not exists (select 1 from public.player_skills s
                                   where s.player_id = p_player and s.skill_key = r.skill_key))
           else
             coalesce((x.n ->> 'entry')::boolean, false)
             or exists (
                  select 1
                    from jsonb_array_elements(coalesce(public.config_jsonb('skills', '{tree}'), '[]'::jsonb)) o
                    join public.player_skills s on s.player_id = p_player and s.skill_key = o ->> 'key'
                    join (values (1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)) d(dq, dr)
                      on (o ->> 'q')::integer = (x.n ->> 'q')::integer + d.dq
                     and (o ->> 'r')::integer = (x.n ->> 'r')::integer + d.dr)
         end
    from (select public.skill_node(p_key) as n) x
   where x.n is not null;
$$;
comment on function public.skill_reachable(uuid, text) is
  'Internal: whether all prerequisites of a skill are learned (ADR-115); the basics are always open.';

revoke all on function public.skill_reachable(uuid, text) from public, anon, authenticated;
grant execute on function public.skill_reachable(uuid, text) to service_role;
