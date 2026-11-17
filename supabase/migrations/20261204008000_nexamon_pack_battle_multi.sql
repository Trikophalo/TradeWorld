-- =============================================================================
-- NEXA · 8000 · Nexamon Pack Battles with several packs and up to four players (ADR-192)
-- =============================================================================
-- Rules: game_config.nexamon.packBattle (maxPacks, minPlayers, maxPlayers, lobbySeconds) and .battles (timing per
-- pack); src/lib/sim/nexamon-battle.ts (decideMultiBattle, multiBattleTimeline, multiKnownCards).
-- * create_nexamon_pack_battle(p_request_id, p_sets, p_size, p_invite): the creator picks a lineup of 1..maxPacks
--   packs (released sets, in order, may differ) and the size (2..maxPlayers), pays the sum of the lineup into the
--   escrow account nexamon_battle_escrow and takes seat 0. Invited friends get a notification; every friend of the
--   creator sees the open lobby on the Collectibles tab (nexamon_lobby.open_battles) and may join.
-- * join_nexamon_pack_battle(p_request_id, p_battle_id): a friend of the creator takes the next seat and pays the
--   same sum into escrow. The last seat starts the battle at once (nexamon_pack_battle_start): the escrow goes to
--   the households (as for a bought pack), every seat opens the same lineup pack by pack (nexamon_open_pack, big
--   pulls notify as before), the highest total over all packs wins (tie: rarest card among the leaders, then
--   coin_seed % tied count in seat order), the winner owns every copy of every seat.
-- * cancel_nexamon_battle(): the creator cancels the open lobby (unchanged function); a lobby that is not full after
--   packBattle.lobbySeconds expires (lazily and by the cron job nexa-nexamon-pack-battles). Both refund every seat in
--   full from escrow (trigger nexamon_battles_refund; ledger, sum 0, one key per seat).
-- * Classic duels (challenge/respond) stay as they were; respond_nexamon_battle() refuses a lobby battle.
-- * nexamon_battle_json(), nexamon_live_row_json(), nexamon_lobby(), get_nexamon_battle(), nexamon_battle_busy(),
--   nexamon_battles_last_hour() know the seats (latest definitions from 6310/6320, redefined in full).
-- Errors: nexamon_battle_full NX311, nexamon_battle_joined NX312.
-- Idempotent: runs unchanged as supabase/updates/20261204008000_nexamon_pack_battle_multi.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
  v_old text := $q$    when 'nexamon_set_not_released'   then 'NX310'
$q$;
begin
  if position('''nexamon_battle_full''' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the error keys nexamon_battle_full/_joined (ADR-192) by hand';
    end if;
    execute replace(v_def, v_old, v_old || $q$    when 'nexamon_battle_full'        then 'NX311'
    when 'nexamon_battle_joined'      then 'NX312'
$q$);
  end if;
end;
$do$;

insert into public.ledger_accounts (kind, system_key, label, allow_negative) values
  ('system', 'nexamon_battle_escrow', 'Pack Battles: stakes of open lobbies until the battle starts or is refunded (ADR-192)', false)
on conflict do nothing;

alter table public.nexamon_battles alter column opponent_id drop not null;
alter table public.nexamon_battles add column if not exists mode text not null default 'duel';
alter table public.nexamon_battles add column if not exists size smallint not null default 2;
alter table public.nexamon_battles add column if not exists packs jsonb;
alter table public.nexamon_battles add column if not exists winner_seat smallint;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'nexamon_battles_mode_check') then
    alter table public.nexamon_battles add constraint nexamon_battles_mode_check
      check (mode in ('duel', 'multi') and size between 2 and 4 and (mode = 'multi' or opponent_id is not null));
  end if;
end;
$do$;
comment on column public.nexamon_battles.mode is
  'duel = the classic challenge of one friend (ADR-172); multi = a lobby with a pack lineup and 2-4 seats (ADR-192).';
comment on column public.nexamon_battles.packs is
  'multi: the lineup in order, [{set, price_cents}]; price_cents of the battle is their sum (the stake per seat).';
comment on column public.nexamon_battles.winner_seat is 'multi: the winning seat (0 = the creator).';

create table if not exists public.nexamon_battle_seats (
  battle_id   uuid not null references public.nexamon_battles (id) on delete cascade,
  seat        smallint not null check (seat between 0 and 3),
  player_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at   timestamptz not null,
  paid_cents  bigint not null default 0 check (paid_cents >= 0),
  refunded_at timestamptz,
  invited     boolean not null default false,
  cards       jsonb,
  total_cents bigint,
  primary key (battle_id, seat)
);
create unique index if not exists nexamon_battle_seats_player_uidx on public.nexamon_battle_seats (battle_id, player_id);
create index if not exists nexamon_battle_seats_player_idx on public.nexamon_battle_seats (player_id);
alter table public.nexamon_battle_seats enable row level security;
revoke all on public.nexamon_battle_seats from public, anon, authenticated;
grant all on public.nexamon_battle_seats to service_role;
comment on table public.nexamon_battle_seats is
  'Seats of a multi Pack Battle (ADR-192): who sits where, what they paid into escrow (refunded_at on a refund), '
  'their pulls over the whole lineup (cards with pack, slot, idx) and total. Invited friends without a seat yet have '
  'no row (invitations are notifications). Internal.';

