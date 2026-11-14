-- ===== idempotent copy of migrations/20261204001900_ipo_hour.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 1900 · IPO within an hour, more AI investors and faster (ADR-149)
-- =============================================================================
-- The subscription window is now at most 60 minutes (startups.ipo.subscriptionMinutes). AI investors take a bigger
-- part (aiTakeBase 0.6 + aiTakePerQuality 0.4: 60 to 100 % of the offer) and most of it early: their share after a
-- fraction t of the window is 1 - (1 - t)^aiPace (aiPace 3). Once everything is subscribed, close_due_offers lists
-- the company at once (ADR-146). Only share_offer_ai_topup() changes; the values come from game_config.
-- Idempotent: runs unchanged as supabase/updates/20261204001900_ipo_hour.sql.

create or replace function public.share_offer_ai_topup(p_offer_id uuid, p_now timestamptz, p_final boolean)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  o        public.company_share_offers;
  v_ipo    jsonb := coalesce(public.config_jsonb('startups', '{ipo}'), '{}'::jsonb);
  v_q      double precision;
  v_target bigint;
  v_frac   numeric;
  v_due    bigint;
  v_add    bigint;
  v_pay    bigint;
  v_founder uuid;
begin
  select * into o from public.company_share_offers where id = p_offer_id and status = 'open' for update;
  if o.id is null then
    return 0;
  end if;
  select coalesce(pc.quality, 0), pc.founder_id into v_q, v_founder from public.player_companies pc where pc.company_id = o.company_id;
  v_target := floor(o.shares_offered_e6
                    * least(1, greatest(0, public.cfg_num(v_ipo, '{aiTakeBase}', 0.2)
                                           + public.cfg_num(v_ipo, '{aiTakePerQuality}', 0.5) * coalesce(v_q, 0))))::bigint;
  v_frac := case when p_final or o.ends_at <= o.created_at then 1
                 else least(1, greatest(0, extract(epoch from (coalesce(p_now, now()) - o.created_at))
                                           / extract(epoch from (o.ends_at - o.created_at)))) end;
  -- ADR-149: most AI investors come in early: 1 - (1 - t)^aiPace
  v_frac := 1 - power(1 - v_frac, greatest(1, public.cfg_num(v_ipo, '{aiPace}', 1)));
  v_due := least(floor(v_target * v_frac)::bigint, o.shares_offered_e6 - o.shares_subscribed_e6);
  v_add := v_due - o.shares_ai_e6;
  if v_add <= 0 then
    return 0;
  end if;
  -- telescoping: the payments add up to floor(all AI shares x price) exactly
  v_pay := floor((o.shares_ai_e6 + v_add)::numeric * o.price_cents / 1000000)::bigint
         - floor(o.shares_ai_e6::numeric * o.price_cents / 1000000)::bigint;
  if v_pay > 0 then
    perform public.ledger_transfer(public.ledger_system_account('market'), public.company_cash_account(o.company_id), v_pay,
                                   'transfer', 'Zeichnung durch Investoren', 'share_offer', o.id,
                                   'offer-ai:' || o.id::text || ':' || (o.shares_ai_e6 + v_add)::text, v_founder);
  end if;
  update public.company_share_offers set shares_ai_e6 = shares_ai_e6 + v_add where id = o.id;
  return v_add;
end;
$$;
