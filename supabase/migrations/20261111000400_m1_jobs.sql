-- =============================================================================
-- NEXA · M1 · 0400 · Quarter close (minimal), bond lifecycle, price history
--                    backfill, bootstrap, run_due_jobs(), admin RPCs
-- =============================================================================

-- News headlines for quarterly figures (bodies reuse earnings_beat/miss/inline).
insert into public.news_templates (key, category, headline_template, body_template, sentiment, importance) values
  ('earnings_profit_up',      'earnings', '{company} steigert Gewinn um {pct}',        null,  0.3, 1),
  ('earnings_profit_down',    'earnings', '{company}: Gewinn sinkt um {pct}',          null, -0.3, 1),
  ('earnings_profit_flat',    'earnings', '{company} hält den Gewinn stabil',          null,  0.0, 1),
  ('earnings_back_to_profit', 'earnings', '{company} schreibt wieder schwarze Zahlen', null,  0.5, 2),
  ('earnings_into_loss',      'earnings', '{company} rutscht in die Verlustzone',      null, -0.5, 2),
  ('earnings_loss_smaller',   'earnings', '{company} verringert den Verlust',          null,  0.2, 1),
  ('earnings_loss_larger',    'earnings', '{company} weitet den Verlust aus',          null, -0.2, 1),
  ('bond_new_series',         'market',   'Neue Staatsanleihe: {name}',                'Der Staat gibt eine neue Anleihe mit {term} Laufzeit aus. Kupon: {coupon} pro Spieljahr.', 0.0, 1),
  ('bond_matured',            'market',   '{name} ist fällig',                         'Die Anleihe wurde zum Nennwert zurückgezahlt.', 0.0, 1)
on conflict (key) do nothing;

-- German short money text for news: "420,0 Mio. €", "1,96 Mrd. €", "400 Tsd. €".
create or replace function public.format_eur_short(p_cents bigint)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_abs  numeric := abs(coalesce(p_cents, 0));
  v_sign text := case when coalesce(p_cents, 0) < 0 then '-' else '' end;
begin
  if v_abs >= 100000000000 then
    return v_sign || replace(to_char(v_abs / 100000000000, 'FM999990.00'), '.', ',') || ' Mrd. €';
  elsif v_abs >= 100000000 then
    return v_sign || replace(to_char(v_abs / 100000000, 'FM999990.0'), '.', ',') || ' Mio. €';
  elsif v_abs >= 100000 then
    return v_sign || to_char(round(v_abs / 100000), 'FM999990') || ' Tsd. €';
  end if;
  return v_sign || to_char(round(v_abs / 100), 'FM999990') || ' €';
end;
$$;

