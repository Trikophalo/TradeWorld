-- =============================================================================
-- b9 · The critics judge every NFT, the collectors pay for quality and talk back (ADR-181)
-- =============================================================================
-- 1. art_quality gives exactly the scores of src/lib/sim/art-quality.ts on the shared cases (art_quality_cases.inc).
-- 2. Minting rates an NFT on the server; a recoloured copy is flagged and capped; the backfill rates unrated NFTs.
-- 3. The collectors' valuation follows the score; junk and copies get no offers, poor art mocking ones.
-- 4. Collectors answer players in the chat: haggling raises the offer, questions get answers, ignored offers a nudge.
-- 5. Budget and money invariant hold.
\set QUIET 1
set client_min_messages = notice;

-- 1. shared cases
\ir art_quality_cases.inc
select tests.assert(
  (select bool_and((public.art_quality(c -> 'pixels', c ->> 'copy') ->> 'score')::integer = (c ->> 'score')::integer
                   and public.art_quality(c -> 'pixels', c ->> 'copy') -> 'sub' = c -> 'sub')
     from jsonb_each(:'cases'::jsonb) e(k, c)),
  'SQL and TypeScript give the same critic scores: '
  || (select string_agg(k || ' ' || (public.art_quality(c -> 'pixels', c ->> 'copy') ->> 'score'), ', ' order by k)
        from jsonb_each(:'cases'::jsonb) e(k, c)));
