-- =============================================================================
-- NEXA · 1500 · Read API views
-- =============================================================================
-- All views are SECURITY INVOKER: they never widen access, the RLS policies
-- of the underlying tables stay the single source of truth. They exist to
-- give the client stable, pre-joined shapes. v_my_* views filter on
-- auth.uid() explicitly (in addition to RLS) so that insider access to
-- company accounts does not leak into "my" lists.
-- =============================================================================

-- ---- market ----------------------------------------------------------------

create view public.v_securities with (security_invoker = true) as
select
  s.id, s.kind, s.ticker, s.name, s.status, s.sector_key, s.company_id,
  s.tick_size_e4, s.is_tradable, s.is_shortable, s.max_leverage, s.listed_at,
  c.is_ai        as company_is_ai,
  c.tier         as company_tier,
  c.logo_key, c.logo_pixels, c.brand_color,
  q.last_price_e4, q.bid_e4, q.ask_e4, q.prev_close_e4, q.day_open_e4, q.day_high_e4, q.day_low_e4,
  q.day_volume, q.day_turnover_cents, q.change_bps, q.market_cap_cents, q.yield_bps,
  q.updated_at   as quote_updated_at
from public.securities s
left join public.security_quotes q on q.security_id = s.id
left join public.companies c on c.id = s.company_id;
comment on view public.v_securities is 'Market list: security master data, issuer branding and the latest quote.';

create view public.v_stock_fundamentals with (security_invoker = true) as
select
  s.id as security_id, s.ticker, c.id as company_id, c.name as company_name, c.sector_key,
  c.shares_outstanding,
  q.last_price_e4,
  q.market_cap_cents,
  c.ttm_revenue_cents,
  c.ttm_net_income_cents,
  c.eps_ttm_e4,
  case when c.eps_ttm_e4 > 0 then (q.last_price_e4::double precision / c.eps_ttm_e4) end as pe_ratio,
  case when c.ttm_revenue_cents > 0
       then round(c.ttm_net_income_cents::numeric * 10000 / c.ttm_revenue_cents)::integer end as net_margin_bps,
  d.dividends_ttm_e4,
  case when q.last_price_e4 > 0
       then round(coalesce(d.dividends_ttm_e4, 0)::numeric * 10000 / q.last_price_e4)::integer end as dividend_yield_bps,
  c.dividend_policy
from public.securities s
join public.companies c on c.id = s.company_id
left join public.security_quotes q on q.security_id = s.id
left join lateral (
  select sum(x.amount_per_unit_e4)::bigint as dividends_ttm_e4
    from (
      select sd.amount_per_unit_e4
        from public.security_distributions sd
       where sd.security_id = s.id and sd.kind = 'dividend' and sd.status = 'paid'
       order by sd.paid_at desc
       limit 4
    ) x
) d on true
where s.kind = 'stock';
comment on view public.v_stock_fundamentals is 'Published key figures per stock: P/E, margin, dividend yield, market cap.';

create view public.v_bonds with (security_invoker = true) as
select
  s.id as security_id, s.ticker, s.name, s.status,
  b.issuer, b.series, b.term_game_years, b.coupon_bps, b.face_value_cents, b.rating,
  b.issued_at, b.matures_at, b.is_benchmark,
  q.last_price_e4, q.bid_e4, q.ask_e4, q.change_bps, q.yield_bps
from public.bonds b
join public.securities s on s.id = b.security_id
left join public.security_quotes q on q.security_id = s.id;
comment on view public.v_bonds is 'Government bonds with terms, price and yield.';

create view public.v_index_members with (security_invoker = true) as
select
  i.security_id as index_security_id, i.key as index_key,
  m.member_security_id, s.ticker, s.name, s.company_id, m.weight_bps, m.joined_at,
  c.is_ai as company_is_ai,
  q.last_price_e4, q.change_bps, q.market_cap_cents