-- Fair value from published fundamentals (fairValueE4 in src/lib/sim/fair-value.ts);
-- NULL for loss makers (they keep their anchor, see simulate_ai_companies).
create or replace function public.fair_value_from_fundamentals(p_company_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.companies;
  v_val    jsonb := coalesce(public.config_jsonb('valuation'), '{}'::jsonb);
  v_sec    jsonb;
  v_policy integer;
  v_pe     double precision;
  v_growth double precision := 0;
  v_recent numeric;
  v_prev   numeric;
  v_n      integer;
  v_macro  double precision;
  v_fv     double precision;
begin
  select * into c from public.companies where id = p_company_id;
  if c.id is null or c.shares_outstanding <= 0 or c.ttm_net_income_cents <= 0 then
    return null;
  end if;
  v_sec := coalesce(public.config_jsonb('sectors', array[c.sector_key]), '{}'::jsonb);
  v_pe := public.cfg_num(v_sec, '{peRatio}', coalesce((select s.base_pe from public.sectors s where s.key = c.sector_key), 15));
  select count(*), sum(x.revenue_cents) filter (where x.rn <= 4), sum(x.revenue_cents) filter (where x.rn > 4)
    into v_n, v_recent, v_prev
    from (select r.revenue_cents, row_number() over (order by gq.starts_at desc) as rn
            from public.company_quarter_reports r
            join public.game_quarters gq on gq.id = r.game_quarter_id
           where r.company_id = c.id and r.published_at is not null
           order by gq.starts_at desc limit 8) x;
  if v_n >= 8 and v_prev > 0 then
    v_growth := v_recent / v_prev - 1;
  end if;
  select cb.policy_rate_bps into v_policy from public.central_bank_state cb where cb.id;
  v_macro := greatest(public.cfg_num(v_val, '{macroFactorMin}', 0.6), least(public.cfg_num(v_val, '{macroFactorMax}', 1.3),
               1 - public.cfg_num(v_val, '{macroSensitivityPer100Bps}', 0.04)
                 * public.cfg_num(v_sec, '{sensitivity,valuationRate}', 1)
                 * (coalesce(v_policy, 300) - public.config_double('centralBank', '{neutralRateBps}', 300)) / 100.0));
  v_fv := (c.ttm_net_income_cents::double precision / c.shares_outstanding)        -- EPS in cents
        * v_pe
        * greatest(public.cfg_num(v_val, '{growthFactorMin}', 0.6),
                   least(public.cfg_num(v_val, '{growthFactorMax}', 1.8), 1 + public.cfg_num(v_val, '{growthWeight}', 1) * v_growth))
        * v_macro
        * 100;                                                                        -- cents -> e4
  return greatest(public.config_double('trading', '{minPriceE4}', 1)::bigint, round(v_fv)::bigint);
end;
$$;

-- Sets the anchor of every profitable AI stock from its fundamentals.
create or replace function public.recompute_fair_values()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r    record;
  v_fv bigint;
  v_n  integer := 0;
begin
  for r in
    select c.id, c.security_id from public.companies c
     where c.is_ai and c.phase = 'listed' and c.security_id is not null
  loop
    v_fv := public.fair_value_from_fundamentals(r.id);
    if v_fv is not null then
      update public.security_sim_state set fair_value_e4 = v_fv where security_id = r.security_id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Quarterly figures of the AI companies, fair value, earnings news
-- ---------------------------------------------------------------------------
create or replace function public.simulate_ai_companies(p_quarter_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q          public.game_quarters;
  v_company  jsonb := coalesce(public.config_jsonb('company'), '{}'::jsonb);
  v_val      jsonb := coalesce(public.config_jsonb('valuation'), '{}'::jsonb);
  v_events   jsonb := coalesce(public.config_jsonb('events'), '{}'::jsonb);
  v_qpy      double precision := greatest(1, public.config_double('time', '{quartersPerGameYear}', 4));
  v_persist  double precision := public.cfg_num(v_company, '{aiPolicy,revenueNoisePersistence}', 0.3);
  v_costnz   double precision := public.cfg_num(v_company, '{aiPolicy,costNoiseShare}', 0.25);
  v_elastic  double precision := public.cfg_num(v_val, '{lossMakerRevenueElasticity}', 0.5);
  v_floor    double precision := public.cfg_num(v_val, '{bookValueFloorShare}', 0.5);
  v_minprice bigint := greatest(1, public.config_double('trading', '{minPriceE4}', 1))::bigint;
  r          record;
  v_sec      jsonb;
  v_g        double precision;
  v_noise    double precision;
  v_var      double precision;
  v_rev      bigint;
  v_cost     bigint;
  v_net      bigint;
  v_expected bigint;
  v_prev_net bigint;
  v_prev_rev bigint;
  v_ttm_rev  bigint;
  v_ttm_net  bigint;
  v_cnt      integer;
  v_fv       bigint;
  v_cash     bigint;
  v_surprise double precision;
  v_shock    double precision;
  v_tpl      text;
  v_body_tpl text;
  v_pct      text;
  v_head     text;
  v_body     text;
  v_imp      smallint;
  v_news     bigint;
  v_quarter  text;
  v_n        integer := 0;
begin
  select * into q from public.game_quarters where id = p_quarter_id;
  v_quarter := 'Q' || q.quarter || ' des Spieljahres ' || q.game_year;

  for r in
    select c.id, c.name, c.sector_key, c.tier, c.shares_outstanding, c.security_id, c.ttm_revenue_cents, c.ttm_net_income_cents,
           cs.baseline_revenue_cents, cs.baseline_costs_cents, cs.fixed_costs_cents,
           st.fair_value_e4, st.sentiment
      from public.companies c
      join public.company_state cs on cs.company_id = c.id
      join public.security_sim_state st on st.security_id = c.security_id
     where c.is_ai and c.phase = 'listed' and c.security_id is not null
       and not exists (select 1 from public.company_quarter_reports x where x.company_id = c.id and x.game_quarter_id = q.id)
     order by c.ticker
  loop
    v_sec   := coalesce(public.config_jsonb('sectors', array[r.sector_key]), '{}'::jsonb);
    v_g     := public.cfg_num(v_sec, '{demandGrowthBpsPerGameYear}', 0) / 10000.0 / v_qpy;
    v_noise := public.cfg_num(v_sec, '{demandNoise}', 0.03) * public.gauss_random();
    v_var   := case when r.baseline_revenue_cents > 0
                    then greatest(0, (r.baseline_costs_cents - r.fixed_costs_cents)::double precision / r.baseline_revenue_cents)
                    else 0 end;
    v_rev   := greatest(0, round(r.baseline_revenue_cents * exp(v_noise)))::bigint;
    v_cost  := greatest(0, round((r.fixed_costs_cents + v_var * v_rev)
                                 * exp(v_costnz * public.cfg_num(v_sec, '{demandNoise}', 0.03) * public.gauss_random())))::bigint;
    v_net   := v_rev - v_cost;
    v_expected := r.baseline_revenue_cents - r.baseline_costs_cents;

    select x.net_income_cents, x.revenue_cents into v_prev_net, v_prev_rev
      from public.company_quarter_reports x
      join public.game_quarters gq on gq.id = x.game_quarter_id
     where x.company_id = r.id
     order by gq.starts_at desc limit 1;
    v_prev_net := coalesce(v_prev_net, round(r.ttm_net_income_cents / v_qpy)::bigint);
    v_prev_rev := coalesce(v_prev_rev, round(r.ttm_revenue_cents / v_qpy)::bigint);

    insert into public.company_quarter_reports (
      company_id, game_quarter_id, revenue_cents, cogs_cents, fixed_costs_cents, net_income_cents,
      shares_outstanding, eps_e4, published_at)
    values (
      r.id, q.id, v_rev, v_cost - r.fixed_costs_cents, r.fixed_costs_cents, v_net,
      r.shares_outstanding, public.div_round_half_even(v_net::numeric * 100, r.shares_outstanding), now());

    -- trailing twelve months (four quarters); before four reports exist the
    -- seeded TTM is rolled forward by one quarter
    select count(*), sum(x.revenue_cents), sum(x.net_income_cents) into v_cnt, v_ttm_rev, v_ttm_net
      from (select x2.revenue_cents, x2.net_income_cents
              from public.company_quarter_reports x2
              join public.game_quarters gq on gq.id = x2.game_quarter_id
             where x2.company_id = r.id order by gq.starts_at desc limit 4) x;
    if v_cnt < 4 then
      v_ttm_rev := round(r.ttm_revenue_cents * (1 - 1 / v_qpy))::bigint + v_rev;
      v_ttm_net := round(r.ttm_net_income_cents * (1 - 1 / v_qpy))::bigint + v_net;
    end if;
    update public.companies
       set ttm_revenue_cents = v_ttm_rev, ttm_net_income_cents = v_ttm_net,
           eps_ttm_e4 = public.div_round_half_even(v_ttm_net::numeric * 100, shares_outstanding)
     where id = r.id;

    -- trend: grows with the sector, part of the surprise persists
    update public.company_state
       set baseline_revenue_cents = round(r.baseline_revenue_cents * (1 + v_g) * exp(v_persist * v_noise))::bigint,
           fixed_costs_cents      = round(r.fixed_costs_cents * (1 + v_g))::bigint,
           baseline_costs_cents   = round(r.fixed_costs_cents * (1 + v_g)
                                          + v_var * r.baseline_revenue_cents * (1 + v_g) * exp(v_persist * v_noise))::bigint,
           last_simulated_quarter_id = q.id
     where company_id = r.id;

    -- fair value: earnings multiple, or (loss makers) the old anchor scaled by revenue
    v_fv := public.fair_value_from_fundamentals(r.id);
    if v_fv is null then
      select a.balance_cents into v_cash from public.ledger_accounts a where a.owner_company_id = r.id and a.kind = 'company_cash';
      v_fv := round(r.fair_value_e4 * power(greatest(v_rev, 1)::double precision / greatest(v_prev_rev, 1), v_elastic))::bigint;
      v_fv := greatest(v_fv, round(coalesce(v_cash, 0)::double precision / r.shares_outstanding * v_floor * 100)::bigint, v_minprice);
    end if;
    v_surprise := greatest(-1, least(1, (v_net - v_expected)::double precision / greatest(abs(v_expected), 1)));
    v_shock := greatest(-public.cfg_num(v_events, '{earnings,maxSentimentShock}', 0.6),
                least(public.cfg_num(v_events, '{earnings,maxSentimentShock}', 0.6),
                      public.cfg_num(v_events, '{earnings,sentimentPerSurprise}', 1.5) * v_surprise));
    update public.security_sim_state
       set fair_value_e4 = v_fv, sentiment = greatest(-1, least(1, sentiment + v_shock))
     where security_id = r.security_id;

    -- news
    if v_prev_net > 0 and v_net > 0 then
      if abs(v_net - v_prev_net)::double precision / v_prev_net < 0.005 then
        v_tpl := 'earnings_profit_flat';
      elsif v_net > v_prev_net then
        v_tpl := 'earnings_profit_up';
      else
        v_tpl := 'earnings_profit_down';
      end if;
      v_pct := greatest(1, round(abs(v_net - v_prev_net) * 100.0 / v_prev_net))::bigint || ' %';
    elsif v_prev_net <= 0 and v_net > 0 then
      v_tpl := 'earnings_back_to_profit';
    elsif v_prev_net > 0 then
      v_tpl := 'earnings_into_loss';
    elsif v_net >= v_prev_net then
      v_tpl := 'earnings_loss_smaller';
    else
      v_tpl := 'earnings_loss_larger';
    end if;
    v_body_tpl := case when v_surprise > 0.05 then 'earnings_beat' when v_surprise < -0.05 then 'earnings_miss' else 'earnings_inline' end;
    select t.headline_template, t.importance into v_head, v_imp from public.news_templates t where t.key = v_tpl;
    select t.body_template into v_body from public.news_templates t where t.key = v_body_tpl;
    v_head := replace(replace(coalesce(v_head, '{company}: Quartalszahlen'), '{company}', r.name), '{pct}', coalesce(v_pct, ''));
    v_body := replace(replace(replace(replace(coalesce(v_body, ''), '{company}', r.name),
                '{revenue}', public.format_eur_short(v_rev)), '{profit}', public.format_eur_short(v_net)), '{quarter}', v_quarter);
    insert into public.news_items (category, headline, body, importance, company_id, security_id, sector_key, template_key, game_quarter_id, published_at)
    values ('earnings', v_head, nullif(v_body, ''), case when r.tier = 'bluechip' then 2 else coalesce(v_imp, 1) end,
            r.id, r.security_id, r.sector_key, v_tpl, q.id, now())
    returning id into v_news;
    insert into public.news_item_effects (news_item_id, sentiment, applied_at) values (v_news, v_shock, now());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bonds
-- ---------------------------------------------------------------------------
-- Locks the ledger accounts of every player that holds a bond or has an open
-- bond order, in id order. Called before any payout so that jobs never
-- deadlock with player RPCs (which lock their own accounts first).
create or replace function public.lock_bond_participants()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
     from public.ledger_accounts a
    where a.owner_player_id in (
            select p.player_id from public.positions p join public.securities s on s.id = p.security_id
             where s.kind = 'bond' and p.status = 'open'
            union
            select o.player_id from public.orders o join public.securities s on s.id = o.security_id
             where s.kind = 'bond' and o.status in ('pending', 'open', 'partially_filled'))
    order by a.id
      for update;
end;
$$;

-- Coupons of one quarter: per holder pro rata of the time each open lot was
-- held during the quarter (no accrued interest in the price), taxed with
-- trading.incomeTaxOnCouponsAndDividendsBps. Idempotent per (bond, quarter, player).
create or replace function public.pay_bond_coupons(p_quarter_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q        public.game_quarters;
  v_ppy    double precision := greatest(1, public.config_double('bonds', '{couponsPerGameYear}', 4));
  v_taxbps numeric := public.config_double('trading', '{incomeTaxOnCouponsAndDividendsBps}', 2500)::numeric;
  b        record;
  h        record;
  v_dist   uuid;
  v_coupon numeric;
  v_gross  bigint;
  v_tax    bigint;
  v_tx     uuid;
  v_total  bigint;
  v_n      integer := 0;
begin
  select * into q from public.game_quarters where id = p_quarter_id;
  perform public.lock_bond_participants();
  for b in
    select bd.security_id, bd.coupon_bps, bd.face_value_cents, bd.issued_at, s.ticker
      from public.bonds bd join public.securities s on s.id = bd.security_id
     where s.status = 'listed' and bd.issued_at < q.ends_at and bd.matures_at >= q.ends_at
  loop
    v_coupon := b.face_value_cents::numeric * b.coupon_bps / 10000 / v_ppy::numeric;  -- cents per bond and quarter
    insert into public.security_distributions (security_id, kind, game_quarter_id, amount_per_unit_e4, status, ex_at, pay_at, paid_at)
    values (b.security_id, 'coupon', q.id, round(v_coupon * 100)::bigint, 'paid', q.ends_at, now(), now())
    on conflict (security_id, kind, game_quarter_id) do nothing
    returning id into v_dist;
    continue when v_dist is null;
    v_total := 0;
    for h in
      select l.player_id, sum(l.quantity_open) as qty,
             sum(l.quantity_open::numeric * greatest(0, least(1,
                   extract(epoch from (q.ends_at - greatest(l.acquired_at, q.starts_at, b.issued_at)))::numeric
                   / extract(epoch from (q.ends_at - q.starts_at))::numeric))) as units
        from public.position_lots l
        join public.positions p on p.id = l.position_id and p.status = 'open'
       where l.security_id = b.security_id and l.quantity_open > 0
       group by l.player_id
       order by l.player_id
    loop
      v_gross := public.div_round_half_even(h.units * v_coupon, 1);
      continue when v_gross <= 0;
      v_tax := public.apply_bps(v_gross, v_taxbps);
      select public.ledger_post('coupon',
               (select jsonb_agg(jsonb_build_object('account_id', e.a, 'amount_cents', e.amt))
                  from (values (public.ledger_system_account('interest'), -v_gross),
                               (public.ledger_player_account(h.player_id, 'player_cash'), v_gross - v_tax),
                               (public.ledger_system_account('taxes'), v_tax)) as e(a, amt)
                 where e.amt <> 0),
               'Kupon ' || b.ticker, 'distribution', v_dist,
               'coupon:' || v_dist::text || ':' || h.player_id::text, h.player_id,
               jsonb_build_object('quantity', h.qty, 'game_quarter_id', q.id))
        into v_tx;
      insert into public.distribution_payouts (distribution_id, player_id, quantity, gross_cents, tax_cents, net_cents, ledger_transaction_id)
      values (v_dist, h.player_id, h.qty, v_gross, v_tax, v_gross - v_tax, v_tx)
      on conflict (distribution_id, player_id) do nothing;
      v_total := v_total + v_gross;
      v_n := v_n + 1;
    end loop;
    update public.security_distributions set total_paid_cents = v_total where id = v_dist;
  end loop;
  return v_n;
end;
$$;

-- Redeems every listed bond with matures_at <= p_until at face value: open
-- orders are cancelled, positions are sold to the issuer (no fee, capital gains
-- tax with loss pot), the security is marked matured.
create or replace function public.redeem_matured_bonds(p_until timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b        record;
  o        record;
  p        record;
  v_order  uuid;
  v_n      integer := 0;
begin
  perform public.lock_bond_participants();
  for b in
    select bd.security_id, bd.face_value_cents, s.ticker, s.name
      from public.bonds bd join public.securities s on s.id = bd.security_id
     where s.status = 'listed' and bd.matures_at <= p_until
     order by bd.matures_at
  loop
    for o in
      select x.id from public.orders x
       where x.security_id = b.security_id and x.status in ('pending', 'open', 'partially_filled')
    loop
      perform public.cancel_order_internal(o.id);
    end loop;
    for p in
      select x.id, x.player_id, x.quantity from public.positions x
       where x.security_id = b.security_id and x.status = 'open' and x.quantity > 0
    loop
      insert into public.orders (player_id, security_id, request_id, source, side, type, quantity, status)
      values (p.player_id, b.security_id, md5('nexa:redeem:' || p.id::text)::uuid, 'system', 'sell', 'market', p.quantity, 'pending')
      on conflict (player_id, request_id) do nothing
      returning id into v_order;
      continue when v_order is null;
      perform public.execute_fill(v_order, p.quantity, b.face_value_cents * 100, false, true);
    end loop;
    update public.securities set status = 'matured', is_tradable = false, delisted_at = now() where id = b.security_id;
    insert into public.news_items (category, headline, body, importance, security_id, template_key, published_at)
    select 'market', replace(t.headline_template, '{name}', b.name), t.body_template, 1, b.security_id, t.key, now()
      from public.news_templates t where t.key = 'bond_matured';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Makes sure one listed bond exists for every maturity in game_config bonds.maturities.
create or replace function public.ensure_bond_series()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bonds  jsonb := coalesce(public.config_jsonb('bonds'), '{}'::jsonb);
  v_now    timestamptz := public.game_now();
  v_policy integer;
  m        record;
  v_pred   record;
  v_serial integer;
  v_ticker text;
  v_name   text;
  v_id     uuid;
  v_coupon integer;
  v_face   bigint := greatest(1, public.cfg_num(v_bonds, '{faceValueCents}', 10000))::bigint;
  v_half   bigint;
  v_n      integer := 0;
begin
  select cb.policy_rate_bps into v_policy from public.central_bank_state cb where cb.id;
  v_policy := coalesce(v_policy, public.config_double('centralBank', '{startRateBps}', 300)::integer);
  for m in
    select distinct (e ->> 'years')::integer as years
      from jsonb_array_elements(coalesce(v_bonds -> 'maturities', '[{"years":1},{"years":2},{"years":5},{"years":10}]'::jsonb)) e
     order by 1
  loop
    continue when exists (
      select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
       where s.status = 'listed' and bd.term_game_years = m.years and bd.matures_at > v_now);
    select bd.security_id, st.volatility, st.liquidity_shares, st.spread_bps into v_pred
      from public.bonds bd
      left join public.security_sim_state st on st.security_id = bd.security_id
     order by (bd.term_game_years = m.years) desc, abs(bd.term_game_years - m.years), bd.matures_at desc
     limit 1;
    v_serial := (select count(*) from public.bonds bd where bd.term_game_years = m.years) + 1;
    loop
      v_ticker := 'NXB' || lpad(m.years::text, 2, '0') || lpad(v_serial::text, 3, '0');
      exit when not exists (select 1 from public.securities s where s.ticker = v_ticker);
      v_serial := v_serial + 1;
    end loop;
    v_name := 'Staatsanleihe ' || m.years || case when m.years = 1 then ' Jahr' else ' Jahre' end || ', Serie ' || v_serial;
    v_coupon := public.bond_yield_bps(v_policy, m.years, v_bonds);
    insert into public.securities (kind, ticker, name, status, tick_size_e4, is_shortable, max_leverage, listed_at)
    values ('bond', v_ticker, v_name, 'listed', 100, false, 2, now())
    returning id into v_id;
    insert into public.bonds (security_id, issuer, series, term_game_years, coupon_bps, face_value_cents, rating, issued_at, matures_at)
    values (v_id, 'state', v_ticker || '-' || lpad(v_serial::text, 3, '0'), m.years, v_coupon, v_face, 'AAA', v_now,
            ((public.game_day(v_now) + m.years)::timestamp + interval '8 hours') at time zone 'Europe/Berlin');
    v_half := greatest(1, round(v_face * 100 * coalesce(v_pred.spread_bps, 10) / 20000.0))::bigint;
    insert into public.security_quotes (security_id, last_price_e4, bid_e4, ask_e4, prev_close_e4, day_open_e4, day_high_e4, day_low_e4, yield_bps)
    values (v_id, v_face * 100, v_face * 100 - v_half, v_face * 100 + v_half, v_face * 100, v_face * 100, v_face * 100, v_face * 100, v_coupon);
    insert into public.security_sim_state (security_id, fair_value_e4, volatility, liquidity_shares, spread_bps, ema_fast, ema_slow)
    values (v_id, v_face * 100, coalesce(v_pred.volatility, 0.00005), coalesce(v_pred.liquidity_shares, 1000000),
            coalesce(v_pred.spread_bps, 10), v_face * 100, v_face * 100);
    update public.bonds set successor_security_id = v_id
     where security_id = (select bd.security_id from public.bonds bd join public.securities s on s.id = bd.security_id
                           where bd.term_game_years = m.years and s.status = 'matured' and bd.successor_security_id is null
                           order by bd.matures_at desc limit 1);
    insert into public.news_items (category, headline, body, importance, security_id, template_key, published_at)
    select 'market', replace(t.headline_template, '{name}', v_name),
           replace(replace(t.body_template, '{term}', m.years || case when m.years = 1 then ' Spieljahr' else ' Spieljahren' end),
                   '{coupon}', replace(to_char(v_coupon / 100.0, 'FM990.00'), '.', ',') || ' %'),
           1, v_id, t.key, now()
      from public.news_templates t where t.key = 'bond_new_series';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Quarter close (idempotent per quarter via job_runs)
-- ---------------------------------------------------------------------------
create or replace function public.close_game_quarter(p_quarter_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q           public.game_quarters;
  v_run       bigint;
  v_companies integer;
  v_coupons   integer;
  v_redeemed  integer;
  v_issued    integer;
  v_details   jsonb;
begin
  select * into q from public.game_quarters where id = p_quarter_id for update;
  if not found then
    raise exception 'game quarter % does not exist', p_quarter_id using errcode = 'NX007';
  end if;
  if q.status = 'closed' then
    return jsonb_build_object('quarter_id', q.id, 'skipped', 'already_closed');
  end if;
  insert into public.job_runs (job_name, run_key) values ('quarter_close', q.id::text)
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is null then
    return jsonb_build_object('quarter_id', q.id, 'skipped', 'already_run');
  end if;

  perform public.lock_bond_participants();
  update public.game_quarters set status = 'closing', close_started_at = now() where id = q.id;
  v_companies := public.simulate_ai_companies(q.id);
  v_coupons   := public.pay_bond_coupons(q.id);
  v_redeemed  := public.redeem_matured_bonds(q.ends_at);
  v_issued    := public.ensure_bond_series();
  update public.game_quarters set status = 'closed', closed_at = now() where id = q.id;

  v_details := jsonb_build_object('quarter_id', q.id, 'game_year', q.game_year, 'quarter', q.quarter,
                                  'company_reports', v_companies, 'coupon_payouts', v_coupons,
                                  'bonds_redeemed', v_redeemed, 'bonds_issued', v_issued);
  update public.job_runs set status = 'succeeded', finished_at = now(), details = v_details where id = v_run;
  return v_details;
end;
$$;

-- ---------------------------------------------------------------------------
-- Price history backfill (only while no candle exists)
-- ---------------------------------------------------------------------------
-- Generates a bounded random walk per security that ends exactly at the
-- current price: log deviation = band x tanh(cumulative noise / band). The
-- finest steps are 1 min (last 6 h), 5 min (to 30 days back) and one game day
-- (to 365 game days back); all coarser candles are aggregated from them, so
-- every interval shows the same history and OHLC is consistent. The step
-- noise follows the tick noise of the size class and sector; the band and the
-- 2000-tick horizon (about the value-fund half life) only shape the cosmetic
-- history and are not game rules.
create or replace function public.backfill_price_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now          timestamptz := public.game_now();
  v_epoch        constant timestamptz := '2000-01-01 00:00:00+00';
  v_m1_end       timestamptz := date_bin('1 minute', public.game_now(), '2000-01-01 00:00:00+00'::timestamptz);
  v_fine_start   timestamptz := date_bin('5 minutes', public.game_now() - interval '6 hours', '2000-01-01 00:00:00+00'::timestamptz);
  v_today        date := public.game_day(public.game_now());
  v_coarse_start timestamptz;
  v_ai           jsonb := coalesce(public.config_jsonb('aiInvestors'), '{}'::jsonb);
  v_sectors      jsonb := coalesce(public.config_jsonb('sectors'), '{}'::jsonb);
  v_depthfrac    double precision := public.config_double('trading', '{priceImpact,depthFreeFloatFraction}', 0.002);
  v_tick_s       double precision := greatest(1, public.config_double('time', '{tickSeconds}', 5));
  v_horizon      constant double precision := 2000;   -- ticks; cosmetic, see above
  v_band_mult    constant double precision := 3;      -- band = 3 x the noise over the horizon
  v_counts       jsonb;
begin
  if exists (select 1 from public.candles limit 1) then
    return jsonb_build_object('skipped', 'candles_exist');
  end if;
  v_coarse_start := ((v_today - 30)::timestamp + interval '8 hours') at time zone 'Europe/Berlin';

  if to_regclass('pg_temp.nexa_bf') is not null then
    drop table pg_temp.nexa_bf;
  end if;
  create temporary table nexa_bf (
    security_id uuid, k integer, iv text, bucket_start timestamptz, ticks integer,
    sigma double precision, band double precision, price double precision, base_vol double precision,
    close_e4 bigint, open_e4 bigint, high_e4 bigint, low_e4 bigint, volume bigint
  ) on commit drop;

  insert into pg_temp.nexa_bf (security_id, k, iv, bucket_start, ticks, sigma, band, price, base_vol)
  with sec as (
    select s.id, q.last_price_e4::double precision as price,
           greatest(1e-6, case when s.kind = 'stock'
                then public.cfg_num(v_ai, array['tickNoiseBps', coalesce(c.tier::text, 'midcap')], 15) / 10000.0
                     * public.cfg_num(v_sectors, array[coalesce(s.sector_key, ''), 'volatilityMultiplier'], 1)
                     * public.cfg_num(v_ai, '{tickNoiseScale}', 0.2)
                else coalesce(st.volatility, 0.0001) end) as sigma_tick,
           case when s.kind = 'stock' then c.shares_outstanding * v_depthfrac else coalesce(st.liquidity_shares, 100000) end
             * public.cfg_num(v_ai, '{baselineVolumeDepthFraction}', 0.02) as vol_per_tick
      from public.securities s
      join public.security_quotes q on q.security_id = s.id
      left join public.security_sim_state st on st.security_id = s.id
      left join public.companies c on c.id = s.company_id
     where s.status = 'listed' and s.kind in ('stock', 'bond')
  ), steps as (
    select 'm'::text as iv, g as bucket_start, round(60 / v_tick_s)::integer as ticks
      from generate_series(v_m1_end, v_fine_start, interval '-1 minute') g
    union all
    select '5', g, round(300 / v_tick_s)::integer
      from generate_series(v_fine_start - interval '5 minutes', v_coarse_start, interval '-5 minutes') g
    union all
    select 'd', (d::date::timestamp + interval '8 hours') at time zone 'Europe/Berlin', round(86400 / v_tick_s)::integer
      from generate_series((v_today - 31)::timestamp, (v_today - 364)::timestamp, interval '-1 day') d
  )
  select sec.id, (row_number() over (partition by sec.id order by st.bucket_start desc) - 1)::integer,
         st.iv, st.bucket_start, st.ticks,
         sec.sigma_tick * sqrt(least(st.ticks, v_horizon)),
         sec.sigma_tick * sqrt(v_horizon) * v_band_mult,
         sec.price, sec.vol_per_tick * st.ticks
    from sec cross join steps st;

  -- closes: bounded walk, exactly the current price at k = 0
  update pg_temp.nexa_bf t
     set close_e4 = x.c
    from (select y.security_id, y.k,
                 greatest(1, round(y.price * exp(y.band * tanh(y.s_cum / y.band))))::bigint as c
            from (select b.security_id, b.k, b.price, b.band,
                         sum(case when b.k = 0 then 0 else b.sigma * public.gauss_random() end)
                           over (partition by b.security_id order by b.k) as s_cum
                    from pg_temp.nexa_bf b) y) x
   where t.security_id = x.security_id and t.k = x.k;

  -- open = previous close, wicks, volume
  update pg_temp.nexa_bf t
     set open_e4 = x.o,
         high_e4 = ceil(greatest(x.o, t.close_e4) * exp(abs(public.gauss_random()) * t.sigma * 0.5))::bigint,
         low_e4  = greatest(1, floor(least(x.o, t.close_e4) * exp(-abs(public.gauss_random()) * t.sigma * 0.5)))::bigint,
         volume  = round(t.base_vol * (0.5 + random()))::bigint
    from (select b.security_id, b.k, coalesce(lead(b.close_e4) over (partition by b.security_id order by b.k), b.close_e4) as o
            from pg_temp.nexa_bf b) x
   where t.security_id = x.security_id and t.k = x.k;

  -- 1m: last 6 hours
  insert into public.candles (security_id, interval, bucket_start, open_e4, high_e4, low_e4, close_e4, volume, tick_count)
  select b.security_id, '1m', b.bucket_start, b.open_e4, b.high_e4, b.low_e4, b.close_e4, b.volume, b.ticks
    from pg_temp.nexa_bf b where b.iv = 'm';

  -- 5m: last 2 days, 1h: 30 days, 1q: 30 days, 1y: 365 game days
  insert into public.candles (security_id, interval, bucket_start, open_e4, high_e4, low_e4, close_e4, volume, tick_count)
  select g.security_id, g.target_iv::public.candle_interval, g.bucket,
         (array_agg(g.open_e4 order by g.bucket_start))[1], max(g.high_e4), min(g.low_e4),
         (array_agg(g.close_e4 order by g.bucket_start desc))[1], sum(g.volume), sum(g.ticks)
    from (
      select b.*, '5m' as target_iv, date_bin('5 minutes', b.bucket_start, v_epoch) as bucket
        from pg_temp.nexa_bf b where b.iv in ('m', '5') and b.bucket_start >= date_bin('5 minutes', v_now - interval '2 days', v_epoch)
      union all
      select b.*, '1h', date_bin('1 hour', b.bucket_start, v_epoch) from pg_temp.nexa_bf b where b.iv in ('m', '5')
      union all
      select b.*, '1q', public.quarter_bucket_start(b.bucket_start) from pg_temp.nexa_bf b where b.iv in ('m', '5')
      union all
      select b.*, '1y', public.game_year_bucket_start(b.bucket_start) from pg_temp.nexa_bf b
    ) g
   group by g.security_id, g.target_iv, g.bucket;

  -- indices: aggregated from the members' candles (same buckets)
  insert into public.candles (security_id, interval, bucket_start, open_e4, high_e4, low_e4, close_e4, volume, tick_count)
  select i.security_id, c.interval, c.bucket_start,
         round(sum(co.shares_outstanding::numeric * c.open_e4) / 100 / i.divisor::numeric)::bigint,
         round(sum(co.shares_outstanding::numeric * c.high_e4) / 100 / i.divisor::numeric)::bigint,
         round(sum(co.shares_outstanding::numeric * c.low_e4) / 100 / i.divisor::numeric)::bigint,
         round(sum(co.shares_outstanding::numeric * c.close_e4) / 100 / i.divisor::numeric)::bigint,
         0, max(c.tick_count)
    from public.indices i
    join public.index_memberships m on m.index_security_id = i.security_id and m.left_at is null
    join public.securities s on s.id = m.member_security_id
    join public.companies co on co.id = s.company_id
    join public.candles c on c.security_id = s.id
   group by i.security_id, i.divisor, c.interval, c.bucket_start
  having count(*) = (select count(*) from public.index_memberships m2 where m2.index_security_id = i.security_id and m2.left_at is null);

  select jsonb_object_agg(x.interval, x.n) into v_counts
    from (select c.interval::text as interval, count(*) as n from public.candles c group by c.interval) x;
  drop table pg_temp.nexa_bf;
  return jsonb_build_object('backfilled', true, 'candles', v_counts);
end;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap: idempotent, safe on a fresh and on an existing database
-- ---------------------------------------------------------------------------
create or replace function public.market_bootstrap()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := public.game_now();
  v_bell     timestamptz := public.trading_day_start(public.game_now());
  v_state    jsonb;
  v_fv       integer;
  v_backfill jsonb;
  v_redeemed integer;
  v_issued   integer;
  v_policy   integer;
  v_bonds    jsonb := coalesce(public.config_jsonb('bonds'), '{}'::jsonb);
  v_qpy      double precision := greatest(1, public.config_double('bonds', '{couponsPerGameYear}', 4));
  v_qsec     double precision := public.config_double('time', '{quarterHours}', 6) * 3600;
begin
  perform pg_advisory_xact_lock(7311001);
  perform public.ensure_game_quarters(3);
  select r.state into v_state from public.sim_runtime r where r.id for update;

  update public.security_sim_state st
     set ema_fast = coalesce(st.ema_fast, q.last_price_e4),
         ema_slow = coalesce(st.ema_slow, q.last_price_e4)
    from public.security_quotes q
   where q.security_id = st.security_id and (st.ema_fast is null or st.ema_slow is null);

  if v_state ->> 'fair_values_at' is null then
    v_fv := public.recompute_fair_values();
    update public.sim_runtime set state = state || jsonb_build_object('fair_values_at', now()) where id;
  end if;

  v_redeemed := public.redeem_matured_bonds(v_now);
  v_issued   := public.ensure_bond_series();

  -- before the history is generated: bonds start at their yield-implied price
  if not exists (select 1 from public.candles limit 1) then
    v_policy := coalesce((select cb.policy_rate_bps from public.central_bank_state cb where cb.id),
                         public.config_double('centralBank', '{startRateBps}', 300)::integer);
    update public.security_quotes q
       set last_price_e4 = x.p, bid_e4 = greatest(1, x.p - x.h), ask_e4 = x.p + greatest(1, x.h),
           prev_close_e4 = x.p, day_open_e4 = x.p, day_high_e4 = x.p, day_low_e4 = x.p, yield_bps = x.y
      from (select b.security_id,
                   greatest(1, round(public.bond_clean_price(b.coupon_bps,
                                 public.bond_yield_bps(v_policy, y.periods / v_qpy, v_bonds), y.periods, v_qpy)
                               * b.face_value_cents * 100))::bigint as p,
                   round(b.face_value_cents * 100 * coalesce(st.spread_bps, 10) / 20000.0)::bigint as h,
                   public.bond_yield_bps(v_policy, y.periods / v_qpy, v_bonds) as y
              from public.bonds b
              join public.securities s on s.id = b.security_id and s.status = 'listed'
              left join public.security_sim_state st on st.security_id = b.security_id
             cross join lateral (select extract(epoch from (b.matures_at - v_now)) / v_qsec as periods) y
             where b.matures_at > v_now) x
     where q.security_id = x.security_id;

    -- profitable stocks without any trade start at their fundamental fair value
    -- (the seed prices used slightly different sector multiples), and the
    -- NEXA 30 divisor is re-based so that the index starts at its base value
    update public.security_quotes q
       set last_price_e4 = st.fair_value_e4,
           bid_e4 = greatest(1, st.fair_value_e4 - x.h), ask_e4 = st.fair_value_e4 + greatest(1, x.h),
           prev_close_e4 = st.fair_value_e4, day_open_e4 = st.fair_value_e4,
           day_high_e4 = st.fair_value_e4, day_low_e4 = st.fair_value_e4,
           market_cap_cents = public.div_round_half_even(c.shares_outstanding::numeric * st.fair_value_e4, 100)
      from public.security_sim_state st
      join public.securities s on s.id = st.security_id and s.kind = 'stock' and s.status = 'listed'
      join public.companies c on c.id = s.company_id and c.ttm_net_income_cents > 0
     cross join lateral (select round(st.fair_value_e4
                           * public.config_double('trading', array['spread', 'halfSpreadBps', c.tier::text], 15) / 10000.0)::bigint as h) x
     where q.security_id = st.security_id and q.last_price_e4 <> st.fair_value_e4
       and not exists (select 1 from public.trades t where t.security_id = st.security_id);
    update public.security_sim_state st
       set ema_fast = q.last_price_e4, ema_slow = q.last_price_e4
      from public.security_quotes q where q.security_id = st.security_id;
    update public.indices i
       set divisor = x.cap / i.base_value_e4
      from (select m.index_security_id, sum(c.shares_outstanding::numeric * q.last_price_e4)::double precision / 100 as cap
              from public.index_memberships m
              join public.securities s on s.id = m.member_security_id
              join public.companies c on c.id = s.company_id
              join public.security_quotes q on q.security_id = s.id
             where m.left_at is null group by m.index_security_id) x
     where i.security_id = x.index_security_id and x.cap > 0;
    update public.security_quotes q
       set last_price_e4 = i.base_value_e4, prev_close_e4 = i.base_value_e4, day_open_e4 = i.base_value_e4,
           day_high_e4 = i.base_value_e4, day_low_e4 = i.base_value_e4, change_bps = 0
      from public.indices i where q.security_id = i.security_id;
  end if;
  v_backfill := public.backfill_price_history();

  -- day statistics since the last 22:00 bell, from the (backfilled) 5m candles
  if v_state ->> 'day_start' is null or (v_backfill ->> 'backfilled')::boolean is true then
    update public.security_quotes q
       set prev_close_e4 = coalesce((select c.close_e4 from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start < v_bell
                                      order by c.bucket_start desc limit 1), q.prev_close_e4, q.last_price_e4),
           day_open_e4   = coalesce((select c.open_e4 from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start >= v_bell
                                      order by c.bucket_start limit 1), q.last_price_e4),
           day_high_e4   = greatest(q.last_price_e4, (select max(c.high_e4) from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start >= v_bell)),
           day_low_e4    = least(q.last_price_e4, (select min(c.low_e4) from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start >= v_bell)),
           day_volume    = coalesce((select sum(c.volume) from public.candles c
                                      where c.security_id = q.security_id and c.interval = '5m' and c.bucket_start >= v_bell), 0);
    update public.security_quotes q
       set change_bps = round((q.last_price_e4 - q.prev_close_e4) * 10000.0 / greatest(1, q.prev_close_e4))::integer
     where q.prev_close_e4 is not null;
    update public.sim_runtime set state = state || jsonb_build_object('day_start', v_bell) where id;
  end if;

  return jsonb_build_object('fair_values', v_fv, 'bonds_redeemed', v_redeemed, 'bonds_issued', v_issued,
                            'backfill', v_backfill, 'day_start', v_bell);
end;
$$;
comment on function public.market_bootstrap() is 'Idempotent market setup: calendar, EMAs, fair values (once), bond series, price history (only without candles), day statistics. Run by setup/update scripts and run_due_jobs().';

-- ---------------------------------------------------------------------------
-- run_due_jobs(): pg_cron every minute
-- ---------------------------------------------------------------------------
create or replace function public.run_due_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz;
  v_result   jsonb := '{}'::jsonb;
  v_closed   jsonb := '[]'::jsonb;
  v_latest   bigint;
  q          record;
  v_run      bigint;
begin
  -- waits for a running tick (ticks only try the lock and skip)
  perform pg_advisory_xact_lock(7311001);
  v_now := public.game_now();
  perform public.ensure_game_quarters(3);

  if not exists (select 1 from public.candles limit 1) then
    v_result := v_result || jsonb_build_object('bootstrap', public.market_bootstrap());
  end if;

  -- first run on a database: older quarters are skipped, only the latest ended one is closed
  if not exists (select 1 from public.job_runs j where j.job_name = 'quarter_close') then
    select gq.id into v_latest from public.game_quarters gq
     where gq.ends_at <= v_now and gq.status <> 'closed' order by gq.ends_at desc limit 1;
    for q in select gq.id from public.game_quarters gq
              where gq.ends_at <= v_now and gq.status <> 'closed' and gq.id <> coalesce(v_latest, -1)
    loop
      update public.game_quarters set status = 'closed', closed_at = now() where id = q.id;
      insert into public.job_runs (job_name, run_key, status, finished_at, details)
      values ('quarter_close', q.id::text, 'succeeded', now(), '{"skipped": "before_first_run"}'::jsonb)
      on conflict do nothing;
    end loop;
  end if;

  for q in select gq.id from public.game_quarters gq
            where gq.ends_at <= v_now and gq.status <> 'closed'
            order by gq.ends_at limit 8
  loop
    v_closed := v_closed || public.close_game_quarter(q.id);
  end loop;
  v_result := v_result || jsonb_build_object('quarters', v_closed);

  -- bonds that matured between quarter closes (or after a downtime)
  if exists (select 1 from public.bonds bd join public.securities s on s.id = bd.security_id
              where s.status = 'listed' and bd.matures_at <= v_now) then
    v_result := v_result || jsonb_build_object('bonds_redeemed', public.redeem_matured_bonds(v_now));
  end if;
  v_result := v_result || jsonb_build_object('bonds_issued', public.ensure_bond_series());

  -- daily maintenance (first run per UTC day)
  insert into public.job_runs (job_name, run_key) values ('maintenance', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))
  on conflict (job_name, run_key) do nothing
  returning id into v_run;
  if v_run is not null then
    v_result := v_result || jsonb_build_object('maintenance', public.run_maintenance());
    -- price_ticks: keep about one day (candles hold the history), cron log: one day
    perform public.maintain_price_tick_partitions(3, 1);
    if to_regclass('cron.job_run_details') is not null then
      begin
        execute 'delete from cron.job_run_details where end_time < now() - interval ''1 day''';
      exception when others then
        raise warning 'NEXA: could not prune cron.job_run_details: %', sqlerrm;
      end;
    end if;
    delete from public.job_runs j where j.job_name = 'maintenance' and j.started_at < now() - interval '30 days';
    update public.job_runs set status = 'succeeded', finished_at = now() where id = v_run;
  end if;
  return v_result;
end;
$$;
comment on function public.run_due_jobs() is 'pg_cron every minute: calendar, lazy bootstrap, due quarter closes, bond maturities and new series, daily maintenance.';

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_paused(p_paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_admin();
begin
  update public.sim_runtime set is_paused = coalesce(p_paused, false) where id;
  update public.market_status
     set is_halted = coalesce(p_paused, false), halt_reason = case when p_paused then 'admin_pause' end
   where id;
  insert into public.admin_actions (admin_id, action, payload)
  values (v_admin, 'set_paused', jsonb_build_object('paused', coalesce(p_paused, false)));
  return jsonb_build_object('paused', coalesce(p_paused, false));
end;
$$;

create or replace function public.admin_run_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.require_admin();
begin
  return public.market_tick();
end;
$$;

-- Closes the running quarter now: game time jumps to its end (admin time
-- offset, ADR-006), the quarter is closed and the next one becomes active.
create or replace function public.admin_close_quarter()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin  uuid := public.require_admin();
  q        public.game_quarters;
  v_shift  interval;
  v_result jsonb;
  v_next   public.game_quarters;
begin
  perform pg_advisory_xact_lock(7311001);
  q := public.current_game_quarter();
  if q.id is null then
    perform public.ensure_game_quarters(3);
    q := public.current_game_quarter();
  end if;
  v_shift := q.ends_at - public.game_now();
  update public.sim_runtime set time_offset = time_offset + v_shift where id;
  perform public.ensure_game_quarters(3);
  v_result := public.close_game_quarter(q.id);
  perform public.redeem_matured_bonds(public.game_now());
  perform public.ensure_bond_series();
  v_next := public.current_game_quarter();
  insert into public.admin_actions (admin_id, action, target_type, target_id, payload)
  values (v_admin, 'close_quarter', 'game_quarter', q.id::text, v_result || jsonb_build_object('time_shift', v_shift::text));
  return v_result || jsonb_build_object(
    'closed_quarter_id', q.id, 'next_quarter_id', v_next.id,
    'next_game_year', v_next.game_year, 'next_quarter', v_next.quarter,
    'game_time', public.game_now(),
    'time_offset', (select r.time_offset::text from public.sim_runtime r where r.id));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.format_eur_short(bigint)', 'public.fair_value_from_fundamentals(uuid)', 'public.recompute_fair_values()',
    'public.simulate_ai_companies(bigint)', 'public.lock_bond_participants()', 'public.pay_bond_coupons(bigint)',
    'public.redeem_matured_bonds(timestamptz)', 'public.ensure_bond_series()', 'public.close_game_quarter(bigint)',
    'public.backfill_price_history()', 'public.market_bootstrap()', 'public.run_due_jobs()',
    'public.admin_set_paused(boolean)', 'public.admin_run_tick()', 'public.admin_close_quarter()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.admin_set_paused(boolean) to authenticated;
  grant execute on function public.admin_run_tick() to authenticated;
  grant execute on function public.admin_close_quarter() to authenticated;
end;
$$;
