-- =============================================================================
-- NEXA · 0300 · Double-entry ledger (ADR-007)
-- =============================================================================
-- Sign convention: amount_cents > 0 increases the account balance, < 0
-- decreases it. The entries of one transaction sum to exactly 0.
-- Owner FKs (profiles, companies) are added by the later domain migrations.
-- =============================================================================

create table public.ledger_accounts (
  id               uuid primary key default gen_random_uuid(),
  kind             public.ledger_account_kind not null,
  owner_player_id  uuid,
  owner_company_id uuid,
  system_key       text,
  label            text,
  balance_cents    bigint not null default 0,
  allow_negative   boolean not null default false,
  is_frozen        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ledger_accounts_owner_matches_kind check (
    (kind in ('player_cash', 'player_reserve') and owner_player_id is not null and owner_company_id is null and system_key is null) or
    (kind in ('company_cash', 'company_reserve') and owner_company_id is not null and owner_player_id is null and system_key is null) or
    (kind = 'system' and system_key is not null and owner_player_id is null and owner_company_id is null)
  ),
  constraint ledger_accounts_non_negative check (allow_negative or balance_cents >= 0)
);
alter table public.ledger_accounts enable row level security;
create unique index ledger_accounts_player_kind_uq  on public.ledger_accounts (owner_player_id, kind)  where owner_player_id is not null;
create unique index ledger_accounts_company_kind_uq on public.ledger_accounts (owner_company_id, kind) where owner_company_id is not null;
create unique index ledger_accounts_system_key_uq   on public.ledger_accounts (system_key)             where system_key is not null;
comment on table public.ledger_accounts is 'Ledger accounts. balance_cents is a trigger-maintained cache of the entries.';
comment on column public.ledger_accounts.allow_negative is 'System accounts (sources/sinks) may go negative; player/company accounts may not unless explicitly flagged.';

create table public.ledger_transactions (
  id              uuid primary key default gen_random_uuid(),
  kind            public.ledger_tx_kind not null,
  description     text,
  ref_type        text,
  ref_id          uuid,
  game_quarter_id bigint references public.game_quarters (id),
  initiated_by    uuid,
  idempotency_key text unique,
  metadata        jsonb not null default '{}'::jsonb,
  db_txid         bigint not null default txid_current(),
  created_at      timestamptz not null default now()
);
alter table public.ledger_transactions enable row level security;
create index ledger_transactions_kind_created_idx on public.ledger_transactions (kind, created_at desc);
create index ledger_transactions_ref_idx          on public.ledger_transactions (ref_type, ref_id) where ref_id is not null;
create index ledger_transactions_quarter_idx      on public.ledger_transactions (game_quarter_id);
create index ledger_transactions_initiated_by_idx on public.ledger_transactions (initiated_by) where initiated_by is not null;
comment on table public.ledger_transactions is 'Header of a balanced set of ledger entries. Immutable.';
comment on column public.ledger_transactions.db_txid is 'Database transaction that created the row; entries can only be added inside that same transaction.';

create table public.ledger_entries (
  id                  bigint generated always as identity primary key,
  transaction_id      uuid not null references public.ledger_transactions (id),
  account_id          uuid not null references public.ledger_accounts (id),
  amount_cents        bigint not null check (amount_cents <> 0),
  balance_after_cents bigint not null,
  created_at          timestamptz not null default now()
);
alter table public.ledger_entries enable row level security;
create index ledger_entries_transaction_idx on public.ledger_entries (transaction_id);
create index ledger_entries_account_idx     on public.ledger_entries (account_id, id desc);
comment on table public.ledger_entries is 'Immutable booking lines. Corrections happen only via reversing transactions.';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Applies an entry to the cached balance and enforces account rules.
create or replace function public.ledger_entries_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc  public.ledger_accounts;
  v_txid bigint;
begin
  select t.db_txid into v_txid from public.ledger_transactions t where t.id = new.transaction_id;
  if v_txid is null then
    raise exception 'ledger transaction % does not exist', new.transaction_id using errcode = 'NX007';
  end if;
  if v_txid <> txid_current() then
    raise exception 'ledger transaction % is closed: entries cannot be appended later', new.transaction_id
      using errcode = 'NX003';
  end if;

  select a.* into v_acc from public.ledger_accounts a where a.id = new.account_id for update;
  if not found then
    raise exception 'ledger account % does not exist', new.account_id using errcode = 'NX007';
  end if;
  if v_acc.is_frozen then
    raise exception 'ledger account % is frozen', new.account_id using errcode = 'NX008';
  end if;
  if not v_acc.allow_negative and v_acc.balance_cents + new.amount_cents < 0 then
    raise exception 'insufficient funds on account % (balance %, change %)',
      new.account_id, v_acc.balance_cents, new.amount_cents using errcode = 'NX001';
  end if;

  update public.ledger_accounts a
     set balance_cents = a.balance_cents + new.amount_cents
   where a.id = new.account_id
  returning a.balance_cents into new.balance_after_cents;

  new.created_at := now();
  return new;
end;
$$;

