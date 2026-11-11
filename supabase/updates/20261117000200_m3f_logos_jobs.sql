-- ===== idempotent copy of migrations/20261117000200_m3f_logos_jobs.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M3f · 0200 · Logos, quit at once, founders with a job (ADR-065, ADR-066)
-- =============================================================================
-- Mirrors src/lib/sim/logo.ts (isValidLogo) and src/lib/sim/startup.ts
-- (founderFactor, needsFullTimeFounder). Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Logos
-- ---------------------------------------------------------------------------
-- isValidLogo: palette 1..maxColors lowercase #rrggbb, size rows of size chars from '.' and the
-- palette indices, at least 8 pixels
create or replace function public.logo_valid(p_logo jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_size  integer := public.config_double('startups', '{logo,size}', 16)::integer;
  v_max   integer := public.config_double('startups', '{logo,maxColors}', 6)::integer;
  v_n     integer;
  v_re    text;
begin
  if p_logo is null or jsonb_typeof(p_logo) <> 'object'
     or jsonb_typeof(p_logo -> 'palette') is distinct from 'array' or jsonb_typeof(p_logo -> 'grid') is distinct from 'array' then
    return false;
  end if;
  v_n := jsonb_array_length(p_logo -> 'palette');
  if v_n < 1 or v_n > v_max
     or exists (select 1 from jsonb_array_elements(p_logo -> 'palette') c
                 where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-f]{6}$') then
    return false;
  end if;
  if jsonb_array_length(p_logo -> 'grid') <> v_size then
    return false;
  end if;
  v_re := '^[.0-' || (v_n - 1) || ']{' || v_size || '}$';
  if exists (select 1 from jsonb_array_elements(p_logo -> 'grid') r
              where jsonb_typeof(r) <> 'string' or (r #>> '{}') !~ v_re) then
    return false;
  end if;
  return (select char_length(replace(string_agg(r #>> '{}', ''), '.', '')) >= 8
            from jsonb_array_elements(p_logo -> 'grid') r);
end;
$$;

-- Logo as the client sees it (null for AI companies and while hidden)
create or replace function public.company_logo(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when pc.logo_hidden then null else pc.logo end
    from public.player_companies pc where pc.company_id = p_company;
$$;

create or replace function public.set_company_logo(p_request_id uuid, p_logo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or not public.logo_valid(p_logo) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_company_logo');
  if v_replay is not null then
    return v_replay;
  end if;
  update public.player_companies
     set logo = jsonb_build_object('palette', p_logo -> 'palette', 'grid', p_logo -> 'grid'),
         logo_version = logo_version + 1, logo_hidden = false
   where company_id = v_company;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

create or replace function public.report_company_logo(p_request_id uuid, p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  pc       public.player_companies;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'report_company_logo');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = p_company_id for update;
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  if pc.logo is null or pc.founder_id = v_player then
    perform public.api_error('invalid_argument');
  end if;
  insert into public.company_logo_reports (company_id, logo_version, reporter_id)
  values (pc.company_id, pc.logo_version, v_player)
  on conflict do nothing;
  if (select count(*) from public.company_logo_reports r
       where r.company_id = pc.company_id and r.logo_version = pc.logo_version)
     >= public.config_double('startups', '{logo,reportsToHide}', 3) then
    update public.player_companies set logo_hidden = true where company_id = pc.company_id;
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('reported', true));
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Founders with a job
-- ---------------------------------------------------------------------------
-- headcount = active player employees + AI workers
create or replace function public.company_headcount(p_company uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select count(*) from public.player_jobs j where j.company_id = p_company and j.status = 'active'), 0)::integer
       + coalesce((select pc.ai_workers from public.player_companies pc where pc.company_id = p_company), 0);
$$;

-- needsFullTimeFounder: from startups.fullTimeFromEmployees the founder gives notice at the other job
create or replace function public.company_full_time_check(p_company uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  pc    public.player_companies;
  j     public.player_jobs;
begin
  select * into pc from public.player_companies where company_id = p_company and status = 'active';
  if pc.company_id is null
     or public.company_headcount(p_company) < public.config_double('startups', '{fullTimeFromEmployees}', 5) then
    return false;
  end if;
  select * into j from public.player_jobs
   where player_id = pc.founder_id and status = 'active' and notice_ends_at is null for update;
  if j.id is null then
    return false;
  end if;
  update public.player_jobs
     set notice_ends_at = now() + make_interval(secs => public.config_double('jobs', '{quitNoticeHours}', 24) * 3600)
   where id = j.id;
  perform public.company_system_message(p_company,
    'Ab ' || public.config_double('startups', '{fullTimeFromEmployees}', 5)::integer || ' Mitarbeitern arbeitet '
    || (select pr.nickname from public.profiles pr where pr.id = pc.founder_id) || ' Vollzeit in der Firma.');
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- B. Quit with notice or at once (ADR-066)
-- ---------------------------------------------------------------------------
drop function if exists public.quit_job(uuid);
create or replace function public.quit_job(p_request_id uuid, p_immediate boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
  v_cost   bigint;
  v_cash   bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'quit_job');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.lock_player_accounts(v_player);
  select * into j from public.player_jobs where player_id = v_player and status = 'active' for update;
  if j.id is null then
    perform public.api_error('no_active_job');
  end if;
  if not coalesce(p_immediate, false) then
    if j.notice_ends_at is null then
      update public.player_jobs
         set notice_ends_at = now() + make_interval(secs => public.config_double('jobs', '{quitNoticeHours}', 24) * 3600)
       where id = j.id
      returning * into j;
    end if;
    return public.request_complete(v_player, p_request_id, jsonb_build_object('notice_ends_at', j.notice_ends_at));
  end if;
  -- at once: jobs.quitNowCostHours x contract wage to the employer
  perform public.accrue_job_salary(j.id);
  select * into j from public.player_jobs where id = j.id;
  v_cost := round(j.salary_cents_per_hour * public.config_double('jobs', '{quitNowCostHours}', 12))::bigint;
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.company_cash_account(j.company_id),
                                   v_cost, 'transfer', 'Sofortige Kündigung', 'player_job', j.id, 'quit:' || j.id::text, v_player);
  end if;
  update public.player_jobs set status = 'ended', ended_at = now(), end_reason = 'quit' where id = j.id;
  perform public.company_system_message(j.company_id,
    (select pr.nickname from public.profiles pr where pr.id = v_player) || ' hat gekündigt.');
  return public.request_complete(v_player, p_request_id, jsonb_build_object('ended', true, 'paid_cents', v_cost));
end;
$$;


-- company objects for the client carry the logo
create or replace function public.company_json(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'ticker', c.ticker, 'sector', c.sector_key,
                            'color', c.brand_color, 'is_ai', c.is_ai, 'logo', public.company_logo(c.id))
    from public.companies c where c.id = p_company_id;
$$;

create or replace function public.get_market_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := public.game_now();
  v_index   jsonb;
  v_secs    jsonb;
begin
  perform public.require_player();

  select jsonb_build_object(
           'ticker', upper(i.key), 'name', s.name, 'value_e4', q.last_price_e4,
           'prev_close_e4', coalesce(q.prev_close_e4, q.last_price_e4), 'change_bps', q.change_bps,
           'day_high_e4', q.day_high_e4, 'day_low_e4', q.day_low_e4)
    into v_index
    from public.indices i
    join public.securities s on s.id = i.security_id
    join public.security_quotes q on q.security_id = s.id
   order by i.created_at
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'ticker', s.ticker, 'name', s.name, 'kind', s.kind,
           'sector_key', s.sector_key, 'size_class', c.tier,
           'last_price_e4', q.last_price_e4, 'bid_e4', q.bid_e4, 'ask_e4', q.ask_e4,
           'prev_close_e4', coalesce(q.prev_close_e4, q.last_price_e4), 'change_bps', q.change_bps,
           'day_high_e4', coalesce(q.day_high_e4, q.last_price_e4), 'day_low_e4', coalesce(q.day_low_e4, q.last_price_e4),
           'day_volume_e6', q.day_volume_e6, 'market_cap_cents', case when s.kind = 'stock' then q.market_cap_cents end,
           'term_game_years', b.term_game_years, 'coupon_bps', b.coupon_bps,
           'yield_bps', case when s.kind = 'bond' then q.yield_bps end,
           'matures_at', b.matures_at, 'face_value_cents', b.face_value_cents,
           'company_id', s.company_id, 'brand_color', c.brand_color,
           'logo', case when s.company_id is not null then public.company_logo(s.company_id) end,
           'company_kind', case when c.id is not null and not c.is_ai then 'player' else 'ai' end)
         order by case s.kind when 'stock' then 0 else 1 end, sec.sort_order, b.term_game_years, s.ticker), '[]'::jsonb)
    into v_secs
    from public.securities s
    join public.security_quotes q on q.security_id = s.id
    left join public.companies c on c.id = s.company_id
    left join public.sectors sec on sec.key = s.sector_key
    left join public.bonds b on b.security_id = s.id
   where s.status = 'listed' and s.kind in ('stock', 'bond');

  return jsonb_build_object(
    'server_time',     v_now,
    'tick_seq',        (select r.tick_seq from public.sim_runtime r where r.id),
    'last_tick_at',    (select r.last_tick_at from public.sim_runtime r where r.id),
    'session',         public.market_session_at(v_now),
    'paused',          coalesce((select r.is_paused from public.sim_runtime r where r.id), false),
    'policy_rate_bps', (select cb.policy_rate_bps from public.central_bank_state cb where cb.id),
    'day_start',       public.trading_day_start(v_now),
    'index',           v_index,
    'securities',      v_secs,
    'economy',         jsonb_build_object(
                         'money_supply_cents',      public.money_supply_cents(),
                         'treasury_cents',          public.treasury_balance_cents(),
                         'basic_income_factor_bps', public.basic_income_factor_bps(),
                         'total_supply_cents',      public.config_bigint('money', '{totalSupplyCents}', 1000000000000)));
end;
$$;

-- job_state adds quit_now_cost_cents
create or replace function public.job_state(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j        public.player_jobs;
  v_match  integer;
  v_base   bigint;
  v_max    integer;
  v_ai     boolean;
  v_today  date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_cool   double precision := public.config_double('jobs', '{raiseRequest,cooldownDays}', 7);
  v_factor integer;
  v_bonus  bigint;
  v_next   timestamptz;
  v_open   boolean;
begin
  select * into j from public.player_jobs where player_id = p_player and status = 'active';
  if j.id is null then
    return jsonb_build_object('job', null);
  end if;
  select c.is_ai into v_ai from public.companies c where c.id = j.company_id;
  v_match := public.job_match_score(public.player_branch_scores(p_player), j.required);
  v_max := greatest(0, public.config_double('jobs', '{raiseRequest,maxRaiseBpsPerScore}', 300)::integer * (v_match - j.raise_base_score));
  if v_ai then
    v_base := coalesce((public.career_tier(j.tier::text) ->> 'salaryCentsPerHour')::bigint, j.salary_cents_per_hour);
    v_max := least(v_max, greatest(0, floor((public.ai_salary_ceiling(v_base, v_match)::numeric / j.salary_cents_per_hour - 1) * 10000)::integer));
  end if;
  -- player companies: pay factor of the quarter x share the company could pay at the last payout
  select pc.pay_factor_bps * j.pay_factor_bps / 10000,
         coalesce((select sum(sp.bonus_cents) from public.salary_payouts sp join public.game_quarters gq on gq.id = pc.last_closed_quarter_id
                    where sp.player_job_id = j.id and sp.bonus_cents > 0 and sp.period_end = gq.ends_at), 0)
    into v_factor, v_bonus
    from public.player_companies pc where pc.company_id = j.company_id and pc.status = 'active';
  v_factor := coalesce(v_factor, j.pay_factor_bps);
  -- automatic work (ADR-064): no new work tasks
  v_next := null;
  v_open := false;
  return jsonb_build_object('job', jsonb_build_object(
    'id', j.id,
    'company', public.company_json(j.company_id),
    'tier', j.tier,
    'title_key', j.title_key,
    'title', case when j.title_key is null then j.title end,
    'required', j.required,
    'salary_cents_per_hour', j.salary_cents_per_hour,
    'pay_factor_bps', v_factor,
    'effective_salary_cents_per_hour', j.salary_cents_per_hour * v_factor / 10000,
    'last_bonus_cents', coalesce(v_bonus, 0),
    'next_work_task_at', v_next,
    'work_task_open', v_open,
    'productivity_bps', public.job_productivity_bps(v_match),
    'started_at', j.started_at,
    'paid_hours_today', case when j.paid_day = v_today then round(j.paid_minutes_today / 60.0, 2) else 0 end,
    'paid_hours_cap', public.config_double('careers', '{paidHoursPerDayCap}', 12),
    'earned_total_cents', j.earned_total_cents,
    'raise_available_at', case when j.raise_requested_at is null
                                    or j.raise_requested_at + make_interval(secs => v_cool * 86400) <= now() then null
                               else j.raise_requested_at + make_interval(secs => v_cool * 86400) end,
    'raise_max_bps', v_max,
    'pending_raise', case when j.pending_raise_bps is not null
                          then jsonb_build_object('requested_bps', j.pending_raise_bps, 'created_at', j.pending_raise_at) end,
    'quit_cost_cents', 0,
    'quit_now_cost_cents', round(j.salary_cents_per_hour * public.config_double('jobs', '{quitNowCostHours}', 12))::bigint,
    'notice_ends_at', j.notice_ends_at,
    'signature', j.signature));
end;
$$;

-- found_company: founders may keep their job (ADR-066)
create or replace function public.found_company(p_request_id uuid, p_name text, p_idea text, p_sector text, p_color text,
                                                p_tier text, p_product text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_idea   text := btrim(coalesce(p_idea, ''));
  v_reason text;
  v_tier   jsonb;
  v_level  integer;
  v_cost   bigint;
  v_cash   bigint;
  v_id     uuid := gen_random_uuid();
  v_acc    uuid;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'found_company');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  if coalesce(p_tier, '') not in ('garage', 'small_business')
     or not exists (select 1 from public.sectors s where s.key = p_sector)
     or public.config_jsonb('startups', array['capacityCentsPerProductivity', p_sector]) is null
     or coalesce(p_color, '') !~ '^#[0-9a-fA-F]{6}$'
     or char_length(v_idea) not between 1 and 120
     or (p_product is not null
         and not exists (select 1 from jsonb_array_elements(coalesce(public.config_jsonb('startups', array['products', p_sector]), '[]'::jsonb)) x
                          where x ->> 'key' = p_product)) then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(v_idea) then
    perform public.api_error('name_profanity');
  end if;
  perform 1 from public.profiles p where p.id = v_player for update;
  if exists (select 1 from public.player_companies pc where pc.founder_id = v_player and pc.status = 'active') then
    perform public.api_error('company_exists');
  end if;
  if exists (select 1 from public.profiles p where p.id = v_player and p.founding_locked_until > now()) then
    perform public.api_error('founding_locked');
  end if;
  v_reason := public.name_violation(p_name, 'company');
  if v_reason is not null then
    perform public.api_error(v_reason);
  end if;
  v_tier := public.company_tier_cfg(p_tier);
  select p.level into v_level from public.profiles p where p.id = v_player;
  if v_level < (v_tier ->> 'minLevel')::integer then
    perform public.api_error('company_level_too_low');
  end if;
  v_cost := (v_tier ->> 'foundingCostCents')::bigint;
  perform public.lock_player_accounts(v_player);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if coalesce(v_cash, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;

  insert into public.companies (id, name, slug, description, sector_key, is_ai, legal_form, phase, founder_id, ceo_id,
                                brand_color, shares_outstanding, max_employees, founded_quarter_id, founded_at)
  values (v_id, p_name, trim(both '-' from lower(regexp_replace(p_name, '[^A-Za-z0-9]+', '-', 'g'))) || '-' || left(v_id::text, 8),
          v_idea, p_sector, false, 'small_business', 'private', v_player, v_player, lower(p_color), 1,
          (v_tier ->> 'maxEmployees')::integer, (public.current_game_quarter()).id, now());
  insert into public.ledger_accounts (kind, owner_company_id, label) values ('company_cash', v_id, 'Firmenkasse')
  returning id into v_acc;
  if v_cost > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), v_acc, v_cost, 'company_founding',
                                   'Gründung ' || p_name, 'company', v_id, 'found:' || v_id::text, v_player);
  end if;
  insert into public.player_companies (company_id, founder_id, idea, tier, potential_annual_cents, awareness, quality, request_id,
                                       product_key)
  values (v_id, v_player, v_idea, p_tier, public.startup_potential_from_uniform(1 - random()),
          public.config_double('startups', '{awareness,initial}', 0.03), public.config_double('startups', '{quality,base}', 0.25),
          p_request_id,
          coalesce(p_product, public.config_jsonb('startups', array['products', p_sector]) -> 0 ->> 'key'));
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_id)));
end;
$$;

