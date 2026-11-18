-- =============================================================================
-- NEXA · 9800 · Clone with its own job, skill-scaled pay, profit share and employee shares (ADR-206)
-- =============================================================================
-- * Clone: from jobs.clone.minLevel (20) a player creates one clone (player_clones) for jobs.clone.feeCents, paid to
--   the treasury. The clone holds a second job row in player_jobs (is_clone = true) with the owner's player_id: the
--   wage goes into the owner's cash, the company counts it like any employee. One active job per player AND holder
--   (unique index player_jobs_active_holder_uq). The clone never works at a company the owner founded, and owner and
--   clone never work at the same company.
-- * The existing RPCs serve both holders: the clone_* wrappers set the transaction setting nexa.acting_clone and call
--   apply_for_job, sign_contract, quit_job, cancel_quit, request_raise and request_promotion, whose lookups of "the
--   player's job" read job_acting_clone() (migration 9810). Without the setting everything acts on the own job.
-- * Skill-scaled pay: job_skill_pay_bps(scores, learned skills, required) = 10 000 + perRelevantScoreBps x relevant
--   score (each required branch counted up to relevantScoreCapPerBranch) + perLearnedSkillBps x learned skills, at
--   most capMultiplier x 10 000 (jobs.skillPay). job_pay_ceiling() is the most an AI employer pays and the
--   "market value" shown for player postings.
-- * Rewards (job_rewards, jobs.rewards): from Senior a profit share of the employer's profit (rank share, plus what
--   a player posting offers, at most maxProfitShareBps), and now and then employee shares for good work (present and
--   the company in profit). Player companies: after every closed hour (trigger on player_company_hours), all shares
--   together at most maxTotalProfitShareBps of the hour's profit, never more than the cash. AI companies: with every
--   salary payout (trigger on salary_payouts), on the profit of a department of aiDepartmentSize people, at most
--   aiMaxShareOfWageBps of the wage. Shares of a listed company come from the free float (ADR-153): the company pays
--   the market for them, so the supply never grows; unlisted companies pay the value in cash.
-- * Postings: job_postings.profit_share_bps / stock_grant_bps, set by the founder with set_job_posting_perks().
-- * Errors: clone_level_too_low NX320, clone_exists NX321, clone_missing NX322, clone_own_company NX323,
--   clone_same_company NX324.
-- Idempotent: runs unchanged as supabase/updates/20261204009800_clone_jobs.sql.

