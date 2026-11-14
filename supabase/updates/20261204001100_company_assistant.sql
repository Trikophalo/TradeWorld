-- ===== idempotent copy of migrations/20261204001100_company_assistant.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1100 · Mira, the company assistant (ADR-138)
-- =============================================================================
-- The company tab works through a chat: Mira reports open tasks, crises and free slots for business moves, weighs the
-- options and hands out work on the player's word. Clear commands ("Gib das Packen an Anna") are understood in the
-- browser and run through the existing RPCs (delegate_company_task, start_company_move, submit_company_pitch, ...), so
-- nothing new can change money here. Free text goes to Claude (edge function company-assistant), which only proposes
-- actions; the player confirms each with a tap.
-- This migration gives the edge function its context and limits the Claude calls per player and hour.
-- RPC (authenticated): company_assistant_context(p_text text) -> context jsonb, counts one call (NX126 when used up).
-- Idempotent: runs unchanged as supabase/updates/20261204001100_company_assistant.sql.

create table if not exists public.company_assistant_calls (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists company_assistant_calls_player_idx on public.company_assistant_calls (player_id, created_at desc);
alter table public.company_assistant_calls enable row level security;
revoke all on public.company_assistant_calls from public, anon, authenticated;
comment on table public.company_assistant_calls is 'Claude calls of Mira, the company assistant (ADR-138), for the hourly limit. Internal.';

-- Error key NX126 ------------------------------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''assistant_busy''' in v_def) = 0 then
    v_def := replace(v_def, $q$    when 'nft_price_changed'          then 'NX125'
$q$, $q$    when 'nft_price_changed'          then 'NX125'
    when 'assistant_busy'             then 'NX126'
$q$);
    if position('''assistant_busy''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the assistant error key by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

create or replace function public.company_assistant_cfg()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value from public.game_config where key = 'companyAssistant'), '{}'::jsonb);
$$;

create or replace function public.company_assistant_context(p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg       jsonb := public.company_assistant_cfg();
  v_player  uuid := public.require_player();
  v_tasks   jsonb;
  v_company uuid;
  v_founder boolean;
  v_moves   jsonb;
  pc        public.player_companies;
  c         public.companies;
  e         public.player_company_events;
begin
  if p_text is null or char_length(btrim(p_text)) not between 1 and coalesce((cfg ->> 'maxTextLength')::int, 300) then
    perform public.api_error('invalid_argument');
  end if;
  v_tasks := public.company_tasks_state(v_player);  -- company_not_found without a company
  v_company := (v_tasks -> 'company' ->> 'id')::uuid;
  v_founder := v_tasks ->> 'role' = 'founder';

  -- the hourly limit (serialised per player, so parallel calls cannot slip through)
  perform pg_advisory_xact_lock(hashtextextended('company_assistant:' || v_player::text, 0));
  if (select count(*) from public.company_assistant_calls a
       where a.player_id = v_player and a.created_at > now() - interval '1 hour')
     >= coalesce((cfg ->> 'claudePerHour')::int, 20) then
    perform public.api_error('assistant_busy');
  end if;
  insert into public.company_assistant_calls (player_id) values (v_player);
  delete from public.company_assistant_calls a where a.player_id = v_player and a.created_at < now() - interval '1 day';

  select * into pc from public.player_companies where company_id = v_company;
  select * into c from public.companies where id = v_company;
  if v_founder then
    v_moves := public.company_moves_state(v_company);
    select * into e from public.player_company_events ev
     where ev.company_id = v_company and ev.status = 'open'
     order by ev.started_at desc limit 1;
  end if;

  return jsonb_build_object(
    'text', btrim(p_text),
    'role', v_tasks ->> 'role',
    'company', jsonb_build_object('name', c.name, 'idea', pc.idea, 'product', pc.product_key, 'sector', c.sector_key,
                                  'tier', pc.tier),
    'tasks', v_tasks,
    'moves', v_moves,
    'event', case when e.id is null then null else jsonb_build_object(
               'archetype', e.archetype, 'polarity', e.polarity, 'severity', e.severity, 'headline', e.ai_headline) end);
end;
$$;

revoke all on function public.company_assistant_context(text) from public, anon;
grant execute on function public.company_assistant_context(text) to authenticated;
comment on function public.company_assistant_context(text) is
  'RPC: what Mira, the company assistant, knows for a Claude answer (ADR-138); counts against the hourly limit.';
