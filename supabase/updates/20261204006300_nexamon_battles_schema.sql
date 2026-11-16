-- ===== idempotent copy of migrations/20261204006300_nexamon_battles_schema.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 6300 · Nexamon Pack Battles and live openings: error keys, notifications, tables (ADR-172)
-- =============================================================================
-- Rules: game_config.nexamon.presence, .battles, .live (src/config/nexamon-rules.ts; src/lib/sim/nexamon-battle.ts).
-- Tables (internal, RLS on, no grants: read and written only by the functions of 6310 and 6320):
--   nexamon_presence        who is on the Collectibles tab (seen_at) and whether others may watch their packs
--   nexamon_battles         one Pack Battle: challenge, accept, both pulls, totals, winner, tie-break, coin seed
--   nexamon_live            a live opening (a bought pack or a battle) while it is revealed
--   nexamon_live_viewers    who watches a live opening (seen_at)
--   nexamon_live_reactions  emoji bursts of the spectators
-- Errors: nexamon_battle_unknown NX240, nexamon_battle_not_friend NX241, nexamon_battle_not_here NX242,
--   nexamon_battle_busy NX243, nexamon_battle_limit NX244, nexamon_battle_cooldown NX245, nexamon_battle_closed NX246,
--   nexamon_battle_self NX247, nexamon_battle_opponent_locked NX248, nexamon_live_unknown NX249,
--   nexamon_battle_not_yours NX250.
-- Idempotent: runs unchanged as supabase/updates/20261204006300_nexamon_battles_schema.sql.

do $do$
declare
  v_def    text := pg_get_functiondef('public.api_error(text)'::regprocedure);
  v_anchor text := $q$    when 'nexamon_grading_limit'      then 'NX175'
