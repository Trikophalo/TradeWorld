-- =============================================================================
-- NEXA · M2b · 0100 · Schema: avatars, skills, daily rewards, job postings,
--                     applications, contracts (docs/JOBS_AND_SKILLS.md)
-- =============================================================================
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Avatars
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_key text not null default 'rookie';
comment on column public.profiles.avatar_key is 'Pixel portrait (game_config avatars.portraits); validated by set_avatar(), not by a CHECK.';

-- ---------------------------------------------------------------------------
-- Skills
-- ---------------------------------------------------------------------------
create table if not exists public.player_skills (
  player_id  uuid not null references public.profiles (id) on delete cascade,
  skill_key  text not null check (skill_key ~ '^[a-z0-9_]+$'),
  learned_at timestamptz not null default now(),
  primary key (player_id, skill_key)
);
alter table public.player_skills enable row level security;
comment on table public.player_skills is 'Learned skills (game_config skills.tree). Irreversible. Owner read; public via get_player_card.';

create table if not exists public.player_skill_points (
  player_id           uuid primary key references public.profiles (id) on delete cascade,
  free_points         integer not null default 0 check (free_points >= 0),
  branch_points       jsonb not null default '{}'::jsonb,
  branch_work_minutes jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table public.player_skill_points enable row level security;
comment on table public.player_skill_points is 'Unspent skill points: free (level-ups, missions, daily rewards) and per branch (work); work minutes per branch towards the next branch point.';

-- level-ups before M2b: (level - 1) x freePointsPerLevel free points, granted once (row creation)
insert into public.player_skill_points (player_id, free_points)
select p.id, greatest(0, (p.level - 1) * coalesce(public.config_double('skills', '{freePointsPerLevel}', 1), 1))::integer
  from public.profiles p
on conflict (player_id) do nothing;

alter table public.mission_templates add column if not exists reward_skill_points integer not null default 0
  check (reward_skill_points >= 0);
comment on column public.mission_templates.reward_skill_points is 'Free skill points paid with the mission XP (weekly missions and milestones: 1).';
update public.mission_templates set reward_skill_points = 1
 where mode is not null and kind in ('weekly', 'milestone') and reward_skill_points = 0;

-- ---------------------------------------------------------------------------
-- Daily rewards (7-day cycle)
-- ---------------------------------------------------------------------------
alter table public.login_streaks
  add column if not exists reward_cycle_day smallint not null default 0 check (reward_cycle_day between 0 and 7),
  add column if not exists reward_last_day  date;
comment on column public.login_streaks.reward_cycle_day is 'Cycle day (1..7) of the last claimed daily reward, 0 = none yet.';

create table if not exists public.daily_reward_claims (
  player_id             uuid not null references public.profiles (id) on delete cascade,
  claim_day             date not null,
  cycle_day             smallint not null check (cycle_day between 1 and 7),
  xp_awarded            integer not null default 0,
  cash_cents            bigint not null default 0 check (cash_cents >= 0),
  skill_points          integer not null default 0 check (skill_points >= 0),
  freeze_used           boolean not null default false,
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now(),
  primary key (player_id, claim_day)
);
alter table public.daily_reward_claims enable row level security;
create index if not exists daily_reward_claims_ledger_tx_idx on public.daily_reward_claims (ledger_transaction_id);
comment on table public.daily_reward_claims is 'One claim per player and Berlin calendar day of the 7-day reward calendar.';

-- ---------------------------------------------------------------------------
-- Job postings, applications, contracts
-- ---------------------------------------------------------------------------
create table if not exists public.job_postings (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  tier                  public.job_tier not null,
  title_key             text check (title_key ~ '^[a-z0-9_]+$'),
  title                 text check (char_length(title) between 3 and 60),
  required              jsonb not null check (jsonb_typeof(required) = 'array' and jsonb_array_length(required) between 1 and 8),
  salary_cents_per_hour bigint not null check (salary_cents_per_hour > 0),
  slots                 integer check (slots is null or slots between 1 and 100),
  is_ai                 boolean not null default false,
  ai_slot               smallint,
  status                text not null default 'open' check (status in ('open', 'closed')),
  game_quarter_id       bigint references public.game_quarters (id),
  created_by            uuid references public.profiles (id) on delete set null,
  request_id            uuid,
  posted_at             timestamptz not null default now(),
  expires_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (title_key is not null or title is not null),
  unique (created_by, request_id)
);
alter table public.job_postings enable row level security;
create index if not exists job_postings_company_idx on public.job_postings (company_id, status);
create index if not exists job_postings_open_idx on public.job_postings (status, expires_at) where status = 'open';
create index if not exists job_postings_quarter_idx on public.job_postings (game_quarter_id);
create index if not exists job_postings_created_by_idx on public.job_postings (created_by);
create unique index if not exists job_postings_ai_slot_uq on public.job_postings (company_id, game_quarter_id, ai_slot) where is_ai;
comment on table public.job_postings is 'Job board: AI postings (refreshed every game quarter, title_key translated by the client) and player company postings (own title). slots NULL = unlimited (AI).';

create table if not exists public.job_applications (
  id                          uuid primary key default gen_random_uuid(),
  posting_id                  uuid not null references public.job_postings (id) on delete cascade,
  player_id                   uuid not null references public.profiles (id) on delete cascade,
  request_id                  uuid not null,
  salary_wish_cents_per_hour  bigint not null check (salary_wish_cents_per_hour > 0),
  message                     text check (char_length(message) <= 280),
  status                      text not null default 'pending'
                              check (status in ('pending', 'offered', 'rejected', 'declined', 'withdrawn', 'expired', 'signed', 'closed')),
  offer_salary_cents_per_hour bigint check (offer_salary_cents_per_hour > 0),
  offer_expires_at            timestamptz,
  signature                   text check (char_length(signature) <= 8000),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (player_id, request_id)
);
alter table public.job_applications enable row level security;
create index if not exists job_applications_posting_idx on public.job_applications (posting_id, status);
create index if not exists job_applications_player_idx on public.job_applications (player_id, created_at desc);
comment on table public.job_applications is 'Applications with salary wish, one sentence and (after signing) the symbolic signature.';

alter table public.player_jobs
  add column if not exists posting_id              uuid references public.job_postings (id) on delete set null,
  add column if not exists application_id          uuid references public.job_applications (id) on delete set null,
  add column if not exists title_key               text,
  add column if not exists required                jsonb not null default '[]'::jsonb,
  add column if not exists ceiling_cents_per_hour  bigint,
  add column if not exists raise_base_score        integer not null default 0,
  add column if not exists last_raise_at           timestamptz,
  add column if not exists raise_requested_at      timestamptz,
  add column if not exists pending_raise_bps       integer,
  add column if not exists pending_raise_at        timestamptz,
  add column if not exists pay_factor_bps          integer not null default 10000,
  add column if not exists earned_total_cents      bigint not null default 0,
  add column if not exists paid_day                date,
  add column if not exists paid_minutes_today      integer not null default 0,
  add column if not exists signature               text;
create index if not exists player_jobs_posting_idx on public.player_jobs (posting_id);
create index if not exists player_jobs_application_idx on public.player_jobs (application_id);
comment on column public.player_jobs.raise_base_score is 'Matching skill score at hire or the last raise; raises are allowed for the score gained since.';
comment on column public.player_jobs.pay_factor_bps is 'Share of the contract wage the employer could pay at the last payout (AI: always 10000).';

-- ---------------------------------------------------------------------------
-- RLS: owner read for the player's own rows, public read for postings
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['player_skills', 'player_skill_points', 'daily_reward_claims', 'job_applications'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists "owner read" on public.%I', t);
    execute format('create policy "owner read" on public.%I for select to authenticated using (player_id = (select auth.uid()))', t);
  end loop;
  revoke all on public.job_postings from public, anon, authenticated;
  grant select on public.job_postings to authenticated;
  grant all on public.job_postings to service_role;
  drop policy if exists "public read" on public.job_postings;
  create policy "public read" on public.job_postings for select to authenticated using (true);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['player_skill_points', 'job_postings', 'job_applications'] loop
    if not exists (select 1 from pg_trigger where tgname = 'set_updated_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    end if;
  end loop;
end;
$$;
