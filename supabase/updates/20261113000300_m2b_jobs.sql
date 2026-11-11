-- ===== idempotent copy of migrations/20261113000300_m2b_jobs.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M2b · 0300 · Jobs: postings, applications, contracts, salary, raises,
--                     employer side (ADR-051, docs/JOBS_AND_SKILLS.md)
-- =============================================================================
-- Money: wages from the employer's company cash account (never from the
-- owner's private account), quitting pays one salary to the company, firing
-- one salary to the employee. Everything through the ledger (closed system).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- careers.tiers entry for a tier id: {id, minLevel, salaryCentsPerHour}
create or replace function public.career_tier(p_tier text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select t from jsonb_array_elements(coalesce(public.config_jsonb('careers', '{tiers}'), '[]'::jsonb)) t
   where t ->> 'id' = p_tier limit 1;
$$;

-- sum over required branches of min(branch score, 2 x max(min_score, 1))
create or replace function public.job_match_score(p_scores jsonb, p_required jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(least(coalesce((p_scores ->> (r ->> 'branch'))::integer, 0),
                             2 * greatest(coalesce((r ->> 'min_score')::integer, 0), 1))), 0)::integer
    from jsonb_array_elements(coalesce(p_required, '[]'::jsonb)) r;
$$;

create or replace function public.job_skills_ok(p_scores jsonb, p_required jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(coalesce((p_scores ->> (r ->> 'branch'))::integer, 0) >= coalesce((r ->> 'min_score')::integer, 0)), true)
    from jsonb_array_elements(coalesce(p_required, '[]'::jsonb)) r;
$$;

-- AI salary ceiling: base x min(aiSalaryCapMultiplier, 1 + aiSalaryPerScoreBps / 1e4 x match)
create or replace function public.ai_salary_ceiling(p_base bigint, p_match integer)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select round(p_base * least(public.config_double('jobs', '{aiSalaryCapMultiplier}', 1.5),
                              1 + public.config_double('jobs', '{aiSalaryPerScoreBps}', 300) / 10000.0 * coalesce(p_match, 0)))::bigint;
$$;

-- productivity in bps: playerBaseProductivity + productivityPerSkillScore x match, at most maxProductivity
create or replace function public.job_productivity_bps(p_match integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select round(least(public.config_double('jobs', '{maxProductivity}', 4),
                      public.config_double('jobs', '{playerBaseProductivity}', 1.5)
                      + public.config_double('jobs', '{productivityPerSkillScore}', 0.08) * coalesce(p_match, 0)) * 10000)::integer;
$$;

create or replace function public.company_json(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'ticker', c.ticker, 'sector', c.sector_key,
                            'color', c.brand_color, 'is_ai', c.is_ai)
    from public.companies c where c.id = p_company_id;
$$;

create or replace function public.posting_json(p_posting_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'company', public.company_json(p.company_id), 'tier', p.tier,
                            'title_key', p.title_key, 'title', p.title, 'required', p.required)
    from public.job_postings p where p.id = p_posting_id;
$$;

-- application object; an offer past its expiry reads as "expired"
create or replace function public.application_json(p_application_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', a.id,
           'status', case when a.status = 'offered' and a.offer_expires_at <= now() then 'expired' else a.status end,
           'posting', public.posting_json(a.posting_id),
           'salary_wish_cents_per_hour', a.salary_wish_cents_per_hour,
           'offer_salary_cents_per_hour', a.offer_salary_cents_per_hour,
           'offer_expires_at', a.offer_expires_at,
           'message', a.message,
           'created_at', a.created_at,
           'updated_at', a.updated_at)
    from public.job_applications a where a.id = p_application_id;
$$;

-- profanity in free text (application message, posting title): per word, same terms as names (not reserved)
create or replace function public.text_has_profanity(p_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w text;
  v_full text;
begin
  if p_text is null or btrim(p_text) = '' then
    return false;
  end if;
  for w in select x from regexp_split_to_table(p_text, '\s+') x where x <> '' loop
    v_full := public.name_letters(w);
    continue when v_full = '';
    if exists (
      select 1 from public.blocked_name_terms t
       where t.category <> 'reserved'
         and ((t.match_mode = 'substring' and strpos(v_full, t.term) > 0)
              or (t.match_mode = 'token' and t.term = v_full)
              or (t.match_mode = 'code' and t.term = any (
                    select m[1] from regexp_matches(public.name_normalize(w, false), '([a-z]+|[0-9]+)', 'g') m)))) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.require_company_owner(p_company_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  if not exists (select 1 from public.companies c
                  where c.id = p_company_id and not c.is_ai and v_player in (c.founder_id, c.ceo_id)) then
    perform public.api_error('employer_only');
  end if;
  return v_player;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI postings: deterministic per game quarter (contract addendum):
--   c = index of the AI company ordered by ticker, i = 0..aiPostingsPerCompany-1,
--   q = quarter sequence (game_year - 1) x 4 + (quarter - 1)
--   branch = sectorBranches[sector][(c + i) % len], tier = careers.tiers[(2c + i + q) % 5]
-- ---------------------------------------------------------------------------
create or replace function public.refresh_ai_job_postings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q        public.game_quarters;
  v_jobs   jsonb := coalesce(public.config_jsonb('jobs'), '{}'::jsonb);
  v_tiers  jsonb := coalesce(public.config_jsonb('careers', '{tiers}'), '[]'::jsonb);
  v_n      integer := greatest(0, public.cfg_num(v_jobs, '{aiPostingsPerCompany}', 2))::integer;
  v_q      integer;
  v_nt     integer;
  c        record;
  i        integer;
  v_list   jsonb;
  v_branch text;
  v_tier   jsonb;
  v_min    integer;
  v_req    jsonb;
  v_rows   integer;
  v_new    integer := 0;
begin
  q := public.current_game_quarter();
  if q.id is null or jsonb_array_length(v_tiers) = 0 then
    return 0;
  end if;
  if exists (select 1 from public.job_postings p where p.is_ai and p.game_quarter_id = q.id) then
    return 0;
  end if;
  v_q := (q.game_year - 1) * 4 + (q.quarter - 1);
  v_nt := jsonb_array_length(v_tiers);
  update public.job_postings set status = 'closed' where is_ai and status = 'open' and game_quarter_id is distinct from q.id;
  for c in
    select x.id, x.sector_key, (row_number() over (order by x.ticker) - 1)::integer as idx
      from public.companies x where x.is_ai and x.phase = 'listed' and x.ticker is not null
     order by x.ticker
  loop
    v_list := coalesce(v_jobs -> 'sectorBranches' -> c.sector_key, '[]'::jsonb);
    continue when jsonb_array_length(v_list) = 0;
    for i in 0 .. v_n - 1 loop
      v_branch := v_list ->> ((c.idx + i) % jsonb_array_length(v_list));
      v_tier := v_tiers -> ((2 * c.idx + i + v_q) % v_nt);
      v_min := coalesce((v_jobs -> 'tierMinScore' ->> (v_tier ->> 'id'))::integer, 0);
      v_req := jsonb_build_array(jsonb_build_object('branch', v_branch, 'min_score', v_min));
      if v_tier ->> 'id' in ('team_lead', 'c_level') and v_branch <> 'management' then
        v_req := v_req || jsonb_build_array(jsonb_build_object('branch', 'management', 'min_score', v_min / 2));
      end if;
      insert into public.job_postings (company_id, tier, title_key, title, required, salary_cents_per_hour, slots, is_ai,
                                       ai_slot, status, game_quarter_id, posted_at, expires_at)
      values (c.id, (v_tier ->> 'id')::public.job_tier, v_branch || '_' || (v_tier ->> 'id'), null, v_req,
              (v_tier ->> 'salaryCentsPerHour')::bigint, null, true, i, 'open', q.id, q.starts_at, q.ends_at)
      on conflict (company_id, game_quarter_id, ai_slot) where is_ai do nothing;
      get diagnostics v_rows = row_count;
      v_new := v_new + v_rows;
    end loop;
  end loop;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Job board
-- ---------------------------------------------------------------------------
create or replace function public.get_job_board()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_scores jsonb;
  v_level  integer;
begin
  v_player := public.require_player();
  perform public.refresh_ai_job_postings();
  v_scores := public.player_branch_scores(v_player);
  select p.level into v_level from public.profiles p where p.id = v_player;
  return jsonb_build_object(
    'postings', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'company', public.company_json(p.company_id), 'tier', p.tier,
               'title_key', p.title_key, 'title', p.title,
               'min_level', coalesce((public.career_tier(p.tier::text) ->> 'minLevel')::integer, 1),
               'required', p.required,
               'salary_cents_per_hour', p.salary_cents_per_hour,
               'max_salary_cents_per_hour', case when p.is_ai then public.ai_salary_ceiling(p.salary_cents_per_hour,
                                                    public.job_match_score(v_scores, p.required)) end,
               'match_score', public.job_match_score(v_scores, p.required),
               'eligible', v_level >= coalesce((public.career_tier(p.tier::text) ->> 'minLevel')::integer, 1)
                           and public.job_skills_ok(v_scores, p.required),
               'slots_open', case when p.slots is null
                                  then public.config_double('jobs', '{aiSlotsOpen}', 99)::integer  -- unlimited (AI)
                                  else greatest(0, p.slots - (select count(*) from public.player_jobs j
                                                               where j.posting_id = p.id and j.status = 'active'))::integer end,
               'posted_at', p.posted_at, 'expires_at', p.expires_at,
               'my_application', (select jsonb_build_object('id', a.id,
                                          'status', case when a.status = 'offered' and a.offer_expires_at <= now() then 'expired' else a.status end)
                                    from public.job_applications a
                                   where a.posting_id = p.id and a.player_id = v_player
                                   order by a.created_at desc limit 1))
             order by p.is_ai, p.salary_cents_per_hour desc, p.posted_at desc, p.id)
        from public.job_postings p
       where p.status = 'open' and (p.expires_at is null or p.expires_at > now())), '[]'::jsonb),
    'next_refresh_at', (public.current_game_quarter()).ends_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
create or replace function public.apply_for_job(p_request_id uuid, p_posting_id uuid, p_salary_wish_cents_per_hour bigint,
                                                p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  p        public.job_postings;
  v_tier   jsonb;
  v_scores jsonb;
  v_level  integer;
  v_id     uuid := gen_random_uuid();
  v_msg    text := nullif(btrim(coalesce(p_message, '')), '');
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'apply_for_job');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  select * into p from public.job_postings where id = p_posting_id;
  if p.id is null or p.status <> 'open' or (p.expires_at is not null and p.expires_at <= now()) then
    perform public.api_error('job_not_found');
  end if;
  if p_salary_wish_cents_per_hour is null or p_salary_wish_cents_per_hour < 1 then
    perform public.api_error('invalid_argument');
  end if;
  if v_msg is not null and char_length(v_msg) > public.config_double('jobs', '{applicationMessageMaxLength}', 140) then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(v_msg) then
    perform public.api_error('name_profanity');
  end if;
  v_tier := public.career_tier(p.tier::text);
  select pr.level into v_level from public.profiles pr where pr.id = v_player;
  if v_level < coalesce((v_tier ->> 'minLevel')::integer, 1) then
    perform public.api_error('job_level_too_low');
  end if;
  v_scores := public.player_branch_scores(v_player);
  if not public.job_skills_ok(v_scores, p.required) then
    perform public.api_error('job_skills_missing');
  end if;
  perform 1 from public.profiles pr where pr.id = v_player for update;
  if exists (select 1 from public.job_applications a
              where a.player_id = v_player and a.posting_id = p.id
                and (a.status = 'pending' or (a.status = 'offered' and a.offer_expires_at > now()))) then
    perform public.api_error('application_exists');
  end if;
  if (select count(*) from public.job_applications a
       where a.player_id = v_player
         and (a.status = 'pending' or (a.status = 'offered' and a.offer_expires_at > now())))
     >= public.config_double('jobs', '{maxOpenApplications}', 5) then
    perform public.api_error('application_limit');
  end if;

  insert into public.job_applications (id, posting_id, player_id, request_id, salary_wish_cents_per_hour, message, status,
                                       offer_salary_cents_per_hour, offer_expires_at)
  values (v_id, p.id, v_player, p_request_id, p_salary_wish_cents_per_hour, v_msg,
          case when p.is_ai then 'offered' else 'pending' end,
          case when p.is_ai then least(p_salary_wish_cents_per_hour,
                                       public.ai_salary_ceiling(p.salary_cents_per_hour, public.job_match_score(v_scores, p.required))) end,
          case when p.is_ai then now() + make_interval(secs => public.config_double('jobs', '{offerValidHours}', 48) * 3600) end);
  return public.request_complete(v_player, p_request_id, public.application_json(v_id));
end;
$$;

create or replace function public.get_my_applications()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  return jsonb_build_object('applications', coalesce((
    select jsonb_agg(public.application_json(a.id) order by a.created_at desc, a.id)
      from public.job_applications a
     where a.player_id = v_player and a.created_at > now() - interval '30 days'), '[]'::jsonb));
end;
$$;

create or replace function public.counter_offer(p_request_id uuid, p_application_id uuid, p_salary_wish_cents_per_hour bigint)
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
begin
  v_player := public.require_player();
  if p_request_id is null or p_salary_wish_cents_per_hour is null or p_salary_wish_cents_per_hour < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'counter_offer');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into a from public.job_applications where id = p_application_id and player_id = v_player for update;
  if a.id is null or a.status not in ('pending', 'offered') then
    perform public.api_error('application_not_found');
  end if;
  if a.status = 'offered' and a.offer_expires_at <= now() then
    perform public.api_error('offer_expired');
  end if;
  select * into p from public.job_postings where id = a.posting_id;
  if p.is_ai then
    update public.job_applications
       set salary_wish_cents_per_hour = p_salary_wish_cents_per_hour, status = 'offered',
           offer_salary_cents_per_hour = least(p_salary_wish_cents_per_hour,
             public.ai_salary_ceiling(p.salary_cents_per_hour, public.job_match_score(public.player_branch_scores(v_player), p.required))),
           offer_expires_at = now() + make_interval(secs => public.config_double('jobs', '{offerValidHours}', 48) * 3600)
     where id = a.id;
  else
    update public.job_applications
       set salary_wish_cents_per_hour = p_salary_wish_cents_per_hour, status = 'pending',
           offer_salary_cents_per_hour = null, offer_expires_at = null
     where id = a.id;
  end if;
  return public.request_complete(v_player, p_request_id, public.application_json(a.id));
