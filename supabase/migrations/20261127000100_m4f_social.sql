-- =============================================================================
-- NEXA · M4f · 0100 · Friends feed and in-app notifications (ADR-088)
-- =============================================================================
-- Feed items are written by AFTER triggers on the tables of the existing write paths, so no
-- RPC changes its behaviour (a rolled back action leaves no item). Kinds and payloads
-- (the client renders the German text from kind + payload):
--   level_up {level}                     profiles.level reaches a multiple of social.feed.levelEvery
--   big_trade {ticker, security_name, profit_cents, profit_bps}
--                                        trades: a fill that realises ≥ bigTradeMinProfitCents and ≥ bigTradeMinBps
--   company_founded {name, tier}         player_companies insert
--   company_upgraded {name, tier}        player_companies.tier changes (not to 'ag')
--   company_ipo {name, ticker}           player_companies.tier becomes 'ag' (IPO subscription ended listed)
--   company_expanded {name, level}       player_companies.expansion_level rises
--   art_won {title, code, price_cents}   artwork_sales insert ≥ artMinPriceCents (gallery and player auctions)
--   art_created {title, code}            artworks insert of a player artwork
--   home_bought {tier}                   player_homes.tier set / changed
--   car_bought {car_key, price_cents}    player_cars insert ≥ carMinPriceCents
--   job_started {company_name, title, title_key}  player_jobs insert from a signed contract
--   streak {days}                        login_streaks.current_streak reaches a value of streakMilestones
--   friends_now {other_nickname}         friendships pending → accepted (one item per side)
--   league_won {week_start, growth_bps}  posted by league_close (migration 0200)
-- Reactions: feed_reactions (one per item and player), RPC react_feed toggles.
-- RPCs: get_feed(before, limit) -> {items: [FEED_ITEM], next_before}, react_feed(request_id, item_id) -> {item},
--       get_notifications(limit) -> {items, unread}, mark_notifications_read(ids) -> {unread}.
-- Notifications (in-app, preferences respected): feed_reaction, art_outbid, job_application (league_result: 0200).
-- Error: feed_item_not_found (react_feed on an item that does not exist or is not visible).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Schema
-- ---------------------------------------------------------------------------
alter table public.feed_items add column if not exists dedupe_key text;
create unique index if not exists feed_items_dedupe_uq on public.feed_items (dedupe_key);
create index if not exists feed_items_actor_id_idx on public.feed_items (actor_id, id desc);
comment on column public.feed_items.dedupe_key is 'Optional unique key: the same event never posts twice (ADR-088).';

create table if not exists public.feed_reactions (
  item_id    bigint not null references public.feed_items (id) on delete cascade,
  player_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, player_id)
);
alter table public.feed_reactions enable row level security;
create index if not exists feed_reactions_player_idx on public.feed_reactions (player_id);
revoke all on public.feed_reactions from public, anon, authenticated;
grant all on public.feed_reactions to service_role;
comment on table public.feed_reactions is 'One reaction ("gefällt mir") per feed item and player (ADR-088). Internal (RPCs).';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('feed_reaction', 'social', 'Reaktion im Feed', 'Jemand hat auf deinen Beitrag im Freundes-Feed reagiert.',
        'notif_feed', true, false, false, 285),
       ('league_result', 'social', 'Liga-Ergebnis', 'Die Wochenliga ist ausgewertet.', 'notif_trophy', true, false, false, 290),
       ('art_outbid', 'social', 'Überboten', 'Jemand hat dein Gebot auf ein Kunstwerk überboten.', 'notif_bell', true, true,
        false, 295),
       ('job_application', 'company', 'Neue Bewerbung', 'Jemand hat sich auf eine Stelle deiner Firma beworben.',
        'notif_briefcase', true, false, false, 225)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- B. Helpers
