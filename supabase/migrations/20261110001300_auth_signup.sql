-- =============================================================================
-- NEXA · 1300 · Sign-up: auth.users -> player bootstrap
-- =============================================================================
-- Reads from auth.users.raw_user_meta_data (set by supabase.auth.signUp
-- options.data):
--   invite_code    text     required while game_config auth.inviteRequired (default true)
--   age_confirmed  boolean  required while game_config auth.ageConfirmationRequired (default true)
--   nickname       text     optional, 3-20 chars [A-Za-z0-9_]; made unique if taken
-- Starting capital: game_config key "economy", path startingCapitalCents,
-- fallback 1 000 000 cents (ADR-011).
-- =============================================================================

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
  v_invite          public.invite_codes;
  v_base            text;
  v_nickname        text;
  v_attempt         integer := 0;
  v_cash_account    uuid;
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

  -- nickname -------------------------------------------------------------------
  v_base := left(regexp_replace(coalesce(v_meta ->> 'nickname', ''), '[^A-Za-z0-9_]', '', 'g'), 20);
  if length(v_base) < 3 then
    v_base := 'Trader';
    v_nickname := v_base || (floor(random() * 90000) + 10000)::integer::text;
  else
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
  insert into public.vaults (player_id) values (new.id);
  insert into public.login_streaks (player_id) values (new.id);

  insert into public.player_unlocks (player_id, unlock_key)
  select new.id, u.key from public.unlocks u where u.level <= 1;

  insert into public.notification_preferences (player_id, type_key, in_app_enabled, push_enabled)
  select new.id, t.key, t.default_in_app, t.default_push from public.notification_types t;

  -- ledger: cash + reserve account, starting capital from the mint -------------
  insert into public.ledger_accounts (kind, owner_player_id, label)
  values ('player_cash', new.id, 'Cash')
  returning id into v_cash_account;
  insert into public.ledger_accounts (kind, owner_player_id, label)
  values ('player_reserve', new.id, 'Reserved (orders, subscriptions, margin)');

  if v_start_cents > 0 then
    perform public.ledger_transfer(
      public.ledger_system_account('mint'),
      v_cash_account,
      v_start_cents,
      'starting_capital',
      'Starting capital',
      'profile',
      new.id,
      'starting_capital:' || new.id::text,
      new.id
    );
  end if;

  -- consume the invite ---------------------------------------------------------
  if v_code is not null then
    update public.invite_codes set used_count = used_count + 1 where code = v_code;
    insert into public.invite_code_redemptions (code, player_id) values (v_code, new.id);
  end if;

  return new;
end;
$$;
comment on function public.handle_new_user() is 'Trigger on auth.users: validates invite/age, creates profile, settings, vault, ledger accounts, starting capital, notification defaults.';

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
