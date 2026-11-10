-- =============================================================================
-- NEXA · 0400 · Players, invite codes, progression, rewards, lifestyle
-- =============================================================================
-- Visibility rule: a table is either fully public-safe (profiles), owner-only
-- (player_private, player_settings, ...) or internal. Columns with different
-- visibility never share a table.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Invite codes (ADR-010)
-- ---------------------------------------------------------------------------
create table public.invite_codes (
  code       text primary key check (code = upper(code) and length(code) between 4 and 40),
  max_uses   integer not null default 1 check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  is_active  boolean not null default true,
  expires_at timestamptz,
  note       text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (used_count <= max_uses)
);
alter table public.invite_codes enable row level security;
create index invite_codes_created_by_idx on public.invite_codes (created_by);
comment on table public.invite_codes is 'Closed-alpha invite codes. Internal; consumed by handle_new_user().';

-- ---------------------------------------------------------------------------
-- Profiles: PUBLIC player card. Only columns every player may see.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  nickname        text not null check (nickname ~ '^[A-Za-z0-9_]{3,20}$'),
  level           integer not null default 1 check (level between 1 and 50),
  xp_total        bigint not null default 0 check (xp_total >= 0),
  reputation      smallint not null default 50 check (reputation between 0 and 100),
  title_key       text,
  frame_key       text,
  avatar          jsonb not null default '{}'::jsonb,
  accent_color    text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  bankrupt_until  timestamptz,
  is_deactivated  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.profiles enable row level security;
create unique index profiles_nickname_lower_uq on public.profiles (lower(nickname));
create index profiles_level_idx on public.profiles (level desc, xp_total desc);
comment on table public.profiles is 'Public player card (nickname, level, reputation, cosmetics). Contains no private data by design.';
comment on column public.profiles.bankrupt_until is 'Visible "Pleitegeier" malus after a player bankruptcy.';

-- Ledger owner FK now that profiles exists.
alter table public.ledger_accounts
  add constraint ledger_accounts_owner_player_fk foreign key (owner_player_id) references public.profiles (id) on delete restrict;
alter table public.ledger_transactions
  add constraint ledger_transactions_initiated_by_fk foreign key (initiated_by) references public.profiles (id) on delete set null;

create table public.invite_code_redemptions (
  id          bigint generated always as identity primary key,
  code        text not null references public.invite_codes (code),
  player_id   uuid not null unique references public.profiles (id) on delete cascade,
  redeemed_at timestamptz not null default now()
);
alter table public.invite_code_redemptions enable row level security;
create index invite_code_redemptions_code_idx on public.invite_code_redemptions (code);
comment on table public.invite_code_redemptions is 'Which player used which invite code. Internal.';

