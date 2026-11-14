-- ===== idempotent copy of migrations/20261204002300_news_show_v2.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 2300 · NEXA Nachrichten 2: personal news, NFTs, digressions, moods, viewers in the chat (ADR-152)
-- =============================================================================
-- * Every segment carries a "mood" for the anchor's face (newsShow.moods, one at random per script).
-- * New segments: "gossip" (personal news about real players from what they did: feed items, a failed IPO, a lost
--   job, missing for days, first or last of the rich list; bad news pay hush money), "nft" (the most expensive NFT
--   sale of the last hours) and "ramble" (he digresses; sometimes a rumour that a public figure bought a stock,
--   which lifts it a little). A fact is told once: its key is stored in news_show_used when the show airs.
-- * The order of a show puts people first: loser, gossip, company, NFT, winner, gossip, company, digression,
--   world, AI stock, hint.
-- * Made-up viewers with everyday names write in the live chat during a show (newsShow.chat.bots): their lines
--   are written at the start with the times at which they appear.
-- Idempotent: runs unchanged as supabase/updates/20261204002300_news_show_v2.sql.

alter table public.news_show_messages alter column player_id drop not null;
alter table public.news_show_messages add column if not exists bot_name text;
alter table public.news_show_messages drop constraint if exists news_show_messages_author_check;
alter table public.news_show_messages add constraint news_show_messages_author_check
  check (player_id is not null or bot_name is not null);
comment on column public.news_show_messages.bot_name is 'A made-up viewer (ADR-152); such rows have no player and may lie in the near future.';

