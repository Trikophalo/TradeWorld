-- ===== idempotent copy of migrations/20261204001000_seen_tours.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1000 · Finn's tours are remembered on the server
-- =============================================================================
-- The short tours of Finn ("seenTours") lived only in the browser's localStorage. In a private window, or on a second
-- device, every tour started again. Now each seen tour is also stored per player; the client merges both lists.
-- RPCs (authenticated): get_seen_tours() -> {"tours": [text]}, mark_tour_seen(p_request_id uuid, p_tour text) -> same.
-- Idempotent: runs unchanged as supabase/updates/20261204001000_seen_tours.sql.

create table if not exists public.player_seen_tours (
  player_id  uuid not null references public.profiles (id) on delete cascade,
  tour_key   text not null check (tour_key ~ '^[a-z0-9_]{1,40}$'),
  seen_at    timestamptz not null default now(),
  primary key (player_id, tour_key)
);
alter table public.player_seen_tours enable row level security;
revoke all on public.player_seen_tours from public, anon, authenticated;
comment on table public.player_seen_tours is 'Tours of Finn a player has seen. Internal; read through get_seen_tours().';

create or replace function public.get_seen_tours()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('tours', coalesce((select jsonb_agg(t.tour_key order by t.seen_at)
                                                 from public.player_seen_tours t
                                                where t.player_id = public.require_player()), '[]'::jsonb));
$$;

create or replace function public.mark_tour_seen(p_request_id uuid, p_tour text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  if p_request_id is null or p_tour is null or p_tour !~ '^[a-z0-9_]{1,40}$' then
    perform public.api_error('invalid_argument');
  end if;
  -- naturally idempotent: a tour is seen once
  insert into public.player_seen_tours (player_id, tour_key) values (v_player, p_tour) on conflict do nothing;
  return public.get_seen_tours();
end;
$$;

revoke all on function public.get_seen_tours() from public, anon;
revoke all on function public.mark_tour_seen(uuid, text) from public, anon;
grant execute on function public.get_seen_tours() to authenticated;
grant execute on function public.mark_tour_seen(uuid, text) to authenticated;
comment on function public.get_seen_tours() is 'RPC: tours of Finn the player has seen.';
comment on function public.mark_tour_seen(uuid, text) is 'RPC: remember that the player has seen a tour of Finn.';
