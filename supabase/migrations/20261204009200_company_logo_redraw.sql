-- =============================================================================
-- NEXA · 9200 · Company logo: redraw for a price (ADR-200)
-- =============================================================================
-- * redraw_company_logo(request, company, pixels): the founder replaces the logo of the own active company. Same checks
--   as at founding (logo_valid, logo_has_forbidden_symbol). Costs startups.logoRedrawCents from the company cash
--   (ledger company cash -> treasury, sum 0); open bills come first. At most once per startups.logoRedrawCooldownHours.
--   Posts the feed item "logo_redrawn" (with the new logo). Reports of the old logo stop counting (logo_version + 1).
-- * get_logo_redraw(company): price, last redraw and the next possible time, for the founder's button.
-- Idempotent: runs unchanged as supabase/updates/.
-- =============================================================================

alter table public.player_companies add column if not exists logo_redrawn_at timestamptz;

create or replace function public.redraw_company_logo(p_request_id uuid, p_company_id uuid, p_pixels jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player   uuid;
  v_replay   jsonb;
  pc         public.player_companies;
  v_su       jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_cost     bigint;
  v_cooldown double precision;
  v_free     bigint;
  v_now      timestamptz := public.game_now();
  v_name     text;
begin
  v_player := public.require_player();
  if p_request_id is null or p_company_id is null or not public.logo_valid(p_pixels) then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'redraw_company_logo');
  if v_replay is not null then
    return v_replay;
  end if;
  select * into pc from public.player_companies where company_id = p_company_id and status = 'active' for update;
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  if pc.founder_id is distinct from v_player then
    perform public.api_error('forbidden');
  end if;
  if public.logo_has_forbidden_symbol(p_pixels -> 'grid') then
    perform public.api_error('logo_forbidden');
  end if;
  v_cooldown := coalesce((v_su ->> 'logoRedrawCooldownHours')::double precision, 24);
  if pc.logo_redrawn_at is not null and pc.logo_redrawn_at + make_interval(secs => v_cooldown * 3600) > v_now then
    perform public.api_error('locked');
  end if;
  v_cost := coalesce((v_su ->> 'logoRedrawCents')::bigint, 5000000);
  select a.balance_cents - pc.unpaid_cents into v_free
    from public.ledger_accounts a where a.owner_company_id = pc.company_id and a.kind = 'company_cash' for update;
  if coalesce(v_free, 0) < v_cost then
    perform public.api_error('insufficient_funds');
  end if;
  if v_cost > 0 then
    perform public.ledger_transfer(public.company_cash_account(pc.company_id), public.ledger_system_account('treasury'),
                                   v_cost, 'company_costs', 'Neues Logo', 'company', pc.company_id,
                                   'logo_redraw:' || pc.company_id::text || ':' || p_request_id::text, v_player);
  end if;
  update public.player_companies
     set logo = jsonb_build_object('palette', p_pixels -> 'palette', 'grid', p_pixels -> 'grid'),
         logo_version = logo_version + 1, logo_hidden = false, logo_redrawn_at = v_now
   where company_id = pc.company_id;
  select c.name into v_name from public.companies c where c.id = pc.company_id;
  perform public.feed_post(v_player, 'logo_redrawn',
                           jsonb_build_object('company', v_name, 'company_id', pc.company_id,
                             'logo', jsonb_build_object('palette', p_pixels -> 'palette', 'grid', p_pixels -> 'grid')),
                           'logo_redraw:' || p_request_id::text);
  return public.request_complete(v_player, p_request_id,
           jsonb_build_object('company', public.company_state(pc.company_id), 'cost_cents', v_cost));
end;
$$;
comment on function public.redraw_company_logo(uuid, uuid, jsonb) is
  'RPC: the founder redraws the company logo for startups.logoRedrawCents from the company cash (ADR-200); idempotent. '
  'Errors forbidden, company_not_found, logo_forbidden, locked (cooldown), insufficient_funds.';

revoke all on function public.redraw_company_logo(uuid, uuid, jsonb) from public, anon;
grant execute on function public.redraw_company_logo(uuid, uuid, jsonb) to authenticated;

-- Feed label of the new kind: feed_item_label is extended in place by several migrations (NFTs, accessories, ...),
-- so the new line goes in front of its fallback instead of a copy of an older definition.
do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$    else 'Beitrag im Feed'$t$;
  v_new text := $t$    when 'logo_redrawn' then coalesce(p_payload ->> 'company', 'Firma') || ' hat ein neues Logo'
    else 'Beitrag im Feed'$t$;
begin
  if position('logo_redrawn' in v_def) = 0 and position(v_old in v_def) > 0 then
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

create or replace function public.get_logo_redraw(p_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player   uuid;
  pc         public.player_companies;
  v_su       jsonb := coalesce(public.config_jsonb('startups'), '{}'::jsonb);
  v_cooldown double precision;
  v_next     timestamptz;
begin
  v_player := public.require_player();
  select * into pc from public.player_companies where company_id = p_company_id and status = 'active';
  if pc.company_id is null then
    perform public.api_error('company_not_found');
  end if;
  if pc.founder_id is distinct from v_player then
    perform public.api_error('forbidden');
  end if;
  v_cooldown := coalesce((v_su ->> 'logoRedrawCooldownHours')::double precision, 24);
  if pc.logo_redrawn_at is not null then
    v_next := pc.logo_redrawn_at + make_interval(secs => v_cooldown * 3600);
  end if;
  return jsonb_build_object(
    'cost_cents', coalesce((v_su ->> 'logoRedrawCents')::bigint, 5000000),
    'cooldown_hours', v_cooldown,
    'redrawn_at', pc.logo_redrawn_at,
    'available_at', case when v_next > public.game_now() then v_next end);
end;
$$;
comment on function public.get_logo_redraw(uuid) is
  'RPC: price and cooldown of redrawing the own company logo (ADR-200). Errors forbidden, company_not_found.';

revoke all on function public.get_logo_redraw(uuid) from public, anon;
grant execute on function public.get_logo_redraw(uuid) to authenticated;
