-- ===== idempotent copy of migrations/20261204005700_news_topics.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5700 · NEXA Nachrichten: many more topics (ADR-169)
-- =============================================================================
-- news_show_topics() collects what the new topics of the show could tell right now and draws a few of them:
-- * collectibles (Nexamon): prisma and legendary pulls, the dearest sale, cards whose value moved, a 10 or a low
--   grade from ASP, a spree of packs without a hit, the most valuable collection, what the AI sellers sit on;
-- * Finanzamt: late fee, estimated tax, forced collection, audit, a streak of clean books, open tax debt, and the
--   announcements of Oberamtsrat Griesgram (no data needed);
-- * listed companies: greedy founder, mass resignation, record dividend, board revolt, miserable or glorious
--   satisfaction, research finished;
-- * persons: the worst and the best trade, biggest loser and winner of the hour, rent collected, wardrobe shopping,
--   everything worn at once, a battle won or lost, missions re-rolled, messages (the number, never the content),
--   new friends, pokes, sleeping players, a founder who fired someone or pays themselves, promotions, a new home or car;
-- * odd bits without data: obituaries for invented portfolios, the stock weather, ads, horoscope, letters, studies.
-- All facts are read from tables that exist anyway (packs, sales, copies, feed items, snapshots, ...), nothing is
-- written on the way. The texts, weights and limits are in game_config.newsShow (topics, texts, moods).
-- Idempotent: runs unchanged as supabase/updates/20261204005700_news_topics.sql.

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
  'Internal: the topic segments of a news show (ADR-169): collectibles, Finanzamt, listed companies, personal news and '
  'odd bits, drawn by weight with rotation; reads facts only, the caller sorts them into the show by "ord".';
revoke all on function public.news_show_topics(timestamptz, uuid[], uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.news_show_topics(timestamptz, uuid[], uuid[], jsonb) to service_role;
