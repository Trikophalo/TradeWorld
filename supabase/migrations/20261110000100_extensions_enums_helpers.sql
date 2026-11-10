-- =============================================================================
-- NEXA · 0100 · Default privileges, enums, shared helpers, admin registry
-- =============================================================================
-- Conventions (see docs/DATA_MODEL.md):
--   * money        bigint cents               suffix _cents
--   * prices       bigint, 1 EUR = 10000      suffix _e4
--   * rates        integer basis points       suffix _bps
--   * quantities   bigint whole units
--   * model values double precision (quality, awareness, sentiment ...)
--   * every table has RLS enabled; clients never write game tables directly
--   * custom SQLSTATEs: NX001 insufficient funds, NX002 unbalanced ledger tx,
--     NX003 immutable row, NX004 rate limited, NX005 invalid invite,
--     NX006 forbidden, NX007 invalid argument, NX008 account frozen,
--     NX009 request in progress
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Closed-by-default privileges. Supabase grants ALL on new public objects to
-- anon/authenticated by default; we turn that off and grant explicitly in the
-- RLS migration (20261110001300).
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
-- Functions are executable by PUBLIC by default; switch that off for everything
-- this role creates from now on. EXECUTE is granted per function instead.
alter default privileges revoke execute on functions from public;
grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums (closed value sets). Data-driven sets (sectors, achievements,
-- notification types, ...) are lookup tables with text keys instead.
-- ---------------------------------------------------------------------------

-- game time / runtime
create type public.quarter_status       as enum ('scheduled', 'active', 'closing', 'closed');
create type public.market_phase         as enum ('pre_market', 'open', 'after_hours', 'closed');
create type public.job_run_status       as enum ('running', 'succeeded', 'failed');

-- ledger
create type public.ledger_account_kind  as enum ('player_cash', 'player_reserve', 'company_cash', 'company_reserve', 'system');
create type public.ledger_tx_kind       as enum (
  'opening_balance', 'starting_capital', 'restart_capital', 'vault_claim', 'salary', 'work_bonus',
  'mission_reward', 'login_bonus', 'achievement_reward', 'opening_bell_bonus',
  'trade_buy', 'trade_sell', 'order_reserve', 'order_release', 'fee', 'tax', 'tax_refund',
  'dividend', 'coupon', 'bond_redemption', 'margin_interest', 'short_borrow_fee', 'liquidation',
  'option_premium', 'option_settlement',
  'company_founding', 'company_conversion', 'capital_injection', 'company_revenue', 'company_costs', 'payroll',
  'loan_disbursement', 'loan_repayment', 'loan_interest',
  'angel_investment', 'ipo_subscription', 'ipo_refund', 'ipo_proceeds', 'capital_increase', 'buyback',
  'takeover', 'insolvency_distribution',
  'lifestyle_purchase', 'lifestyle_sale', 'lifestyle_upkeep', 'random_event', 'fine',
  'transfer', 'admin_adjustment', 'reversal'
);

-- securities / market data
create type public.security_kind        as enum ('stock', 'bond', 'index', 'option', 'commodity');
create type public.security_status      as enum ('pending', 'listed', 'halted', 'delisted', 'matured');
create type public.candle_interval      as enum ('1m', '5m', '1h', '1q', '1y');
create type public.book_side            as enum ('bid', 'ask');
create type public.option_type          as enum ('call', 'put');
create type public.analyst_rating_kind  as enum ('strong_buy', 'buy', 'hold', 'sell', 'strong_sell');

