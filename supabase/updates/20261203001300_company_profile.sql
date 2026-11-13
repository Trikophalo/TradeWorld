-- ===== idempotent copy of migrations/20261203001300_company_profile.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1300 · Every company can be opened: staff and key facts (ADR-125)
-- =============================================================================
-- get_company_profile(p_company_id) (authenticated): the public profile of any company, AI or player, for every
-- player. Facts that a company shows anyway (team, product, stage, revenue and profit of the last quarter, value),
-- never its cash, debts or plans.
--   {"company": {"id", "name", "ticker", "sector", "is_ai", "tier", "brand_color", "logo", "idea", "founded_at",
--                "listed", "price_e4", "change_bps"},
--    "founder": {"nickname", "tag", "avatar_key"} | null,
--    "facts": {"value_cents", "revenue_cents", "profit_cents", "period": "quarter"|"ttm"|null, "staff",
--              "max_staff", "ai_workers", "product", "stage", "quality_bps", "awareness_bps"},
--    "members": [{"nickname", "tag", "avatar_key", "tier", "title", "since"}]}
-- get_company_org() is now open to every player as well (it shows the same people).
-- Idempotent: runs unchanged as supabase/updates/20261203001300_company_profile.sql.

create or replace function public.get_company_profile(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  c        public.companies;
  pc       public.player_companies;
  r        public.player_company_reports;
  q        public.security_quotes;
  v_listed boolean := false;
begin
  select * into c from public.companies where id = p_company_id and dissolved_at is null;
  if c.id is null then
    perform public.api_error('company_not_found');
  end if;
  select * into pc from public.player_companies where company_id = c.id;
  if pc.company_id is not null then
    select x.* into r from public.player_company_reports x join public.game_quarters gq on gq.id = x.game_quarter_id
     where x.company_id = c.id order by gq.ends_at desc limit 1;
  end if;
  if c.security_id is not null then
    select * into q from public.security_quotes where security_id = c.security_id;
    v_listed := exists (select 1 from public.securities s where s.id = c.security_id and s.status = 'listed');
  end if;

  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', c.id, 'name', c.name, 'ticker', c.ticker, 'sector', c.sector_key, 'is_ai', c.is_ai,
      'tier', coalesce(pc.tier, c.tier::text), 'brand_color', c.brand_color, 'logo', public.company_logo(c.id),
      'idea', coalesce(pc.idea, c.description), 'founded_at', c.founded_at, 'listed', v_listed,
      'price_e4', case when v_listed then q.last_price_e4 end, 'change_bps', case when v_listed then q.change_bps end),
    'founder', (select jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key)
                  from public.profiles p where p.id = coalesce(pc.founder_id, c.founder_id)),
    'facts', jsonb_build_object(
      'value_cents', case when pc.company_id is not null and not v_listed then public.company_value_cents(c.id)
                          else q.market_cap_cents end,
      'revenue_cents', case when r.company_id is not null then r.revenue_cents
                            when c.is_ai then c.ttm_revenue_cents end,
      'profit_cents', case when r.company_id is not null then r.operating_profit_cents
                           when c.is_ai then c.ttm_net_income_cents end,
      'period', case when r.company_id is not null then 'quarter' when c.is_ai then 'ttm' end,
      'staff', case when pc.company_id is not null
                    then 1 + pc.ai_workers + (select count(*) from public.player_jobs j
                                               where j.company_id = c.id and j.status = 'active')::integer
                    else c.employee_count end,
      'max_staff', c.max_employees,
      'ai_workers', coalesce(pc.ai_workers, 0),
      'product', pc.product_key,
      'stage', case when pc.company_id is not null then public.company_stage(c.id) end,
      'quality_bps', case when r.company_id is not null then r.quality_bps end,
      'awareness_bps', case when r.company_id is not null then r.awareness_bps end),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key, 'tier', j.tier,
                                          'title', coalesce(j.title, j.title_key), 'since', j.started_at)
                       order by case j.tier::text when 'c_level' then 5 when 'team_lead' then 4 when 'senior' then 3
                                                  when 'junior' then 2 else 1 end desc, j.started_at, p.nickname)
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = c.id and j.status = 'active'), '[]'::jsonb));
end;
$$;
comment on function public.get_company_profile(uuid) is
  'RPC: the public profile of any company (team, product, last quarter, value), for every player (ADR-125).';
revoke all on function public.get_company_profile(uuid) from public, anon;
grant execute on function public.get_company_profile(uuid) to authenticated, service_role;

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
                                          'is_me', j.player_id = v_player)
                       order by case j.tier::text when 'c_level' then 5 when 'team_lead' then 4 when 'senior' then 3
                                                  when 'junior' then 2 else 1 end desc, j.started_at, p.nickname)
        from public.player_jobs j join public.profiles p on p.id = j.player_id
       where j.company_id = p_company_id and j.status = 'active'), '[]'::jsonb),
    'ai_workers', pc.ai_workers,
    'ai_worker_skills', to_jsonb(coalesce(pc.ai_worker_skills, '{}'::text[])));
end;
$$;
