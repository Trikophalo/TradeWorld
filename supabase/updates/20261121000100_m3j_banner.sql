-- ===== idempotent copy of migrations/20261121000100_m3j_banner.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M3j · 0100 · Company banner (ADR-078)
-- =============================================================================
-- A pixel banner above the company page: like the logo, but startups.banner.width
-- × startups.banner.height cells and redrawable at any time (no lock, no reports).
-- Mirrors isValidBanner and hasForbiddenSymbol in src/lib/sim/logo.ts; the forbidden
-- symbol check now works on any width × height (logos stay 16 × 16).
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Column
-- ---------------------------------------------------------------------------
alter table public.player_companies
  add column if not exists banner jsonb check (banner is null or pg_column_size(banner) < 8192);
comment on column public.player_companies.banner is
  'Pixel banner {palette: [#rrggbb], grid: [height x width chars]} above the company page (ADR-078); null = none.';
grant select (banner) on public.player_companies to authenticated;

-- ---------------------------------------------------------------------------
-- B. Forbidden symbols on width × height grids
-- ---------------------------------------------------------------------------
-- Port of hasForbiddenSymbol (src/lib/sim/logo.ts): three templates in all
-- rotations and mirror images, scales 1..3 while the scaled template fits in both
-- dimensions, matched in the whole-drawing mask and in each colour's mask, at most
-- one wrong template cell. Width = length of the first row, height = row count.
-- At scale k a cell is right iff its k x k block is fully set ('x') or fully
-- empty ('.'). Block counts come from prefix sums.
create or replace function public.logo_has_forbidden_symbol(p_grid jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_templates jsonb := '[["x.xxx", "x.x..", "xxxxx", "..x.x", "xxx.x"],
                         ["x..xxxx", "x..x...", "x..x...", "xxxxxxx", "...x..x", "...x..x", "xxxx..x"],
                         ["x...xxxxx", "x...x....", "x...x....", "x...x....", "xxxxxxxxx", "....x...x", "....x...x", "....x...x", "xxxxx...x"]]';
  v_rows  text[];
  v_gh    integer;               -- grid height (rows)
  v_gw    integer;               -- grid width (chars of the first row)
  v_w1    integer;
  v_pats  text[] := '{}';        -- variants, rows joined with '/'
  v_cur   text[];
  v_rot   text[];
  v_key   text;
  v_chars text[];
  v_ch    text;
  v_ps    integer[];
  v_pat   text[];
  v_h     integer;
  v_w     integer;
  v_k     integer;
  v_set   integer;
  v_err   integer;
  v_ok    boolean;
  t       jsonb;
  i       integer;
  x       integer;
  y       integer;
  ox      integer;
  oy      integer;
  tx      integer;
  ty      integer;
  y0      integer;
  x0      integer;
