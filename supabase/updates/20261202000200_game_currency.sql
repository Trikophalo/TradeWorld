-- ===== idempotent copy of migrations/20261202000200_game_currency.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0200 · The game's own currency: Nex (NX) instead of euro (ADR-110)
-- =============================================================================
-- Amounts stay bigint hundredths (`*_cents`). Only the texts the server writes change: the three money text helpers
-- and the crypto event texts say "NX"; texts already stored (unlocks, achievements, mission templates, news,
-- notifications, company chat) are rewritten once; the stablecoin "Euro-Stabil" becomes "Eins-Stabil".
-- Idempotent: runs unchanged as supabase/updates/20261202000200_game_currency.sql.

-- German short money text for news: "420,0 Mio. NX", "1,96 Mrd. NX", "400 Tsd. NX" (name kept for its callers).
create or replace function public.format_eur_short(p_cents bigint)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_abs  numeric := abs(coalesce(p_cents, 0));
  v_sign text := case when coalesce(p_cents, 0) < 0 then '-' else '' end;
begin
  if v_abs >= 100000000000 then
    return v_sign || replace(to_char(v_abs / 100000000000, 'FM999990.00'), '.', ',') || ' Mrd. NX';
  elsif v_abs >= 100000000 then
    return v_sign || replace(to_char(v_abs / 100000000, 'FM999990.0'), '.', ',') || ' Mio. NX';
  elsif v_abs >= 100000 then
    return v_sign || to_char(round(v_abs / 100000), 'FM999990') || ' Tsd. NX';
  end if;
  return v_sign || to_char(round(v_abs / 100), 'FM999990') || ' NX';
end;
$$;

-- German money text for system messages: "1.234 NX", "-56 NX" (name kept for its callers).
create or replace function public.format_eur(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_cents < 0 then '-' else '' end
      || reverse(regexp_replace(reverse(round(abs(p_cents) / 100.0)::bigint::text), '(\d{3})(?=\d)', '\1.', 'g'))
      || ' NX';
$$;

-- "{target}" in titles and descriptions: Nex for money metrics ("2.000 NX"), else the number.
create or replace function public.mission_text(p_text text, p_metric text, p_target bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(p_text, '{target}',
           case when public.mission_is_money_metric(p_metric)
                then replace(to_char(p_target / 100, 'FM999G999G999G990'), ',', '.') || ' NX'
                else p_target::text end);
$$;

-- Crypto event texts (as in M5a): the peg is 1 NX.
create or replace function public.crypto_event_text(p_key text, p_name text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'hack' then jsonb_build_object('title', 'Hack bei ' || n, 'body', 'Angreifer haben Geld aus dem Pool gestohlen. Der Kurs bricht ein.')
    when 'bug' then jsonb_build_object('title', 'Bug bei ' || n, 'body', 'Ein Fehler im Smart Contract verunsichert die Halter.')
    when 'influencer' then jsonb_build_object('title', 'Influencer feiert ' || n, 'body', 'Ein bekannter Influencer schwärmt von der Währung. Der Kurs springt.')
    when 'exchange_listing' then jsonb_build_object('title', n || ' an einer Börse gelistet', 'body', 'Eine große Krypto-Börse nimmt die Währung auf.')
    when 'delisting_rumor' then jsonb_build_object('title', 'Delisting-Gerücht um ' || n, 'body', 'Es heißt, eine Börse wolle die Währung streichen.')
    when 'whale_buy' then jsonb_build_object('title', 'Wal kauft ' || n, 'body', 'Ein Großanleger kauft in großem Stil.')
    when 'whale_dump' then jsonb_build_object('title', 'Wal verkauft ' || n, 'body', 'Ein Großanleger wirft seine Coins auf den Markt.')
    when 'partnership' then jsonb_build_object('title', 'Partnerschaft für ' || n, 'body', 'Ein Unternehmen will die Währung nutzen.')
    when 'fud' then jsonb_build_object('title', 'Angstmache um ' || n, 'body', 'Gerüchte und Panik drücken den Kurs.')
    when 'network_upgrade' then jsonb_build_object('title', 'Netzwerk-Upgrade bei ' || n, 'body', 'Das Netzwerk wird schneller und günstiger.')
    when 'depeg' then jsonb_build_object('title', n || ' verliert die Bindung', 'body', 'Der Stablecoin ist nicht mehr 1 NX wert.')
    when 'meme_wave' then jsonb_build_object('title', 'Meme-Welle', 'body', 'Shitcoins sind plötzlich überall gefragt.')
    when 'regulation' then jsonb_build_object('title', 'Regulierung trifft ' || n, 'body', 'Neue Regeln für Kryptowährungen drücken den ganzen Markt.')
    when 'rug_pull' then jsonb_build_object('title', 'Rug Pull bei ' || n, 'body', 'Die Macher haben in großem Stil Coins verkauft. Der Kurs stürzt ab.')
    when 'exposed' then jsonb_build_object('title', 'Werbedeal von ' || n || ' aufgeflogen', 'body', 'Die bezahlte Influencer-Werbung ist aufgeflogen: Der Hype ist weg, der Kurs fällt.')
    when 'dead' then jsonb_build_object('title', n || ' ist tot', 'body', 'Der Kurs ist fast null. In einem Tag wird die Währung gestrichen.')
    when 'delisted' then jsonb_build_object('title', n || ' gestrichen', 'body', 'Die Währung ist vom Markt verschwunden.')
    when 'closed' then jsonb_build_object('title', n || ' eingestellt', 'body', 'Der Pool wurde nach Coins an alle Halter ausgezahlt.')
    else jsonb_build_object('title', 'Neuigkeit zu ' || n, 'body', 'Bei der Währung hat sich etwas getan.')
  end
  from (select coalesce(p_name, 'einer Kryptowährung') as n) x;
$$;

-- Texts stored before the change (seed texts, news, notifications, chat, reports): every text column of the public
-- tables. The ledger is append-only and keeps its wording; profiles are the players' own words.
do $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.data_type in ('text', 'character varying') and c.is_generated = 'NEVER'
       and c.table_name not like 'ledger%' and c.table_name not in ('profiles', 'game_config')
     order by c.table_name, c.column_name
  loop
    begin
      execute format('update public.%I set %I = replace(%I, %L, %L) where %I like %L',
                     r.table_name, r.column_name, r.column_name, '€', 'NX', r.column_name, '%€%');
    exception when others then
      -- a table that guards its rows keeps its old wording
      null;
    end;
  end loop;
end;
$$;

-- The stablecoin pegged to 1 NX is no "euro" any more. The ticker EUS stays.
do $$
begin
  if to_regclass('public.crypto_coins') is not null then
    update public.crypto_coins set name = 'Eins-Stabil' where ticker = 'EUS' and name = 'Euro-Stabil';
  end if;
  update public.securities set name = 'Eins-Stabil' where ticker = 'EUS' and name = 'Euro-Stabil';
end;
$$;