create or replace function public.sign_contract(p_request_id uuid, p_application_id uuid, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  a        public.job_applications;
  p        public.job_postings;
  v_scores jsonb;
begin
  v_player := public.require_player();
  if p_request_id is null or p_signature is null or char_length(p_signature) < 1 or char_length(p_signature) > 8000 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'sign_contract');
  if v_replay is not null then
    return v_replay;
  end if;
  perform 1 from public.profiles pr where pr.id = v_player for update;
  select * into a from public.job_applications where id = p_application_id and player_id = v_player for update;
  if a.id is null then
    perform public.api_error('application_not_found');
  end if;
  if a.status <> 'offered' then
    perform public.api_error('application_not_offered');
  end if;
  if a.offer_expires_at <= now() then
    perform public.api_error('offer_expired');
  end if;
  if exists (select 1 from public.player_jobs j where j.player_id = v_player and j.status = 'active') then
    perform public.api_error('job_active_exists');
  end if;
  select * into p from public.job_postings where id = a.posting_id;
  -- founders: a job elsewhere only while the company has fewer than fullTimeFromEmployees people (ADR-066)
  if exists (select 1 from public.player_companies pc where pc.founder_id = v_player and pc.status = 'active'
                and (pc.company_id = p.company_id
                     or public.company_headcount(pc.company_id) >= public.config_double('startups', '{fullTimeFromEmployees}', 5))) then
    perform public.api_error('owns_company');
  end if;
  -- player companies: players with an active job there + AI workers <= max employees of the tier
  if exists (select 1 from public.player_companies pc where pc.company_id = p.company_id and pc.status = 'active'
                and (select count(*) from public.player_jobs j where j.company_id = pc.company_id and j.status = 'active')
                    + pc.ai_workers + 1 > (public.company_tier_cfg(pc.tier) ->> 'maxEmployees')::integer) then
    perform public.api_error('employee_limit');
  end if;
  if p.slots is not null
     and (select count(*) from public.player_jobs j where j.posting_id = p.id and j.status = 'active') >= p.slots then
    perform public.api_error('job_not_found');
  end if;
  v_scores := public.player_branch_scores(v_player);
  insert into public.player_jobs (player_id, company_id, request_id, tier, title, title_key, required, salary_cents_per_hour,
                                  ceiling_cents_per_hour, raise_base_score, posting_id, application_id, signature,
                                  last_paid_at, started_at, paid_day, paid_minutes_today)
  values (v_player, p.company_id, p_request_id, p.tier, coalesce(p.title, p.title_key), p.title_key, p.required,
          a.offer_salary_cents_per_hour,
          case when p.is_ai then public.ai_salary_ceiling(p.salary_cents_per_hour, public.job_match_score(v_scores, p.required)) end,
          public.job_match_score(v_scores, p.required), p.id, a.id, p_signature,
          public.game_now(), public.game_now(), (public.game_now() at time zone 'Europe/Berlin')::date, 0);
  update public.job_applications set status = 'signed', signature = p_signature where id = a.id;
  update public.job_applications set status = 'closed'
   where player_id = v_player and id <> a.id and status in ('pending', 'offered');
  perform public.company_system_message(p.company_id,
    (select pr.nickname from public.profiles pr where pr.id = v_player) || ' ist jetzt im Team.');
  perform public.company_full_time_check(p.company_id);
  return public.request_complete(v_player, p_request_id, public.job_state(v_player));
