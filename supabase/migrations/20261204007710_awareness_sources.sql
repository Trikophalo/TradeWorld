-- =============================================================================
-- NEXA · 7710 · Awareness, one model (ADR-188): every single event goes through company_awareness_add
-- =============================================================================
-- Campaigns, solved events, CEO interviews, business moves, pitches, protests and the news show used to write
-- player_companies.awareness directly (some without any cap, some with the old stage cap, none with a trace). They
-- now call company_awareness_add(company, source, delta): capped by the company's cap, floored, booked by source in
-- company_awareness_log. Tasks and the autopilot already go through company_awareness_boost, now a wrapper of it.
-- Full redefinitions of the live functions (copied from the database after 7310), changed only at the awareness
-- write. Idempotent: runs unchanged as supabase/updates/.

create or replace function public.start_campaign(p_request_id uuid, p_company_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_player uuid;
  v_replay jsonb;
  pc       public.player_companies;
  v_now    timestamptz := public.game_now();
  v_su     jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_cost   bigint;
  v_free   bigint;
  v_luck   double precision;
  v_factor double precision;
  v_stage  integer;
  v_cap    double precision;
  v_aw     double precision;
  v_id     uuid;
begin
  v_player := public.require_player();
  if p_request_id is null or p_company_id is null or coalesce(p_kind, '') not in ('flyer', 'online', 'tv') then
    perform public.api_error('invalid_argument');
  end if;
  perform public.require_company_owner(p_company_id);
  v_replay := public.request_begin(v_player, p_request_id, 'start_campaign');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = p_company_id and status = 'active' for update;
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  if exists (select 1 from public.company_campaigns x where x.company_id = p_company_id and x.ends_at > v_now) then
    perform public.api_error('campaign_running');
  end if;
  -- ADR-134 ad_agency of the founder
  v_cost := public.company_campaign_cost_cents(p_company_id, p_kind);
  -- free cash: open bills come first (as expand_company and event steps)
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a where a.owner_company_id = p_company_id and a.kind = 'company_cash' for update;
  if coalesce(v_free, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.company_cash_account(p_company_id), public.ledger_system_account('households'), v_cost,
                                   'company_costs', 'Marketing-Kampagne', 'company', p_company_id,
                                   'campaign:' || p_company_id::text || ':' || p_request_id::text, v_player);
  end if;
  v_luck := public.campaign_luck(random());
  v_factor := public.campaign_factor(p_kind, pc.quality, v_luck);
  -- awareness at once, capped by the growth stage (ADR-062) as in the quarter close; never lowered
  v_stage := least(greatest(coalesce(public.company_stage(p_company_id), 0), 0),
                   greatest(jsonb_array_length(coalesce(v_su #> '{stages,awarenessCaps}', '[1]'::jsonb)) - 1, 0));
  v_cap := greatest(public.cfg_num(v_su, '{awareness,min}', 0.01),
                    coalesce((v_su #>> array['stages', 'awarenessCaps', v_stage::text])::double precision, 1));
  -- ADR-188: the jump at once, capped by the company's awareness cap and booked as "campaign"
  v_aw := pc.awareness + public.company_awareness_add(p_company_id, 'campaign', public.campaign_kind_num(p_kind, 'awareness'));
  insert into public.company_campaigns (company_id, kind, cost_cents, luck, demand_factor, awareness_gain, started_at, ends_at,
                                        created_by, request_id)
  values (p_company_id, p_kind, v_cost, v_luck, v_factor, greatest(0, v_aw - pc.awareness), v_now,
          v_now + make_interval(secs => greatest(1, public.campaign_kind_num(p_kind, 'hours')) * 3600), v_player, p_request_id)
  returning id into v_id;
  perform public.company_news_add(p_company_id, 'campaign_started',
    jsonb_build_object('kind', p_kind, 'resonance', public.campaign_resonance(v_luck),
                       'demand_bps', round(((v_factor - 1) * 10000)::numeric)::integer));
  return public.request_complete(v_player, p_request_id, public.campaign_json(v_id));
end;
$function$;

create or replace function public.company_event_solve(p_event uuid, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e       public.player_company_events;
  v_strat jsonb;
  v_mit   double precision;
  v_size  double precision;
  v_bps   integer;
  v_shock integer;
  v_name  text;
begin
  select * into e from public.player_company_events where id = p_event for update;
  if e.id is null or e.status not in ('open', 'in_force') then
    return;
  end if;
  v_strat := public.company_event_strategy_def(e);
  v_mit := least(1, greatest(0, public.cfg_num(v_strat, '{mitigation}', 0)));
  update public.player_company_events set status = 'solved', resolved_at = p_at, mitigation = v_mit where id = e.id;
  if not e.bonus_applied then
    perform public.company_awareness_add(e.company_id, 'event', public.cfg_num(v_strat, '{bonus,awareness}', 0));  -- ADR-188
    update public.player_companies
       set quality = least(1, greatest(0, quality + public.cfg_num(v_strat, '{bonus,quality}', 0)))
     where company_id = e.company_id;
    update public.player_company_events set bonus_applied = true where id = e.id;
  end if;
  -- resolutionShockBps: crisis size × mitigation, chance size / 2 × mitigation
  v_size := public.cfg_num(public.company_events_cfg(), array['shareShockBps', (e.severity - 1)::text],
                           case e.severity when 1 then 400 when 2 then 900 else 1500 end);
  v_bps := round((case when e.polarity = 'crisis' then v_size * v_mit else v_size / 2 * v_mit end)::numeric)::integer;
  v_shock := public.company_event_share_shock(e.company_id, v_bps);
  update public.player_company_events set resolution_shock_bps = v_shock where id = e.id;
  perform public.company_news_add(e.company_id, 'event_solved',
    jsonb_build_object('event_id', e.id, 'archetype', e.archetype, 'polarity', e.polarity, 'severity', e.severity,
                       'strategy', e.strategy, 'mitigation', round(v_mit::numeric, 4)::double precision, 'share_shock_bps', v_shock));
  select c.name into v_name from public.companies c where c.id = e.company_id;
  perform public.company_event_notify(e.id,
    case when e.polarity = 'crisis' then 'Krise gemeistert: ' || v_name else 'Chance genutzt: ' || v_name end,
    null, 'company_event:' || e.id::text || ':solved');
end;
$function$;

create or replace function public.company_interview_finish(p_id bigint, p_status text, p_answers jsonb, p_points integer, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e        jsonb := coalesce(public.interviews_cfg() -> 'effects', '{}'::jsonb);
  iv       public.company_interviews;
  v_aw     integer;
  v_rep    double precision;
  v_max    integer := coalesce((e ->> 'maxAwarenessBps')::integer, 300);
  v_maxr   double precision := coalesce((e ->> 'maxReputation')::double precision, 3);
begin
  select * into iv from public.company_interviews where id = p_id for update;
  if iv.id is null or iv.status <> 'requested' then
    return;
  end if;
  v_aw := case p_status
            when 'answered' then greatest(-v_max, least(v_max, coalesce(p_points, 0) * coalesce((e ->> 'awarenessPerPointBps')::integer, 60)))
            when 'declined' then coalesce((e ->> 'declineAwarenessBps')::integer, -80)
            else coalesce((e ->> 'ignoreAwarenessBps')::integer, -120) end;
  v_rep := case when p_status = 'answered' then greatest(-v_maxr, least(v_maxr, coalesce(p_points, 0) * coalesce((e ->> 'reputationPerPoint')::double precision, 0.5)))
                when p_status = 'declined' then coalesce((e ->> 'declineReputation')::double precision, -0.5)
                else coalesce((e ->> 'ignoreReputation')::double precision, -1) end;
  perform public.company_awareness_add(iv.company_id, 'interview', v_aw / 10000.0);  -- ADR-188
  if v_rep <> 0 then
    perform public.listed_ensure(iv.company_id);
    perform public.company_reputation_bump(iv.company_id, v_rep);
  end if;
  update public.company_interviews
     set status = p_status, answers = p_answers, score = p_points, awareness_bps = v_aw, reputation_delta = v_rep,
         answered_at = p_now
   where id = p_id;
end;
$function$;

create or replace function public.company_moves_run_due(p_now timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cfg     jsonb := public.company_moves_cfg();
  v_now     timestamptz := coalesce(p_now, public.game_now());
  m         record;
  v_kind    text;
  v_risk    text;
  v_ok      boolean;
  v_pay     bigint;
  v_gain    double precision;
  v_hh      uuid := public.ledger_system_account('households');
  v_hh_bal  bigint;
  v_done    integer := 0;
begin
  for m in select x.* from public.company_moves x where x.status = 'running' and x.ends_at <= v_now
            order by x.ends_at, x.id for update skip locked loop
    select mv ->> 'kind', mv ->> 'risk' into v_kind, v_risk
      from jsonb_array_elements(coalesce(v_cfg -> 'moves', '[]'::jsonb)) mv where mv ->> 'key' = m.move_key;
    v_kind := coalesce(v_kind, 'cash');
    v_risk := coalesce(v_risk, 'normal');
    v_ok := random() * 10000 < m.chance_bps;
    v_gain := 0;
    if v_ok and v_kind = 'cash' then
      v_pay := round(m.cost_cents * coalesce((v_cfg #>> array['risk', v_risk, 'payoutBps'])::numeric, 15000) / 10000)::bigint;
      -- ADR-134 dealmaker of the founder
      v_pay := public.apply_bps(v_pay, 10000 + public.company_upgrade_bps(m.company_id, 'dealmaker'));
    elsif v_ok then
      v_pay := 0;
      v_gain := coalesce((v_cfg #>> array['risk', v_risk, 'gain'])::double precision, 0.04);
    else
      v_pay := round(m.cost_cents * coalesce((v_cfg #>> array['risk', v_risk, 'refundBps'])::numeric, 3000) / 10000)::bigint;
    end if;
    if not exists (select 1 from public.player_companies pc where pc.company_id = m.company_id and pc.status = 'active') then
      v_pay := 0;
      v_gain := 0;
    end if;
    if v_pay > 0 then
      select a.balance_cents into v_hh_bal from public.ledger_accounts a where a.id = v_hh for update;
      v_pay := least(v_pay, greatest(0, coalesce(v_hh_bal, 0)));
    end if;
    if v_pay > 0 then
      perform public.ledger_transfer(v_hh, public.company_cash_account(m.company_id), v_pay, 'company_revenue',
                                     'Geschäftszug: ' || m.move_key, 'company', m.company_id,
                                     'move:result:' || m.id::text, null, jsonb_build_object('move', m.move_key, 'success', v_ok));
    end if;
    if v_gain > 0 then
      if v_kind = 'awareness' then
        perform public.company_awareness_add(m.company_id, 'moves', v_gain);  -- ADR-188
      else
        update public.player_companies set quality = least(1, quality + v_gain) where company_id = m.company_id;
      end if;
    end if;
    update public.company_moves set status = case when v_ok then 'success' else 'failure' end, payout_cents = v_pay,
                                    gain = v_gain, resolved_at = v_now where id = m.id;
    perform public.company_system_message(m.company_id,
      case when v_ok and v_kind = 'cash' then 'Geschäftszug geschafft: ' || public.format_eur(v_pay) || ' eingenommen.'
           when v_ok then 'Geschäftszug geschafft: die Firma ist jetzt '
                          || case when v_kind = 'awareness' then 'bekannter' else 'besser' end || '.'
           else 'Geschäftszug daneben gegangen, ' || public.format_eur(v_pay) || ' zurück.' end);
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('resolved', v_done);
end;
$function$;

create or replace function public.company_pitch_resolve(p_pitch_id bigint, p_u double precision, p_u2 double precision)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg      jsonb := public.pitches_cfg();
  p        public.company_pitches;
  v_out    text;
  v_amount bigint := 0;
  v_avail  bigint;
  v_gain   double precision;
  v_text   text;
begin
  select * into p from public.company_pitches where id = p_pitch_id for update;
  if p.id is null or p.status <> 'running' then
    return null;
  end if;
  v_out := case when p_u * 10000 < p.chance_bps then 'success'
                when p_u2 * 100 < p.backfire then 'backfire'
                else 'failure' end;
  if v_out = 'success' then
    if p.kind = 'event' then
      update public.player_company_events
         set status = 'solved', resolved_at = public.game_now(),
             mitigation = least((cfg ->> 'maxMitigation')::double precision,
                                (cfg ->> 'mitigationBase')::double precision + p.fit * (cfg ->> 'mitigationPerFit')::double precision)
       where id = p.event_id and status in ('open', 'in_force');
    elsif p.move_kind = 'cash' then
      v_amount := round(p.cost_cents * ((cfg ->> 'movePayoutBase')::numeric + p.fit * (cfg ->> 'movePayoutPerFit')::numeric))::bigint;
      select a.balance_cents into v_avail from public.ledger_accounts a
       where a.id = public.ledger_system_account('households') for update;
      v_amount := least(v_amount, greatest(coalesce(v_avail, 0), 0));
      if v_amount > 0 then
        perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(p.company_id),
                                       v_amount, 'company_revenue', 'Eigener Geschäftszug', 'company', p.company_id,
                                       'pitch:result:' || p.id::text, p.created_by);
      end if;
    else
      v_gain := (cfg ->> 'moveGainBase')::double precision + p.fit * (cfg ->> 'moveGainPerFit')::double precision;
      if p.move_kind = 'awareness' then
        perform public.company_awareness_add(p.company_id, 'pitch', v_gain);  -- ADR-188
      else
        update public.player_companies set quality = least(1, quality + v_gain) where company_id = p.company_id;
      end if;
    end if;
  elsif v_out = 'backfire' then
    perform public.company_awareness_add(p.company_id, 'pitch', -(cfg ->> 'backfireAwareness')::double precision);  -- ADR-188
    if p.kind = 'event' and p.cost_cents > 0 then
      select a.balance_cents into v_avail from public.ledger_accounts a
       where a.id = public.company_cash_account(p.company_id) for update;
      v_amount := -least(p.cost_cents, greatest(coalesce(v_avail, 0), 0));
      if v_amount < 0 then
        perform public.ledger_transfer(public.company_cash_account(p.company_id), public.ledger_system_account('households'),
                                       -v_amount, 'company_costs', 'Eigene Strategie ging nach hinten los', 'company',
                                       p.company_id, 'pitch:result:' || p.id::text, p.created_by);
      end if;
    end if;
  elsif p.kind = 'move' then
    v_amount := (p.cost_cents * (cfg ->> 'moveRefundBps')::integer) / 10000;
    select a.balance_cents into v_avail from public.ledger_accounts a
     where a.id = public.ledger_system_account('households') for update;
    v_amount := least(v_amount, greatest(coalesce(v_avail, 0), 0));
    if v_amount > 0 then
      perform public.ledger_transfer(public.ledger_system_account('households'), public.company_cash_account(p.company_id),
                                     v_amount, 'company_revenue', 'Eigener Geschäftszug: Erstattung', 'company', p.company_id,
                                     'pitch:result:' || p.id::text, p.created_by);
    end if;
  end if;
  update public.company_pitches set status = v_out, result_cents = v_amount, resolved_at = public.game_now() where id = p.id;
  v_text := case v_out when 'success' then p.success_text when 'backfire' then p.backfire_text else p.failure_text end;
  perform public.company_news_add(p.company_id, 'pitch_' || v_out,
    jsonb_build_object('outcome', v_text, 'pitch', left(p.pitch_text, 120), 'kind', p.kind, 'amount_cents', v_amount));
  perform public.company_system_message(p.company_id, coalesce(v_text, 'Eigene Strategie: ' || v_out));
  return v_out;
end;
$function$;

create or replace function public.protest_check(p_protest_id bigint, p_u double precision, p_u2 double precision)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg       jsonb := public.protests_cfg();
  k         public.company_protests;
  c         public.companies;
  v_players integer;
  v_chance  integer;
  v_bps     integer;
  v_label   text;
begin
  select * into k from public.company_protests where id = p_protest_id for update;
  if k.id is null or k.status <> 'open' then
    return null;
  end if;
  select count(*) into v_players from public.company_protest_supporters s where s.protest_id = k.id;
  if v_players + k.ai_supporters < k.goal then
    return 'open';
  end if;
  select * into c from public.companies where id = k.company_id;
  v_label := case k.kind when 'boycott' then 'Boykott-Aufruf' when 'shitstorm' then 'Shitstorm'
                         when 'petition' then 'Petition' else 'Protestmarsch' end;
  v_chance := least((cfg ->> 'effectChanceMaxBps')::integer,
                    (cfg ->> 'effectChanceBaseBps')::integer + v_players * (cfg ->> 'effectChancePerPlayerBps')::integer)
              -- ADR-134 activist of the starter, on top of the cap
              + public.player_upgrade_bps(k.started_by, 'activist');
  if p_u * 10000 < v_chance then
    v_bps := (cfg ->> 'priceHitMinBps')::integer
             + floor(p_u2 * ((cfg ->> 'priceHitMaxBps')::integer - (cfg ->> 'priceHitMinBps')::integer + 1))::integer;
    if c.security_id is not null
       and exists (select 1 from public.securities s where s.id = c.security_id and s.status = 'listed') then
      perform public.event_price_shock(c.security_id, -v_bps, public.game_now());
    end if;
    perform public.company_awareness_add(c.id, 'protest', -(cfg ->> 'awarenessHit')::double precision);  -- ADR-188
    if exists (select 1 from public.player_companies pc where pc.company_id = c.id) then
      perform public.company_news_add(c.id, 'protest_hit', jsonb_build_object('kind', k.kind, 'players', v_players));
    end if;
    update public.company_protests set status = 'hit', effect_bps = v_bps, resolved_at = public.game_now() where id = k.id;
    insert into public.news_items (category, headline, body, importance, company_id, security_id, published_at)
    values ('market', v_label || ' gegen ' || c.name || ' zeigt Wirkung',
            v_players || ' Spieler und ' || k.ai_supporters || ' weitere Unterstützer machen mit. Das Thema ist in aller Munde.',
            2, c.id, c.security_id, public.game_now());
    return 'hit';
  end if;
  update public.company_protests set status = 'fizzled', resolved_at = public.game_now() where id = k.id;
  insert into public.news_items (category, headline, body, importance, company_id, security_id, published_at)
  values ('market', v_label || ' gegen ' || c.name || ' verpufft',
          'Viele haben mitgemacht, doch Kunden und Anleger zucken nur mit den Schultern.', 1, c.id, c.security_id,
          public.game_now());
  return 'fizzled';
end;
$function$;

create or replace function public.news_show_start(p_show_id bigint, p_now timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg     jsonb := public.news_show_cfg();
  s       public.news_shows;
  seg     jsonb;
  a       jsonb;
  v_idx   integer := 0;
  v_house uuid := public.ledger_system_account('households');
  v_cash  bigint;
  v_news  bigint;
  v_sec   uuid;
  r       record;
begin
  select * into s from public.news_shows where id = p_show_id for update;
  if s.id is null or s.status <> 'scheduled' or p_now < s.airs_at
     or p_now >= s.airs_at + make_interval(mins => coalesce((cfg ->> 'waitMinutes')::integer, 10)) then
    return false;
  end if;
  for seg in select x from jsonb_array_elements(s.segments) x loop
    v_idx := v_idx + 1;
    v_sec := null;
    for a in select x from jsonb_array_elements(coalesce(seg -> 'apply', '[]'::jsonb)) x loop
      case a ->> 'type'
        when 'stock' then
          v_sec := (a ->> 'security_id')::uuid;
          if exists (select 1 from public.securities sec where sec.id = v_sec and sec.status = 'listed') then
            perform public.event_price_shock(v_sec, (a ->> 'bps')::integer, p_now);
          end if;
        when 'sector' then
          for r in select sec.id from public.securities sec
                    where sec.sector_key = a ->> 'sector_key' and sec.kind = 'stock' and sec.status = 'listed' loop
            perform public.event_price_shock(r.id, (a ->> 'bps')::integer, p_now);
          end loop;
        when 'company' then
          -- ADR-188: a share of the current awareness, capped and booked as "news"
          perform public.company_awareness_add((a ->> 'company_id')::uuid, 'news',
            coalesce((select x.awareness from public.player_companies x where x.company_id = (a ->> 'company_id')::uuid), 0)
              * (a ->> 'awareness_bps')::double precision / 10000.0);
          update public.player_companies pc
             set task_momentum = case when coalesce((a ->> 'scandal')::boolean, false)
                                      then greatest(1.0, 1.0 + (coalesce(pc.task_momentum, 1.0) - 1.0)
                                             * (1.0 - coalesce((cfg #>> '{company,momentumLossBps}')::numeric, 0) / 10000.0))
                                      else pc.task_momentum end
           where pc.company_id = (a ->> 'company_id')::uuid and pc.status = 'active';
        when 'interview' then
          update public.company_interviews i set aired_at = p_now, show_id = s.id
           where i.id = (a ->> 'interview_id')::bigint and i.aired_at is null;
        when 'gag' then
          if exists (select 1 from public.companies c where c.id = (a ->> 'company_id')::uuid) then
            insert into public.news_running_gags as rg (gag_key, company_id, episodes, last_line, last_show_id, first_at, last_at)
            values (a ->> 'gag', (a ->> 'company_id')::uuid, 1, (a ->> 'line')::integer, s.id, p_now, p_now)
            on conflict (gag_key, company_id) do update
              set episodes = rg.episodes + 1, last_line = excluded.last_line, last_show_id = excluded.last_show_id,
                  last_at = excluded.last_at
              where rg.last_show_id is distinct from excluded.last_show_id;
          end if;
        when 'tasks' then
          update public.company_tasks t
             set value_cents = greatest(100, (t.value_cents * (10000 + (a ->> 'bps')::bigint)) / 10000)
           where t.status in ('open', 'assigned');
        when 'cash' then
          select x.balance_cents into v_cash from public.ledger_accounts x where x.id = v_house for update;
          if coalesce(v_cash, 0) >= (a ->> 'cents')::bigint
             and exists (select 1 from public.profiles p where p.id = (a ->> 'player_id')::uuid) then
            perform public.ledger_transfer(v_house, public.ledger_player_account((a ->> 'player_id')::uuid, 'player_cash'),
                                           (a ->> 'cents')::bigint, 'random_event', 'NEXA Nachrichten: Trostpflaster',
                                           'player', (a ->> 'player_id')::uuid,
                                           'newsshow:' || s.id::text || ':' || v_idx::text, null,
                                           jsonb_build_object('show_id', s.id));
          end if;
        when 'tip' then
          v_sec := (a ->> 'security_id')::uuid;
          if exists (select 1 from public.securities sec where sec.id = v_sec and sec.status = 'listed')
             and not exists (select 1 from public.stock_tips x where x.security_id = v_sec and x.applied_at is null) then
            insert into public.news_items (category, headline, body, importance, security_id, published_at)
            values ('company', seg ->> 'headline', seg ->> 'text', 2, v_sec, p_now) returning id into v_news;
            insert into public.stock_tips (security_id, news_item_id, direction, move_bps, strength, comes_true, headline, body,
                                           published_at, due_at)
            values (v_sec, v_news, (a ->> 'direction')::smallint, (a ->> 'bps')::integer, 2, (a ->> 'comes_true')::boolean,
                    seg ->> 'headline', seg ->> 'text', p_now,
                    p_now + make_interval(mins => (a ->> 'lead_minutes')::integer));
          end if;
        else
          null;
      end case;
    end loop;
    -- the news feed keeps what was said (the hint wrote its own item above)
    if seg ->> 'kind' <> 'tip' then
      insert into public.news_items (category, headline, body, importance, security_id, published_at)
      values (case when seg ->> 'kind' in ('loser', 'winner', 'gossip', 'nft') then 'player'
                   when seg ->> 'kind' in ('scandal', 'hype', 'stock', 'tax', 'corp', 'interview', 'gag') then 'company' else 'market' end::public.news_category,
              seg ->> 'headline', seg ->> 'text', 2, v_sec, p_now + make_interval(secs => v_idx));
    end if;
    -- whoever is talked about hears of it
    if seg -> 'subject' ? 'player_id'
       and exists (select 1 from public.profiles p where p.id = (seg -> 'subject' ->> 'player_id')::uuid) then
      perform public.social_notify((seg -> 'subject' ->> 'player_id')::uuid, 'news_show',
        'Mr. Doodle Dangle spricht über dich', seg ->> 'headline',
        jsonb_build_object('show_id', s.id, 'kind', seg ->> 'kind'), '/news',
        'news_show:' || s.id::text || ':' || v_idx::text);
    end if;
  end loop;
  update public.news_shows set status = 'aired', started_at = p_now where id = s.id;
  return true;
end;
$function$;
