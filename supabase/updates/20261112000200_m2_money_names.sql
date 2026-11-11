-- ===== idempotent copy of migrations/20261112000200_m2_money_names.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M2a · 0200 · Closed money system, name filter, sign-up, levels
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------
create or replace function public.money_genesis_done()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.ledger_transactions t where t.idempotency_key = 'money:genesis');
$$;

create or replace function public.treasury_balance_cents()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.balance_cents from public.ledger_accounts a where a.system_key = 'treasury'), 0);
$$;

-- Basic income factor in bps: clamp(treasury / target, minFactor, 1); 10000 before the genesis.
create or replace function public.basic_income_factor_bps()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_money  jsonb := coalesce(public.config_jsonb('money'), '{}'::jsonb);
  v_target double precision := public.cfg_num(v_money, '{basicIncome,treasuryTargetCents}', 25000000000);
  v_min    double precision := public.cfg_num(v_money, '{basicIncome,minFactor}', 0.25);
begin
  if not public.money_genesis_done() or v_target <= 0 then
    return 10000;
  end if;
  return round(greatest(v_min, least(1, public.treasury_balance_cents()::double precision / v_target)) * 10000)::integer;
end;
$$;

-- Pays money from the state to a player: treasury, else households (logged);
-- before the genesis the (still open) mint. p_tax is withheld and stays with
-- the state, the player receives p_gross - p_tax. Returns the transaction id.
create or replace function public.state_payout(
  p_player   uuid,
  p_gross    bigint,
  p_tax      bigint,
  p_kind     public.ledger_tx_kind,
  p_desc     text,
  p_ref_type text,
  p_ref_id   uuid,
  p_key      text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_net    bigint := p_gross - coalesce(p_tax, 0);
  v_source uuid;
  v_bal    bigint;
begin
  if v_net <= 0 then
    return null;
  end if;
  if not public.money_genesis_done() then
    v_source := public.ledger_system_account('mint');
  else
    select a.id, a.balance_cents into v_source, v_bal from public.ledger_accounts a where a.system_key = 'treasury';
    if v_bal < v_net then
      select a.id, a.balance_cents into v_source, v_bal from public.ledger_accounts a where a.system_key = 'households';
      if v_bal < v_net then
        perform public.api_error('market_illiquid');
      end if;
      insert into public.admin_actions (action, target_type, target_id, payload)
      values ('state_payout_from_households', 'player', p_player::text,
              jsonb_build_object('kind', p_kind, 'amount_cents', v_net, 'key', p_key));
    end if;
  end if;
  return public.ledger_transfer(v_source, public.ledger_player_account(p_player, 'player_cash'), v_net, p_kind,
                                p_desc, p_ref_type, p_ref_id, p_key, p_player,
                                jsonb_build_object('gross_cents', p_gross, 'tax_cents', coalesce(p_tax, 0)));
end;
$$;

-- One-time world genesis (idempotent). Creates money.totalSupplyCents in
-- world_genesis and distributes it to treasury, financial market (system
-- account "market"), tycoons and households. Money that existed before (an
-- existing database, or the seed) is re-sourced in the same step so that the
-- mint and every other system account end non-negative and closed:
--   * mint outflows to AI companies (opening_balance) <- financial market
--     (paid-in capital from investors), fallback households
--   * all other mint outflows (starting capital, basic income) <- treasury,
--     fallback households, then financial market
--   * other negative system accounts (interest: coupons, ...) <- treasury
--   * positive sink accounts (fees, taxes, ...) -> treasury
-- Afterwards only world_genesis may be negative.
create or replace function public.money_genesis()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_money     jsonb := coalesce(public.config_jsonb('money'), '{}'::jsonb);
  v_total     bigint := public.cfg_num(v_money, '{totalSupplyCents}', 1000000000000)::bigint;
  v_treasury  bigint;
  v_market    bigint;
  v_tycoons   bigint;
  v_house     bigint;
  v_companies bigint;
  v_mint      bigint;
  v_details   jsonb := '{}'::jsonb;
  r           record;
begin
  if public.money_genesis_done() then
    return jsonb_build_object('skipped', 'genesis_done');
  end if;
  v_treasury := round(v_total * public.cfg_num(v_money, '{allocation,treasury}', 0.05))::bigint;
  v_market   := round(v_total * public.cfg_num(v_money, '{allocation,financialMarket}', 0.6))::bigint;
  v_tycoons  := round(v_total * public.cfg_num(v_money, '{allocation,tycoons}', 0.05))::bigint;
  v_house    := v_total - v_treasury - v_market - v_tycoons;

  perform public.ledger_post('opening_balance', jsonb_build_array(
      jsonb_build_object('account_id', public.ledger_system_account('world_genesis'), 'amount_cents', -v_total),
      jsonb_build_object('account_id', public.ledger_system_account('treasury'),      'amount_cents', v_treasury),
      jsonb_build_object('account_id', public.ledger_system_account('market'),        'amount_cents', v_market),
      jsonb_build_object('account_id', public.ledger_system_account('tycoons'),       'amount_cents', v_tycoons),
      jsonb_build_object('account_id', public.ledger_system_account('households'),    'amount_cents', v_house)),
    'World genesis: the entire money supply', 'money', null, 'money:genesis');

  -- mint: split the money it created into company capital and the rest
  select coalesce(-sum(e.amount_cents), 0)::bigint into v_companies
    from public.ledger_entries e join public.ledger_transactions t on t.id = e.transaction_id
   where e.account_id = public.ledger_system_account('mint') and t.kind = 'opening_balance';
  v_mint := -(select a.balance_cents from public.ledger_accounts a where a.system_key = 'mint');
  v_companies := least(greatest(v_companies, 0), greatest(v_mint, 0));
  perform public.money_resource('mint', v_companies, array['market', 'households', 'treasury'], 'money:resource:mint:companies');
  perform public.money_resource('mint', greatest(v_mint - v_companies, 0), array['treasury', 'households', 'market'], 'money:resource:mint:players');
  v_details := v_details || jsonb_build_object('mint_companies_cents', v_companies, 'mint_players_cents', greatest(v_mint - v_companies, 0));

  for r in
    select a.system_key, a.balance_cents from public.ledger_accounts a
     where a.kind = 'system' and a.balance_cents <> 0
       and a.system_key not in ('world_genesis', 'treasury', 'market', 'tycoons', 'households', 'mint')
     order by a.system_key
  loop
    if r.balance_cents < 0 then
      perform public.money_resource(r.system_key, -r.balance_cents, array['treasury', 'households', 'market'],
                                    'money:resource:' || r.system_key);
    else
      perform public.ledger_transfer(public.ledger_system_account(r.system_key), public.ledger_system_account('treasury'),
                                     r.balance_cents, 'transfer', 'Closed money system: ' || r.system_key || ' to the treasury',
                                     'money', null, 'money:resource:' || r.system_key);
    end if;
    v_details := v_details || jsonb_build_object(r.system_key || '_cents', r.balance_cents);
  end loop;

  update public.ledger_accounts set allow_negative = false
   where kind = 'system' and system_key <> 'world_genesis' and allow_negative;

  return jsonb_build_object('total_supply_cents', v_total, 'treasury_cents', v_treasury, 'financial_market_cents', v_market,
                            'tycoons_cents', v_tycoons, 'households_cents', v_house) || v_details;
end;
$$;

-- Moves p_amount into the system account p_target from the first source that can pay it (split if needed).
create or replace function public.money_resource(p_target text, p_amount bigint, p_sources text[], p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left bigint := p_amount;
  v_src  text;
  v_bal  bigint;
  v_take bigint;
  v_n    integer := 0;
begin
  foreach v_src in array p_sources loop
    exit when v_left <= 0;
    select a.balance_cents into v_bal from public.ledger_accounts a where a.system_key = v_src;
    v_take := least(v_left, greatest(coalesce(v_bal, 0), 0));
    if v_take > 0 then
      v_n := v_n + 1;
      perform public.ledger_transfer(public.ledger_system_account(v_src), public.ledger_system_account(p_target), v_take,
                                     'transfer', 'Closed money system: re-source ' || p_target || ' from ' || v_src,
                                     'money', null, p_key || ':' || v_n);
      v_left := v_left - v_take;
    end if;
  end loop;
  if v_left > 0 then
    raise exception 'money genesis: cannot re-source % cents for %', v_left, p_target using errcode = 'NX001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Names
-- ---------------------------------------------------------------------------
-- lower case, umlauts/accents to ASCII, optionally leetspeak to letters
create or replace function public.name_normalize(p_text text, p_leet boolean default true)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_leet then translate(x, '013457@$!8|', 'oieastasibi') else x end
    from (select translate(
                   replace(replace(replace(replace(lower(coalesce(p_text, '')), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
                   'áàâãåéèêëíìîïóòôõúùûçñ', 'aaaaaeeeeiiiiooooouuucn') as x) y;
$$;

-- normalised letters only, repeated letters collapsed ("H1tl3r" -> "hitler", "Matthias" -> "mathias")
create or replace function public.name_letters(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(regexp_replace(public.name_normalize(p_text, true), '[^a-z]', '', 'g'), '(.)\1+', '\1', 'g');
$$;

-- Returns NULL or the reason key why a name is not allowed.
--   kind 'player': names.minLength..maxLength, [A-Za-z0-9_]
--   kind 'company': 3..30, letters incl. umlauts, digits, space, - & . '
-- Matching (docs/DATA_MODEL.md, Nachtrag M2): terms >= 5 letters match as
-- substrings of the normalised name, shorter terms only as a whole token or
-- the whole name; codes (88, 1488, hh ...) only as whole raw tokens.
create or replace function public.name_violation(p_name text, p_kind text default 'player', p_exclude uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_names  jsonb := coalesce(public.config_jsonb('names'), '{}'::jsonb);
  v_min    integer;
  v_max    integer;
  v_full   text;
  v_tokens text[];
  v_raw    text[];
  v_cat    text;
begin
  if p_kind = 'company' then
    v_min := 3; v_max := 30;
  else
    v_min := public.cfg_num(v_names, '{minLength}', 3)::integer;
    v_max := public.cfg_num(v_names, '{maxLength}', 20)::integer;
  end if;
  if p_name is null or char_length(p_name) < v_min then
    return 'name_too_short';
  end if;
  if char_length(p_name) > v_max then
    return 'name_too_long';
  end if;
  if p_kind = 'company' then
    if p_name !~ '^[A-Za-zÄÖÜäöüßÀ-ÿ0-9 &.''-]+$' or p_name <> btrim(p_name) or p_name ~ '  ' then
      return 'name_invalid_chars';
    end if;
  elsif p_name !~ '^[A-Za-z0-9_]+$' then
    return 'name_invalid_chars';
  end if;

  v_full := public.name_letters(p_name);
  select coalesce(array_agg(regexp_replace(t, '(.)\1+', '\1', 'g')), '{}') into v_tokens
    from regexp_split_to_table(public.name_normalize(p_name, true), '[^a-z]+') t where t <> '';
  select coalesce(array_agg(m[1]), '{}') into v_raw
    from regexp_matches(public.name_normalize(p_name, false), '([a-z]+|[0-9]+)', 'g') m;
  if v_full = '' then
    return 'name_invalid_chars';
  end if;

  select t.category into v_cat
    from public.blocked_name_terms t
   where (t.match_mode = 'substring' and strpos(v_full, t.term) > 0)
      or (t.match_mode = 'token' and (t.term = v_full or t.term = any (v_tokens) or t.term = any (v_raw)))
      or (t.match_mode = 'code' and t.term = any (v_raw))
   order by (t.category = 'reserved'), t.term
   limit 1;
  if v_cat is not null then
    return case when v_cat = 'reserved' then 'name_reserved' else 'name_profanity' end;
  end if;

  -- dynamic reserved names: AI tycoons, AI companies (with and without legal form), tickers, index keys
  if exists (select 1 from public.rich_tycoons ty where public.name_letters(ty.name) = v_full
                or (char_length(public.name_letters(ty.name)) >= 5 and strpos(v_full, public.name_letters(ty.name)) > 0))
     or exists (select 1 from public.companies c
                 where c.is_ai and c.id is distinct from p_exclude
                   and (public.name_letters(c.name) = v_full
                        or (char_length(public.name_letters(regexp_replace(c.name, '\s+(AG|SE|GmbH|KG)$', '', 'i'))) >= 5
                            and strpos(v_full, public.name_letters(regexp_replace(c.name, '\s+(AG|SE|GmbH|KG)$', '', 'i'))) > 0)))
     or exists (select 1 from public.securities s
                 where lower(s.ticker) = any (v_raw) or lower(s.ticker) = lower(p_name)
                    or public.name_letters(s.ticker) = v_full)
     or exists (select 1 from public.indices i where lower(i.key) = any (v_raw) or public.name_letters(i.key) = v_full) then
    return 'name_reserved';
  end if;

  if p_kind = 'company' then
    if exists (select 1 from public.companies c where lower(c.name) = lower(p_name) and c.id is distinct from p_exclude) then
      return 'name_taken';
    end if;
  elsif exists (select 1 from public.profiles p where lower(p.nickname) = lower(p_name) and p.id is distinct from p_exclude) then
    return 'name_taken';
  end if;
  return null;
end;
$$;
comment on function public.name_violation(text, text, uuid) is 'Internal: NULL or name_too_short / name_too_long / name_invalid_chars / name_profanity / name_reserved / name_taken.';

-- Registration form pre-check (anon and authenticated). Cheap: one indexed
-- lookup plus a scan of ~300 terms; no writes, so it cannot be abused to
-- change state (it only reveals whether a nickname is taken).
create or replace function public.check_nickname(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reason text := public.name_violation(left(p_nickname, 64), 'player', (select auth.uid()));
begin
  return jsonb_build_object('allowed', v_reason is null, 'reason', v_reason);
end;
$$;

create or replace function public.change_nickname(p_request_id uuid, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_replay jsonb;
  v_days   double precision := public.config_double('names', '{nicknameChangeDays}', 60);
  v_last   timestamptz;
  v_reason text;
  v_now    timestamptz := now();
begin
  v_player := public.require_player();
  if p_request_id is null then
    perform public.api_error('invalid_argument');
  end if;
  v_replay := public.request_begin(v_player, p_request_id, 'change_nickname');
  if v_replay is not null then
    return v_replay;
  end if;
  select p.nickname_changed_at into v_last from public.profiles p where p.id = v_player for update;
  if v_last is not null and v_last + make_interval(secs => v_days * 86400) > v_now then
    perform public.api_error('name_change_too_soon');
  end if;
  v_reason := public.name_violation(p_nickname, 'player', v_player);
  if v_reason is not null then
    perform public.api_error(v_reason);
  end if;
  update public.profiles set nickname = p_nickname, nickname_changed_at = v_now where id = v_player;
  return public.request_complete(v_player, p_request_id, jsonb_build_object(
    'nickname', p_nickname, 'changed_at', v_now, 'next_change_at', v_now + make_interval(secs => v_days * 86400)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Levels: no upper bound except the technical progression.maxLevel
-- ---------------------------------------------------------------------------
create or replace function public.level_progress(p_xp bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prog  jsonb := coalesce(public.config_jsonb('progression'), '{}'::jsonb);
  v_base  double precision := public.cfg_num(v_prog, '{xpBase}', 100);
  v_exp   double precision := public.cfg_num(v_prog, '{xpExponent}', 1.5);
  v_max   integer := public.cfg_num(v_prog, '{maxLevel}', 10000)::integer;
  v_level integer := 1;
  v_rem   bigint := greatest(coalesce(p_xp, 0), 0);
  v_need  bigint;
begin
  -- O(level): level 1000 needs ~1.3e9 XP, far beyond reach; the loop stays cheap
  loop
    if v_level >= v_max then
      return jsonb_build_object('level', v_level, 'xp_into_level', v_rem, 'xp_for_next', 0);
    end if;
    v_need := round(v_base * power(v_level, v_exp))::bigint;
    if v_rem < v_need then
      return jsonb_build_object('level', v_level, 'xp_into_level', v_rem, 'xp_for_next', v_need);
    end if;
    v_rem := v_rem - v_need;
    v_level := v_level + 1;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- API errors (adds the M2 keys)
-- ---------------------------------------------------------------------------
create or replace function public.api_error(p_key text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
begin
  v_code := case p_key
    when 'insufficient_funds'      then 'NX001'
    when 'rate_limited'            then 'NX004'
    when 'forbidden'               then 'NX006'
    when 'invalid_quantity'        then 'NX007'
    when 'invalid_price'           then 'NX007'
    when 'invalid_argument'        then 'NX007'
    when 'invalid_interval'        then 'NX007'
    when 'not_authenticated'       then 'NX010'
    when 'unknown_security'        then 'NX011'
    when 'not_tradable'            then 'NX012'
    when 'insufficient_position'   then 'NX013'
    when 'order_not_found'         then 'NX014'
    when 'order_not_open'          then 'NX015'
    when 'market_paused'           then 'NX016'
    when 'nothing_to_claim'        then 'NX017'
    when 'locked'                  then 'NX018'
    when 'name_too_short'          then 'NX019'
    when 'name_too_long'           then 'NX019'
    when 'name_invalid_chars'      then 'NX019'
    when 'name_profanity'          then 'NX019'
    when 'name_reserved'           then 'NX019'
    when 'name_taken'              then 'NX019'
    when 'name_change_too_soon'    then 'NX020'
    when 'order_too_small'         then 'NX021'
    when 'market_illiquid'         then 'NX022'
    when 'mission_not_found'       then 'NX023'
    when 'mission_not_completed'   then 'NX024'
    when 'mission_already_claimed' then 'NX025'
    else 'NX007'
  end;
  raise exception using errcode = v_code, message = p_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-up: name filter, starting capital from the state (closed money system)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta            jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_code            text  := nullif(upper(btrim(coalesce(v_meta ->> 'invite_code', ''))), '');
  v_invite_required boolean := public.config_boolean('auth', '{inviteRequired}', true);
  v_age_required    boolean := public.config_boolean('auth', '{ageConfirmationRequired}', true);
  v_age_confirmed   boolean := lower(coalesce(v_meta ->> 'age_confirmed', 'false')) in ('true', '1', 'yes');
  v_start_cents     bigint  := greatest(public.config_bigint('economy', '{startingCapitalCents}', 1000000), 0);
  v_vault_hours     double precision := greatest(0, least(
                        public.config_double('economy', '{vaultInitialHours}', 2),
                        public.config_double('economy', '{vaultCapHours}', 8)));
  v_max_len         integer := public.config_double('names', '{maxLength}', 20)::integer;
  v_invite          public.invite_codes;
  v_base            text;
  v_nickname        text;
  v_reason          text;
  v_attempt         integer := 0;
begin
  -- 18+ confirmation ---------------------------------------------------------
  if v_age_required and not v_age_confirmed then
    raise exception 'age confirmation (18+) is required' using errcode = 'NX007';
  end if;

  -- invite code ---------------------------------------------------------------
  if v_code is not null then
    select i.* into v_invite from public.invite_codes i where i.code = v_code for update;
    if not found
       or not v_invite.is_active
       or (v_invite.expires_at is not null and v_invite.expires_at <= now())
       or v_invite.used_count >= v_invite.max_uses then
      if v_invite_required then
        raise exception 'invite code is invalid, expired or used up' using errcode = 'NX005';
      end if;
      v_code := null;
    end if;
  elsif v_invite_required then
    raise exception 'an invite code is required' using errcode = 'NX005';
  end if;

  -- nickname: cleaned as before, forbidden names are rejected (the client
  -- pre-checks with check_nickname), taken names get a numeric suffix
  v_base := left(regexp_replace(coalesce(v_meta ->> 'nickname', ''), '[^A-Za-z0-9_]', '', 'g'), v_max_len);
  if length(v_base) < 3 then
    v_base := 'Trader';
    v_nickname := v_base || (floor(random() * 90000) + 10000)::integer::text;
  else
    v_reason := public.name_violation(v_base, 'player');
    if v_reason in ('name_profanity', 'name_reserved') then
      perform public.api_error(v_reason);
    end if;
    v_nickname := v_base;
  end if;
  while exists (select 1 from public.profiles p where lower(p.nickname) = lower(v_nickname)) loop
    v_attempt := v_attempt + 1;
    if v_attempt > 20 then
      raise exception 'could not generate a unique nickname' using errcode = 'NX007';
    end if;
    v_nickname := left(v_base, 15) || (floor(random() * 90000) + 10000)::integer::text;
  end loop;

  -- player rows ----------------------------------------------------------------
  insert into public.profiles (id, nickname) values (new.id, v_nickname);
  insert into public.player_private (player_id, age_confirmed_at)
  values (new.id, case when v_age_confirmed then now() end);
  insert into public.player_settings (player_id) values (new.id);
  insert into public.vaults (player_id, accrual_started_at)
  values (new.id, public.game_now() - make_interval(secs => v_vault_hours * 3600));
  insert into public.login_streaks (player_id) values (new.id);

  insert into public.player_unlocks (player_id, unlock_key)
  select new.id, u.key from public.unlocks u where u.level <= 1;

  insert into public.notification_preferences (player_id, type_key, in_app_enabled, push_enabled)
  select new.id, t.key, t.default_in_app, t.default_push from public.notification_types t;

  -- ledger: cash + reserve account, starting capital from the state -----------
  insert into public.ledger_accounts (kind, owner_player_id, label) values ('player_cash', new.id, 'Cash');
  insert into public.ledger_accounts (kind, owner_player_id, label)
  values ('player_reserve', new.id, 'Reserved (orders, subscriptions, margin)');

  if v_start_cents > 0 then
    perform public.state_payout(new.id, v_start_cents, 0, 'starting_capital', 'Starting capital',
                                'profile', new.id, 'starting_capital:' || new.id::text);
  end if;

  -- consume the invite ---------------------------------------------------------
  if v_code is not null then
    update public.invite_codes set used_count = used_count + 1 where code = v_code;
    insert into public.invite_code_redemptions (code, player_id) values (v_code, new.id);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Blocked name terms (normalised: lower case ASCII letters, repeated letters
-- collapsed). Default mode by length: >= 5 letters substring, else token.
-- Deliberate exceptions are marked in the note column.
-- ---------------------------------------------------------------------------
insert into public.blocked_name_terms (term, category, match_mode, note)
select case when t.mode = 'code' then lower(t.term) else public.name_letters(t.term) end, t.category,
       coalesce(t.mode, case when char_length(public.name_letters(t.term)) >= 5 then 'substring' else 'token' end),
       t.note
  from (values
    -- profanity, German
    ('scheisse', 'profanity', null, null), ('scheiss', 'profanity', null, null), ('arschloch', 'profanity', null, null),
    ('arsch', 'profanity', 'token', 'token only: Barsch, Marsch'), ('wichser', 'profanity', null, null), ('wichsen', 'profanity', null, null),
    ('wixer', 'profanity', null, null), ('wixxer', 'profanity', null, null), ('hurensohn', 'profanity', null, null),
    ('hure', 'profanity', null, null), ('fotze', 'profanity', null, null), ('schlampe', 'profanity', null, null),
    ('missgeburt', 'profanity', null, null), ('drecksau', 'profanity', null, null), ('drecksack', 'profanity', null, null),
    ('dreckskerl', 'profanity', null, null), ('vollidiot', 'profanity', null, null), ('volltrottel', 'profanity', null, null),
    ('pisser', 'profanity', null, null), ('verpiss', 'profanity', null, null), ('leckmich', 'profanity', null, null),
    ('fickdich', 'profanity', null, null), ('ficker', 'profanity', null, null), ('fick', 'profanity', 'substring', 'substring although short'),
    ('kinderficker', 'profanity', null, null), ('mutterficker', 'profanity', null, null), ('nutte', 'profanity', null, null),
    ('penner', 'profanity', null, null), ('spast', 'profanity', null, null), ('spasti', 'profanity', null, null),
    ('mongo', 'profanity', 'token', 'token only: Mongolei'), ('behindert', 'profanity', null, null), ('opfer', 'profanity', 'token', null),
    ('kackbratze', 'profanity', null, null), ('dummfick', 'profanity', null, null), ('bimbo', 'profanity', 'token', null),
    ('schwachkopf', 'profanity', null, null), ('dreckig', 'profanity', 'token', null), ('kotzbrocken', 'profanity', null, null),
    -- profanity, English
    ('fuck', 'profanity', 'substring', 'substring although short'), ('fuk', 'profanity', 'token', null), ('fck', 'profanity', 'token', null),
    ('shit', 'profanity', 'token', 'token only: Shitake'), ('bullshit', 'profanity', null, null), ('shithead', 'profanity', null, null),
    ('bitch', 'profanity', null, null), ('bastard', 'profanity', null, null), ('asshole', 'profanity', null, null),
    ('arsehole', 'profanity', null, null), ('ass', 'profanity', 'token', 'token only: Bass, Klassenbester'), ('dickhead', 'profanity', null, null),
    ('wanker', 'profanity', null, null), ('twat', 'profanity', 'token', null), ('cunt', 'profanity', 'token', 'token only: Scunthorpe'),
    ('motherfucker', 'profanity', null, null), ('jackass', 'profanity', null, null), ('dumbass', 'profanity', null, null),
    ('retard', 'profanity', null, null), ('moron', 'profanity', 'token', null), ('douche', 'profanity', null, null),
    ('crap', 'profanity', 'token', null), ('piss', 'profanity', 'token', null), ('prick', 'profanity', 'token', null),
    -- sexual
    ('porno', 'sexual', null, null), ('porn', 'sexual', 'token', null), ('sex', 'sexual', 'token', 'token only: Sexy, Essex'),
    ('penis', 'sexual', null, null), ('vagina', 'sexual', null, null), ('dildo', 'sexual', null, null), ('vibrator', 'sexual', null, null),
    ('blowjob', 'sexual', null, null), ('handjob', 'sexual', null, null), ('cumshot', 'sexual', null, null), ('cum', 'sexual', 'token', null),
    ('milf', 'sexual', 'token', null), ('titten', 'sexual', null, null), ('tits', 'sexual', 'token', null), ('boobs', 'sexual', null, null),
    ('muschi', 'sexual', null, null), ('pimmel', 'sexual', null, null), ('schwanz', 'sexual', null, 'Schwanstein stays allowed'),
    ('orgasmus', 'sexual', null, null), ('orgasm', 'sexual', null, null), ('masturb', 'sexual', null, null), ('wichsvorlage', 'sexual', null, null),
    ('vergewaltig', 'sexual', null, null), ('rape', 'sexual', 'token', 'token only: Grapefruit'), ('rapist', 'sexual', null, null),
    ('pedo', 'sexual', 'token', null), ('paedo', 'sexual', null, null), ('pedophil', 'sexual', null, null), ('kinderporno', 'sexual', null, null),
    ('loli', 'sexual', 'token', null), ('hentai', 'sexual', null, null), ('anal', 'sexual', 'token', 'token only: Analyst'),
    ('anus', 'sexual', 'token', 'token only: Janus'), ('cock', 'sexual', 'token', 'token only: Hitchcock, Peacock'),
    ('dick', 'sexual', 'token', 'token only: Dickmann'), ('pussy', 'sexual', 'token', 'token only: Pussycat stays allowed'),
    ('slut', 'sexual', 'token', null), ('whore', 'sexual', null, null), ('horny', 'sexual', null, null), ('nackt', 'sexual', 'token', null),
    ('bukkake', 'sexual', null, null), ('gangbang', 'sexual', null, null), ('deepthroat', 'sexual', null, null), ('fetisch', 'sexual', null, null),
    ('xxx', 'code', 'code', null), ('69', 'code', 'code', null),
    -- slurs
    ('nigger', 'slur', null, null), ('nigga', 'slur', null, null), ('neger', 'slur', null, null), ('negro', 'slur', 'token', null),
    ('kanake', 'slur', null, null), ('kanacke', 'slur', null, null), ('schwuchtel', 'slur', null, null), ('faggot', 'slur', null, null),
    ('fag', 'slur', 'token', null), ('tranny', 'slur', null, null), ('kike', 'slur', 'token', null), ('chink', 'slur', 'token', null),
    ('spic', 'slur', 'token', null), ('zigeuner', 'slur', null, null), ('judensau', 'slur', null, null), ('judenschwein', 'slur', null, null),
    ('kuffnucke', 'slur', null, null), ('polacke', 'slur', null, null), ('kameltreiber', 'slur', null, null), ('schlitzauge', 'slur', null, null),
    ('untermensch', 'slur', null, null), ('affenmensch', 'slur', null, null), ('mohrenkopf', 'slur', null, null),
    -- extremist
    ('hitler', 'extremist', null, null), ('adolfhitler', 'extremist', null, null), ('heilhitler', 'extremist', null, null),
    ('siegheil', 'extremist', null, null), ('nazi', 'extremist', 'substring', 'substring although short; blocks Nazim/Ignazio (accepted)'),
    ('nsdap', 'extremist', null, null), ('fuehrer', 'extremist', 'token', 'token only: Lokfuehrer'), ('reichsfuehrer', 'extremist', null, null),
    ('holocaust', 'extremist', null, null), ('auschwitz', 'extremist', null, null), ('gaskammer', 'extremist', null, null),
    ('zyklonb', 'extremist', null, null), ('endloesung', 'extremist', null, null), ('hakenkreuz', 'extremist', null, null),
    ('swastika', 'extremist', null, null), ('whitepower', 'extremist', null, null), ('whitepride', 'extremist', null, null),
    ('rassenkrieg', 'extremist', null, null), ('volkstod', 'extremist', null, null), ('judenhass', 'extremist', null, null),
    ('kristallnacht', 'extremist', null, null), ('himmler', 'extremist', null, null), ('goebbels', 'extremist', null, null),
    ('mengele', 'extremist', null, null), ('eichmann', 'extremist', null, null), ('waffenss', 'extremist', null, null),
    ('isis', 'extremist', 'token', null), ('jihad', 'extremist', null, null), ('dschihad', 'extremist', null, null),
    ('alqaida', 'extremist', null, null), ('taliban', 'extremist', null, null), ('terrorist', 'extremist', null, null),
    ('kukluxklan', 'extremist', null, null), ('blutundehre', 'extremist', null, null), ('combat18', 'extremist', 'substring', null),
    ('88', 'code', 'code', 'Heil Hitler; whole raw token only (Lisa88 is blocked, Max1988 is allowed)'),
    ('1488', 'code', 'code', null), ('14', 'code', 'code', 'fourteen words, only as the token 14'), ('hh', 'code', 'code', null),
    ('ss', 'code', 'code', null), ('kkk', 'code', 'code', null), ('acab', 'code', 'code', null),
    -- reserved
    ('admin', 'reserved', 'token', null), ('administrator', 'reserved', null, null), ('moderator', 'reserved', null, null),
    ('mod', 'reserved', 'token', null), ('support', 'reserved', 'token', null), ('system', 'reserved', 'token', null),
    ('sysadmin', 'reserved', null, null), ('staff', 'reserved', 'token', null), ('nexa', 'reserved', 'token', null),
    ('nexateam', 'reserved', null, null), ('finn', 'reserved', 'token', null), ('staat', 'reserved', 'token', null),
    ('staatskasse', 'reserved', null, null), ('zentralbank', 'reserved', null, null), ('bank', 'reserved', 'token', null),
    ('official', 'reserved', 'token', null), ('offiziell', 'reserved', 'token', null), ('root', 'reserved', 'token', null),
    ('null', 'reserved', 'token', null), ('undefined', 'reserved', 'token', null), ('anonymous', 'reserved', 'token', null),
    ('anonym', 'reserved', 'token', null), ('deleted', 'reserved', 'token', null), ('geloescht', 'reserved', 'token', null),
    ('gamemaster', 'reserved', null, null), ('owner', 'reserved', 'token', null), ('service', 'reserved', 'token', null)
  ) as t(term, category, mode, note)
on conflict (term) do nothing;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.money_genesis_done()', 'public.treasury_balance_cents()', 'public.basic_income_factor_bps()',
    'public.state_payout(uuid, bigint, bigint, public.ledger_tx_kind, text, text, uuid, text)',
    'public.money_genesis()', 'public.money_resource(text, bigint, text[], text)',
    'public.name_normalize(text, boolean)', 'public.name_letters(text)', 'public.name_violation(text, text, uuid)',
    'public.check_nickname(text)', 'public.change_nickname(uuid, text)', 'public.level_progress(bigint)',
    'public.api_error(text)', 'public.handle_new_user()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.check_nickname(text) to anon, authenticated;
  grant execute on function public.change_nickname(uuid, text) to authenticated;
end;
$$;