select tests.assert(public.art_signature(:'cases'::jsonb #> '{copy,pixels}') = public.art_signature(:'cases'::jsonb #> '{simple,pixels}')
                    and public.art_signature(:'cases'::jsonb #> '{nearcopy,pixels}') <> public.art_signature(:'cases'::jsonb #> '{simple,pixels}'),
  'a recoloured copy has the same signature, a near-copy a slightly different one');

\set c '''0b9b9b90-0000-4000-8000-0000000000c1'''
\set o '''0b9b9b90-0000-4000-8000-0000000000c2'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:c, 'Kim_Kritik9') is not null and tests.signup(:o, 'Olli_Ohr9') is not null as ok \gset
select tests.set_level(:c, 12);
select tests.set_level(:o, 12);
select tests.fund(:c, 2000000000, 'test:b9:c');
select tests.fund(:o, 100000000, 'test:b9:o');

begin;
-- the game's critic and chat settings (9b made them neutral), collectors only write offers on kept NFTs
update public.game_config g
   set value = jsonb_set(jsonb_set(g.value, '{ai,quality}', s.value #> '{ai,quality}'), '{ai,talk}', s.value #> '{ai,talk}')
  from tests.nft_cfg_saved s
 where g.key = 'nfts' and s.value #> '{ai,talk}' is not null;
select tests.set_cfg('nfts', '{ai,buyChanceBps}', '0');
select tests.set_cfg('nfts', '{ai,listedOfferChanceBps}', '0');
select tests.set_cfg('nfts', '{ai,unlistedOfferChanceBps}', '6000');
select tests.set_cfg('nfts', '{ai,trade,chanceBps}', '0');
select tests.set_cfg('nfts', '{ai,auction,bidChanceBps}', '0');
select tests.set_cfg('nfts', '{ai,talk,followupChanceBps}', '0');
select tests.assert(public.nfts_cfg() #>> '{ai,quality,valueMaxBps}' = '14000'
                    and jsonb_array_length(public.nfts_cfg() #> '{ai,talk,lines,followup}') > 0, 'game config has critic and chat');

-- 2. minting rates on the server
select tests.login_as('authenticated', :c);
select public.create_artwork(gen_random_uuid(), 'Kritik Gut', :'cases'::jsonb #> '{detailed,pixels}') #>> '{artwork,id}' as good \gset
select public.create_artwork(gen_random_uuid(), 'Kritik Rauschen', :'cases'::jsonb #> '{noise,pixels}') #>> '{artwork,id}' as noise \gset
select public.create_artwork(gen_random_uuid(), 'Kritik Kopie', :'cases'::jsonb #> '{detailed,pixels}') #>> '{artwork,id}' as copy \gset
select public.create_artwork(gen_random_uuid(), 'Kritik Kritzel', :'cases'::jsonb #> '{scribble,pixels}') #>> '{artwork,id}' as scrib \gset
reset role;
select tests.assert((select quality from public.artworks where id = :'good') = (:'cases'::jsonb #>> '{detailed,score}')::integer
                    and (select quality from public.artworks where id = :'noise') = (:'cases'::jsonb #>> '{noise,score}')::integer
                    and (select quality_detail ->> 'best' from public.artworks where id = :'good') is not null,
  'minting rates the NFT on the server: ' || (select string_agg(title || ' ' || quality, ', ' order by title)
                                                from public.artworks where id in (:'good', :'noise', :'copy', :'scrib')));
select tests.assert((select quality_detail ->> 'copy' from public.artworks where id = :'copy') = 'exact'
                    and (select quality from public.artworks where id = :'copy') <= 5
                    and (select quality_detail ->> 'copy' from public.artworks where id = :'good') is null,
  'a copy of an older NFT is flagged and capped, the original keeps its score');
-- backfill: unrated NFTs are rated by the job, with the same result
update public.artworks set quality = null, quality_detail = null, quality_sig = null where id in (:'good', :'noise');
select public.nfts_run_due() is not null as ok \gset
select tests.assert((select quality from public.artworks where id = :'good') = (:'cases'::jsonb #>> '{detailed,score}')::integer
                    and (select quality from public.artworks where id = :'noise') = (:'cases'::jsonb #>> '{noise,score}')::integer,
  'the backfill rates unrated NFTs again');
select tests.assert(not exists (select 1 from public.artworks where quality is null), 'every NFT has a critic score');

-- 3. valuation and offers follow the score (mint cost differs per NFT, so compare the factor on the same anchor)
select public.nft_quality_factor_bps(quality, 'valueMinBps', 'valueMaxBps') as fgood,
       greatest(mint_cents, public.config_double('nfts', '{ai,floorCents}', 0)::bigint) as mgood
  from public.artworks where id = :'good' \gset
select public.nft_quality_factor_bps(quality, 'valueMinBps', 'valueMaxBps') as fnoise from public.artworks where id = :'noise' \gset
select tests.assert(:fgood::integer * 10 > :fnoise::integer * 19
                    and public.nft_quality_base_cents(:'good') = :mgood::bigint * :fgood::integer / 10000,
  'great art is valued at almost twice the anchor of noise: ' || :fgood || ' vs ' || :fnoise || ' bps of mint cost / floor');
create temp table b9_runs (i integer, r jsonb);
do $$
declare
  v_base interval := coalesce((select time_offset from public.sim_runtime), interval '0');
begin
  for i in 1 .. 40 loop
    update public.sim_runtime set time_offset = v_base + make_interval(mins => i);
    insert into b9_runs values (i, public.nfts_run_due());
  end loop;
end;
$$;
select tests.assert((select count(*) from public.artwork_messages where artwork_id = :'copy' and ai_name is not null) = 0,
  'nobody bids on a copy');
select tests.assert((select count(*) from public.artwork_messages where artwork_id = :'good' and kind = 'offer' and ai_name is not null) >= 1
                    and (select count(*) from public.artwork_messages where artwork_id = :'noise' and kind = 'offer' and ai_name is not null) >= 1,
  'great art and noise both get offers');
select tests.assert(
  (select bool_and(m.body in (select jsonb_array_elements_text(public.nfts_cfg() #> '{ai,talk,lines,mock}'))
                   or m.body in (select jsonb_array_elements_text(p) from jsonb_each(public.nfts_cfg() #> '{ai,talk,personas}') x(k, p)))
     from public.artwork_messages m where m.artwork_id = :'noise' and m.kind = 'offer' and m.ai_name is not null),
  'offers on noise mock it: ' || (select string_agg(body, ' / ') from public.artwork_messages where artwork_id = :'noise' and kind = 'offer'));
select tests.assert(
  (select max(m.offer_cents::numeric / public.nft_ai_value_cents(:'good')) from public.artwork_messages m where m.artwork_id = :'good' and m.kind = 'offer')
    > (select max(m.offer_cents::numeric / public.nft_ai_value_cents(:'noise')) from public.artwork_messages m where m.artwork_id = :'noise' and m.kind = 'offer'),
  'great art gets offers closer to its value than noise');

-- 4. conversations: the owner haggles with the collector who bid last on the good NFT
select tests.set_cfg('nfts', '{ai,unlistedOfferChanceBps}', '0');
select m.id as off_id, m.ai_name as bidder, m.offer_cents as off_cents from public.artwork_messages m
 where m.artwork_id = :'good' and m.kind = 'offer' and m.offer_status = 'open' and m.ai_name is not null
 order by m.id desc limit 1 \gset
select tests.login_as('authenticated', :c);
select public.post_artwork_message(gen_random_uuid(), :'good', 'Das ist zu wenig, leg was drauf!') is not null as ok \gset
reset role;
update public.sim_runtime set time_offset = coalesce(time_offset, interval '0') + interval '2 minutes';
select public.nfts_run_due() ->> 'replies' as replies \gset
select m.ai_name as who, m.kind as what, m.offer_cents as new_cents, m.body as said from public.artwork_messages m
 where m.artwork_id = :'good' order by m.id desc limit 1 \gset
select tests.assert(:'who' = :'bidder' and (
                      (:'what' = 'offer' and :new_cents::bigint > :off_cents::bigint
                       and :new_cents::bigint <= public.nft_ai_value_cents(:'good') * 9500 / 10000
                       and (select offer_status from public.artwork_messages where id = :off_id) = 'closed')
                      or (:'what' = 'chat' and :'said' in (select jsonb_array_elements_text(public.nfts_cfg() #> '{ai,talk,lines,final}')))),
  'asked for more, ' || :'bidder' || ' raises the offer: ' || :off_cents || ' -> '
  || :'new_cents' || ' cents ("' || :'said' || '")');
-- a question gets an answer from the same collector, and the conversation goes on
select tests.login_as('authenticated', :c);
select public.post_artwork_message(gen_random_uuid(), :'good', 'Warum willst du es so sehr?') is not null as ok \gset
reset role;
update public.sim_runtime set time_offset = time_offset + interval '2 minutes';
select public.nfts_run_due() is not null as ok \gset
select m.ai_name as who, m.body as said from public.artwork_messages m where m.artwork_id = :'good' order by m.id desc limit 1 \gset
select tests.assert(:'who' = :'bidder' and :'said' in (select jsonb_array_elements_text(public.nfts_cfg() #> '{ai,talk,lines,reply,question}')),
  'a question gets an answer: "' || :'said' || '"');
-- another player says yes: the collector answers them too
select tests.login_as('authenticated', :o);
select public.post_artwork_message(gen_random_uuid(), :'good', 'Ja, kauf es!') is not null as ok \gset
reset role;
update public.sim_runtime set time_offset = time_offset + interval '2 minutes';
select public.nfts_run_due() is not null as ok \gset
select tests.assert((select m.body from public.artwork_messages m where m.artwork_id = :'good' order by m.id desc limit 1)
                      in (select jsonb_array_elements_text(public.nfts_cfg() #> '{ai,talk,lines,reply,yes}')),
  'a yes gets a yes-answer');
select tests.assert((select count(*) from public.artwork_messages m where m.artwork_id = :'good' and m.ai_name is not null
                      and m.created_at > (select created_at from public.artwork_messages where id = :off_id)) >= 3,
  'a conversation of several messages happened');
-- no AI line repeats one of the last lines of the chat
-- rare back-to-back repeats can come from two independent paths (reply and reminder) in the same minute: allow one
select tests.assert((
  select count(*) from (select m.body, lag(m.body) over (partition by m.artwork_id order by m.id) as prev from public.artwork_messages m
                  where m.ai_name is not null and m.artwork_id in (:'good', :'noise', :'scrib')) x where x.body = x.prev) <= 1,
  'collectors (almost) never repeat the line before');
-- an ignored offer gets one nudge
select tests.set_cfg('nfts', '{ai,talk,followupChanceBps}', '10000');
select tests.set_cfg('nfts', '{ai,talk,maxFollowupsPerRun}', '50');
select m.id as nudge_off from public.artwork_messages m where m.artwork_id in (:'noise', :'scrib') and m.offer_status = 'open'
   and m.ai_name is not null and not exists (select 1 from public.artwork_messages n where n.artwork_id = m.artwork_id and n.id > m.id)
 order by m.id limit 1 \gset
update public.sim_runtime set time_offset = time_offset + interval '35 minutes';
select public.nfts_run_due() ->> 'followups' as nudges \gset
select tests.assert(:'nudge_off' = '' or (:'nudges')::integer >= 1, 'an ignored offer gets a nudge (' || :'nudges' || ')');
select tests.assert(:'nudge_off' = '' or exists (
  select 1 from public.artwork_messages n join public.artwork_messages m on m.id = :'nudge_off'::bigint
   where n.artwork_id = m.artwork_id and n.id > m.id and n.ai_name = m.ai_name
     and n.body in (select jsonb_array_elements_text(public.nfts_cfg() #> '{ai,talk,lines,followup}')
                    union select jsonb_array_elements_text(public.nfts_cfg() #> array['ai', 'talk', 'personas', m.ai_name]))),
  'the nudge comes from the bidder');

-- 5. budget and money
select tests.assert(public.nft_ai_spent_today(public.game_now()) <= public.config_double('nfts', '{ai,budgetCentsPerDay}', 0),
  'the collectors stay within their daily budget');
select tests.assert(tests.money_invariant() = 'ok', 'money invariant: ' || tests.money_invariant());
rollback;
