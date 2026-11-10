-- =============================================================================
-- NEXA · 1100 · Scheduled events (countdowns), macro events, news
-- =============================================================================

create table public.scheduled_events (
  id              uuid primary key default gen_random_uuid(),
  kind            public.scheduled_event_kind not null,
  status          public.scheduled_event_status not null default 'scheduled',
  title           text not null,
  description     text,
  importance      smallint not null default 1 check (importance between 1 and 3),
  company_id      uuid references public.companies (id) on delete cascade,
  security_id     uuid references public.securities (id) on delete cascade,
  sector_key      text references public.sectors (key),
  game_quarter_id bigint references public.game_quarters (id),
  dedupe_key      text unique,
  announced_at    timestamptz not null default now(),
  scheduled_at    timestamptz not null,
  resolved_at     timestamptz,
  outcome         jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.scheduled_events enable row level security;
create index scheduled_events_upcoming_idx on public.scheduled_events (scheduled_at) where status = 'scheduled';
create index scheduled_events_company_idx on public.scheduled_events (company_id, scheduled_at desc);
create index scheduled_events_security_idx on public.scheduled_events (security_id, scheduled_at desc);
create index scheduled_events_sector_idx on public.scheduled_events (sector_key);
create index scheduled_events_quarter_idx on public.scheduled_events (game_quarter_id);
comment on table public.scheduled_events is 'Announced events with countdown: rate decision, earnings, pharma trial, oil report, bells, IPO pricing ... outcome is filled on resolution.';

-- Pre-drawn hidden parameters (e.g. success probability of a pharma trial).
create table public.scheduled_event_secrets (
  event_id   uuid primary key references public.scheduled_events (id) on delete cascade,
  params     jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.scheduled_event_secrets enable row level security;
comment on table public.scheduled_event_secrets is 'Hidden parameters of scheduled events. Internal.';

create table public.macro_event_definitions (
  key               text primary key,
  kind              public.macro_event_kind not null,
  title             text not null,
  description       text not null,
  icon_key          text not null,
  effects           jsonb not null default '{}'::jsonb,
  weight            integer not null default 100 check (weight >= 0),
  duration_quarters smallint not null default 1 check (duration_quarters > 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.macro_event_definitions enable row level security;
comment on table public.macro_event_definitions is 'Random macro events (sector crisis, commodity shock, recession, tech boom) with hidden effect sizes. Internal.';

create table public.macro_events (
  id               uuid primary key default gen_random_uuid(),
  definition_key   text not null references public.macro_event_definitions (key),
  kind             public.macro_event_kind not null,
  status           public.macro_event_status not null default 'active',
  title            text not null,
  description      text,
  sector_key       text references public.sectors (key),
  started_quarter_id bigint references public.game_quarters (id),
  started_at       timestamptz not null default now(),
  ends_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.macro_events enable row level security;
create index macro_events_status_idx on public.macro_events (status, started_at desc);
create index macro_events_definition_idx on public.macro_events (definition_key);
create index macro_events_sector_idx on public.macro_events (sector_key);
create index macro_events_quarter_idx on public.macro_events (started_quarter_id);
comment on table public.macro_events is 'Macro events that are or were active (public headline; the numeric effect stays in the definition).';

create table public.news_templates (
  key               text primary key,
  category          public.news_category not null,
  headline_template text not null,
  body_template     text,
  sentiment         double precision not null default 0 check (sentiment between -1 and 1),
  importance        smallint not null default 1 check (importance between 1 and 3),
  locale            text not null default 'de',
  weight            integer not null default 100 check (weight >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.news_templates enable row level security;
comment on table public.news_templates is 'Text templates with {variables}; news is generated from simulation results. Internal (sentiment weights).';

create table public.news_items (
  id              bigint generated always as identity primary key,
  category        public.news_category not null,
  headline        text not null,
  body            text,
  importance      smallint not null default 1 check (importance between 1 and 3),
  company_id      uuid references public.companies (id) on delete cascade,
  security_id     uuid references public.securities (id) on delete cascade,
  sector_key      text references public.sectors (key),
  event_id        uuid references public.scheduled_events (id) on delete set null,
  macro_event_id  uuid references public.macro_events (id) on delete set null,
  actor_player_id uuid references public.profiles (id) on delete set null,
  template_key    text references public.news_templates (key) on delete set null,
  game_quarter_id bigint references public.game_quarters (id),
  published_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
alter table public.news_items enable row level security;
create index news_items_published_idx on public.news_items (published_at desc);
create index news_items_security_idx on public.news_items (security_id, published_at desc);
create index news_items_company_idx on public.news_items (company_id, published_at desc);
create index news_items_sector_idx on public.news_items (sector_key, published_at desc);
create index news_items_event_idx on public.news_items (event_id);
create index news_items_macro_event_idx on public.news_items (macro_event_id);
create index news_items_actor_idx on public.news_items (actor_player_id);
create index news_items_template_idx on public.news_items (template_key);
create index news_items_quarter_idx on public.news_items (game_quarter_id);
comment on table public.news_items is 'Published news (ticker, stock detail). Rows become visible at published_at.';

-- Sentiment impact of a news item on the simulation (kept apart from the
-- public text so that players cannot read the exact impulse).
create table public.news_item_effects (
  news_item_id  bigint primary key references public.news_items (id) on delete cascade,
  sentiment     double precision not null default 0,
  decay_ticks   integer not null default 120,
  applied_at    timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.news_item_effects enable row level security;
comment on table public.news_item_effects is 'Hidden sentiment impulse per news item. Internal.';