begin
  if p_grid is null or jsonb_typeof(p_grid) <> 'array' then
    return false;
  end if;
  select array_agg(coalesce(e #>> '{}', '') order by o) into v_rows from jsonb_array_elements(p_grid) with ordinality a(e, o);
  v_gh := coalesce(array_length(v_rows, 1), 0);
  if v_gh = 0 then
    return false;
  end if;
  v_gw := char_length(v_rows[1]);
  if v_gw = 0 then
    return false;
  end if;
  v_w1 := v_gw + 1;

  -- variants: four rotations, each with its mirror image (duplicates dropped)
  for t in select value from jsonb_array_elements(v_templates) loop
    select array_agg(r order by o) into v_cur from jsonb_array_elements_text(t) with ordinality a(r, o);
    for i in 1..4 loop
      v_key := array_to_string(v_cur, '/');
      if not (v_key = any (v_pats)) then
        v_pats := v_pats || v_key;
      end if;
      v_key := (select string_agg(reverse(r), '/' order by o) from unnest(v_cur) with ordinality a(r, o));
      if not (v_key = any (v_pats)) then
        v_pats := v_pats || v_key;
      end if;
      -- rotate: new row x = column x read from the bottom up
      v_rot := '{}';
      for x in 1..char_length(v_cur[1]) loop
        v_rot := v_rot || (select string_agg(substr(v_cur[yy], x, 1), '' order by yy desc)
                             from generate_series(1, array_length(v_cur, 1)) yy);
      end loop;
      v_cur := v_rot;
    end loop;
  end loop;

  -- masks: the whole drawing ('*'), then every colour used
  v_chars := array['*'] || coalesce((select array_agg(distinct ch order by ch)
                                       from unnest(v_rows) r, regexp_split_to_table(r, '') ch where ch <> '.'), '{}');
  foreach v_ch in array v_chars loop
    -- prefix sums: v_ps[y * (width + 1) + x + 1] = set cells in rows < y and columns < x
    v_ps := array_fill(0, array[(v_gh + 1) * v_w1]);
    for y in 1..v_gh loop
      for x in 1..v_gw loop
        v_ps[y * v_w1 + x + 1] := v_ps[(y - 1) * v_w1 + x + 1] + v_ps[y * v_w1 + x] - v_ps[(y - 1) * v_w1 + x]
          + case when (v_ch = '*' and substr(v_rows[y], x, 1) not in ('.', ''))
                      or (v_ch <> '*' and substr(v_rows[y], x, 1) = v_ch) then 1 else 0 end;
      end loop;
    end loop;
    foreach v_key in array v_pats loop
      v_pat := string_to_array(v_key, '/');
      v_h := array_length(v_pat, 1);
      v_w := char_length(v_pat[1]);
      v_k := 1;
      while v_k <= 3 and v_k * v_w <= v_gw and v_k * v_h <= v_gh loop
        for oy in 0..v_gh - v_h * v_k loop
          for ox in 0..v_gw - v_w * v_k loop
            v_err := 0;
            v_ok := true;
            <<cells>>
            for ty in 0..v_h - 1 loop
              for tx in 0..v_w - 1 loop
                y0 := oy + ty * v_k;
                x0 := ox + tx * v_k;
                v_set := v_ps[(y0 + v_k) * v_w1 + x0 + v_k + 1] - v_ps[y0 * v_w1 + x0 + v_k + 1]
                       - v_ps[(y0 + v_k) * v_w1 + x0 + 1] + v_ps[y0 * v_w1 + x0 + 1];
                if (substr(v_pat[ty + 1], tx + 1, 1) = 'x' and v_set <> v_k * v_k)
                   or (substr(v_pat[ty + 1], tx + 1, 1) <> 'x' and v_set <> 0) then
                  v_err := v_err + 1;
                  if v_err > 1 then
                    v_ok := false;
                    exit cells;
                  end if;
                end if;
              end loop;
            end loop;
            if v_ok then
              return true;
            end if;
          end loop;
        end loop;
        v_k := v_k + 1;
      end loop;
    end loop;
  end loop;
  return false;
end;
$$;
comment on function public.logo_has_forbidden_symbol(jsonb) is
  'True if a logo or banner grid (any width x height) shows a forbidden symbol (port of hasForbiddenSymbol in src/lib/sim/logo.ts, ADR-076, ADR-078).';

-- ---------------------------------------------------------------------------
-- C. Banner validation and RPC
-- ---------------------------------------------------------------------------
-- isValidBanner: palette 1..banner.maxColors lowercase #rrggbb, banner.height rows of
-- banner.width chars from '.' and the palette indices (no minimum of pixels)
create or replace function public.banner_valid(p_banner jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_width  integer := public.config_double('startups', '{banner,width}', 48)::integer;
  v_height integer := public.config_double('startups', '{banner,height}', 12)::integer;
  v_max    integer := public.config_double('startups', '{banner,maxColors}', 6)::integer;
  v_n      integer;
  v_re     text;
begin
  if p_banner is null or jsonb_typeof(p_banner) <> 'object'
     or jsonb_typeof(p_banner -> 'palette') is distinct from 'array' or jsonb_typeof(p_banner -> 'grid') is distinct from 'array' then
    return false;
  end if;
  v_n := jsonb_array_length(p_banner -> 'palette');
  if v_n < 1 or v_n > v_max
     or exists (select 1 from jsonb_array_elements(p_banner -> 'palette') c
                 where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-f]{6}$') then
    return false;
  end if;
  if jsonb_array_length(p_banner -> 'grid') <> v_height then
    return false;
  end if;
  v_re := '^[.0-' || (v_n - 1) || ']{' || v_width || '}$';
  return not exists (select 1 from jsonb_array_elements(p_banner -> 'grid') r
                      where jsonb_typeof(r) <> 'string' or (r #>> '{}') !~ v_re);
end;
$$;
comment on function public.banner_valid(jsonb) is 'Port of isValidBanner (src/lib/sim/logo.ts, ADR-078).';

-- Founder only; may be redrawn any time; null (SQL or JSON) removes the banner.
create or replace function public.set_company_banner(p_request_id uuid, p_banner jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_player  uuid;
  v_replay  jsonb;
  v_remove  boolean := p_banner is null or jsonb_typeof(p_banner) = 'null';
begin
  v_company := public.require_own_company();
  v_player := public.require_player();
  if p_request_id is null or (not v_remove and not public.banner_valid(p_banner)) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'set_company_banner');
  if v_replay is not null then
    return v_replay;
  end if;
  if not v_remove and public.logo_has_forbidden_symbol(p_banner -> 'grid') then
    raise exception using errcode = 'NX065', message = 'logo_forbidden';
  end if;
  update public.player_companies
     set banner = case when v_remove then null
                       else jsonb_build_object('palette', p_banner -> 'palette', 'grid', p_banner -> 'grid') end
   where company_id = v_company;
  return public.request_complete(v_player, p_request_id, jsonb_build_object('company', public.company_state(v_company)));
end;
$$;
comment on function public.set_company_banner(uuid, jsonb) is
  'RPC: set or remove (null) the company banner (ADR-078); founder only, no lock; errors invalid_argument, logo_forbidden.';

-- ---------------------------------------------------------------------------
-- D. COMPANY with banner
-- ---------------------------------------------------------------------------
-- company_state as in M3i plus banner (appended: jsonb_build_object takes at most 100 arguments)
create or replace function public.company_state(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pc       public.player_companies;
  c        public.companies;
  v_team   jsonb;
  v_tier   jsonb;
  v_sb     jsonb;
  v_level  integer;
  v_cash   bigint;
  v_spread double precision;
  v_last   jsonb;
  v_hist   jsonb;
  v_cost   bigint;
begin
  select * into pc from public.player_companies where company_id = p_company;
  if pc.company_id is null then
    return null;
  end if;
  select * into c from public.companies where id = p_company;
  v_team := public.player_company_team(p_company);
  v_tier := public.company_tier_cfg(pc.tier);
  v_sb := public.company_tier_cfg('small_business');
  select p.level into v_level from public.profiles p where p.id = pc.founder_id;
  v_cash := coalesce((select a.balance_cents from public.ledger_accounts a where a.owner_company_id = p_company and a.kind = 'company_cash'), 0);
  v_spread := public.config_double('startups', '{estimate,initialSpread}', 2.3)
            * power(public.config_double('startups', '{estimate,decayPerQuarter}', 0.85), pc.quarters_active);
  select jsonb_build_object(
           'label', r.label, 'demand_cents', r.demand_cents, 'capacity_cents', r.capacity_cents,
           'revenue_cents', r.revenue_cents, 'cogs_cents', r.cogs_cents, 'fixed_cents', r.fixed_cents,
           'ai_worker_cents', r.ai_worker_cents, 'marketing_cents', r.marketing_cents, 'wages_cents', r.wages_cents,
           'operating_profit_cents', r.operating_profit_cents, 'utilization_bps', r.utilization_bps,
           'bonus_cents', r.bonus_cents)
    into v_last
    from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
   where r.company_id = p_company order by gq.ends_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('label', h.label, 'revenue_cents', h.revenue_cents,
                                               'profit_cents', h.operating_profit_cents) order by h.ends_at), '[]'::jsonb)
    into v_hist
    from (select r.label, r.revenue_cents, r.operating_profit_cents, gq.ends_at
            from public.player_company_reports r join public.game_quarters gq on gq.id = r.game_quarter_id
           where r.company_id = p_company order by gq.ends_at desc limit 12) h;
  v_cost := public.company_upgrade_cost(pc.tier);
  return jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'idea', pc.idea,
    'sector', c.sector_key,
    'color', c.brand_color,
    'logo', public.company_logo(p_company),
    'logo_hidden', pc.logo_hidden,
    'founder_has_job', exists (select 1 from public.player_jobs x where x.player_id = pc.founder_id and x.status = 'active'),
    'full_time_from', public.config_double('startups', '{fullTimeFromEmployees}', 5)::integer,
    'training_from', public.config_double('startups', '{training,fromEmployees}', 5)::integer,
    'headcount', public.company_headcount(p_company),
    'tier', pc.tier,
    'founded_at', c.founded_at,
    'cash_cents', v_cash,
    'value_cents', public.company_value_cents(p_company),
    'unpaid_cents', pc.unpaid_cents,
    'distress', pc.distress,
    'distress_quarters', pc.distress_quarters,
    'grace_quarters', public.config_double('startups', '{insolvency,graceQuarters}', 4)::integer,
    'pay_factor_bps', pc.pay_factor_bps,
    'product_key', public.company_product(p_company) ->> 'key',
    'stage', (v_team ->> 'stage')::integer,
    'stages', public.company_stages_json(p_company),
    'awareness_bps', round(pc.awareness * 10000)::integer,
    'quality_bps', round(pc.quality * 10000)::integer,
    'quarters_active', pc.quarters_active,
    'estimate_low_cents', round(pc.potential_annual_cents
                                * exp(-v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':low'))))::bigint,
    'estimate_high_cents', round(pc.potential_annual_cents
                                 * exp(v_spread * (0.3 + 0.7 * public.uniform_from_text(pc.company_id::text || ':' || pc.quarters_active || ':high'))))::bigint,
    'marketing_cents_per_quarter', pc.marketing_cents_per_quarter,
    'ai_workers', pc.ai_workers,
    'ai_worker_cost_cents', public.config_bigint('startups', '{aiWorkerCostCentsPerQuarter}', 72000),
    'ai_wage_cents_per_hour', public.config_bigint('startups', '{aiWorkerWageCentsPerHour}', 12000),
    'ai_worker_skills', to_jsonb(pc.ai_worker_skills),
    'max_employees', (v_tier ->> 'maxEmployees')::integer,
    'employees', (v_team ->> 'employees')::integer,
    'open_postings', (select count(*) from public.job_postings jp where jp.company_id = p_company and jp.status = 'open')::integer,
    'pending_applications', (select count(*) from public.job_applications a join public.job_postings jp on jp.id = a.posting_id
                              where jp.company_id = p_company and a.status = 'pending')::integer,
    'founder_productivity_bps', (v_team ->> 'founder_productivity_bps')::integer,
    'team_productivity_bps', (v_team ->> 'team_productivity_bps')::integer,
    'capacity_cents', (v_team ->> 'capacity_cents')::bigint,
    'next_quarter_at', coalesce((public.current_game_quarter()).ends_at, public.game_now()),
    'can_upgrade', public.company_next_tier(pc.tier) is not null
                   and coalesce(v_level, 1) >= (public.company_tier_cfg(public.company_next_tier(pc.tier)) ->> 'minLevel')::integer,
    'listing', public.company_listing_json(p_company, pc.founder_id),
    'can_go_public', c.phase = 'private' and public.company_open_offer(p_company) is null
                     and coalesce(public.config_jsonb('startups', '{ipo,fromTiers}'), '["small_business", "gmbh"]'::jsonb) ? pc.tier
                     and coalesce(v_level, 1) >= public.config_double('startups', '{ipo,minLevel}', 12),
    'can_capital_increase', c.phase = 'listed' and public.company_open_offer(p_company) is null,
    'upgrade_cost_cents', v_cost,
    'last_quarter', v_last,
    'history', v_hist,
    'live', public.company_live_json(p_company),
    'hours', public.company_hours_json(p_company))
    || jsonb_build_object('banner', pc.banner);
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.logo_has_forbidden_symbol(jsonb)', 'public.banner_valid(jsonb)', 'public.company_state(uuid)',
    'public.set_company_banner(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  execute 'grant execute on function public.set_company_banner(uuid, jsonb) to authenticated';
end;
$$;
