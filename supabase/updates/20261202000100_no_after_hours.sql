-- ===== idempotent copy of migrations/20261202000100_no_after_hours.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0100 · Open around the clock: no after-hours session, no bells (ADR-106)
-- =============================================================================
-- The market hours are configuration (time.marketOpenHour / marketCloseHour). With 0 and 24 every tick is a regular
-- session (market_session_at, market_tick_at), so there is no after-hours spread any more. events_plan would still
-- plan an opening and a closing bell for every day, both at midnight; while the market is open around the clock
-- they mean nothing, so they are not stored, and the bells already announced are removed. With other hours the
-- bells come back as before.
-- Idempotent: runs unchanged as supabase/updates/20261202000100_no_after_hours.sql.

-- Open around the clock under the current configuration.
create or replace function public.market_always_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.cfg_num(coalesce(public.config_jsonb('time'), '{}'::jsonb), '{marketOpenHour}', 8) <= 0
     and public.cfg_num(coalesce(public.config_jsonb('time'), '{}'::jsonb), '{marketCloseHour}', 22) >= 24;
$$;
revoke all on function public.market_always_open() from public, anon, authenticated;

-- Bells are skipped while the market never closes.
create or replace function public.scheduled_events_skip_bells()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind in ('opening_bell', 'closing_bell') and public.market_always_open() then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.scheduled_events_skip_bells() from public, anon, authenticated;

drop trigger if exists scheduled_events_skip_bells on public.scheduled_events;
create trigger scheduled_events_skip_bells
  before insert on public.scheduled_events
  for each row execute function public.scheduled_events_skip_bells();

-- Bells announced before the change.
delete from public.scheduled_events
 where kind in ('opening_bell', 'closing_bell') and status = 'scheduled' and public.market_always_open();