-- ---------------------------------------------------------------------------
-- A. Error keys
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
begin
  if position('''clone_same_company''' in v_def) = 0 then
    v_def := replace(v_def, $q$    else 'NX007'
$q$, $q$    when 'clone_level_too_low'        then 'NX320'
    when 'clone_exists'               then 'NX321'
    when 'clone_missing'              then 'NX322'
    when 'clone_own_company'          then 'NX323'
    when 'clone_same_company'         then 'NX324'
    else 'NX007'
$q$);
    if position('''clone_same_company''' in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the clone error keys by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- B. Notification type
-- ---------------------------------------------------------------------------
insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('job_reward', 'career', 'Mitarbeiteraktien', 'Für gute Arbeit gibt es Aktien deines Arbeitgebers.', 'notif_salary',
        true, false, false, 147)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- C. Tables and columns
-- ---------------------------------------------------------------------------
create table if not exists public.player_clones (
  player_id  uuid primary key references public.profiles (id) on delete cascade,
  request_id uuid not null,
  fee_cents  bigint not null check (fee_cents >= 0),
  created_at timestamptz not null default now()
);
alter table public.player_clones enable row level security;
comment on table public.player_clones is 'The one clone of a player (ADR-206). Internal: read and written by the clone RPCs.';

alter table public.player_jobs add column if not exists is_clone boolean not null default false;
alter table public.player_jobs add column if not exists profit_share_bonus_bps integer not null default 0;
alter table public.player_jobs add column if not exists stock_grant_bonus_bps integer not null default 0;
alter table public.job_applications add column if not exists for_clone boolean not null default false;
alter table public.job_postings add column if not exists profit_share_bps integer not null default 0;
alter table public.job_postings add column if not exists stock_grant_bps integer not null default 0;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_postings_perks_check') then
    alter table public.job_postings add constraint job_postings_perks_check
      check (profit_share_bps between 0 and 10000 and stock_grant_bps between 0 and 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'player_jobs_perks_check') then
    alter table public.player_jobs add constraint player_jobs_perks_check
      check (profit_share_bonus_bps between 0 and 10000 and stock_grant_bonus_bps between 0 and 10000);
  end if;
end;
$do$;
-- one active job per player and holder (own job, clone job)
create unique index if not exists player_jobs_active_holder_uq on public.player_jobs (player_id, is_clone) where status = 'active';
drop index if exists public.player_jobs_active_uq;
comment on column public.player_jobs.is_clone is 'The job of the player''s clone (ADR-206); the wage goes to the player.';

create table if not exists public.job_rewards (
  id                    bigint generated always as identity primary key,
  player_job_id         uuid not null references public.player_jobs (id) on delete cascade,
  player_id             uuid not null references public.profiles (id) on delete cascade,
  company_id            uuid not null references public.companies (id) on delete cascade,
  kind                  text not null check (kind in ('profit_share', 'stock_grant', 'stock_grant_cash')),
  amount_cents          bigint not null check (amount_cents >= 0),
  quantity_e6           bigint not null default 0 check (quantity_e6 >= 0),
  price_e4              bigint,
  share_bps             integer,
  base_cents            bigint,
  source_key            text not null unique,
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at            timestamptz not null default now()
);
alter table public.job_rewards enable row level security;
create index if not exists job_rewards_job_idx on public.job_rewards (player_job_id, created_at desc);
create index if not exists job_rewards_player_idx on public.job_rewards (player_id, created_at desc);
create index if not exists job_rewards_ledger_tx_idx on public.job_rewards (ledger_transaction_id);
create index if not exists job_rewards_company_idx on public.job_rewards (company_id);
comment on table public.job_rewards is 'Profit shares and employee shares of a job (ADR-206). Internal: shown through job_state().';

-- ---------------------------------------------------------------------------
-- D. Holder, names, pay and reward rates
-- ---------------------------------------------------------------------------
-- true inside a clone_* wrapper: the job RPCs then act on the clone's job
create or replace function public.job_acting_clone()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('nexa.acting_clone', true), '') = 'on';
$$;

create or replace function public.job_holder_name(p_player uuid, p_clone boolean)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(p_clone, false) then 'Klon von ' else '' end || coalesce(p.nickname, '?')
    from public.profiles p where p.id = p_player;
$$;

-- pay factor from skills (ADR-206): relevant branch scores (capped per branch) and all learned skills
create or replace function public.job_skill_pay_bps(p_scores jsonb, p_skills integer, p_required jsonb)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(round(10000 * public.config_double('jobs', '{skillPay,capMultiplier}', 3))::bigint,
               10000
               + public.config_double('jobs', '{skillPay,perRelevantScoreBps}', 300)::bigint
                 * coalesce((select sum(least(greatest(coalesce((p_scores ->> (r ->> 'branch'))::integer, 0), 0),
                                              public.config_double('jobs', '{skillPay,relevantScoreCapPerBranch}', 40)::integer))
                               from jsonb_array_elements(coalesce(p_required, '[]'::jsonb)) r), 0)
               + public.config_double('jobs', '{skillPay,perLearnedSkillBps}', 50)::bigint * greatest(coalesce(p_skills, 0), 0)
         )::integer;
$$;

