-- ===== idempotent copy of migrations/20261125000100_m4d_player_tags.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M4d · 0100 · Player tags, lookalike-free names, player search (ADR-085)
-- =============================================================================
-- profiles.tag: permanent, globally unique 4-character tag (alphabet without 0/O/1/I), shown as "#K7Q2";
--   set by a column default on every insert, backfilled for existing players, kept on nickname change and reset.
-- name_key(nickname): lower case, umlauts/accents folded, leet digits mapped, underscores removed (no collapsing of
--   repeated letters). A new or changed nickname with the key of another player's nickname is name_taken; the
--   sign-up suffix loop avoids keys as well. Existing duplicates stay (non-unique index on the key).
-- player_by_handle(text): active player by nickname (case-insensitive), else by tag ("#K7Q2" / "k7q2").
-- New RPC:
--   search_players(query) -> {players: [{nickname, tag, level, avatar_key}]} (at most 8)
-- New field `tag` in: get_player_card, get_my_portfolio, FRIENDS entries (friends/incoming/outgoing),
--   get_rich_list entries (null for tycoons). get_player_card and the friends RPCs also accept a tag.
-- Idempotent (identical copy in supabase/updates/).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Player tag
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists tag text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_tag_format' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_tag_format check (tag ~ '^[A-HJ-NP-Z2-9]{4}$');
  end if;
end;
$$;

-- A random free tag (32^4 = 1 048 576 tags); the unique index catches the rare race of two sign-ups.
create or replace function public.new_player_tag()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_tag      text;
begin
  for i in 1..100 loop
    select string_agg(substr(c_alphabet, 1 + floor(random() * 32)::integer, 1), '') into v_tag from generate_series(1, 4);
    if not exists (select 1 from public.profiles p where p.tag = v_tag) then
      return v_tag;
    end if;
  end loop;
  raise exception 'could not generate a unique player tag' using errcode = 'NX007';
end;
$$;
comment on function public.new_player_tag() is 'Internal: a random unused player tag (ADR-085); default of profiles.tag.';

-- backfill row by row: every statement sees the tags handed out before it
do $$
declare
  r record;
begin
  for r in select p.id from public.profiles p where p.tag is null order by p.created_at, p.id loop
    update public.profiles set tag = public.new_player_tag() where id = r.id;
  end loop;
end;
$$;

alter table public.profiles alter column tag set default public.new_player_tag();
alter table public.profiles alter column tag set not null;
create unique index if not exists profiles_tag_uq on public.profiles (tag);
comment on column public.profiles.tag is 'Permanent public player tag, 4 characters from A-Z/2-9 without I and O, shown as #K7Q2 (ADR-085).';

-- ---------------------------------------------------------------------------
-- B. Name key (lookalikes) and lookup by nickname or tag
-- ---------------------------------------------------------------------------
-- "M1ra", "mi_ra", "MÍRA" -> "mira"; "Matthias" and "Mathias" stay different. Indexed below: changing
-- name_normalize or this function needs a reindex of profiles_name_key_idx.
create or replace function public.name_key(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(public.name_normalize(p_text, true), '_', '');
$$;
comment on function public.name_key(text) is 'Internal: lookalike key of a nickname (ADR-085); two players must not share one.';

create index if not exists profiles_name_key_idx on public.profiles (public.name_key(nickname));

-- Active player by nickname (case-insensitive) or, if no nickname matches, by tag ("#K7Q2", "k7q2"); else NULL.
create or replace function public.player_by_handle(p_handle text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select x.id from public.profiles x
      where lower(x.nickname) = lower(btrim(coalesce(p_handle, ''))) and not x.is_deactivated),
    (select x.id from public.profiles x
      where x.tag = upper(regexp_replace(btrim(coalesce(p_handle, '')), '^#', '')) and not x.is_deactivated));
$$;
comment on function public.player_by_handle(text) is 'Internal: active player by nickname, else by tag (ADR-085).';

