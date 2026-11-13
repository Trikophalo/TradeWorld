-- ===== idempotent copy of migrations/20261202000300_friend_code.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0300 · Friend code: bring friends, they get a bonus once (ADR-111)
-- =============================================================================
-- Every player has a code to hand out: "NEXA-" plus the permanent player tag (ADR-085), e.g. NEXA-K7Q2. A friend
-- enters it in the profile under "Freundescode" and gets social.friendCode.bonusCents (5.000 NX) once, paid by the
-- treasury (closed money system, ADR-041). Every account can redeem exactly one code, never its own.
--
-- RPCs (authenticated):
--   get_friend_code() -> FRIEND_CODE
--   redeem_friend_code(p_request_id uuid, p_code text) -> FRIEND_CODE plus {"paid_cents", "cash_after_cents"}
--   FRIEND_CODE = {"code", "bonus_cents", "redeemed", "redeemed_from": {"nickname","tag"}|null, "redeemed_at"|null,
--                  "invited"}
-- New error keys: friend_code_unknown NX104, friend_code_self NX105, friend_code_used NX106.
-- New notification type: friend_code_redeemed (social), to the owner of the code.
-- Idempotent: runs unchanged as supabase/updates/20261202000300_friend_code.sql.

alter table public.profiles add column if not exists friend_code_from uuid references public.profiles (id) on delete set null;
alter table public.profiles add column if not exists friend_code_at timestamptz;
create index if not exists profiles_friend_code_from_idx on public.profiles (friend_code_from) where friend_code_from is not null;
comment on column public.profiles.friend_code_from is 'Whose friend code this player redeemed (ADR-111); once, never reset.';

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('friend_code_redeemed', 'social', 'Freundescode eingelöst', 'Jemand hat deinen Freundescode eingelöst.',
        'notif_friend', true, false, false, 276)
on conflict (key) do nothing;

