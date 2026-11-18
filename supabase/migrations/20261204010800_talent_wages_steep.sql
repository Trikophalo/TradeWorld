-- =============================================================================
-- Talente: much steeper wages, risen demands of hired talents, raising the wage (Nachtrag ADR-199)
-- =============================================================================
-- The wages themselves come from game_config "talents" (pnpm db:config). This migration makes them reach the rows:
-- * talents_ensure() synced only when the pool size changed; now also when the pool itself changed (md5 in
--   talent_pool_sync). A hired talent whose demand rose above the contract gets raise_due_at = now + raiseGraceHours
--   and a notification; until then nothing happens, afterwards satisfaction falls (satisfaction.underpaidBps per hour)
--   until the owner pays at least the demand (talent_raise) or the talent quits.
-- * talent_wage_floor(t): the demand, for a Mit-Geschäftsführer plus the co-CEO premium (talentWageFloor).
-- * talent_hour (full copy of 8900) adds the underpaid loss; talent_own_json (full copy of 8900) shows
--   raise_due_at and wage_floor_cents.
-- * talent_raise(request, key, wage, benefits): renegotiates the contract of an own talent.

alter table public.talents add column if not exists raise_due_at timestamptz;
comment on column public.talents.raise_due_at is
  'ADR-199: the demand rose above the contract; from this time on the talent loses satisfaction until the wage is raised.';

create table if not exists public.talent_pool_sync (
  id         boolean primary key default true check (id),
  pool_hash  text not null,
  synced_at  timestamptz not null default now()
);
alter table public.talent_pool_sync enable row level security;
revoke all on public.talent_pool_sync from anon, authenticated;
comment on table public.talent_pool_sync is
  'ADR-199: md5 of the talent pool last synced from game_config (talents_ensure); server-only, no policies.';

-- talentWageFloor
create or replace function public.talent_wage_floor(t public.talents)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when t.is_coceo
              then ceil(t.wage_demand_cents * (10000 + public.cfg_num(public.talents_cfg(), '{coCeo,wageBonusBps}', 3000))
                        / 10000.0 / 100.0)::bigint * 100
              else t.wage_demand_cents end;
$$;

-- Syncs the pool from the config: new talents are added, the generated fields of existing ones follow the config.
-- Hired talents whose demand now exceeds the contract get a grace period and a notification.
create or replace function public.talents_ensure()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.talents_cfg();
  v_pool  jsonb := coalesce(cfg -> 'pool', '[]'::jsonb);
  v_hash  text := md5(coalesce(cfg -> 'pool', '[]'::jsonb)::text);
  v_now   timestamptz := public.game_now();
  v_grace integer := coalesce((cfg ->> 'raiseGraceHours')::integer, 24);
  v_n     integer;
  t       public.talents;
begin
  if jsonb_array_length(v_pool) = (select count(*) from public.talents)
     and exists (select 1 from public.talent_pool_sync s where s.id and s.pool_hash = v_hash) then
    return 0;
  end if;
  insert into public.talents as t (talent_key, role_key, tier, first_name, last_name, avatar_key, traits, wage_demand_cents,
                                   benefit_demands, min_reputation, min_awareness_bps, min_form, effect_bps)
  select p ->> 'key', p ->> 'role', (p ->> 'tier')::smallint, p ->> 'firstName', p ->> 'lastName', p ->> 'avatar',
         array(select jsonb_array_elements_text(p -> 'traits')), (p ->> 'wageCents')::bigint,
         array(select jsonb_array_elements_text(p -> 'benefits')), (p ->> 'minReputation')::integer,
         (p ->> 'minAwarenessBps')::integer, (p ->> 'minForm')::smallint, (p ->> 'effectBps')::integer
    from jsonb_array_elements(v_pool) p
  on conflict (talent_key) do update
    set role_key = excluded.role_key, tier = excluded.tier, first_name = excluded.first_name,
        last_name = excluded.last_name, avatar_key = excluded.avatar_key, traits = excluded.traits,
        wage_demand_cents = excluded.wage_demand_cents, benefit_demands = excluded.benefit_demands,
        min_reputation = excluded.min_reputation, min_awareness_bps = excluded.min_awareness_bps,
        min_form = excluded.min_form, effect_bps = excluded.effect_bps;
  get diagnostics v_n = row_count;
  -- contracts that cover the demand (again) have no deadline
  update public.talents x set raise_due_at = null
   where x.raise_due_at is not null and (x.company_id is null or x.wage_cents >= public.talent_wage_floor(x));
  -- risen demands: grace period and a notification
  for t in select * from public.talents x
            where x.company_id is not null and x.raise_due_at is null and x.wage_cents < public.talent_wage_floor(x)
            for update
  loop
    update public.talents set raise_due_at = v_now + make_interval(hours => v_grace) where talent_key = t.talent_key;
    perform public.talent_log(t.company_id, t.talent_key, 'demand_raised',
      jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'wage_cents', t.wage_cents,
                         'demand_cents', public.talent_wage_floor(t), 'hours', v_grace));
    perform public.talent_notify_founder(t.company_id, 'Gehaltsforderung gestiegen',
      public.talent_name(t) || ' verlangt jetzt mindestens ' || replace(to_char(public.talent_wage_floor(t) / 100, 'FM999,999,999,990'), ',', '.')
        || ' € je Stunde. Du hast ' || v_grace || ' Stunden, um das Gehalt anzupassen, sonst sinkt die Zufriedenheit.',
      jsonb_build_object('talent_key', t.talent_key),
      'talent:raise:' || t.talent_key || ':' || public.talent_wage_floor(t)::text);
  end loop;
  insert into public.talent_pool_sync (id, pool_hash, synced_at) values (true, v_hash, now())
  on conflict (id) do update set pool_hash = excluded.pool_hash, synced_at = excluded.synced_at;
  return v_n;
