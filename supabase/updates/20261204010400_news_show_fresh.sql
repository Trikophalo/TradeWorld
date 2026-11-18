-- ===== idempotent copy of migrations/20261204010400_news_show_fresh.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 10400 · NEXA Nachrichten, season three: new content for Mr. Doodle Dangle and the chat (ADR-210)
-- =============================================================================
-- * news_show_topic_cands_fresh(): what the new topics could tell (game_config newsShow.topics.list, texts and moods
--   from src/config/news-topics-fresh.ts): new headquarters, upgrades, market leaders, location fees and
--   subsidiaries (Weltkarte, ADR-208), events from outside that hit a player company and the ones it overcame
--   (ADR-209), star hires, poaching, quits, co-CEOs and the best free talent (ADR-199), clones with a job (ADR-206),
--   climbers of the rich list and of the company list (ADR-203), the Pleite der Woche, Black Labels, Pack Battle
--   Twist winners and pack marathons, big Festgeld deposits and their interest (ADR-201), login streaks, company
--   skills, redrawn logos (ADR-200) and the Wetter auf der Weltkarte. The Börsen-Orakel needs no data.
-- * news_show_topics(): the latest full definition (5700) plus the call of those candidates and a segue in front of
--   a topic now and then (news_show_segue()).
-- * news_show_pick(): the latest full definition (2000); a frame or reason that aired in the last
--   newsShow.fresh.noRepeatShows shows only comes back when nothing else is left (key "f:<kind>:<frame>" is new).
-- * news_show_fresh_chat(), trigger news_shows_fresh_chat: when a show goes on air the made-up viewers react to each
--   segment (lines by topic or kind), now and then a poll with votes, an emote storm after a big pull. Real players'
--   chat is untouched. No chat line or poll repeats within noRepeatShows shows while the pool has others.
-- Idempotent: runs unchanged as supabase/updates/20261204010400_news_show_fresh.sql.