$q$;
begin
  if position('''nexamon_battle_not_yours''' in v_def) = 0 then
    if position(v_anchor in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the Pack Battle error keys (ADR-172) by hand';
    end if;
    v_def := replace(v_def, v_anchor, v_anchor || $q$    when 'nexamon_battle_unknown'     then 'NX240'
    when 'nexamon_battle_not_friend'  then 'NX241'
    when 'nexamon_battle_not_here'    then 'NX242'
    when 'nexamon_battle_busy'        then 'NX243'
    when 'nexamon_battle_limit'       then 'NX244'
    when 'nexamon_battle_cooldown'    then 'NX245'
    when 'nexamon_battle_closed'      then 'NX246'
    when 'nexamon_battle_self'        then 'NX247'
    when 'nexamon_battle_opponent_locked' then 'NX248'
    when 'nexamon_live_unknown'       then 'NX249'
    when 'nexamon_battle_not_yours'   then 'NX250'
$q$);
    execute v_def;
  end if;
end;
$do$;

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('nexamon_battle', 'social', 'Pack Battle', 'Ein Freund fordert dich zum Pack Battle heraus, oder ein Battle ist entschieden.',
        'notif_bell', true, true, false, 301)
on conflict (key) do nothing;

create table if not exists public.nexamon_presence (
  player_id   uuid primary key references public.profiles (id) on delete cascade,
  seen_at     timestamptz not null default now(),
  allow_watch boolean not null default true
);
create index if not exists nexamon_presence_seen_idx on public.nexamon_presence (seen_at desc);
alter table public.nexamon_presence enable row level security;
revoke all on public.nexamon_presence from public, anon, authenticated;
grant all on public.nexamon_presence to service_role;
comment on table public.nexamon_presence is
  'Who is on the Collectibles tab (ADR-172): seen_at of the last nexamon_lobby() call, allow_watch = others may watch '
  'the player''s packs live (setting "Andere dürfen beim Öffnen zuschauen"). Internal.';

create table if not exists public.nexamon_battles (
  id                uuid primary key default gen_random_uuid(),
  challenger_id     uuid not null references public.profiles (id) on delete cascade,
  opponent_id       uuid not null references public.profiles (id) on delete cascade,
  set_key           text not null,
  status            text not null default 'pending'
                      check (status in ('pending', 'declined', 'expired', 'cancelled', 'aborted', 'accepted')),
  price_cents       bigint not null check (price_cents >= 0),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  responded_at      timestamptz,
  accepted_at       timestamptz,
  starts_at         timestamptz,
  decide_at         timestamptz,
  ends_at           timestamptz,
  challenger_cards  jsonb,
  opponent_cards    jsonb,
  challenger_cents  bigint,
  opponent_cents    bigint,
  winner_id         uuid references public.profiles (id) on delete set null,
  tie_break         text check (tie_break is null or tie_break in ('value', 'rarest', 'coin')),
  coin_seed         bigint,
  abort_reason      text,
  constraint nexamon_battles_two check (challenger_id <> opponent_id)
);
create index if not exists nexamon_battles_challenger_idx on public.nexamon_battles (challenger_id, created_at desc);
create index if not exists nexamon_battles_opponent_idx on public.nexamon_battles (opponent_id, created_at desc);
create index if not exists nexamon_battles_winner_idx on public.nexamon_battles (winner_id) where winner_id is not null;
create index if not exists nexamon_battles_open_idx on public.nexamon_battles (status, expires_at) where status = 'pending';
alter table public.nexamon_battles enable row level security;
revoke all on public.nexamon_battles from public, anon, authenticated;
grant all on public.nexamon_battles to service_role;
comment on table public.nexamon_battles is
  'Pack Battles (ADR-172): both players pay one pack of set_key at the accept, both packs are opened at once, the '
  'higher total value at pull time (tie: rarest card, then coin_seed % 2 = 0 for the challenger) takes all copies. '
  'The pulls are shown slot by slot from starts_at; nobody reads them earlier (get_nexamon_battle). Internal.';

create table if not exists public.nexamon_live (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('pack', 'battle')),
  pack_id     uuid unique,
  battle_id   uuid unique references public.nexamon_battles (id) on delete cascade,
  set_key     text not null,
  cards       jsonb,
  started_at  timestamptz not null,
  ends_at     timestamptz not null,
  progress    smallint not null default 0 check (progress between 0 and 10),
  progress_at timestamptz
);
create index if not exists nexamon_live_ends_idx on public.nexamon_live (ends_at desc);
create index if not exists nexamon_live_player_idx on public.nexamon_live (player_id, ends_at desc);
alter table public.nexamon_live enable row level security;
revoke all on public.nexamon_live from public, anon, authenticated;
grant all on public.nexamon_live to service_role;
comment on table public.nexamon_live is
  'Live openings (ADR-172): a bought pack (kind pack, the pulls in cards, progress = cards the opener has seen) or a '
  'Pack Battle (kind battle) while it is revealed. Spectators see only what the opener has seen. Internal.';

create table if not exists public.nexamon_live_viewers (
  live_id   uuid not null references public.nexamon_live (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (live_id, player_id)
);
create index if not exists nexamon_live_viewers_player_idx on public.nexamon_live_viewers (player_id);
alter table public.nexamon_live_viewers enable row level security;
revoke all on public.nexamon_live_viewers from public, anon, authenticated;
grant all on public.nexamon_live_viewers to service_role;
comment on table public.nexamon_live_viewers is 'Spectators of a live opening (ADR-172), seen_at of their last look. Internal.';

create table if not exists public.nexamon_live_reactions (
  id        bigserial primary key,
  live_id   uuid not null references public.nexamon_live (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  emoji     text not null check (char_length(emoji) between 1 and 8),
  at        timestamptz not null default now()
);
create index if not exists nexamon_live_reactions_live_idx on public.nexamon_live_reactions (live_id, id desc);
create index if not exists nexamon_live_reactions_player_idx on public.nexamon_live_reactions (player_id, at desc);
alter table public.nexamon_live_reactions enable row level security;
revoke all on public.nexamon_live_reactions from public, anon, authenticated;
grant all on public.nexamon_live_reactions to service_role;
comment on table public.nexamon_live_reactions is 'Emoji bursts of spectators of a live opening (ADR-172). Internal.';