end;
$$;

-- One full hour of one talent: wage and benefits through the ledger, satisfaction, warning, quitting
create or replace function public.talent_hour(p_key text, p_hour_start timestamptz)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg     jsonb := public.talents_cfg();
  t       public.talents;
  pc      public.player_companies;
  v_facts jsonb;
  v_cost  bigint;
  v_free  bigint;
  v_paid  boolean;
  v_morale double precision;
  v_dec   double precision := 1;
  v_loss  double precision := 0;
  v_sat   integer;
  tr      text;
begin
  select * into t from public.talents where talent_key = p_key for update;
  if t.company_id is null then
    return 'gone';
  end if;
  select * into pc from public.player_companies where company_id = t.company_id;
  if pc.company_id is null or pc.status <> 'active' then
    perform public.talent_release(t.talent_key, p_hour_start + interval '1 hour', true);
    return 'gone';
  end if;
  v_cost := public.talent_offer_cost(t.wage_cents, t.benefits);
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a where a.owner_company_id = t.company_id and a.kind = 'company_cash' for update;
  v_paid := coalesce(v_free, 0) >= v_cost;
  if v_paid and v_cost > 0 then
    perform public.ledger_transfer(public.company_cash_account(t.company_id), public.ledger_system_account('households'),
                                   v_cost, 'company_costs', 'Talent: ' || public.talent_name(t), 'company', t.company_id,
                                   'talent_wage:' || t.talent_key || ':' || t.company_id::text || ':'
                                     || extract(epoch from p_hour_start)::bigint::text, pc.founder_id);
  end if;
  v_facts := public.talent_company_facts(t.company_id);
  -- talentSatisfactionStep
  foreach tr in array t.traits loop
    v_dec := v_dec * coalesce((select (x ->> 'decayPct')::double precision
                                 from jsonb_array_elements(coalesce(cfg -> 'traits', '[]'::jsonb)) x where x ->> 'key' = tr), 100) / 100.0;
  end loop;
  if not v_paid then v_loss := v_loss + public.cfg_num(cfg, '{satisfaction,unpaidBps}', 2500); end if;
  if (v_facts ->> 'reputation')::double precision < t.min_reputation then
    v_loss := v_loss + public.cfg_num(cfg, '{satisfaction,reputationBps}', 800);
  end if;
  if (v_facts ->> 'awareness_bps')::integer < t.min_awareness_bps then
    v_loss := v_loss + public.cfg_num(cfg, '{satisfaction,awarenessBps}', 400);
  end if;
  if not (t.benefit_demands <@ t.benefits) then
    v_loss := v_loss + public.cfg_num(cfg, '{satisfaction,benefitBps}', 600);
  end if;
  -- Nachtrag ADR-199: the demand rose above the contract and the grace period is over
  if t.raise_due_at is not null and t.raise_due_at <= p_hour_start and t.wage_cents < public.talent_wage_floor(t) then
    v_loss := v_loss + public.cfg_num(cfg, '{satisfaction,underpaidBps}', 1500);
  end if;
  v_morale := case when t.role_key = 'hr' then 0
                   else (public.talents_hour_effect(t.company_id) #>> '{bps,morale}')::double precision end;
  v_sat := greatest(0, least(10000, t.satisfaction_bps
             + case when v_loss > 0 then -round(v_loss * v_dec)::integer else public.cfg_num(cfg, '{satisfaction,gainBps}', 250)::integer end
             + greatest(0, coalesce(v_morale, 0))::integer));
  insert into public.talent_hours (talent_key, hour_start, company_id, cost_cents, paid, satisfaction_bps)
  values (t.talent_key, p_hour_start, t.company_id, v_cost, v_paid, v_sat)
  on conflict do nothing;
  update public.talents set satisfaction_bps = v_sat, paid_until = p_hour_start + interval '1 hour' where talent_key = t.talent_key;
  if v_sat <= public.cfg_num(cfg, '{satisfaction,quitBps}', 1000) then
    perform public.talent_release(t.talent_key, p_hour_start + interval '1 hour', true);
    perform public.talent_log(t.company_id, t.talent_key, 'quit',
      jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'paid', v_paid));
    perform public.talent_notify_founder(t.company_id, 'Kündigung', public.talent_name(t) || ' hat gekündigt.',
      jsonb_build_object('talent_key', t.talent_key), 'talent:quit:' || t.talent_key || ':' || extract(epoch from p_hour_start)::bigint::text);
    return 'quit';
  end if;
  if v_sat < public.cfg_num(cfg, '{satisfaction,warnBps}', 3500) and t.warned_at is null then
    update public.talents set warned_at = p_hour_start + interval '1 hour' where talent_key = t.talent_key;
    perform public.talent_log(t.company_id, t.talent_key, 'warned',
      jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'satisfaction_bps', v_sat, 'paid', v_paid));
    perform public.talent_notify_founder(t.company_id, 'Talent unzufrieden',
      public.talent_name(t) || ' ist unzufrieden und denkt über eine Kündigung nach.',
      jsonb_build_object('talent_key', t.talent_key), 'talent:warn:' || t.talent_key || ':' || extract(epoch from p_hour_start)::bigint::text);
  elsif v_sat >= public.cfg_num(cfg, '{satisfaction,warnBps}', 3500) then
    update public.talents set warned_at = null where talent_key = t.talent_key and warned_at is not null;
  end if;
  return case when v_paid then 'paid' else 'unpaid' end;