from public.indices i
join public.index_memberships m on m.index_security_id = i.security_id and m.left_at is null
join public.securities s on s.id = m.member_security_id
left join public.companies c on c.id = s.company_id
left join public.security_quotes q on q.security_id = s.id;
comment on view public.v_index_members is 'Current members of each index with weight and quote.';

-- ---- companies -------------------------------------------------------------

create view public.v_company_profiles with (security_invoker = true) as
select
  c.id, c.name, c.slug, c.ticker, c.description, c.sector_key, sec.name as sector_name,
  c.is_ai, c.tier, c.legal_form, c.phase, c.logo_key, c.logo_pixels, c.brand_color,
  c.founder_id, f.nickname as founder_nickname, f.reputation as founder_reputation,
  c.ceo_id, c.security_id, c.shares_outstanding, c.employee_count, c.max_employees,
  c.dividend_policy, c.ttm_revenue_cents, c.ttm_net_income_cents, c.eps_ttm_e4,
  c.founded_at, c.listed_at,
  q.last_price_e4, q.change_bps, q.market_cap_cents,
  r.game_quarter_id      as last_report_quarter_id,
  r.revenue_cents        as last_revenue_cents,
  r.net_income_cents     as last_net_income_cents,
  r.market_share_bps     as last_market_share_bps,
  r.published_at         as last_report_published_at
from public.companies c
join public.sectors sec on sec.key = c.sector_key
left join public.profiles f on f.id = c.founder_id
left join public.security_quotes q on q.security_id = c.security_id
left join lateral (
  select cr.game_quarter_id, cr.revenue_cents, cr.net_income_cents, cr.market_share_bps, cr.published_at
    from public.company_quarter_reports cr
   where cr.company_id = c.id and cr.published_at is not null and cr.published_at <= now()
   order by cr.published_at desc
   limit 1
) r on true;
comment on view public.v_company_profiles is 'Company page header: profile, founder with reputation, quote and the latest PUBLISHED quarterly figures.';

create view public.v_cap_table with (security_invoker = true) as
select
  e.company_id, e.id as entry_id, e.holder_kind, e.player_id, p.nickname as holder_nickname,
  e.ai_investor_key, e.label, e.shares,
  round(e.shares::numeric * 10000 / nullif(c.shares_outstanding, 0))::integer as share_bps
from public.cap_table_entries e
join public.companies c on c.id = e.company_id
left join public.profiles p on p.id = e.player_id;
comment on view public.v_cap_table is 'Shareholder register with percentage per holder.';

create view public.v_ipo_calendar with (security_invoker = true) as
select
  i.id as ipo_id, i.company_id, c.name as company_name, c.sector_key, c.logo_key, c.logo_pixels, c.brand_color,
  c.founder_id, f.nickname as founder_nickname, f.reputation as founder_reputation,
  i.status, i.ticker, i.shares_offered, i.shares_offered_bps, i.price_range_low_e4, i.price_range_high_e4,
  i.final_price_e4, i.founder_lockup_quarters, i.subscription_opens_at, i.subscription_closes_at,
  i.total_demand_shares,
  case when i.shares_offered > 0
       then round(i.total_demand_shares::numeric * 10000 / i.shares_offered)::integer end as coverage_bps,
  i.listed_at
from public.ipos i
join public.companies c on c.id = i.company_id
left join public.profiles f on f.id = c.founder_id
where i.status <> 'draft';
comment on view public.v_ipo_calendar is 'Running and past IPOs with book coverage (drafts are hidden).';

create view public.v_job_board with (security_invoker = true) as
select
  j.id as job_definition_id, j.key, j.tier, j.title, j.description, j.specialty, j.task_kind,
  j.min_level, j.salary_cents_per_hour, j.grants_options, j.has_decisions,
  j.company_id, c.name as company_name, c.sector_key, c.logo_key, c.brand_color, c.is_ai
