-- ===== idempotent copy of migrations/20261203000800_tick_every_10s.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0800 · Market tick every 10 seconds (ADR-122)
-- =============================================================================
-- The tick wrote prices, candles and quotes for every stock and coin every 5 seconds; on a small database that used
-- up the disk budget. game_config.time.tickSeconds and crypto.tickSeconds are 10 now; the simulation scales its
-- moves with the interval, so the daily volatility stays the same. The cron job follows here.
-- Idempotent: runs unchanged as supabase/updates/20261203000800_tick_every_10s.sql.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'nexa-market-tick') then
      perform cron.unschedule('nexa-market-tick');
    end if;
    begin
      perform cron.schedule('nexa-market-tick', '10 seconds', 'select public.market_tick()');
    exception when others then
      raise warning 'pg_cron cannot schedule every 10 seconds (%): the market ticks once per minute instead', sqlerrm;
      perform cron.schedule('nexa-market-tick', '* * * * *', 'select public.market_tick()');
    end;
  end if;
end;
$$;