-- trading
create type public.order_side           as enum ('buy', 'sell');
create type public.order_type           as enum ('market', 'limit', 'stop');
create type public.order_status         as enum ('pending', 'open', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired');
create type public.order_source         as enum ('player', 'liquidation', 'system');
create type public.time_in_force        as enum ('day', 'gtc');
create type public.position_side        as enum ('long', 'short');
create type public.position_status      as enum ('open', 'closed', 'liquidated');
create type public.trade_counterparty   as enum ('market_maker', 'player', 'ai_investor', 'issuer');
create type public.margin_event_level   as enum ('warning', 'margin_call', 'liquidation');
create type public.financing_kind       as enum ('leverage_interest', 'short_borrow_fee');
create type public.distribution_kind    as enum ('dividend', 'coupon', 'redemption');
create type public.distribution_status  as enum ('declared', 'ex', 'paid', 'cancelled');
create type public.snapshot_granularity as enum ('5m', '1h', '1d');

-- companies / employees
create type public.company_tier         as enum ('bluechip', 'midcap', 'penny');
create type public.legal_form           as enum ('small_business', 'gmbh', 'ag');
create type public.company_phase        as enum ('private', 'ipo', 'listed', 'insolvent', 'dissolved');
create type public.dividend_policy      as enum ('none', 'stable', 'growth', 'payout');
create type public.product_status       as enum ('in_development', 'active', 'retired');
create type public.decision_status      as enum ('draft', 'submitted', 'applied');
create type public.employee_specialty   as enum ('development', 'sales', 'production', 'finance', 'marketing');
create type public.employee_role        as enum ('staff', 'team_lead', 'head_of_sales', 'cfo', 'cto', 'coo', 'ceo');
create type public.employee_status      as enum ('active', 'notice', 'left', 'fired', 'poached');
create type public.applicant_status     as enum ('available', 'hired', 'expired');
create type public.offer_status         as enum ('open', 'accepted', 'declined', 'withdrawn', 'expired');
create type public.option_grant_status  as enum ('active', 'fully_vested', 'forfeited', 'exercised', 'expired');
create type public.loan_status          as enum ('active', 'repaid', 'defaulted', 'written_off');
create type public.loan_payment_kind    as enum ('interest', 'principal', 'default_recovery');
create type public.insolvency_status    as enum ('warning', 'rescue_window', 'liquidating', 'rescued', 'closed');
create type public.takeover_kind        as enum ('rescue', 'friendly', 'hostile');
create type public.cap_holder_kind      as enum ('player', 'ai_investor', 'treasury', 'public_float');
create type public.share_issuance_kind  as enum ('founding', 'angel_round', 'ipo', 'capital_increase', 'option_exercise', 'buyback');
create type public.lockup_reason        as enum ('founder_ipo', 'angel', 'option_exercise', 'takeover');

-- IPO / governance
create type public.angel_offer_direction as enum ('company_offers', 'investor_bids');
create type public.ipo_status           as enum ('draft', 'filed', 'bookbuilding', 'priced', 'completed', 'failed', 'withdrawn');
create type public.proceeds_category    as enum ('expansion', 'personnel', 'reserve', 'financial_investments');
create type public.subscription_status  as enum ('pending', 'allocated', 'partially_allocated', 'rejected', 'refunded', 'cancelled');
create type public.guidance_outcome     as enum ('pending', 'beat', 'met', 'missed');
create type public.corporate_action_kind   as enum ('dividend', 'buyback', 'capital_increase', 'split');
create type public.corporate_action_status as enum ('announced', 'approved', 'executed', 'rejected', 'cancelled');
create type public.vote_kind            as enum ('dividend', 'remove_ceo', 'takeover', 'other');
create type public.vote_status          as enum ('scheduled', 'open', 'passed', 'rejected', 'cancelled');
create type public.vote_choice          as enum ('yes', 'no', 'abstain');
create type public.reputation_event_kind as enum (
  'guidance_met', 'guidance_missed', 'lockup_kept', 'post_ipo_dump', 'dividend_reliable', 'dividend_cut',
  'capital_increase', 'prospectus_kept', 'prospectus_violated', 'employee_retention', 'insider_violation',
  'ipo_failed', 'ipo_success', 'insolvency', 'player_bankruptcy', 'lifestyle_bonus', 'admin_adjustment'
);
create type public.insider_violation_status as enum ('undetected', 'detected', 'fined');

-- careers
create type public.job_tier             as enum ('intern', 'junior', 'senior', 'team_lead', 'c_level');
create type public.player_job_status    as enum ('active', 'ended');
create type public.job_end_reason       as enum ('quit', 'fired', 'switched', 'company_insolvent', 'promoted_out', 'admin');
create type public.work_task_kind       as enum ('analyst_estimate', 'sales_pick', 'finance_choice', 'generic');
create type public.work_task_status     as enum ('available', 'started', 'submitted', 'expired');
create type public.negotiation_outcome  as enum ('success', 'failure');

-- progression
create type public.xp_source            as enum (
  'trade', 'trade_profit', 'work_hour', 'work_task', 'mission', 'daily_login', 'streak_bonus',
  'company_quarter_profit', 'ipo_success', 'achievement', 'admin'
);
create type public.mission_kind         as enum ('daily', 'weekly', 'intro');
create type public.mission_status       as enum ('active', 'completed', 'claimed', 'expired');
create type public.cosmetic_kind        as enum ('avatar_part', 'profile_frame', 'title');
create type public.lifestyle_status     as enum ('owned', 'sold', 'repossessed');
create type public.random_event_effect  as enum ('cash_fixed', 'cash_percent', 'salary_offer', 'market_tip', 'xp', 'none');
create type public.random_event_status  as enum ('pending', 'accepted', 'declined', 'expired', 'resolved');
create type public.portfolio_visibility as enum ('private', 'friends', 'public');
create type public.ui_theme             as enum ('dark', 'light', 'system');
create type public.chart_style          as enum ('candles', 'line', 'area');

-- social / notifications
create type public.friendship_status    as enum ('pending', 'accepted', 'declined', 'blocked');
create type public.feed_visibility      as enum ('friends', 'public');
create type public.league_season_status as enum ('scheduled', 'active', 'finished');
create type public.push_delivery_status as enum ('queued', 'sent', 'failed', 'expired', 'capped');

-- events / news
create type public.scheduled_event_kind as enum (
  'rate_decision', 'earnings', 'pharma_trial', 'oil_report', 'opening_bell', 'closing_bell',
  'ipo_pricing', 'ipo_listing', 'shareholder_vote', 'dividend_ex', 'dividend_payment',
  'index_rebalance', 'bond_maturity', 'macro', 'custom'
);
create type public.scheduled_event_status as enum ('scheduled', 'in_progress', 'resolved', 'cancelled');
create type public.macro_event_kind     as enum ('sector_crisis', 'commodity_shock', 'recession', 'tech_boom', 'custom');
create type public.macro_event_status   as enum ('active', 'ended', 'cancelled');
create type public.news_category        as enum ('earnings', 'macro', 'central_bank', 'company', 'ipo', 'index', 'commodity', 'player', 'regulator', 'market');

-- admin / audit
create type public.suspicious_kind      as enum ('wash_trading', 'multi_account', 'rate_limit', 'ipo_new_account', 'insider', 'anomalous_transfer', 'other');

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

-- Maintains updated_at. Attached to every table that has the column
-- (see the loop in 20261110001300_triggers_rls_policies.sql).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Generic guard for append-only tables (ledger, audit logs, ...).
create or replace function public.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% on %.% is not allowed: rows are immutable', tg_op, tg_table_schema, tg_table_name
    using errcode = 'NX003';
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin registry. Deliberately a separate table that no client can write:
-- rows are inserted manually (SQL editor / service role) only.
-- ---------------------------------------------------------------------------
create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
create index admin_users_granted_by_idx on public.admin_users (granted_by);
comment on table public.admin_users is 'Admins of the game. Never client-writable; managed via SQL/service role only.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a where a.user_id = (select auth.uid())
  );
$$;
comment on function public.is_admin() is 'True when the calling JWT user is registered in admin_users.';
