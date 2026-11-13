-- ===== idempotent copy of migrations/20261203000400_market_orders_only.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0400 · Market orders only: limit orders are switched off (ADR-117)
-- =============================================================================
-- The owner removed limit orders from the game. The client no longer offers them; the server refuses them while
-- game_config.trading.limitOrders is false. Without the key (tests, older configs) they stay allowed, so the
-- matching engine and its tests are untouched and the feature can come back by flipping the switch.
-- Limit orders that are already resting stay in the book until they fill or are cancelled.
-- Idempotent: runs unchanged as supabase/updates/20261203000400_market_orders_only.sql.

create or replace function public.orders_market_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type = 'limit' and new.source = 'player'
     and not public.config_boolean('trading', '{limitOrders}', true) then
    perform public.api_error('locked');
  end if;
  return new;
end;
$$;
comment on function public.orders_market_only() is
  'Trigger: refuses new limit orders of players while trading.limitOrders is false (ADR-117).';
revoke all on function public.orders_market_only() from public, anon, authenticated;

drop trigger if exists orders_market_only on public.orders;
create trigger orders_market_only before insert on public.orders
  for each row execute function public.orders_market_only();

-- Missions about limit orders are no longer handed out.
update public.mission_templates set is_active = false
 where metric in ('limit_orders_placed', 'limit_orders_filled') and is_active;