end;
$$;

create or replace function public.withdraw_application(p_request_id uuid, p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  a        public.job_applications;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'withdraw_application');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into a from public.job_applications where id = p_application_id and player_id = v_player for update;
  if a.id is null or a.status not in ('pending', 'offered') then
    perform public.api_error('application_not_found');
  end if;
  update public.job_applications
     set status = case when a.status = 'offered' then 'declined' else 'withdrawn' end
   where id = a.id;
  return public.request_complete(v_player, p_request_id, public.application_json(a.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- The contract and the running job
-- ---------------------------------------------------------------------------
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
  return jsonb_build_object('job', jsonb_build_object(
    'id', j.id,
    'company', public.company_json(j.company_id),
    'tier', j.tier,
    'title_key', j.title_key,
    'title', case when j.title_key is null then j.title end,
    'required', j.required,
    'salary_cents_per_hour', j.salary_cents_per_hour,
    'pay_factor_bps', j.pay_factor_bps,
    'effective_salary_cents_per_hour', j.salary_cents_per_hour * j.pay_factor_bps / 10000,
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
    'quit_cost_cents', j.salary_cents_per_hour * public.config_double('jobs', '{salaryUnitHours}', 12)::bigint,
    'signature', j.signature));
end;
$$;

create or replace function public.get_my_job()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.job_state(public.require_player());
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
  return public.request_complete(v_player, p_request_id, public.job_state(v_player));
end;
$$;

-- Pays the wage accrued since the last payout from the employer's cash (at most
-- careers.paidHoursPerDayCap paid hours per Berlin day), grants work XP per full
-- hour and branch work minutes (every skills.workHoursPerBranchPoint hours one
-- branch point, split evenly over the job's required branches).
create or replace function public.accrue_job_salary(p_job_id uuid, p_now timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now     timestamptz := coalesce(p_now, public.game_now());
  j         public.player_jobs;
  v_ai      boolean;
  v_day     date := (coalesce(p_now, public.game_now()) at time zone 'Europe/Berlin')::date;
  v_paid    integer;
  v_elapsed integer;
  v_minutes integer;
  v_amount  bigint;
  v_pay     bigint := 0;
  v_company uuid;
  v_bal     bigint;
  v_tx      uuid;
  v_xph     double precision;
  v_hours   integer;
  v_xp      integer := 0;
  v_hpp     double precision := greatest(1, public.config_double('skills', '{workHoursPerBranchPoint}', 6));
  v_nb      integer;
  v_share   integer;
  v_bwm     jsonb;
  v_bp      jsonb;
  v_before  integer;
  r         record;
  k         integer := 0;
begin
  select * into j from public.player_jobs where id = p_job_id and status = 'active' for update;
  if j.id is null then
    return 0;
  end if;
  v_elapsed := floor(extract(epoch from (v_now - j.last_paid_at)) / 60)::integer;
  if v_elapsed < 1 then
    return 0;
  end if;
  v_paid := case when j.paid_day = v_day then j.paid_minutes_today else 0 end;
  v_minutes := least(v_elapsed, greatest(0, (public.config_double('careers', '{paidHoursPerDayCap}', 12) * 60)::integer - v_paid));
  select c.is_ai into v_ai from public.companies c where c.id = j.company_id;

  if v_minutes > 0 then
    v_amount := j.salary_cents_per_hour * v_minutes / 60;
    select a.id, a.balance_cents into v_company, v_bal
      from public.ledger_accounts a where a.owner_company_id = j.company_id and a.kind = 'company_cash';
    v_pay := least(v_amount, greatest(coalesce(v_bal, 0), 0));
    if v_pay > 0 then
      v_tx := public.ledger_transfer(v_company, public.ledger_player_account(j.player_id, 'player_cash'), v_pay, 'salary',
                                     'Lohn', 'player_job', j.id,
                                     'salary:' || j.id::text || ':' || to_char(v_now, 'YYYYMMDDHH24MISSUS'), j.player_id);
    end if;
    -- work XP per full paid hour (player companies: workHour.playerCompanyMultiplier)
    v_xph := public.config_double('progression', '{xpSources,workHour,xp}', 40)
           * case when v_ai then 1 else public.config_double('progression', '{xpSources,workHour,playerCompanyMultiplier}', 1.5) end;
    v_hours := (j.experience_minutes + v_minutes) / 60 - j.experience_minutes / 60;
    if v_hours > 0 then
      v_xp := public.grant_xp(j.player_id, 'work_hour', round(v_xph * v_hours)::integer,
                              'work:' || j.id::text || ':' || ((j.experience_minutes + v_minutes) / 60), 'player_job', j.id);
    end if;
    insert into public.salary_payouts (player_job_id, player_id, pay_day, period_start, period_end, minutes_paid, amount_cents,
                                       xp_awarded, ledger_transaction_id)
    values (j.id, j.player_id, v_day, j.last_paid_at, v_now, v_minutes, v_pay, v_xp, v_tx);

    -- branch work minutes and branch points
    perform public.skill_points_ensure(j.player_id);
    select sp.branch_work_minutes, sp.branch_points into v_bwm, v_bp
      from public.player_skill_points sp where sp.player_id = j.player_id for update;
    v_nb := greatest(1, jsonb_array_length(j.required));
    for r in select x ->> 'branch' as branch from jsonb_array_elements(j.required) x loop
      v_share := v_minutes / v_nb + case when k = 0 then v_minutes % v_nb else 0 end;
      v_before := coalesce((v_bwm ->> r.branch)::integer, 0);
      v_bwm := jsonb_set(v_bwm, array[r.branch], to_jsonb(v_before + v_share));
      v_bp := jsonb_set(v_bp, array[r.branch], to_jsonb(coalesce((v_bp ->> r.branch)::integer, 0)
              + ((v_before + v_share) / (v_hpp * 60)::integer - v_before / (v_hpp * 60)::integer)));
      k := k + 1;
    end loop;
    update public.player_skill_points set branch_work_minutes = v_bwm, branch_points = v_bp where player_id = j.player_id;
  end if;

  update public.player_jobs
     set last_paid_at = last_paid_at + make_interval(mins => v_elapsed),
         paid_day = v_day,
         paid_minutes_today = v_paid + v_minutes,
         experience_minutes = experience_minutes + v_minutes,
         earned_total_cents = earned_total_cents + v_pay,
         pay_factor_bps = case when v_minutes > 0 and v_amount > 0 then (v_pay * 10000 / v_amount)::integer else pay_factor_bps end
   where id = j.id;
  return v_pay;
end;
$$;

create or replace function public.accrue_salaries(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n integer := 0;
begin
  for r in select j.id, j.player_id from public.player_jobs j where j.status = 'active' order by j.player_id loop
    perform public.lock_player_accounts(r.player_id);
    if public.accrue_job_salary(r.id, p_now) > 0 then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- one salary = jobs.salaryUnitHours x contract wage
create or replace function public.job_salary_unit_cents(p_job public.player_jobs)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p_job.salary_cents_per_hour * greatest(1, public.config_double('jobs', '{salaryUnitHours}', 12))::bigint;
$$;

create or replace function public.quit_job(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_cash   bigint;
  j        public.player_jobs;
  v_cost   bigint;
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
  perform public.accrue_job_salary(j.id);
  v_cost := public.job_salary_unit_cents(j);
  select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash';
  if v_cash < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'),
                                 (select a.id from public.ledger_accounts a where a.owner_company_id = j.company_id and a.kind = 'company_cash'),
                                 v_cost, 'transfer', 'Kündigung: ein Gehalt an die Firma', 'player_job', j.id,
                                 'quit:' || j.id::text, v_player);
  update public.player_jobs set status = 'ended', ended_at = now(), end_reason = 'quit' where id = j.id;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'paid_cents', v_cost,
    'cash_cents', (select a.balance_cents from public.ledger_accounts a where a.owner_player_id = v_player and a.kind = 'player_cash')));
end;
$$;

create or replace function public.request_raise(p_request_id uuid, p_raise_bps integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
  v_state  jsonb;
  v_ai     boolean;
  v_new    bigint;
  v_cool   double precision := public.config_double('jobs', '{raiseRequest,cooldownDays}', 7);
begin
  v_player := public.require_player();
  if p_request_id is null or p_raise_bps is null or p_raise_bps < 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'request_raise');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into j from public.player_jobs where player_id = v_player and status = 'active' for update;
  if j.id is null then
    perform public.api_error('no_active_job');
  end if;
  if j.raise_requested_at is not null and j.raise_requested_at + make_interval(secs => v_cool * 86400) > now() then
    perform public.api_error('raise_too_soon');
  end if;
  v_state := public.job_state(v_player) -> 'job';
  if p_raise_bps > (v_state ->> 'raise_max_bps')::integer then
    perform public.api_error('raise_too_high');
  end if;
  select c.is_ai into v_ai from public.companies c where c.id = j.company_id;
  v_new := round(j.salary_cents_per_hour * (1 + p_raise_bps / 10000.0))::bigint;
  if v_ai then
    update public.player_jobs
       set salary_cents_per_hour = v_new, raise_requested_at = now(), last_raise_at = now(),
           raise_base_score = public.job_match_score(public.player_branch_scores(v_player), j.required),
           pending_raise_bps = null, pending_raise_at = null
     where id = j.id;
    return public.request_complete(v_player, p_request_id, jsonb_build_object('status', 'accepted', 'salary_cents_per_hour', v_new));
  end if;
  update public.player_jobs
     set raise_requested_at = now(), pending_raise_bps = p_raise_bps, pending_raise_at = now()
   where id = j.id;
  return public.request_complete(v_player, p_request_id,
    jsonb_build_object('status', 'pending', 'salary_cents_per_hour', j.salary_cents_per_hour));
end;
$$;

-- ---------------------------------------------------------------------------
-- Employer side (player companies; caller must be founder or CEO)
-- ---------------------------------------------------------------------------
create or replace function public.create_job_posting(p_request_id uuid, p_company_id uuid, p_tier text, p_title text,
                                                     p_required jsonb, p_salary_cents_per_hour bigint, p_slots integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_id     uuid := gen_random_uuid();
  v_zero   jsonb := public.skill_branch_zero();
begin
  v_player := public.require_company_owner(p_company_id);
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'create_job_posting');
  if v_replay is not null then
    return v_replay;
  end if;
  if public.career_tier(p_tier) is null
     or p_title is null or char_length(btrim(p_title)) not between 3 and 60
     or p_salary_cents_per_hour is null or p_salary_cents_per_hour < 1
     or p_slots is null or p_slots not between 1 and 100
     or p_required is null or jsonb_typeof(p_required) <> 'array' or jsonb_array_length(p_required) not between 1 and 8
     or exists (select 1 from jsonb_array_elements(p_required) r
                 where not (v_zero ? coalesce(r ->> 'branch', ''))
                    or jsonb_typeof(r -> 'min_score') <> 'number' or (r ->> 'min_score')::integer < 0) then
    perform public.api_error('invalid_argument');
  end if;
  if public.text_has_profanity(p_title) then
    perform public.api_error('name_profanity');
  end if;
  insert into public.job_postings (id, company_id, tier, title, required, salary_cents_per_hour, slots, is_ai, status,
                                   created_by, request_id)
  values (v_id, p_company_id, p_tier::public.job_tier, btrim(p_title),
          (select jsonb_agg(jsonb_build_object('branch', r ->> 'branch', 'min_score', (r ->> 'min_score')::integer))
             from jsonb_array_elements(p_required) r),
          p_salary_cents_per_hour, p_slots, false, 'open', v_player, p_request_id);
  return public.request_complete(v_player, p_request_id, public.posting_json(v_id)
    || jsonb_build_object('salary_cents_per_hour', p_salary_cents_per_hour, 'slots', p_slots, 'status', 'open'));
end;
$$;

create or replace function public.close_job_posting(p_request_id uuid, p_posting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  p        public.job_postings;
begin
  select * into p from public.job_postings where id = p_posting_id;
  if p.id is null then
    perform public.require_player();
    perform public.api_error('job_not_found');
  end if;
  v_player := public.require_company_owner(p.company_id);
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'close_job_posting');
  if v_replay is not null then
    return v_replay;
  end if;
  update public.job_postings set status = 'closed' where id = p.id;
  update public.job_applications set status = 'closed' where posting_id = p.id and status = 'pending';
  return public.request_complete(v_player, p_request_id, jsonb_build_object('id', p.id, 'status', 'closed'));
end;
$$;

create or replace function public.get_company_applications(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_company_owner(p_company_id);
  return jsonb_build_object('applications', coalesce((
    select jsonb_agg(public.application_json(a.id) || jsonb_build_object('applicant', jsonb_build_object(
             'nickname', pr.nickname, 'avatar_key', pr.avatar_key, 'level', pr.level,
             'branch_scores', public.player_branch_scores(pr.id),
             'match_score', public.job_match_score(public.player_branch_scores(pr.id), p.required)))
             order by a.created_at desc, a.id)
      from public.job_applications a
      join public.job_postings p on p.id = a.posting_id
      join public.profiles pr on pr.id = a.player_id
     where p.company_id = p_company_id and a.created_at > now() - interval '30 days'), '[]'::jsonb));
end;
$$;

create or replace function public.respond_application(p_request_id uuid, p_application_id uuid, p_action text,
                                                      p_salary_cents_per_hour bigint default null)
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
begin
  select * into a from public.job_applications where id = p_application_id;
  if a.id is null then
    perform public.require_player();
    perform public.api_error('application_not_found');
  end if;
  select * into p from public.job_postings where id = a.posting_id;
  v_player := public.require_company_owner(p.company_id);
  if p_request_id is null or coalesce(p_action, '') not in ('accept', 'reject', 'counter')
     or (p_action = 'counter' and (p_salary_cents_per_hour is null or p_salary_cents_per_hour < 1)) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'respond_application');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into a from public.job_applications where id = p_application_id for update;
  if a.status <> 'pending' then
    perform public.api_error('application_not_found');
  end if;
  if p_action = 'reject' then
    update public.job_applications set status = 'rejected' where id = a.id;
  else
    update public.job_applications
       set status = 'offered',
           offer_salary_cents_per_hour = case when p_action = 'accept' then a.salary_wish_cents_per_hour else p_salary_cents_per_hour end,
           offer_expires_at = now() + make_interval(secs => public.config_double('jobs', '{offerValidHours}', 48) * 3600)
     where id = a.id;
  end if;
  return public.request_complete(v_player, p_request_id, public.application_json(a.id));
end;
$$;

create or replace function public.get_company_team(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_company_owner(p_company_id);
  return jsonb_build_object('members', coalesce((
    select jsonb_agg(jsonb_build_object(
             'player_job_id', j.id, 'nickname', pr.nickname, 'avatar_key', pr.avatar_key,
             'title', coalesce(j.title, j.title_key), 'salary_cents_per_hour', j.salary_cents_per_hour,
             'productivity_bps', public.job_productivity_bps(public.job_match_score(public.player_branch_scores(pr.id), j.required)),
             'started_at', j.started_at,
             'pending_raise', case when j.pending_raise_bps is not null
                                   then jsonb_build_object('requested_bps', j.pending_raise_bps, 'created_at', j.pending_raise_at) end)
             order by j.started_at, j.id)
      from public.player_jobs j join public.profiles pr on pr.id = j.player_id
     where j.company_id = p_company_id and j.status = 'active'), '[]'::jsonb));
end;
$$;

create or replace function public.fire_employee(p_request_id uuid, p_player_job_id uuid)
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
  v_acc    uuid;
  v_bal    bigint;
begin
  select * into j from public.player_jobs where id = p_player_job_id;
  if j.id is null or j.status <> 'active' then
    perform public.require_player();
    perform public.api_error('no_active_job');
  end if;
  v_player := public.require_company_owner(j.company_id);
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'fire_employee');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.lock_player_accounts(j.player_id);
  perform public.accrue_job_salary(j.id);
  select * into j from public.player_jobs where id = p_player_job_id for update;
  v_cost := public.job_salary_unit_cents(j);
  select a.id, a.balance_cents into v_acc, v_bal from public.ledger_accounts a where a.owner_company_id = j.company_id and a.kind = 'company_cash';
  if coalesce(v_bal, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  perform public.ledger_transfer(v_acc, public.ledger_player_account(j.player_id, 'player_cash'), v_cost, 'salary',
                                 'Abfindung: ein Gehalt', 'player_job', j.id, 'severance:' || j.id::text, j.player_id);
  update public.player_jobs set status = 'ended', ended_at = now(), end_reason = 'fired' where id = j.id;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'player_job_id', j.id, 'status', 'fired', 'severance_cents', v_cost));
end;
$$;

-- The employer can never lower a wage: only accept or reject a requested raise.
create or replace function public.respond_raise(p_request_id uuid, p_player_job_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  j        public.player_jobs;
  v_new    bigint;
begin
  select * into j from public.player_jobs where id = p_player_job_id;
  if j.id is null or j.status <> 'active' then
    perform public.require_player();
    perform public.api_error('no_active_job');
  end if;
  v_player := public.require_company_owner(j.company_id);
  if p_request_id is null or p_accept is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'respond_raise');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into j from public.player_jobs where id = p_player_job_id for update;
  if j.pending_raise_bps is null then
    perform public.api_error('invalid_argument');
  end if;
  if p_accept then
    v_new := round(j.salary_cents_per_hour * (1 + j.pending_raise_bps / 10000.0))::bigint;
    update public.player_jobs
       set salary_cents_per_hour = v_new, last_raise_at = now(), pending_raise_bps = null, pending_raise_at = null,
           raise_base_score = public.job_match_score(public.player_branch_scores(j.player_id), j.required)
     where id = j.id;
  else
    v_new := j.salary_cents_per_hour;
    update public.player_jobs set pending_raise_bps = null, pending_raise_at = null where id = j.id;
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'status', case when p_accept then 'accepted' else 'rejected' end, 'salary_cents_per_hour', v_new));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.career_tier(text)', 'public.job_match_score(jsonb, jsonb)', 'public.job_skills_ok(jsonb, jsonb)',
    'public.ai_salary_ceiling(bigint, integer)', 'public.job_productivity_bps(integer)', 'public.company_json(uuid)',
    'public.posting_json(uuid)', 'public.application_json(uuid)', 'public.text_has_profanity(text)',
    'public.require_company_owner(uuid)', 'public.refresh_ai_job_postings()', 'public.get_job_board()',
    'public.apply_for_job(uuid, uuid, bigint, text)', 'public.get_my_applications()', 'public.counter_offer(uuid, uuid, bigint)',
    'public.withdraw_application(uuid, uuid)', 'public.job_state(uuid)', 'public.get_my_job()',
    'public.sign_contract(uuid, uuid, text)', 'public.accrue_job_salary(uuid, timestamptz)', 'public.accrue_salaries(timestamptz)',
    'public.job_salary_unit_cents(public.player_jobs)', 'public.quit_job(uuid)', 'public.request_raise(uuid, integer)',
    'public.create_job_posting(uuid, uuid, text, text, jsonb, bigint, integer)', 'public.close_job_posting(uuid, uuid)',
    'public.get_company_applications(uuid)', 'public.respond_application(uuid, uuid, text, bigint)',
    'public.get_company_team(uuid)', 'public.fire_employee(uuid, uuid)', 'public.respond_raise(uuid, uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_job_board()', 'public.apply_for_job(uuid, uuid, bigint, text)', 'public.get_my_applications()',
    'public.counter_offer(uuid, uuid, bigint)', 'public.withdraw_application(uuid, uuid)', 'public.get_my_job()',
    'public.sign_contract(uuid, uuid, text)', 'public.quit_job(uuid)', 'public.request_raise(uuid, integer)',
    'public.create_job_posting(uuid, uuid, text, text, jsonb, bigint, integer)', 'public.close_job_posting(uuid, uuid)',
    'public.get_company_applications(uuid)', 'public.respond_application(uuid, uuid, text, bigint)',
    'public.get_company_team(uuid)', 'public.fire_employee(uuid, uuid)', 'public.respond_raise(uuid, uuid, boolean)'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