create trigger ledger_entries_apply
  before insert on public.ledger_entries
  for each row execute function public.ledger_entries_before_insert();

create trigger ledger_entries_immutable
  before update or delete on public.ledger_entries
  for each row execute function public.prevent_mutation();
create trigger ledger_entries_no_truncate
  before truncate on public.ledger_entries
  for each statement execute function public.prevent_mutation();

create trigger ledger_transactions_immutable
  before update or delete on public.ledger_transactions
  for each row execute function public.prevent_mutation();
create trigger ledger_transactions_no_truncate
  before truncate on public.ledger_transactions
  for each statement execute function public.prevent_mutation();

-- The cached balance may only change through the entries trigger (depth >= 2).
create or replace function public.ledger_accounts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.balance_cents <> 0 then
      raise exception 'ledger account % cannot be deleted with a non-zero balance', old.id using errcode = 'NX003';
    end if;
    return old;
  end if;
  if new.balance_cents is distinct from old.balance_cents and pg_trigger_depth() < 2 then
    raise exception 'ledger_accounts.balance_cents is maintained by ledger entries only' using errcode = 'NX003';
  end if;
  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.owner_player_id is distinct from old.owner_player_id
     or new.owner_company_id is distinct from old.owner_company_id
     or new.system_key is distinct from old.system_key then
    raise exception 'identity columns of ledger account % are immutable', old.id using errcode = 'NX003';
  end if;
  return new;
end;
$$;

create trigger ledger_accounts_guard
  before update or delete on public.ledger_accounts
  for each row execute function public.ledger_accounts_guard();

create or replace function public.ledger_accounts_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.balance_cents <> 0 then
    raise exception 'ledger accounts must be created with a zero balance' using errcode = 'NX003';
  end if;
  return new;
end;
$$;

create trigger ledger_accounts_insert_guard
  before insert on public.ledger_accounts
  for each row execute function public.ledger_accounts_insert_guard();

-- Deferred check at COMMIT: every transaction has >= 2 entries summing to 0.
create or replace function public.ledger_check_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx    uuid;
  v_sum   bigint;
  v_count bigint;
begin
  if tg_table_name = 'ledger_transactions' then
    v_tx := new.id;
  else
    v_tx := new.transaction_id;
  end if;

  select coalesce(sum(e.amount_cents), 0), count(*)
    into v_sum, v_count
    from public.ledger_entries e
   where e.transaction_id = v_tx;

  if v_count < 2 then
    raise exception 'ledger transaction % has % entries, at least 2 required', v_tx, v_count using errcode = 'NX002';
  end if;
  if v_sum <> 0 then
    raise exception 'ledger transaction % is unbalanced (sum = % cents)', v_tx, v_sum using errcode = 'NX002';
  end if;
  return null;
end;
$$;

create constraint trigger ledger_entries_balanced
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function public.ledger_check_balanced();

create constraint trigger ledger_transactions_balanced
  after insert on public.ledger_transactions
  deferrable initially deferred
  for each row execute function public.ledger_check_balanced();

-- ---------------------------------------------------------------------------
-- Internal API (service role / SECURITY DEFINER RPCs only)
-- ---------------------------------------------------------------------------

create or replace function public.ledger_system_account(p_system_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select a.id into v_id from public.ledger_accounts a where a.system_key = p_system_key;
  if v_id is null then
    raise exception 'unknown system ledger account "%"', p_system_key using errcode = 'NX007';
  end if;
  return v_id;
end;
$$;

create or replace function public.ledger_player_account(
  p_player_id uuid,
  p_kind public.ledger_account_kind default 'player_cash'
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select a.id into v_id
    from public.ledger_accounts a
   where a.owner_player_id = p_player_id and a.kind = p_kind;
  if v_id is null then
    raise exception 'player % has no % ledger account', p_player_id, p_kind using errcode = 'NX007';
  end if;
  return v_id;
end;
$$;

-- Posts one balanced transaction.
--   p_entries: jsonb array of {"account_id": uuid, "amount_cents": integer}
-- Accounts are locked in id order (deadlock-free, ADR-008). With an
-- idempotency key the call is replay-safe and returns the existing id.
create or replace function public.ledger_post(
  p_kind            public.ledger_tx_kind,
  p_entries         jsonb,
  p_description     text  default null,
  p_ref_type        text  default null,
  p_ref_id          uuid  default null,
  p_idempotency_key text  default null,
  p_initiated_by    uuid  default null,
  p_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx_id   uuid;
  v_sum     numeric;
  v_count   integer;
  v_quarter bigint;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries must be a jsonb array' using errcode = 'NX007';
  end if;

  if p_idempotency_key is not null then
    select t.id into v_tx_id from public.ledger_transactions t where t.idempotency_key = p_idempotency_key;
    if v_tx_id is not null then
      return v_tx_id;
    end if;
  end if;

  select count(*), coalesce(sum((e ->> 'amount_cents')::numeric), 0)
    into v_count, v_sum
    from jsonb_array_elements(p_entries) as e;

  if v_count < 2 then
    raise exception 'a ledger transaction needs at least 2 entries' using errcode = 'NX002';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_entries) as e
     where (e ->> 'account_id') is null
        or (e ->> 'amount_cents') is null
        or (e ->> 'amount_cents') !~ '^-?[0-9]+$'
        or (e ->> 'amount_cents')::numeric = 0
  ) then
    raise exception 'every entry needs account_id and a non-zero integer amount_cents' using errcode = 'NX007';
  end if;
  if v_sum <> 0 then
    raise exception 'ledger entries are unbalanced (sum = % cents)', v_sum using errcode = 'NX002';
  end if;

  -- Lock all affected accounts in a fixed order.
  perform 1
     from public.ledger_accounts a
    where a.id in (select (e ->> 'account_id')::uuid from jsonb_array_elements(p_entries) as e)
    order by a.id
      for update;

  select q.id into v_quarter from public.current_game_quarter() q;

  begin
    insert into public.ledger_transactions (kind, description, ref_type, ref_id, game_quarter_id, initiated_by, idempotency_key, metadata)
    values (p_kind, p_description, p_ref_type, p_ref_id, v_quarter, p_initiated_by, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb))
    returning id into v_tx_id;
  exception when unique_violation then
    -- concurrent replay with the same idempotency key
    select t.id into v_tx_id from public.ledger_transactions t where t.idempotency_key = p_idempotency_key;
    return v_tx_id;
  end;

  insert into public.ledger_entries (transaction_id, account_id, amount_cents, balance_after_cents)
  select v_tx_id, (e ->> 'account_id')::uuid, (e ->> 'amount_cents')::bigint, 0
    from jsonb_array_elements(p_entries) with ordinality as t(e, ord)
   order by (e ->> 'account_id')::uuid, ord;

  return v_tx_id;