-- Error keys (as in M5a plus the friend code)
create or replace function public.api_error(p_key text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  v_code := case p_key
    when 'insufficient_funds'          then 'NX001'
    when 'rate_limited'                then 'NX004'
    when 'forbidden'                   then 'NX006'
    when 'invalid_quantity'            then 'NX007'
    when 'invalid_price'               then 'NX007'
    when 'invalid_argument'            then 'NX007'
    when 'invalid_interval'            then 'NX007'
    when 'not_authenticated'           then 'NX010'
    when 'unknown_security'            then 'NX011'
    when 'not_tradable'                then 'NX012'
    when 'insufficient_position'       then 'NX013'
    when 'order_not_found'             then 'NX014'
    when 'order_not_open'              then 'NX015'
    when 'market_paused'               then 'NX016'
    when 'nothing_to_claim'            then 'NX017'
    when 'locked'                      then 'NX018'
    when 'name_too_short'              then 'NX019'
    when 'name_too_long'               then 'NX019'
    when 'name_invalid_chars'          then 'NX019'
    when 'name_profanity'              then 'NX019'
    when 'name_reserved'               then 'NX019'
    when 'name_taken'                  then 'NX019'
    when 'name_change_too_soon'        then 'NX020'
    when 'order_too_small'             then 'NX021'
    when 'market_illiquid'             then 'NX022'
    when 'mission_not_found'           then 'NX023'
    when 'mission_not_completed'       then 'NX024'
    when 'mission_already_claimed'     then 'NX025'
    when 'avatar_unknown'              then 'NX026'
    when 'avatar_locked'               then 'NX027'
    when 'daily_reward_claimed'        then 'NX028'
    when 'skill_unknown'               then 'NX029'
    when 'skill_learned'               then 'NX030'
    when 'skill_locked'                then 'NX031'
    when 'skill_points_insufficient'   then 'NX032'
    when 'job_not_found'               then 'NX033'
    when 'job_level_too_low'           then 'NX034'
    when 'job_skills_missing'          then 'NX035'
    when 'application_limit'           then 'NX036'
    when 'application_exists'          then 'NX037'
    when 'application_not_found'       then 'NX038'
    when 'application_not_offered'     then 'NX039'
    when 'offer_expired'               then 'NX040'
    when 'job_active_exists'           then 'NX041'
    when 'no_active_job'               then 'NX042'
    when 'raise_too_soon'              then 'NX043'
    when 'raise_too_high'              then 'NX044'
    when 'player_not_found'            then 'NX045'
    when 'employer_only'               then 'NX046'
    when 'company_exists'              then 'NX047'
    when 'company_not_found'           then 'NX048'
    when 'company_level_too_low'       then 'NX049'
    when 'owns_company'                then 'NX050'
    when 'employee_limit'              then 'NX051'
    when 'company_upgrade_unavailable' then 'NX052'
    when 'founding_locked'             then 'NX053'
    when 'not_in_company'              then 'NX054'
    when 'work_task_not_found'         then 'NX055'
    when 'work_task_expired'           then 'NX056'
    when 'work_task_done'              then 'NX057'
    when 'offer_closed'                then 'NX058'
    when 'offer_sold_out'              then 'NX059'
    when 'already_listed'              then 'NX060'
    when 'confirm_mismatch'            then 'NX061'
    when 'skill_already_covered'       then 'NX062'
    when 'training_locked'             then 'NX063'
    when 'logo_locked'                 then 'NX064'
    when 'logo_forbidden'              then 'NX065'
    when 'artworks_locked'             then 'NX066'
    when 'artwork_not_found'           then 'NX067'
    when 'auction_not_found'           then 'NX068'
    when 'auction_ended'               then 'NX069'
    when 'bid_too_low'                 then 'NX070'
    when 'own_artwork'                 then 'NX071'
    when 'already_on_auction'          then 'NX072'
    when 'auction_has_bids'            then 'NX073'
    when 'property_locked'             then 'NX074'
    when 'no_home'                     then 'NX075'
    when 'invalid_tier'                then 'NX076'
    when 'item_not_found'              then 'NX077'
    when 'layout_invalid'              then 'NX078'
    when 'floor_not_owned'             then 'NX079'
    when 'garage_full'                 then 'NX080'
    when 'event_closed'                then 'NX081'
    when 'event_needs_staff'           then 'NX082'
    when 'upgrade_maxed'               then 'NX083'
    when 'promotion_not_ready'         then 'NX084'
    when 'promotion_too_soon'          then 'NX085'
    when 'promotion_pending'           then 'NX086'
    when 'campaign_running'            then 'NX087'
    when 'deal_not_found'              then 'NX088'
    when 'deal_closed'                 then 'NX089'
    when 'deal_terms'                  then 'NX090'
    when 'deal_limit'                  then 'NX091'
    when 'deal_self'                   then 'NX092'
    when 'stake_share_full'            then 'NX093'
    when 'deal_needs_company'          then 'NX094'
    when 'deal_too_big'                then 'NX095'
    when 'coin_not_found'              then 'NX096'
    when 'coin_exists'                 then 'NX097'
    when 'ticker_taken'                then 'NX098'
    when 'coin_not_tradable'           then 'NX099'
    when 'coin_action_running'         then 'NX100'
    when 'coin_tech_too_low'           then 'NX101'
    when 'slippage_exceeded'           then 'NX102'
    when 'coin_not_launched'           then 'NX103'
    when 'friend_code_unknown'         then 'NX104'
    when 'friend_code_self'            then 'NX105'
    when 'friend_code_used'            then 'NX106'
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;

-- FRIEND_CODE of a player.
create or replace function public.friend_code_state(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code',          'NEXA-' || p.tag,
    'bonus_cents',   greatest(0, public.config_bigint('social', '{friendCode,bonusCents}', 500000)),
    'redeemed',      p.friend_code_at is not null,
    'redeemed_from', (select jsonb_build_object('nickname', i.nickname, 'tag', i.tag)
                        from public.profiles i where i.id = p.friend_code_from),
    'redeemed_at',   p.friend_code_at,
    'invited',       (select count(*) from public.profiles x where x.friend_code_from = p.id))
    from public.profiles p where p.id = p_player;
$$;

create or replace function public.get_friend_code()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  v_player := public.require_player();
  return public.friend_code_state(v_player);
end;
$$;
comment on function public.get_friend_code() is 'RPC: the own friend code, whether one was redeemed, how many friends came (ADR-111).';

create or replace function public.redeem_friend_code(p_request_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_replay  jsonb;
  v_tag     text;
  v_owner   public.profiles;
  v_me      public.profiles;
  v_bonus   bigint;
  v_paid    bigint;
  v_cash    bigint;
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'redeem_friend_code');
  if v_replay is not null then
    return v_replay;
  end if;
  -- "NEXA-K7Q2", "nexa k7q2", "#K7Q2" and "K7Q2" all mean the same code
  v_tag := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
  if length(v_tag) = 8 and left(v_tag, 4) = 'NEXA' then
    v_tag := right(v_tag, 4);
  end if;
  if v_tag !~ '^[A-HJ-NP-Z2-9]{4}$' then
    perform public.api_error('friend_code_unknown');
  end if;
  perform public.lock_player_accounts(v_player);
  select * into v_me from public.profiles where id = v_player for update;
  if v_me.friend_code_at is not null then
    perform public.api_error('friend_code_used');
  end if;
  select * into v_owner from public.profiles p where p.tag = v_tag and not p.is_deactivated;
  if v_owner.id is null then
    perform public.api_error('friend_code_unknown');
  end if;
  if v_owner.id = v_player then
    perform public.api_error('friend_code_self');
  end if;

  v_bonus := greatest(0, public.config_bigint('social', '{friendCode,bonusCents}', 500000));
  update public.profiles set friend_code_from = v_owner.id, friend_code_at = now() where id = v_player;
  v_paid := public.state_pay_partial(v_player, v_bonus, 'mission_reward', 'Freundescode von ' || v_owner.nickname,
                                     'friend_code:' || v_player::text);
  perform public.loan_withhold(v_player, v_paid, 'friend_code:' || v_player::text);
  perform public.social_notify(v_owner.id, 'friend_code_redeemed', 'Freundescode eingelöst',
    v_me.nickname || ' ist mit deinem Code dabei.',
    jsonb_build_object('nickname', v_me.nickname, 'tag', v_me.tag), '/friends', 'friend_code:' || v_player::text);

  select a.balance_cents into v_cash from public.ledger_accounts a
   where a.owner_player_id = v_player and a.kind = 'player_cash';
  return public.request_complete(v_player, p_request_id,
    public.friend_code_state(v_player) || jsonb_build_object('paid_cents', v_paid, 'cash_after_cents', v_cash));
end;
$$;
comment on function public.redeem_friend_code(uuid, text) is 'RPC: redeem a friend''s code once for the bonus (ADR-111).';

do $$
declare
  f text;
begin
  foreach f in array array['public.friend_code_state(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.get_friend_code()', 'public.redeem_friend_code(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;
