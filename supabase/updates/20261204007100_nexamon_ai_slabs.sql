-- ===== idempotent copy of migrations/20261204007100_nexamon_ai_slabs.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 7100 · Nexamon: graded copies never leave circulation; the AI holds them for a while and relists (ADR-165)
-- =============================================================================
-- Owner rule: a slab (any grade, half grades and Black Label included) that reaches the AI (an AI collector's buy, a
-- leaving player's copies) becomes AI seller stock and is never deleted.
-- * nexamon_copies.ai_hold_until: set by the trigger nexamon_copies_ai_hold when a slab gets an AI owner:
--   acquired_at + nexamon_ai_slab_hold(u) with u from md5(id, acquired_at) (nexamonAiSlabHoldMs, ai.slabHold:
--   minHours + (maxHours - minHours) x u^skewPow); cleared when a player owns it again.
-- * nexamon_ai_restock(): raw copies as before (up to ai.listedPerCard, counting only raw AI listings); every AI slab
--   whose hold has passed is listed in addition at nexamon_ai_ask_cents(its current value). Held slabs show nowhere.
-- * nexamon_ai_reset(): the stock cap (ai.stockCap) retires raw copies only; slabs are never retired. The restock
--   after the reset relists every slab whose hold has passed.
-- Idempotent: runs unchanged as supabase/updates/20261204007100_nexamon_ai_slabs.sql.
-- =============================================================================

alter table public.nexamon_copies add column if not exists ai_hold_until timestamptz;
comment on column public.nexamon_copies.ai_hold_until is
  'A slab held by the AI is listed again from this time on (ADR-165, ai.slabHold); null = not held.';

-- nexamonAiSlabHoldMs: the hold for u in [0, 1)
create or replace function public.nexamon_ai_slab_hold(p_u double precision)
returns interval
language sql
stable
security definer
set search_path = ''
as $$
  select make_interval(secs => round((coalesce((h ->> 'minHours')::numeric, 1)
           + (coalesce((h ->> 'maxHours')::numeric, 72) - coalesce((h ->> 'minHours')::numeric, 1))
             * power(least(1, greatest(0, p_u))::numeric, coalesce((h ->> 'skewPow')::numeric, 2))) * 3600)::double precision)
    from (select coalesce(public.nexamon_cfg() #> '{ai,slabHold}', '{}'::jsonb) as h) c;
$$;

create or replace function public.nexamon_copies_ai_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ai_owner is null then
    new.ai_hold_until := null;
  elsif new.grade is not null and (tg_op = 'INSERT' or old.ai_owner is null) then
    new.ai_hold_until := new.acquired_at + public.nexamon_ai_slab_hold(
      ('x' || substr(md5(new.id::text || ':' || new.acquired_at::text), 1, 8))::bit(32)::bigint / 4294967296.0);
  end if;
  return new;
end;
$$;
drop trigger if exists nexamon_copies_ai_hold on public.nexamon_copies;
create trigger nexamon_copies_ai_hold before insert or update of ai_owner on public.nexamon_copies
  for each row execute function public.nexamon_copies_ai_hold();

-- The AI sellers offer up to ai.listedPerCard raw copies of a card (p_extra more, for a legendary) and every slab
-- whose hold has passed.
create or replace function public.nexamon_ai_restock(p_card text, p_now timestamptz, p_extra integer default 0)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  k        public.nexamon_cards;
  v_limit  integer;
  v_listed integer;
  v_n      integer := 0;
  r        record;
begin
  select * into k from public.nexamon_cards where card_key = p_card;
  if k.card_key is null then
    return 0;
  end if;
  v_limit := coalesce((public.nexamon_cfg() #>> array['ai', 'listedPerCard', k.rarity])::integer, 0) + greatest(0, coalesce(p_extra, 0));
  select count(*) into v_listed from public.nexamon_listings l join public.nexamon_copies c on c.id = l.copy_id
   where l.card_key = p_card and l.seller_ai is not null and c.grade is null;
  for r in select c.id, c.ai_owner, c.condition, c.grade from public.nexamon_copies c
            where c.card_key = p_card and c.ai_owner is not null and c.grade is null
              and not exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)
            order by c.acquired_at, c.serial
            limit greatest(0, v_limit - v_listed) loop
    insert into public.nexamon_listings (copy_id, card_key, seller_ai, price_cents, created_at)
    values (r.id, p_card, r.ai_owner,
            public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(k.value_e4, r.condition, r.grade, k.card_key)), p_now);
    v_n := v_n + 1;
  end loop;
  -- slabs never leave circulation: once held long enough, the AI lists every one of them
  for r in select c.id, c.ai_owner, c.condition, c.grade from public.nexamon_copies c
            where c.card_key = p_card and c.ai_owner is not null and c.grade is not null and c.grading_until is null
              and coalesce(c.ai_hold_until, '-infinity'::timestamptz) <= p_now
              and not exists (select 1 from public.nexamon_listings l where l.copy_id = c.id)
            order by c.acquired_at, c.serial loop
    insert into public.nexamon_listings (copy_id, card_key, seller_ai, price_cents, created_at)
    values (r.id, p_card, r.ai_owner,
            public.nexamon_ai_ask_cents(public.nexamon_copy_value_cents(k.value_e4, r.condition, r.grade, k.card_key)), p_now);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Every ai.listingResetHours: the AI's offers go, its raw stock above the cap is retired (slabs never), then it
-- lists again, held slabs whose time has come included.
create or replace function public.nexamon_ai_reset(p_now timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ai        jsonb := public.nexamon_cfg() -> 'ai';
  v_now     timestamptz := coalesce(p_now, public.game_now());
  v_hours   integer := coalesce((public.nexamon_cfg() #>> '{ai,listingResetHours}')::integer, 0);
  v_last    timestamptz;
  v_deleted integer := 0;
  v_retired integer := 0;
  v_listed  integer := 0;
  r         record;
begin
  if v_hours <= 0 then
    return jsonb_build_object('skipped', 'off');
  end if;
  perform pg_advisory_xact_lock(7311652);
  select m.ai_reset_at into v_last from public.nexamon_meta m where m.id;
  if v_last is not null and v_now < v_last + make_interval(hours => v_hours) then
    return jsonb_build_object('skipped', 'not due');
  end if;
  delete from public.nexamon_listings where seller_ai is not null;
  get diagnostics v_deleted = row_count;
  -- retire the raw stock above the cap, the newest copies first; graded copies are never retired
  with ranked as (
    select c.id, row_number() over (partition by c.card_key order by c.acquired_at, c.serial) as n,
           coalesce((ai #>> array['stockCap', k.rarity])::integer, 1000000) as cap
      from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
     where c.ai_owner is not null and c.grade is null and c.grading_until is null
  )
  delete from public.nexamon_copies c using ranked x where x.id = c.id and x.n > x.cap;
  get diagnostics v_retired = row_count;
  for r in select distinct c.card_key from public.nexamon_copies c where c.ai_owner is not null loop
    v_listed := v_listed + public.nexamon_ai_restock(r.card_key, v_now);
  end loop;
  insert into public.nexamon_meta (id, ai_reset_at) values (true, v_now)
  on conflict (id) do update set ai_reset_at = excluded.ai_reset_at;
  return jsonb_build_object('deleted', v_deleted, 'retired', v_retired, 'listed', v_listed);
end;
$$;
comment on function public.nexamon_ai_reset(timestamptz) is
  'Internal (cron nexa-nexamon-ai-reset): every ai.listingResetHours the AI''s listings are removed, its raw stock above '
  'ai.stockCap retired (slabs never), and it lists again at the current value, held slabs whose time has come '
  'included (ADR-174, ADR-165).';

revoke all on function public.nexamon_ai_slab_hold(double precision) from public, anon, authenticated;
revoke all on function public.nexamon_copies_ai_hold() from public, anon, authenticated;
revoke all on function public.nexamon_ai_restock(text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.nexamon_ai_reset(timestamptz) from public, anon, authenticated;
grant execute on function public.nexamon_ai_slab_hold(double precision) to service_role;
grant execute on function public.nexamon_ai_restock(text, timestamptz, integer) to service_role;
grant execute on function public.nexamon_ai_reset(timestamptz) to service_role;
