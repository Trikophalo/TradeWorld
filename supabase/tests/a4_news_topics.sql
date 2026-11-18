-- =============================================================================
-- a4 · NEXA Nachrichten: many more topics (ADR-169)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0a419a41-0000-4000-8000-0000000000a1'''
\set b '''0a419a41-0000-4000-8000-0000000000b1'''
\set c '''0a419a41-0000-4000-8000-0000000000c1'''
\set d '''0a419a41-0000-4000-8000-0000000000d1'''
update public.invite_codes set max_uses = max_uses + 4 where code = 'M1-TESTS';
select tests.signup(:a, 'Topic_Anna') is not null and tests.signup(:b, 'Topic_Bert') is not null
   and tests.signup(:c, 'Topic_Cleo') is not null and tests.signup(:d, 'Topic_Dirk') is not null as ok \gset
select value as show_cfg from public.game_config where key = 'newsShow' \gset

-- One topic alone (every other weight 0), told about the four test players only; '{}' when it has nothing to tell.
create or replace function tests.news_topic(p_key text)
returns jsonb
language plpgsql
as $$
declare
  v_cfg  jsonb;
  v_out  jsonb;
  v_seen uuid[];
begin
  select value into v_cfg from public.game_config where key = 'newsShow';
  select coalesce(array_agg(p.id), '{}') into v_seen from public.profiles p where p.nickname not like 'Topic\_%';
  update public.game_config
     set value = jsonb_set(value, '{topics,list}',
           (select jsonb_object_agg(t.key, case when t.key = p_key then t.value else t.value || '{"weight": 0}'::jsonb end)
              from jsonb_each(v_cfg #> '{topics,list}') t))
   where key = 'newsShow';
  v_out := public.news_show_topics(now(), v_seen, '{}', '[]'::jsonb);
  update public.game_config set value = v_cfg where key = 'newsShow';
  return coalesce(v_out -> 0, '{}'::jsonb);
end;
$$;
-- headline and text of a segment
create or replace function tests.said(p_seg jsonb)
returns text
language sql
as $$ select coalesce(p_seg ->> 'headline', '') || ' | ' || coalesce(p_seg ->> 'text', '') $$;

-- A. config: the topics, a script and moods for each, the card names
select tests.assert(
  (select (g.value #>> '{topics,count}')::int >= 3 and (g.value ->> 'maxSegments')::int = 12
          and jsonb_array_length(g.value #> '{topics,ords}') >= (g.value #>> '{topics,count}')::int
          and (select count(*) from jsonb_object_keys(g.value #> '{topics,list}')) >= 40
          and not exists (
                select 1 from jsonb_each(g.value #> '{topics,list}') t
                 where jsonb_array_length(coalesce(g.value #> array['texts', t.key, 'frames'], '[]'::jsonb)) < 3
                    or jsonb_array_length(coalesce(g.value #> array['texts', t.key, 'reasons'], '[]'::jsonb)) < 6
                    or jsonb_array_length(coalesce(g.value #> array['moods', t.key], '[]'::jsonb)) < 1
                    or t.value ->> 'group' not in ('cards', 'tax', 'corp', 'person', 'odd', 'world', 'talent', 'rank')
                    or t.value ->> 'kind' not in ('cards', 'tax', 'corp', 'gossip', 'ramble', 'world')
                    or (t.value ->> 'weight')::int <= 0)
     from public.game_config g where g.key = 'newsShow')
  and (select count(*) from jsonb_object_keys((select value from public.game_config where key = 'nexamon_names')))
      = (select jsonb_array_length(value) from public.game_config where key = 'nexamon_cards'),
  'config: at least 40 topics with group, kind, weight, 3+ frames, 6+ reasons and moods; a name for every Nexamon card');
select tests.assert(
  position('news_show_topics' in pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure)) > 0
  and position('''tax'', ''corp''' in pg_get_functiondef('public.news_show_start(bigint, timestamptz)'::regprocedure)) > 0
  and not has_function_privilege('authenticated', 'public.news_show_topics(timestamptz, uuid[], uuid[], jsonb)', 'execute'),
  'hooks: news_show_build() calls the topics, the news feed files tax and corp under companies, players cannot call it');

delete from public.news_shows;
delete from public.news_show_used where key like 'fact:%';

-- B. nothing happened: no crash, only stories that need no fresh facts, no placeholder left over
select tests.set_cfg('newsShow', '{topics,count}', '500');
select public.news_show_topics(now() - interval '10 years', (select array_agg(id) from public.profiles), '{}', '[]'::jsonb) as quiet \gset
select tests.assert(
  jsonb_array_length(:'quiet'::jsonb) >= 7
  and not exists (select 1 from jsonb_array_elements(:'quiet'::jsonb) x
                   where tests.said(x) like '%{%' or x -> 'subject' ? 'player_id' or x -> 'apply' <> '[]'::jsonb)
  and (select count(*) from jsonb_array_elements(:'quiet'::jsonb) x
        where x -> 'subject' ->> 'topic' in ('taxBit', 'oddObituary', 'oddWeather', 'oddAd', 'oddHoroscope', 'oddMail', 'oddStudy')) = 7
  and (select count(distinct x -> 'subject' ->> 'topic') from jsonb_array_elements(:'quiet'::jsonb) x) = jsonb_array_length(:'quiet'::jsonb),
  'no data: the seven topics without placeholders carry the show, every text is complete, nobody is named');
select tests.assert(
  public.news_show_topics(null, null, null, null) is not null,
  'no crash on null arguments');

-- C. collectibles
insert into public.nexamon_packs (player_id, set_key, price_cents, cards)
values (:a, 'mystic_energy', 20000,
        '[{"slot": 1, "copy_id": "0a419a41-0000-4000-8000-00000000c001", "card_key": "me-001", "rarity": "common"},
          {"slot": 5, "copy_id": "0a419a41-0000-4000-8000-00000000c005", "card_key": "me-076", "rarity": "legendary"}]'::jsonb);
insert into public.nexamon_packs (player_id, set_key, price_cents, cards)
select :b, 'mystic_energy', 20000, '[{"slot": 1, "copy_id": "0a419a41-0000-4000-8000-00000000d001", "card_key": "me-002", "rarity": "common"},
                                     {"slot": 4, "copy_id": "0a419a41-0000-4000-8000-00000000d004", "card_key": "me-051", "rarity": "rare"}]'::jsonb
  from generate_series(1, 5);
select value ->> 'me-076' as legend, value ->> 'me-071' as prisma, value ->> 'me-072' as prisma2, value ->> 'me-073' as prisma3,
       value ->> 'me-010' as up_card, value ->> 'me-011' as down_card
  from public.game_config where key = 'nexamon_names' \gset
select tests.news_topic('cardPull') as s \gset
select tests.assert(
  :'s'::jsonb ->> 'kind' = 'cards' and tests.said(:'s'::jsonb) like '%Topic_Anna%' and tests.said(:'s'::jsonb) like '%' || :'legend' || '%'
  and tests.said(:'s'::jsonb) not like '%{%'
  and :'s'::jsonb #>> '{subject,values,rarity}' = 'Legendär' and :'s'::jsonb #>> '{subject,values,set}' = 'Nexamon: Mystic Energy'
  and :'s'::jsonb #>> '{subject,values,packs}' = '1' and :'s'::jsonb #>> '{subject,ukey}' = 'fact:npull:0a419a41-0000-4000-8000-00000000c005'
  and :'s'::jsonb #>> '{subject,topic}' = 'cardPull' and (:'s'::jsonb #>> '{subject,player_id}')::uuid = :a
  and :'s'::jsonb -> 'apply' = '[]'::jsonb and :'s'::jsonb ->> 'mood' in ('shocked', 'proud', 'smug'),
  'cardPull: a legendary pull with player, card name, rarity, set and the packs it took');
select tests.news_topic('cardDud') as s \gset
select tests.assert(
  tests.said(:'s'::jsonb) like '%Topic_Bert%' and tests.said(:'s'::jsonb) like '%5 Booster%' and tests.said(:'s'::jsonb) like '%1.000 €%'
  and tests.said(:'s'::jsonb) not like '%{%'
  and :'s'::jsonb #>> '{apply,0,type}' = 'cash' and (:'s'::jsonb #>> '{apply,0,cents}')::int = 10000
  and (:'s'::jsonb #>> '{apply,0,player_id}')::uuid = :b and :'s'::jsonb #>> '{effects,0,label}' like '%Schmerzensgeld',
  'cardDud: five packs without a hit, with what they cost; a bad story pays topics.hushMoneyCents');
insert into public.nexamon_packs (player_id, set_key, price_cents, cards)
values (:b, 'mystic_energy', 20000, '[{"slot": 5, "copy_id": "0a419a41-0000-4000-8000-00000000d005", "card_key": "me-061", "rarity": "ultra"}]'::jsonb);
select tests.assert(tests.news_topic('cardDud') = '{}'::jsonb, 'cardDud: one ultra rare among the packs and it is no story any more');

insert into public.nexamon_sales (card_key, seller_id, buyer_ai, price_cents, condition, factor_bps, kind, value_before_e4, value_after_e4)
values ('me-071', :a, 'Sammel-Sven', 99990000, 'mint', 10000, 'ai_buy', 1, 1) returning id as sale \gset
select tests.news_topic('cardSale') as s \gset
select tests.assert(
  tests.said(:'s'::jsonb) like '%999.900 €%' and tests.said(:'s'::jsonb) like '%' || :'prisma' || '%'
  and tests.said(:'s'::jsonb) not like '%{%'
  and :'s'::jsonb #>> '{subject,values,seller}' = 'Topic_Anna' and :'s'::jsonb #>> '{subject,values,buyer}' = 'Sammel-Sven'
  and :'s'::jsonb #>> '{subject,ukey}' = 'fact:nsale:' || :sale,
  'cardSale: the dearest sale of the window with seller, buyer, card and price');

update public.nexamon_cards set day_ref_on = (now() at time zone 'Europe/Berlin')::date, day_ref_e4 = 1000000, value_e4 = 1900000
 where card_key = 'me-010';
update public.nexamon_cards set day_ref_on = (now() at time zone 'Europe/Berlin')::date, day_ref_e4 = 1000000, value_e4 = 300000
 where card_key = 'me-011';
select tests.news_topic('cardUp') as s, tests.news_topic('cardDown') as s2 \gset
select tests.assert(
  tests.said(:'s'::jsonb) like '%' || :'up_card' || '%' and tests.said(:'s'::jsonb) like '%90 %' and tests.said(:'s'::jsonb) not like '%{%'
  and tests.said(:'s2'::jsonb) like '%' || :'down_card' || '%' and tests.said(:'s2'::jsonb) like '%70 %' and tests.said(:'s2'::jsonb) not like '%{%'
  and not (:'s'::jsonb -> 'subject') ? 'player_id',
  'cardUp / cardDown: the cards whose value left the day''s first value the most');

insert into public.nexamon_copies (card_key, serial, owner_id, condition, grade, graded_at, grading_fee_cents, source)
values ('me-072', 990001, :c, 'mint', 10, now(), 12300, 'pack'), ('me-073', 990002, :d, 'poor', 3, now(), 4500, 'pack');
select tests.news_topic('cardGradeTop') as s, tests.news_topic('cardGradeLow') as s2 \gset
select tests.assert(
  tests.said(:'s'::jsonb) like '%Topic_Cleo%' and tests.said(:'s'::jsonb) like '%' || :'prisma2' || '%' and tests.said(:'s'::jsonb) like '%123 €%'
  and tests.said(:'s'::jsonb) not like '%{%' and :'s'::jsonb -> 'apply' = '[]'::jsonb
  and tests.said(:'s2'::jsonb) like '%Topic_Dirk%' and tests.said(:'s2'::jsonb) like '%' || :'prisma3' || '%' and tests.said(:'s2'::jsonb) like '%45 €%'
  and tests.said(:'s2'::jsonb) not like '%{%' and :'s2'::jsonb #>> '{subject,values,grade}' = '3'
  and :'s2'::jsonb #>> '{apply,0,type}' = 'cash',
  'cardGradeTop / cardGradeLow: a 10 and a painful grade from ASP with the fee');

insert into public.nexamon_copies (card_key, serial, owner_id, condition, source)
select 'me-077', 990100 + g, :a, 'mint', 'pack' from generate_series(1, 6) g;
update public.game_config set value = jsonb_set(value, '{topics,cards,collectionMinCards}', '6') where key = 'newsShow';
select tests.news_topic('cardCollection') as s \gset
select tests.assert(
  (tests.said(:'s'::jsonb) like '%Topic_Anna%' and tests.said(:'s'::jsonb) like '%6 Karten%' and tests.said(:'s'::jsonb) not like '%{%')
  or :'s'::jsonb = '{}'::jsonb,
  'cardCollection: the most valuable collection (only the very first of all players is a story)');
begin;
delete from public.nexamon_copies where owner_id is not null and owner_id not in (:a, :b, :c, :d);
select tests.news_topic('cardCollection') as s \gset
select tests.assert(
  tests.said(:'s'::jsonb) like '%Topic_Anna%' and tests.said(:'s'::jsonb) like '%6 Karten%' and tests.said(:'s'::jsonb) not like '%{%',
  'cardCollection: count and worth of the most valuable collection');
rollback;

select tests.news_topic('cardAi') as s \gset
select tests.assert(
  :'s'::jsonb ->> 'kind' = 'cards' and tests.said(:'s'::jsonb) not like '%{%' and tests.said(:'s'::jsonb) like '%€%'
  and :'s'::jsonb #>> '{subject,values,seller}' in (select jsonb_array_elements_text(value #> '{ai,sellers}') from public.game_config where key = 'nexamon')
  and (:'s'::jsonb #>> '{subject,values,count}')::int >= 2,
  'cardAi: what an AI seller sits on');

-- D. Finanzamt and listed companies, from the feed
insert into public.feed_items (actor_id, kind, payload) values
  (:a, 'tax_penalty', '{"company": "Topicwerk", "reason": "late_fee", "amount_cents": 24000}'),
  (:a, 'tax_penalty', '{"company": "Topicwerk", "reason": "estimate"}'),
  (:a, 'tax_penalty', '{"company": "Topicwerk", "reason": "enforcement"}'),
  (:a, 'tax_audit', '{"company": "Topicwerk"}'),
  (:a, 'greedy_founder', '{"company": "Topicwerk", "ratio_bps": 8700}'),
  (:a, 'mass_quit', '{"company": "Topicwerk", "count": 4}'),
  (:a, 'record_dividend', '{"company": "Topicwerk", "amount_cents": 5550000}'),
  (:b, 'board_revolt', '{"company": "Topicwerk", "kind": "dividend"}'),
  (:a, 'research_done', '{"company": "Topicwerk", "item": "r_quality_1"}'),
  (:c, 'promoted', '{"company": "Topicwerk", "tier": "senior"}'),
  (:d, 'car_bought', '{"car_key": "car_classic", "price_cents": 14000000}');
select tests.news_topic('taxLate') as s1, tests.news_topic('taxEstimate') as s2, tests.news_topic('taxEnforce') as s3,
       tests.news_topic('taxAudit') as s4, tests.news_topic('corpGreedy') as s5, tests.news_topic('corpQuit') as s6,
       tests.news_topic('corpDividend') as s7, tests.news_topic('corpRevolt') as s8, tests.news_topic('corpResearch') as s9,
       tests.news_topic('pPromoted') as s10, tests.news_topic('pProperty') as s11 \gset
select tests.assert(
  :'s1'::jsonb ->> 'kind' = 'tax' and tests.said(:'s1'::jsonb) like '%Topic_Anna%' and tests.said(:'s1'::jsonb) like '%Topicwerk%'
  and tests.said(:'s1'::jsonb) like '%240 €%' and tests.said(:'s1'::jsonb) not like '%{%' and :'s1'::jsonb -> 'apply' = '[]'::jsonb
  and :'s2'::jsonb ->> 'kind' = 'tax' and tests.said(:'s2'::jsonb) like '%Topic_Anna%' and tests.said(:'s2'::jsonb) like '%Topicwerk%'
  and tests.said(:'s2'::jsonb) not like '%{%'
  and :'s3'::jsonb ->> 'kind' = 'tax' and tests.said(:'s3'::jsonb) like '%Topic_Anna%' and tests.said(:'s3'::jsonb) like '%Topicwerk%'
  and tests.said(:'s3'::jsonb) not like '%{%'
  and :'s4'::jsonb ->> 'kind' = 'tax' and tests.said(:'s4'::jsonb) like '%Topic_Anna%' and tests.said(:'s4'::jsonb) like '%Topicwerk%'
  and tests.said(:'s4'::jsonb) not like '%{%',
  'taxLate, taxEstimate, taxEnforce, taxAudit: the Finanzamt with founder, company and the late fee; no reward for a penalty');
select tests.assert(
  :'s5'::jsonb ->> 'kind' = 'corp' and tests.said(:'s5'::jsonb) like '%Topic_Anna%' and tests.said(:'s5'::jsonb) like '%87 %'
  and tests.said(:'s5'::jsonb) not like '%{%'
  and tests.said(:'s6'::jsonb) like '%Topicwerk%' and tests.said(:'s6'::jsonb) like '%4 %' and tests.said(:'s6'::jsonb) not like '%{%'
  and tests.said(:'s7'::jsonb) like '%55.500 €%' and tests.said(:'s7'::jsonb) like '%Topicwerk%' and tests.said(:'s7'::jsonb) not like '%{%'
  and tests.said(:'s8'::jsonb) like '%Topic_Bert%' and tests.said(:'s8'::jsonb) like '%Topicwerk%' and tests.said(:'s8'::jsonb) not like '%{%'
  and :'s9'::jsonb ->> 'kind' = 'corp' and tests.said(:'s9'::jsonb) like '%Topicwerk%' and tests.said(:'s9'::jsonb) not like '%{%',
  'corpGreedy, corpQuit, corpDividend, corpRevolt, corpResearch: listed companies with share, head count and dividend');
select tests.assert(
  :'s10'::jsonb ->> 'kind' = 'gossip' and tests.said(:'s10'::jsonb) like '%Topic_Cleo%' and tests.said(:'s10'::jsonb) like '%Topicwerk%'
  and tests.said(:'s10'::jsonb) not like '%{%'
  and tests.said(:'s11'::jsonb) like '%Topic_Dirk%' and tests.said(:'s11'::jsonb) like '%ein neues Auto gekauft für 140.000 €%'
  and tests.said(:'s11'::jsonb) not like '%{%',
  'pPromoted, pProperty: a promotion and a new car with its price');
insert into public.feed_items (actor_id, kind, payload) values (:c, 'mass_quit', '{"company": "Einerwerk", "count": 1}');
select tests.assert(
  (select bool_and(tests.said(tests.news_topic('corpQuit')) like '%Topicwerk%') from generate_series(1, 6)),
  'corpQuit: a single resignation is no wave (corp.quitMin)');

-- E. Finanzamt and satisfaction from the state of a listed company
select tests.set_level(:a, 10);
select tests.fund(:a, 20000000, 'test:topics:a');
select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Topicwerk AG', 'Schlagzeilen am Fließband', 'tech', '#225588', 'garage')
  -> 'company' ->> 'id' as lc \gset
reset role;
update public.companies set phase = 'listed' where id = :'lc';
select public.listed_ensure(:'lc') is not null as ok \gset
update public.listed_companies set books_streak = 9, satisfaction = 12 where company_id = :'lc';
insert into public.company_tax_periods (company_id, kind, period_start, period_end, tax_cents, penalty_cents, closed_by, due_at)
values (:'lc', 'books', now() - interval '1 day', now(), 700000, 77700, 'founder', now() + interval '1 day') returning id as tax_period \gset
select tests.news_topic('taxStreak') as s1, tests.news_topic('taxDebt') as s2, tests.news_topic('corpMoodLow') as s3 \gset
update public.listed_companies set satisfaction = 96 where company_id = :'lc';
select tests.news_topic('corpMoodHigh') as s4, tests.news_topic('corpMoodLow') as s5 \gset
select tests.assert(
  tests.said(:'s1'::jsonb) like '%Topic_Anna%' and tests.said(:'s1'::jsonb) like '%Topicwerk AG%' and tests.said(:'s1'::jsonb) like '%9 Tage%'
  and tests.said(:'s1'::jsonb) not like '%{%' and :'s1'::jsonb ->> 'kind' = 'tax'
  and tests.said(:'s2'::jsonb) like '%Topic_Anna%' and tests.said(:'s2'::jsonb) like '%€%' and tests.said(:'s2'::jsonb) not like '%{%'
  and tests.said(:'s3'::jsonb) like '%12 von 100%' and tests.said(:'s3'::jsonb) like '%Topicwerk AG%' and tests.said(:'s3'::jsonb) not like '%{%'
  and tests.said(:'s4'::jsonb) like '%96 von 100%' and tests.said(:'s4'::jsonb) not like '%{%' and :'s4'::jsonb ->> 'kind' = 'corp'
  and :'s5'::jsonb = '{}'::jsonb,
  'taxStreak, taxDebt, corpMoodLow, corpMoodHigh: a streak of clean books, open tax, miserable and glorious satisfaction');
delete from public.company_tax_periods where id = :tax_period;
update public.listed_companies set books_streak = 0, satisfaction = 60 where company_id = :'lc';

-- F. persons
-- one trade gone wrong, one that went well (copies of a trade of the test database; trades are immutable)
insert into public.trades (order_id, player_id, security_id, side, quantity_e6, price_e4, gross_cents, realized_pnl_cents, executed_at)
select t.order_id, :c, t.security_id, t.side, t.quantity_e6, t.price_e4, t.gross_cents, -77700000, now()
  from public.trades t order by t.executed_at desc limit 1
returning id as t1, security_id as t1sec \gset
insert into public.trades (order_id, player_id, security_id, side, quantity_e6, price_e4, gross_cents, realized_pnl_cents, executed_at)
select t.order_id, :d, t.security_id, t.side, t.quantity_e6, t.price_e4, t.gross_cents, 88800000, now()
  from public.trades t where t.id = :'t1';
select name as t1stock from public.securities where id = :'t1sec' \gset
select tests.news_topic('pTradeLoss') as s1, tests.news_topic('pTradeWin') as s2 \gset
select tests.assert(
  :'s1'::jsonb ->> 'kind' = 'gossip' and tests.said(:'s1'::jsonb) like '%Topic_Cleo%' and tests.said(:'s1'::jsonb) like '%777.000 €%'
  and tests.said(:'s1'::jsonb) like '%' || :'t1stock' || '%'
  and tests.said(:'s1'::jsonb) not like '%{%' and :'s1'::jsonb #>> '{apply,0,type}' = 'cash'
  and :'s1'::jsonb #>> '{subject,ukey}' = 'fact:trade:' || :'t1'
  and tests.said(:'s2'::jsonb) like '%Topic_Dirk%' and tests.said(:'s2'::jsonb) like '%888.000 €%' and tests.said(:'s2'::jsonb) not like '%{%'
  and :'s2'::jsonb -> 'apply' = '[]'::jsonb,
  'pTradeLoss / pTradeWin: one trade with its realised loss or gain and the stock');

insert into public.rich_list_snapshots (taken_at, entity_kind, entity_id, net_worth_cents, rank_all, rank_players)
values (now() - interval '70 minutes', 'player', :a, 1000000, 1, 1), (now() - interval '5 minutes', 'player', :a, 100000, 1, 1),
       (now() - interval '70 minutes', 'player', :b, 1000000, 2, 2), (now() - interval '5 minutes', 'player', :b, 10000000, 2, 2);
select tests.news_topic('pHourLoser') as s1, tests.news_topic('pHourWinner') as s2 \gset
select tests.assert(
  tests.said(:'s1'::jsonb) like '%Topic_Anna%' and tests.said(:'s1'::jsonb) like '%9.000 €%' and tests.said(:'s1'::jsonb) like '%90 %'
  and tests.said(:'s1'::jsonb) not like '%{%' and (:'s1'::jsonb #>> '{apply,0,cents}')::int = 10000
  and tests.said(:'s2'::jsonb) like '%Topic_Bert%' and tests.said(:'s2'::jsonb) like '%90.000 €%' and tests.said(:'s2'::jsonb) like '%900 %'
  and tests.said(:'s2'::jsonb) not like '%{%',
  'pHourLoser / pHourWinner: the biggest loss and gain of net worth within the last hour');
delete from public.rich_list_snapshots where entity_id in (:a, :b) and entity_kind = 'player';

insert into public.rental_tenancies (owner_id, is_ai, tenant_name, period, price_cents, started_at, next_due_at)
values (:a, true, 'Mieter Test', 'day', 50000, now(), now() + interval '1 day') returning id as tenancy \gset
insert into public.rental_payments (tenancy_id, owner_id, period_start, amount_cents)
values (:'tenancy', :a, now(), 50000), (:'tenancy', :a, now() - interval '1 hour', 50000);
insert into public.player_accessories (player_id, accessory_key, price_paid_cents, bought_at)
values (:c, 'party_hat', 250000, now()), (:c, 'beanie', 5000, now()),
       (:d, 'party_hat', 10, now() - interval '9 days'), (:d, 'paper_crown', 10, now() - interval '9 days'),
       (:d, 'beanie', 10, now() - interval '9 days'), (:d, 'traffic_cone', 10, now() - interval '9 days');
insert into public.player_accessories_worn (player_id, slot, accessory_key)
values (:d, 'head', 'party_hat'), (:d, 'face', 'paper_crown'), (:d, 'body', 'beanie'), (:d, 'pet', 'traffic_cone');
select tests.news_topic('pLandlord') as s1, tests.news_topic('pAccessory') as s2, tests.news_topic('pOutfit') as s3 \gset
select tests.assert(
  tests.said(:'s1'::jsonb) like '%Topic_Anna%' and tests.said(:'s1'::jsonb) like '%1.000 €%' and tests.said(:'s1'::jsonb) like '%: 2%'
  and tests.said(:'s1'::jsonb) not like '%{%'
  and tests.said(:'s2'::jsonb) like '%Topic_Cleo%' and tests.said(:'s2'::jsonb) like '%2.550 €%' and tests.said(:'s2'::jsonb) like '%Partyhütchen%'
  and tests.said(:'s2'::jsonb) not like '%{%'
  and tests.said(:'s3'::jsonb) like '%Topic_Dirk%' and tests.said(:'s3'::jsonb) like '%4 Accessoires%' and tests.said(:'s3'::jsonb) not like '%{%',
  'pLandlord, pAccessory, pOutfit: rent collected, wardrobe shopping with the dearest piece, everything worn at once');

insert into public.battles (seed, status, kind, finished_at, winner_id) values (4711, 'finished', 'quiz', now(), :a) returning id as battle \gset
insert into public.battle_players (battle_id, player_id, rank) values (:battle, :a, 1), (:battle, :b, 2), (:battle, :c, 3);
select tests.news_topic('pBattleWon') as s1, tests.news_topic('pBattleLast') as s2 \gset
select tests.assert(
  tests.said(:'s1'::jsonb) like '%Topic_Anna%' and tests.said(:'s1'::jsonb) like '%3 %' and tests.said(:'s1'::jsonb) not like '%{%'
  and :'s1'::jsonb -> 'apply' = '[]'::jsonb
  and tests.said(:'s2'::jsonb) like '%Topic_Cleo%' and tests.said(:'s2'::jsonb) like '%3 %' and tests.said(:'s2'::jsonb) not like '%{%'
  and :'s2'::jsonb #>> '{apply,0,type}' = 'cash',
  'pBattleWon / pBattleLast: winner and last place of a news battle with the number of players');

insert into public.mission_resets (player_id, reset_day, used, last_at)
values (:d, (now() at time zone 'Europe/Berlin')::date, 3, now())
on conflict (player_id, reset_day) do update set used = 3, last_at = now();
insert into public.friend_chats (kind, name, created_by) values ('group', 'Topic-Runde', :a) returning id as chat \gset
insert into public.friend_chat_messages (chat_id, author_id, kind, body)
select :chat, :a, 'player', 'geheim ' || g from generate_series(1, 31) g;
insert into public.friendships (requester_id, addressee_id, status, responded_at) values (:c, :d, 'accepted', now());
insert into public.friend_pokes (poker_id, target_id) select :b, :a from generate_series(1, 6);
select tests.news_topic('pReroll') as s1, tests.news_topic('pChatty') as s2, tests.news_topic('pFriends') as s3,
       tests.news_topic('pPoke') as s4 \gset
select tests.assert(
  tests.said(:'s1'::jsonb) like '%Topic_Dirk%' and tests.said(:'s1'::jsonb) like '%3-mal%' and tests.said(:'s1'::jsonb) not like '%{%'
  and tests.said(:'s2'::jsonb) like '%Topic_Anna%' and tests.said(:'s2'::jsonb) like '%31 Nachrichten%' and tests.said(:'s2'::jsonb) not like '%{%'
  and tests.said(:'s2'::jsonb) not like '%geheim%' and :'s2'::jsonb::text not like '%geheim%'
  and tests.said(:'s3'::jsonb) like '%Topic_%' and :'s3'::jsonb #>> '{subject,values,count}' = '1' and tests.said(:'s3'::jsonb) not like '%{%'
  and tests.said(:'s4'::jsonb) like '%Topic_Bert%' and tests.said(:'s4'::jsonb) like '%6-mal%' and tests.said(:'s4'::jsonb) not like '%{%',
  'pReroll, pChatty, pFriends, pPoke: missions re-rolled, messages (the number only, never the content), friends, pokes');

update public.profiles set last_active_at = now() - interval '6 days 2 hours' where id = :d;
select tests.news_topic('pAbsent') as s \gset
select tests.assert(
  tests.said(:'s'::jsonb) like '%Topic_Dirk%' and tests.said(:'s'::jsonb) like '%6 Tage%' and tests.said(:'s'::jsonb) not like '%{%'
  and :'s'::jsonb #>> '{subject,ukey}' = 'fact:gone:' || :d || ':6',
  'pAbsent: a player who has not logged in for days (the same fact key as the plain gossip)');
update public.profiles set last_active_at = now() where id = :d;

-- a founder pays themselves and fires someone (rows of the test database, restored below)
select pc.company_id as fc, pc.founder_id as ff, pc.founder_payout_bps as f_bps, co.name as fname, p.nickname as fnick
  from public.player_companies pc
  join public.companies co on co.id = pc.company_id
  join public.profiles p on p.id = pc.founder_id and not p.is_deactivated
 where pc.status = 'active'
 order by pc.created_at limit 1 \gset
update public.profiles set nickname = 'Topic_Chef' where id = :'ff';
update public.player_companies set founder_payout_bps = 8000 where company_id = :'fc';
insert into public.player_company_hours (company_id, hour_start, demand_cents, capacity_cents, revenue_cents, cogs_cents, fixed_cents,
                                         marketing_cents, pay_factor_bps, profit_cents, founder_payout_cents)
values (:'fc', date_trunc('hour', now()) + interval '3 hours', 0, 0, 0, 0, 0, 0, 10000, 0, 44400000);
select tests.news_topic('pFounderPay') as s \gset
select tests.assert(
  tests.said(:'s'::jsonb) like '%Topic_Chef%' and tests.said(:'s'::jsonb) like '%' || :'fname' || '%' and tests.said(:'s'::jsonb) like '%80 %'
  and tests.said(:'s'::jsonb) like '%€%' and tests.said(:'s'::jsonb) not like '%{%',
  'pFounderPay: a founder who takes most of the profit, with the share and what it paid');
delete from public.player_company_hours where company_id = :'fc' and hour_start = date_trunc('hour', now()) + interval '3 hours';
update public.player_companies set founder_payout_bps = :f_bps where company_id = :'fc';
insert into public.player_jobs (player_id, company_id, request_id, job_definition_id, tier, title, status, salary_cents_per_hour, started_at, ended_at, end_reason)
select :b, :'fc', gen_random_uuid(), j.job_definition_id, j.tier, j.title, 'ended', j.salary_cents_per_hour, now() - interval '2 days', now(), 'fired'
  from public.player_jobs j order by j.created_at limit 1
returning id as job \gset
select tests.news_topic('pBoss') as s \gset
select tests.assert(
  tests.said(:'s'::jsonb) like '%Topic_Chef%' and tests.said(:'s'::jsonb) like '%Topic_Bert%' and tests.said(:'s'::jsonb) like '%' || :'fname' || '%'
  and tests.said(:'s'::jsonb) not like '%{%' and :'s'::jsonb #>> '{subject,ukey}' = 'fact:job:' || :'job',
  'pBoss: a founder who fired a player, with both names and the company');
delete from public.player_jobs where id = :'job';
update public.profiles set nickname = :'fnick' where id = :'ff';

-- G. the draw: limits from config, one story per topic and player, rotation, groups, facts told once
select tests.set_cfg('newsShow', '{topics,count}', '500');
select public.news_show_topics(now(), (select array_agg(p.id) from public.profiles p where p.nickname not like 'Topic\_%'), '{}', '[]'::jsonb) as allsegs \gset
select tests.assert(
  (select count(*) = count(distinct x #>> '{subject,topic}') from jsonb_array_elements(:'allsegs'::jsonb) x)
  and (select count(*) filter (where x -> 'subject' ? 'player_id') = count(distinct x #>> '{subject,player_id}')
              and count(*) filter (where x -> 'subject' ? 'player_id') = 4
         from jsonb_array_elements(:'allsegs'::jsonb) x)
  and not exists (select 1 from jsonb_array_elements(:'allsegs'::jsonb) x where tests.said(x) like '%{%')
  and not exists (select 1 from jsonb_array_elements(:'allsegs'::jsonb) x
                   where x #>> '{subject,group}' is distinct from
                         (select value #>> array['topics', 'list', x #>> '{subject,topic}', 'group'] from public.game_config where key = 'newsShow')),
  'a show tells every topic at most once and one story per player; all texts complete');
select tests.set_cfg('newsShow', '{topics,count}', '2');
select tests.assert(jsonb_array_length(public.news_show_topics(now(), '{}', '{}', '[]'::jsonb)) = 2, 'topics.count limits the stories');
select tests.set_cfg('newsShow', '{topics,count}', '0');
select tests.assert(public.news_show_topics(now(), '{}', '{}', '[]'::jsonb) = '[]'::jsonb, 'topics.count 0 switches the topics off');
select tests.set_cfg('newsShow', '{topics,count}', '3');
select tests.assert(
  (select bool_and((select count(distinct x #>> '{subject,group}') from jsonb_array_elements(s.segs) x) = 3
                   and (select array_agg((x ->> 'ord')::int order by ord) from jsonb_array_elements(s.segs) with ordinality t(x, ord)) = array[25, 45, 65])
     from (select public.news_show_topics(now(), '{}', '{}', '[]'::jsonb) as segs from generate_series(1, 25)) s),
  'three stories come from three different groups and carry the places from topics.ords');

-- rotation: what ran in the last show does not come again while there is something else
insert into public.news_shows (airs_at, status, started_at, segments)
values (date_trunc('hour', now()) - interval '1 hour', 'aired', now() - interval '1 hour',
        (select jsonb_agg(jsonb_build_object('kind', 'ramble', 'headline', 'x', 'text', 'y', 'subject', jsonb_build_object('type', 'topic', 'topic', k)))
           from unnest(array['oddObituary', 'oddWeather', 'oddAd', 'oddHoroscope', 'taxBit', 'cardAi']) k))
returning id as last_show \gset
select tests.assert(
  (select bool_and(not exists (select 1 from jsonb_array_elements(s.segs) x
                                where x #>> '{subject,topic}' in ('oddObituary', 'oddWeather', 'oddAd', 'oddHoroscope', 'taxBit', 'cardAi'))
                   and jsonb_array_length(s.segs) = 3)
     from (select public.news_show_topics(now(), (select array_agg(id) from public.profiles), '{}', '[]'::jsonb) as segs
             from generate_series(1, 40)) s),
  'rotation: the topics of the last show stay out while others have something to tell');
update public.news_shows
   set segments = (select jsonb_agg(jsonb_build_object('kind', 'ramble', 'headline', 'x', 'text', 'y',
                                                       'subject', jsonb_build_object('type', 'topic', 'topic', k)))
                     from jsonb_object_keys((select value #> '{topics,list}' from public.game_config where key = 'newsShow')) k)
 where id = :last_show;
select tests.assert(
  jsonb_array_length(public.news_show_topics(now(), (select array_agg(id) from public.profiles), '{}', '[]'::jsonb)) = 3,
  'rotation: when everything ran in the last show, the show still gets its stories');
delete from public.news_shows where id = :last_show;

-- a fact that was told (or is in this show already) is not told again
insert into public.news_show_used (key, used_at) values ('fact:npull:0a419a41-0000-4000-8000-00000000c005', now())
on conflict (key) do update set used_at = excluded.used_at;
select tests.assert(tests.news_topic('cardPull') = '{}'::jsonb, 'a fact in news_show_used is not told again');
delete from public.news_show_used where key = 'fact:npull:0a419a41-0000-4000-8000-00000000c005';
select tests.assert(
  (select bool_and(not exists (select 1 from jsonb_array_elements(s.segs) x where x #>> '{subject,topic}' = 'taxLate'))
     from (select public.news_show_topics(now(), (select array_agg(p.id) from public.profiles p where p.id <> :a), '{}',
                    (select jsonb_agg(jsonb_build_object('subject', jsonb_build_object('ukey', 'fact:feed:' || f.id)))
                       from public.feed_items f where f.actor_id = :a and f.kind = 'tax_penalty')) as segs
             from generate_series(1, 5)) s),
  'a fact that is in the show already is left out');

-- H. the whole show: topics inside the running order, maxSegments holds, plain gossip leaves their feed kinds alone
select tests.set_cfg('newsShow', '{gossip,count}', '500');
select tests.set_cfg('newsShow', '{maxSegments}', '600');
select tests.set_cfg('newsShow', '{topics,count}', '3');
select public.news_show_build(now()) as show \gset
select tests.assert(
  (select count(*) from jsonb_array_elements(:'show'::jsonb) x where x -> 'subject' ? 'topic') = 3
  and not exists (select 1 from jsonb_array_elements(:'show'::jsonb) x where x ? 'ord' or tests.said(x) like '%{%')
  and not exists (select 1 from jsonb_array_elements(:'show'::jsonb) x
                   where x ->> 'kind' = 'gossip' and not (x -> 'subject' ? 'topic')
                     and x #>> '{subject,ukey}' in (select 'fact:feed:' || f.id from public.feed_items f
                                                    where f.kind in ('tax_penalty', 'tax_audit', 'greedy_founder', 'mass_quit',
                                                                     'record_dividend', 'board_revolt', 'nexamon_pull',
                                                                     'promoted', 'home_bought', 'car_bought')))
  and not exists (select 1 from jsonb_array_elements(:'show'::jsonb) with ordinality t(x, i)
                   join jsonb_array_elements(:'show'::jsonb) with ordinality u(y, j) on i <> j
                  where x -> 'subject' ? 'topic' and x #>> '{subject,player_id}' = y #>> '{subject,player_id}')
  and :'show'::jsonb -> -1 ->> 'kind' = 'tip',
  'news_show_build(): three topics in the show, one story per player, their feed kinds are no plain gossip, the hint stays last');
select tests.set_cfg('newsShow', '{topics,count}', '0');
update public.profiles set last_active_at = now() where nickname like 'Topic\_%';
select public.news_show_build(now()) as show_old \gset
select tests.assert(
  exists (select 1 from jsonb_array_elements(:'show_old'::jsonb) x
           where x ->> 'kind' = 'gossip'
             and x #>> '{subject,ukey}' in (select 'fact:feed:' || f.id from public.feed_items f
                                            where f.kind in ('tax_penalty', 'tax_audit', 'greedy_founder', 'mass_quit',
                                                             'record_dividend', 'board_revolt', 'promoted', 'car_bought')))
  and not exists (select 1 from jsonb_array_elements(:'show_old'::jsonb) x where x -> 'subject' ? 'topic'),
  'topics off: the show is the old one, the feed kinds are plain gossip again');
select tests.set_cfg('newsShow', '{topics,count}', '3');
select tests.set_cfg('newsShow', '{maxSegments}', '5');
select tests.assert(
  (select bool_and(jsonb_array_length(s.segs) <= 5 and s.segs -> -1 ->> 'kind' = 'tip')
     from (select public.news_show_build(now()) as segs from generate_series(1, 5)) s),
  'news_show_build(): maxSegments holds with topics, the hint stays last');

-- I. a show with topics airs: hush money is paid, the fact counts as told, the feed files the story
select tests.set_cfg('newsShow', '{waitMinutes}', '60');
select tests.set_cfg('newsShow', '{chat,bots,names}', '[]');
delete from public.news_shows;
select tests.cash(:c) as cash_before \gset
insert into public.news_shows (airs_at, segments)
values (date_trunc('hour', now()), jsonb_build_array(tests.news_topic('pPoke'), tests.news_topic('pBattleLast'), tests.news_topic('taxAudit')))
returning id as show_id \gset
select public.news_show_start(:show_id, now()) as started \gset
select tests.assert(
  :'started'::boolean
  and exists (select 1 from public.news_items n where n.category = 'company' and n.headline = (select segments -> 2 ->> 'headline' from public.news_shows where id = :show_id))
  and exists (select 1 from public.news_items n where n.category = 'player' and n.headline = (select segments -> 0 ->> 'headline' from public.news_shows where id = :show_id))
  and exists (select 1 from public.notifications n where n.player_id = :b and n.type_key = 'news_show')
  and tests.cash(:c) = :cash_before + 10000,
  'news_show_start(): topic stories land in the news feed (tax under companies), the player hears of it, hush money is paid');
select public.news_show_after_start(:show_id, now()) is not null as after_ok \gset
select tests.assert(
  exists (select 1 from public.news_show_used u where u.key = 'fact:battle:l:' || :battle)
  and tests.news_topic('pBattleLast') = '{}'::jsonb,
  'after the show its facts count as told');

select tests.assert(not exists (select 1 from public.ledger_audit()) and tests.money_invariant() = 'ok',
  'ledger audit and money invariant hold after a show with topics');

-- restore
update public.game_config set value = :'show_cfg'::jsonb where key = 'newsShow';
delete from public.news_shows;
delete from public.news_show_messages;
drop function tests.news_topic(text);
drop function tests.said(jsonb);
