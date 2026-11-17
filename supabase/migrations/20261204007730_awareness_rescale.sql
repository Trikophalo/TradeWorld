-- =============================================================================
-- NEXA · 7730 · Awareness, one model (ADR-188): existing companies move to the new caps, once
-- =============================================================================
-- * Every active player company keeps its standing relative to its cap: awareness / old stage cap (garage 50 %,
--   then 70, 85, 95, 100 %) x the new cap (tier, stage, expansion). Nobody drops to 0; a company at its old cap
--   stands at its new cap. The change is booked as "rescale" in the open hour, so the ledger has a start.
-- * The strength "Bekanntheit" is set to 100 x awareness / cap, so it agrees with the value from the first hour on.
-- * Runs once (public.data_migrations), however often the update script is executed.
-- * The old six-argument company_awareness_hour (ADR-180) is gone; company_awareness_step replaces it.
-- Idempotent: runs unchanged as supabase/updates/.

create table if not exists public.data_migrations (
  key        text primary key,
  applied_at timestamptz not null default now()
);
alter table public.data_migrations enable row level security;
revoke all on public.data_migrations from anon, authenticated;
comment on table public.data_migrations is 'One-time data changes that must not repeat when the update script runs again.';

do $$
declare
  r        record;
  v_old    double precision[] := array[0.5, 0.7, 0.85, 0.95, 1.0];
  v_stage  integer;
  v_oldcap double precision;
  v_newcap double precision;
  v_min    double precision := public.cfg_num(public.company_awareness_cfg(), '{min}', 0.02);
  v_new    double precision;
begin
  if exists (select 1 from public.data_migrations where key = 'awareness_rescale_188') then
    return;
  end if;
  for r in select pc.company_id, pc.tier, pc.expansion_level, pc.awareness
             from public.player_companies pc where pc.status = 'active' for update loop
    v_stage := least(4, greatest(0, coalesce((public.player_company_team(r.company_id) ->> 'stage')::integer, 0)));
    v_oldcap := v_old[v_stage + 1];
    v_newcap := public.company_awareness_cap(r.tier, v_stage, coalesce(r.expansion_level, 0));
    v_new := least(v_newcap, greatest(v_min, coalesce(r.awareness, 0) / v_oldcap * v_newcap));
    update public.player_companies set awareness = v_new, awareness_boost = 0 where company_id = r.company_id;
    perform public.company_awareness_log_add(r.company_id, public.game_now(), 'rescale', v_new - coalesce(r.awareness, 0));
    update public.company_strengths s
       set scores = s.scores || jsonb_build_object('awareness', round((100 * least(1, v_new / v_newcap))::numeric, 4))
     where s.company_id = r.company_id;
  end loop;
  insert into public.data_migrations (key) values ('awareness_rescale_188') on conflict do nothing;
end;
$$;

drop function if exists public.company_awareness_hour(double precision, double precision, double precision,
  double precision, double precision, integer);
