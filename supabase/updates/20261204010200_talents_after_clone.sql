-- ===== idempotent copy of migrations/20261204010200_talents_after_clone.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 10200 · Talente im Organigramm, nach Klon und Jobs (ADR-199, ADR-206)
-- =============================================================================
-- Talents lead their Stelle and stand above the AI workers in the hierarchy. get_company_org (full copy of the latest
-- definition from 20261204000100_company_tasks.sql, unchanged otherwise) now also returns the talents of the company:
-- Mit-Geschäftsführer first, then by tier (Legende first), then by Stelle. Runs after the clone/jobs migrations
-- (9800/9810); none of the team or job functions they rewrote carry talent logic, so nothing else is re-applied.
-- Idempotent (create or replace).

create or replace function public.get_company_org(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  pc       public.player_companies;
  c        public.companies;
begin
  select * into pc from public.player_companies where company_id = p_company_id and status = 'active';
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  select * into c from public.companies where id = p_company_id;
  -- open to every player (ADR-125): the org chart shows who works where, nothing more
  return jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'tier', pc.tier),
    'founder', (select jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key,
                                          'is_me', p.id = v_player)
                  from public.profiles p where p.id = pc.founder_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key, 'tier', j.tier,
                                          'title', coalesce(j.title, j.title_key), 'since', j.started_at,
                                          'is_me', j.player_id = v_player,
                                          'supervisor', (select s.nickname from public.profiles s where s.id = j.supervisor_id))
                       order by case j.tier::text when 'c_level' then 5 when 'team_lead' then 4 when 'senior' then 3
                                                  when 'junior' then 2 else 1 end desc, j.started_at, p.nickname)
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = p_company_id and j.status = 'active'), '[]'::jsonb),
    -- Talente (ADR-199): above the AI workers; public facts only (no wage, no satisfaction)
    'talents', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.talent_key, 'first_name', t.first_name, 'last_name', t.last_name,
                                          'avatar_key', t.avatar_key, 'role', t.role_key, 'tier', t.tier,
                                          'is_coceo', t.is_coceo, 'since', t.hired_at)
                       order by t.is_coceo desc, t.tier desc, t.role_key, t.talent_key)
        from public.talents t
       where t.company_id = p_company_id), '[]'::jsonb),
    'ai_workers', pc.ai_workers,
    'ai_worker_skills', to_jsonb(coalesce(pc.ai_worker_skills, '{}'::text[])));
end;
$$;
