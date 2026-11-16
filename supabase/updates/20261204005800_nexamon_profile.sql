-- ===== idempotent copy of migrations/20261204005800_nexamon_profile.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 5800 · Nexamon: a player's collectibles on their profile (ADR-165)
-- =============================================================================
-- get_player_nexamon(p_nickname, p_limit) is the public view of a collection, like get_collection() for artworks
-- and get_property() for the home: every signed-in player may read it, by nickname (null = the caller's own).
-- It returns the collection in numbers (copies, different cards, value, slabs, tens incl. Black Label), the progress per set and one
-- row per card the player owns with its best copy (the most valuable one: condition, grade, serial, value) and
-- the number of copies, most valuable first. p_limit caps the rows (1..500, default all); the numbers always
-- cover the whole collection. A player below the Nexamon level has nothing to show (unlocked false, no cards).
-- Listings, prices asked and gradings in progress stay private: a copy at ASP shows as the raw card it still is.
-- Read only: nothing is written, so the function is STABLE.
-- Idempotent: runs unchanged as supabase/updates/20261204005800_nexamon_profile.sql.

create or replace function public.get_player_nexamon(p_nickname text default null, p_limit integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cfg        jsonb := public.nexamon_cfg();
  v_player   uuid := public.require_player();
  v_target   uuid;
  v_nick     text;
  v_unlocked boolean;
  v_limit    integer := least(greatest(coalesce(p_limit, 500), 1), 500);
  v_summary  jsonb;
  v_sets     jsonb;
  v_cards    jsonb;
begin
  if p_nickname is null then
    v_target := v_player;
  else
    select p.id into v_target from public.profiles p where lower(p.nickname) = lower(btrim(p_nickname));
  end if;
  select p.nickname into v_nick from public.profiles p where p.id = v_target;
  if v_nick is null then
    perform public.api_error('player_not_found');
  end if;
  v_unlocked := public.nexamon_unlocked(v_target);

  with own as (
    select c.card_key, c.serial, c.condition, c.grade, k.set_key, k.number, k.rarity,
           public.nexamon_copy_value_cents(k.value_e4, c.condition, c.grade) as value_cents
      from public.nexamon_copies c join public.nexamon_cards k on k.card_key = c.card_key
     where c.owner_id = v_target and v_unlocked
  ), per_card as (
    -- the best copy of every card: the most valuable, then the higher grade, then the lower serial
    select distinct on (o.card_key)
           o.card_key, o.set_key, o.number, o.rarity, o.serial, o.condition, o.grade, o.value_cents,
           count(*) over (partition by o.card_key) as copies,
           (sum(o.value_cents) over (partition by o.card_key))::bigint as total_cents
      from own o
     order by o.card_key, o.value_cents desc, o.grade desc nulls last, o.serial
  )
  select jsonb_build_object(
           'copies', (select count(*) from own),
           'distinct', (select count(*) from per_card),
           'total', (select count(*) from public.nexamon_cards k where k.in_catalogue),
           'value_cents', (select coalesce(sum(o.value_cents), 0)::bigint from own o),
           'graded', (select count(*) from own o where o.grade is not null),
           'tens', (select count(*) from own o where o.grade >= 10)),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'key', s.set_key, 'cards', s.cards,
                   'distinct', (select count(*) from per_card p where p.set_key = s.set_key),
                   'copies', (select count(*) from own o where o.set_key = s.set_key))
                   order by (cfg #>> array['sets', s.set_key, 'packPriceCents'])::bigint nulls last, s.set_key), '[]'::jsonb)
            from (select k.set_key, count(*) as cards from public.nexamon_cards k where k.in_catalogue group by k.set_key) s),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'card_key', x.card_key, 'set', x.set_key, 'number', x.number, 'rarity', x.rarity, 'copies', x.copies,
                   'serial', x.serial, 'condition', x.condition, 'grade', x.grade, 'value_cents', x.value_cents,
                   'total_cents', x.total_cents)
                   order by x.value_cents desc, x.set_key, x.number), '[]'::jsonb)
            from (select p.* from per_card p order by p.value_cents desc, p.set_key, p.number limit v_limit) x)
    into v_summary, v_sets, v_cards;

  return jsonb_build_object(
    'nickname', v_nick, 'is_me', v_target = v_player, 'unlocked', v_unlocked,
    'summary', v_summary, 'sets', v_sets, 'cards', v_cards, 'server_time', public.game_now());
end;
$$;
comment on function public.get_player_nexamon(text, integer) is
  'RPC: the Nexamon collection of a player by nickname (null = the caller) for their profile (ADR-165): '
  '{nickname, is_me, unlocked, summary: {copies, distinct, total, value_cents, graded, tens}, sets: [{key, cards, '
  'distinct, copies}], cards: [{card_key, set, number, rarity, copies, serial, condition, grade, value_cents, '
  'total_cents}] (best copy per card, most valuable first, at most p_limit, 1..500), server_time}. Empty for a '
  'player below the Nexamon level; error player_not_found.';

revoke all on function public.get_player_nexamon(text, integer) from public, anon;
grant execute on function public.get_player_nexamon(text, integer) to authenticated, service_role;