end;
$$;
comment on function public.ledger_post(public.ledger_tx_kind, jsonb, text, text, uuid, text, uuid, jsonb)
  is 'Internal: posts one balanced ledger transaction. Used by every money-moving RPC.';

-- Convenience wrapper for the common two-legged case.
create or replace function public.ledger_transfer(
  p_from_account    uuid,
  p_to_account      uuid,
  p_amount_cents    bigint,
  p_kind            public.ledger_tx_kind,
  p_description     text  default null,
  p_ref_type        text  default null,
  p_ref_id          uuid  default null,
  p_idempotency_key text  default null,
  p_initiated_by    uuid  default null,
  p_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'transfer amount must be positive' using errcode = 'NX007';
  end if;
  if p_from_account = p_to_account then
    raise exception 'transfer needs two different accounts' using errcode = 'NX007';
  end if;
  return public.ledger_post(
    p_kind,
    jsonb_build_array(
      jsonb_build_object('account_id', p_from_account, 'amount_cents', -p_amount_cents),
      jsonb_build_object('account_id', p_to_account,   'amount_cents',  p_amount_cents)
    ),
    p_description, p_ref_type, p_ref_id, p_idempotency_key, p_initiated_by, p_metadata
  );
end;
$$;

-- Audit: accounts whose cached balance differs from the sum of their entries,
-- plus (as account_id NULL) a non-zero grand total. Empty result = healthy.
create or replace function public.ledger_audit()
returns table (account_id uuid, cached_cents bigint, computed_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.balance_cents, coalesce(s.total, 0)::bigint
    from public.ledger_accounts a
    left join (
      select e.account_id, sum(e.amount_cents) as total
        from public.ledger_entries e
       group by e.account_id
    ) s on s.account_id = a.id
   where a.balance_cents <> coalesce(s.total, 0)
  union all
  select null::uuid, 0::bigint, t.total::bigint
    from (select coalesce(sum(e.amount_cents), 0) as total from public.ledger_entries e) t
   where t.total <> 0;
$$;

-- Money supply held by players and companies (central bank input).
create or replace function public.money_supply_cents()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(a.balance_cents), 0)::bigint
    from public.ledger_accounts a
   where a.kind <> 'system';
$$;

-- ---------------------------------------------------------------------------
-- System accounts (sources and sinks). Created here because handle_new_user()
-- needs "mint" even on a database without seed data.
-- ---------------------------------------------------------------------------
insert into public.ledger_accounts (kind, system_key, label, allow_negative) values
  ('system', 'mint',     'Money creation: basic income, starting capital, bonuses', true),
  ('system', 'payroll',  'Salaries paid by AI companies',                           true),
  ('system', 'fees',     'Order and service fees (sink)',                           true),
  ('system', 'taxes',    'Capital gains and company taxes (sink)',                  true),
  ('system', 'market',   'Counterparty of AI market makers/investors, rounding',    true),
  ('system', 'upkeep',   'Lifestyle upkeep (sink)',                                 true),
  ('system', 'interest', 'Financing costs, loan interest, bond coupons',            true),
  ('system', 'bank',     'Loan principal of the AI bank',                           true),
  ('system', 'fines',    'Regulator fines and penalties (sink)',                    true),
  ('system', 'economy',  'Customers and suppliers of companies (revenue/costs)',    true)
on conflict do nothing;