-- Owner-only player state.
create table public.player_private (
  player_id                   uuid primary key references public.profiles (id) on delete cascade,
  age_confirmed_at            timestamptz,
  founding_ban_until          timestamptz,
  bankruptcy_count            integer not null default 0,
  career_experience_minutes   bigint not null default 0,
  playtime_seconds            bigint not null default 0,
  last_seen_at                timestamptz,
  ipo_investment_limit_cents  bigint,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
alter table public.player_private enable row level security;
comment on table public.player_private is 'Private per-player state (bans, experience, playtime). Owner read only; written by RPCs.';
comment on column public.player_private.ipo_investment_limit_cents is 'Cap for new accounts investing in player IPOs (abuse protection); NULL = config default.';

-- UI settings: one of the few tables a client may update directly.
create table public.player_settings (
  player_id            uuid primary key references public.profiles (id) on delete cascade,
  theme                public.ui_theme not null default 'dark',
  chart_style          public.chart_style not null default 'candles',
  locale               text not null default 'de' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  sounds_enabled       boolean not null default true,
  animations_enabled   boolean not null default true,
  haptics_enabled      boolean not null default true,
  portfolio_visibility public.portfolio_visibility not null default 'friends',
  show_playtime        boolean not null default false,
  hold_to_confirm      boolean not null default true,
  ui_state             jsonb not null default '{}'::jsonb check (pg_column_size(ui_state) < 8192),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.player_settings enable row level security;
comment on table public.player_settings is 'UI and privacy preferences. Owner may read and UPDATE directly (harmless, no game effect).';

-- ---------------------------------------------------------------------------
-- Levels and unlocks
-- ---------------------------------------------------------------------------
create table public.levels (
  level          integer primary key check (level between 1 and 50),
  xp_to_next     bigint,
  xp_cumulative  bigint not null,
  created_at     timestamptz not null default now()
);
alter table public.levels enable row level security;
comment on table public.levels is 'XP curve: xp_to_next = round(100 * level^1.5); xp_cumulative = XP needed to reach the level.';

create table public.unlocks (
  key         text primary key,
  level       integer not null references public.levels (level),
  title       text not null,
  description text not null,
  icon_key    text not null,
  intro_mission_key text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.unlocks enable row level security;
create index unlocks_level_idx on public.unlocks (level);
comment on table public.unlocks is 'Feature unlocks per level (spec 9.3). key is checked server side via has_unlock().';

create table public.player_unlocks (
  player_id   uuid not null references public.profiles (id) on delete cascade,
  unlock_key  text not null references public.unlocks (key) on delete cascade,
  unlocked_at timestamptz not null default now(),
  seen_at     timestamptz,
  primary key (player_id, unlock_key)
);
alter table public.player_unlocks enable row level security;
create index player_unlocks_unlock_key_idx on public.player_unlocks (unlock_key);
comment on table public.player_unlocks is 'Unlocked features per player. seen_at (overlay shown) may be set by the client.';

-- ---------------------------------------------------------------------------
-- XP
-- ---------------------------------------------------------------------------
create table public.xp_events (
  id          bigint generated always as identity primary key,
  player_id   uuid not null references public.profiles (id) on delete cascade,
  source      public.xp_source not null,
  amount      integer not null check (amount > 0),
  multiplier_bps integer not null default 10000,
  ref_type    text,
  ref_id      uuid,
  dedupe_key  text,
  game_day    date not null,
  level_after integer,
  created_at  timestamptz not null default now(),
  unique (player_id, dedupe_key)
);
alter table public.xp_events enable row level security;
create index xp_events_player_created_idx on public.xp_events (player_id, created_at desc);
create index xp_events_player_day_source_idx on public.xp_events (player_id, game_day, source);
comment on table public.xp_events is 'Append-only XP journal. profiles.xp_total/level are caches of this table.';

create table public.xp_daily_counters (
  player_id   uuid not null references public.profiles (id) on delete cascade,
  game_day    date not null,
  source      public.xp_source not null,
  event_count integer not null default 0,
  xp_sum      bigint not null default 0,
  units       bigint not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (player_id, game_day, source)
);
alter table public.xp_daily_counters enable row level security;
comment on table public.xp_daily_counters is 'Daily caps per XP source (30 trades, 12 work hours, 3 missions ...). units = source specific counter (e.g. paid minutes).';

-- ---------------------------------------------------------------------------
-- Basic income vault
-- ---------------------------------------------------------------------------
create table public.vaults (
  player_id            uuid primary key references public.profiles (id) on delete cascade,
  accrual_started_at   timestamptz not null default now(),
  last_claimed_at      timestamptz,
  total_claimed_cents  bigint not null default 0 check (total_claimed_cents >= 0),
  full_notified_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table public.vaults enable row level security;
comment on table public.vaults is 'Basic income vault. Content is derived: min(now - accrual_started_at, capacity) * hourly rate (config).';

create table public.vault_claims (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.profiles (id) on delete cascade,
  request_id            uuid not null,
  amount_cents          bigint not null check (amount_cents >= 0),
  accrued_seconds       integer not null check (accrued_seconds >= 0),
  forfeited_seconds     integer not null default 0 check (forfeited_seconds >= 0),
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now(),
  unique (player_id, request_id)
);
alter table public.vault_claims enable row level security;
create index vault_claims_player_created_idx on public.vault_claims (player_id, created_at desc);
create index vault_claims_ledger_tx_idx on public.vault_claims (ledger_transaction_id);
comment on table public.vault_claims is 'History of vault claims (idempotent via request_id).';

-- ---------------------------------------------------------------------------
-- Login streaks
-- ---------------------------------------------------------------------------
create table public.login_streaks (
  player_id        uuid primary key references public.profiles (id) on delete cascade,
  current_streak   integer not null default 0 check (current_streak >= 0),
  longest_streak   integer not null default 0 check (longest_streak >= 0),
  last_login_day   date,
  freeze_tokens    smallint not null default 1 check (freeze_tokens >= 0),
  freeze_granted_week date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.login_streaks enable row level security;
comment on table public.login_streaks is 'Daily login streak with one streak freeze per week.';

create table public.daily_logins (
  player_id   uuid not null references public.profiles (id) on delete cascade,
  login_day   date not null,
  streak_day  integer not null,
  xp_awarded  integer not null default 0,
  freeze_used boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (player_id, login_day)
);
alter table public.daily_logins enable row level security;
comment on table public.daily_logins is 'One row per player and calendar day (Europe/Berlin) with the streak reward.';

-- ---------------------------------------------------------------------------
-- Missions
-- ---------------------------------------------------------------------------
create table public.mission_templates (
  key          text primary key,
  kind         public.mission_kind not null,
  title        text not null,
  description  text not null,
  icon_key     text not null,
  metric       text not null,
  target_min   bigint not null check (target_min > 0),
  target_max   bigint not null,
  xp_min       integer not null check (xp_min >= 0),
  xp_max       integer not null,
  reward_cents bigint not null default 0 check (reward_cents >= 0),
  min_level    integer not null default 1,
  required_unlock_key text references public.unlocks (key),
  weight       integer not null default 100 check (weight >= 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (target_max >= target_min),
  check (xp_max >= xp_min)
);
alter table public.mission_templates enable row level security;
create index mission_templates_unlock_idx on public.mission_templates (required_unlock_key);
comment on table public.mission_templates is 'Templates for daily missions, weekly challenges and unlock intro missions. metric = counter key evaluated by the server.';

alter table public.unlocks
  add constraint unlocks_intro_mission_fk foreign key (intro_mission_key) references public.mission_templates (key) on delete set null;
create index unlocks_intro_mission_idx on public.unlocks (intro_mission_key);

create table public.player_missions (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles (id) on delete cascade,
  template_key  text not null references public.mission_templates (key),
  kind          public.mission_kind not null,
  period_start  date not null,
  target        bigint not null check (target > 0),
  progress      bigint not null default 0 check (progress >= 0),
  xp_reward     integer not null default 0,
  reward_cents  bigint not null default 0,
  status        public.mission_status not null default 'active',
  expires_at    timestamptz,
  completed_at  timestamptz,
  claimed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (player_id, template_key, period_start)
);
alter table public.player_missions enable row level security;
create index player_missions_player_status_idx on public.player_missions (player_id, status, period_start desc);
create index player_missions_template_idx on public.player_missions (template_key);
comment on table public.player_missions is 'Mission instances per player and period (3 dailies per day, 1 weekly challenge, intro missions).';

-- ---------------------------------------------------------------------------
-- Achievements
-- ---------------------------------------------------------------------------
create table public.achievements (
  key         text primary key,
  title       text not null,
  description text not null,
  icon_key    text not null check (icon_key ~ '^[a-z0-9_]+$'),
  category    text not null,
  metric      text,
  threshold   bigint,
  xp_reward   integer not null check (xp_reward between 100 and 10000),
  is_hidden   boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.achievements enable row level security;
comment on table public.achievements is 'Achievement catalogue. icon_key references a pixel icon component (no emoji).';

create table public.player_achievements (
  player_id       uuid not null references public.profiles (id) on delete cascade,
  achievement_key text not null references public.achievements (key) on delete cascade,
  progress        bigint not null default 0,
  unlocked_at     timestamptz,
  seen_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (player_id, achievement_key)
);
alter table public.player_achievements enable row level security;
create index player_achievements_key_idx on public.player_achievements (achievement_key);
create index player_achievements_unlocked_idx on public.player_achievements (player_id, unlocked_at desc) where unlocked_at is not null;
comment on table public.player_achievements is 'Progress and unlock state. Unlocked rows are public, progress rows owner-only.';

-- ---------------------------------------------------------------------------
-- Cosmetics (avatar parts, frames, titles) - never purchasable with money.
-- ---------------------------------------------------------------------------
create table public.cosmetic_items (
  key             text primary key,
  kind            public.cosmetic_kind not null,
  slot            text,
  title           text not null,
  icon_key        text not null,
  unlock_level    integer references public.levels (level),
  unlock_achievement_key text references public.achievements (key),
  is_default      boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);
alter table public.cosmetic_items enable row level security;
create index cosmetic_items_level_idx on public.cosmetic_items (unlock_level);
create index cosmetic_items_achievement_idx on public.cosmetic_items (unlock_achievement_key);
comment on table public.cosmetic_items is 'Catalogue of avatar parts, profile frames and titles (unlocked by level, achievements or league).';

create table public.player_cosmetics (
  player_id    uuid not null references public.profiles (id) on delete cascade,
  cosmetic_key text not null references public.cosmetic_items (key) on delete cascade,
  source       text not null default 'level',
  granted_at   timestamptz not null default now(),
  expires_at   timestamptz,
  primary key (player_id, cosmetic_key)
);
alter table public.player_cosmetics enable row level security;
create index player_cosmetics_key_idx on public.player_cosmetics (cosmetic_key);
comment on table public.player_cosmetics is 'Cosmetics a player owns. Equipping happens via RPC (writes profiles.avatar/title_key/frame_key).';

-- ---------------------------------------------------------------------------
-- Lifestyle (status symbols with upkeep)
-- ---------------------------------------------------------------------------
create table public.lifestyle_items (
  key                      text primary key,
  title                    text not null,
  description              text not null,
  icon_key                 text not null,
  price_cents              bigint not null check (price_cents > 0),
  upkeep_cents_per_quarter bigint not null check (upkeep_cents_per_quarter >= 0),
  resale_bps               integer not null default 6000 check (resale_bps between 0 and 10000),
  reputation_bonus         smallint not null default 0,
  min_level                integer not null default 1,
  sort_order               integer not null default 0,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
alter table public.lifestyle_items enable row level security;
comment on table public.lifestyle_items is 'Purchasable status symbols (money sink) with quarterly upkeep and optional small boni.';

create table public.player_lifestyle_items (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.profiles (id) on delete cascade,
  item_key              text not null references public.lifestyle_items (key),
  request_id            uuid not null,
  status                public.lifestyle_status not null default 'owned',
  purchase_price_cents  bigint not null,
  purchased_at          timestamptz not null default now(),
  last_upkeep_quarter_id bigint references public.game_quarters (id),
  missed_upkeep_count   smallint not null default 0,
  sold_at               timestamptz,
  sale_price_cents      bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (player_id, request_id)
);
alter table public.player_lifestyle_items enable row level security;
create unique index player_lifestyle_items_owned_uq on public.player_lifestyle_items (player_id, item_key) where status = 'owned';
create index player_lifestyle_items_item_idx on public.player_lifestyle_items (item_key);
create index player_lifestyle_items_quarter_idx on public.player_lifestyle_items (last_upkeep_quarter_id);
comment on table public.player_lifestyle_items is 'Owned status symbols; shown publicly on the profile.';

-- ---------------------------------------------------------------------------
-- Random events (free, never purchasable)
-- ---------------------------------------------------------------------------
create table public.random_event_definitions (
  key            text primary key,
  title          text not null,
  description    text not null,
  icon_key       text not null,
  effect         public.random_event_effect not null,
  params         jsonb not null default '{}'::jsonb,
  weight         integer not null default 100 check (weight >= 0),
  min_level      integer not null default 1,
  cooldown_hours integer not null default 24 check (cooldown_hours >= 0),
  requires_choice boolean not null default false,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.random_event_definitions enable row level security;
comment on table public.random_event_definitions is 'Definitions of personal random events (inheritance, tax audit ...). Internal: params contain hidden odds.';

create table public.player_random_events (
  id                    uuid primary key default gen_random_uuid(),
  player_id             uuid not null references public.profiles (id) on delete cascade,
  definition_key        text not null references public.random_event_definitions (key),
  title                 text not null,
  body                  text not null,
  payload               jsonb not null default '{}'::jsonb,
  status                public.random_event_status not null default 'pending',
  amount_cents          bigint,
  occurred_at           timestamptz not null default now(),
  expires_at            timestamptz,
  resolved_at           timestamptz,
  outcome               jsonb,
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.player_random_events enable row level security;
create index player_random_events_player_idx on public.player_random_events (player_id, occurred_at desc);
create index player_random_events_definition_idx on public.player_random_events (definition_key);
create index player_random_events_ledger_tx_idx on public.player_random_events (ledger_transaction_id);
comment on table public.player_random_events is 'Random events that happened to a player. payload holds only what the player may see.';

-- ---------------------------------------------------------------------------
-- Player bankruptcies
-- ---------------------------------------------------------------------------
create table public.player_bankruptcies (
  id                     uuid primary key default gen_random_uuid(),
  player_id              uuid not null references public.profiles (id) on delete cascade,
  net_worth_before_cents bigint not null,
  restart_capital_cents  bigint not null,
  reputation_delta       smallint not null default 0,
  malus_until            timestamptz,
  ledger_transaction_id  uuid references public.ledger_transactions (id),
  created_at             timestamptz not null default now()
);
alter table public.player_bankruptcies enable row level security;
create index player_bankruptcies_player_idx on public.player_bankruptcies (player_id, created_at desc);
create index player_bankruptcies_ledger_tx_idx on public.player_bankruptcies (ledger_transaction_id);
comment on table public.player_bankruptcies is 'Bankruptcy history: restart capital and visible malus period.';