-- ---------------------------------------------------------------------------
-- C. Names: lookalikes are taken (name_violation as in M2 plus the key check)
-- ---------------------------------------------------------------------------
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
  elsif exists (select 1 from public.profiles p
                 where (lower(p.nickname) = lower(p_name) or public.name_key(p.nickname) = public.name_key(p_name))
                   and p.id is distinct from p_exclude) then
    -- also lookalikes (ADR-085): same name key as another player's nickname
    return 'name_taken';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- D. Sign-up (handle_new_user as in M2; the suffix loop also avoids lookalikes)
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
  -- pre-checks with check_nickname), taken names and lookalikes of taken names
  -- (same name key, ADR-085) get a numeric suffix; the tag comes from the column default
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
  while exists (select 1 from public.profiles p
                 where lower(p.nickname) = lower(v_nickname) or public.name_key(p.nickname) = public.name_key(v_nickname)) loop
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
-- E. Player card (as in M3d plus tag; also found by tag)
-- ---------------------------------------------------------------------------
create or replace function public.get_player_card(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p      public.profiles;
  v_job  jsonb;
begin
  perform public.require_player();
  select * into p from public.profiles x where x.id = public.player_by_handle(p_nickname);
  if p.id is null then
    perform public.api_error('player_not_found');
  end if;
  select jsonb_build_object('company_name', c.name, 'title_key', j.title_key, 'title', case when j.title_key is null then j.title end,
                            'tier', j.tier, 'since', j.started_at)
    into v_job
    from public.player_jobs j join public.companies c on c.id = j.company_id
   where j.player_id = p.id and j.status = 'active';
  return jsonb_build_object(
    'nickname',        p.nickname,
    'tag',             p.tag,
    'avatar_key',      p.avatar_key,
    'level',           p.level,
    'rank',            public.player_rich_rank(p.id),
    'net_worth_cents', public.player_net_worth_cents(p.id),
    'streak_days',     public.player_streak_days(p.id),
    'skills_learned',  (select count(*) from public.player_skills s where s.player_id = p.id)::integer,
    'branch_scores',   public.player_branch_scores(p.id),
    'top_skills',      coalesce((select jsonb_agg(jsonb_build_object('key', x.skill_key, 'tier', x.tier) order by x.tier desc, x.learned_at)
                                   from (select s.skill_key, s.learned_at, (public.skill_node(s.skill_key) ->> 'tier')::integer as tier
                                           from public.player_skills s where s.player_id = p.id
                                          order by 3 desc nulls last, s.learned_at limit 3) x), '[]'::jsonb),
    'job',             v_job,
    'company',         (select jsonb_build_object('name', c.name, 'ticker', c.ticker)
                          from public.player_companies pc join public.companies c on c.id = pc.company_id
                         where pc.founder_id = p.id and pc.status = 'active'),
    'member_since',    p.created_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Portfolio (as in M3g plus the own tag)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_portfolio()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player    uuid;
  v_cash      bigint;
  v_reserved  bigint;
  v_positions jsonb;
  v_value     bigint;
  v_bid_value bigint;
  v_orders    jsonb;
  v_trades    jsonb;
  v_prof      public.profiles;
  v_priv      public.player_private;
  v_level     jsonb;
  v_days      double precision := public.config_double('names', '{nicknameChangeDays}', 60);
  v_today     date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_streak    integer;
  ls          public.login_streaks;
begin
  v_player := public.require_player();
  select * into v_priv from public.player_private where player_id = v_player;
  select coalesce(sum(a.balance_cents) filter (where a.kind = 'player_cash'), 0),
         coalesce(sum(a.balance_cents) filter (where a.kind = 'player_reserve'), 0)
    into v_cash, v_reserved
    from public.ledger_accounts a where a.owner_player_id = v_player;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ticker', x.ticker, 'name', x.name, 'kind', x.kind, 'quantity_e6', x.quantity_e6,
           'reserved_quantity_e6', x.reserved_quantity_e6, 'avg_price_e4', x.avg_entry_price_e4,
           'last_price_e4', x.last_price_e4, 'market_value_cents', x.mv, 'cost_basis_cents', x.cost_basis_cents,
           'unrealized_pnl_cents', x.mv - x.cost_basis_cents, 'realized_pnl_cents', x.realized_pnl_cents,
           'change_bps', x.change_bps, 'opened_at', x.opened_at)
           order by x.mv desc), '[]'::jsonb),
         coalesce(sum(x.mv), 0)::bigint,
         coalesce(sum(x.bv), 0)::bigint
    into v_positions, v_value, v_bid_value
    from (select s.ticker, s.name, s.kind, p.quantity_e6, p.reserved_quantity_e6, p.avg_entry_price_e4, p.cost_basis_cents,
                 p.realized_pnl_cents, p.opened_at, q.last_price_e4, q.change_bps,
                 public.value_cents(p.quantity_e6, q.last_price_e4) as mv,
                 public.value_cents(p.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)) as bv
            from public.positions p
            join public.securities s on s.id = p.security_id
            join public.security_quotes q on q.security_id = p.security_id
           where p.player_id = v_player and p.status = 'open' and p.quantity_e6 > 0) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'ticker', s.ticker, 'side', o.side, 'type', o.type, 'quantity_e6', o.quantity_e6,
           'filled_quantity_e6', o.filled_quantity_e6, 'limit_price_e4', o.limit_price_e4, 'status', o.status,
           'reserved_cents', o.reserved_cents, 'created_at', o.created_at)
           order by o.created_at desc), '[]'::jsonb)
    into v_orders
    from public.orders o join public.securities s on s.id = o.security_id
   where o.player_id = v_player and o.status in ('open', 'partially_filled');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'ticker', t.ticker, 'side', t.side, 'quantity_e6', t.quantity_e6, 'price_e4', t.price_e4,
           'gross_cents', t.gross_cents, 'fee_cents', t.fee_cents, 'tax_cents', t.tax_cents,
           'realized_pnl_cents', t.realized_pnl_cents, 'xp_awarded', t.xp_awarded, 'executed_at', t.executed_at)
           order by t.executed_at desc), '[]'::jsonb)
    into v_trades
    from (select tr.*, s.ticker from public.trades tr join public.securities s on s.id = tr.security_id
           where tr.player_id = v_player and tr.executed_at > coalesce(v_priv.account_reset_at, '-infinity'::timestamptz)
           order by tr.executed_at desc limit 50) t;

  select * into v_prof from public.profiles where id = v_player;
  select * into ls from public.login_streaks where player_id = v_player;
  v_level := public.level_progress(v_prof.xp_total);
  v_streak := case when ls.last_login_day >= v_today - 1 then ls.current_streak
                   when ls.last_login_day = v_today - 2 and ls.freeze_tokens > 0 then ls.current_streak
                   else 0 end;

  return jsonb_build_object(
    'cash_cents',            v_cash,
    'reserved_cents',        v_reserved,
    'positions_value_cents', v_value,
    'total_cents',           v_cash + v_reserved + v_value,
    'net_worth_cents',       v_cash + v_reserved + v_bid_value,
    'loss_pot_cents',        coalesce(v_priv.tax_loss_pot_cents, 0),
    'vault',                 public.vault_status(v_player) - 'accrued_seconds' - 'base_rate_cents_per_hour',
    'positions',             v_positions,
    'open_orders',           v_orders,
    'recent_trades',         v_trades,
    'level',                 v_prof.level,
    'xp_total',              v_prof.xp_total,
    'xp_into_level',         (v_level ->> 'xp_into_level')::bigint,
    'xp_for_next',           (v_level ->> 'xp_for_next')::bigint,
    'tutorial_completed',    v_priv.tutorial_completed_at is not null,
    'nickname',              v_prof.nickname,
    'tag',                   v_prof.tag,
    'nickname_change_available_at',
                             case when v_prof.nickname_changed_at is null
                                    or v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) <= now() then null
                                  else v_prof.nickname_changed_at + make_interval(secs => v_days * 86400) end,
    'missions_claimable',    (select count(*) from public.player_missions m
                               where m.player_id = v_player and m.status = 'completed'
                                 and (m.expires_at is null or m.expires_at > public.game_now()))::integer,
    'streak_days',           coalesce(v_streak, 0),
    'avatar_key',            coalesce(v_prof.avatar_key, 'rookie'),
    'skill_points_free',     coalesce((select sp.free_points from public.player_skill_points sp where sp.player_id = v_player), 0),
    'daily_reward_claimable', not exists (select 1 from public.daily_reward_claims c
                                           where c.player_id = v_player
                                             and c.claim_day = (public.game_now() at time zone 'Europe/Berlin')::date),
    'company_value_cents',   public.player_company_value_cents(v_player),
    'debt_cents',            public.player_debt_cents(v_player),
    'debt_withholding_bps',  public.config_double('startups', '{insolvency,loanWithholdingBps}', 5000)::integer,
    'founding_locked_until', case when v_prof.founding_locked_until > now() then v_prof.founding_locked_until end,
    'server_time',           public.game_now());