-- ---------------------------------------------------------------------------
-- One feed item of an active player (visibility friends); a known dedupe key posts nothing
create or replace function public.feed_post(p_actor uuid, p_kind text, p_payload jsonb, p_dedupe text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_actor is null or p_kind is null
     or not exists (select 1 from public.profiles p where p.id = p_actor and not p.is_deactivated) then
    return null;
  end if;
  insert into public.feed_items (actor_id, kind, visibility, payload, dedupe_key)
  values (p_actor, p_kind, 'friends', coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.feed_post(uuid, text, jsonb, text) is
  'Internal: posts a friends feed item (ADR-088); p_dedupe makes retries harmless.';

-- In-app notification unless the player switched the type off (missing preference: the type's
-- default; mandatory types always). A known (player, dedupe key) inserts nothing.
create or replace function public.social_notify(p_player uuid, p_type text, p_title text, p_body text, p_payload jsonb,
                                                p_link text, p_dedupe text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.notification_types;
begin
  select * into t from public.notification_types x where x.key = p_type;
  if t.key is null or p_player is null
     or not exists (select 1 from public.profiles p where p.id = p_player and not p.is_deactivated) then
    return;
  end if;
  if not t.is_mandatory
     and not coalesce((select np.in_app_enabled from public.notification_preferences np
                        where np.player_id = p_player and np.type_key = p_type), t.default_in_app, true) then
    return;
  end if;
  insert into public.notifications (player_id, type_key, title, body, payload, link, dedupe_key)
  values (p_player, p_type, left(p_title, 200), left(p_body, 500), coalesce(p_payload, '{}'::jsonb), p_link, p_dedupe)
  on conflict (player_id, dedupe_key) do nothing;
end;
$$;
comment on function public.social_notify(uuid, text, text, text, jsonb, text, text) is
  'Internal: in-app notification respecting notification_preferences (ADR-088).';

-- Short German description of a feed item (body of the reaction notification)
create or replace function public.feed_item_label(p_kind text, p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'level_up' then 'Level ' || coalesce(p_payload ->> 'level', '?') || ' erreicht'
    when 'big_trade' then 'Gewinn mit ' || coalesce(p_payload ->> 'ticker', 'einer Aktie')
    when 'company_founded' then coalesce(p_payload ->> 'name', 'Firma') || ' gegründet'
    when 'company_upgraded' then coalesce(p_payload ->> 'name', 'Firma') || ' aufgestiegen'
    when 'company_ipo' then coalesce(p_payload ->> 'name', 'Firma') || ' an der Börse'
    when 'company_expanded' then coalesce(p_payload ->> 'name', 'Firma') || ' erweitert'
    when 'art_won' then 'Kunstwerk „' || coalesce(p_payload ->> 'title', '?') || '“ ersteigert'
    when 'art_created' then 'Kunstwerk „' || coalesce(p_payload ->> 'title', '?') || '“ gemalt'
    when 'home_bought' then 'Neues Zuhause'
    when 'car_bought' then 'Neues Auto'
    when 'job_started' then 'Neuer Job bei ' || coalesce(p_payload ->> 'company_name', '?')
    when 'streak' then coalesce(p_payload ->> 'days', '?') || ' Tage in Folge dabei'
    when 'league_won' then 'Wochenliga gewonnen'
    when 'friends_now' then 'Jetzt befreundet mit ' || coalesce(p_payload ->> 'other_nickname', '?')
    else 'Beitrag im Feed'
  end;
$$;

-- Accepted friends of a player
create or replace function public.friend_ids(p_player uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when f.requester_id = p_player then f.addressee_id else f.requester_id end
    from public.friendships f
   where f.status = 'accepted' and p_player in (f.requester_id, f.addressee_id);
$$;

-- FEED_ITEM from the point of view of p_viewer
create or replace function public.feed_item_json(p_item bigint, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',         fi.id,
    'kind',       fi.kind,
    'payload',    fi.payload,
    'created_at', fi.created_at,
    'is_me',      fi.actor_id = p_viewer,
    'actor',      jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'avatar_key', p.avatar_key, 'level', p.level),
    'reactions',  (select count(*) from public.feed_reactions r where r.item_id = fi.id)::integer,
    'reacted',    exists (select 1 from public.feed_reactions r where r.item_id = fi.id and r.player_id = p_viewer))
    from public.feed_items fi join public.profiles p on p.id = fi.actor_id
   where fi.id = p_item;
$$;

-- ---------------------------------------------------------------------------
-- C. Feed triggers (each fires only for the real event of its write path)
-- ---------------------------------------------------------------------------
create or replace function public.feed_on_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_every integer := greatest(1, public.config_double('social', '{feed,levelEvery}', 5)::integer);
  v_level integer := (new.level / v_every) * v_every;
begin
  if v_level > old.level and v_level >= v_every then
    perform public.feed_post(new.id, 'level_up', jsonb_build_object('level', v_level),
                             'level_up:' || new.id::text || ':' || v_level::text);
  end if;
  return null;
end;
$$;
drop trigger if exists feed_on_level on public.profiles;
create trigger feed_on_level after update of level on public.profiles
  for each row when (new.level > old.level) execute function public.feed_on_level();

-- profit_bps = realised profit / cost basis of the sold part (gross - fee - profit)
create or replace function public.feed_on_trade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost bigint := new.gross_cents - new.fee_cents - new.realized_pnl_cents;
  v_bps  bigint;
  s      public.securities;
begin
  if new.counterparty = 'issuer' or v_cost <= 0
     or new.realized_pnl_cents < public.config_bigint('social', '{feed,bigTradeMinProfitCents}', 100000) then
    return null;
  end if;
  v_bps := public.div_round_half_even(new.realized_pnl_cents::numeric * 10000, v_cost);
  if v_bps < public.config_bigint('social', '{feed,bigTradeMinBps}', 1500) then
    return null;
  end if;
  select * into s from public.securities x where x.id = new.security_id;
  perform public.feed_post(new.player_id, 'big_trade',
    jsonb_build_object('ticker', s.ticker, 'security_name', s.name, 'profit_cents', new.realized_pnl_cents, 'profit_bps', v_bps),
    'big_trade:' || new.id::text);
  return null;
end;
$$;
drop trigger if exists feed_on_trade on public.trades;
create trigger feed_on_trade after insert on public.trades
  for each row when (new.realized_pnl_cents is not null and new.realized_pnl_cents > 0)
  execute function public.feed_on_trade();

create or replace function public.feed_on_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.companies;
begin
  select * into c from public.companies x where x.id = new.company_id;
  if tg_op = 'INSERT' then
    perform public.feed_post(new.founder_id, 'company_founded', jsonb_build_object('name', c.name, 'tier', new.tier),
                             'company_founded:' || new.company_id::text);
    return null;
  end if;
  if new.tier is distinct from old.tier then
    if new.tier = 'ag' then
      perform public.feed_post(new.founder_id, 'company_ipo', jsonb_build_object('name', c.name, 'ticker', c.ticker),
                               'company_ipo:' || new.company_id::text);
    else
      perform public.feed_post(new.founder_id, 'company_upgraded', jsonb_build_object('name', c.name, 'tier', new.tier),
                               'company_upgraded:' || new.company_id::text || ':' || new.tier);
    end if;
  end if;
  if new.expansion_level > old.expansion_level then
    perform public.feed_post(new.founder_id, 'company_expanded', jsonb_build_object('name', c.name, 'level', new.expansion_level),
                             'company_expanded:' || new.company_id::text || ':' || new.expansion_level::text);
  end if;
  return null;
end;
$$;
drop trigger if exists feed_on_company_insert on public.player_companies;
create trigger feed_on_company_insert after insert on public.player_companies
  for each row execute function public.feed_on_company();
drop trigger if exists feed_on_company_update on public.player_companies;
create trigger feed_on_company_update after update of tier, expansion_level on public.player_companies
  for each row when (new.tier is distinct from old.tier or new.expansion_level > old.expansion_level)
  execute function public.feed_on_company();

create or replace function public.feed_on_art_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.artworks;
begin
  if new.price_cents < public.config_bigint('social', '{feed,artMinPriceCents}', 1000000) then
    return null;
  end if;
  select * into a from public.artworks x where x.id = new.artwork_id;
  perform public.feed_post(new.buyer_id, 'art_won',
    jsonb_build_object('title', a.title, 'code', public.artwork_code(a.serial), 'price_cents', new.price_cents),
    'art_won:' || new.auction_id::text);
  return null;
end;
$$;
drop trigger if exists feed_on_art_sale on public.artwork_sales;
create trigger feed_on_art_sale after insert on public.artwork_sales
  for each row execute function public.feed_on_art_sale();

create or replace function public.feed_on_art_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.feed_post(new.creator_id, 'art_created',
    jsonb_build_object('title', new.title, 'code', public.artwork_code(new.serial)), 'art_created:' || new.id::text);
  return null;
end;
$$;
drop trigger if exists feed_on_art_created on public.artworks;
create trigger feed_on_art_created after insert on public.artworks
  for each row when (new.origin = 'player' and new.creator_id is not null) execute function public.feed_on_art_created();

create or replace function public.feed_on_home()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.feed_post(new.player_id, 'home_bought', jsonb_build_object('tier', new.tier), null);
  return null;
end;
$$;
drop trigger if exists feed_on_home_insert on public.player_homes;
create trigger feed_on_home_insert after insert on public.player_homes
  for each row when (new.tier is not null) execute function public.feed_on_home();
drop trigger if exists feed_on_home_update on public.player_homes;
create trigger feed_on_home_update after update of tier on public.player_homes
  for each row when (new.tier is not null and new.tier is distinct from old.tier) execute function public.feed_on_home();

create or replace function public.feed_on_car()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.price_paid_cents >= public.config_bigint('social', '{feed,carMinPriceCents}', 10000000) then
    perform public.feed_post(new.player_id, 'car_bought', jsonb_build_object('car_key', new.car_key, 'price_cents', new.price_paid_cents),
                             'car_bought:' || new.id::text);
  end if;
  return null;
end;
$$;
drop trigger if exists feed_on_car on public.player_cars;
create trigger feed_on_car after insert on public.player_cars
  for each row execute function public.feed_on_car();

-- title as stored (custom title or the AI title key), title_key for translation (null for custom titles)
create or replace function public.feed_on_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.feed_post(new.player_id, 'job_started',
    jsonb_build_object('company_name', (select c.name from public.companies c where c.id = new.company_id),
                       'title', new.title, 'title_key', new.title_key),
    'job_started:' || new.id::text);
  return null;
end;
$$;
drop trigger if exists feed_on_job on public.player_jobs;
create trigger feed_on_job after insert on public.player_jobs
  for each row when (new.application_id is not null) execute function public.feed_on_job();

create or replace function public.feed_on_streak()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from jsonb_array_elements_text(coalesce(public.config_jsonb('social', '{feed,streakMilestones}'),
                                                              '[7, 30, 100, 365]'::jsonb)) m
              where m.value ~ '^[0-9]+$' and m.value::integer = new.current_streak) then
    perform public.feed_post(new.player_id, 'streak', jsonb_build_object('days', new.current_streak),
                             'streak:' || new.player_id::text || ':' || new.current_streak::text || ':'
                             || coalesce(new.last_login_day::text, ''));
  end if;
  return null;
end;
$$;
drop trigger if exists feed_on_streak on public.login_streaks;
create trigger feed_on_streak after update of current_streak on public.login_streaks
  for each row when (new.current_streak > old.current_streak) execute function public.feed_on_streak();

create or replace function public.feed_on_friendship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.feed_post(new.requester_id, 'friends_now',
    jsonb_build_object('other_nickname', (select p.nickname from public.profiles p where p.id = new.addressee_id)),
    'friends_now:' || new.id::text || ':' || new.requester_id::text);
  perform public.feed_post(new.addressee_id, 'friends_now',
    jsonb_build_object('other_nickname', (select p.nickname from public.profiles p where p.id = new.requester_id)),
    'friends_now:' || new.id::text || ':' || new.addressee_id::text);
  return null;
end;
$$;
drop trigger if exists feed_on_friendship on public.friendships;
create trigger feed_on_friendship after update of status on public.friendships
  for each row when (new.status = 'accepted' and old.status is distinct from 'accepted')
  execute function public.feed_on_friendship();

-- ---------------------------------------------------------------------------
-- D. Notification triggers
-- ---------------------------------------------------------------------------
-- The previous highest bidder of an artwork auction (not when the leader raises the own bid)
create or replace function public.notify_on_outbid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a      public.artworks;
  v_nick text;
begin
  select * into a from public.artworks x where x.id = new.artwork_id;
  select p.nickname into v_nick from public.profiles p where p.id = new.leader_id;
  perform public.social_notify(old.leader_id, 'art_outbid', v_nick || ' hat dich überboten',
    '„' || a.title || '“ (' || public.artwork_code(a.serial) || '): neues Gebot ' || public.format_eur(new.current_cents),
    jsonb_build_object('auction_id', new.id, 'artwork_id', a.id, 'code', public.artwork_code(a.serial), 'title', a.title,
                       'amount_cents', new.current_cents, 'nickname', v_nick),
    '/artworks', 'art_outbid:' || new.id::text || ':' || new.bids::text);
  return null;
end;
$$;
drop trigger if exists notify_on_outbid on public.artwork_auctions;
create trigger notify_on_outbid after update of leader_id on public.artwork_auctions
  for each row when (old.leader_id is not null and new.leader_id is not null and new.leader_id <> old.leader_id)
  execute function public.notify_on_outbid();

-- The founder of a player company receives every new application to one of its postings
create or replace function public.notify_on_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_founder uuid;
  v_title   text;
  v_nick    text;
begin
  select pc.founder_id, coalesce(jp.title, jp.title_key) into v_founder, v_title
    from public.job_postings jp
    join public.player_companies pc on pc.company_id = jp.company_id and pc.status = 'active'
   where jp.id = new.posting_id and not jp.is_ai;
  if v_founder is null or v_founder = new.player_id then
    return null;
  end if;
  select p.nickname into v_nick from public.profiles p where p.id = new.player_id;
  perform public.social_notify(v_founder, 'job_application', v_nick || ' hat sich beworben', 'Stelle: ' || v_title,
    jsonb_build_object('application_id', new.id, 'posting_id', new.posting_id, 'nickname', v_nick, 'title', v_title),
    '/company', 'job_application:' || new.id::text);
  return null;
end;
$$;
drop trigger if exists notify_on_application on public.job_applications;
create trigger notify_on_application after insert on public.job_applications
  for each row execute function public.notify_on_application();

-- ---------------------------------------------------------------------------
-- E. RPCs: feed
-- ---------------------------------------------------------------------------
-- My items and those of accepted friends, newest first, keyset pagination by id
create or replace function public.get_feed(p_before bigint default null, p_limit integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_limit  integer := least(50, greatest(1, coalesce(p_limit,
                        public.config_double('social', '{feed,pageSize}', 30)::integer)));
  v_actors uuid[];
  v_ids    bigint[];
  v_more   boolean;
begin
  select array_agg(x) into v_actors from (select v_player as x union select public.friend_ids(v_player)) f;
  select coalesce(array_agg(x.id order by x.id desc), '{}') into v_ids
    from (select fi.id
            from public.feed_items fi join public.profiles p on p.id = fi.actor_id
           where fi.actor_id = any (v_actors) and not p.is_deactivated
             and (p_before is null or fi.id < p_before)
           order by fi.id desc
           limit v_limit + 1) x;
  v_more := coalesce(array_length(v_ids, 1), 0) > v_limit;
  if v_more then
    v_ids := v_ids[1:v_limit];
  end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(public.feed_item_json(i.id, v_player) order by i.id desc) from unnest(v_ids) i(id)),
                      '[]'::jsonb),
    'next_before', case when v_more then v_ids[v_limit] end);
end;
$$;
comment on function public.get_feed(bigint, integer) is
  'RPC: friends feed (own items and accepted friends), newest first; p_before = keyset cursor (ADR-088).';

-- Toggles my reaction; the actor is notified once per (item, reactor)
create or replace function public.react_feed(p_request_id uuid, p_item_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  it       public.feed_items;
  v_nick   text;
begin
  v_player := public.require_player();
  if p_request_id is null or p_item_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'react_feed');
  if v_replay is not null then
    return v_replay;
  end if;
  if not public.rate_limit_hit(v_player, 'player_action',
           greatest(1, public.config_double('abuse', '{rateLimits,actionsPerMinute}', 60))::integer, 60) then
    perform public.api_error('rate_limited');
  end if;
  select fi.* into it
    from public.feed_items fi join public.profiles p on p.id = fi.actor_id
   where fi.id = p_item_id and not p.is_deactivated;
  if it.id is null or (it.actor_id <> v_player and it.actor_id not in (select public.friend_ids(v_player))) then
    perform public.api_error('feed_item_not_found');
  end if;
  delete from public.feed_reactions r where r.item_id = it.id and r.player_id = v_player;
  if not found then
    insert into public.feed_reactions (item_id, player_id) values (it.id, v_player) on conflict do nothing;
    if it.actor_id <> v_player then
      select p.nickname into v_nick from public.profiles p where p.id = v_player;
      perform public.social_notify(it.actor_id, 'feed_reaction', v_nick || ' gefällt dein Beitrag',
        public.feed_item_label(it.kind, it.payload),
        jsonb_build_object('item_id', it.id, 'kind', it.kind, 'nickname', v_nick),
        '/friends', 'feed_reaction:' || it.id::text || ':' || v_player::text);
    end if;
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('item', public.feed_item_json(it.id, v_player)));
end;
$$;
comment on function public.react_feed(uuid, bigint) is
  'RPC: toggles the caller''s reaction on a visible feed item -> {item} (ADR-088). Error feed_item_not_found.';

