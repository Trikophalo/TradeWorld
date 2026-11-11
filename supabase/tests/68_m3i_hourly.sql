-- =============================================================================
-- 68 · M3i: hourly operations and wage rule (ADR-072), company ranking (ADR-074),
--      logo once and forbidden symbols (ADR-076)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''06860686-0000-4000-8000-0000000000a1'''
\set b '''06860686-0000-4000-8000-0000000000b2'''
\set c '''06860686-0000-4000-8000-0000000000c3'''
\set d '''06860686-0000-4000-8000-0000000000d4'''
select tests.signup(:a, 'Hanna_Stunde') is not null and tests.signup(:b, 'Bert_Lohn') is not null
   and tests.signup(:c, 'Carla_Rang') is not null and tests.signup(:d, 'Dora_Takt') is not null as ok \gset
update public.sim_runtime set is_paused = false;
select tests.set_level(:a, 4);
select tests.set_level(:b, 3);
select tests.set_level(:c, 4);
select tests.set_level(:d, 6);
select tests.fund(:a, 3000000, 'test:m3i:a');
select tests.fund(:c, 1000000, 'test:m3i:c');

-- A: tech garage with B (20 000 cents/h) and one AI worker; C: a retail garage
select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Stunden Werk', 'Apps für Uhrmacher', 'tech', '#225566', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:a) as aco \gset
select tests.hire(:a, :b, 20000) as bjob \gset
select tests.login_as('authenticated', :a);
select public.set_ai_workers(gen_random_uuid(), 1) is not null as ok \gset
reset role;
select tests.login_as('authenticated', :c);
select public.found_company(gen_random_uuid(), 'Rang Laden', 'Tee aus der Region', 'retail', '#665522', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:c) as cco \gset

-- hours of a quarter that is not touched by the other tests
select id as qid, starts_at as qs from public.game_quarters order by ends_at desc limit 1 \gset
update public.player_companies set potential_annual_cents = 10000000000, awareness = 0.5 where company_id = :'aco';
update public.player_jobs set last_paid_at = :'qs'::timestamptz, paid_day = null, paid_minutes_today = 0 where id = :'bjob';

-- =============================================================================
-- A. One hour: revenue, goods, players and AI workers paid with the same factor
-- =============================================================================
select tests.company_cash(:'aco') as cc0 \gset
select tests.cash(:b) as bc0 \gset
select balance_cents as hh0 from public.ledger_accounts where system_key = 'households' \gset
select count(*) as bxp0 from public.xp_events where player_id = :b and source = 'work_hour' \gset
select public.player_company_close_hour(:'aco', :'qs'::timestamptz) as h1 \gset
select * from public.player_company_hours where company_id = :'aco' and hour_start = :'qs'::timestamptz \gset h1_
select tests.assert(
  :h1_revenue_cents::bigint = :h1_capacity_cents::bigint and :h1_demand_cents::bigint > :h1_capacity_cents::bigint
  and :h1_cogs_cents::bigint = round(:h1_revenue_cents::bigint * 0.25)
  and :h1_player_wages_due_cents::bigint = 20000 and :h1_ai_wages_due_cents::bigint = 12000
  and :h1_pay_factor_bps::int = 10000 and :h1_player_wages_paid_cents::bigint = 20000 and :h1_ai_wages_paid_cents::bigint = 12000
  and :h1_fixed_cents::bigint = 2500 and :h1_marketing_cents::bigint = 0 and :h1_game_quarter_id::bigint = :qid
  and :h1_profit_cents::bigint = :h1_revenue_cents::bigint - :h1_cogs_cents::bigint - 20000 - 12000 - 2500
  and tests.company_cash(:'aco') = :cc0::bigint + :h1_profit_cents::bigint
  and tests.cash(:b) = :bc0::bigint + 20000
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh0::bigint - :h1_profit_cents::bigint - 20000
  and (select pay_factor_bps from public.player_companies where company_id = :'aco') = 10000,
  'player_company_close_hour(): revenue = capacity, goods 25 %, B (200 EUR) and the AI worker (120 EUR) paid in full, fixed 25 EUR; money moves company <-> households <-> player');
select tests.assert(
  (select sp.minutes_paid = 60 and sp.amount_cents = 20000 and sp.base_amount_cents = 20000
          and sp.period_start = :'qs'::timestamptz and sp.period_end = :'qs'::timestamptz + interval '1 hour'
     from public.salary_payouts sp where sp.player_job_id = :'bjob' order by sp.id desc limit 1)
  and (select last_paid_at = :'qs'::timestamptz + interval '1 hour' from public.player_jobs where id = :'bjob')
  and (select count(*) from public.xp_events where player_id = :b and source = 'work_hour') = :bxp0::int + 1,
  'the hour pays B like a job payout: salary_payouts row, work-hour XP, last_paid_at at the end of the hour');

-- idempotent per hour
select tests.company_cash(:'aco') as cc1 \gset
select public.player_company_close_hour(:'aco', :'qs'::timestamptz) ->> 'skipped' as h1b \gset
select tests.assert(:'h1b' = 'already_closed' and tests.company_cash(:'aco') = :cc1::bigint
  and (select count(*) from public.player_company_hours where company_id = :'aco') = 1,
  'player_company_close_hour(): idempotent per (company, hour)');

-- =============================================================================
-- B. Wages never exceed revenue minus goods
-- =============================================================================
update public.player_companies set potential_annual_cents = 2000000 where company_id = :'aco';
select tests.cash(:b) as bc1 \gset
select public.player_company_close_hour(:'aco', :'qs'::timestamptz + interval '1 hour') is not null as ok \gset
select * from public.player_company_hours where company_id = :'aco' and hour_start = :'qs'::timestamptz + interval '1 hour' \gset h2_
select tests.assert(
  :h2_pay_factor_bps::int < 10000 and :h2_revenue_cents::bigint > 0
  and :h2_pay_factor_bps::int = (:h2_revenue_cents::bigint - :h2_cogs_cents::bigint) * 10000 / 32000
  and :h2_player_wages_paid_cents::bigint = 20000 * :h2_pay_factor_bps::int / 10000
  and :h2_ai_wages_paid_cents::bigint = 12000 * :h2_pay_factor_bps::int / 10000
  and :h2_player_wages_paid_cents::bigint + :h2_ai_wages_paid_cents::bigint <= :h2_revenue_cents::bigint - :h2_cogs_cents::bigint
  and tests.cash(:b) = :bc1::bigint + :h2_player_wages_paid_cents::bigint
  and (select pay_factor_bps from public.player_companies where company_id = :'aco') = :h2_pay_factor_bps::int
  and (select sp.base_amount_cents = 20000 and sp.amount_cents = :h2_player_wages_paid_cents::bigint
         from public.salary_payouts sp where sp.player_job_id = :'bjob' order by sp.id desc limit 1),
  'weak hour: factor = (revenue - goods) / wages due; players and AI workers get the same share, never more than the hour earned');

update public.player_companies set potential_annual_cents = 1 where company_id = :'aco';
select tests.cash(:b) as bc2 \gset
select public.player_company_close_hour(:'aco', :'qs'::timestamptz + interval '2 hours') is not null as ok \gset
select * from public.player_company_hours where company_id = :'aco' and hour_start = :'qs'::timestamptz + interval '2 hours' \gset h3_
select tests.assert(
  :h3_revenue_cents::bigint = 0 and :h3_pay_factor_bps::int = 0
  and :h3_player_wages_paid_cents::bigint = 0 and :h3_ai_wages_paid_cents::bigint = 0
  and :h3_profit_cents::bigint = -2500 and tests.cash(:b) = :bc2::bigint
  and (select last_paid_at = :'qs'::timestamptz + interval '3 hours' from public.player_jobs where id = :'bjob'),
  'no revenue: no wages at all (factor 0), the fixed costs still run; the hour counts as worked');
update public.player_companies set potential_annual_cents = 10000000000 where company_id = :'aco';

-- =============================================================================
-- C. Quarter close aggregates the hours and books nothing twice
-- =============================================================================
select tests.company_cash(:'aco') as cc2 \gset
select balance_cents as hh2 from public.ledger_accounts where system_key = 'households' \gset
select tests.cash(:b) as bc3 \gset
select public.player_company_close_quarter(:'aco', :qid) as qc \gset
select * from public.player_company_reports where company_id = :'aco' and game_quarter_id = :qid \gset r_
select tests.assert(
  (:'qc'::jsonb ->> 'hours')::int = 3
  and :r_revenue_cents::bigint = :h1_revenue_cents::bigint + :h2_revenue_cents::bigint
  and :r_cogs_cents::bigint = :h1_cogs_cents::bigint + :h2_cogs_cents::bigint
  and :r_wages_cents::bigint = 20000 + :h2_player_wages_paid_cents::bigint
  and :r_ai_worker_cents::bigint = 12000 + :h2_ai_wages_paid_cents::bigint
  and :r_fixed_cents::bigint = 7500 and :r_marketing_cents::bigint = 0
  and :r_operating_profit_cents::bigint = :h1_profit_cents::bigint + :h2_profit_cents::bigint + :h3_profit_cents::bigint
  and :r_operating_profit_cents::bigint = :r_revenue_cents::bigint - :r_cogs_cents::bigint - :r_wages_cents::bigint
                                          - :r_ai_worker_cents::bigint - :r_fixed_cents::bigint - :r_marketing_cents::bigint
  and :r_pay_factor_bps::int = (20000 + 12000 + :h2_player_wages_paid_cents::bigint + :h2_ai_wages_paid_cents::bigint) * 10000 / 96000
  and :r_base_wages_cents::bigint = 60000
  and tests.company_cash(:'aco') = :cc2::bigint - :r_bonus_cents::bigint
  and tests.cash(:b) = :bc3::bigint + :r_bonus_cents::bigint
  and (select balance_cents from public.ledger_accounts where system_key = 'households') = :hh2::bigint,
  'quarter close: report = sum of the hours (wages = player wages paid, AI = AI wages paid); only the bonus moves money');

-- =============================================================================
-- D. Catch-up in run_due_jobs, oldest hour first
-- =============================================================================
update public.player_companies set last_hour_at = date_trunc('hour', public.game_now()) - interval '3 hours'
 where company_id = :'aco';
update public.companies set founded_at = date_trunc('hour', public.game_now()) - interval '3 hours' where id = :'aco';
select public.player_companies_run_due() as due \gset
select tests.assert(
  (select count(*) from public.player_company_hours
    where company_id = :'aco' and hour_start >= date_trunc('hour', public.game_now()) - interval '3 hours'
      and hour_start < date_trunc('hour', public.game_now())) = 3
  and (select last_hour_at = date_trunc('hour', public.game_now()) from public.player_companies where company_id = :'aco')
  and (:'due'::jsonb ->> 'hours')::int >= 3
  and (public.player_companies_run_due() ->> 'hours')::int = 0,
  'player_companies_run_due(): closes the missed hours up to the last full hour, then nothing');

-- =============================================================================
-- E. Salaries: AI companies in whole hours, player companies only hourly
-- =============================================================================
select tests.login_as('authenticated', :d);
select x ->> 'id' as dpost from jsonb_array_elements(public.get_job_board() -> 'postings') x
 where (x -> 'company' ->> 'is_ai')::boolean and (x ->> 'eligible')::boolean order by x ->> 'id' limit 1 \gset
select public.apply_for_job(gen_random_uuid(), :'dpost', null, null) ->> 'id' as dapp \gset
select public.sign_contract(gen_random_uuid(), :'dapp', 'M1 1') is not null as ok \gset
reset role;
select id as djob, salary_cents_per_hour as dwage from public.player_jobs where player_id = :d and status = 'active' \gset
update public.player_jobs set last_paid_at = now() - interval '90 minutes', paid_day = null, paid_minutes_today = 0 where id = :'djob';
update public.player_jobs set last_paid_at = now() - interval '3 hours', paid_day = null, paid_minutes_today = 0 where id = :'bjob';
select last_paid_at as dlp0 from public.player_jobs where id = :'djob' \gset
select tests.cash(:d) as dc0 \gset
select tests.cash(:b) as bc4 \gset
select public.accrue_salaries() is not null as ok \gset
select tests.cash(:d) as dc1 \gset
select public.accrue_salaries() is not null as ok \gset
select tests.assert(
  :dc1::bigint = :dc0::bigint + :dwage::bigint and tests.cash(:d) = :dc1::bigint
  and (select last_paid_at = :'dlp0'::timestamptz + interval '1 hour' from public.player_jobs where id = :'djob')
  and tests.cash(:b) = :bc4::bigint
  and (select last_paid_at < now() - interval '2 hours' from public.player_jobs where id = :'bjob'),
  'accrue_salaries(): AI-company jobs in whole hours (90 min -> 1 hour, 30 min wait); player-company jobs are left to the hourly close');

-- a mid-hour settlement (quit, fire, ...) pays at the company's current factor
update public.player_companies set pay_factor_bps = 5000 where company_id = :'aco';
update public.player_jobs set last_paid_at = now() - interval '30 minutes', paid_day = null, paid_minutes_today = 0 where id = :'bjob';
select public.accrue_job_salary(:'bjob', now()) as bmid \gset
select tests.assert(:bmid::bigint = 5000, 'accrue_job_salary() at a player company: partial hour at the current pay factor (30 min x 200 EUR x 50 %)');
update public.player_companies set pay_factor_bps = 10000 where company_id = :'aco';

-- =============================================================================
-- F. COMPANY JSON: live figures and the last hours
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_my_company() -> 'company' as amc \gset
reset role;
select tests.assert(
  (:'amc'::jsonb -> 'live') ?& array['last_hour_at', 'revenue_per_hour_cents', 'profit_per_hour_cents', 'pay_factor_bps',
                                     'today_revenue_cents', 'today_profit_cents', 'quarter_revenue_cents', 'quarter_profit_cents']
  and (:'amc'::jsonb -> 'live' ->> 'last_hour_at')::timestamptz
      = (select last_hour_at from public.player_companies where company_id = :'aco')
  and (:'amc'::jsonb -> 'live' ->> 'revenue_per_hour_cents')::bigint
      = (select revenue_cents from public.player_company_hours where company_id = :'aco' order by hour_start desc limit 1)
  and (:'amc'::jsonb -> 'live' ->> 'profit_per_hour_cents')::bigint
      = (select profit_cents from public.player_company_hours where company_id = :'aco' order by hour_start desc limit 1)
  and (:'amc'::jsonb -> 'live' ->> 'quarter_revenue_cents')::bigint
      = (select coalesce(sum(revenue_cents), 0) from public.player_company_hours
          where company_id = :'aco' and game_quarter_id = (public.current_game_quarter()).id)
  and jsonb_array_length(:'amc'::jsonb -> 'hours') between 1 and 24
  and (:'amc'::jsonb -> 'hours' -> 0) ?& array['hour_start', 'revenue_cents', 'profit_cents']
  and (select bool_and((x ->> 'hour_start')::timestamptz < (y ->> 'hour_start')::timestamptz)
         from jsonb_array_elements(:'amc'::jsonb -> 'hours') with ordinality a(x, i)
         join jsonb_array_elements(:'amc'::jsonb -> 'hours') with ordinality b(y, j) on j = i + 1)
  and (:'amc'::jsonb ->> 'ai_wage_cents_per_hour')::int = 12000,
  'COMPANY: live (last hour, today, quarter, factor), hours oldest first, ai_wage_cents_per_hour');

-- RLS: founder and active employees read the hours, others nothing, nobody writes
select tests.login_as('authenticated', :a);
select count(*) as ra from public.player_company_hours \gset
select tests.throws($$insert into public.player_company_hours (company_id, hour_start, demand_cents, capacity_cents, revenue_cents,
  cogs_cents, fixed_cents, marketing_cents, pay_factor_bps, profit_cents)
  select company_id, now(), 0, 0, 0, 0, 0, 0, 0, 0 from public.player_companies limit 1$$, '42501', 'player_company_hours: no client writes');
reset role;
select tests.login_as('authenticated', :b);
select count(*) as rb from public.player_company_hours \gset
reset role;
select tests.login_as('authenticated', :c);
select count(*) as rc from public.player_company_hours where company_id = :'aco' \gset
reset role;
select tests.login_as('authenticated', :d);
select count(*) as rd from public.player_company_hours \gset
reset role;
select tests.assert(:ra::int >= 6 and :rb::int = :ra::int and :rc::int = 0 and :rd::int = 0,
  'RLS: founder and employees read the company''s hours, others nothing');

-- =============================================================================
-- G. Company ranking
-- =============================================================================
select tests.login_as('authenticated', :a);
select public.get_company_ranking() as rk \gset
select public.get_company_ranking('all', 500) as rka \gset
select public.get_company_ranking('players', 1) as rk1 \gset
select tests.throws_key($$select public.get_company_ranking('aliens')$$, 'invalid_argument', 'get_company_ranking(): unknown scope');
reset role;
select tests.login_as('authenticated', :d);
select public.get_company_ranking() as rkd \gset
reset role;
select tests.assert(
  :'rk'::jsonb ?& array['server_time', 'total', 'entries', 'mine']
  and (:'rk'::jsonb ->> 'total')::int = (select count(*) from public.player_companies where status = 'active')
  and (select bool_and(e ->> 'kind' = 'player') from jsonb_array_elements(:'rk'::jsonb -> 'entries') e)
  and (select bool_and((x ->> 'value_cents')::bigint > (y ->> 'value_cents')::bigint
                       or ((x ->> 'value_cents')::bigint = (y ->> 'value_cents')::bigint and x ->> 'name' <= y ->> 'name'))
         from jsonb_array_elements(:'rka'::jsonb -> 'entries') with ordinality a(x, i)
         join jsonb_array_elements(:'rka'::jsonb -> 'entries') with ordinality b(y, j) on j = i + 1)
  and (select bool_and((e ->> 'rank')::int = i) from jsonb_array_elements(:'rka'::jsonb -> 'entries') with ordinality a(e, i)),
  'get_company_ranking(): players only by default; ordered by value, then name; ranks 1..n');
select tests.assert(
  (select (e ->> 'value_cents')::bigint = public.company_value_cents(:'aco') and (e ->> 'is_mine')::boolean
          and e ->> 'founder' = 'Hanna_Stunde' and e ->> 'tier' = 'garage' and e ->> 'sector' = 'tech'
          and (e ->> 'team_size')::int = 3 and (e ->> 'revenue_cents')::bigint = :r_revenue_cents::bigint
          and e -> 'ticker' = 'null'::jsonb and e ->> 'color' = '#225566'
     from jsonb_array_elements(:'rk'::jsonb -> 'entries') e where e ->> 'company_id' = :'aco')
  and (:'rk'::jsonb -> 'mine' ->> 'value_cents')::bigint = public.company_value_cents(:'aco')
  and (:'rk'::jsonb -> 'mine' ->> 'rank')::int
      = (select (e ->> 'rank')::int from jsonb_array_elements(:'rk'::jsonb -> 'entries') e where e ->> 'company_id' = :'aco')
  and (:'rk1'::jsonb -> 'mine') = (:'rk'::jsonb -> 'mine') and jsonb_array_length(:'rk1'::jsonb -> 'entries') = 1
  and :'rkd'::jsonb -> 'mine' = 'null'::jsonb
  and not exists (select 1 from jsonb_array_elements(:'rkd'::jsonb -> 'entries') e where (e ->> 'is_mine')::boolean),
  'get_company_ranking(): entry with value, founder, tier, team (founder + B + AI worker), last quarter revenue; mine even beyond the limit; null without a company');
select tests.assert(
  (:'rka'::jsonb ->> 'total')::int > (:'rk'::jsonb ->> 'total')::int
  and exists (select 1 from jsonb_array_elements(:'rka'::jsonb -> 'entries') e
               where e ->> 'kind' = 'ai' and e ->> 'ticker' is not null and e -> 'tier' = 'null'::jsonb
                 and e -> 'founder' = 'null'::jsonb and e -> 'team_size' = 'null'::jsonb and e -> 'revenue_cents' = 'null'::jsonb
                 and (e ->> 'value_cents')::bigint
                     = (select public.div_round_half_even(c.shares_outstanding::numeric * q.last_price_e4, 100)::bigint
                          from public.companies c join public.security_quotes q on q.security_id = c.security_id
                         where c.id = (e ->> 'company_id')::uuid)),
  'get_company_ranking(''all''): adds the listed AI companies at market value (shares x last price)');

-- =============================================================================
-- H. Logo once, forbidden symbols (ADR-076)
-- =============================================================================
create or replace function tests.draw(p_pattern text[], p_scale integer, p_ox integer, p_oy integer, p_char text default '0',
                                      p_base text[] default null) returns jsonb language plpgsql as $$
declare
  v_rows text[] := coalesce(p_base, array_fill(repeat('.', 16), array[16]));
  y integer;
  x integer;
  dy integer;
  dx integer;
  r integer;
begin
  for y in 1..array_length(p_pattern, 1) loop
    for x in 1..char_length(p_pattern[y]) loop
      continue when substr(p_pattern[y], x, 1) <> 'x';
      for dy in 0..p_scale - 1 loop
        for dx in 0..p_scale - 1 loop
          r := p_oy + (y - 1) * p_scale + dy + 1;
          v_rows[r] := overlay(v_rows[r] placing p_char from p_ox + (x - 1) * p_scale + dx + 1 for 1);
        end loop;
      end loop;
    end loop;
  end loop;
  return to_jsonb(v_rows);
end;
$$;
grant execute on all functions in schema tests to public;
\set cross '''{x.xxx,x.x..,xxxxx,..x.x,xxx.x}'''
select tests.assert(
  public.logo_has_forbidden_symbol(tests.draw(:cross, 1, 3, 4))
  and public.logo_has_forbidden_symbol(tests.draw(:cross, 3, 0, 0))
  and public.logo_has_forbidden_symbol(tests.draw(array(select reverse(r) from unnest(:cross::text[]) with ordinality u(r, o) order by o), 2, 5, 2)),
  'logo_has_forbidden_symbol(): finds the symbol at any size, place and mirror image');
select tests.assert(
  public.logo_has_forbidden_symbol(tests.draw(:cross, 2, 2, 2, '0', array_fill(repeat('1', 16), array[16])))
  and public.logo_has_forbidden_symbol((select to_jsonb(array_agg(case when o = 2 then overlay(r placing '0' from 2 for 1) else r end order by o))
                                          from jsonb_array_elements_text(tests.draw(:cross, 1, 0, 0)) with ordinality a(r, o))),
  'logo_has_forbidden_symbol(): finds it on a filled background and with one extra pixel');
select tests.assert(
  not public.logo_has_forbidden_symbol(tests.draw('{..x..,..x..,xxxxx,..x..,..x..}', 3, 0, 0))
  and not public.logo_has_forbidden_symbol((select to_jsonb(array_agg(case when y < 2 or y > 13 then repeat('0', 16)
                                                                           else '00' || repeat('.', 12) || '00' end order by y))
                                              from generate_series(0, 15) y))
  and not public.logo_has_forbidden_symbol(to_jsonb(array_fill(repeat('0', 16), array[16])))
  and not public.logo_has_forbidden_symbol(tests.draw('{xxx.x.x,x...x.x,xx...x.,x...x.x,xxx.x.x}', 2, 1, 3)),
  'logo_has_forbidden_symbol(): a plus, a frame, a full square and letters pass');

select jsonb_build_object('palette', '["#111318", "#ffffff"]'::jsonb, 'grid', tests.draw('{..x..,..x..,xxxxx,..x..,..x..}', 3, 0, 0)) as plogo \gset
select tests.login_as('authenticated', :c);
select tests.throws_key(format($$select public.set_company_logo(gen_random_uuid(), %L)$$,
  jsonb_build_object('palette', '["#111318", "#ffffff"]'::jsonb, 'grid', tests.draw(:cross, 2, 1, 1))),
  'logo_forbidden', 'set_company_logo(): forbidden symbol (NX065)');
select public.set_company_logo(gen_random_uuid(), :'plogo') -> 'company' -> 'logo' as clogo \gset
select tests.throws_key(format($$select public.set_company_logo(gen_random_uuid(), %L)$$, :'plogo'),
  'logo_locked', 'set_company_logo(): the logo is set once (NX064)');
reset role;
update public.player_companies set logo_hidden = true where company_id = :'cco';
select tests.login_as('authenticated', :c);
select public.set_company_logo(gen_random_uuid(), jsonb_set(:'plogo'::jsonb, '{palette,1}', '"#00ff00"')) -> 'company' as clogo2 \gset
reset role;
select tests.assert(:'clogo'::jsonb = :'plogo'::jsonb and not (:'clogo2'::jsonb ->> 'logo_hidden')::boolean
  and :'clogo2'::jsonb -> 'logo' -> 'palette' ->> 1 = '#00ff00',
  'set_company_logo(): first logo allowed; a logo hidden by reports may be replaced');

select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds (hourly revenue, wages, AI wages, costs, bonus, salaries)');
