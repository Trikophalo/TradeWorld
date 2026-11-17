-- ===== idempotent copy of migrations/20261204006520_nexamon_one_of_one_views.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 6520 · Nexamon: One of Ones in the overview, collections, the feed and the news (ADR-174)
-- =============================================================================
-- * get_nexamon(): 'one_of_ones' lists every One of One of the catalogue with who pulled it (null: still out there).
-- * nexamon_bonus_recompute(): cards of bonuses.sets.excludeRarities count for no collection ("type", "complete",
--   "master"); nobody can be asked to own a card that exists once. The card bonus of a One of One stays.
-- * feed_item_label(): the kind nexamon_one_of_one; news_show_build(): it joins the gossip sources.
-- Replace-patches with a clear error if an anchor is missing.
-- Idempotent: runs unchanged as supabase/updates/20261204006520_nexamon_one_of_one_views.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.get_nexamon()'::regprocedure);
  v_old text := $t$    'server_time', v_now);$t$;
  v_new text := $t$    'server_time', v_now,
    'one_of_ones', (select coalesce(jsonb_agg(jsonb_build_object(
                      'card_key', k.card_key, 'set', k.set_key, 'pulled', x.card_key is not null,
                      'pulled_by', (select p.nickname from public.profiles p where p.id = x.player_id),
                      'pulled_at', x.pulled_at) order by k.set_key, k.number), '[]'::jsonb)
                      from public.nexamon_cards k
                      left join public.nexamon_one_of_ones x on x.card_key = k.card_key
                     where k.rarity = 'one_of_one' and k.in_catalogue));$t$;
begin
  if position('one_of_ones' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'get_nexamon() has an unexpected shape; add one_of_ones (ADR-174) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def  text := pg_get_functiondef('public.nexamon_bonus_recompute(uuid)'::regprocedure);
  v_old1 text := $t$from pg_temp.nx_bonus_own o where o.type is not null group by o.set_key, o.type$t$;
  v_new1 text := $t$from pg_temp.nx_bonus_own o
     where o.type is not null and not coalesce(b #> '{sets,excludeRarities}', '[]'::jsonb) ? o.rarity
     group by o.set_key, o.type$t$;
  v_old2 text := $t$      from pg_temp.nx_bonus_own o group by o.set_key$t$;
  v_new2 text := $t$      from pg_temp.nx_bonus_own o
     where not coalesce(b #> '{sets,excludeRarities}', '[]'::jsonb) ? o.rarity
     group by o.set_key$t$;
begin
  if position('excludeRarities' in v_def) = 0 then
    if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
      raise exception 'nexamon_bonus_recompute() has an unexpected shape; leave One of Ones out of the collections (ADR-174) by hand';
    end if;
    execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.feed_item_label(text, jsonb)'::regprocedure);
  v_old text := $t$    when 'nexamon_pull' then$t$;
  v_new text := $t$    when 'nexamon_one_of_one' then 'ONE OF ONE gezogen: ' || coalesce(p_payload ->> 'name', 'eine Nexamon-Karte')
      || ', die es nur ein einziges Mal gibt'
    when 'nexamon_pull' then$t$;
begin
  if position('nexamon_one_of_one' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'feed_item_label() has an unexpected shape; add the feed kind nexamon_one_of_one (ADR-174) by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;

do $do$
declare
  v_def text := pg_get_functiondef('public.news_show_build(timestamptz)'::regprocedure);
  v_old text := $t$'nexamon_pull',$t$;
  v_new text := $t$'nexamon_pull', 'nexamon_one_of_one',$t$;
begin
  if position('nexamon_one_of_one' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'news_show_build() has an unexpected shape; add the feed kind nexamon_one_of_one (ADR-174) to the gossip source by hand';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;
end;
$do$;