create or replace function public.player_skill_count(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.player_skills s where s.player_id = p_player;
$$;

-- the most an AI employer pays this player for this base wage and these requirements; the player's market value
create or replace function public.job_pay_ceiling(p_player uuid, p_base bigint, p_required jsonb)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select round(coalesce(p_base, 0)::numeric
               * public.job_skill_pay_bps(public.player_branch_scores(p_player), public.player_skill_count(p_player), p_required)
               / 10000)::bigint;
$$;

-- profit share of a job: the rank share from Senior on, plus what the posting offered, at most maxProfitShareBps
create or replace function public.job_profit_share_bps(p_tier text, p_bonus integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when coalesce(public.config_double('jobs', array['rewards', 'profitShareBpsByTier', p_tier], 0), 0) <= 0 then 0
              else least(public.config_double('jobs', '{rewards,maxProfitShareBps}', 500)::integer,
                         public.config_double('jobs', array['rewards', 'profitShareBpsByTier', p_tier], 0)::integer
                         + greatest(coalesce(p_bonus, 0), 0)) end;
$$;

-- chance per paid hour of good work for employee shares: rank chance plus the posting's extra
create or replace function public.job_stock_grant_bps(p_tier text, p_bonus integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(10000, greatest(0, public.config_double('jobs', array['rewards', 'stockGrantChanceBpsByTier', p_tier], 0)::integer)
                      + greatest(coalesce(p_bonus, 0), 0));
$$;

-- totals of the rewards of a job, for job_state()
create or replace function public.job_rewards_json(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profit_share_cents', coalesce(sum(r.amount_cents) filter (where r.kind = 'profit_share'), 0),
    'stock_grants', count(*) filter (where r.kind in ('stock_grant', 'stock_grant_cash')),
    'stock_grant_cents', coalesce(sum(r.amount_cents) filter (where r.kind in ('stock_grant', 'stock_grant_cash')), 0),
    'shares_e6', coalesce(sum(r.quantity_e6) filter (where r.kind = 'stock_grant'), 0),
    'last', (select jsonb_build_object('kind', x.kind, 'amount_cents', x.amount_cents, 'quantity_e6', x.quantity_e6,
                                       'created_at', x.created_at)
               from public.job_rewards x where x.player_job_id = p_job order by x.created_at desc, x.id desc limit 1))
    from public.job_rewards r where r.player_job_id = p_job;
$$;

-- ---------------------------------------------------------------------------
-- E. Employee shares
-- ---------------------------------------------------------------------------
-- One grant worth rewards.stockGrantValueHours x contract wage, paid by the company. Listed company: whole shares
-- from the free float (ADR-153) at the last price, the money goes to the market (the shares' seller); never more than
-- the free float, so the supply stays. Unlisted (or nothing free): the value in cash. Never more than the cash.
create or replace function public.job_stock_grant(p_job uuid, p_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  j       public.player_jobs;
  c       public.companies;
  v_acc   uuid;
  v_value bigint;
  v_price bigint;
  v_free  bigint;
  v_qty   bigint := 0;
  v_tx    uuid;
  v_kind  text;
begin
  if exists (select 1 from public.job_rewards r where r.source_key = 'grant:' || p_key) then
    return 0;
  end if;
  select * into j from public.player_jobs where id = p_job and status = 'active';
  if j.id is null then
    return 0;
  end if;
  select * into c from public.companies where id = j.company_id;
  v_acc := public.company_cash_account(j.company_id);
  v_value := round(j.salary_cents_per_hour * public.config_double('jobs', '{rewards,stockGrantValueHours}', 4))::bigint;
  v_value := least(v_value, greatest(0, coalesce((select a.balance_cents from public.ledger_accounts a where a.id = v_acc), 0)));
  if v_value <= 0 or v_acc is null then
    return 0;
  end if;
  perform public.lock_player_accounts(j.player_id);
  if c.security_id is not null and c.phase = 'listed' and c.shares_outstanding is not null then
    -- buyers of the same share queue on the security (ADR-153)
    perform 1 from public.securities s where s.id = c.security_id for update;
    select q.last_price_e4 into v_price from public.security_quotes q where q.security_id = c.security_id;
    if coalesce(v_price, 0) > 0 then
      v_free := coalesce(public.security_free_float_e6(c.security_id), 0);
      v_qty := least(floor(v_value::numeric * 100000000 / v_price / 1000000)::bigint * 1000000,
                     (v_free / 1000000) * 1000000);
    end if;
  end if;
  if v_qty > 0 then
    v_value := public.value_cents(v_qty, v_price);
    v_kind := 'stock_grant';
    v_tx := public.ledger_transfer(v_acc, public.ledger_system_account('market'), v_value, 'payroll',
                                   'Mitarbeiteraktien für ' || public.job_holder_name(j.player_id, j.is_clone),
                                   'player_job', j.id, 'job_grant:' || p_key, j.player_id);
    perform public.grant_position(j.player_id, c.security_id, v_qty, v_price);
  else
    v_kind := 'stock_grant_cash';
    v_tx := public.ledger_transfer(v_acc, public.ledger_player_account(j.player_id, 'player_cash'), v_value, 'salary',
                                   'Mitarbeiteraktien (Wertausgleich)', 'player_job', j.id, 'job_grant:' || p_key, j.player_id);
    perform public.loan_withhold(j.player_id, v_value, 'job_grant:' || p_key);
  end if;
  insert into public.job_rewards (player_job_id, player_id, company_id, kind, amount_cents, quantity_e6, price_e4, source_key,
                                  ledger_transaction_id)
  values (j.id, j.player_id, j.company_id, v_kind, v_value, v_qty, v_price, 'grant:' || p_key, v_tx);
  perform public.social_notify(j.player_id, 'job_reward', 'Mitarbeiteraktien',
    case when v_kind = 'stock_grant'
         then 'Für gute Arbeit bekommst du ' || (v_qty / 1000000) || ' Aktien von ' || c.name || ' im Wert von '
              || public.format_eur(v_value) || '.'
         else 'Für gute Arbeit zahlt ' || c.name || ' dir den Wert von Mitarbeiteraktien aus: ' || public.format_eur(v_value) || '.' end
    || case when j.is_clone then ' (Job deines Klons)' else '' end,
    jsonb_build_object('player_job_id', j.id, 'company', c.name, 'kind', v_kind, 'amount_cents', v_value, 'quantity_e6', v_qty),
    '/job', 'job_reward:' || p_key);
  return v_value;
end;
$$;

-- deterministic roll in [0, 10 000) for a key (no random(): the same hour never rolls twice differently)
create or replace function public.job_reward_roll(p_key text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (abs(hashtextextended(p_key, 0)) % 10000)::integer;
$$;

-- ---------------------------------------------------------------------------
-- F. Rewards after a closed hour of a player company
-- ---------------------------------------------------------------------------
create or replace function public.job_rewards_company_hour(p_company uuid, p_hour timestamptz, p_profit bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc   uuid := public.company_cash_account(p_company);
  v_fdr   uuid;
  v_total bigint;
  v_cap   bigint := public.config_double('jobs', '{rewards,maxTotalProfitShareBps}', 2500)::bigint;
  v_bps   integer;
  v_amt   bigint;
  v_cash  bigint;
  v_tx    uuid;
  v_key   text;
  v_sum   bigint := 0;
  j       record;
begin
  if coalesce(p_profit, 0) <= 0 or v_acc is null then
    return 0;
  end if;
  select pc.founder_id into v_fdr from public.player_companies pc where pc.company_id = p_company;
  select coalesce(sum(public.job_profit_share_bps(pj.tier::text, pj.profit_share_bonus_bps)), 0) into v_total
    from public.player_jobs pj where pj.company_id = p_company and pj.status = 'active' and pj.player_id is distinct from v_fdr;
  for j in select pj.id, pj.player_id, pj.tier::text as tier, pj.profit_share_bonus_bps, pj.stock_grant_bonus_bps, pj.is_clone
             from public.player_jobs pj
            where pj.company_id = p_company and pj.status = 'active' and pj.player_id is distinct from v_fdr
            order by pj.id loop
    v_key := j.id::text || ':' || floor(extract(epoch from p_hour))::bigint::text;
    v_bps := public.job_profit_share_bps(j.tier, j.profit_share_bonus_bps);
    if v_bps > 0 and not exists (select 1 from public.job_rewards r where r.source_key = 'profit:' || v_key) then
      -- all shares of the hour together at most maxTotalProfitShareBps of the profit (scaled down evenly)
      v_amt := p_profit * v_bps * least(v_total, v_cap) / greatest(v_total, 1) / 10000;
      select a.balance_cents into v_cash from public.ledger_accounts a where a.id = v_acc;
      v_amt := least(v_amt, greatest(0, coalesce(v_cash, 0)));
      if v_amt > 0 then
        perform public.lock_player_accounts(j.player_id);
        v_tx := public.ledger_transfer(v_acc, public.ledger_player_account(j.player_id, 'player_cash'), v_amt, 'salary',
                                       'Gewinnbeteiligung', 'player_job', j.id, 'job_profit:' || v_key, j.player_id);
        perform public.loan_withhold(j.player_id, v_amt, 'job_profit:' || v_key);
        insert into public.job_rewards (player_job_id, player_id, company_id, kind, amount_cents, share_bps, base_cents,
                                        source_key, ledger_transaction_id)
        values (j.id, j.player_id, p_company, 'profit_share', v_amt, v_bps, p_profit, 'profit:' || v_key, v_tx);
        v_sum := v_sum + v_amt;
      end if;
    end if;
    -- good work: present the whole hour and the company in profit
    if public.job_stock_grant_bps(j.tier, j.stock_grant_bonus_bps) > public.job_reward_roll('grant:' || v_key)
       and public.presence_pay_bps_between(j.player_id, p_hour, 60) >= 10000 then
      v_sum := v_sum + public.job_stock_grant(j.id, v_key);
    end if;
  end loop;
  return v_sum;
end;
$$;

create or replace function public.job_rewards_company_hour_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.job_rewards_company_hour(new.company_id, new.hour_start, new.profit_cents);
  return null;
end;
$$;

drop trigger if exists job_rewards_company_hour on public.player_company_hours;
create trigger job_rewards_company_hour after insert on public.player_company_hours
  for each row execute function public.job_rewards_company_hour_trg();

-- ---------------------------------------------------------------------------
-- G. Rewards with a salary payout at an AI company
-- ---------------------------------------------------------------------------
-- The profit of an AI company is huge; an employee shares the profit of a department of aiDepartmentSize people:
-- hourly profit = ttm net income / 4 / quarter hours x aiDepartmentSize / max(employees, aiDepartmentSize), and
-- never more than aiMaxShareOfWageBps of the wage of the paid minutes.
create or replace function public.job_rewards_ai_payout(p_payout bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp      public.salary_payouts;
  j       public.player_jobs;
  c       public.companies;
  q       public.game_quarters;
  v_acc   uuid;
  v_qh    double precision;
  v_dept  double precision := public.config_double('jobs', '{rewards,aiDepartmentSize}', 50);
  v_base  bigint;
  v_bps   integer;
  v_amt   bigint;
  v_cash  bigint;
  v_tx    uuid;
  v_key   text;
  v_sum   bigint := 0;
begin
  select * into sp from public.salary_payouts where id = p_payout;
  if sp.id is null or sp.amount_cents <= 0 or sp.minutes_paid <= 0 then
    return 0;
  end if;
  select * into j from public.player_jobs where id = sp.player_job_id;
  select * into c from public.companies where id = j.company_id;
  if j.id is null or not coalesce(c.is_ai, false) or coalesce(c.ttm_net_income_cents, 0) <= 0 then
    return 0;
  end if;
  v_acc := public.company_cash_account(c.id);
  v_key := j.id::text || ':p' || sp.id::text;
  q := public.current_game_quarter();
  v_qh := greatest(1, coalesce(extract(epoch from (q.ends_at - q.starts_at)) / 3600, 6));
  v_base := floor(c.ttm_net_income_cents / 4.0 / v_qh * v_dept / greatest(coalesce(c.employee_count, 0)::double precision, v_dept)
                  * sp.minutes_paid / 60.0)::bigint;
  v_bps := public.job_profit_share_bps(j.tier::text, j.profit_share_bonus_bps);
  if v_bps > 0 and v_base > 0 then
    v_amt := least(v_base * v_bps / 10000,
                   j.salary_cents_per_hour * sp.minutes_paid / 60
                   * public.config_double('jobs', '{rewards,aiMaxShareOfWageBps}', 5000)::bigint / 10000);
    select a.balance_cents into v_cash from public.ledger_accounts a where a.id = v_acc;
    v_amt := least(v_amt, greatest(0, coalesce(v_cash, 0)));
    if v_amt > 0 then
      v_tx := public.ledger_transfer(v_acc, public.ledger_player_account(j.player_id, 'player_cash'), v_amt, 'salary',
                                     'Gewinnbeteiligung', 'player_job', j.id, 'job_profit:' || v_key, j.player_id);
      perform public.loan_withhold(j.player_id, v_amt, 'job_profit:' || v_key);
      insert into public.job_rewards (player_job_id, player_id, company_id, kind, amount_cents, share_bps, base_cents,
                                      source_key, ledger_transaction_id)
      values (j.id, j.player_id, c.id, 'profit_share', v_amt, v_bps, v_base, 'profit:' || v_key, v_tx)
      on conflict (source_key) do nothing;
      v_sum := v_amt;
    end if;
  end if;
  -- good work: the paid minutes fully present; the chance per hour scales with the paid minutes
  if public.job_stock_grant_bps(j.tier::text, j.stock_grant_bonus_bps) * least(sp.minutes_paid, 60) / 60
       > public.job_reward_roll('grant:' || v_key)
     and sp.base_amount_cents >= j.salary_cents_per_hour * sp.minutes_paid / 60 then
    v_sum := v_sum + public.job_stock_grant(j.id, v_key);
  end if;
  return v_sum;
end;
$$;

create or replace function public.job_rewards_payout_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.player_jobs pj join public.companies c on c.id = pj.company_id
              where pj.id = new.player_job_id and c.is_ai) then
    perform public.job_rewards_ai_payout(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists job_rewards_payout on public.salary_payouts;
create trigger job_rewards_payout after insert on public.salary_payouts
  for each row execute function public.job_rewards_payout_trg();

-- ---------------------------------------------------------------------------
-- H. Posting perks (founders)
-- ---------------------------------------------------------------------------
create or replace function public.set_job_posting_perks(p_request_id uuid, p_posting_id uuid, p_profit_share_bps integer,
                                                        p_stock_grant_bps integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  p        public.job_postings;
begin
  v_player := public.require_player();
  if p_request_id is null or p_profit_share_bps is null or p_stock_grant_bps is null
     or p_profit_share_bps not between 0 and public.config_double('jobs', '{rewards,maxPostingProfitShareBps}', 300)
     or p_stock_grant_bps not between 0 and public.config_double('jobs', '{rewards,maxPostingStockGrantBps}', 500) then
    perform public.api_error('invalid_argument');
  end if;
  select * into p from public.job_postings where id = p_posting_id;
  if p.id is null or p.is_ai then
    perform public.api_error('job_not_found');
  end if;
  perform public.require_company_owner(p.company_id);
  v_replay := public.request_begin(v_player, p_request_id, 'set_job_posting_perks');
  if v_replay is not null then
    return v_replay;
  end if;
  update public.job_postings set profit_share_bps = p_profit_share_bps, stock_grant_bps = p_stock_grant_bps
   where id = p.id;
  return public.request_complete(v_player, p_request_id, public.posting_json(p.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- I. The clone
-- ---------------------------------------------------------------------------
create or replace function public.clone_require()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid := public.require_player();
begin
  if not exists (select 1 from public.player_clones c where c.player_id = v_player) then
    perform public.api_error('clone_missing');
  end if;
  if (select p.level from public.profiles p where p.id = v_player) < public.config_double('jobs', '{clone,minLevel}', 20) then
    perform public.api_error('clone_level_too_low');
  end if;
  return v_player;
end;
$$;

create or replace function public.clone_state(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clone public.player_clones;
  v_job   jsonb;
begin
  select * into v_clone from public.player_clones where player_id = p_player;
  if v_clone.player_id is not null then
    perform set_config('nexa.acting_clone', 'on', true);
    v_job := public.job_state(p_player) -> 'job';
    perform set_config('nexa.acting_clone', '', true);
  end if;
  return jsonb_build_object(
    'min_level', public.config_double('jobs', '{clone,minLevel}', 20)::integer,
    'fee_cents', public.config_double('jobs', '{clone,feeCents}', 2500000)::bigint,
    'level', (select p.level from public.profiles p where p.id = p_player),
    'clone', case when v_clone.player_id is not null
                  then jsonb_build_object('name', public.job_holder_name(p_player, true), 'created_at', v_clone.created_at) end,
    'job', v_job);
end;
$$;

create or replace function public.get_clone()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.clone_state(public.require_player());
end;
$$;

create or replace function public.create_clone(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_fee    bigint := public.config_double('jobs', '{clone,feeCents}', 2500000)::bigint;
  v_cash   bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'create_clone');
  if v_replay is not null then
    return v_replay;
  end if;
  v_cash := public.lock_player_accounts(v_player);
  perform 1 from public.profiles p where p.id = v_player for update;
  if (select p.level from public.profiles p where p.id = v_player) < public.config_double('jobs', '{clone,minLevel}', 20) then
    perform public.api_error('clone_level_too_low');
  end if;
  if exists (select 1 from public.player_clones c where c.player_id = v_player) then
    perform public.api_error('clone_exists');
  end if;
  if v_cash < v_fee then
    perform public.api_error('insufficient_funds');
  end if;
  if v_fee > 0 then
    perform public.ledger_transfer(public.ledger_player_account(v_player, 'player_cash'), public.ledger_system_account('treasury'),
                                   v_fee, 'fee', 'Klon erstellt', 'profile', v_player, 'clone:' || v_player::text, v_player);
  end if;
  insert into public.player_clones (player_id, request_id, fee_cents) values (v_player, p_request_id, v_fee);
  return public.request_complete(v_player, p_request_id, public.clone_state(v_player));
end;
$$;

-- The clone versions of the job RPCs: the same rules and answers, on the clone's job.
create or replace function public.clone_apply_for_job(p_request_id uuid, p_posting_id uuid, p_salary_wish_cents_per_hour bigint,
                                                      p_message text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.clone_require();
  perform set_config('nexa.acting_clone', 'on', true);
  v := public.apply_for_job(p_request_id, p_posting_id, p_salary_wish_cents_per_hour, p_message);
  perform set_config('nexa.acting_clone', '', true);
  return v;
end;
$$;

create or replace function public.clone_sign_contract(p_request_id uuid, p_application_id uuid, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.clone_require();
  perform set_config('nexa.acting_clone', 'on', true);
  v := public.sign_contract(p_request_id, p_application_id, p_signature);
  perform set_config('nexa.acting_clone', '', true);
  return v;
end;
$$;

create or replace function public.clone_quit_job(p_request_id uuid, p_immediate boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  -- quitting works even below the level gate (e.g. after an account reset)
  perform public.require_player();
  perform set_config('nexa.acting_clone', 'on', true);
  v := public.quit_job(p_request_id, p_immediate);
  perform set_config('nexa.acting_clone', '', true);
  return v;
end;
$$;

create or replace function public.clone_cancel_quit(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.clone_require();
  perform set_config('nexa.acting_clone', 'on', true);
  v := public.cancel_quit(p_request_id);
  perform set_config('nexa.acting_clone', '', true);
  return v;
end;
$$;

create or replace function public.clone_request_raise(p_request_id uuid, p_raise_bps integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.clone_require();
  perform set_config('nexa.acting_clone', 'on', true);
  v := public.request_raise(p_request_id, p_raise_bps);
  perform set_config('nexa.acting_clone', '', true);
  return v;
end;
$$;

create or replace function public.clone_request_promotion(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.clone_require();
  perform set_config('nexa.acting_clone', 'on', true);
  v := public.request_promotion(p_request_id);
  perform set_config('nexa.acting_clone', '', true);
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- J. Grants: only the RPCs are callable by players
-- ---------------------------------------------------------------------------
do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.job_holder_name(uuid, boolean)', 'public.job_skill_pay_bps(jsonb, integer, jsonb)', 'public.player_skill_count(uuid)',
    'public.job_pay_ceiling(uuid, bigint, jsonb)', 'public.job_profit_share_bps(text, integer)',
    'public.job_stock_grant_bps(text, integer)', 'public.job_rewards_json(uuid)', 'public.job_stock_grant(uuid, text)',
    'public.job_rewards_company_hour(uuid, timestamptz, bigint)', 'public.job_rewards_company_hour_trg()',
    'public.job_rewards_ai_payout(bigint)', 'public.job_rewards_payout_trg()', 'public.clone_require()',
    'public.clone_state(uuid)', 'public.job_acting_clone()', 'public.job_reward_roll(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.get_clone()', 'public.create_clone(uuid)', 'public.clone_apply_for_job(uuid, uuid, bigint, text)',
    'public.clone_sign_contract(uuid, uuid, text)', 'public.clone_quit_job(uuid, boolean)', 'public.clone_cancel_quit(uuid)',
    'public.clone_request_raise(uuid, integer)', 'public.clone_request_promotion(uuid)',
    'public.set_job_posting_perks(uuid, uuid, integer, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$do$;
