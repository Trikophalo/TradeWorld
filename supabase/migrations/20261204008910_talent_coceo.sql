-- =============================================================================
-- NEXA · 8910 · Mit-Geschäftsführung durch Talente (ADR-199)
-- =============================================================================
-- * talent_coceo_appoint(request, key, wage, autonomy, budget): an own talent of tier >= coCeo.minTier (trait
--   "leader": one lower) becomes Mit-Geschäftsführer (at most coCeo.max). Needs "say" (Mitspracherecht) and a wage of
--   at least the demand x (1 + coCeo.wageBonusBps). Autonomy "advise" (only recommends) or "decide" (acts within the
--   day budget, at most coCeo.maxBudgetCents). talent_coceo_set changes autonomy and budget or removes the role.
-- * talents_coceo_run(now) (replaces the 8900 hook, called by talents_run_due): once per hour and Mit-GF:
--   1. responds to an open company event waiting coCeo.eventDelayMinutes: strategy by personality (talentCoCeoPick;
--      cautious = highest mitigation, bold = fewest steps); "advise" only logs the recommendation;
--   2. switches the existing autopilot (ADR-180) on, unless the owner undid that before;
--   3. learns the cheapest learnable Fertigkeit (ADR-194, same rules and ledger booking) within the remaining day
--      budget (cautious: half of it) and the free cash beyond talentsCashCover.
--   Every decision: talent_events ('decision' / 'advice'), company news, a notification with the name.
-- * talent_undo_decision(request, id): undoes a reversible decision (event strategy before a step, autopilot).
-- Idempotent: runs unchanged as supabase/updates/20261204008910_talent_coceo.sql.

alter table public.talents add column if not exists coceo_last_run timestamptz;

create or replace function public.talent_coceo_style(p_traits text[])
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select tr ->> 'style'
                     from unnest(coalesce(p_traits, '{}'::text[])) with ordinality u(k, n)
                     join jsonb_array_elements(coalesce(public.talents_cfg() -> 'traits', '[]'::jsonb)) tr on tr ->> 'key' = u.k
                    where tr ? 'style' order by u.n limit 1), 'balanced');
$$;

-- talentCoCeoPick
create or replace function public.talent_coceo_pick(p_strategies jsonb, p_style text)
returns text
language sql
stable
set search_path = ''
as $$
  select s ->> 'key'
    from jsonb_array_elements(coalesce(p_strategies, '[]'::jsonb)) with ordinality x(s, n)
   order by case p_style
              when 'cautious' then coalesce((s ->> 'mitigation')::double precision, 0)
              when 'bold' then -jsonb_array_length(coalesce(s -> 'steps', '[]'::jsonb)) * 10
                               + coalesce((s ->> 'mitigation')::double precision, 0)
              else coalesce((s ->> 'mitigation')::double precision, 0) / (1 + jsonb_array_length(coalesce(s -> 'steps', '[]'::jsonb)))
            end desc, n
   limit 1;
$$;

create or replace function public.talent_coceo_eligible(t public.talents)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select t.tier >= public.cfg_num(public.talents_cfg(), '{coCeo,minTier}', 2)
                   - case when exists (select 1 from jsonb_array_elements(coalesce(public.talents_cfg() -> 'traits', '[]'::jsonb)) tr
                                        where tr ->> 'key' = any (t.traits) and (tr ->> 'leader')::boolean) then 1 else 0 end;
$$;

