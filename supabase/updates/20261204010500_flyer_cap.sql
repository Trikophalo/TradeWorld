-- ===== idempotent copy of migrations/20261204010500_flyer_cap.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- Flyer price cap for small companies (ADR-212)
-- =============================================================================
-- A campaign costs costHours x the demand of the last hour (ADR-097), and the demand comes from the heavy-tailed
-- market size drawn at founding. About 5.6 % of new garages could not afford even the flyer from their starting cash.
-- The flyer of a small company (legal form in startups.campaigns.flyerCapTiers, or company value below
-- flyerCapBelowValueCents) now costs at most flyerCapCents, before the founder's ad_agency discount. Online and TV
-- campaigns and bigger companies pay the normal price.
-- company_campaign_cost_cents() is the one price used by start_campaign() and company_campaign_costs() (the price on
-- the campaign card), so both show and charge the same capped price. This is the 000700 definition with the cap.
-- New internal helper: campaign_cap_cents(). No new RPCs, no new error keys. Idempotent.

-- ADR-212: highest price of a campaign kind for a company, null when it pays the normal price
create or replace function public.campaign_cap_cents(p_company uuid, p_kind text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when p_kind <> 'flyer' then null
           when exists (select 1 from public.player_companies pc
                         where pc.company_id = p_company
                           and (coalesce(x.c -> 'flyerCapTiers', '["garage"]'::jsonb) ? pc.tier
                                or public.company_value_cents(p_company)
                                   < public.cfg_num(x.c, '{flyerCapBelowValueCents}', 100000000)))
             then public.cfg_num(x.c, '{flyerCapCents}', 200000)::bigint
         end
    from (select public.campaigns_cfg() as c) x;
$$;
comment on function public.campaign_cap_cents(uuid, text) is
  'Internal (ADR-212): highest flyer price of a small company (garage or value below the threshold), else null.';

-- campaign_cost_cents, at most the cap of a small company (ADR-212), less the founder's ad_agency, in whole euros
create or replace function public.company_campaign_cost_cents(p_company uuid, p_kind text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (round((x.c - public.apply_bps(x.c, public.company_upgrade_bps(p_company, 'ad_agency')))::numeric / 100) * 100)::bigint
    from (select least(public.campaign_cost_cents(p_kind, public.company_campaign_base_cents(p_company)),
                       public.campaign_cap_cents(p_company, p_kind)) as c) x;
$$;
comment on function public.company_campaign_cost_cents(uuid, text) is
  'Internal (ADR-097, ADR-134, ADR-212): price of a marketing campaign of a company: the flyer of a small company '
  'capped, then the founder''s ad_agency upgrade.';

do $$
declare
  f text;
begin
  foreach f in array array['public.campaign_cap_cents(uuid, text)', 'public.company_campaign_cost_cents(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
