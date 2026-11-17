-- =============================================================================
-- NEXA · 7900 · Nexamon: a big pull is news for everyone (ADR-190)
-- =============================================================================
-- * Trigger nexamon_big_pull_notify on nexamon_copies (AFTER INSERT): a copy a player pulls from a pack (source
--   'pack' with a pack id: bought, multi-buy, sealed, Pack Battle; never the AI) worth more than
--   nexamon.bigPullNotifyCents at pull time (copy value incl. condition) tells every other active player
--   (notification nexamon_big_pull, link to the card page) and posts the feed item nexamon_big_pull.
-- * One of Ones are skipped (they already notify everyone), so are sets not released at pull time; rarities in
--   feedRarities get no second feed item (nexamon_pull covers them).
-- * At most one broadcast per puller every nexamon.bigPullNotifySeconds (nexamon_big_pull_broadcasts). Several
--   big pulls in one transaction (one opening or multi-buy) update that one notification: count and best card.
-- Idempotent: runs unchanged as supabase/updates/20261204007900_nexamon_big_pull_notify.sql.

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('nexamon_big_pull', 'social', 'Großer Nexamon-Zug', 'Jemand hat eine Nexamon-Karte mit sehr hohem Wert gezogen.',
        'notif_bell', true, false, false, 303)
on conflict (key) do nothing;

create table if not exists public.nexamon_big_pull_broadcasts (
  player_id    uuid primary key references public.profiles (id) on delete cascade,
  tx_id        bigint not null,
  broadcast_at timestamptz not null,
  dedupe_key   text not null,
  cards        jsonb not null default '[]'::jsonb
);
comment on table public.nexamon_big_pull_broadcasts is
  'Last big-pull broadcast per puller (rate limit and combining one opening into one notification; ADR-190).';
alter table public.nexamon_big_pull_broadcasts enable row level security;
revoke all on public.nexamon_big_pull_broadcasts from public, anon, authenticated;
grant all on public.nexamon_big_pull_broadcasts to service_role;

create or replace function public.nexamon_big_pull_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.nexamon_cfg();
  k        public.nexamon_cards;
  b        public.nexamon_big_pull_broadcasts;
  v_min    bigint := coalesce((cfg ->> 'bigPullNotifyCents')::bigint, 10000000);
  v_secs   integer := coalesce((cfg ->> 'bigPullNotifySeconds')::integer, 60);
  v_value  bigint;
  v_tx     bigint := txid_current();
  v_same   boolean;
  v_name   text;
  v_nick   text;
  v_cards  jsonb;
  v_best   jsonb;
  v_n      integer;
  v_body   text;
  v_key    text;
  r        record;
begin
  if new.owner_id is null or new.ai_owner is not null or new.source <> 'pack' or new.pack_id is null then
    return null;
  end if;
  select * into k from public.nexamon_cards c where c.card_key = new.card_key;
  if k.card_key is null or k.rarity = 'one_of_one' or not public.nexamon_set_released(k.set_key, new.created_at) then
    return null;
  end if;
  v_value := public.nexamon_copy_value_cents(k.value_e4, new.condition, null);
  if v_value <= v_min then
    return null;
  end if;
  v_name := coalesce((select g.value ->> k.card_key from public.game_config g where g.key = 'nexamon_names'), k.card_key);
  select p.nickname into v_nick from public.profiles p where p.id = new.owner_id;
  if not coalesce(cfg -> 'feedRarities', '[]'::jsonb) ? k.rarity then
    perform public.feed_post(new.owner_id, 'nexamon_big_pull',
                             jsonb_build_object('card_key', k.card_key, 'set', k.set_key, 'rarity', k.rarity, 'name', v_name,
                                                'serial', new.serial, 'condition', new.condition, 'value_cents', v_value),
                             'nexamon:bigpull:' || new.id::text);
  end if;

  select * into b from public.nexamon_big_pull_broadcasts x where x.player_id = new.owner_id for update;
  v_same := b.player_id is not null and b.tx_id = v_tx;
  v_cards := jsonb_build_array(jsonb_build_object('card_key', k.card_key, 'name', v_name, 'value_cents', v_value));
  if v_same then
    v_cards := b.cards || v_cards;
  elsif b.player_id is not null and new.created_at < b.broadcast_at + make_interval(secs => v_secs) then
    return null;
  end if;
  select c into v_best from jsonb_array_elements(v_cards) c order by (c ->> 'value_cents')::bigint desc limit 1;
  v_n := jsonb_array_length(v_cards);
  v_body := coalesce(v_nick, '?') || ' hat '
            || case when v_n = 1 then (v_best ->> 'name')
                    else v_n || ' Karten über ' || public.format_eur(v_min) || ' gezogen, darunter ' || (v_best ->> 'name') end
            || case when v_n = 1 then ' gezogen' else '' end
            || ' – Wert ' || public.format_eur((v_best ->> 'value_cents')::bigint) || '!';

  if v_same then
    update public.nexamon_big_pull_broadcasts set cards = v_cards where player_id = new.owner_id;
    update public.notifications n
       set body = left(v_body, 500), link = '/nexamon/' || (v_best ->> 'card_key'),
           payload = jsonb_build_object('card_key', v_best ->> 'card_key', 'nickname', v_nick,
                                        'value_cents', (v_best ->> 'value_cents')::bigint, 'count', v_n)
     where n.type_key = 'nexamon_big_pull' and n.dedupe_key = b.dedupe_key;
    return null;
  end if;

  v_key := 'nexamon:bigpull:' || new.owner_id::text || ':' || v_tx::text;
  insert into public.nexamon_big_pull_broadcasts (player_id, tx_id, broadcast_at, dedupe_key, cards)
  values (new.owner_id, v_tx, new.created_at, v_key, v_cards)
  on conflict (player_id) do update
    set tx_id = excluded.tx_id, broadcast_at = excluded.broadcast_at, dedupe_key = excluded.dedupe_key,
        cards = excluded.cards;
  for r in select p.id from public.profiles p where not p.is_deactivated and p.id <> new.owner_id loop
    perform public.social_notify(r.id, 'nexamon_big_pull', 'Großer Zug!', v_body,
      jsonb_build_object('card_key', k.card_key, 'nickname', v_nick, 'value_cents', v_value, 'count', 1),
      '/nexamon/' || k.card_key, v_key);
  end loop;
  return null;
end;
$$;
comment on function public.nexamon_big_pull_notify() is
  'Trigger: a player''s pack pull above nexamon.bigPullNotifyCents notifies every other active player (ADR-190).';
revoke all on function public.nexamon_big_pull_notify() from public, anon, authenticated;

drop trigger if exists nexamon_big_pull_notify on public.nexamon_copies;
create trigger nexamon_big_pull_notify
  after insert on public.nexamon_copies
  for each row execute function public.nexamon_big_pull_notify();