from public.job_definitions j
join public.companies c on c.id = j.company_id
where j.is_active;
comment on view public.v_job_board is 'Open jobs at AI companies.';

-- ---- players / social ------------------------------------------------------

create view public.v_player_profiles with (security_invoker = true) as
select
  p.id, p.nickname, p.level, p.xp_total, p.reputation, p.title_key, p.frame_key, p.avatar,
  p.accent_color, p.bankrupt_until, p.created_at,
  (select count(*) from public.player_achievements a
    where a.player_id = p.id and a.unlocked_at is not null)::integer as achievements_unlocked,
  (select coalesce(jsonb_agg(l.item_key order by li.sort_order), '[]'::jsonb)
     from public.player_lifestyle_items l
     join public.lifestyle_items li on li.key = l.item_key
    where l.player_id = p.id and l.status = 'owned') as lifestyle_item_keys,
  (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phase', c.phase) order by c.founded_at), '[]'::jsonb)
     from public.companies c
    where c.founder_id = p.id and c.phase <> 'dissolved') as companies
from public.profiles p
where not p.is_deactivated;
comment on view public.v_player_profiles is 'Public player card with achievements count, visible status symbols and founded companies.';

create view public.v_league_standings with (security_invoker = true) as
select
  s.id as season_id, s.week_start, s.starts_at, s.ends_at, s.status,
  e.player_id, p.nickname, p.level, p.avatar, p.title_key, p.frame_key,
  e.growth_bps, e.rank,
  (e.player_id = (select auth.uid())) as is_me,
  (e.player_id = (select auth.uid()) or public.are_friends(e.player_id, (select auth.uid()))) as is_friend_or_me
from public.league_entries e
join public.league_seasons s on s.id = e.season_id
join public.profiles p on p.id = e.player_id;
comment on view public.v_league_standings is 'Weekly league by percentage growth. Filter is_friend_or_me for the friend league.';

create view public.v_friends with (security_invoker = true) as
select
  f.id as friendship_id, f.status, f.created_at, f.responded_at,
  (f.requester_id = (select auth.uid())) as requested_by_me,
  p.id as friend_id, p.nickname, p.level, p.reputation, p.avatar, p.title_key, p.frame_key
from public.friendships f
join public.profiles p
  on p.id = case when f.requester_id = (select auth.uid()) then f.addressee_id else f.requester_id end
where (select auth.uid()) in (f.requester_id, f.addressee_id);
comment on view public.v_friends is 'Friend list and pending requests from the caller''s point of view.';

create view public.v_feed with (security_invoker = true) as
select
  fi.id, fi.kind, fi.visibility, fi.payload, fi.created_at,
  fi.actor_id, p.nickname as actor_nickname, p.avatar as actor_avatar, p.level as actor_level,
  fi.company_id, c.name as company_name,
  fi.security_id, s.ticker
from public.feed_items fi
join public.profiles p on p.id = fi.actor_id
left join public.companies c on c.id = fi.company_id
left join public.securities s on s.id = fi.security_id;
comment on view public.v_feed is 'Feed entries the caller may see (own, friends, public) with actor and subject names.';

-- ---- events / news ---------------------------------------------------------

create view public.v_event_calendar with (security_invoker = true) as
select
  e.id, e.kind, e.status, e.title, e.description, e.importance, e.scheduled_at, e.announced_at,
  e.company_id, c.name as company_name,
  e.security_id, s.ticker,
  e.sector_key, e.game_quarter_id, e.outcome, e.resolved_at
from public.scheduled_events e
left join public.companies c on c.id = e.company_id
left join public.securities s on s.id = e.security_id
where e.status in ('scheduled', 'in_progress')
   or e.resolved_at > now() - interval '24 hours';
comment on view public.v_event_calendar is 'Upcoming events for the countdown bar plus results of the last 24 h.';