end;
$$;

-- ---------------------------------------------------------------------------
-- G. Rich list (as in M2b plus tag for players, null for tycoons)
-- ---------------------------------------------------------------------------
create or replace function public.get_rich_list(p_limit integer default 100, p_offset integer default 0, p_scope text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_limit   integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_scope   text := coalesce(p_scope, 'all');
  v_now     timestamptz := public.game_now();
  v_snap    timestamptz;
  v_out     jsonb;
begin
  v_player := public.require_player();
  if v_scope not in ('all', 'players') then
    perform public.api_error('invalid_argument');
  end if;
  -- the latest snapshot that is at least 24 h old
  select max(s.taken_at) into v_snap from public.rich_list_snapshots s where s.taken_at <= v_now - interval '24 hours';

  with lst as materialized (
    select e.entity_kind, e.entity_id, e.name, e.description, e.net_worth_cents,
           case when v_scope = 'players' then e.rank_players else e.rank_all end as rnk,
           case when s.net_worth_cents > 0 then round((e.net_worth_cents - s.net_worth_cents) * 10000.0 / s.net_worth_cents)::integer end as change_bps,
           case when s.entity_id is not null
                then (case when v_scope = 'players' then s.rank_players else s.rank_all end)
                   - (case when v_scope = 'players' then e.rank_players else e.rank_all end) end as rank_change
      from public.rich_list_entries() e
      left join public.rich_list_snapshots s on s.taken_at = v_snap and s.entity_kind = e.entity_kind and s.entity_id = e.entity_id
     where v_scope = 'all' or e.entity_kind = 'player'
  ), me as (
    select * from lst where entity_kind = 'player' and entity_id = v_player
  )
  select jsonb_build_object(
           'server_time', v_now,
           'total', (select count(*) from lst),
           'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                          'rank', x.rnk, 'kind', x.entity_kind, 'id', x.entity_id, 'name', x.name, 'description', x.description,
                          'net_worth_cents', x.net_worth_cents, 'change_24h_bps', x.change_bps, 'rank_change_24h', x.rank_change,
                          'is_me', x.entity_kind = 'player' and x.entity_id = v_player,
                          'avatar_key', case when x.entity_kind = 'player'
                                             then (select pr.avatar_key from public.profiles pr where pr.id = x.entity_id)
                                             else public.tycoon_avatar_key(x.entity_id) end,
                          'tag', case when x.entity_kind = 'player'
                                      then (select pr.tag from public.profiles pr where pr.id = x.entity_id) end) order by x.rnk), '[]'::jsonb)
                         from (select * from lst order by rnk offset v_offset limit v_limit) x),
           'me', (select jsonb_build_object(
                           'rank', m.rnk, 'net_worth_cents', m.net_worth_cents,
                           'next', (select jsonb_build_object('rank', n.rnk, 'name', n.name, 'gap_cents', n.net_worth_cents - m.net_worth_cents)
                                      from lst n where n.rnk = m.rnk - 1))
                    from me m))
    into v_out;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- H. Friends: entries carry the tag, the other player is also found by tag