create or replace function public.talent_coceo_appoint(p_request_id uuid, p_talent_key text, p_wage_cents bigint,
                                                       p_autonomy text, p_budget_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  cfg      jsonb := public.talents_cfg();
  v_co     uuid;
  t        public.talents;
  v_min    bigint;
  v_ben    text[];
begin
  v_player := public.require_player();
  if p_request_id is null or p_talent_key is null or p_wage_cents is null or p_wage_cents % 100 <> 0
     or p_autonomy not in ('advise', 'decide') or p_budget_cents is null or p_budget_cents < 0
     or p_budget_cents > public.cfg_num(cfg, '{coCeo,maxBudgetCents}', 10000000) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'talent_coceo_appoint');
  if v_replay is not null then
    return v_replay;
  end if;
  v_co := public.talent_my_company(v_player);
  perform 1 from public.player_companies where company_id = v_co for update;
  select * into t from public.talents where talent_key = p_talent_key for update;
  if v_co is null or t.company_id is distinct from v_co then
    perform public.api_error('invalid_argument');
  end if;
  if t.is_coceo then
    perform public.api_error('already_hired');
  end if;
  if not public.talent_coceo_eligible(t) then
    perform public.api_error('not_eligible');
  end if;
  if (select count(*) from public.talents x where x.company_id = v_co and x.is_coceo)
     >= public.cfg_num(cfg, '{coCeo,max}', 2) then
    perform public.api_error('coceo_full');
  end if;
  v_min := ceil(t.wage_demand_cents * (10000 + public.cfg_num(cfg, '{coCeo,wageBonusBps}', 3000)) / 10000.0 / 100.0)::bigint * 100;
  if p_wage_cents < greatest(v_min, t.wage_cents) then
    perform public.api_error('offer_too_low');
  end if;
  v_ben := array(select distinct b from unnest(t.benefits || array['say']) b order by 1);
  if public.talent_offer_cost(p_wage_cents, v_ben) * coalesce((cfg ->> 'cashCoverHours')::integer, 12)
     > (public.talent_company_facts(v_co) ->> 'free_cash_cents')::bigint then
    perform public.api_error('insufficient_funds');
  end if;
  update public.talents
     set is_coceo = true, wage_cents = p_wage_cents, benefits = v_ben, coceo_autonomy = p_autonomy,
         coceo_budget_cents = p_budget_cents, coceo_last_run = null
   where talent_key = t.talent_key;
  perform public.talent_log(v_co, t.talent_key, 'coceo_appointed',
    jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'autonomy', p_autonomy, 'budget_cents', p_budget_cents,
                       'wage_cents', p_wage_cents));
  return public.request_complete(v_player, p_request_id, public.company_talents_json(v_co));
end;
$$;
comment on function public.talent_coceo_appoint(uuid, text, bigint, text, bigint) is
  'RPC: appoints an own talent as Mit-Geschäftsführer (ADR-199). Errors not_eligible, coceo_full, offer_too_low, insufficient_funds.';

create or replace function public.talent_coceo_set(p_request_id uuid, p_talent_key text, p_autonomy text, p_budget_cents bigint,
                                                   p_remove boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_co     uuid;
  t        public.talents;
begin
  v_player := public.require_player();
  if p_request_id is null or p_talent_key is null
     or (not coalesce(p_remove, false) and (p_autonomy not in ('advise', 'decide') or p_budget_cents is null or p_budget_cents < 0
         or p_budget_cents > public.cfg_num(public.talents_cfg(), '{coCeo,maxBudgetCents}', 10000000))) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'talent_coceo_set');
  if v_replay is not null then
    return v_replay;
  end if;
  v_co := public.talent_my_company(v_player);
  select * into t from public.talents where talent_key = p_talent_key for update;
  if v_co is null or t.company_id is distinct from v_co or not t.is_coceo then
    perform public.api_error('invalid_argument');
  end if;
  if coalesce(p_remove, false) then
    update public.talents set is_coceo = false, coceo_budget_cents = 0 where talent_key = t.talent_key;
    perform public.talent_log(v_co, t.talent_key, 'coceo_removed', jsonb_build_object('name', public.talent_name(t)));
  else
    update public.talents set coceo_autonomy = p_autonomy, coceo_budget_cents = p_budget_cents where talent_key = t.talent_key;
  end if;
  return public.request_complete(v_player, p_request_id, public.company_talents_json(v_co));
end;
$$;

create or replace function public.talent_undo_decision(p_request_id uuid, p_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_co     uuid;
  e        public.talent_events;
  ev       public.player_company_events;
begin
  v_player := public.require_player();
  if p_request_id is null or p_event_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'talent_undo_decision');
  if v_replay is not null then
    return v_replay;
  end if;
  v_co := public.talent_my_company(v_player);
  select * into e from public.talent_events where id = p_event_id for update;
  if v_co is null or e.company_id is distinct from v_co or not e.reversible or e.undone_at is not null then
    perform public.api_error('invalid_argument');
  end if;
  case e.payload ->> 'action'
    when 'autopilot_on' then
      update public.company_autopilot set enabled = false, updated_at = now() where company_id = v_co;
    when 'event_strategy' then
      select * into ev from public.player_company_events where id = (e.payload ->> 'event_id')::uuid for update;
      if ev.id is null or ev.status not in ('open', 'accepted')
         or exists (select 1 from public.company_event_steps s where s.event_id = ev.id) then
        perform public.api_error('locked');
      end if;
      update public.player_company_events set strategy = null, status = 'open' where id = ev.id;
    else
      perform public.api_error('invalid_argument');
  end case;
  update public.talent_events set undone_at = now() where id = e.id;
  return public.request_complete(v_player, p_request_id, public.company_talents_json(v_co));
