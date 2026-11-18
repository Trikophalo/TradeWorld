-- =============================================================================
-- Talente and Weltkarte both in the hour terms (ADR-199, ADR-208)
-- =============================================================================
-- 010010 (Weltkarte) redefined listed_hour_effect from the 8300 version and so dropped the Talente factor that 8900
-- added. This is the 010010 definition with the Talente block of 8900 put back, in the same order as before (skills,
-- Talente, Weltkarte).

create or replace function public.listed_hour_effect(p_company uuid, p_hour_start timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l    public.listed_companies;
  v_df double precision := 1;
  v_r  jsonb;
  v_sk jsonb;
  v_w  jsonb;
  v_tl jsonb;
begin
  l := public.listed_ensure(p_company);
  if l.company_id is null then
    begin
      v_df := public.company_reputation_demand_factor(
                (select pc.reputation from public.player_companies pc where pc.company_id = p_company));
    exception when others then
      v_df := 1;
    end;
    v_r := jsonb_build_object('awareness_add', 0, 'quality_add', 0, 'demand_factor', coalesce(v_df, 1), 'capacity_factor', 1,
                              'cogs_factor', 1, 'fixed_factor', 1, 'listed', false);
  else
    v_r := public.listed_hour_effect_calc(public.listed_effects(p_company), l.satisfaction, l.reputation)
           || jsonb_build_object('listed', true);
  end if;
  -- ADR-194: Fertigkeiten; a failure never stops the close
  begin
    v_sk := public.company_skills_hour_effect(p_company, p_hour_start);
    v_r := v_r || jsonb_build_object(
      'demand_factor', (v_r ->> 'demand_factor')::double precision * (v_sk ->> 'demand_factor')::double precision,
      'capacity_factor', (v_r ->> 'capacity_factor')::double precision * (v_sk ->> 'capacity_factor')::double precision,
      'cogs_factor', (v_r ->> 'cogs_factor')::double precision * (v_sk ->> 'cogs_factor')::double precision,
      'fixed_factor', (v_r ->> 'fixed_factor')::double precision * (v_sk ->> 'fixed_factor')::double precision,
      'quality_add', (v_r ->> 'quality_add')::double precision + (v_sk ->> 'quality_add')::double precision,
      'skills', v_sk);
  exception when others then
    null;
  end;
  -- ADR-199: Talente of the filled Stellen; a failure never stops the close
  begin
    v_tl := public.talents_hour_effect(p_company);
    v_r := v_r || jsonb_build_object(
      'demand_factor', (v_r ->> 'demand_factor')::double precision * (v_tl ->> 'demand_factor')::double precision,
      'capacity_factor', (v_r ->> 'capacity_factor')::double precision * (v_tl ->> 'capacity_factor')::double precision,
      'cogs_factor', (v_r ->> 'cogs_factor')::double precision * (v_tl ->> 'cogs_factor')::double precision,
      'fixed_factor', (v_r ->> 'fixed_factor')::double precision * (v_tl ->> 'fixed_factor')::double precision,
      'quality_add', (v_r ->> 'quality_add')::double precision + (v_tl ->> 'quality_add')::double precision,
      'talents', v_tl);
  exception when others then
    null;
  end;
  -- ADR-208: Weltkarte (country of the HQ, subsidiaries, prestige); a failure never stops the close
  begin
    v_w := public.world_hour_effect(p_company, p_hour_start);
    if coalesce((v_w ->> 'placed')::boolean, false) then
      v_r := v_r || jsonb_build_object(
        'demand_factor', (v_r ->> 'demand_factor')::double precision * (v_w ->> 'demand_factor')::double precision,
        'cogs_factor', (v_r ->> 'cogs_factor')::double precision * (v_w ->> 'cogs_factor')::double precision,
        'fixed_factor', (v_r ->> 'fixed_factor')::double precision * (v_w ->> 'fixed_factor')::double precision,
        'world', v_w);
    end if;
  exception when others then
    perform public.company_close_warn(p_company, 'world_effect', sqlerrm);
  end;
  return v_r;
end;
$$;

