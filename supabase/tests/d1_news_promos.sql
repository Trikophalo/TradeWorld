-- =============================================================================
-- d1 · News-Aktionen (ADR-193): the draw never repeats a kind and runs one promotion at a time; a pack sale takes
--      20 % off only that set and only within the window; a free NFT once per player; a tax return once, 10 % of
--      the revenue of the last 24 closed hours with a cap, refused for players without a company; money stays whole.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0d1d1d1d-0000-4000-8000-0000000000a1'''
\set b '''0d1d1d1d-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Prm_Anna') is not null and tests.signup(:b, 'Prm_Bruno') is not null as ok \gset
select tests.set_level(:a, 30);
select tests.set_level(:b, 30);
select tests.fund(:a, 500000000, 'test:d1:a');
select tests.fund(:b, 500000000, 'test:d1:b');
select public.nexamon_sync(public.game_now()) is not null as ok \gset
delete from public.news_promos;

create or replace function tests.np_shift(p_minutes integer) returns void language sql security definer as $$
  update public.news_promos set starts_at = starts_at - make_interval(mins => p_minutes),
                                ends_at = ends_at - make_interval(mins => p_minutes) $$;
grant execute on all functions in schema tests to public;

select tests.assert((value ->> 'chanceBps')::integer = 3400 and (value ->> 'durationMinutes')::integer = 15
                    and (value #>> '{packSale,discountBps}')::integer = 2000
                    and (value #>> '{taxReturn,shareBps}')::integer = 1000
                    and (value #>> '{taxReturn,capCents}')::bigint = 5000000,
  'd1: config newsPromos') from public.game_config where key = 'newsPromos';

-- ---------------------------------------------------------------------------
-- 1. The draw: a miss brings nothing; never the same kind twice in a row; one at a time
-- ---------------------------------------------------------------------------
select tests.assert(public.news_promo_draw(null, public.game_now(), 0.99, 0) is null, 'd1: a missed chance roll brings nothing');
select public.news_promo_draw(null, public.game_now(), 0, 0) as seg1 \gset
select tests.assert(:'seg1'::jsonb ->> 'kind' = 'promo' and (:'seg1'::jsonb ->> 'headline') <> ''
                    and (select count(*) from public.news_promos) = 1,
  'd1: a hit brings one promotion and a show segment');
select tests.assert(public.news_promo_draw(null, public.game_now(), 0, 0) is null, 'd1: never two promotions at a time');
do $$
declare
  v_prev text;
  v_kind text;
begin
  for i in 1..30 loop
    select kind into v_prev from public.news_promos order by starts_at desc, id desc limit 1;
    perform tests.np_shift(20);
    perform public.news_promo_draw(null, public.game_now(), 0, (i % 10) / 10.0);
    select kind into v_kind from public.news_promos order by starts_at desc, id desc limit 1;
    perform tests.assert(v_kind is distinct from v_prev, 'd1: the draw repeats the kind ' || v_prev);
  end loop;
end;
$$;
select tests.assert((select count(distinct kind) from public.news_promos) = 3, 'd1: every kind comes up');

-- a show going on air draws through the trigger (chance forced to 100 %)
select tests.np_shift(20);
update public.game_config set value = jsonb_set(value, '{chanceBps}', '10000') where key = 'newsPromos';
insert into public.news_shows (airs_at, status, segments) values (public.game_now(), 'scheduled', '[]') returning id as show \gset
update public.news_shows set status = 'aired', started_at = public.game_now() where id = :show;
update public.game_config set value = jsonb_set(value, '{chanceBps}', '3400') where key = 'newsPromos';
select tests.assert((select segments -> -1 ->> 'kind' from public.news_shows where id = :show) = 'promo'
                    and exists (select 1 from public.news_promos where show_id = :show)
                    and (select count(*) from public.notifications where type_key = 'news_promo' and player_id = :a
                           and payload ->> 'promo_id' = (select id::text from public.news_promos where show_id = :show)) = 1,
  'd1: a show going on air announces the promotion and notifies the player once');
select tests.np_shift(20);

-- ---------------------------------------------------------------------------
-- 2. Pack sale: -20 % only for the drawn set, only within the window (single, sealed)
-- ---------------------------------------------------------------------------
insert into public.news_promos (kind, set_key, bps, starts_at, ends_at, headline, body)
values ('pack_sale', 'mystic_energy', 2000, public.game_now() - interval '1 minute', public.game_now() + interval '14 minutes', 'Rabatt', 'Rabatt');
select (value #>> '{sets,mystic_energy,packPriceCents}')::bigint as me_price,
       (value #>> '{sets,super_apex,packPriceCents}')::bigint as sa_price from public.game_config where key = 'nexamon' \gset
select tests.login_as('authenticated', :a);
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') as p1 \gset
select public.buy_nexamon_pack(gen_random_uuid(), 'super_apex') as p2 \gset
select public.buy_nexamon_sealed_pack(gen_random_uuid(), 'mystic_energy', 2) as p3 \gset
select public.buy_nexamon_packs(gen_random_uuid(), 'mystic_energy', 2) as p4 \gset
select public.get_news_promo() as gp \gset
reset role;
select tests.assert((:'p1'::jsonb ->> 'price_cents')::bigint = :me_price * 8 / 10
                    and (:'p2'::jsonb ->> 'price_cents')::bigint = :sa_price
                    and (:'p3'::jsonb ->> 'price_cents')::bigint = :me_price * 8 / 10 * 2
                    and (:'p4'::jsonb ->> 'price_cents')::bigint = :me_price * 8 / 10 * 2,
  'd1: the pack sale takes 20 % off packs of its set only (single, sealed, multi-buy)');
select tests.assert(:'gp'::jsonb #>> '{promo,kind}' = 'pack_sale' and :'gp'::jsonb #>> '{promo,set}' = 'mystic_energy',
  'd1: get_news_promo shows the running sale');
select tests.np_shift(15);
select tests.login_as('authenticated', :a);
select public.buy_nexamon_pack(gen_random_uuid(), 'mystic_energy') as p5 \gset
select public.get_news_promo() as gp2 \gset
reset role;
select tests.assert((:'p5'::jsonb ->> 'price_cents')::bigint = :me_price and :'gp2'::jsonb -> 'promo' = 'null'::jsonb,
  'd1: after the window the full price again');

-- ---------------------------------------------------------------------------
-- 3. Free NFT: the first one within the window costs nothing, the second the normal fee
-- ---------------------------------------------------------------------------
insert into public.news_promos (kind, starts_at, ends_at, headline, body)
values ('free_nft', public.game_now() - interval '1 minute', public.game_now() + interval '14 minutes', 'Gratis', 'Gratis');
select tests.cash(:a) as a0 \gset
select tests.login_as('authenticated', :a);
select public.create_artwork(gen_random_uuid(), 'Gratis Eins', tests.art()) as n1 \gset
select public.create_artwork(gen_random_uuid(), 'Gratis Zwei', tests.art()) as n2 \gset
reset role;
select tests.assert((:'n1'::jsonb ->> 'cost_cents')::bigint = 0 and (:'n1'::jsonb ->> 'free')::boolean
                    and (:'n2'::jsonb ->> 'cost_cents')::bigint > 0 and not (:'n2'::jsonb ->> 'free')::boolean
                    and tests.cash(:a) = :a0 - (:'n2'::jsonb ->> 'cost_cents')::bigint
                    and (select count(*) from public.news_promo_claims c join public.news_promos p on p.id = c.promo_id
                          where p.kind = 'free_nft' and c.player_id = :a) = 1,
  'd1: one free NFT per player and promotion');
select tests.np_shift(15);

-- ---------------------------------------------------------------------------
-- 4. Tax return: owners only, once, 10 % of the last 24 closed hours, capped
-- ---------------------------------------------------------------------------
select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Steuer Eins', 'Belege sammeln', 'tech', '#224466', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:a) as aco \gset
insert into public.player_company_hours (company_id, hour_start, demand_cents, capacity_cents, revenue_cents, cogs_cents,
                                         fixed_cents, marketing_cents, pay_factor_bps, profit_cents)
select :'aco', date_trunc('hour', public.game_now()) - make_interval(hours => h), 0, 0, 100000, 0, 0, 0, 10000, 0
  from generate_series(1, 30) h
on conflict do nothing;
-- the open hour does not count
insert into public.player_company_hours (company_id, hour_start, demand_cents, capacity_cents, revenue_cents, cogs_cents,
                                         fixed_cents, marketing_cents, pay_factor_bps, profit_cents)
values (:'aco', date_trunc('hour', public.game_now()), 0, 0, 999999, 0, 0, 0, 10000, 0)
on conflict do nothing;
select tests.login_as('authenticated', :a);
select tests.throws_key('select public.file_news_tax_return(gen_random_uuid())', 'news_promo_inactive',
  'd1: no tax return without the promotion');
reset role;
insert into public.news_promos (kind, bps, starts_at, ends_at, headline, body)
values ('tax_return', 1000, public.game_now() - interval '1 minute', public.game_now() + interval '14 minutes', 'Steuer', 'Steuer');
select tests.money_invariant() = 'ok' as inv0 \gset
select tests.cash(:a) as a1 \gset
select gen_random_uuid() as rq \gset
select tests.login_as('authenticated', :b);
select tests.throws_key('select public.file_news_tax_return(gen_random_uuid())', 'news_promo_no_company',
  'd1: a player without a company cannot file');
reset role;
select tests.login_as('authenticated', :a);
select public.get_news_promo() as gt \gset
select public.file_news_tax_return(:'rq') as t1 \gset
select public.file_news_tax_return(:'rq') as t1b \gset
select tests.throws_key('select public.file_news_tax_return(gen_random_uuid())', 'news_promo_claimed',
  'd1: a second filing is refused');
reset role;
select tests.assert((:'gt'::jsonb #>> '{promo,tax,revenue_cents}')::bigint = 2400000
                    and (:'gt'::jsonb #>> '{promo,tax,refund_cents}')::bigint = 240000,
  'd1: get_news_promo shows the revenue of the last 24 closed hours and 10 % of it');
select tests.assert((:'t1'::jsonb ->> 'refund_cents')::bigint = 240000 and :'t1'::jsonb = :'t1b'::jsonb
                    and tests.cash(:a) = :a1 + 240000
                    and (select count(*) from public.ledger_transactions where idempotency_key like 'news_promo:tax:%') = 1,
  'd1: the refund is paid once (idempotent request id)');
select tests.assert(:'inv0'::boolean and tests.money_invariant() = 'ok', 'd1: the money invariant holds');

-- the cap
select tests.np_shift(15);
update public.player_company_hours set revenue_cents = 900000000 where company_id = :'aco';
insert into public.news_promos (kind, bps, starts_at, ends_at, headline, body)
values ('tax_return', 1000, public.game_now() - interval '1 minute', public.game_now() + interval '14 minutes', 'Steuer', 'Steuer');
select tests.login_as('authenticated', :a);
select public.file_news_tax_return(gen_random_uuid()) as t2 \gset
reset role;
select tests.assert((:'t2'::jsonb ->> 'refund_cents')::bigint = 5000000, 'd1: the refund is capped at capCents');
select tests.np_shift(15);
select tests.assert(tests.money_invariant() = 'ok', 'd1: the money invariant still holds');