create view public.v_news with (security_invoker = true) as
select
  n.id, n.category, n.headline, n.body, n.importance, n.published_at,
  n.company_id, c.name as company_name, c.is_ai as company_is_ai,
  n.security_id, s.ticker,
  n.sector_key, n.event_id, n.actor_player_id, p.nickname as actor_nickname
from public.news_items n
left join public.companies c on c.id = n.company_id
left join public.securities s on s.id = n.security_id
left join public.profiles p on p.id = n.actor_player_id;
comment on view public.v_news is 'News ticker with company/ticker names.';

-- ---- private ("my") views --------------------------------------------------

create view public.v_my_accounts with (security_invoker = true) as
select a.id as account_id, a.kind, a.balance_cents, a.is_frozen, a.updated_at
from public.ledger_accounts a
where a.owner_player_id = (select auth.uid());
comment on view public.v_my_accounts is 'The caller''s cash and reserve balances.';

create view public.v_my_ledger with (security_invoker = true) as
select
  e.id as entry_id, e.account_id, a.kind as account_kind, e.amount_cents, e.balance_after_cents, e.created_at,
  t.id as transaction_id, t.kind, t.description, t.ref_type, t.ref_id, t.game_quarter_id
from public.ledger_entries e
join public.ledger_accounts a on a.id = e.account_id
join public.ledger_transactions t on t.id = e.transaction_id
where a.owner_player_id = (select auth.uid());
comment on view public.v_my_ledger is 'The caller''s account statement (all bookings on own accounts).';

create view public.v_my_positions with (security_invoker = true) as
select
  p.id as position_id, p.security_id, s.ticker, s.name, s.kind as security_kind, s.sector_key,
  p.side, p.leverage, p.quantity, p.reserved_quantity, p.avg_entry_price_e4, p.cost_basis_cents,
  p.margin_cents, p.borrowed_cents, p.liquidation_price_e4, p.realized_pnl_cents,
  p.accrued_financing_cents, p.opened_at,
  q.last_price_e4, q.change_bps,
  round(p.quantity::numeric * q.last_price_e4 / 100)::bigint as market_value_cents,
  round(p.quantity::numeric * (q.last_price_e4 - p.avg_entry_price_e4) / 100
        * case when p.side = 'short' then -1 else 1 end)::bigint as unrealized_pnl_cents
from public.positions p
join public.securities s on s.id = p.security_id
left join public.security_quotes q on q.security_id = p.security_id
where p.player_id = (select auth.uid()) and p.status = 'open';
comment on view public.v_my_positions is 'Open positions with mark-to-market values (display only; settlement is computed in RPCs).';

create view public.v_my_vault with (security_invoker = true) as
select
  v.player_id, v.accrual_started_at, v.last_claimed_at, v.total_claimed_cents,
  greatest(0, floor(extract(epoch from (now() - v.accrual_started_at))))::bigint as accrued_seconds_uncapped
from public.vaults v
where v.player_id = (select auth.uid());
comment on view public.v_my_vault is 'Vault state; the client caps accrued seconds with the public config (capacity hours, hourly rate).';

grant select on
  public.v_securities, public.v_stock_fundamentals, public.v_bonds, public.v_index_members,
  public.v_company_profiles, public.v_cap_table, public.v_ipo_calendar, public.v_job_board,
  public.v_player_profiles, public.v_league_standings, public.v_friends, public.v_feed,
  public.v_event_calendar, public.v_news,
  public.v_my_accounts, public.v_my_ledger, public.v_my_positions, public.v_my_vault
to authenticated;
revoke all on
  public.v_securities, public.v_stock_fundamentals, public.v_bonds, public.v_index_members,
  public.v_company_profiles, public.v_cap_table, public.v_ipo_calendar, public.v_job_board,
  public.v_player_profiles, public.v_league_standings, public.v_friends, public.v_feed,
  public.v_event_calendar, public.v_news,
  public.v_my_accounts, public.v_my_ledger, public.v_my_positions, public.v_my_vault
from anon, public;