-- ---------------------------------------------------------------------------
create or replace function public.friends_json(p_player uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'level', p.level,
                                          'since', coalesce(f.responded_at, f.updated_at)) order by lower(p.nickname), p.id)
        from public.friendships f
        join public.profiles p on p.id = case when f.requester_id = p_player then f.addressee_id else f.requester_id end
       where f.status = 'accepted' and p_player in (f.requester_id, f.addressee_id) and not p.is_deactivated), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'level', p.level, 'at', f.updated_at)
                       order by f.updated_at desc, p.id)
        from public.friendships f join public.profiles p on p.id = f.requester_id
       where f.status = 'pending' and f.addressee_id = p_player and not p.is_deactivated), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('nickname', p.nickname, 'tag', p.tag, 'level', p.level, 'at', f.updated_at)
                       order by f.updated_at desc, p.id)
        from public.friendships f join public.profiles p on p.id = f.addressee_id
       where f.status = 'pending' and f.requester_id = p_player and not p.is_deactivated), '[]'::jsonb));
$$;
comment on function public.friends_json(uuid) is
  'FRIENDS of a player (ADR-084, tag ADR-085): friends by nickname, incoming and outgoing open requests newest first.';

-- The other player of a friends RPC: active, found by nickname (case-insensitive) or tag
create or replace function public.friend_target(p_player uuid, p_nickname text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_nickname is null or char_length(btrim(p_nickname)) = 0 or char_length(p_nickname) > 64 then
    perform public.api_error('invalid_argument');
  end if;
  v_id := public.player_by_handle(p_nickname);
  if v_id is null then
    perform public.api_error('player_not_found');
  end if;
  if v_id = p_player then
    perform public.api_error('invalid_argument');
  end if;
  return v_id;
end;
$$;

comment on function public.send_friend_request(uuid, text) is
  'RPC: friend request to a player by nickname or tag (ADR-084/085); a counter request accepts. Errors player_not_found, invalid_argument.';

-- ---------------------------------------------------------------------------
-- I. Player search (top search bar)
-- ---------------------------------------------------------------------------
-- Query trimmed, one leading '#' dropped; under 2 characters: no result. A valid tag puts its player first, then
-- nicknames (case-insensitive): exact, prefix, contains; each group by level desc, nickname. At most 8.
create or replace function public.search_players(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q    text := regexp_replace(btrim(coalesce(p_query, '')), '^#', '');
  v_like text;
  v_out  jsonb;
begin
  perform public.require_player();
  if char_length(v_q) < 2 or char_length(v_q) > 64 then
    return jsonb_build_object('players', '[]'::jsonb);
  end if;
  v_q := lower(v_q);
  -- user input is a LIKE literal: escape the wildcards and the escape character
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  select coalesce(jsonb_agg(jsonb_build_object('nickname', x.nickname, 'tag', x.tag, 'level', x.level,
                                               'avatar_key', x.avatar_key)
                            order by x.grp, x.level desc, lower(x.nickname), x.nickname), '[]'::jsonb)
    into v_out
    from (select p.nickname, p.tag, p.level, p.avatar_key,
                 case when p.tag = upper(v_q) then 0
                      when lower(p.nickname) = v_q then 1
                      when lower(p.nickname) like v_like || '%' escape '\' then 2
                      else 3 end as grp
            from public.profiles p
           where not p.is_deactivated
             and (p.tag = upper(v_q) or lower(p.nickname) like '%' || v_like || '%' escape '\')
           order by grp, p.level desc, lower(p.nickname), p.nickname
           limit 8) x;
  return jsonb_build_object('players', v_out);
end;
$$;
comment on function public.search_players(text) is
  'RPC: player search by tag or nickname (exact, prefix, contains), at most 8 (ADR-085).';

-- ---------------------------------------------------------------------------
-- J. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.new_player_tag()', 'public.name_key(text)', 'public.player_by_handle(text)', 'public.search_players(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.search_players(text) to authenticated;
end;
$$;
