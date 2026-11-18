-- =============================================================================
-- NEXA · 011120 · AI business follows the market mood, earnings move the confidence (ADR-216)
-- =============================================================================
-- simulate_ai_companies(): full copy of the live definition (m1 20261111000400, unchanged since) with two changes:
-- * growth per quarter = investor_confidence_ai_growth(sector growth, market mood) / quarters per game year
--   = sector growth × aiFundamentals.trendShare + cycleGrowthPerGameYear × (mood − 50) / 50. A game year is one real
--   day: the full sector growth (1,5 to 8 % a day) made every AI stock rise without end (ADR-216, harness numbers).
-- * the earnings surprise also moves the investor confidence: investor_confidence_bump('earnings',
--   perSurprise × surprise).
-- Idempotent: runs unchanged as supabase/updates/20261204011120_ai_business_cycle.sql.
-- =============================================================================

create or replace function public.simulate_ai_companies(p_quarter_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
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
  -- ADR-216: the business follows the market mood; earnings move the investor confidence
  v_ic       jsonb := coalesce(public.config_jsonb('investorConfidence'), '{}'::jsonb);
  v_mood     double precision := coalesce((select m.mood from public.market_mood m where m.id), 50);
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
    -- ADR-216: sector growth x trendShare + cycleGrowth x (mood - 50) / 50 per game year (was the full sector growth)
    v_g     := public.investor_confidence_ai_growth(public.cfg_num(v_sec, '{demandGrowthBpsPerGameYear}', 0), v_mood, v_ic)
               / v_qpy;
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
    -- ADR-216: beat or miss moves the investor confidence
    perform public.investor_confidence_bump(r.security_id, 'earnings',
                                            public.cfg_num(v_ic, '{events,earnings,perSurprise}', 30) * v_surprise, now());

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
$function$;

revoke all on function public.simulate_ai_companies(bigint) from public, anon, authenticated;
grant execute on function public.simulate_ai_companies(bigint) to service_role;
