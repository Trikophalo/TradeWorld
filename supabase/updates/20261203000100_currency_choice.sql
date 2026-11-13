-- ===== idempotent copy of migrations/20261203000100_currency_choice.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 0100 · Euro is the default currency again; dollar and NX are a display choice (ADR-113)
-- =============================================================================
-- ADR-110 renamed the currency to NX everywhere. The owner decided otherwise: the game shows euros by default, and
-- every player may pick dollar or NX as the sign behind amounts. That choice lives in the client (a display
-- setting); the server writes one neutral form, the euro sign, and the client swaps it for the chosen sign.
-- So this migration takes the server texts back: the money text helpers and the crypto event texts say "€", and
-- amounts stored as "... NX" become "... €" again. The stablecoin keeps its neutral name "Eins-Stabil".
-- Idempotent: runs unchanged as supabase/updates/20261203000100_currency_choice.sql.

-- German short money text for news: "420,0 Mio. €", "1,96 Mrd. €", "400 Tsd. €".
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
    return v_sign || replace(to_char(v_abs / 100000000000, 'FM999990.00'), '.', ',') || ' Mrd. €';
  elsif v_abs >= 100000000 then
    return v_sign || replace(to_char(v_abs / 100000000, 'FM999990.0'), '.', ',') || ' Mio. €';
  elsif v_abs >= 100000 then
    return v_sign || to_char(round(v_abs / 100000), 'FM999990') || ' Tsd. €';
  end if;
  return v_sign || to_char(round(v_abs / 100), 'FM999990') || ' €';
end;
$$;

-- German money text for system messages: "1.234 €", "-56 €".
create or replace function public.format_eur(p_cents bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_cents < 0 then '-' else '' end
      || reverse(regexp_replace(reverse(round(abs(p_cents) / 100.0)::bigint::text), '(\d{3})(?=\d)', '\1.', 'g'))
      || ' €';
$$;

-- "{target}" in titles and descriptions: euros for money metrics ("2.000 €"), else the number.
create or replace function public.mission_text(p_text text, p_metric text, p_target bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(p_text, '{target}',
           case when public.mission_is_money_metric(p_metric)
                then replace(to_char(p_target / 100, 'FM999G999G999G990'), ',', '.') || ' €'
                else p_target::text end);
$$;

-- Crypto event texts (as in M5a).
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
    when 'depeg' then jsonb_build_object('title', n || ' verliert die Bindung', 'body', 'Der Stablecoin ist nicht mehr 1 € wert.')
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

-- Amounts written as "5.000 NX", "1,2 Mio. NX" or "1 NX" while ADR-110 was in force: back to the euro sign. Only a
-- number (or Tsd./Mio./Mrd.) followed by NX as a whole word is touched. The ledger and the profiles were never
-- rewritten and stay as they are.
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
      execute format(
        'update public.%I set %I = regexp_replace(%I, %L, %L, %L) where %I ~ %L',
        r.table_name, r.column_name, r.column_name,
        '([0-9]|Tsd\.|Mio\.|Mrd\.) NX\M', '\1 €', 'g',
        r.column_name, '([0-9]|Tsd\.|Mio\.|Mrd\.) NX\M');
    exception when others then
      -- a table that guards its rows keeps its wording
      null;
    end;
  end loop;
end;
$$;