-- One segment: script of the kind with the values filled in, a mood for the anchor, the public effect chips, the
-- internal apply list and the facts for Claude.
create or replace function public.news_show_segment(p_kind text, p_script text, p_values jsonb, p_effects jsonb, p_apply jsonb,
                                                    p_subject jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s      jsonb := public.news_show_pick(p_script);
  v_mood text;
begin
  if s is null then
    return null;
  end if;
  select m into v_mood
    from jsonb_array_elements_text(coalesce(public.news_show_cfg() -> 'moods' -> p_script, '[]'::jsonb)) m
   order by random() limit 1;
  return jsonb_build_object(
    'kind', p_kind,
    'mood', coalesce(v_mood, 'neutral'),
    'headline', public.news_show_fill(s ->> 'headline', p_values),
    'text', public.news_show_fill(s ->> 'text', p_values),
    'effects', coalesce(p_effects, '[]'::jsonb),
    'apply', coalesce(p_apply, '[]'::jsonb),
    'subject', coalesce(p_subject, '{}'::jsonb) || jsonb_build_object('values', p_values));
end;
$$;

-- ---------------------------------------------------------------------------
-- The draft of a show
-- ---------------------------------------------------------------------------
create or replace function public.news_show_build(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.news_show_cfg();
  v_segs    jsonb := '[]'::jsonb;
  v_seg     jsonb;
  v_tip     jsonb;
  v_last    jsonb;
  v_skip_p  uuid[];
  v_skip_c  uuid[];
  r         record;
  v_bps     integer;
  v_aw      integer;
  v_dir     integer;
  v_scandal boolean;
  v_effects jsonb;
  v_apply   jsonb;
  v_max     integer := coalesce((cfg ->> 'maxSegments')::integer, 7);
  v_seen    uuid[] := '{}';
  v_n       integer := 0;
  v_win     interval;
  v_person  text;
begin
  -- who was in the last show: not again right away
  select s.segments into v_last from public.news_shows s where s.status = 'aired' order by s.airs_at desc limit 1;
  select coalesce(array_agg((x -> 'subject' ->> 'player_id')::uuid) filter (where x -> 'subject' ? 'player_id'), '{}'),
         coalesce(array_agg((x -> 'subject' ->> 'company_id')::uuid) filter (where x -> 'subject' ? 'company_id'), '{}')
    into v_skip_p, v_skip_c
    from jsonb_array_elements(coalesce(v_last, '[]'::jsonb)) x;

  -- 1. the loser of the day: roast and a consolation
  select w.entity_id as player_id, p.nickname, w.first_nw - w.last_nw as loss,
         ((w.first_nw - w.last_nw) * 10000 / w.first_nw)::integer as bps
    into r
    from (select l.entity_id, l.nw as last_nw, f.nw as first_nw
            from (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                   where entity_kind = 'player' and taken_at >= p_now - interval '45 minutes'
                   order by entity_id, taken_at desc) l
            join (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                   where entity_kind = 'player'
                     and taken_at >= p_now - make_interval(hours => coalesce((cfg #>> '{loser,windowHours}')::integer, 24))
                   order by entity_id, taken_at asc) f using (entity_id)
           where f.nw > 0) w
    join public.profiles p on p.id = w.entity_id
   where w.entity_id <> all (v_skip_p)
     and (w.first_nw - w.last_nw) * 10000 / w.first_nw >= coalesce((cfg #>> '{loser,minLossBps}')::integer, 300)
   order by (w.first_nw - w.last_nw) * 10000 / w.first_nw desc, random()
   limit 1;
  if r.player_id is not null then
    v_bps := coalesce((cfg #>> '{loser,consolationCents}')::integer, 0);
    v_seg := public.news_show_segment('loser', 'loser',
      jsonb_build_object('name', r.nickname, 'amount', public.format_eur(r.loss), 'pct', public.news_show_move(r.bps)),
      case when v_bps > 0 then jsonb_build_array(jsonb_build_object('label', '+' || public.format_eur(v_bps) || ' Trostpflaster', 'tone', 'gain'))
           else '[]'::jsonb end,
      case when v_bps > 0 then jsonb_build_array(jsonb_build_object('type', 'cash', 'player_id', r.player_id, 'cents', v_bps))
           else '[]'::jsonb end,
      jsonb_build_object('type', 'player', 'player_id', r.player_id, 'name', r.nickname));
    if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', 10)); end if;
    v_seen := v_seen || r.player_id;
  end if;

  -- 2. players' companies: a scandal or a hype
  for r in select pc.company_id, c.name, left(coalesce(nullif(btrim(pc.idea), ''), 'irgendwas mit Zukunft'), 90) as idea,
                  p.nickname as founder, pc.founder_id, sec.id as security_id, sec.ticker, c.sector_key
             from public.player_companies pc
             join public.companies c on c.id = pc.company_id
             join public.profiles p on p.id = pc.founder_id
             left join public.securities sec on sec.company_id = c.id and sec.kind = 'stock' and sec.status = 'listed'
            where pc.status = 'active' and pc.company_id <> all (v_skip_c)
            order by random()
            limit coalesce((cfg #>> '{company,count}')::integer, 2) loop
    v_n := v_n + 1;
    v_scandal := random() * 10000 < coalesce((cfg #>> '{company,scandalShareBps}')::integer, 6000);
    v_dir := case when v_scandal then -1 else 1 end;
    v_aw := public.rand_between((cfg #>> '{company,awarenessMinBps}')::integer, (cfg #>> '{company,awarenessMaxBps}')::integer);
    v_bps := public.rand_between((cfg #>> '{company,stockMinBps}')::integer, (cfg #>> '{company,stockMaxBps}')::integer);
    v_effects := jsonb_build_array(jsonb_build_object(
      'label', 'Bekanntheit ' || case when v_scandal then '−' else '+' end || public.news_show_move(v_aw),
      'tone', case when v_scandal then 'loss' else 'gain' end));
    v_apply := jsonb_build_array(jsonb_build_object('type', 'company', 'company_id', r.company_id, 'awareness_bps', v_dir * v_aw,
                                                    'scandal', v_scandal));
    if r.security_id is not null then
      v_effects := v_effects || jsonb_build_object(
        'label', r.ticker || ' ' || case when v_scandal then '−' else '+' end || public.news_show_move(v_bps),
        'tone', case when v_scandal then 'loss' else 'gain' end);
      v_apply := v_apply || jsonb_build_object('type', 'stock', 'security_id', r.security_id, 'bps', v_dir * v_bps);
    end if;
    v_seg := public.news_show_segment(case when v_scandal then 'scandal' else 'hype' end,
      case when v_scandal then 'scandal' else 'hype' end,
      jsonb_build_object('company', r.name, 'idea', r.idea, 'founder', r.founder),
      v_effects, v_apply,
      jsonb_build_object('type', 'company', 'company_id', r.company_id, 'player_id', r.founder_id, 'name', r.name,
                         'idea', r.idea, 'founder', r.founder, 'sector', r.sector_key, 'scandal', v_scandal));
    if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', case when v_n = 1 then 30 else 70 end)); end if;
  end loop;

  -- 3. listed stocks of the AI companies
  for r in select sec.id, sec.name, sec.ticker
             from public.securities sec join public.companies c on c.id = sec.company_id
            where sec.kind = 'stock' and sec.status = 'listed' and c.is_ai
            order by random()
            limit coalesce((cfg #>> '{stock,count}')::integer, 2) loop
    v_dir := case when random() < 0.5 then 1 else -1 end;
    v_bps := public.rand_between((cfg #>> '{stock,minBps}')::integer, (cfg #>> '{stock,maxBps}')::integer);
    v_seg := public.news_show_segment('stock', case when v_dir > 0 then 'stockUp' else 'stockDown' end,
      jsonb_build_object('stock', r.name, 'move', public.news_show_move(v_bps)),
      jsonb_build_array(jsonb_build_object('label', r.ticker || ' ' || case when v_dir > 0 then '+' else '−' end || public.news_show_move(v_bps),
                                           'tone', case when v_dir > 0 then 'gain' else 'loss' end)),
      jsonb_build_array(jsonb_build_object('type', 'stock', 'security_id', r.id, 'bps', v_dir * v_bps)),
      jsonb_build_object('type', 'stock', 'name', r.name, 'ticker', r.ticker, 'up', v_dir > 0));
    if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', 100)); end if;
  end loop;

  -- 4. the world: a whole sector, or the value of open company tasks
  v_dir := case when random() < 0.5 then 1 else -1 end;
  if random() < 0.5 then
    select s.key, s.name into r from public.sectors s
     where exists (select 1 from public.securities sec where sec.sector_key = s.key and sec.kind = 'stock' and sec.status = 'listed')
     order by random() limit 1;
    if r.key is not null then
      v_bps := public.rand_between((cfg #>> '{sector,minBps}')::integer, (cfg #>> '{sector,maxBps}')::integer);
      v_seg := public.news_show_segment('sector', case when v_dir > 0 then 'sectorUp' else 'sectorDown' end,
        jsonb_build_object('sector', r.name, 'move', public.news_show_move(v_bps)),
        jsonb_build_array(jsonb_build_object('label', r.name || ' ' || case when v_dir > 0 then '+' else '−' end || public.news_show_move(v_bps),
                                             'tone', case when v_dir > 0 then 'gain' else 'loss' end)),
        jsonb_build_array(jsonb_build_object('type', 'sector', 'sector_key', r.key, 'bps', v_dir * v_bps)),
        jsonb_build_object('type', 'sector', 'name', r.name, 'up', v_dir > 0));
      if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', 90)); end if;
    end if;
  else
    v_bps := public.rand_between((cfg #>> '{tasks,minBps}')::integer, (cfg #>> '{tasks,maxBps}')::integer);
    v_seg := public.news_show_segment('tasks', case when v_dir > 0 then 'tasksUp' else 'tasksDown' end,
      jsonb_build_object('move', public.news_show_move(v_bps)),
      jsonb_build_array(jsonb_build_object('label', 'Aufgaben ' || case when v_dir > 0 then '+' else '−' end || public.news_show_move(v_bps),
                                           'tone', case when v_dir > 0 then 'gain' else 'loss' end)),
      jsonb_build_array(jsonb_build_object('type', 'tasks', 'bps', v_dir * v_bps)),
      jsonb_build_object('type', 'tasks', 'up', v_dir > 0));
    if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', 90)); end if;
  end if;

  -- 5. personal news about real players: what they did in the last hours, each fact only once (news_show_used)
  v_win := make_interval(hours => coalesce((cfg #>> '{gossip,windowHours}')::integer, 24));
  v_n := 0;
  for r in
    select q.player_id, q.nickname, q.grp, q.what, q.ukey
      from (select distinct on (c.player_id) c.player_id, p.nickname, c.grp, c.what, c.ukey
              from (
                select f.actor_id as player_id,
                       case when f.kind in ('rug_pull', 'loan_defaulted', 'deal_broken', 'coin_closed') then 'bad' else 'good' end as grp,
                       public.feed_item_label(f.kind, f.payload) as what, 'fact:feed:' || f.id::text as ukey
                  from public.feed_items f
                 where f.created_at >= p_now - v_win
                   and f.kind in ('level_up', 'promoted', 'league_won', 'streak', 'company_ipo', 'company_founded', 'company_upgraded',
                                  'company_expanded', 'home_bought', 'car_bought', 'job_started', 'coin_launched', 'deal_signed',
                                  'big_trade', 'rug_pull', 'loan_defaulted', 'deal_broken', 'coin_closed')
                union all
                select pc.founder_id, 'bad', 'Börsengang von ' || c2.name || ' geplatzt', 'fact:offer:' || o.id::text
                  from public.company_share_offers o
                  join public.player_companies pc on pc.company_id = o.company_id
                  join public.companies c2 on c2.id = o.company_id
                 where o.status = 'failed' and o.kind = 'ipo' and o.closed_at >= p_now - v_win
                union all
                select j.player_id, 'bad',
                       case when j.end_reason = 'fired' then 'bei ' || c2.name || ' rausgeflogen' else 'Job bei ' || c2.name || ' hingeschmissen' end,
                       'fact:job:' || j.id::text
                  from public.player_jobs j join public.companies c2 on c2.id = j.company_id
                 where j.status = 'ended' and j.ended_at >= p_now - v_win and j.end_reason in ('fired', 'quit')
                union all
                select p2.id, 'bad',
                       'seit ' || floor(extract(epoch from (p_now - p2.last_active_at)) / 86400)::integer || ' Tagen nicht mehr gesehen',
                       'fact:gone:' || p2.id::text || ':' || floor(extract(epoch from (p_now - p2.last_active_at)) / 86400)::integer
                  from public.profiles p2
                 where p2.last_active_at < p_now - make_interval(days => coalesce((cfg #>> '{gossip,absentDays}')::integer, 3))
                   and p2.last_active_at > p_now - interval '30 days'
                union all
                select w.entity_id, case when w.pos = 1 then 'good' else 'bad' end,
                       case when w.pos = 1 then 'Platz eins der Reichenliste mit ' else 'Schlusslicht der Reichenliste mit ' end
                         || public.format_eur(w.nw),
                       'fact:rank:' || w.entity_id::text || ':' || w.pos::text || ':' || (p_now at time zone 'Europe/Berlin')::date::text
                  from (select l.entity_id, l.nw, row_number() over (order by l.nw desc) as pos, count(*) over () as n,
                               row_number() over (order by l.nw asc) as rpos
                          from (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                                 where entity_kind = 'player' and taken_at >= p_now - interval '45 minutes'
                                 order by entity_id, taken_at desc) l) w
                 where w.n >= 3 and (w.pos = 1 or w.rpos = 1)
              ) c
              join public.profiles p on p.id = c.player_id and not p.is_deactivated
             where c.player_id <> all (v_seen)
               and not exists (select 1 from public.news_show_used u where u.key = c.ukey)
             order by c.player_id, random()) q
     order by (q.player_id = any (v_skip_p)), random()
     limit coalesce((cfg #>> '{gossip,count}')::integer, 2) loop
    v_n := v_n + 1;
    v_bps := case when r.grp = 'bad' then coalesce((cfg #>> '{gossip,hushMoneyCents}')::integer, 0) else 0 end;
    v_seg := public.news_show_segment('gossip', case when r.grp = 'bad' then 'gossipBad' else 'gossipGood' end,
      jsonb_build_object('name', r.nickname, 'what', r.what),
      case when v_bps > 0 then jsonb_build_array(jsonb_build_object('label', '+' || public.format_eur(v_bps) || ' Schmerzensgeld', 'tone', 'gain'))
           else '[]'::jsonb end,
      case when v_bps > 0 then jsonb_build_array(jsonb_build_object('type', 'cash', 'player_id', r.player_id, 'cents', v_bps))
           else '[]'::jsonb end,
      jsonb_build_object('type', 'player', 'player_id', r.player_id, 'name', r.nickname, 'what', r.what,
                         'good', r.grp = 'good', 'ukey', r.ukey));
    if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', case when v_n = 1 then 20 else 60 end)); end if;
    v_seen := v_seen || r.player_id;
  end loop;

  -- 6. the NFT market: the most expensive sale of the last hours, every sale only once
  select s.id, s.price_cents, a.title, a.creator_id, coalesce(cp.nickname, 'einem Unbekannten') as creator,
         coalesce(bp.nickname, s.buyer_ai, 'ein Unbekannter') as buyer
    into r
    from public.artwork_sales s
    join public.artworks a on a.id = s.artwork_id
    left join public.profiles cp on cp.id = a.creator_id
    left join public.profiles bp on bp.id = s.buyer_id
   where s.at >= p_now - make_interval(hours => coalesce((cfg #>> '{nft,windowHours}')::integer, 24))
     and not exists (select 1 from public.news_show_used u where u.key = 'fact:nft:' || s.id::text)
   order by s.price_cents desc, s.id desc
   limit 1;
  if r.id is not null then
    v_seg := public.news_show_segment('nft', 'nftSale',
      jsonb_build_object('name', r.creator, 'title', r.title, 'amount', public.format_eur(r.price_cents), 'buyer', r.buyer),
      '[]'::jsonb, '[]'::jsonb,
      jsonb_strip_nulls(jsonb_build_object('type', 'nft', 'player_id', r.creator_id, 'name', r.creator, 'title', r.title,
                                           'buyer', r.buyer, 'ukey', 'fact:nft:' || r.id::text)));
    if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', 40)); end if;
  end if;

  -- 7. he digresses: a rumour about a public figure and a stock (lifts it a little), or pure nonsense
  if random() * 10000 < coalesce((cfg #>> '{ramble,chanceBps}')::integer, 0) then
    v_seg := null;
    if random() * 10000 < coalesce((cfg #>> '{ramble,investShareBps}')::integer, 0)
       and jsonb_array_length(coalesce(cfg #> '{ramble,people}', '[]'::jsonb)) > 0 then
      select sec.id, sec.name, sec.ticker into r
        from public.securities sec join public.companies c on c.id = sec.company_id
       where sec.kind = 'stock' and sec.status = 'listed'
       order by random() * case when c.is_ai then 1 else 0.5 end
       limit 1;
      if r.id is not null then
        v_bps := public.rand_between((cfg #>> '{ramble,minBps}')::integer, (cfg #>> '{ramble,maxBps}')::integer);
        v_person := cfg #> '{ramble,people}' ->> least(jsonb_array_length(cfg #> '{ramble,people}') - 1,
                                                       floor(random() * jsonb_array_length(cfg #> '{ramble,people}'))::integer);
        v_seg := public.news_show_segment('ramble', 'rambleInvest',
          jsonb_build_object('person', v_person, 'stock', r.name, 'move', public.news_show_move(v_bps)),
          jsonb_build_array(jsonb_build_object('label', r.ticker || ' +' || public.news_show_move(v_bps), 'tone', 'gain')),
          jsonb_build_array(jsonb_build_object('type', 'stock', 'security_id', r.id, 'bps', v_bps)),
          jsonb_build_object('type', 'ramble', 'person', v_person, 'name', r.name, 'ticker', r.ticker));
      end if;
    end if;
    if v_seg is null then
      v_seg := public.news_show_segment('ramble', 'ramble', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '{"type": "ramble"}'::jsonb);
    end if;
    if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', 80)); end if;
  end if;

  -- 8. the winner of the day
  select w.entity_id as player_id, p.nickname, w.last_nw - w.first_nw as gain,
         ((w.last_nw - w.first_nw) * 10000 / w.first_nw)::integer as bps
    into r
    from (select l.entity_id, l.nw as last_nw, f.nw as first_nw
            from (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                   where entity_kind = 'player' and taken_at >= p_now - interval '45 minutes'
                   order by entity_id, taken_at desc) l
            join (select distinct on (entity_id) entity_id, net_worth_cents as nw from public.rich_list_snapshots
                   where entity_kind = 'player'
                     and taken_at >= p_now - make_interval(hours => coalesce((cfg #>> '{winner,windowHours}')::integer, 24))
                   order by entity_id, taken_at asc) f using (entity_id)
           where f.nw > 0) w
    join public.profiles p on p.id = w.entity_id
   where w.entity_id <> all (v_skip_p) and w.entity_id <> all (v_seen)
     and (w.last_nw - w.first_nw) * 10000 / w.first_nw >= coalesce((cfg #>> '{winner,minGainBps}')::integer, 300)
   order by (w.last_nw - w.first_nw) * 10000 / w.first_nw desc, random()
   limit 1;
  if r.player_id is not null then
    v_seg := public.news_show_segment('winner', 'winner',
      jsonb_build_object('name', r.nickname, 'amount', public.format_eur(r.gain), 'pct', public.news_show_move(r.bps)),
      '[]'::jsonb, '[]'::jsonb,
      jsonb_build_object('type', 'player', 'player_id', r.player_id, 'name', r.nickname));
    if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', 50)); end if;
  end if;

  -- 9. the hint for the coming hour (settled by the stock news job, ADR-119)
  if public.config_jsonb('stockNews') is not null then
    select sec.id, sec.name, sec.ticker into r from public.securities sec
     where sec.kind = 'stock' and sec.status = 'listed'
       and not exists (select 1 from public.stock_tips x where x.security_id = sec.id and x.applied_at is null)
     order by random() limit 1;
    if r.id is not null then
      v_dir := case when random() < 0.5 then 1 else -1 end;
      v_bps := public.rand_between((cfg #>> '{tip,minBps}')::integer, (cfg #>> '{tip,maxBps}')::integer);
      v_tip := public.news_show_segment('tip', 'tip',
        jsonb_build_object('stock', r.name, 'move', cfg #>> array['tipWords', case when v_dir > 0 then 'up' else 'down' end]),
        jsonb_build_array(jsonb_build_object('label', r.ticker || ' ' || case when v_dir > 0 then '↑' else '↓' end || ' Tipp', 'tone', 'neutral')),
        jsonb_build_array(jsonb_build_object(
          'type', 'tip', 'security_id', r.id, 'direction', v_dir, 'bps', v_bps,
          'comes_true', random() * 10000 < coalesce((cfg #>> '{tip,reliabilityBps}')::integer, 7000),
          'lead_minutes', public.rand_between((cfg #>> '{tip,leadMinMinutes}')::integer, (cfg #>> '{tip,leadMaxMinutes}')::integer))),
        jsonb_build_object('type', 'tip', 'name', r.name, 'ticker', r.ticker, 'up', v_dir > 0));
    end if;
  end if;

  if jsonb_array_length(v_segs) = 0 and v_tip is null then
    v_seg := public.news_show_segment('world', 'filler', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '{"type": "filler"}'::jsonb);
    if v_seg is not null then v_segs := v_segs || (v_seg || jsonb_build_object('ord', 5)); end if;
  end if;
  -- the order of the show: people first, the AI stock last; then at most maxSegments, the hint always last
  select coalesce(jsonb_agg((x - 'ord') order by coalesce((x ->> 'ord')::integer, 0), ord), '[]'::jsonb) into v_segs
    from jsonb_array_elements(v_segs) with ordinality t(x, ord);
  if v_tip is not null then
    select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_segs
      from jsonb_array_elements(v_segs) with ordinality t(x, ord) where ord <= v_max - 1;
    v_segs := v_segs || v_tip;
  else
    select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into v_segs
      from jsonb_array_elements(v_segs) with ordinality t(x, ord) where ord <= v_max;
  end if;
  return v_segs;
end;
$$;
comment on function public.news_show_build(timestamptz) is
  'Internal: the draft of a news show (ADR-150, ADR-152): loser, personal news, player companies, NFT, winner, digression, sector or tasks, AI stock, hint.';

-- News about players stand under "Spieler" in the news feed (one line of news_show_start changes).
do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_start(bigint, timestamptz)'::regprocedure);
  v_old text := $t$when seg ->> 'kind' in ('loser', 'winner') then 'player'$t$;
  v_new text := $t$when seg ->> 'kind' in ('loser', 'winner', 'gossip', 'nft') then 'player'$t$;
begin
  if position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

-- After a show started: its facts count as told, and the made-up viewers get their lines for the whole show.
create or replace function public.news_show_after_start(p_show_id bigint, p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.news_show_cfg();
  bots    jsonb := public.news_show_cfg() #> '{chat,bots}';
  s       public.news_shows;
  v_intro numeric := coalesce((cfg ->> 'introSeconds')::numeric, 8);
  v_seg   numeric := greatest(1, coalesce((cfg ->> 'segmentSeconds')::numeric, 22));
  v_outro numeric := coalesce((cfg ->> 'outroSeconds')::numeric, 6);
  v_count integer;
  v_at    numeric;
  v_end   numeric;
  v_i     integer;
  v_about text;
  v_kind  text;
  v_line  text;
  v_u     double precision;
  v_n     integer := 0;
begin
  select * into s from public.news_shows where id = p_show_id;
  if s.id is null or s.status <> 'aired' then
    return 0;
  end if;
  insert into public.news_show_used (key, used_at)
  select distinct x -> 'subject' ->> 'ukey', clock_timestamp()
    from jsonb_array_elements(s.segments) x where x -> 'subject' ->> 'ukey' is not null
  on conflict (key) do update set used_at = excluded.used_at;

  if bots is null or jsonb_array_length(coalesce(bots -> 'names', '[]'::jsonb)) = 0 then
    return 0;
  end if;
  v_count := jsonb_array_length(s.segments);
  v_end := v_intro + v_count * v_seg + v_outro;
  v_at := 2 + random() * 3;
  while v_at < v_end and v_n < 200 loop
    v_i := floor((v_at - v_intro) / v_seg)::integer;
    v_about := case when v_at >= v_intro and v_i < v_count then s.segments -> v_i -> 'subject' ->> 'name' end;
    v_u := random() * 10000;
    v_kind := case when v_about is not null and v_u < coalesce((bots ->> 'aboutShareBps')::integer, 0) then 'about'
                   when v_u < coalesce((bots ->> 'aboutShareBps')::integer, 0) + coalesce((bots ->> 'angryShareBps')::integer, 5000) then 'angry'
                   else 'glaze' end;
    select replace(l, '{name}', coalesce(v_about, '')) into v_line
      from jsonb_array_elements_text(coalesce(bots -> 'lines' -> v_kind, '[]'::jsonb)) l order by random() limit 1;
    if v_line is not null and btrim(v_line) <> '' then
      insert into public.news_show_messages (player_id, bot_name, body, created_at)
      select null, n, left(v_line, 300), p_now + make_interval(secs => v_at::double precision)
        from jsonb_array_elements_text(bots -> 'names') n order by random() limit 1;
      v_n := v_n + 1;
    end if;
    v_at := v_at + public.rand_between(greatest(1, coalesce((bots ->> 'everySecondsMin')::integer, 6)),
                                       greatest(1, coalesce((bots ->> 'everySecondsMax')::integer, 14)));
  end loop;
  return v_n;
end;
$$;
comment on function public.news_show_after_start(bigint, timestamptz) is
  'Internal: marks the facts of a started show as told and writes the lines of the made-up chat viewers (ADR-152).';

-- The chat: players and made-up viewers; lines of the latter appear when their time has come.
create or replace function public.news_show_chat_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nickname', m.nickname, 'body', m.body, 'at', m.created_at,
                                               'mine', coalesce(m.player_id = p_player, false))
                            order by m.created_at, m.id), '[]'::jsonb)
    from (select x.id, x.body, x.created_at, x.player_id, coalesce(x.bot_name, p.nickname) as nickname
            from public.news_show_messages x left join public.profiles p on p.id = x.player_id
           where x.created_at > public.game_now() - interval '75 minutes' and x.created_at <= public.game_now()
             and coalesce(x.bot_name, p.nickname) is not null
           order by x.created_at desc, x.id desc
           limit coalesce((public.news_show_cfg() #>> '{chat,history}')::integer, 60)) m;
$$;

create or replace function public.get_news_show()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.news_show_cfg();
  v_player uuid := public.require_player();
  v_now    timestamptz := public.game_now();
  v_hour   timestamptz := date_trunc('hour', public.game_now());
  v_wait   interval := make_interval(mins => coalesce((cfg ->> 'waitMinutes')::integer, 10));
  s        public.news_shows;
  u        public.news_shows;
begin
  -- I am watching
  insert into public.news_show_viewers (player_id, seen_at) values (v_player, v_now)
  on conflict (player_id) do update set seen_at = excluded.seen_at
   where public.news_show_viewers.seen_at < excluded.seen_at - interval '4 seconds';
  -- the draft may be missing when the job is late; this hour's show starts with its first viewer
  if not exists (select 1 from public.news_shows x
                  where x.airs_at = case when v_now < v_hour + v_wait then v_hour else v_hour + interval '1 hour' end) then
    perform public.news_show_run_due(v_now);
  end if;
  select * into u from public.news_shows x where x.airs_at = v_hour and x.status = 'scheduled';
  if u.id is not null and v_now < v_hour + v_wait then
    if public.news_show_start(u.id, v_now) then
      perform public.news_show_after_start(u.id, v_now);
    end if;
  end if;
  -- the show to watch: the last one that aired, while it can be replayed
  select * into s from public.news_shows x
   where x.status = 'aired'
     and x.started_at > v_now - make_interval(mins => coalesce((cfg ->> 'replayMinutes')::integer, 55))
   order by x.airs_at desc limit 1;
  select * into u from public.news_shows x where x.status = 'scheduled' and x.airs_at > v_now order by x.airs_at limit 1;
  return jsonb_build_object(
    'now', v_now,
    'next_airs_at', coalesce(u.airs_at, v_hour + interval '1 hour'),
    'viewers', (select count(*) from public.news_show_viewers v where v.seen_at > v_now - interval '20 seconds'),
    'upcoming', case when u.id is null then null else jsonb_build_object(
                  'id', u.id, 'airs_at', u.airs_at,
                  'needs_script', u.writer = 'mini' and u.ai_requested_at is null) end,
    'show', case when s.id is null then null else jsonb_build_object(
              'id', s.id, 'airs_at', s.airs_at, 'started_at', s.started_at, 'writer', s.writer,
              'segments', coalesce((select jsonb_agg(jsonb_build_object('kind', x ->> 'kind', 'mood', coalesce(x ->> 'mood', 'neutral'),
                                                                        'headline', x ->> 'headline',
                                                                        'text', x ->> 'text', 'effects', x -> 'effects')
                                                      order by ord)
                                      from jsonb_array_elements(s.segments) with ordinality t(x, ord)), '[]'::jsonb)) end,
    'chat', public.news_show_chat_json(v_player));
end;
$$;

-- Claude sees the mood and may choose another one of the known faces.
create or replace function public.news_show_script_context(p_show_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'show_id', s.id, 'status', s.status, 'airs_at', s.airs_at,
    'segments', coalesce((select jsonb_agg(jsonb_build_object(
                             'kind', x ->> 'kind', 'mood', coalesce(x ->> 'mood', 'neutral'),
                             'headline', x ->> 'headline', 'text', x ->> 'text',
                             'effects', (select coalesce(jsonb_agg(e ->> 'label'), '[]'::jsonb) from jsonb_array_elements(x -> 'effects') e),
                             'facts', (x -> 'subject') - 'player_id' - 'company_id' - 'ukey') order by ord)
                            from jsonb_array_elements(s.segments) with ordinality t(x, ord)), '[]'::jsonb))
    from public.news_shows s where s.id = p_show_id;
$$;

create or replace function public.store_news_show_script(p_show_id bigint, p_segments jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s      public.news_shows;
  v_new  jsonb;
begin
  select * into s from public.news_shows where id = p_show_id for update;
  if s.id is null or s.status <> 'scheduled' or jsonb_typeof(p_segments) <> 'array'
     or jsonb_array_length(p_segments) <> jsonb_array_length(s.segments) then
    return false;
  end if;
  if exists (select 1 from jsonb_array_elements(p_segments) x
              where not public.company_ai_text_ok(x ->> 'headline', 90, true)
                 or not public.company_ai_text_ok(x ->> 'text', 420, true)) then
    return false;
  end if;
  select jsonb_agg(o.x || jsonb_build_object('headline', btrim(n.x ->> 'headline'), 'text', btrim(n.x ->> 'text'))
                       || case when n.x ->> 'mood' in ('neutral', 'shocked', 'crying', 'laughing', 'angry', 'smug', 'confused', 'proud')
                               then jsonb_build_object('mood', n.x ->> 'mood') else '{}'::jsonb end
                   order by o.ord)
    into v_new
    from jsonb_array_elements(s.segments) with ordinality o(x, ord)
    join jsonb_array_elements(p_segments) with ordinality n(x, ord) using (ord);
  update public.news_shows set segments = v_new, writer = 'claude' where id = s.id;
  return true;
end;
$$;

revoke all on function public.news_show_segment(text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.news_show_build(timestamptz) from public, anon, authenticated;
revoke all on function public.news_show_after_start(bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.news_show_chat_json(uuid) from public, anon, authenticated;
revoke all on function public.news_show_script_context(bigint) from public, anon, authenticated;
revoke all on function public.store_news_show_script(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.news_show_script_context(bigint) to service_role;
grant execute on function public.store_news_show_script(bigint, jsonb) to service_role;
revoke all on function public.get_news_show() from public, anon;
grant execute on function public.get_news_show() to authenticated;