end;
$$;

create or replace function public.set_ai_workers(p_request_id uuid, p_count integer)
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
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or p_count is null or p_count < 0 or p_count > 1000 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_ai_workers');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = v_company for update;
  if p_count + (select count(*) from public.player_jobs j where j.company_id = v_company and j.status = 'active')
     > (public.company_tier_cfg(pc.tier) ->> 'maxEmployees')::integer then
    perform public.api_error('employee_limit');
  end if;
  update public.player_companies set ai_workers = p_count where company_id = v_company;
  perform public.company_full_time_check(v_company);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;

create or replace function public.player_company_team(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  v_sector text;
  v_list   jsonb;
  v_req    jsonb;
  v_fs     jsonb;
  v_found  integer;
  v_prod   bigint;
  v_score  integer;
  v_emp    integer := 0;
  v_s      jsonb;
  r        record;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select c.sector_key into v_sector from public.companies c where c.id = p_company;
  v_list := coalesce(public.config_jsonb('jobs', array['sectorBranches', v_sector]), '[]'::jsonb);
  select coalesce(jsonb_agg(jsonb_build_object('branch', b, 'min_score', 0) order by o), '[]'::jsonb) into v_req
    from jsonb_array_elements_text(v_list) with ordinality x(b, o) where o <= 2;
  v_fs := public.player_branch_scores(pc.founder_id);
  v_found := public.job_productivity_bps(public.job_match_score(v_fs, v_req));
  -- founderFactor: half productivity while the founder works elsewhere (ADR-066)
  if exists (select 1 from public.player_jobs x where x.player_id = pc.founder_id and x.status = 'active' and x.company_id <> p_company) then
    v_found := round(v_found * public.config_double('startups', '{sideJobFounderFactor}', 0.5))::integer;
  end if;
  select coalesce(sum(coalesce((v_fs ->> b)::integer, 0)), 0) into v_score from jsonb_array_elements_text(v_list) b;
  v_prod := v_found;
  for r in select j.player_id, j.required from public.player_jobs j where j.company_id = p_company and j.status = 'active' loop
    v_s := public.player_branch_scores(r.player_id);
    v_prod := v_prod + public.job_productivity_bps(public.job_match_score(v_s, r.required));
    v_score := v_score + (select coalesce(sum(coalesce((v_s ->> b)::integer, 0)), 0) from jsonb_array_elements_text(v_list) b);
    v_emp := v_emp + 1;
  end loop;
  v_prod := v_prod + pc.ai_workers * 10000;
  return jsonb_build_object(
    'founder_productivity_bps', v_found,
    'team_productivity_bps', v_prod,
    'employees', v_emp,
    'team_sector_score', v_score,
    'stage', public.company_stage(p_company),
    'capacity_cents', round(v_prod / 10000.0
                            * public.config_double('startups', array['capacityCentsPerProductivity', v_sector], 250000)
                            * (1 + public.config_double('startups', '{stages,capacityBonusPerStage}', 0.25) * public.company_stage(p_company)))::bigint);
end;
$$;

create or replace function public.company_state(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  c        public.companies;
  v_team   jsonb;
  v_tier   jsonb;
  v_sb     jsonb;
  v_level  integer;
  v_cash   bigint;
  v_spread double precision;
  v_last   jsonb;
  v_hist   jsonb;
  v_cost   bigint;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select * into c from public.companies where id = p_company;
  v_team := public.player_company_team(p_company);
  v_tier := public.company_tier_cfg(pc.tier);
  v_sb := public.company_tier_cfg('small_business');
  select p.level into v_level from public.profiles p where p.id = pc.founder_id;
  v_cash := coalesce((select a.balance_cents from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash'), 0);
  v_spread := public.config_double('startups', '{estimate,initialSpread}', 2.3)
            * power(public.config_double('startups', '{estimate,decayPerQuarter}', 0.85), pc.quarters_active);
  select jsonb_build_object(
           'label', r.label, 'demand_cents', r.demand_cents, 'capacity_cents', r.capacity_cents,
           'revenue_cents', r.revenue_cents, 'cogs_cents', r.cogs_cents, 'fixed_cents', r.fixed_cents,
           'ai_worker_cents', r.ai_worker_cents, 'marketing_cents', r.marketing_cents, 'wages_cents', r.wages_cents,
           'operating_profit_cents', r.operating_profit_cents, 'utilization_bps', r.utilization_bps,
           'bonus_cents', r.bonus_cents)
    into v_last
    from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
   where r.company_id = p_company order by gq.ends_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('label', h.label, 'revenue_cents', h.revenue_cents,
                                               'profit_cents', h.operating_profit_cents) order by h.ends_at), '[]'::jsonb)
    into v_hist
    from (select r.label, r.revenue_cents, r.operating_profit_cents, gq.ends_at
            from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
           where r.company_id = p_company order by gq.ends_at desc limit 12) h;
  if pc.tier = 'garage' then
    v_cost := greatest(0, (v_sb ->> 'foundingCostCents')::bigint
                          - round((v_tier ->> 'foundingCostCents')::bigint
                                  * public.config_double('startups', '{upgradeCreditShare}', 1))::bigint);
  end if;
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'idea', pc.idea,
    'sector', c.sector_key,
    'color', c.brand_color,
    'logo', public.company_logo(p_company),
    'logo_hidden', pc.logo_hidden,
    'founder_has_job', exists (select 1 from public.player_jobs x where x.player_id = pc.founder_id and x.status = 'active'),
    'full_time_from', public.config_double('startups', '{fullTimeFromEmployees}', 5)::integer,
    'headcount', public.company_headcount(p_company),
    'tier', pc.tier,
    'founded_at', c.founded_at,
    'cash_cents', v_cash,
    'value_cents', public.company_value_cents(p_company),
    'unpaid_cents', pc.unpaid_cents,
    'distress', pc.distress,
    'distress_quarters', pc.distress_quarters,
    'grace_quarters', public.config_double('startups', '{insolvency,graceQuarters}', 4)::integer,
    'pay_factor_bps', pc.pay_factor_bps,
    'product_key', public.company_product(p_company) ->> 'key',
    'stage', (v_team ->> 'stage')::integer,
    'stages', public.company_stages_json(p_company),
    'awareness_bps', round(pc.awareness * 10000)::integer,
    'quality_bps', round(pc.quality * 10000)::integer,
    'quarters_active', pc.quarters_active,
    'estimate_low_cents', round(pc.potential_annual_cents
                                * exp(-v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':low'))))::bigint,
    'estimate_high_cents', round(pc.potential_annual_cents
                                 * exp(v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':high'))))::bigint,
    'marketing_cents_per_quarter', pc.marketing_cents_per_quarter,
    'ai_workers', pc.ai_workers,
    'ai_worker_cost_cents', public.config_bigint('startups', '{aiWorkerCostCentsPerQuarter}', 70000),
    'max_employees', (v_tier ->> 'maxEmployees')::integer,
    'employees', (v_team ->> 'employees')::integer,
    'open_postings', (select count(*) from public.job_postings jp where jp.company_id = p_company and jp.status = 'open')::integer,
    'pending_applications', (select count(*) from public.job_applications a join public.job_postings jp on jp.id = a.posting_id
                              where jp.company_id = p_company and a.status = 'pending')::integer,
    'founder_productivity_bps', (v_team ->> 'founder_productivity_bps')::integer,
    'team_productivity_bps', (v_team ->> 'team_productivity_bps')::integer,
    'capacity_cents', (v_team ->> 'capacity_cents')::bigint,
    'next_quarter_at', coalesce((public.current_game_quarter()).ends_at, public.game_now()),
    'can_upgrade', pc.tier = 'garage' and coalesce(v_level, 1) >= (v_sb ->> 'minLevel')::integer,
    'upgrade_cost_cents', v_cost,
    'last_quarter', v_last,
    'history', v_hist);
end;
$$;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.logo_valid(jsonb)', 'public.company_logo(uuid)', 'public.set_company_logo(uuid, jsonb)',
    'public.report_company_logo(uuid, uuid)', 'public.company_headcount(uuid)', 'public.company_full_time_check(uuid)',
    'public.quit_job(uuid, boolean)', 'public.company_json(uuid)', 'public.get_market_snapshot()', 'public.job_state(uuid)',
    'public.found_company(uuid, text, text, text, text, text, text)', 'public.sign_contract(uuid, uuid, text)',
    'public.set_ai_workers(uuid, integer)', 'public.player_company_team(uuid)', 'public.company_state(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.set_company_logo(uuid, jsonb)', 'public.report_company_logo(uuid, uuid)', 'public.quit_job(uuid, boolean)',
    'public.get_market_snapshot()', 'public.found_company(uuid, text, text, text, text, text, text)',
    'public.sign_contract(uuid, uuid, text)', 'public.set_ai_workers(uuid, integer)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
