-- =============================================================================
-- a2 · Affordable missions and one reset per real day (ADR-166)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0a2a2a2a-0000-4000-8000-0000000000a1'''
\set f '''0a2a2a2a-0000-4000-8000-0000000000f1'''
\set r '''0a2a2a2a-0000-4000-8000-0000000000c1'''
update public.invite_codes set max_uses = max_uses + 3 where code = 'M1-TESTS';
select tests.signup(:a, 'Knapp_Anna') is not null and tests.signup(:f, 'Knapp_Firma') is not null
   and tests.signup(:r, 'Wuerfel_Rita') is not null as ok \gset
select tests.set_level(:a, 10);
select tests.set_level(:f, 10);
select tests.set_level(:r, 10);

-- sets the cash of a player (or of a company) to an exact amount
create or replace function tests.set_cash(p_player uuid, p_cents bigint) returns void language plpgsql as $$
declare
  v_acc  uuid := public.ledger_player_account(p_player, 'player_cash');
  v_sys  uuid := public.ledger_system_account('households');
  v_diff bigint;
begin
  select p_cents - a.balance_cents into v_diff from public.ledger_accounts a where a.id = v_acc;
  if v_diff > 0 then
    perform public.ledger_transfer(v_sys, v_acc, v_diff, 'transfer', 'Test', 'player', p_player, 'test:a2:' || gen_random_uuid());
  elsif v_diff < 0 then
    perform public.ledger_transfer(v_acc, v_sys, -v_diff, 'transfer', 'Test', 'player', p_player, 'test:a2:' || gen_random_uuid());
  end if;
end;
$$;
create or replace function tests.set_company_cash(p_company uuid, p_cents bigint) returns void language plpgsql as $$
declare
  v_acc  uuid := public.company_cash_account(p_company);
  v_sys  uuid := public.ledger_system_account('households');
  v_diff bigint;
begin
  select p_cents - a.balance_cents into v_diff from public.ledger_accounts a where a.id = v_acc;
  if v_diff > 0 then
    perform public.ledger_transfer(v_sys, v_acc, v_diff, 'transfer', 'Test', 'company', p_company, 'test:a2:' || gen_random_uuid());
  elsif v_diff < 0 then
    perform public.ledger_transfer(v_acc, v_sys, -v_diff, 'transfer', 'Test', 'company', p_company, 'test:a2:' || gen_random_uuid());
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- A. Money targets: the cap, the clamp, the minimum
-- ---------------------------------------------------------------------------
select tests.set_cash(:a, 1000000);
select tests.assert(
  public.mission_money_cap(:a, 'daily', 'buy_value') = 500000
  and public.mission_money_cap(:a, 'quick', 'trade_value') = 500000
  and public.mission_money_cap(:a, 'daily', 'trade_value') = 1000000
  and public.mission_money_cap(:a, 'weekly', 'trade_value') = 3000000
  and public.mission_money_cap(:a, 'daily', 'realized_profit') = 20000
  and public.mission_money_cap(:a, 'weekly', 'realized_profit') = 100000
  and public.mission_money_cap(:a, 'daily', 'buy') is null
  and public.mission_money_cap(:a, 'milestone', 'buy_value') is null,
  'mission_money_cap(): half the cash for one buy, cash and positions for volume and profit, nothing else is capped');

-- 300 € cash: "buy for 1.400 €" (500 € x 2.8 at level 10) becomes "buy for 150 €"
select tests.set_cash(:a, 30000);
delete from public.player_missions where player_id = :a;
update public.mission_templates set weight = 1000000 where key = 'd_buy_value';
select public.missions_assign(:a) is not null as ok \gset
update public.mission_templates set weight = 90 where key = 'd_buy_value';
select tests.assert(
  (select target from public.player_missions where player_id = :a and template_key = 'd_buy_value') = 15000,
  'missions_assign(): the money target is clamped to what the player can afford (150 € of 300 € cash), got '
    || coalesce((select target::text from public.player_missions where player_id = :a and template_key = 'd_buy_value'), 'no mission'));
select tests.assert(
  not exists (select 1 from public.player_missions m join public.mission_templates t on t.key = m.template_key
               where m.player_id = :a and m.status = 'active' and m.kind <> 'milestone'
                 and public.mission_money_cap(:a, m.kind, t.metric) < m.target),
  'missions_assign(): no money target above the cap');

-- 30 € cash: the clamp would fall below the minimum (20 €), the mission is not handed out
select tests.set_cash(:a, 3000);
select tests.assert(
  not public.mission_doable(:a, 'd_buy_value', 'buy_value') and not public.mission_doable(:a, 'q_buy_value', 'buy_value')
  and not public.mission_doable(:a, 'w_buy_value', 'buy_value') and not public.mission_doable(:a, 'q_volume', 'trade_value')
  and public.mission_doable(:a, 'd_volume', 'trade_value')
  and not public.mission_doable(:a, 'd_profit', 'realized_profit')
  and public.mission_doable(:a, 'q_profit', 'realized_profit')
  and public.mission_doable(:a, 'q_buy', 'buy'),
  'mission_doable(): below the minimum target no buy, volume or profit mission; counting a buy still works with 30 €');
select tests.set_cash(:a, 500);
select tests.assert(
  not public.mission_doable(:a, 'q_buy', 'buy') and not public.mission_doable(:a, 'd_buy_tech', 'buy_sector')
  and not public.mission_doable(:a, 'q_bond', 'bond_bought') and not public.mission_doable(:a, 'd_sectors', 'sectors_bought')
  and public.mission_doable(:a, 'm_first_trade', 'trade') and public.mission_doable(:a, 'q_sell', 'sell')
  and public.mission_doable(:a, 'm_trades_25', 'trade'),
  'mission_doable(): with 5 € no buying missions; selling and milestones stay');

-- a quick mission without progress the player can no longer pay for makes room
delete from public.player_missions where player_id = :a;
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward)
values (:a, 'q_buy_value', 'quick', (public.game_now() at time zone 'Europe/Berlin')::date, 56000, 20);
select public.missions_assign(:a) is not null as ok \gset
select tests.assert(
  (select status = 'expired' from public.player_missions where player_id = :a and template_key = 'q_buy_value')
  and not exists (select 1 from public.player_missions m join public.mission_templates t on t.key = m.template_key
                   where m.player_id = :a and m.status = 'active' and not public.mission_doable(:a, t.key, t.metric)),
  'missions_assign(): an unaffordable quick mission expires; everything active is doable and affordable');

-- ---------------------------------------------------------------------------
-- B. Purchases: the cheapest offer has to fit
-- ---------------------------------------------------------------------------
select min((x ->> 'priceCents')::bigint) as acc_min
  from jsonb_array_elements(public.accessories_cfg() -> 'items') x
 where not coalesce((x ->> 'exclusive')::boolean, false) and coalesce((x ->> 'minLevel')::integer, 1) <= 10 \gset
select tests.set_cash(:a, :acc_min - 1);
select public.mission_affordable(:a, 'q_accessory', 'accessory_bought') as acc_poor,
       public.mission_affordable(:a, 'm_first_accessory', 'accessory_bought') as acc_mile \gset
select tests.set_cash(:a, :acc_min);
select tests.assert(
  not :'acc_poor'::boolean and :'acc_mile'::boolean
  and public.mission_affordable(:a, 'q_accessory', 'accessory_bought')
  and public.mission_affordable(:a, 'w_accessories', 'accessory_bought'),
  'accessories: the cheapest piece has to be affordable (a weekly count only by half); the milestone stays a saving goal');

select public.apply_bps(public.property_furniture_list_cents((select min(price_cents) from public.furniture_catalog), null),
                        10000 - public.player_property_discount_bps(:a)) as fur_min \gset
select tests.set_cash(:a, :fur_min * 2 - 1);
select tests.assert(
  public.mission_affordable(:a, 'q_furniture', 'furniture_bought')
  and not public.mission_affordable(:a, 'd_furniture_2', 'furniture_bought')
  and public.mission_affordable(:a, 'm_furniture_20', 'furniture_bought'),
  'furniture: as many of the cheapest piece as the mission counts');

select tests.set_cash(:a, 0);
select tests.assert(
  not public.mission_affordable(:a, 'q_art_bid', 'art_bid') and not public.mission_affordable(:a, 'd_nft_buy', 'nft_bought')
  and not public.mission_affordable(:a, 'w_art_win', 'art_won') and not public.mission_affordable(:a, 'q_nft_offer', 'nft_offer')
  and not public.mission_affordable(:a, 'q_deposit', 'company_deposit')
  and public.mission_affordable(:a, 'm_art_first_bid', 'art_bid')
  and public.mission_affordable(:a, 'q_art_like', 'art_like') and public.mission_affordable(:a, 'q_vault', 'vault_claim'),
  'without money no bids, NFT buys, offers or deposits; free missions and milestones are untouched');
select tests.set_cash(:a, 100000000000);
select tests.assert(
  public.mission_affordable(:a, 'q_nft_offer', 'nft_offer') and public.mission_affordable(:a, 'q_deposit', 'company_deposit')
  and public.mission_affordable(:a, 'q_art_bid', 'art_bid')
      = exists (select 1 from public.artwork_auctions au join public.artworks w on w.id = au.artwork_id
                 where au.status = 'open' and au.ends_at > public.game_now()
                   and au.seller_id is distinct from :a and w.owner_id is distinct from :a),
  'with money: offers and deposits; a bid needs an open auction of somebody else');
select tests.set_cash(:a, 1000000);

-- the own company pays for AI workers and business moves
select tests.fund(:f, 5000000, 'test:a2:f');
select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Knappe Kasse', 'Wenig Geld', 'retail', '#336699', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.set_company_cash(:'fco', 10000000);
select tests.assert(
  public.mission_doable(:f, 'q_ai_worker', 'ai_worker_hired') and public.mission_doable(:f, 'w_ai_workers', 'ai_worker_hired')
  and public.mission_doable(:f, 'q_move', 'move_started') and public.mission_doable(:f, 'd_move_win', 'move_success'),
  'a company with money: hiring and business moves are fine');
-- 6 hours of wages for one AI worker: 6 x 120 € = 720 €
select tests.set_company_cash(:'fco', 71999);
select public.mission_doable(:f, 'q_ai_worker', 'ai_worker_hired') as hire_poor \gset
select tests.set_company_cash(:'fco', 72000);
select public.mission_doable(:f, 'q_ai_worker', 'ai_worker_hired') as hire_ok \gset
update public.player_companies set ai_workers = 1 where company_id = :'fco';
select public.mission_doable(:f, 'q_ai_worker', 'ai_worker_hired') as hire_second \gset
update public.player_companies set ai_workers = 0, unpaid_cents = 100 where company_id = :'fco';
select public.mission_doable(:f, 'q_ai_worker', 'ai_worker_hired') as hire_unpaid \gset
update public.player_companies set unpaid_cents = 0 where company_id = :'fco';
select tests.assert(
  not :'hire_poor'::boolean and :'hire_ok'::boolean and not :'hire_second'::boolean and not :'hire_unpaid'::boolean
  and public.mission_doable(:f, 'm_first_ai_worker', 'ai_worker_hired')
  and public.mission_doable(:f, 'q_job_post', 'job_posted'),
  'hiring: only when the company can pay the wages of all AI workers and owes none; never "fire first"; postings are free');
select min((m ->> 'cost_cents')::bigint) as move_min
  from jsonb_array_elements(public.company_moves_state(:'fco') -> 'moves') m \gset
select tests.set_company_cash(:'fco', :move_min * 2 - 1);
select tests.assert(
  public.mission_doable(:f, 'q_move', 'move_started') and not public.mission_doable(:f, 'd_moves_2', 'move_started')
  and public.mission_doable(:f, 'd_move_win', 'move_success') and public.mission_doable(:f, 'm_first_move', 'move_started'),
  'business moves: the company cash covers the cheapest move as often as the mission counts');
select tests.set_company_cash(:'fco', 0);
select tests.assert(
  not public.mission_doable(:f, 'q_move', 'move_started') and not public.mission_doable(:f, 'w_move_wins', 'move_success'),
  'business moves: an empty company cash gets no move missions');

-- ---------------------------------------------------------------------------
-- C. reset_missions(): once per Berlin day
-- ---------------------------------------------------------------------------
\set rq '''0a2a2a2a-0000-4000-8000-00000000aa01'''
select tests.login_as('anon');
select tests.throws($$select public.reset_missions(gen_random_uuid())$$, '42501', 'anon: reset_missions');
reset role;
select tests.login_as('authenticated', :r);
select public.get_my_missions() as g0 \gset
reset role;
select tests.assert(
  (:'g0'::jsonb ->> 'reset_available')::boolean and :'g0'::jsonb ? 'next_reset_at' and (:'g0'::jsonb ->> 'next_reset_at') is null
  and (select bool_and(jsonb_array_length(g -> 'missions') = 3) from jsonb_array_elements(:'g0'::jsonb -> 'groups') g),
  'get_my_missions(): reset_available is true, next_reset_at is null, 3 missions per group');
-- one quick mission is done (waits for its claim), one daily one has progress
update public.player_missions set status = 'completed', progress = target, completed_at = now()
 where id = (select m.id from public.player_missions m where m.player_id = :r and m.kind = 'quick' order by m.id limit 1);
update public.player_missions set progress = 1
 where id = (select m.id from public.player_missions m where m.player_id = :r and m.kind = 'daily' and m.target > 1 order by m.id limit 1);
create temp table a2_before as
  select id, template_key, kind, status from public.player_missions where player_id = :r and status in ('active', 'completed');
grant select on a2_before to public;

select tests.login_as('authenticated', :r);
select public.reset_missions(:rq) as r1 \gset
select public.reset_missions(:rq) as r1b \gset
select tests.throws_key($$select public.reset_missions(gen_random_uuid())$$, 'mission_reset_used', 'a second reset on the same day');
select public.get_my_missions() as g1 \gset
reset role;
select tests.assert(
  (:'r1'::jsonb ->> 'replaced')::integer = 8
  and (select bool_and(jsonb_array_length(g -> 'missions') = 3) from jsonb_array_elements(:'r1'::jsonb -> 'groups') g)
  and :'r1'::jsonb ?& array['server_time', 'groups', 'reset_available', 'next_reset_at']
  and not (:'r1'::jsonb ->> 'reset_available')::boolean
  and (:'r1'::jsonb ->> 'next_reset_at')::timestamptz
      = (((public.game_now() at time zone 'Europe/Berlin')::date + 1)::timestamp) at time zone 'Europe/Berlin',
  'reset_missions(): 8 open missions replaced, 3 per group again, the next reset at midnight in Berlin');
select tests.assert(:'r1'::jsonb = :'r1b'::jsonb, 'reset_missions(): the same request_id returns the stored answer');
select tests.assert(
  not (:'g1'::jsonb ->> 'reset_available')::boolean and (:'g1'::jsonb ->> 'next_reset_at') = (:'r1'::jsonb ->> 'next_reset_at'),
  'get_my_missions(): reset used up, "tomorrow again"');
select tests.assert(
  -- nothing that was open comes back right away
  not exists (select 1 from jsonb_array_elements(:'r1'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m
               join a2_before b on b.template_key = m ->> 'key'
              where b.kind <> 'milestone' and b.status = 'active')
  -- the finished quick mission and the milestones are the same rows
  and (select count(*) from jsonb_array_elements(:'r1'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m
        join a2_before b on b.id = (m ->> 'id')::uuid
       where b.kind = 'milestone' or b.status = 'completed') = 4
  and (select count(*) from public.player_missions m join a2_before b on b.id = m.id
        where m.status = 'expired' and m.reset_at is not null) = 8
  and (select count(*) from public.player_missions m join a2_before b on b.id = m.id
        where m.status = 'completed' and m.reset_at is null) = 1,
  'reset_missions(): new templates only; completed missions and milestones stay');
select tests.assert(
  (select used from public.mission_resets where player_id = :r) = 1
  and not has_table_privilege('authenticated', 'public.mission_resets', 'select'),
  'mission_resets counts the reset; the table is internal');

-- the next day: a new reset, the swapped templates still rest
update public.mission_resets set reset_day = reset_day - 1 where player_id = :r;
select tests.login_as('authenticated', :r);
select public.reset_missions(gen_random_uuid()) as r2 \gset
reset role;
select tests.assert(
  (:'r2'::jsonb ->> 'replaced')::integer = 8
  and not exists (select 1 from jsonb_array_elements(:'r2'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m
                   join a2_before b on b.template_key = m ->> 'key'
                  where b.kind <> 'milestone' and b.status = 'active')
  and not exists (select 1 from jsonb_array_elements(:'r2'::jsonb -> 'groups') g, jsonb_array_elements(g -> 'missions') m,
                       jsonb_array_elements(:'r1'::jsonb -> 'groups') g1, jsonb_array_elements(g1 -> 'missions') m1
                  where m ->> 'key' = m1 ->> 'key' and g ->> 'kind' <> 'milestone' and m1 ->> 'status' = 'active'),
  'a reset on the next day: again new templates, none of the two sets before');

-- nothing open: the reset is not used up
update public.mission_resets set reset_day = reset_day - 1 where player_id = :r;
create temp table a2_open as
  select id from public.player_missions where player_id = :r and status = 'active' and kind <> 'milestone';
update public.player_missions set status = 'completed', progress = target where id in (select id from a2_open);
select tests.login_as('authenticated', :r);
select tests.throws_key($$select public.reset_missions(gen_random_uuid())$$, 'mission_reset_nothing', 'nothing open to swap');
select public.get_my_missions() as g2 \gset
reset role;
select tests.assert((:'g2'::jsonb ->> 'reset_available')::boolean, 'a reset without open missions is not used up');

-- a swapped template comes back after 20 hours, in the same row
delete from public.player_missions where player_id = :r and kind = 'daily';
insert into public.player_missions (player_id, template_key, kind, period_start, target, progress, xp_reward, status, reset_at, expires_at)
values (:r, 'd_rich_list', 'daily', (public.game_now() at time zone 'Europe/Berlin')::date, 1, 1, 10, 'expired',
        public.game_now() - interval '1 hour', public.game_now() - interval '1 hour');
update public.mission_templates set weight = 1000000 where key = 'd_rich_list';
select public.missions_assign(:r) is not null as ok \gset
select (select status = 'expired' from public.player_missions where player_id = :r and template_key = 'd_rich_list')
       and (select count(*) from public.player_missions
             where player_id = :r and kind = 'daily' and status = 'active') = 3 as fresh_rests \gset
delete from public.player_missions where player_id = :r and kind = 'daily' and template_key <> 'd_rich_list';
update public.player_missions set reset_at = public.game_now() - interval '21 hours'
 where player_id = :r and template_key = 'd_rich_list';
select public.missions_assign(:r) is not null as ok \gset
update public.mission_templates set weight = 30 where key = 'd_rich_list';
select tests.assert(
  :'fresh_rests'::boolean
  and (select status = 'active' and progress = 0 and reset_at is null and expires_at > public.game_now()
         from public.player_missions where player_id = :r and template_key = 'd_rich_list')
  and (select count(*) from public.player_missions where player_id = :r and kind = 'daily' and status = 'active') = 3,
  'a swapped template rests for 20 hours (its row fills no slot), then it may come back fresh');

drop table a2_before;
drop table a2_open;
delete from public.mission_resets where player_id = :r;