end;
$$;
comment on function public.talent_undo_decision(uuid, bigint) is
  'RPC: the owner undoes a reversible decision of a Mit-Geschäftsführer (ADR-199). Errors locked, invalid_argument.';

-- One decision: log, news and a notification with the name
create or replace function public.talent_coceo_said(t public.talents, p_kind text, p_payload jsonb, p_text text,
                                                    p_cost bigint, p_reversible boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  v_id := public.talent_log(t.company_id, t.talent_key, p_kind,
            p_payload || jsonb_build_object('name', public.talent_name(t), 'text', p_text), p_cost, p_reversible);
  perform public.talent_notify_founder(t.company_id,
    case when p_kind = 'advice' then 'Empfehlung der Mit-Geschäftsführung' else 'Entscheidung der Mit-Geschäftsführung' end,
    public.talent_name(t) || ' (Mit-GF) ' || p_text, jsonb_build_object('talent_key', t.talent_key, 'event_id', v_id),
    'talent:coceo:' || v_id::text);
end;
$$;

create or replace function public.talents_coceo_run(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.talents_cfg();
  scfg    jsonb := public.company_skills_cfg();
  t       public.talents;
  pc      public.player_companies;
  ev      public.player_company_events;
  v_style text;
  v_pick  text;
  v_day   date := (p_now at time zone 'Europe/Berlin')::date;
  v_spent bigint;
  v_limit bigint;
  v_free  bigint;
  v_cover bigint;
  v_n     integer := 0;
  s       jsonb;
  cs      public.company_skills;
  v_lvl   integer;
  v_need  text;
  v_cost  bigint;
  v_best  jsonb;
  v_bestc bigint;
  v_hours double precision;
  v_max   integer := coalesce((scfg ->> 'maxLevel')::integer, 5);
begin
  for t in select * from public.talents x
            where x.is_coceo and x.company_id is not null
              and (x.coceo_last_run is null or x.coceo_last_run <= p_now - interval '1 hour')
            order by x.talent_key for update skip locked
  loop
    select * into pc from public.player_companies where company_id = t.company_id and status = 'active';
    continue when pc.company_id is null;
    update public.talents set coceo_last_run = p_now where talent_key = t.talent_key;
    v_style := public.talent_coceo_style(t.traits);
    v_spent := case when t.coceo_spent_day = v_day then t.coceo_spent_cents else 0 end;

    -- 1. company event without a response
    ev := null;
    select * into ev from public.player_company_events e
     where e.company_id = t.company_id and e.status = 'open' and e.strategy is null
       and e.started_at <= p_now - make_interval(mins => public.cfg_num(cfg, '{coCeo,eventDelayMinutes}', 30)::integer)
     order by e.started_at desc limit 1;
    if ev.id is not null
       and not exists (select 1 from public.talent_events x where x.company_id = t.company_id
                         and x.kind in ('decision', 'advice') and x.payload ->> 'event_id' = ev.id::text) then
      v_pick := public.talent_coceo_pick(ev.definition -> 'strategies', v_style);
      if v_pick is not null then
        if t.coceo_autonomy = 'decide' then
          update public.player_company_events set strategy = v_pick,
                 status = case when jsonb_array_length(coalesce((select s2 -> 'steps' from jsonb_array_elements(ev.definition -> 'strategies') s2
                                                                   where s2 ->> 'key' = v_pick limit 1), '[]'::jsonb)) = 0
                               then 'accepted' else status end
           where id = ev.id;
          perform public.talent_coceo_said(t, 'decision',
            jsonb_build_object('action', 'event_strategy', 'event_id', ev.id, 'strategy', v_pick, 'style', v_style),
            'hat auf das Ereignis reagiert: Strategie „' || v_pick || '“.', 0, true);
        else
          perform public.talent_coceo_said(t, 'advice',
            jsonb_build_object('action', 'event_strategy', 'event_id', ev.id, 'strategy', v_pick, 'style', v_style),
            'empfiehlt für das Ereignis die Strategie „' || v_pick || '“.', 0, false);
        end if;
        v_n := v_n + 1;
      end if;
    end if;

    continue when t.coceo_autonomy <> 'decide';

    -- 2. the autopilot (ADR-180), unless the owner undid that before
    if not coalesce((select a.enabled from public.company_autopilot a where a.company_id = t.company_id), false)
       and not exists (select 1 from public.talent_events x where x.company_id = t.company_id
                         and x.payload ->> 'action' = 'autopilot_on') then
      insert into public.company_autopilot as a (company_id, enabled, enabled_at, updated_at)
      values (t.company_id, true, p_now, now())
      on conflict (company_id) do update set enabled = true, enabled_at = excluded.enabled_at, updated_at = now();
      perform public.talent_coceo_said(t, 'decision', jsonb_build_object('action', 'autopilot_on'),
        'hat den Autopiloten eingeschaltet.', 0, true);
      v_n := v_n + 1;
    end if;

    -- 3. the cheapest learnable Fertigkeit within the budget
    v_limit := case when v_style = 'cautious'
                    then (greatest(0, t.coceo_budget_cents - v_spent) * public.cfg_num(cfg, '{coCeo,cautiousSpendBps}', 5000) / 10000)::bigint
                    else greatest(0, t.coceo_budget_cents - v_spent) end;
    continue when v_limit <= 0;
    select a.balance_cents - pc.unpaid_cents into v_free
      from public.ledger_accounts a where a.owner_company_id = t.company_id and a.kind = 'company_cash' for update;
    v_cover := coalesce((select sum(public.talent_offer_cost(x.wage_cents, x.benefits)) from public.talents x
                          where x.company_id = t.company_id), 0) * coalesce((cfg ->> 'cashCoverHours')::integer, 12);
    v_best := null;
    v_bestc := null;
    for s in select x from jsonb_array_elements(coalesce(scfg -> 'skills', '[]'::jsonb)) x loop
      cs := null;
      select * into cs from public.company_skills k where k.company_id = t.company_id and k.skill_key = s ->> 'key';
      v_lvl := coalesce(cs.level, 0);
      continue when v_lvl >= v_max or cs.ready_at > p_now;
      v_need := s -> 'requires' ->> v_lvl;
      continue when v_need is not null and not (v_need = any (public.company_held_skills(t.company_id)));
      v_cost := coalesce((scfg -> 'costCentsByLevel' ->> v_lvl)::bigint, 0);
      continue when v_cost > v_limit or v_cost > coalesce(v_free, 0) - v_cover;
      if v_bestc is null or v_cost < v_bestc then
        v_best := s || jsonb_build_object('_level', v_lvl);
        v_bestc := v_cost;
      end if;
    end loop;
    if v_best is not null then
      v_lvl := (v_best ->> '_level')::integer;
      v_hours := coalesce((scfg -> 'trainingHoursByLevel' ->> v_lvl)::double precision, 0);
      if v_bestc > 0 then
        perform public.ledger_transfer(public.company_cash_account(t.company_id), public.ledger_system_account('households'),
                                       v_bestc, 'company_costs', 'Fertigkeit: Schulung (Mit-GF)', 'company', t.company_id,
                                       'talent_coceo_skill:' || t.talent_key || ':' || (v_best ->> 'key') || ':' || (v_lvl + 1)::text
                                         || ':' || t.company_id::text, pc.founder_id);
      end if;
      insert into public.company_skills as k (company_id, skill_key, level, ready_at, spent_cents, updated_at)
      values (t.company_id, v_best ->> 'key', v_lvl + 1, p_now + make_interval(secs => v_hours * 3600), v_bestc, now())
      on conflict (company_id, skill_key) do update
        set level = k.level + 1, ready_at = excluded.ready_at, spent_cents = k.spent_cents + excluded.spent_cents, updated_at = now();
      update public.talents set coceo_spent_day = v_day, coceo_spent_cents = v_spent + v_bestc where talent_key = t.talent_key;
      perform public.talent_coceo_said(t, 'decision',
        jsonb_build_object('action', 'skill', 'skill_key', v_best ->> 'key', 'level', v_lvl + 1),
        'hat die Fertigkeit „' || (v_best ->> 'key') || '“ auf Stufe ' || (v_lvl + 1) || ' gebracht.', v_bestc, false);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

do $do$
declare
  f text;
begin
  foreach f in array array['public.talent_coceo_style(text[])', 'public.talent_coceo_pick(jsonb, text)',
                           'public.talent_coceo_eligible(public.talents)',
                           'public.talent_coceo_said(public.talents, text, jsonb, text, bigint, boolean)',
                           'public.talents_coceo_run(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.talent_coceo_appoint(uuid, text, bigint, text, bigint)',
                           'public.talent_coceo_set(uuid, text, text, bigint, boolean)',
                           'public.talent_undo_decision(uuid, bigint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$do$;
