-- ===== idempotent copy of migrations/20261204006500_nexamon_cosmic_schema.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- =============================================================================
-- NEXA · 6500 · Nexamon: Cosmic Winds and the One of One rarity, schema (ADR-174)
-- =============================================================================
-- * nexamon_cards.rarity takes any rarity a set declares (src/config/nexamon/types.ts; 'one_of_one' and, later, a
--   set's own rarities); a One of One never has a population above 1.
-- * nexamon_one_of_ones: the registry of pulled One of Ones, one row per card (primary key), written in the same
--   transaction as the copy. Two pulls of the same card can never both commit.
-- * Trigger nexamon_copies_ai_guard: a copy of a rarity in ai.excludedRarities never gets an AI owner (pulls,
--   seeds, AI purchases), whatever path tries it.
-- * Error keys: nexamon_one_of_one_taken NX270, nexamon_ai_excluded NX271. Notification type nexamon_one_of_one
--   (everyone hears of a One of One pull).
-- The catalogue (321 cards with Cosmic Winds) and the rules come from game_config (`pnpm db:config`); nexamon_sync()
-- mirrors the new set on its next run.
-- Idempotent: runs unchanged as supabase/updates/20261204006500_nexamon_cosmic_schema.sql.

do $do$
declare
  v_def text := pg_get_functiondef('public.api_error(text)'::regprocedure);
  v_old text := $q$    when 'chat_already_member'        then 'NX162'
$q$;
begin
  if position('''nexamon_ai_excluded''' in v_def) = 0 then
    if position(v_old in v_def) = 0 then
      raise exception 'api_error() has an unexpected shape; add the error keys nexamon_one_of_one_taken/nexamon_ai_excluded (ADR-174) by hand';
    end if;
    execute replace(v_def, v_old, v_old || $q$    when 'nexamon_one_of_one_taken'   then 'NX270'
    when 'nexamon_ai_excluded'        then 'NX271'
$q$);
  end if;
end;
$do$;

insert into public.notification_types (key, category, title, description, icon_key, default_in_app, default_push, is_mandatory,
                                       sort_order)
values ('nexamon_one_of_one', 'social', 'One of One gezogen', 'Jemand hat eine Nexamon-Karte gezogen, die es nur einmal gibt.',
        'notif_bell', true, false, false, 302)
on conflict (key) do nothing;

do $do$
declare
  v_name text;
begin
  select c.conname into v_name
    from pg_constraint c
   where c.conrelid = 'public.nexamon_cards'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%rarity%' and pg_get_constraintdef(c.oid) not like '%one_of_one%';
  if v_name is not null then
    execute format('alter table public.nexamon_cards drop constraint %I', v_name);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'nexamon_cards_rarity_check2') then
    alter table public.nexamon_cards add constraint nexamon_cards_rarity_check2
      check (char_length(rarity) between 1 and 32);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'nexamon_cards_one_of_one_check') then
    alter table public.nexamon_cards add constraint nexamon_cards_one_of_one_check
      check (rarity <> 'one_of_one' or population <= 1);
  end if;
end;
$do$;

create table if not exists public.nexamon_one_of_ones (
  card_key  text primary key references public.nexamon_cards (card_key),
  copy_id   uuid not null unique references public.nexamon_copies (id),
  player_id uuid references public.profiles (id) on delete set null,
  pack_id   uuid,
  pulled_at timestamptz not null default now()
);
create index if not exists nexamon_one_of_ones_player_idx on public.nexamon_one_of_ones (player_id);
alter table public.nexamon_one_of_ones enable row level security;
revoke all on public.nexamon_one_of_ones from public, anon, authenticated;
grant all on public.nexamon_one_of_ones to service_role;
comment on table public.nexamon_one_of_ones is
  'Pulled Nexamon One of Ones (ADR-174): one row per card, ever. The primary key makes a second pull impossible; '
  'player_id is who pulled it (the copy may have changed hands since). Internal (nexamon_open_pack, get_nexamon).';

-- The AI never owns a card of ai.excludedRarities (One of Ones trade only between players).
create or replace function public.nexamon_copies_ai_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ai_owner is not null
     and coalesce(public.nexamon_cfg() #> '{ai,excludedRarities}', '["one_of_one"]'::jsonb)
         ? (select k.rarity from public.nexamon_cards k where k.card_key = new.card_key) then
    perform public.api_error('nexamon_ai_excluded');
  end if;
  return new;
end;
$$;
drop trigger if exists nexamon_copies_ai_guard on public.nexamon_copies;
create trigger nexamon_copies_ai_guard before insert or update of ai_owner on public.nexamon_copies
  for each row execute function public.nexamon_copies_ai_guard();