-- ---------------------------------------------------------------------------
-- F. RPCs: notifications
-- ---------------------------------------------------------------------------
create or replace function public.get_notifications(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
  v_limit  integer := least(100, greatest(1, coalesce(p_limit, 30)));
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'type_key', x.type_key, 'title', x.title, 'body', x.body, 'link', x.link,
                                          'payload', x.payload, 'created_at', x.created_at, 'read_at', x.read_at)
                       order by x.created_at desc, x.id)
        from (select n.* from public.notifications n
               where n.player_id = v_player and (n.expires_at is null or n.expires_at > now())
               order by n.created_at desc, n.id limit v_limit) x), '[]'::jsonb),
    'unread', (select count(*) from public.notifications n
                where n.player_id = v_player and n.read_at is null and (n.expires_at is null or n.expires_at > now()))::integer);
end;
$$;
comment on function public.get_notifications(integer) is
  'RPC: the caller''s notifications (not expired), newest first, and the unread count (ADR-088).';

-- null = all; already read rows keep their read_at (idempotent)
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  update public.notifications n set read_at = now()
   where n.player_id = v_player and n.read_at is null and (p_ids is null or n.id = any (p_ids));
  return jsonb_build_object('unread', (select count(*) from public.notifications n
                                        where n.player_id = v_player and n.read_at is null
                                          and (n.expires_at is null or n.expires_at > now()))::integer);
end;
$$;
comment on function public.mark_notifications_read(uuid[]) is
  'RPC: marks the caller''s notifications (all or p_ids) as read -> {unread} (ADR-088).';

-- ---------------------------------------------------------------------------
-- G. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.feed_post(uuid, text, jsonb, text)', 'public.social_notify(uuid, text, text, text, jsonb, text, text)',
    'public.feed_item_label(text, jsonb)', 'public.friend_ids(uuid)', 'public.feed_item_json(bigint, uuid)',
    'public.feed_on_level()', 'public.feed_on_trade()', 'public.feed_on_company()', 'public.feed_on_art_sale()',
    'public.feed_on_art_created()', 'public.feed_on_home()', 'public.feed_on_car()', 'public.feed_on_job()',
    'public.feed_on_streak()', 'public.feed_on_friendship()', 'public.notify_on_outbid()', 'public.notify_on_application()',
    'public.get_feed(bigint, integer)', 'public.react_feed(uuid, bigint)', 'public.get_notifications(integer)',
    'public.mark_notifications_read(uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.get_feed(bigint, integer)', 'public.react_feed(uuid, bigint)', 'public.get_notifications(integer)',
    'public.mark_notifications_read(uuid[])'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
