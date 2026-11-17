-- ===== idempotent copy of migrations/20261204007400_stock_company_revenue.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 7400 · Business figures of listed companies at the stock exchange (ADR-184)
-- =============================================================================
-- * get_stock_revenue(p_ticker): a new public read RPC (any signed-in player). Without a ticker it lists every listed
--   stock with its figures (market list, one compact line per row); with a ticker it returns that one stock plus a
--   small history for the sparkline (stock detail page).
-- * Player companies: their hourly economy (player_company_hours, ADR-072/180). Revenue of the last closed hour, the
--   sums of revenue and profit of the last 24 hours, the previous 24 hours scaled to the same number of hours (for
--   the trend arrow), reputation (ADR-183) and awareness. Only these aggregates leave the server; the company page
--   (ADR-051 "open any company") already shows awareness and quality to everybody.
-- * AI companies: their latest published quarterly report (and the one before for the trend), labelled with game
--   year and quarter; without a report the trailing figures divided by four, like get_security_details.
-- New functions only, no existing function is changed.
-- Idempotent: runs unchanged as supabase/updates/20261204007400_stock_company_revenue.sql.

create or replace function public.stock_figures_json(p_company uuid, p_history boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c          public.companies;
  pc         public.player_companies;
  v_now      timestamptz := date_trunc('hour', public.game_now());
  v_last_at  timestamptz;
  v_last_rev bigint;
  v_rev      bigint;
  v_profit   bigint;
  v_hours    integer;
  v_prev     bigint;
  v_prev_n   integer;
  v_hist     jsonb := '[]'::jsonb;
  v_reports  jsonb;
begin
  select * into c from public.companies where id = p_company;
  if c.id is null then
    return null;
  end if;
  select * into pc from public.player_companies where company_id = p_company;

  if not c.is_ai and pc.company_id is not null then
    select h.hour_start, h.revenue_cents into v_last_at, v_last_rev
      from public.player_company_hours h
     where h.company_id = p_company
     order by h.hour_start desc limit 1;
    select coalesce(sum(h.revenue_cents), 0), coalesce(sum(h.profit_cents), 0), count(*)
      into v_rev, v_profit, v_hours
      from public.player_company_hours h
     where h.company_id = p_company and h.hour_start >= v_now - interval '24 hours';
    select sum(h.revenue_cents), count(*) into v_prev, v_prev_n
      from public.player_company_hours h
     where h.company_id = p_company
       and h.hour_start >= v_now - interval '48 hours' and h.hour_start < v_now - interval '24 hours';
    if p_history then
      select coalesce(jsonb_agg(x.revenue_cents order by x.hour_start), '[]'::jsonb) into v_hist
        from (select h.hour_start, h.revenue_cents from public.player_company_hours h
               where h.company_id = p_company and h.hour_start >= v_now - interval '24 hours'
               order by h.hour_start desc limit 24) x;
    end if;
    return jsonb_build_object(
      'period',                  'day',
      'revenue_cents',           v_rev,
      'profit_cents',            v_profit,
      'hours',                   v_hours,
      -- the previous day per hour times this day's hours: a young company is compared fairly
      'prev_revenue_cents',      case when v_prev_n > 0 and v_hours > 0
                                      then round(v_prev::numeric * v_hours / v_prev_n)::bigint end,
      'last_hour_at',            v_last_at,
      'last_hour_revenue_cents', v_last_rev,
      'game_year',               null,
      'quarter',                 null,
      'reputation',              round(pc.reputation::numeric)::integer,
      'awareness_bps',           round(pc.awareness::numeric * 10000)::integer,
      'history',                 v_hist);
  end if;

  -- AI company (or a company without hours): the published quarterly reports, newest first
  select coalesce(jsonb_agg(jsonb_build_object('revenue_cents', x.revenue_cents, 'profit_cents', x.net_income_cents,
                                               'game_year', x.game_year, 'quarter', x.quarter)
                            order by x.starts_at desc), '[]'::jsonb)
    into v_reports
    from (select r.revenue_cents, r.net_income_cents, gq.game_year, gq.quarter, gq.starts_at
            from public.company_quarter_reports r
            join public.game_quarters gq on gq.id = r.game_quarter_id
           where r.company_id = p_company and r.published_at is not null and r.published_at <= now()
           order by gq.starts_at desc limit case when p_history then 8 else 2 end) x;
  if jsonb_array_length(v_reports) = 0 then
    return jsonb_build_object(
      'period', 'quarter', 'revenue_cents', round(c.ttm_revenue_cents / 4.0)::bigint,
      'profit_cents', round(c.ttm_net_income_cents / 4.0)::bigint, 'hours', null, 'prev_revenue_cents', null,
      'last_hour_at', null, 'last_hour_revenue_cents', null, 'game_year', null, 'quarter', null,
      'reputation', null, 'awareness_bps', null, 'history', '[]'::jsonb);
  end if;
  if p_history then
    select coalesce(jsonb_agg((e.v ->> 'revenue_cents')::bigint order by e.n desc), '[]'::jsonb) into v_hist
      from jsonb_array_elements(v_reports) with ordinality e(v, n);
  end if;
  return jsonb_build_object(
    'period',                  'quarter',
    'revenue_cents',           (v_reports -> 0 ->> 'revenue_cents')::bigint,
    'profit_cents',            (v_reports -> 0 ->> 'profit_cents')::bigint,
    'hours',                   null,
    'prev_revenue_cents',      (v_reports -> 1 ->> 'revenue_cents')::bigint,
    'last_hour_at',            null,
    'last_hour_revenue_cents', null,
    'game_year',               (v_reports -> 0 ->> 'game_year')::integer,
    'quarter',                 (v_reports -> 0 ->> 'quarter')::integer,
    'reputation',              null,
    'awareness_bps',           null,
    'history',                 v_hist);
end;
$$;
comment on function public.stock_figures_json(uuid, boolean) is
  'Public business figures of a listed company for the stock exchange (ADR-184): player companies from their hours, '
  'AI companies from their latest quarterly report. Internal helper of get_stock_revenue.';

create or replace function public.get_stock_revenue(p_ticker text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_rows jsonb;
begin
  perform public.require_player();
  if p_ticker is not null then
    v_id := public.resolve_security(p_ticker);
    if v_id is null then
      perform public.api_error('unknown_security');
    end if;
  end if;
  select coalesce(jsonb_agg(x.f order by x.ticker), '[]'::jsonb) into v_rows
    from (select s.ticker,
                 jsonb_build_object('ticker', s.ticker,
                                    'company_kind', case when c.is_ai then 'ai' else 'player' end)
                   || public.stock_figures_json(s.company_id, v_id is not null) as f
            from public.securities s
            join public.companies c on c.id = s.company_id
           where s.kind = 'stock'
             and (case when v_id is null then s.status = 'listed' else s.id = v_id end)) x
   where x.f is not null;
  return jsonb_build_object('figures', v_rows);
end;
$$;
comment on function public.get_stock_revenue(text) is
  'Revenue, profit, trend, reputation and awareness of listed companies for the stock exchange (ADR-184). Read-only.';

revoke all on function public.stock_figures_json(uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_stock_revenue(text) from public, anon;
grant execute on function public.get_stock_revenue(text) to authenticated;