end;
$$;

create or replace function public.talent_own_json(t public.talents, p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.talent_json(t, p_now, t.company_id) || jsonb_build_object(
    'wage_cents', t.wage_cents, 'benefits', to_jsonb(t.benefits),
    'cost_cents', public.talent_offer_cost(t.wage_cents, t.benefits),
    'hired_at', t.hired_at, 'satisfaction_bps', t.satisfaction_bps, 'warned', t.warned_at is not null,
    'coceo_autonomy', t.coceo_autonomy, 'coceo_budget_cents', t.coceo_budget_cents,
    'coceo_spent_cents', case when t.coceo_spent_day = (p_now at time zone 'Europe/Berlin')::date then t.coceo_spent_cents else 0 end,
    'wage_floor_cents', public.talent_wage_floor(t),
    'raise_due_at', case when t.wage_cents < public.talent_wage_floor(t) then t.raise_due_at end);
$$;

-- The owner renegotiates the contract of an own talent: at least the demand (co-CEO: plus premium) and every
-- demanded benefit. No cash cover check: the talent already works here.
create or replace function public.talent_raise(p_request_id uuid, p_talent_key text, p_wage_cents bigint, p_benefits text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  cfg      jsonb := public.talents_cfg();
  v_co     uuid;
  t        public.talents;
  v_ben    text[];
begin
  v_player := public.require_player();
  if p_request_id is null or p_talent_key is null or p_wage_cents is null or p_wage_cents <= 0 or p_wage_cents % 100 <> 0 then
    perform public.api_error('invalid_argument');
  end if;
  v_ben := array(select distinct b from unnest(coalesce(p_benefits, '{}'::text[])) b
                  where coalesce(cfg -> 'benefitCostBps', '{}'::jsonb) ? b order by 1);
  if cardinality(v_ben) <> (select count(distinct b) from unnest(coalesce(p_benefits, '{}'::text[])) b) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'talent_raise');
  if v_replay is not null then
    return v_replay;
  end if;
  perform public.talents_ensure();
  v_co := public.talent_my_company(v_player);
  if v_co is null then
    perform public.api_error('company_not_found');
  end if;
  perform 1 from public.player_companies where company_id = v_co for update;
  select * into t from public.talents where talent_key = p_talent_key for update;
  if t.talent_key is null or t.company_id is distinct from v_co then
    perform public.api_error('invalid_argument');
  end if;
  if t.is_coceo and not ('say' = any (v_ben)) then
    v_ben := array(select distinct b from unnest(v_ben || array['say']) b order by 1);
  end if;
  if p_wage_cents < public.talent_wage_floor(t) or not (t.benefit_demands <@ v_ben) then
    perform public.api_error('demands_not_met');
  end if;
  if 'office' = any (v_ben) and not ('office' = any (t.benefits))
     and coalesce((public.talent_company_facts(v_co) ->> 'expansion_level')::integer, 0) < 1 then
    perform public.api_error('demands_not_met');
  end if;
  update public.talents set wage_cents = p_wage_cents, benefits = v_ben, raise_due_at = null where talent_key = t.talent_key;
  perform public.talent_log(v_co, t.talent_key, 'raised',
    jsonb_build_object('name', public.talent_name(t), 'role', t.role_key, 'wage_cents', p_wage_cents,
                       'previous_cents', t.wage_cents));
  return public.request_complete(v_player, p_request_id, public.company_talents_json(v_co));
end;
$$;
comment on function public.talent_raise(uuid, text, bigint, text[]) is
  'RPC: new contract for an own talent (Nachtrag ADR-199): wage at least the demand, every demanded benefit. '
  'Errors demands_not_met, invalid_argument.';

do $do$
declare
  f text;
begin
  foreach f in array array['public.talent_wage_floor(public.talents)', 'public.talents_ensure()',
                           'public.talent_hour(text, timestamptz)', 'public.talent_own_json(public.talents, timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  revoke all on function public.talent_raise(uuid, text, bigint, text[]) from public, anon;
  grant execute on function public.talent_raise(uuid, text, bigint, text[]) to authenticated;
end;
$do$;