-- ---------------------------------------------------------------------------
-- What "recent" means: everything used after the build of the N-th latest show before this one
-- ---------------------------------------------------------------------------
create or replace function public.news_show_fresh_cutoff(p_exclude bigint default null)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.created_at
       from public.news_shows s
      where s.id is distinct from p_exclude
      order by s.airs_at desc
     offset greatest(coalesce((public.news_show_cfg() #>> '{fresh,noRepeatShows}')::integer, 0), 1) - 1
      limit 1),
    '-infinity'::timestamptz);
$$;
comment on function public.news_show_fresh_cutoff(bigint) is
  'Internal (ADR-210): keys of news_show_used newer than this were used in the last newsShow.fresh.noRepeatShows shows.';

-- ---------------------------------------------------------------------------
-- news_show_pick(): latest full definition (20261204002000), plus the rule of ADR-210
-- ---------------------------------------------------------------------------
-- A frame and a reason for a kind: first a pair whose frame and reason did not air in the last shows, then the
-- combination used longest ago, among those the reason used longest ago, then by chance (pickScript); remembers the
-- pick. -> {"headline", "text"} with {reason} filled in
create or replace function public.news_show_pick(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  kit   jsonb := public.news_show_cfg() -> 'texts' -> p_kind;
  v_cut timestamptz := public.news_show_fresh_cutoff(null);
  r     record;
begin
  select f.ord - 1 as f, x.ord - 1 as r, f.val ->> 'headline' as headline, f.val ->> 'text' as body, x.val as reason
    into r
    from jsonb_array_elements(coalesce(kit -> 'frames', '[]'::jsonb)) with ordinality f(val, ord)
   cross join jsonb_array_elements_text(coalesce(kit -> 'reasons', '[]'::jsonb)) with ordinality x(val, ord)
    left join public.news_show_used u on u.key = p_kind || ':' || (f.ord - 1) || ':' || (x.ord - 1)
    left join public.news_show_used ur on ur.key = 'r:' || p_kind || ':' || (x.ord - 1)
    left join public.news_show_used uf on uf.key = 'f:' || p_kind || ':' || (f.ord - 1)
   order by coalesce(uf.used_at > v_cut, false)::integer + coalesce(ur.used_at > v_cut, false)::integer,
            u.used_at nulls first, ur.used_at nulls first, random()
   limit 1;
  if r.headline is null then
    return null;
  end if;
  insert into public.news_show_used (key, used_at) values (p_kind || ':' || r.f || ':' || r.r, clock_timestamp())
  on conflict (key) do update set used_at = excluded.used_at;
  insert into public.news_show_used (key, used_at) values ('r:' || p_kind || ':' || r.r, clock_timestamp())
  on conflict (key) do update set used_at = excluded.used_at;
  insert into public.news_show_used (key, used_at) values ('f:' || p_kind || ':' || r.f, clock_timestamp())
  on conflict (key) do update set used_at = excluded.used_at;
  return jsonb_build_object('headline', r.headline, 'text', replace(r.body, '{reason}', r.reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- A segue in front of a topic now and then (newsShow.fresh.transitions), not one of the last shows
-- ---------------------------------------------------------------------------
create or replace function public.news_show_segue(p_seg jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fc    jsonb := public.news_show_cfg() -> 'fresh';
  v_cut timestamptz := public.news_show_fresh_cutoff(null);
  v_t   text;
begin
  if p_seg is null or fc is null or random() * 10000 >= coalesce((fc ->> 'transitionChanceBps')::integer, 0) then
    return p_seg;
  end if;
  select t into v_t
    from jsonb_array_elements_text(coalesce(fc -> 'transitions', '[]'::jsonb)) t
    left join public.news_show_used u on u.key = 't:' || md5(t)
   where u.used_at is null or u.used_at <= v_cut
   order by u.used_at nulls first, random()
   limit 1;
  if v_t is null then
    return p_seg;
  end if;
  insert into public.news_show_used (key, used_at) values ('t:' || md5(v_t), clock_timestamp())
  on conflict (key) do update set used_at = excluded.used_at;
  return jsonb_set(p_seg, '{text}', to_jsonb(v_t || ' ' || (p_seg ->> 'text')));
end;
$$;
comment on function public.news_show_segue(jsonb) is
  'Internal (ADR-210): puts one of newsShow.fresh.transitions in front of a segment text (transitionChanceBps).';

-- ---------------------------------------------------------------------------
-- The candidates of the new topics: at most a few per topic, read from tables that exist anyway
-- ---------------------------------------------------------------------------
create or replace function public.news_show_topic_cands_fresh(p_now timestamptz, p_win interval)
returns table (topic text, player_id uuid, vals jsonb, ukey text, score double precision)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.news_show_cfg();
  fc      jsonb := coalesce(public.news_show_cfg() -> 'fresh', '{}'::jsonb);
  ff      jsonb := coalesce(public.news_show_cfg() #> '{fresh,facts}', '{}'::jsonb);
  v_day   text := (p_now at time zone 'Europe/Berlin')::date::text;
  v_today date := (p_now at time zone 'Europe/Berlin')::date;
  v_names jsonb := coalesce((select g.value from public.game_config g where g.key = 'nexamon_names'), '{}'::jsonb);
  v_home  text := coalesce(public.news_show_cfg() #>> '{fresh,homeCountry}', 'Nexa-Stadt');
  v_ext   text[];
  v_new   timestamptz;
  v_old   timestamptz;
  v_week  timestamptz;
  v_cnew  timestamptz;
  v_cold  timestamptz;
begin
  if fc = '{}'::jsonb then
    return;
  end if;
  -- the external archetypes (ADR-209)
  select coalesce(array_agg(x ->> 'key'), '{}') into v_ext
    from jsonb_array_elements(coalesce(public.company_events_cfg() -> 'archetypes', '[]'::jsonb)) x
   where coalesce((x ->> 'external')::boolean, false);
  -- the rich list and the company list now, a window ago and a week ago
  select max(r.taken_at) into v_new from public.rich_list_snapshots r where r.taken_at <= p_now;
  select max(r.taken_at) into v_old from public.rich_list_snapshots r where r.taken_at <= p_now - p_win;
  select max(r.taken_at) into v_week from public.rich_list_snapshots r
   where r.taken_at <= p_now - make_interval(days => coalesce((ff ->> 'weekDays')::integer, 7));
  select max(r.taken_at) into v_cnew from public.company_rank_snapshots r where r.taken_at <= p_now;
  select max(r.taken_at) into v_cold from public.company_rank_snapshots r where r.taken_at <= p_now - p_win;

  return query
  -- ---- Weltkarte (ADR-208)
  select 'worldHq'::text, pc.founder_id,
         jsonb_build_object('company', co.name, 'country', public.country_cfg(l.country_key) ->> 'name'),
         'fact:hq:' || l.company_id::text || ':' || l.country_key,
         extract(epoch from coalesce(l.moved_at, l.placed_at))::double precision
    from public.company_locations l
    join public.companies co on co.id = l.company_id
    join public.player_companies pc on pc.company_id = l.company_id
   where coalesce(l.moved_at, l.placed_at) between p_now - p_win and p_now
     and public.country_cfg(l.country_key) ->> 'name' is not null
  union all
  select 'worldHqUp', pc.founder_id,
         jsonb_build_object('company', co.name, 'country', public.country_cfg(l.country_key) ->> 'name', 'tier', l.hq_tier),
         'fact:hqup:' || l.company_id::text || ':' || l.hq_tier::text, l.hq_tier::double precision
    from public.company_locations l
    join public.companies co on co.id = l.company_id
    join public.player_companies pc on pc.company_id = l.company_id
   where l.updated_at between p_now - p_win and p_now
     and l.hq_tier >= coalesce((ff ->> 'hqMinTier')::integer, 2)
     and public.country_cfg(l.country_key) ->> 'name' is not null
  union all
  select 'worldLeader', pc.founder_id,
         jsonb_build_object('company', co.name, 'country', public.country_cfg(cl.country_key) ->> 'name'),
         'fact:leader:' || cl.country_key || ':' || cl.leader_company_id::text, random()
    from public.country_lobby cl
    join public.companies co on co.id = cl.leader_company_id
    left join public.player_companies pc on pc.company_id = cl.leader_company_id
   where cl.updated_at between p_now - p_win and p_now
     and public.country_cfg(cl.country_key) ->> 'name' is not null
  union all
  select 'worldFee', pc.founder_id,
         jsonb_build_object('company', co.name, 'country', public.country_cfg(cl.country_key) ->> 'name',
                            'pct', public.news_show_move(cl.fee_bps)),
         'fact:fee:' || cl.country_key || ':' || cl.fee_bps::text || ':' || cl.leader_company_id::text,
         cl.fee_bps::double precision
    from public.country_lobby cl
    join public.companies co on co.id = cl.leader_company_id
    left join public.player_companies pc on pc.company_id = cl.leader_company_id
   where cl.fee_bps > 0 and cl.fee_set_at between p_now - p_win and p_now
     and public.country_cfg(cl.country_key) ->> 'name' is not null
  union all
  select 'worldSub', pc.founder_id,
         jsonb_build_object('company', co.name, 'country', public.country_cfg(s.country_key) ->> 'name',
                            'count', (select count(*) from public.company_subsidiaries s2 where s2.company_id = s.company_id)),
         'fact:sub:' || s.company_id::text || ':' || s.country_key,
         extract(epoch from s.opened_at)::double precision
    from public.company_subsidiaries s
    join public.companies co on co.id = s.company_id
    join public.player_companies pc on pc.company_id = s.company_id
   where s.opened_at between p_now - p_win and p_now
     and public.country_cfg(s.country_key) ->> 'name' is not null
     and (select count(*) from public.company_subsidiaries s2 where s2.company_id = s.company_id)
         >= coalesce((ff ->> 'subsidiaryMin')::integer, 1)
  union all
  (select 'worldWeather', null::uuid, jsonb_build_object('country', x ->> 'name'),
          'fact:weather:' || (x ->> 'key') || ':' || v_day, random()
     from jsonb_array_elements(coalesce(public.world_cfg() -> 'countries', '[]'::jsonb)) x
    where x ->> 'name' is not null
    order by random() limit 1)
  -- ---- Talente (ADR-199) and clones (ADR-206)
  union all
  select case te.kind when 'hired' then 'talentStar' when 'poached' then 'talentPoach' when 'quit' then 'talentQuit'
                      else 'talentCoceo' end,
         pc.founder_id,
         jsonb_strip_nulls(jsonb_build_object(
           'company', co.name, 'talent', te.payload ->> 'name',
           'role', coalesce(fc #>> array['roleNames', te.payload ->> 'role'], te.payload ->> 'role'),
           'rival', te.payload ->> 'to_name')),
         'fact:talent:' || te.id::text,
         coalesce((te.payload ->> 'tier')::double precision, 1)
    from public.talent_events te
    join public.companies co on co.id = te.company_id
    join public.player_companies pc on pc.company_id = te.company_id
   where te.created_at between p_now - p_win and p_now and te.undone_at is null
     and te.payload ->> 'name' is not null
     and (te.kind in ('quit', 'coceo_appointed')
          or (te.kind = 'poached' and te.payload ->> 'to_name' is not null)
          or (te.kind = 'hired' and coalesce((te.payload ->> 'tier')::integer, 0) >= coalesce((ff ->> 'starMinTier')::integer, 2)))
  union all
  (select 'talentMarket', null::uuid,
          jsonb_build_object('talent', t.first_name || ' ' || t.last_name,
                             'role', coalesce(fc #>> array['roleNames', t.role_key], t.role_key),
                             'tier', coalesce(fc #>> array['tierNames', t.tier::text], t.tier::text),
                             'amount', public.format_eur(t.wage_demand_cents)),
          'fact:tmarket:' || t.talent_key || ':' || v_day, t.tier::double precision
     from public.talents t
    where t.company_id is null and t.tier >= coalesce((ff ->> 'starMinTier')::integer, 2)
      and (t.resting_until is null or t.resting_until <= p_now)
    order by t.tier desc, random() limit 1)
  union all
  select 'cloneJob', j.player_id, jsonb_build_object('company', co.name, 'title', j.title),
         'fact:clone:' || j.id::text, extract(epoch from j.started_at)::double precision
    from public.player_jobs j
    join public.companies co on co.id = j.company_id
   where j.is_clone and j.started_at between p_now - p_win and p_now
  -- ---- toplists (ADR-203)
  union all
  select 'rankForbes', a.entity_id, jsonb_build_object('rank', a.rank_all, 'places', b.rank_all - a.rank_all),
         'fact:forbes:' || a.entity_id::text || ':' || v_day, (b.rank_all - a.rank_all)::double precision
    from public.rich_list_snapshots a
    join public.rich_list_snapshots b on b.taken_at = v_old and b.entity_kind = a.entity_kind and b.entity_id = a.entity_id
   where v_old is not null and v_new > v_old and a.taken_at = v_new and a.entity_kind = 'player'
     and b.rank_all - a.rank_all >= coalesce((ff ->> 'rankMinPlaces')::integer, 3)
  union all
  select 'rankCompany', pc.founder_id, jsonb_build_object('company', co.name, 'rank', a.rank_all, 'places', b.rank_all - a.rank_all),
         'fact:crank:' || a.company_id::text || ':' || v_day, (b.rank_all - a.rank_all)::double precision
    from public.company_rank_snapshots a
    join public.company_rank_snapshots b on b.taken_at = v_cold and b.company_id = a.company_id
    join public.companies co on co.id = a.company_id
    left join public.player_companies pc on pc.company_id = a.company_id
   where v_cold is not null and v_cnew > v_cold and a.taken_at = v_cnew
     and b.rank_all - a.rank_all >= coalesce((ff ->> 'rankMinPlaces')::integer, 3)
  union all
  select 'rankWeekLoser', a.entity_id,
         jsonb_build_object('amount', public.format_eur(b.net_worth_cents - a.net_worth_cents),
                            'pct', public.news_show_move(((b.net_worth_cents - a.net_worth_cents) * 10000 / b.net_worth_cents)::integer)),
         'fact:weekloser:' || a.entity_id::text || ':' || to_char(p_now at time zone 'Europe/Berlin', 'IYYY-IW'),
         (b.net_worth_cents - a.net_worth_cents)::double precision
    from public.rich_list_snapshots a
    join public.rich_list_snapshots b on b.taken_at = v_week and b.entity_kind = a.entity_kind and b.entity_id = a.entity_id
   where v_week is not null and v_new > v_week and a.taken_at = v_new and a.entity_kind = 'player'
     and b.net_worth_cents > 0
     and (b.net_worth_cents - a.net_worth_cents) * 10000 / b.net_worth_cents >= coalesce((ff ->> 'weekLossMinBps')::integer, 1000)
  -- ---- Nexamon (ADR-165, ADR-205)
  union all
  select 'cardBlackLabel', c2.owner_id,
         jsonb_build_object('card', coalesce(v_names ->> c2.card_key, c2.card_key),
                            'fee', public.format_eur(coalesce(c2.grading_fee_cents, 0))),
         'fact:nblack:' || c2.id::text, extract(epoch from c2.graded_at)::double precision
    from public.nexamon_copies c2
   where c2.owner_id is not null and c2.grade = 11 and c2.graded_at between p_now - p_win and p_now
  union all
  select 'cardTwist', st.player_id,
         jsonb_build_object('count', b.size,
                            'amount', public.format_eur((select coalesce(sum(coalesce(x.total_cents, 0)), 0)::bigint
                                                           from public.nexamon_battle_seats x where x.battle_id = b.id))),
         'fact:twist:' || b.id::text, extract(epoch from b.ends_at)::double precision
    from public.nexamon_battles b
    join public.nexamon_battle_seats st on st.battle_id = b.id and st.seat = b.winner_seat
   where b.twist and b.status = 'accepted' and b.winner_seat is not null
     and b.ends_at between p_now - p_win and p_now
  union all
  select 'cardSpree', d.player_id, jsonb_build_object('packs', d.n, 'amount', public.format_eur(d.spent)),
         'fact:spree:' || d.player_id::text || ':' || v_day, d.n::double precision
    from (select pk.player_id, count(*) as n, sum(pk.price_cents)::bigint as spent
            from public.nexamon_packs pk
           where pk.opened_at between p_now - p_win and p_now and pk.player_id is not null
           group by pk.player_id) d
   where d.n >= coalesce((ff ->> 'spreeMinPacks')::integer, 10)
  -- ---- Festgeld (ADR-201), streaks, company skills
  union all
  select 'pVault', v.player_id, jsonb_build_object('amount', public.format_eur(v.amount_cents), 'days', v.term_days),
         'fact:vault:' || v.id::text, v.amount_cents::double precision
    from public.vault_deposits v
   where v.created_at between p_now - p_win and p_now and v.status in ('open', 'paid')
     and v.amount_cents >= coalesce((ff ->> 'vaultMinCents')::bigint, 500000)
  union all
  select 'pVaultPaid', v.player_id, jsonb_build_object('amount', public.format_eur(v.interest_cents)),
         'fact:vaultpaid:' || v.id::text, v.interest_cents::double precision
    from public.vault_deposits v
   where v.status = 'paid' and v.closed_at between p_now - p_win and p_now
     and v.interest_cents >= coalesce((ff ->> 'vaultInterestMinCents')::bigint, 5000)
  union all
  select 'pStreak', ls.player_id, jsonb_build_object('days', ls.current_streak),
         'fact:streak:' || ls.player_id::text || ':' || ls.current_streak::text, ls.current_streak::double precision
    from public.login_streaks ls
   where ls.current_streak >= coalesce((ff ->> 'streakMinDays')::integer, 7)
     and ls.current_streak % coalesce((ff ->> 'streakMinDays')::integer, 7) = 0
     and ls.last_login_day >= v_today - 1
  union all
  select 'corpSkill', pc.founder_id,
         jsonb_build_object('company', co.name, 'skill', coalesce(fc #>> array['skillNames', k.skill_key], k.skill_key),
                            'level', k.level),
         'fact:skill:' || k.company_id::text || ':' || k.skill_key || ':' || k.level::text, k.level::double precision
    from public.company_skills k
    join public.companies co on co.id = k.company_id
    join public.player_companies pc on pc.company_id = k.company_id
   where k.ready_at between p_now - p_win and p_now
     and k.level >= coalesce((ff ->> 'skillMinLevel')::integer, 3)
  -- ---- big market events (ADR-214): stock tips with source 'market', when the game has them
  union all
  select 'marketEvent', null::uuid,
         jsonb_build_object('what', t.headline, 'stock', sec.name, 'pct', public.news_show_move(t.move_bps)),
         'fact:market:' || t.id::text, t.move_bps::double precision
    from public.stock_tips t
    join public.securities sec on sec.id = t.security_id
   where to_jsonb(t) ->> 'source' = 'market'
     and t.published_at between p_now - p_win and p_now
     and t.move_bps >= coalesce((ff ->> 'marketMinBps')::integer, 300)
  -- ---- a redrawn logo (ADR-200), when the game has it
  union all
  select 'corpLogo', pc.founder_id,
         jsonb_build_object('company', co.name,
                            'amount', public.format_eur(coalesce((public.config_jsonb('startups') ->> 'logoRedrawCents')::bigint, 0))),
         'fact:logo:' || pc.company_id::text || ':' || extract(epoch from (to_jsonb(pc) ->> 'logo_redrawn_at')::timestamptz)::bigint::text,
         extract(epoch from (to_jsonb(pc) ->> 'logo_redrawn_at')::timestamptz)::double precision
    from public.player_companies pc
    join public.companies co on co.id = pc.company_id
   where (to_jsonb(pc) ->> 'logo_redrawn_at')::timestamptz between p_now - p_win and p_now;
end;
$$;
comment on function public.news_show_topic_cands_fresh(timestamptz, interval) is
  'Internal (ADR-210): candidates of the season-three topics of the news show (topic, player, values, fact key, '
  'score); news_show_topics() draws them like every other topic.';

-- ---------------------------------------------------------------------------
-- Events from outside (ADR-209) get their own segments: every big one that hit a player company, and a follow-up
-- once it is over (newsShow.fresh.events)
-- ---------------------------------------------------------------------------
create or replace function public.news_show_event_response(p_event public.player_company_events, p_phase text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev     jsonb := coalesce(public.news_show_cfg() #> '{fresh,events}', '{}'::jsonb);
  r      jsonb := coalesce(public.news_show_cfg() #> '{fresh,events,responses}', '{}'::jsonb);
  v_out  text[] := '{}';
  v_lob  integer;
  v_strat text := coalesce(ev #>> array['strategyNames', coalesce(p_event.strategy, '')], p_event.strategy);
begin
  select pc.lobby_level into v_lob from public.player_companies pc where pc.company_id = p_event.company_id;
  if p_phase = 'new' then
    -- insurance: only events that can be insured carry the share in their snapshot (ADR-209)
    if p_event.definition ? 'insuredShare' then
      v_out := v_out || case when (p_event.definition ->> 'insuredShare')::numeric > 0
                             then replace(r ->> 'insured', '{pct}',
                                          public.news_show_move(round((p_event.definition ->> 'insuredShare')::numeric * 10000)::integer))
                             else r ->> 'uninsured' end;
    end if;
    v_out := v_out || case when v_strat is not null then replace(r ->> 'strategy', '{strategy}', v_strat) else r ->> 'noStrategy' end;
    if coalesce(v_lob, 0) > 0 and coalesce(ev -> 'lobbyArchetypes', '[]'::jsonb) ? p_event.archetype then
      v_out := v_out || replace(r ->> 'lobby', '{level}', v_lob::text);
    end if;
  elsif p_phase = 'won' then
    if v_strat is not null then
      v_out := v_out || replace(r ->> 'strategy', '{strategy}', v_strat);
    end if;
    if coalesce(p_event.strategy, '') like 'lobby%' and coalesce(v_lob, 0) > 0 then
      v_out := v_out || replace(r ->> 'lobbyWon', '{level}', v_lob::text);
    end if;
  else
    v_out := v_out || case when v_strat is null then r ->> 'sitOut' else replace(r ->> 'strategy', '{strategy}', v_strat) end;
    if p_event.mitigation > 0 then
      v_out := v_out || replace(r ->> 'mitigated', '{pct}', public.news_show_move(round(p_event.mitigation * 10000)::integer));
    end if;
  end if;
  return array_to_string(array_remove(v_out, null), ' ');
end;
$$;
comment on function public.news_show_event_response(public.player_company_events, text) is
  'Internal (ADR-210): what a company does about an event from outside, as the anchor says it (insurance, strategy, lobby).';

create or replace function public.news_show_event_segments(p_now timestamptz, p_win interval)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg    jsonb := public.news_show_cfg();
  ev     jsonb := coalesce(public.news_show_cfg() #> '{fresh,events}', '{}'::jsonb);
  ff     jsonb := coalesce(public.news_show_cfg() #> '{fresh,facts}', '{}'::jsonb);
  v_home text := coalesce(public.news_show_cfg() #>> '{fresh,homeCountry}', 'Nexa-Stadt');
  v_max  integer := coalesce((public.news_show_cfg() #>> '{fresh,events,max}')::integer, 0);
  v_ext  text[];
  v_out  jsonb := '[]'::jsonb;
  v_seg  jsonb;
  v_n    integer := 0;
  r      record;
begin
  if v_max <= 0 or cfg #> '{texts,worldEvent}' is null then
    return v_out;
  end if;
  select coalesce(array_agg(x ->> 'key'), '{}') into v_ext
    from jsonb_array_elements(coalesce(public.company_events_cfg() -> 'archetypes', '[]'::jsonb)) x
   where coalesce((x ->> 'external')::boolean, false);
  for r in
    select q.* from (
      -- new: started in the window
      select 'worldEvent'::text as topic, e, 'fact:event:' || e.id::text as ukey, 0 as phase,
             e.severity as sev, e.started_at as at
        from public.player_company_events e
       where e.polarity = 'crisis' and e.archetype = any (v_ext)
         and e.started_at between p_now - p_win and p_now
         and e.severity >= coalesce((ff ->> 'eventMinSeverity')::integer, 1)
      union all
      -- solved
      select 'worldEventWon', e, 'fact:eventwon:' || e.id::text, 1, e.severity, e.resolved_at
        from public.player_company_events e
       where e.polarity = 'crisis' and e.archetype = any (v_ext) and e.status = 'solved'
         and e.resolved_at between p_now - p_win and p_now
         and e.severity >= coalesce((ff ->> 'eventMinSeverity')::integer, 1)
      union all
      -- took full effect: the deadline passed without a solution
      select 'worldEventLost', e, 'fact:eventlost:' || e.id::text, 2, e.severity, e.deadline_at
        from public.player_company_events e
       where e.polarity = 'crisis' and e.archetype = any (v_ext) and e.status in ('in_force', 'expired', 'over')
         and e.resolved_at is null
         and e.deadline_at between p_now - p_win and p_now
         and e.severity >= coalesce((ff ->> 'eventMinSeverity')::integer, 1)
    ) q
    join public.player_companies pc on pc.company_id = (q.e).company_id
    where not exists (select 1 from public.news_show_used u where u.key = q.ukey)
    order by q.phase, q.sev desc, q.at desc
  loop
    exit when v_n >= v_max;
    select public.news_show_segment('world', r.topic,
             jsonb_build_object(
               'name', p.nickname, 'company', co.name,
               'event', coalesce(cfg #>> array['fresh', 'eventNames', (r.e).archetype], (r.e).archetype),
               'country', coalesce(public.country_cfg(public.company_country((r.e).company_id)) ->> 'name', v_home),
               'severity', coalesce(ev #>> array['severityNames', ((r.e).severity - 1)::text], ''),
               'response', public.news_show_event_response(r.e, case r.phase when 0 then 'new' when 1 then 'won' else 'lost' end)),
             '[]'::jsonb, '[]'::jsonb,
             jsonb_build_object('type', 'topic', 'topic', r.topic, 'group', 'world', 'player_id', pc.founder_id,
                                'name', p.nickname, 'ukey', r.ukey, 'event_id', (r.e).id, 'good', r.phase = 1))
      into v_seg
      from public.player_companies pc
      join public.companies co on co.id = pc.company_id
      join public.profiles p on p.id = pc.founder_id
     where pc.company_id = (r.e).company_id and not p.is_deactivated;
    continue when v_seg is null or position('{' in (v_seg ->> 'headline') || (v_seg ->> 'text')) > 0;
    v_out := v_out || (v_seg || jsonb_build_object('ord', coalesce((ev -> 'ords' ->> v_n)::integer, 21 + v_n)));
    v_n := v_n + 1;
  end loop;
  return v_out;
end;
$$;
comment on function public.news_show_event_segments(timestamptz, interval) is
  'Internal (ADR-210): one segment per big event from outside that hit a player company (new, solved, lost), '
  'with company, country, severity and the company''s response; not part of the topic lot.';

-- ---------------------------------------------------------------------------
-- news_show_topics(): latest full definition (20261204005700) with the two hooks of ADR-210
-- ---------------------------------------------------------------------------
create or replace function public.news_show_topics(p_now timestamptz, p_seen uuid[], p_skip uuid[], p_segments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.news_show_cfg();
  tc       jsonb := coalesce(cfg -> 'topics', '{}'::jsonb);
  v_list   jsonb := coalesce(tc -> 'list', '{}'::jsonb);
  v_count  integer := coalesce((tc ->> 'count')::integer, 0);
  v_win    interval := make_interval(hours => coalesce((tc ->> 'windowHours')::integer, 24));
  v_today  date := (p_now at time zone 'Europe/Berlin')::date;
  v_day    text := (p_now at time zone 'Europe/Berlin')::date::text;
  v_names  jsonb := coalesce((select g.value from public.game_config g where g.key = 'nexamon_names'), '{}'::jsonb);
  v_nx     jsonb := coalesce((select g.value from public.game_config g where g.key = 'nexamon'), '{}'::jsonb);
  v_acc    jsonb;
  v_pull   jsonb := coalesce(tc #> '{cards,pullRarities}', '[]'::jsonb);
  v_hit    jsonb := coalesce(tc #> '{cards,hitRarities}', '[]'::jsonb);
  v_have   text[];
  v_last   text[];
  v_cands  jsonb;
  v_seen   uuid[] := coalesce(p_seen, '{}');
  v_skip   uuid[] := coalesce(p_skip, '{}');
  v_taken  text[] := '{}';
  v_groups text[] := '{}';
  v_out    jsonb := '[]'::jsonb;
  v_pick   jsonb;
  v_seg    jsonb;
  v_meta   jsonb;
  v_hush   bigint;
  v_player uuid;
  v_n      integer := 0;
  v_try    integer := 0;
begin
  if v_count <= 0 or v_list = '{}'::jsonb then
    return '[]'::jsonb;
  end if;
  -- players and facts that are in this show already, and the topics of the last show
  select v_seen || coalesce(array_agg((x -> 'subject' ->> 'player_id')::uuid)
                              filter (where x -> 'subject' ->> 'player_id' is not null), '{}')
    into v_seen
    from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) x;
  select coalesce(array_agg(x -> 'subject' ->> 'ukey') filter (where x -> 'subject' ->> 'ukey' is not null), '{}')
    into v_have
    from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) x;
  select coalesce(array_agg(x -> 'subject' ->> 'topic') filter (where x -> 'subject' ->> 'topic' is not null), '{}')
    into v_last
    from jsonb_array_elements(coalesce(
           (select s.segments from public.news_shows s where s.status = 'aired' order by s.airs_at desc limit 1), '[]'::jsonb)) x;
  select coalesce(jsonb_object_agg(x ->> 'key', x ->> 'name'), '{}'::jsonb) into v_acc
    from jsonb_array_elements(coalesce(
           (select g.value -> 'items' from public.game_config g where g.key = 'accessories'), '[]'::jsonb)) x
   where x ->> 'key' is not null and x ->> 'name' is not null;

  -- what every topic could tell: at most one candidate per topic
  select coalesce(jsonb_agg(jsonb_build_object('topic', q.topic, 'player_id', q.player_id, 'name', q.nickname,
                                               'vals', q.vals, 'ukey', q.ukey)), '[]'::jsonb)
    into v_cands
    from (
      select distinct on (c.topic) c.topic, c.player_id, p.nickname, c.ukey,
             case when p.nickname is not null then c.vals || jsonb_build_object('name', p.nickname) else c.vals end as vals
        from (
          -- ---- collectibles
          select 'cardPull'::text as topic, pk.player_id as player_id,
                 jsonb_build_object(
                   'card', coalesce(v_names ->> (x ->> 'card_key'), x ->> 'card_key'),
                   'rarity', coalesce(tc #>> array['rarityNames', x ->> 'rarity'], x ->> 'rarity'),
                   'set', coalesce(v_nx #>> array['sets', pk.set_key, 'name'], pk.set_key),
                   'packs', (select count(*) from public.nexamon_packs p2
                              where p2.player_id = pk.player_id and p2.opened_at >= p_now - v_win)) as vals,
                 'fact:npull:' || (x ->> 'copy_id') as ukey,
                 (case x ->> 'rarity' when 'legendary' then 2 else 1 end)::double precision as score
            from public.nexamon_packs pk
           cross join lateral jsonb_array_elements(case when jsonb_typeof(pk.cards) = 'array' then pk.cards else '[]'::jsonb end) x
           where pk.opened_at >= p_now - v_win and v_pull ? (x ->> 'rarity')
          union all
          select 'cardSale', coalesce(s.seller_id, s.buyer_id),
                 jsonb_build_object('seller', coalesce(sp.nickname, s.seller_ai, 'ein Händler'),
                                    'buyer', coalesce(bp.nickname, s.buyer_ai, 'ein Händler'),
                                    'card', coalesce(v_names ->> s.card_key, s.card_key),
                                    'amount', public.format_eur(s.price_cents)),
                 'fact:nsale:' || s.id::text, s.price_cents::double precision
            from public.nexamon_sales s
            left join public.profiles sp on sp.id = s.seller_id
            left join public.profiles bp on bp.id = s.buyer_id
           where s.at >= p_now - v_win and s.kind in ('market', 'ai_buy')
             and s.price_cents >= coalesce((tc #>> '{cards,minSaleCents}')::bigint, 0)
          union all
          select case when k.value_e4 >= k.day_ref_e4 then 'cardUp' else 'cardDown' end, null::uuid,
                 jsonb_build_object('card', coalesce(v_names ->> k.card_key, k.card_key),
                                    'pct', public.news_show_move(((k.value_e4 - k.day_ref_e4) * 10000 / k.day_ref_e4)::integer),
                                    'amount', public.format_eur(public.nexamon_copy_value_cents(k.value_e4, 'good', null))),
                 'fact:nmove:' || k.card_key || ':' || v_day,
                 abs((k.value_e4 - k.day_ref_e4) * 10000 / k.day_ref_e4)::double precision
            from public.nexamon_cards k
           where k.in_catalogue and k.day_ref_on = v_today
             and abs((k.value_e4 - k.day_ref_e4) * 10000 / k.day_ref_e4) >= coalesce((tc #>> '{cards,minMoveBps}')::integer, 500)
          union all
          select case when c2.grade = 10 then 'cardGradeTop' else 'cardGradeLow' end, c2.owner_id,
                 jsonb_build_object('card', coalesce(v_names ->> c2.card_key, c2.card_key), 'grade', c2.grade,
                                    'fee', public.format_eur(coalesce(c2.grading_fee_cents, 0))),
                 'fact:ngrade:' || c2.id::text,
                 public.nexamon_copy_value_cents(k.value_e4, c2.condition, c2.grade)::double precision
            from public.nexamon_copies c2
            join public.nexamon_cards k on k.card_key = c2.card_key
           where c2.owner_id is not null and c2.grade is not null and c2.graded_at >= p_now - v_win
             and (c2.grade = 10 or c2.grade <= coalesce((tc #>> '{cards,lowGradeMax}')::integer, 0))
          union all
          select 'cardDud', d.player_id, jsonb_build_object('packs', d.n, 'amount', public.format_eur(d.spent)),
                 'fact:ndud:' || d.player_id::text || ':' || v_day, d.n::double precision
            from (select pk.player_id, count(*) as n, sum(pk.price_cents)::bigint as spent,
                         bool_or(exists (select 1
                                           from jsonb_array_elements(case when jsonb_typeof(pk.cards) = 'array' then pk.cards
                                                                          else '[]'::jsonb end) x
                                          where v_hit ? (x ->> 'rarity'))) as hit
                    from public.nexamon_packs pk
                   where pk.opened_at >= p_now - v_win
                   group by pk.player_id) d
           where not d.hit and d.n >= coalesce((tc #>> '{cards,dudMinPacks}')::integer, 5)
          union all
          (select 'cardCollection', o.owner_id, jsonb_build_object('count', o.n, 'amount', public.format_eur(o.total)),
                  'fact:ncoll:' || o.owner_id::text || ':' || v_day, o.total::double precision
             from (select c2.owner_id, count(*) as n,
                          sum(public.nexamon_copy_value_cents(k.value_e4, c2.condition, c2.grade))::bigint as total
                     from public.nexamon_copies c2
                     join public.nexamon_cards k on k.card_key = c2.card_key
                     join public.profiles op on op.id = c2.owner_id and not op.is_deactivated
                    where c2.owner_id is not null
                    group by c2.owner_id) o
            where o.n >= coalesce((tc #>> '{cards,collectionMinCards}')::integer, 2)
            order by o.total desc
            limit 1)
          union all
          select 'cardAi', null::uuid, jsonb_build_object('seller', a.seller_ai, 'count', a.n, 'amount', public.format_eur(a.total)),
                 null::text, random()
            from (select l.seller_ai, count(*) as n, sum(l.price_cents)::bigint as total
                    from public.nexamon_listings l
                   where l.seller_ai is not null
                   group by l.seller_ai) a
           where a.n >= coalesce((tc #>> '{cards,aiMinListings}')::integer, 2)
          -- ---- what the feed knows: Finanzamt, listed companies, promotions, property
          union all
          select case f.kind
                   when 'tax_penalty' then case f.payload ->> 'reason' when 'late_fee' then 'taxLate'
                                                                         when 'enforcement' then 'taxEnforce' else 'taxEstimate' end
                   when 'tax_audit' then 'taxAudit'
                   when 'greedy_founder' then 'corpGreedy'
                   when 'mass_quit' then 'corpQuit'
                   when 'record_dividend' then 'corpDividend'
                   when 'board_revolt' then 'corpRevolt'
                   when 'research_done' then 'corpResearch'
                   when 'promoted' then 'pPromoted'
                   else 'pProperty' end,
                 f.actor_id,
                 jsonb_strip_nulls(jsonb_build_object(
                   'company', case when f.kind in ('home_bought', 'car_bought') then null else coalesce(f.payload ->> 'company', 'einer Firma') end,
                   'amount', case when f.payload ->> 'amount_cents' ~ '^[0-9]+$'
                                  then public.format_eur((f.payload ->> 'amount_cents')::bigint) end,
                   'pct', case when f.payload ->> 'ratio_bps' ~ '^[0-9]+(\.[0-9]+)?$'
                               then public.news_show_move(round((f.payload ->> 'ratio_bps')::numeric)::integer) end,
                   'count', case when f.kind = 'mass_quit' then f.payload ->> 'count' end,
                   'what', case f.kind
                             when 'home_bought' then 'ein neues Zuhause bezogen'
                             when 'car_bought' then 'ein neues Auto gekauft'
                                  || case when f.payload ->> 'price_cents' ~ '^[0-9]+$'
                                          then ' für ' || public.format_eur((f.payload ->> 'price_cents')::bigint) else '' end
                           end)),
                 'fact:feed:' || f.id::text, random()
            from public.feed_items f
           where f.created_at >= p_now - v_win
             and f.kind in ('tax_penalty', 'tax_audit', 'greedy_founder', 'mass_quit', 'record_dividend', 'board_revolt',
                            'research_done', 'promoted', 'home_bought', 'car_bought')
             and (f.kind <> 'mass_quit'
                  or (f.payload ->> 'count' ~ '^[0-9]+$'
                      and (f.payload ->> 'count')::integer >= coalesce((tc #>> '{corp,quitMin}')::integer, 2)))
          union all
          select 'taxStreak', pc.founder_id, jsonb_build_object('company', co.name, 'days', l.books_streak),
                 'fact:books:' || l.company_id::text || ':' || l.books_streak::text, l.books_streak::double precision
            from public.listed_companies l
            join public.player_companies pc on pc.company_id = l.company_id and pc.status = 'active'
            join public.companies co on co.id = l.company_id
           where l.books_streak >= coalesce((tc #>> '{tax,streakMinDays}')::integer, 5)
          union all
          select 'taxDebt', pc.founder_id, jsonb_build_object('company', co.name, 'amount', public.format_eur(d.due)),
                 'fact:taxdebt:' || d.company_id::text || ':' || v_day, d.due::double precision
            from (select t.company_id, sum(t.tax_cents + t.penalty_cents - t.paid_cents)::bigint as due
                    from public.company_tax_periods t
                   where t.status = 'due'
                   group by t.company_id) d
            join public.player_companies pc on pc.company_id = d.company_id and pc.status = 'active'
            join public.companies co on co.id = d.company_id
           where d.due >= coalesce((tc #>> '{tax,debtMinCents}')::bigint, 100000)
          union all
          select case when l.satisfaction <= coalesce((tc #>> '{corp,moodLow}')::numeric, 0) then 'corpMoodLow' else 'corpMoodHigh' end,
                 pc.founder_id, jsonb_build_object('company', co.name, 'value', round(l.satisfaction::numeric)::integer),
                 'fact:mood:' || l.company_id::text || ':' || v_day, abs(l.satisfaction - 50)::double precision
            from public.listed_companies l
            join public.player_companies pc on pc.company_id = l.company_id and pc.status = 'active'
            join public.companies co on co.id = l.company_id and co.phase::text = 'listed'
           where l.satisfaction <= coalesce((tc #>> '{corp,moodLow}')::numeric, 0)
              or l.satisfaction >= coalesce((tc #>> '{corp,moodHigh}')::numeric, 101)
          -- ---- persons
          union all
          select case when t.realized_pnl_cents < 0 then 'pTradeLoss' else 'pTradeWin' end, t.player_id,
                 jsonb_build_object('amount', public.format_eur(abs(t.realized_pnl_cents)), 'stock', sec.name),
                 'fact:trade:' || t.id::text, abs(t.realized_pnl_cents)::double precision
            from public.trades t
            join public.securities sec on sec.id = t.security_id
           where t.executed_at >= p_now - v_win and t.realized_pnl_cents is not null and not coalesce(t.is_wash_trade, false)
             and abs(t.realized_pnl_cents) >= coalesce((tc #>> '{person,tradeMinCents}')::bigint, 100000)
          union all
          (select 'pHourLoser', w.entity_id,
                  jsonb_build_object('amount', public.format_eur(w.first_nw - w.last_nw),
                                     'pct', public.news_show_move(((w.first_nw - w.last_nw) * 10000 / w.first_nw)::integer)),
                  'fact:hour:' || w.entity_id::text || ':' || to_char(p_now at time zone 'UTC', 'YYYYMMDDHH24'),
                  ((w.first_nw - w.last_nw) * 10000 / w.first_nw)::double precision
             from (select l.entity_id, l.nw as last_nw, f.nw as first_nw
                     from (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                            where entity_kind = 'player' and taken_at >= p_now - interval '45 minutes'
                            order by entity_id, taken_at desc) l
                     join (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                            where entity_kind = 'player' and taken_at <= p_now - interval '50 minutes'
                              and taken_at >= p_now - interval '3 hours'
                            order by entity_id, taken_at desc) f using (entity_id)
                    where f.nw > 0) w
            where (w.first_nw - w.last_nw) * 10000 / w.first_nw >= coalesce((tc #>> '{person,hourMinBps}')::integer, 200)
            order by (w.first_nw - w.last_nw) * 10000 / w.first_nw desc
            limit 1)
          union all
          (select 'pHourWinner', w.entity_id,
                  jsonb_build_object('amount', public.format_eur(w.last_nw - w.first_nw),
                                     'pct', public.news_show_move(((w.last_nw - w.first_nw) * 10000 / w.first_nw)::integer)),
                  'fact:hour:' || w.entity_id::text || ':' || to_char(p_now at time zone 'UTC', 'YYYYMMDDHH24'),
                  ((w.last_nw - w.first_nw) * 10000 / w.first_nw)::double precision
             from (select l.entity_id, l.nw as last_nw, f.nw as first_nw
                     from (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                            where entity_kind = 'player' and taken_at >= p_now - interval '45 minutes'
                            order by entity_id, taken_at desc) l
                     join (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                            where entity_kind = 'player' and taken_at <= p_now - interval '50 minutes'
                              and taken_at >= p_now - interval '3 hours'
                            order by entity_id, taken_at desc) f using (entity_id)
                    where f.nw > 0) w
            where (w.last_nw - w.first_nw) * 10000 / w.first_nw >= coalesce((tc #>> '{person,hourMinBps}')::integer, 200)
            order by (w.last_nw - w.first_nw) * 10000 / w.first_nw desc
            limit 1)
          union all
          select 'pLandlord', r.owner_id, jsonb_build_object('amount', public.format_eur(r.total), 'count', r.n),
                 'fact:rent:' || r.owner_id::text || ':' || v_day, r.total::double precision
            from (select rp.owner_id, count(*) as n, sum(rp.amount_cents)::bigint as total
                    from public.rental_payments rp
                   where rp.created_at >= p_now - v_win
                   group by rp.owner_id) r
           where r.total >= coalesce((tc #>> '{person,rentMinCents}')::bigint, 10000)
          union all
          select 'pAccessory', a.player_id,
                 jsonb_build_object('count', a.n, 'amount', public.format_eur(a.total), 'item', coalesce(v_acc ->> a.top, a.top)),
                 'fact:acc:' || a.player_id::text || ':' || floor(extract(epoch from a.latest))::bigint::text, a.total::double precision
            from (select pa.player_id, count(*) as n, sum(pa.price_paid_cents)::bigint as total, max(pa.bought_at) as latest,
                         (array_agg(pa.accessory_key order by pa.price_paid_cents desc, pa.accessory_key))[1] as top
                    from public.player_accessories pa
                   where pa.bought_at >= p_now - v_win
                   group by pa.player_id) a
           where a.total >= coalesce((tc #>> '{person,accessoryMinCents}')::bigint, 100000)
          union all
          select 'pOutfit', w.player_id, jsonb_build_object('count', w.n),
                 'fact:outfit:' || w.player_id::text || ':' || w.n::text, w.n::double precision
            from (select pw.player_id, count(*) as n from public.player_accessories_worn pw group by pw.player_id) w
           where w.n >= coalesce((tc #>> '{person,outfitMin}')::integer, 4)
          union all
          select 'pBattleWon', b.winner_id,
                 jsonb_build_object('count', (select count(*) from public.battle_players bp where bp.battle_id = b.id)),
                 'fact:battle:w:' || b.id::text, random()
            from public.battles b
           where b.status::text = 'finished' and b.finished_at >= p_now - v_win and b.winner_id is not null
             and (select count(*) from public.battle_players bp where bp.battle_id = b.id) >= 2
          union all
          select 'pBattleLast', bp.player_id, jsonb_build_object('count', n.n), 'fact:battle:l:' || b.id::text, random()
            from public.battles b
           cross join lateral (select count(*) as n, max(x.rank) as worst
                                 from public.battle_players x where x.battle_id = b.id) n
            join public.battle_players bp on bp.battle_id = b.id and bp.rank = n.worst
           where b.status::text = 'finished' and b.finished_at >= p_now - v_win and n.n >= 3 and n.worst = n.n
             and bp.player_id is distinct from b.winner_id
          union all
          select 'pReroll', m.player_id, jsonb_build_object('count', m.used),
                 'fact:reroll:' || m.player_id::text || ':' || m.reset_day::text || ':' || m.used::text, m.used::double precision
            from public.mission_resets m
           where m.last_at >= p_now - v_win and m.used >= coalesce((tc #>> '{person,rerollMin}')::integer, 2)
          union all
          select 'pChatty', m.author_id, jsonb_build_object('count', m.n),
                 'fact:chat:' || m.author_id::text || ':' || v_day, m.n::double precision
            from (select fm.author_id, count(*) as n
                    from public.friend_chat_messages fm
                   where fm.created_at >= p_now - v_win and fm.author_id is not null and fm.kind = 'player'
                   group by fm.author_id) m
           where m.n >= coalesce((tc #>> '{person,chatMin}')::integer, 30)
          union all
          select 'pFriends', fr.pid, jsonb_build_object('count', fr.n),
                 'fact:friends:' || fr.pid::text || ':' || v_day || ':' || fr.n::text, fr.n::double precision
            from (select u.pid, count(*) as n
                    from public.friendships f2
                   cross join lateral (values (f2.requester_id), (f2.addressee_id)) u(pid)
                   where f2.status::text = 'accepted' and f2.responded_at >= p_now - v_win
                   group by u.pid) fr
          union all
          select 'pPoke', k.poker_id, jsonb_build_object('count', k.n),
                 'fact:poke:' || k.poker_id::text || ':' || v_day, k.n::double precision
            from (select fp.poker_id, count(*) as n from public.friend_pokes fp
                   where fp.created_at >= p_now - v_win group by fp.poker_id) k
           where k.n >= coalesce((tc #>> '{person,pokeMin}')::integer, 5)
          union all
          select 'pAbsent', p2.id,
                 jsonb_build_object('days', floor(extract(epoch from (p_now - p2.last_active_at)) / 86400)::integer),
                 'fact:gone:' || p2.id::text || ':' || floor(extract(epoch from (p_now - p2.last_active_at)) / 86400)::integer,
                 extract(epoch from (p_now - p2.last_active_at))::double precision
            from public.profiles p2
           where p2.last_active_at < p_now - make_interval(days => coalesce((cfg #>> '{gossip,absentDays}')::integer, 3))
             and p2.last_active_at > p_now - interval '30 days'
          union all
          select 'pBoss', pc.founder_id, jsonb_build_object('victim', vp.nickname, 'company', co.name),
                 'fact:job:' || j.id::text, random()
            from public.player_jobs j
            join public.player_companies pc on pc.company_id = j.company_id
            join public.companies co on co.id = j.company_id
            join public.profiles vp on vp.id = j.player_id
           where j.status::text = 'ended' and j.ended_at >= p_now - v_win and j.end_reason::text = 'fired'
             and pc.founder_id <> j.player_id
          union all
          select 'pFounderPay', pc.founder_id,
                 jsonb_build_object('company', co.name, 'amount', public.format_eur(h.total),
                                    'pct', public.news_show_move(pc.founder_payout_bps::integer)),
                 'fact:fpay:' || pc.company_id::text || ':' || v_day, h.total::double precision
            from (select ph.company_id, sum(ph.founder_payout_cents)::bigint as total
                    from public.player_company_hours ph
                   where ph.hour_start >= p_now - v_win
                   group by ph.company_id) h
            join public.player_companies pc on pc.company_id = h.company_id and pc.status = 'active'
            join public.companies co on co.id = h.company_id
           where h.total >= coalesce((tc #>> '{person,founderPayMinCents}')::bigint, 100000)
             and pc.founder_payout_bps >= coalesce((tc #>> '{person,founderPayMinBps}')::integer, 5000)
          -- ---- season three (ADR-210): Weltkarte, events from outside, Talente, clones, toplists and more
          union all
          select f.topic, f.player_id, f.vals, f.ukey, f.score
            from public.news_show_topic_cands_fresh(p_now, v_win) f
          -- ---- topics without placeholders are always there
          union all
          select t.key, null::uuid, '{}'::jsonb, null::text, 0::double precision
            from jsonb_each(v_list) t
           where jsonb_array_length(coalesce(t.value -> 'slots', '[]'::jsonb)) = 0
        ) c
        left join public.profiles p on p.id = c.player_id
       where coalesce((v_list #>> array[c.topic, 'weight'])::numeric, 0) > 0
         and (c.player_id is null or (p.id is not null and not p.is_deactivated and c.player_id <> all (v_seen)))
         and (c.ukey is null
              or (c.ukey <> all (v_have) and not exists (select 1 from public.news_show_used u where u.key = c.ukey)))
       order by c.topic, (c.player_id = any (v_skip)) nulls first, c.score desc, random()) q;

  -- ADR-210: every big event from outside that hit a player company has its own segment (company news: the
  -- founder may still be in another story)
  v_out := public.news_show_event_segments(p_now, v_win);

  -- the draw: not what ran in the last show while there is something else, groups that are not in the show yet
  -- first, then the weighted lot (pickTopics in src/lib/sim/news-show.ts)
  loop
    exit when v_n >= v_count or v_try >= 60;
    v_try := v_try + 1;
    v_pick := null;
    select c into v_pick
      from jsonb_array_elements(v_cands) c
     where c ->> 'topic' <> all (v_taken)
       and (c ->> 'player_id' is null or (c ->> 'player_id')::uuid <> all (v_seen))
     order by (c ->> 'topic' = any (v_last))::integer,
              (select count(*) from unnest(v_groups) g where g = v_list #>> array[c ->> 'topic', 'group']),
              -ln(greatest(random(), 1e-9)) / (v_list #>> array[c ->> 'topic', 'weight'])::double precision
     limit 1;
    exit when v_pick is null;
    v_taken := v_taken || (v_pick ->> 'topic');
    v_meta := v_list -> (v_pick ->> 'topic');
    v_player := (v_pick ->> 'player_id')::uuid;
    v_hush := case when v_meta ->> 'tone' = 'bad' and v_meta ->> 'group' in ('person', 'cards') and v_player is not null
                   then coalesce((tc ->> 'hushMoneyCents')::bigint, 0) else 0 end;
    v_seg := public.news_show_segment(coalesce(v_meta ->> 'kind', 'world'), v_pick ->> 'topic', v_pick -> 'vals',
      case when v_hush > 0 then jsonb_build_array(jsonb_build_object('label', '+' || public.format_eur(v_hush) || ' Schmerzensgeld', 'tone', 'gain'))
           else '[]'::jsonb end,
      case when v_hush > 0 then jsonb_build_array(jsonb_build_object('type', 'cash', 'player_id', v_player, 'cents', v_hush))
           else '[]'::jsonb end,
      jsonb_strip_nulls(jsonb_build_object('type', 'topic', 'topic', v_pick ->> 'topic', 'group', v_meta ->> 'group',
                                           'player_id', v_player, 'name', v_pick ->> 'name', 'ukey', v_pick ->> 'ukey',
                                           'good', v_meta ->> 'tone' = 'good')));
    -- a text with a placeholder left over (a fact without the value its script needs) is never aired
    if v_seg is null or position('{' in (v_seg ->> 'headline') || (v_seg ->> 'text')) > 0 then
      continue;
    end if;
    v_seg := public.news_show_segue(v_seg);
    v_out := v_out || (v_seg || jsonb_build_object('ord', coalesce((tc -> 'ords' ->> v_n)::integer, 85 + v_n)));
    v_n := v_n + 1;
    v_groups := v_groups || coalesce(v_meta ->> 'group', '');
    if v_player is not null then
      v_seen := v_seen || v_player;
    end if;
  end loop;
  return v_out;
end;
$$;

comment on function public.news_show_topics(timestamptz, uuid[], uuid[], jsonb) is
  'Internal: the topic segments of a news show (ADR-169, ADR-210): collectibles, Finanzamt, listed companies, personal '
  'news, odd bits, Weltkarte, Talente and toplists, drawn by weight with rotation; reads facts only, the caller sorts '
  'them into the show by "ord".';

-- ---------------------------------------------------------------------------
-- The chat reacts to what is on air (freshChatLines in src/lib/sim/news-chat.ts)
-- ---------------------------------------------------------------------------
create or replace function public.news_show_fresh_chat(p_show_id bigint, p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.news_show_cfg();
  fc      jsonb := public.news_show_cfg() #> '{fresh,chat}';
  names   jsonb := coalesce(public.news_show_cfg() #> '{chat,bots,names}', '[]'::jsonb);
  s       public.news_shows;
  v_cut   timestamptz;
  v_intro numeric := coalesce((cfg ->> 'introSeconds')::numeric, 8);
  v_seg   numeric := greatest(1, coalesce((cfg ->> 'segmentSeconds')::numeric, 22));
  v_per   integer;
  v_max   integer;
  v_lines integer := 0;
  v_n     integer := 0;
  v_k     integer;
  v_taken text[] := '{}';
  seg     jsonb;
  v_idx   bigint;
  v_key   text;
  v_vals  jsonb;
  v_start numeric;
  v_t     text;
  v_poll  record;
  v_nn    integer := 0;
begin
  select * into s from public.news_shows where id = p_show_id;
  if s.id is null or s.status <> 'aired' or fc is null or jsonb_array_length(names) = 0 then
    return 0;
  end if;
  v_nn := jsonb_array_length(names);
  v_cut := public.news_show_fresh_cutoff(s.id);
  v_per := greatest(0, coalesce((fc ->> 'perSegment')::integer, 0));
  v_max := greatest(0, coalesce((fc ->> 'maxPerShow')::integer, 0));

  for seg, v_idx in select x, ord from jsonb_array_elements(s.segments) with ordinality t(x, ord) loop
    v_key := coalesce(seg -> 'subject' ->> 'topic', seg ->> 'kind');
    v_vals := coalesce(seg -> 'subject' -> 'values', '{}'::jsonb);
    v_start := v_intro + (v_idx - 1) * v_seg;
    -- the lines of its topic (else of its kind): complete, not twice in a show, the ones of the last shows last
    for v_t in
      select l
        from jsonb_array_elements_text(coalesce(fc -> 'topics' -> (seg -> 'subject' ->> 'topic'),
                                                fc -> 'kinds' -> (seg ->> 'kind'), '[]'::jsonb)) l
        left join public.news_show_used u on u.key = 'c:' || md5(l)
       where l <> all (v_taken) and position('{' in public.news_show_fill(l, v_vals)) = 0
       order by coalesce(u.used_at > v_cut, false), u.used_at nulls first, random()
       limit least(v_per, greatest(0, v_max - v_lines))
    loop
      v_taken := v_taken || v_t;
      v_lines := v_lines + 1;
      insert into public.news_show_messages (player_id, bot_name, body, created_at)
      values (null, names ->> floor(random() * v_nn)::integer, left(public.news_show_fill(v_t, v_vals), 300),
              p_now + make_interval(secs => (v_start + 2 + random() * greatest(1, v_seg - 4))::double precision));
      insert into public.news_show_used (key, used_at) values ('c:' || md5(v_t), clock_timestamp())
      on conflict (key) do update set used_at = excluded.used_at;
      v_n := v_n + 1;
    end loop;
    -- an emote storm after a big pull
    if coalesce(fc #> '{burst,on}', '[]'::jsonb) ? v_key then
      insert into public.news_show_messages (player_id, bot_name, body, created_at)
      select null, names ->> floor(random() * v_nn)::integer,
             fc #>> array['burst', 'emotes', floor(random() * jsonb_array_length(fc #> '{burst,emotes}'))::integer::text],
             p_now + make_interval(secs => (v_start + 3 + random() * coalesce((fc #>> '{burst,seconds}')::numeric, 5))::double precision)
        from generate_series(1, public.rand_between(coalesce((fc #>> '{burst,countMin}')::integer, 0),
                                                    coalesce((fc #>> '{burst,countMax}')::integer, 0))) g
       where jsonb_array_length(coalesce(fc #> '{burst,emotes}', '[]'::jsonb)) > 0;
      get diagnostics v_k = row_count;
      v_n := v_n + v_k;
    end if;
  end loop;

  -- at most one poll per show, on a segment it fits, with a few votes
  if random() * 10000 < coalesce((fc #>> '{polls,chanceBps}')::integer, 0) then
    select t.ord as idx, p ->> 'question' as question, public.news_show_fill(p ->> 'question', coalesce(t.x -> 'subject' -> 'values', '{}'::jsonb)) as body
      into v_poll
      from jsonb_array_elements(s.segments) with ordinality t(x, ord)
      cross join jsonb_array_elements(coalesce(fc #> '{polls,list}', '[]'::jsonb)) p
      left join public.news_show_used u on u.key = 'c:' || md5(p ->> 'question')
     where (p -> 'on') ? coalesce(t.x -> 'subject' ->> 'topic', t.x ->> 'kind')
       and position('{' in public.news_show_fill(p ->> 'question', coalesce(t.x -> 'subject' -> 'values', '{}'::jsonb))) = 0
       and (u.used_at is null or u.used_at <= v_cut)
     order by random()
     limit 1;
    if v_poll.idx is not null then
      v_start := v_intro + (v_poll.idx - 1) * v_seg;
      insert into public.news_show_messages (player_id, bot_name, body, created_at)
      values (null, left(coalesce(fc #>> '{polls,host}', 'NEXA-Umfrage'), 40), left(v_poll.body, 300),
              p_now + make_interval(secs => (v_start + 4)::double precision));
      insert into public.news_show_used (key, used_at) values ('c:' || md5(v_poll.question), clock_timestamp())
      on conflict (key) do update set used_at = excluded.used_at;
      insert into public.news_show_messages (player_id, bot_name, body, created_at)
      select null, names ->> floor(random() * v_nn)::integer,
             fc #>> array['polls', 'votes', floor(random() * jsonb_array_length(fc #> '{polls,votes}'))::integer::text],
             p_now + make_interval(secs => (v_start + 6 + random() * greatest(1, v_seg - 8))::double precision)
        from generate_series(1, public.rand_between(coalesce((fc #>> '{polls,votesMin}')::integer, 0),
                                                    coalesce((fc #>> '{polls,votesMax}')::integer, 0))) g
       where jsonb_array_length(coalesce(fc #> '{polls,votes}', '[]'::jsonb)) > 0;
      get diagnostics v_k = row_count;
      v_n := v_n + 1 + v_k;
    end if;
  end if;
  return v_n;
end;
$$;
comment on function public.news_show_fresh_chat(bigint, timestamptz) is
  'Internal (ADR-210): the made-up viewers react to each segment of a show that went on air: lines by topic or kind, '
  'at most one poll with votes, emotes after a big pull. Real players'' chat is never touched.';

-- When a show goes on air (news_show_start sets status and started_at), its reactions are written for the whole show.
create or replace function public.news_shows_fresh_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'aired' and old.status = 'scheduled' then
    perform public.news_show_fresh_chat(new.id, coalesce(new.started_at, now()));
  end if;
  return null;
end;
$$;
drop trigger if exists news_shows_fresh_chat on public.news_shows;
create trigger news_shows_fresh_chat
  after update of status on public.news_shows
  for each row execute function public.news_shows_fresh_chat();

revoke all on function public.news_show_fresh_cutoff(bigint) from public, anon, authenticated;
revoke all on function public.news_show_pick(text) from public, anon, authenticated;
revoke all on function public.news_show_segue(jsonb) from public, anon, authenticated;
revoke all on function public.news_show_topic_cands_fresh(timestamptz, interval) from public, anon, authenticated;
revoke all on function public.news_show_topics(timestamptz, uuid[], uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.news_show_fresh_chat(bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.news_show_event_segments(timestamptz, interval) from public, anon, authenticated;
revoke all on function public.news_show_event_response(public.player_company_events, text) from public, anon, authenticated;
revoke all on function public.news_shows_fresh_chat() from public, anon, authenticated;
grant execute on function public.news_show_topics(timestamptz, uuid[], uuid[], jsonb) to service_role;