create table if not exists public.nexamon_battle_invites (
  battle_id uuid not null references public.nexamon_battles (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  primary key (battle_id, player_id)
);
create index if not exists nexamon_battle_invites_player_idx on public.nexamon_battle_invites (player_id);
alter table public.nexamon_battle_invites enable row level security;
revoke all on public.nexamon_battle_invites from public, anon, authenticated;
grant all on public.nexamon_battle_invites to service_role;
comment on table public.nexamon_battle_invites is 'Friends the creator invited to a multi Pack Battle (ADR-192). Internal.';

-- ---------------------------------------------------------------------------
-- Busy and hourly limit know the seats (latest: 6320)
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_battle_busy(p_player uuid, p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.nexamon_battles b
                  where (p_player in (b.challenger_id, b.opponent_id)
                         or exists (select 1 from public.nexamon_battle_seats s where s.battle_id = b.id and s.player_id = p_player))
                    and ((b.status = 'pending' and b.expires_at > p_now) or (b.status = 'accepted' and b.ends_at > p_now)));
$$;

create or replace function public.nexamon_battles_last_hour(p_player uuid, p_now timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.nexamon_battles b
   where (p_player in (b.challenger_id, b.opponent_id)
          or exists (select 1 from public.nexamon_battle_seats s where s.battle_id = b.id and s.player_id = p_player))
     and b.status = 'accepted' and b.accepted_at > p_now - interval '1 hour';
$$;

-- Who wins a multi battle (decideMultiBattle): p_seats = [cards of seat 0, cards of seat 1, ...]
create or replace function public.nexamon_pack_battle_decide(p_seats jsonb, p_seed bigint)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_tot  bigint[] := '{}';
  v_rank integer[] := '{}';
  v_tied integer[] := '{}';
  v_best bigint;
  v_top  integer;
  v_sum  bigint;
  v_r    integer;
  i      integer;
begin
  for i in 0 .. jsonb_array_length(p_seats) - 1 loop
    select coalesce(sum((x ->> 'value_cents')::bigint), 0), coalesce(max(public.nexamon_rarity_rank(x ->> 'rarity')), -1)
      into v_sum, v_r from jsonb_array_elements(coalesce(p_seats -> i, '[]'::jsonb)) x;
    v_tot := v_tot || v_sum;
    v_rank := v_rank || v_r;
  end loop;
  select max(t) into v_best from unnest(v_tot) t;
  for i in 1 .. array_length(v_tot, 1) loop
    if v_tot[i] = v_best then
      v_tied := v_tied || (i - 1);
    end if;
  end loop;
  if array_length(v_tied, 1) = 1 then
    return jsonb_build_object('winner', v_tied[1], 'tie_break', 'value', 'totals', to_jsonb(v_tot));
  end if;
  select max(v_rank[t + 1]) into v_top from unnest(v_tied) t;
  select array_agg(t order by t) into v_tied from unnest(v_tied) t where v_rank[t + 1] = v_top;
  if array_length(v_tied, 1) = 1 then
    return jsonb_build_object('winner', v_tied[1], 'tie_break', 'rarest', 'totals', to_jsonb(v_tot));
  end if;
  return jsonb_build_object('winner', v_tied[(abs(coalesce(p_seed, 0)) % array_length(v_tied, 1))::integer + 1],
                            'tie_break', 'coin', 'totals', to_jsonb(v_tot));
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds: every seat of a multi battle that leaves pending without starting gets its stake back
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_pack_battle_refund(p_battle uuid, p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n integer := 0;
begin
  for r in select s.* from public.nexamon_battle_seats s
            where s.battle_id = p_battle and s.paid_cents > 0 and s.refunded_at is null
            order by s.seat for update loop
    perform public.ledger_transfer(public.ledger_system_account('nexamon_battle_escrow'),
                                   public.ledger_player_account(r.player_id, 'player_cash'), r.paid_cents, 'nexamon_pack',
                                   'Pack Battle: Einsatz zurück', 'nexamon_battle', p_battle,
                                   'nexamon:battle:refund:' || p_battle::text || ':' || r.player_id::text, r.player_id,
                                   jsonb_build_object('battle_id', p_battle, 'price_cents', r.paid_cents));
    update public.nexamon_battle_seats set refunded_at = p_now where battle_id = r.battle_id and seat = r.seat;
    if r.seat > 0 then
      perform public.social_notify(r.player_id, 'nexamon_battle', 'Pack Battle abgesagt',
        'Das Pack Battle ist nicht zustande gekommen. Dein Einsatz von ' || public.format_eur(r.paid_cents) || ' ist zurück.',
        jsonb_build_object('battle_id', p_battle), '/nexamon', 'nexamon:battle:refund:' || p_battle::text || ':' || r.player_id::text);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.nexamon_battles_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mode = 'multi' and old.status = 'pending' and new.status in ('expired', 'cancelled', 'declined', 'aborted') then
    perform public.nexamon_pack_battle_refund(new.id, coalesce(new.responded_at, public.game_now()));
  end if;
  return null;
end;
$$;
drop trigger if exists nexamon_battles_refund on public.nexamon_battles;
create trigger nexamon_battles_refund after update of status on public.nexamon_battles
  for each row execute function public.nexamon_battles_refund();

-- Open lobbies past their time expire (and refund through the trigger)
create or replace function public.nexamon_pack_battle_expire(p_now timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, public.game_now());
  v_n   integer;
begin
  update public.nexamon_battles set status = 'expired', responded_at = expires_at
   where mode = 'multi' and status = 'pending' and expires_at <= v_now;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- One pack of a seat: opened in the player's name (is_new, feed, missions, big pulls); paid from escrow at start
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_pack_battle_pull(b public.nexamon_battles, p_player uuid, p_set text, p_pack integer,
                                                           p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.nexamon_cfg();
  v_size  integer := coalesce((cfg ->> 'packSize')::integer, 5);
  v_cards jsonb;
  r       record;
begin
  v_cards := public.nexamon_open_pack(p_set, p_player, null, b.id, p_now);
  perform public.mission_event(p_player, 'nexamon_pack', 1, null);
  for r in select x ->> 'rarity' as rarity from jsonb_array_elements(v_cards) x loop
    if public.nexamon_rarity_rank(r.rarity) >= 1 then
      perform public.mission_event(p_player, 'nexamon_rare', 1, null);
    end if;
    if public.nexamon_rarity_rank(r.rarity) >= 2 then
      perform public.mission_event(p_player, 'nexamon_ultra', 1, null);
    end if;
  end loop;
  return coalesce((select jsonb_agg(x || jsonb_build_object('pack', p_pack, 'set', p_set,
                                                            'idx', (p_pack - 1) * v_size + (x ->> 'slot')::integer)
                                    order by (x ->> 'slot')::integer)
                     from jsonb_array_elements(v_cards) x), '[]'::jsonb);
end;
$$;

-- The last seat is taken: pay the packs, open the lineup for every seat, decide, the winner takes all
create or replace function public.nexamon_pack_battle_start(p_battle uuid, p_now timestamptz)
returns public.nexamon_battles
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  b        public.nexamon_battles;
  s        record;
  v_pack   jsonb;
  v_i      integer;
  v_cards  jsonb;
  v_all    jsonb := '[]'::jsonb;
  v_ids    jsonb := '[]'::jsonb;
  v_seed   bigint;
  v_dec    jsonb;
  v_ws     integer;
  v_win    uuid;
  v_total  bigint;
  v_n      integer;
  v_names  text;
  v_losers text;
  v_starts timestamptz;
  v_decide timestamptz;
begin
  select * into b from public.nexamon_battles x where x.id = p_battle for update;
  perform public.nexamon_sync(p_now);
  v_n := jsonb_array_length(b.packs);
  for s in select * from public.nexamon_battle_seats x where x.battle_id = b.id order by x.seat loop
    if s.paid_cents > 0 then
      perform public.ledger_transfer(public.ledger_system_account('nexamon_battle_escrow'), public.ledger_system_account('households'),
                                     s.paid_cents, 'nexamon_pack', 'Pack Battle: ' || v_n || ' Packs', 'nexamon_battle', b.id,
                                     'nexamon:battle:' || b.id::text || ':' || s.player_id::text, s.player_id,
                                     jsonb_build_object('packs', b.packs, 'price_cents', s.paid_cents, 'battle_id', b.id));
    end if;
    v_cards := '[]'::jsonb;
    for v_i in 0 .. v_n - 1 loop
      v_pack := b.packs -> v_i;
      v_cards := v_cards || public.nexamon_pack_battle_pull(b, s.player_id, v_pack ->> 'set', v_i + 1, p_now);
    end loop;
    update public.nexamon_battle_seats
       set cards = v_cards, total_cents = (select coalesce(sum((x ->> 'value_cents')::bigint), 0) from jsonb_array_elements(v_cards) x)
     where battle_id = b.id and seat = s.seat;
    v_all := v_all || jsonb_build_array(v_cards);
    v_ids := v_ids || (select coalesce(jsonb_agg(x -> 'copy_id'), '[]'::jsonb) from jsonb_array_elements(v_cards) x);
  end loop;
  for v_i in 0 .. v_n - 1 loop
    update public.nexamon_set_state set player_packs_opened = player_packs_opened + b.size where set_key = b.packs -> v_i ->> 'set';
  end loop;

  v_seed := floor(random() * 2147483647)::bigint;
  v_dec := public.nexamon_pack_battle_decide(v_all, v_seed);
  v_ws := (v_dec ->> 'winner')::integer;
  select x.player_id into v_win from public.nexamon_battle_seats x where x.battle_id = b.id and x.seat = v_ws;
  select coalesce(sum(t::bigint), 0) into v_total from jsonb_array_elements_text(v_dec -> 'totals') t;
  -- the winner takes every copy of every seat; listings cannot exist yet
  update public.nexamon_copies c set owner_id = v_win, acquired_at = p_now
   where c.id in (select (x #>> '{}')::uuid from jsonb_array_elements(v_ids) x) and c.owner_id is distinct from v_win;
  if to_regprocedure('public.nexamon_bonus_recompute(uuid)') is not null then
    for s in select x.player_id from public.nexamon_battle_seats x where x.battle_id = b.id order by x.seat loop
      execute 'select public.nexamon_bonus_recompute($1)' using s.player_id;
    end loop;
  end if;

  v_starts := p_now + public.nexamon_ms(coalesce((cfg #>> '{battles,startDelayMs}')::numeric, 3000));
  v_decide := v_starts + public.nexamon_ms(v_n * (coalesce((cfg #>> '{battles,tearMs}')::numeric, 2400)
                                                  + coalesce((cfg ->> 'packSize')::numeric, 5) * coalesce((cfg #>> '{battles,slotMs}')::numeric, 1800)));
  update public.nexamon_battles
     set status = 'accepted', responded_at = p_now, accepted_at = p_now, starts_at = v_starts, decide_at = v_decide,
         ends_at = v_decide + public.nexamon_ms(coalesce((cfg #>> '{battles,outroMs}')::numeric, 8000)),
         opponent_id = (select x.player_id from public.nexamon_battle_seats x where x.battle_id = b.id and x.seat = 1),
         challenger_cards = v_all -> 0, opponent_cards = v_all -> 1,
         challenger_cents = (v_dec #>> '{totals,0}')::bigint, opponent_cents = (v_dec #>> '{totals,1}')::bigint,
         winner_id = v_win, winner_seat = v_ws, tie_break = v_dec ->> 'tie_break', coin_seed = v_seed
   where id = b.id returning * into b;
  insert into public.nexamon_live (player_id, kind, battle_id, set_key, started_at, ends_at)
  values (b.challenger_id, 'battle', b.id, b.set_key, p_now, b.ends_at)
  on conflict (battle_id) do nothing;

  select string_agg(p.nickname, ', ' order by x.seat) into v_names
    from public.nexamon_battle_seats x join public.profiles p on p.id = x.player_id where x.battle_id = b.id;
  select string_agg(p.nickname, ', ' order by x.seat) into v_losers
    from public.nexamon_battle_seats x join public.profiles p on p.id = x.player_id where x.battle_id = b.id and x.seat <> v_ws;
  perform public.feed_post(v_win, 'nexamon_battle_won',
                           jsonb_build_object('set', b.set_key, 'other', v_losers, 'total_cents', v_total, 'packs', v_n,
                                              'players', b.size, 'cards', jsonb_array_length(v_ids)),
                           'nexamon:battle:won:' || b.id::text);
  if v_total >= coalesce((cfg #>> '{battles,gossipMinCents}')::bigint, 500000) then
    perform public.feed_post(v_win, 'nexamon_battle_big',
                             jsonb_build_object('set', b.set_key, 'other', v_losers, 'total_cents', v_total),
                             'nexamon:battle:big:' || b.id::text);
  end if;
  for s in select x.player_id from public.nexamon_battle_seats x where x.battle_id = b.id order by x.seat loop
    perform public.social_notify(s.player_id, 'nexamon_battle', 'Pack Battle läuft', v_names || ': die Packs gehen auf!',
      jsonb_build_object('battle_id', b.id), '/nexamon?battle=' || b.id::text,
      'nexamon:battle:accepted:' || b.id::text || ':' || s.player_id::text);
  end loop;
  return b;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: create and join
-- ---------------------------------------------------------------------------
create or replace function public.create_nexamon_pack_battle(p_request_id uuid, p_sets text[], p_size integer,
                                                             p_invite text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_packs  jsonb := '[]'::jsonb;
  v_price  bigint := 0;
  v_p      bigint;
  v_set    text;
  v_last   timestamptz;
  v_other  uuid;
  v_nick   text;
  v_name   text;
  b        public.nexamon_battles;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_sets is null or p_size is null
     or coalesce(array_length(p_sets, 1), 0) < 1
     or array_length(p_sets, 1) > coalesce((cfg #>> '{packBattle,maxPacks}')::integer, 10)
     or p_size < coalesce((cfg #>> '{packBattle,minPlayers}')::integer, 2)
     or p_size > least(4, coalesce((cfg #>> '{packBattle,maxPlayers}')::integer, 4))
     or coalesce(array_length(p_invite, 1), 0) > p_size - 1 then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'create_nexamon_pack_battle');
  if v_replay is not null then
    return v_replay;
  end if;
  foreach v_set in array p_sets loop
    v_p := (cfg #>> array['sets', v_set, 'packPriceCents'])::bigint;
    if v_set is null or v_p is null or v_p < 0
       or not exists (select 1 from public.nexamon_cards k where k.set_key = v_set and k.in_catalogue) then
      perform public.api_error('nexamon_unknown');
    end if;
    if not public.nexamon_set_released(v_set, v_now) then
      perform public.api_error('nexamon_set_not_released');
    end if;
    v_packs := v_packs || jsonb_build_object('set', v_set, 'price_cents', v_p);
    v_price := v_price + v_p;
  end loop;
  perform 1 from public.profiles p where p.id = v_player for update;
  perform public.nexamon_pack_battle_expire(v_now);
  if public.nexamon_battle_busy(v_player, v_now) then
    perform public.api_error('nexamon_battle_busy');
  end if;
  select max(x.created_at) into v_last from public.nexamon_battles x where x.challenger_id = v_player;
  if v_last is not null and v_last > v_now - make_interval(secs => coalesce((cfg #>> '{battles,cooldownSeconds}')::integer, 20)) then
    perform public.api_error('nexamon_battle_cooldown');
  end if;
  if public.nexamon_battles_last_hour(v_player, v_now) >= coalesce((cfg #>> '{battles,perHour}')::integer, 6) then
    perform public.api_error('nexamon_battle_limit');
  end if;
  if public.lock_player_accounts(v_player) < v_price then
    perform public.api_error('insufficient_funds');
  end if;
  insert into public.nexamon_battles (challenger_id, opponent_id, set_key, price_cents, created_at, expires_at, mode, size, packs)
  values (v_player, null, p_sets[1], v_price, v_now,
          v_now + make_interval(secs => coalesce((cfg #>> '{packBattle,lobbySeconds}')::integer, 120)), 'multi', p_size, v_packs)
  returning * into b;
  insert into public.nexamon_battle_seats (battle_id, seat, player_id, joined_at, paid_cents)
  values (b.id, 0, v_player, v_now, v_price);
  if v_price > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('nexamon_battle_escrow'),
                                   v_price, 'nexamon_pack', 'Pack Battle: Einsatz', 'nexamon_battle', b.id,
                                   'nexamon:battle:stake:' || b.id::text || ':' || v_player::text, v_player,
                                   jsonb_build_object('packs', v_packs, 'price_cents', v_price, 'battle_id', b.id));
  end if;

  select p.nickname into v_name from public.profiles p where p.id = v_player;
  foreach v_nick in array coalesce(p_invite, '{}') loop
    select p.id into v_other from public.profiles p where lower(p.nickname) = lower(v_nick) and not p.is_deactivated;
    if v_other is null then
      perform public.api_error('nexamon_battle_unknown');
    end if;
    if v_other = v_player then
      perform public.api_error('nexamon_battle_self');
    end if;
    if not exists (select 1 from public.friendships f
                    where f.status = 'accepted'
                      and ((f.requester_id = v_player and f.addressee_id = v_other) or (f.requester_id = v_other and f.addressee_id = v_player))) then
      perform public.api_error('nexamon_battle_not_friend');
    end if;
    if not public.nexamon_unlocked(v_other) then
      perform public.api_error('nexamon_battle_opponent_locked');
    end if;
    insert into public.nexamon_battle_invites (battle_id, player_id) values (b.id, v_other) on conflict do nothing;
    perform public.social_notify(v_other, 'nexamon_battle', 'Pack Battle!',
      v_name || ' lädt dich zum Pack Battle ein: ' || jsonb_array_length(v_packs) || ' Pack'
        || case when jsonb_array_length(v_packs) = 1 then '' else 's' end || ', ' || p_size || ' Spieler, Einsatz '
        || public.format_eur(v_price) || '.',
      jsonb_build_object('battle_id', b.id, 'packs', v_packs, 'price_cents', v_price, 'size', p_size),
      '/nexamon?battle=' || b.id::text, 'nexamon:battle:invite:' || b.id::text || ':' || v_other::text);
  end loop;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
end;
$$;
comment on function public.create_nexamon_pack_battle(uuid, text[], integer, text[]) is
  'RPC (ADR-192): opens a Pack Battle lobby with a lineup of packs (sets in order) for 2-4 players, pays the stake '
  '(sum of the pack prices) into escrow, invites friends; returns {battle}. Errors nexamon_locked, invalid_argument, '
  'nexamon_unknown, nexamon_set_not_released, nexamon_battle_busy, nexamon_battle_cooldown, nexamon_battle_limit, '
  'insufficient_funds, nexamon_battle_unknown, nexamon_battle_self, nexamon_battle_not_friend, nexamon_battle_opponent_locked.';

create or replace function public.join_nexamon_pack_battle(p_request_id uuid, p_battle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  v_seat   integer;
  v_taken  integer;
  b        public.nexamon_battles;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_battle_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'join_nexamon_pack_battle');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into b from public.nexamon_battles x where x.id = p_battle_id for update;
  if b.id is null or b.mode <> 'multi'
     or not exists (select 1 from public.friendships f
                     where f.status = 'accepted'
                       and ((f.requester_id = v_player and f.addressee_id = b.challenger_id)
                            or (f.requester_id = b.challenger_id and f.addressee_id = v_player))) then
    if b.id is not null and b.challenger_id = v_player then
      perform public.api_error('nexamon_battle_joined');
    end if;
    perform public.api_error('nexamon_battle_unknown');
  end if;
  if exists (select 1 from public.nexamon_battle_seats s where s.battle_id = b.id and s.player_id = v_player) then
    perform public.api_error('nexamon_battle_joined');
  end if;
  if b.status = 'pending' and b.expires_at <= v_now then
    update public.nexamon_battles set status = 'expired', responded_at = expires_at where id = b.id returning * into b;
    return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
  end if;
  if b.status <> 'pending' then
    perform public.api_error('nexamon_battle_closed');
  end if;
  select count(*)::integer into v_taken from public.nexamon_battle_seats s where s.battle_id = b.id;
  if v_taken >= b.size then
    perform public.api_error('nexamon_battle_full');
  end if;
  if public.nexamon_battle_busy(v_player, v_now) then
    perform public.api_error('nexamon_battle_busy');
  end if;
  if public.nexamon_battles_last_hour(v_player, v_now) >= coalesce((cfg #>> '{battles,perHour}')::integer, 6) then
    perform public.api_error('nexamon_battle_limit');
  end if;
  if public.lock_player_accounts(v_player) < b.price_cents then
    perform public.api_error('insufficient_funds');
  end if;
  select min(g) into v_seat from generate_series(0, b.size - 1) g
   where not exists (select 1 from public.nexamon_battle_seats s where s.battle_id = b.id and s.seat = g);
  insert into public.nexamon_battle_seats (battle_id, seat, player_id, joined_at, paid_cents, invited)
  values (b.id, v_seat, v_player, v_now, b.price_cents,
          exists (select 1 from public.nexamon_battle_invites i where i.battle_id = b.id and i.player_id = v_player));
  if b.price_cents > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('nexamon_battle_escrow'),
                                   b.price_cents, 'nexamon_pack', 'Pack Battle: Einsatz', 'nexamon_battle', b.id,
                                   'nexamon:battle:stake:' || b.id::text || ':' || v_player::text, v_player,
                                   jsonb_build_object('packs', b.packs, 'price_cents', b.price_cents, 'battle_id', b.id));
  end if;
  if v_taken + 1 >= b.size then
    b := public.nexamon_pack_battle_start(b.id, v_now);
  else
    perform public.social_notify(b.challenger_id, 'nexamon_battle', 'Pack Battle',
      (select p.nickname from public.profiles p where p.id = v_player) || ' ist dabei (' || (v_taken + 1) || '/' || b.size || ').',
      jsonb_build_object('battle_id', b.id), '/nexamon?battle=' || b.id::text,
      'nexamon:battle:joined:' || b.id::text || ':' || v_player::text);
  end if;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
end;
$$;
comment on function public.join_nexamon_pack_battle(uuid, uuid) is
  'RPC (ADR-192): a friend of the creator takes the next free seat of an open Pack Battle lobby and pays the stake '
  'into escrow; the last seat starts the battle at once. Returns {battle}. Errors nexamon_locked, invalid_argument, '
  'nexamon_battle_unknown, nexamon_battle_joined, nexamon_battle_closed, nexamon_battle_full, nexamon_battle_busy, '
  'nexamon_battle_limit, insufficient_funds.';

-- ---------------------------------------------------------------------------
-- respond_nexamon_battle (latest: 6320) refuses lobby battles; otherwise unchanged
-- ---------------------------------------------------------------------------
create or replace function public.respond_nexamon_battle(p_request_id uuid, p_battle_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_replay jsonb;
  v_now    timestamptz := public.game_now();
  b        public.nexamon_battles;
  v_ccash  bigint;
  v_ocash  bigint;
  v_ca     jsonb;
  v_oa     jsonb;
  v_csum   bigint;
  v_osum   bigint;
  v_seed   bigint;
  v_dec    jsonb;
  v_win    uuid;
  v_lose   uuid;
  v_tie    text;
  v_names  text;
  v_starts timestamptz;
  v_decide timestamptz;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  if p_request_id is null or p_battle_id is null or p_accept is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'respond_nexamon_battle');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into b from public.nexamon_battles x where x.id = p_battle_id for update;
  if b.id is null or b.mode = 'multi' then
    -- a lobby battle is joined (join_nexamon_pack_battle), never answered
    if b.id is not null and exists (select 1 from public.nexamon_battle_seats s where s.battle_id = b.id and s.player_id = v_player) then
      perform public.api_error('nexamon_battle_not_yours');
    end if;
    perform public.api_error('nexamon_battle_unknown');
  end if;
  if v_player not in (b.challenger_id, b.opponent_id) then
    perform public.api_error('nexamon_battle_unknown');
  end if;
  if v_player <> b.opponent_id then
    perform public.api_error('nexamon_battle_not_yours');
  end if;
  if b.status = 'pending' and b.expires_at <= v_now then
    update public.nexamon_battles set status = 'expired', responded_at = expires_at where id = b.id returning * into b;
    return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
  end if;
  if b.status <> 'pending' then
    perform public.api_error('nexamon_battle_closed');
  end if;

  if not p_accept then
    update public.nexamon_battles set status = 'declined', responded_at = v_now where id = b.id returning * into b;
    perform public.social_notify(b.challenger_id, 'nexamon_battle', 'Pack Battle abgelehnt',
      (select p.nickname from public.profiles p where p.id = b.opponent_id) || ' will gerade nicht battlen.',
      jsonb_build_object('battle_id', b.id), '/nexamon', 'nexamon:battle:declined:' || b.id::text);
    return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
  end if;

  if public.nexamon_battles_last_hour(v_player, v_now) >= coalesce((cfg #>> '{battles,perHour}')::integer, 6)
     or public.nexamon_battles_last_hour(b.challenger_id, v_now) >= coalesce((cfg #>> '{battles,perHour}')::integer, 6) then
    perform public.api_error('nexamon_battle_limit');
  end if;
  perform public.nexamon_sync(v_now);
  -- both accounts in a fixed order
  if b.challenger_id < b.opponent_id then
    v_ccash := public.lock_player_accounts(b.challenger_id);
    v_ocash := public.lock_player_accounts(b.opponent_id);
  else
    v_ocash := public.lock_player_accounts(b.opponent_id);
    v_ccash := public.lock_player_accounts(b.challenger_id);
  end if;
  if v_ocash < b.price_cents then
    perform public.api_error('insufficient_funds');
  end if;
  if v_ccash < b.price_cents or not public.nexamon_unlocked(b.challenger_id) then
    -- the challenger cannot pay any more: nobody pays, nothing is pulled
    update public.nexamon_battles
       set status = 'aborted', responded_at = v_now,
           abort_reason = case when v_ccash < b.price_cents then 'challenger_funds' else 'challenger_locked' end
     where id = b.id returning * into b;
    perform public.social_notify(b.challenger_id, 'nexamon_battle', 'Pack Battle abgebrochen',
      'Für das Pack Battle hat dein Geld nicht mehr gereicht. Niemand hat bezahlt.',
      jsonb_build_object('battle_id', b.id), '/nexamon', 'nexamon:battle:aborted:' || b.id::text);
    return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
  end if;

  v_ca := public.nexamon_battle_pull(b, b.challenger_id, v_now);
  v_oa := public.nexamon_battle_pull(b, b.opponent_id, v_now);
  update public.nexamon_set_state set player_packs_opened = player_packs_opened + 2 where set_key = b.set_key;
  v_seed := floor(random() * 2147483647)::bigint;
  v_dec := public.nexamon_battle_decide(v_ca, v_oa, v_seed);
  v_csum := (v_dec ->> 'challenger_cents')::bigint;
  v_osum := (v_dec ->> 'opponent_cents')::bigint;
  v_tie := v_dec ->> 'tie_break';
  v_win := case when v_dec ->> 'winner' = 'challenger' then b.challenger_id else b.opponent_id end;
  v_lose := case when v_win = b.challenger_id then b.opponent_id else b.challenger_id end;
  -- the winner takes every copy of both packs; listings cannot exist yet
  update public.nexamon_copies c set owner_id = v_win, acquired_at = v_now
   where c.id in (select (x ->> 'copy_id')::uuid from jsonb_array_elements(v_ca || v_oa) x) and c.owner_id = v_lose;
  if to_regprocedure('public.nexamon_bonus_recompute(uuid)') is not null then
    execute 'select public.nexamon_bonus_recompute($1)' using v_win;
    execute 'select public.nexamon_bonus_recompute($1)' using v_lose;
  end if;

  v_starts := v_now + public.nexamon_ms(coalesce((cfg #>> '{battles,startDelayMs}')::numeric, 3000));
  v_decide := v_starts + public.nexamon_ms(coalesce((cfg #>> '{battles,tearMs}')::numeric, 2400)
                                           + coalesce((cfg ->> 'packSize')::numeric, 5) * coalesce((cfg #>> '{battles,slotMs}')::numeric, 1800));
  update public.nexamon_battles
     set status = 'accepted', responded_at = v_now, accepted_at = v_now, starts_at = v_starts, decide_at = v_decide,
         ends_at = v_decide + public.nexamon_ms(coalesce((cfg #>> '{battles,outroMs}')::numeric, 8000)),
         challenger_cards = v_ca, opponent_cards = v_oa, challenger_cents = v_csum, opponent_cents = v_osum,
         winner_id = v_win, tie_break = v_tie, coin_seed = v_seed
   where id = b.id returning * into b;
  insert into public.nexamon_live (player_id, kind, battle_id, set_key, started_at, ends_at)
  values (b.challenger_id, 'battle', b.id, b.set_key, v_now, b.ends_at)
  on conflict (battle_id) do nothing;

  v_names := (select p.nickname from public.profiles p where p.id = b.challenger_id) || ' gegen '
             || (select p.nickname from public.profiles p where p.id = b.opponent_id);
  perform public.feed_post(v_win, 'nexamon_battle_won',
                           jsonb_build_object('set', b.set_key, 'other', (select p.nickname from public.profiles p where p.id = v_lose),
                                              'total_cents', v_csum + v_osum, 'cards', jsonb_array_length(v_ca) + jsonb_array_length(v_oa)),
                           'nexamon:battle:won:' || b.id::text);
  if v_csum + v_osum >= coalesce((cfg #>> '{battles,gossipMinCents}')::bigint, 500000) then
    perform public.feed_post(v_win, 'nexamon_battle_big',
                             jsonb_build_object('set', b.set_key, 'other', (select p.nickname from public.profiles p where p.id = v_lose),
                                                'total_cents', v_csum + v_osum),
                             'nexamon:battle:big:' || b.id::text);
  end if;
  perform public.social_notify(b.challenger_id, 'nexamon_battle', 'Pack Battle läuft', v_names || ': die Packs gehen auf!',
    jsonb_build_object('battle_id', b.id), '/nexamon?battle=' || b.id::text, 'nexamon:battle:accepted:' || b.id::text);
  return public.request_complete(v_player, p_request_id, jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now)));
end;
$$;
comment on function public.respond_nexamon_battle(uuid, uuid, boolean) is
  'RPC (ADR-172): the challenged friend accepts (both pay one pack, both packs open at once, the higher total value '
  'takes all copies) or declines a Pack Battle; returns {battle} (pulls only from the shared start). A challenger '
  'without the money any more ends it as aborted, nobody pays. Lobby battles (ADR-192) are joined, not answered. '
  'Errors nexamon_locked, invalid_argument, nexamon_battle_unknown, nexamon_battle_not_yours, nexamon_battle_closed, '
  'nexamon_battle_limit, insufficient_funds.';

-- ---------------------------------------------------------------------------
-- The battle as players and spectators see it (latest: 6310), now with packs and seats
-- ---------------------------------------------------------------------------
create or replace function public.nexamon_battle_json(b public.nexamon_battles, p_viewer uuid, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.nexamon_cfg();
  v_size  integer := coalesce((cfg ->> 'packSize')::integer, 5);
  v_lead  numeric := coalesce((cfg #>> '{battles,leadMs}')::numeric, 800);
  v_tear  numeric := coalesce((cfg #>> '{battles,tearMs}')::numeric, 2400);
  v_slot  numeric := coalesce((cfg #>> '{battles,slotMs}')::numeric, 1800);
  v_packs jsonb := coalesce(b.packs, jsonb_build_array(jsonb_build_object('set', b.set_key, 'price_cents', b.price_cents)));
  v_n     integer;
  v_known integer := 0;
  v_done  boolean := false;
  v_status text := b.status;
  v_ms    numeric;
  v_ca    jsonb := '[]'::jsonb;
  v_oa    jsonb := '[]'::jsonb;
  v_seats jsonb := '[]'::jsonb;
  v_my    integer;
  v_live  uuid;
begin
  v_n := jsonb_array_length(v_packs);
  if b.status = 'pending' and b.expires_at <= p_now then
    v_status := 'expired';
  end if;
  if b.status = 'accepted' then
    v_status := case when p_now >= b.ends_at then 'done' else 'running' end;
    if p_now >= b.starts_at then
      -- card idx (1-based over the lineup) of pack p shows at starts + p * tear + (idx - 1) * slot (multiRevealAt)
      v_ms := extract(epoch from (p_now - b.starts_at)) * 1000 + v_lead;
      select count(*)::integer into v_known from generate_series(1, v_n * v_size) g
       where ((g - 1) / v_size + 1) * v_tear + (g - 1) * v_slot <= v_ms;
    end if;
    v_done := p_now >= b.decide_at - public.nexamon_ms(v_lead);
  end if;
  if b.mode = 'multi' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'seat', s.seat, 'player', public.nexamon_figure_json(s.player_id), 'is_me', s.player_id = p_viewer,
             'cards', (select coalesce(jsonb_agg(x - 'copy_id' - 'is_new' - 'population' order by (x ->> 'idx')::integer), '[]'::jsonb)
                         from jsonb_array_elements(coalesce(s.cards, '[]'::jsonb)) x where (x ->> 'idx')::integer <= v_known))
             order by s.seat), '[]'::jsonb)
      into v_seats from public.nexamon_battle_seats s where s.battle_id = b.id;
    select s.seat into v_my from public.nexamon_battle_seats s where s.battle_id = b.id and s.player_id = p_viewer;
  else
    v_seats := jsonb_build_array(
      jsonb_build_object('seat', 0, 'player', public.nexamon_figure_json(b.challenger_id), 'is_me', b.challenger_id = p_viewer,
                         'cards', (select coalesce(jsonb_agg((x - 'copy_id' - 'is_new' - 'population') || jsonb_build_object('pack', 1, 'idx', (x ->> 'slot')::integer)
                                                             order by (x ->> 'slot')::integer), '[]'::jsonb)
                                     from jsonb_array_elements(coalesce(b.challenger_cards, '[]'::jsonb)) x where (x ->> 'slot')::integer <= v_known)),
      jsonb_build_object('seat', 1, 'player', public.nexamon_figure_json(b.opponent_id), 'is_me', b.opponent_id = p_viewer,
                         'cards', (select coalesce(jsonb_agg((x - 'copy_id' - 'is_new' - 'population') || jsonb_build_object('pack', 1, 'idx', (x ->> 'slot')::integer)
                                                             order by (x ->> 'slot')::integer), '[]'::jsonb)
                                     from jsonb_array_elements(coalesce(b.opponent_cards, '[]'::jsonb)) x where (x ->> 'slot')::integer <= v_known)));
    v_my := case when p_viewer = b.challenger_id then 0 when p_viewer = b.opponent_id then 1 end;
  end if;
  v_seats := (select coalesce(jsonb_agg(x || jsonb_build_object(
                                 'cents', (select coalesce(sum((c ->> 'value_cents')::bigint), 0) from jsonb_array_elements(x -> 'cards') c))
                               order by (x ->> 'seat')::integer), '[]'::jsonb)
                from jsonb_array_elements(v_seats) x);
  v_ca := coalesce((select x -> 'cards' from jsonb_array_elements(v_seats) x where (x ->> 'seat')::integer = 0), '[]'::jsonb);
  v_oa := coalesce((select x -> 'cards' from jsonb_array_elements(v_seats) x where (x ->> 'seat')::integer = 1), '[]'::jsonb);
  select l.id into v_live from public.nexamon_live l where l.battle_id = b.id;
  return jsonb_build_object(
    'id', b.id, 'set', b.set_key, 'status', v_status, 'price_cents', b.price_cents,
    'mode', b.mode, 'size', b.size, 'packs', v_packs, 'seats', v_seats, 'my_seat', v_my,
    'challenger', public.nexamon_figure_json(b.challenger_id), 'opponent', public.nexamon_figure_json(b.opponent_id),
    'me', case when v_my = 0 then 'challenger' when v_my = 1 then 'opponent' end,
    'created_at', b.created_at, 'expires_at', b.expires_at, 'accepted_at', b.accepted_at, 'starts_at', b.starts_at,
    'decide_at', b.decide_at, 'ends_at', b.ends_at, 'tear_ms', v_tear, 'slot_ms', v_slot,
    'challenger_cards', v_ca, 'opponent_cards', v_oa,
    'challenger_cents', coalesce((select sum((x ->> 'value_cents')::bigint) from jsonb_array_elements(v_ca) x), 0),
    'opponent_cents', coalesce((select sum((x ->> 'value_cents')::bigint) from jsonb_array_elements(v_oa) x), 0),
    'winner', case when v_done then case when b.winner_id = b.challenger_id then 'challenger'
                                         when b.winner_id = b.opponent_id then 'opponent' end end,
    'winner_seat', case when v_done then coalesce(b.winner_seat::integer,
                                                  case when b.winner_id = b.challenger_id then 0 when b.winner_id = b.opponent_id then 1 end) end,
    'tie_break', case when v_done then b.tie_break end,
    'coin_seed', case when v_done then b.coin_seed end,
    'abort_reason', b.abort_reason,
    'live_id', v_live,
    'viewers', case when v_live is null then 0 else public.nexamon_live_viewer_count(v_live, p_now) end,
    'reactions', case when v_live is null then '[]'::jsonb else public.nexamon_live_reactions_json(v_live, p_now) end,
    'server_time', p_now);
end;
$$;

-- Whether a player plays in a battle (classic sides or a seat)
create or replace function public.nexamon_battle_player(p_battle uuid, p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.nexamon_battles b where b.id = p_battle and p_player in (b.challenger_id, b.opponent_id))
      or exists (select 1 from public.nexamon_battle_seats s where s.battle_id = p_battle and s.player_id = p_player);
$$;

-- One live opening as the lobby lists it (latest: 6310), battles with all their players
create or replace function public.nexamon_live_row_json(l public.nexamon_live, p_viewer uuid, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', l.id, 'kind', l.kind, 'set', l.set_key, 'battle_id', l.battle_id,
                            'player', public.nexamon_figure_json(l.player_id),
                            'opponent', case when l.kind = 'battle'
                                          then public.nexamon_figure_json((select b.opponent_id from public.nexamon_battles b where b.id = l.battle_id)) end,
                            'players', case when l.kind = 'battle'
                                         then coalesce((select jsonb_agg(public.nexamon_figure_json(s.player_id) order by s.seat)
                                                          from public.nexamon_battle_seats s where s.battle_id = l.battle_id),
                                                       (select jsonb_build_array(public.nexamon_figure_json(b.challenger_id), public.nexamon_figure_json(b.opponent_id))
                                                          from public.nexamon_battles b where b.id = l.battle_id)) end,
                            'is_me', l.player_id = p_viewer or (l.kind = 'battle' and public.nexamon_battle_player(l.battle_id, p_viewer)),
                            'started_at', l.started_at, 'ends_at', l.ends_at,
                            'viewers', public.nexamon_live_viewer_count(l.id, p_now));
$$;

-- The Collectibles tab (latest: 6310): own battles via seats too, open lobbies of friends to join
create or replace function public.nexamon_lobby(p_allow_watch boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  v_player uuid;
  v_now    timestamptz := public.game_now();
  v_secs   integer := coalesce((cfg #>> '{presence,presenceSeconds}')::integer, 60);
  v_max    integer := coalesce((cfg #>> '{presence,maxPlayers}')::integer, 24);
  v_last   timestamptz;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  insert into public.nexamon_presence (player_id, seen_at, allow_watch)
  values (v_player, v_now, coalesce(p_allow_watch, true))
  on conflict (player_id) do update set seen_at = excluded.seen_at, allow_watch = excluded.allow_watch;
  -- open challenges and lobbies past their time are expired (lobbies refund); old live openings go
  perform public.nexamon_pack_battle_expire(v_now);
  update public.nexamon_battles set status = 'expired', responded_at = expires_at
   where status = 'pending' and expires_at <= v_now and v_player in (challenger_id, opponent_id);
  delete from public.nexamon_live where ends_at < v_now - interval '1 hour';
  select max(b.created_at) into v_last from public.nexamon_battles b where b.challenger_id = v_player;
  return jsonb_build_object(
    'players', coalesce((
      select jsonb_agg(public.nexamon_figure_json(p.id) || jsonb_build_object(
                         'is_friend', true,
                         'opening', exists (select 1 from public.nexamon_live l where l.player_id = p.id and l.kind = 'pack' and l.ends_at > v_now),
                         'battling', public.nexamon_battle_busy(p.id, v_now))
                       order by x.seen_at desc, p.id)
        from (select y.player_id, y.seen_at from public.nexamon_presence y
                join public.friendships f on f.status = 'accepted'
                 and ((f.requester_id = v_player and f.addressee_id = y.player_id) or (f.addressee_id = v_player and f.requester_id = y.player_id))
               where y.seen_at > v_now - make_interval(secs => v_secs) and y.player_id <> v_player
               order by y.seen_at desc limit v_max) x
        join public.profiles p on p.id = x.player_id and not p.is_deactivated), '[]'::jsonb),
    'live', coalesce((
      select jsonb_agg(public.nexamon_live_row_json(l, v_player, v_now) order by l.started_at desc)
        from (select * from public.nexamon_live z where z.ends_at > v_now and z.started_at <= v_now
               order by z.started_at desc limit coalesce((cfg #>> '{live,maxSessions}')::integer, 12)) l), '[]'::jsonb),
    'battles', coalesce((
      select jsonb_agg(public.nexamon_battle_json(b, v_player, v_now) order by b.created_at desc)
        from public.nexamon_battles b
       where public.nexamon_battle_player(b.id, v_player)
         and ((b.status = 'pending' and b.expires_at > v_now) or (b.status = 'accepted' and b.ends_at > v_now))), '[]'::jsonb),
    'open_battles', coalesce((
      select jsonb_agg(public.nexamon_battle_json(b, v_player, v_now)
                       || jsonb_build_object('invited', exists (select 1 from public.nexamon_battle_invites i
                                                                 where i.battle_id = b.id and i.player_id = v_player))
                       order by b.created_at desc)
        from public.nexamon_battles b
        join public.friendships f on f.status = 'accepted'
         and ((f.requester_id = v_player and f.addressee_id = b.challenger_id) or (f.addressee_id = v_player and f.requester_id = b.challenger_id))
       where b.mode = 'multi' and b.status = 'pending' and b.expires_at > v_now
         and not public.nexamon_battle_player(b.id, v_player)
         and (select count(*) from public.nexamon_battle_seats s where s.battle_id = b.id) < b.size), '[]'::jsonb),
    'limits', jsonb_build_object(
      'per_hour', coalesce((cfg #>> '{battles,perHour}')::integer, 6),
      'used', public.nexamon_battles_last_hour(v_player, v_now),
      'cooldown_until', case when v_last is not null
                               and v_last + make_interval(secs => coalesce((cfg #>> '{battles,cooldownSeconds}')::integer, 20)) > v_now
                             then v_last + make_interval(secs => coalesce((cfg #>> '{battles,cooldownSeconds}')::integer, 20)) end),
    'allow_watch', coalesce(p_allow_watch, true),
    'server_time', v_now);
end;
$$;
comment on function public.nexamon_lobby(boolean) is
  'RPC (presence, ADR-172/192): marks the caller as on the Collectibles tab and returns {players: friends on the tab as '
  'figures with opening/battling, live: running live openings, battles: own open and running Pack Battles (as '
  'challenger, opponent or seat), open_battles: friends'' lobbies with a free seat (invited flag), limits, '
  'allow_watch, server_time}; errors nexamon_locked.';

-- A battle for its players, spectators and (open lobbies) friends of the creator (latest: 6320)
create or replace function public.get_nexamon_battle(p_battle_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_now    timestamptz := public.game_now();
  b        public.nexamon_battles;
  l        public.nexamon_live;
begin
  v_player := public.require_player();
  perform public.nexamon_require_unlock(v_player);
  select * into b from public.nexamon_battles x where x.id = p_battle_id;
  if b.id is null then
    perform public.api_error('nexamon_battle_unknown');
  end if;
  if b.mode = 'multi' and b.status = 'pending' and b.expires_at <= v_now then
    update public.nexamon_battles set status = 'expired', responded_at = expires_at where id = b.id returning * into b;
  end if;
  if not public.nexamon_battle_player(b.id, v_player) then
    select * into l from public.nexamon_live x where x.battle_id = b.id;
    if l.id is null then
      -- an open lobby: friends of the creator may look before they join
      if not (b.mode = 'multi' and b.status = 'pending'
              and exists (select 1 from public.friendships f
                           where f.status = 'accepted'
                             and ((f.requester_id = v_player and f.addressee_id = b.challenger_id)
                                  or (f.requester_id = b.challenger_id and f.addressee_id = v_player)))) then
        perform public.api_error('nexamon_battle_unknown');
      end if;
    elsif l.ends_at > v_now then
      insert into public.nexamon_live_viewers (live_id, player_id, seen_at) values (l.id, v_player, v_now)
      on conflict (live_id, player_id) do update set seen_at = excluded.seen_at;
    end if;
  end if;
  return jsonb_build_object('battle', public.nexamon_battle_json(b, v_player, v_now));
end;
$$;
comment on function public.get_nexamon_battle(uuid) is
  'RPC (ADR-172/192): a Pack Battle for its players, spectators (counted as viewers) and, while a lobby is open, the '
  'creator''s friends: the pulls card by card from the shared start, totals, the winner from decide_at; returns '
  '{battle}. Errors nexamon_locked, nexamon_battle_unknown.';

do $do$
declare
  f text;
begin
  foreach f in array array['public.create_nexamon_pack_battle(uuid, text[], integer, text[])',
                           'public.join_nexamon_pack_battle(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.nexamon_pack_battle_decide(jsonb, bigint)',
                           'public.nexamon_pack_battle_refund(uuid, timestamptz)', 'public.nexamon_battles_refund()',
                           'public.nexamon_pack_battle_expire(timestamptz)',
                           'public.nexamon_pack_battle_pull(public.nexamon_battles, uuid, text, integer, timestamptz)',
                           'public.nexamon_pack_battle_start(uuid, timestamptz)', 'public.nexamon_battle_player(uuid, uuid)',
                           'public.nexamon_battle_busy(uuid, timestamptz)', 'public.nexamon_battles_last_hour(uuid, timestamptz)',
                           'public.nexamon_battle_json(public.nexamon_battles, uuid, timestamptz)',
                           'public.nexamon_live_row_json(public.nexamon_live, uuid, timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'nexa-nexamon-pack-battles';
    perform cron.schedule('nexa-nexamon-pack-battles', '* * * * *', 'select public.nexamon_pack_battle_expire()');
  end if;
end;
$do$;
