-- =============================================================================
-- 57 · M2 names: filter (profanity, extremism, reserved), nickname changes
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set n '''0d1d1d1d-0000-4000-8000-00000000001d'''

select tests.assert(true, 'blocklist: ' || sum(n) || ' terms (' ||
  string_agg(category || ' ' || n, ', ' order by category) || ')')
  from (select category, count(*) as n from public.blocked_name_terms group by category) x;

-- false-positive traps: must stay allowed
select tests.assert(
  (select bool_and(public.name_violation(x, 'player') is null)
     from unnest(array['Klassenbester', 'Matthias', 'Analyst', 'Hans_Peter', 'Bastian', 'Dickmann', 'Schwanstein',
                       'Pussycat', 'Scunthorpe', 'Grapefruit', 'Barsch', 'Mongolei', 'Bassist', 'Lokfuehrer', 'Shitake_Fan',
                       'Max1988', 'Sexy_Sarah', 'Essex', 'Hitchcock', 'Janus', 'Arsenal', 'Spasskasse', 'Assessor',
                       'Konstantin', 'Therapeut', 'Kassandra', 'Wolfgang_2', 'Anne_Marie', 'Bankier', 'Systemiker']) x),
  'false-positive traps stay allowed (Klassenbester, Matthias, Analyst, Hans_Peter, Bastian, Dickmann, Schwanstein, Pussycat, Scunthorpe, ...)');
select tests.assert(true, 'not allowed by design: ' || string_agg(x || ' (' || public.name_violation(x, 'player') || ')', ', '))
  from unnest(array['Nazim', 'Lisa88', 'Finn_Mueller']) x;

-- true positives incl. leetspeak, separators, repetitions, codes
select tests.assert(
  (select bool_and(public.name_violation(x, 'player') = 'name_profanity')
     from unnest(array['Fuck', 'F_u_c_k', 'Fuuuuuck', 'fu_ck_you', 'H1tl3r', 'Adolf_Hitler', 'N4zi', 'Hurens0hn', 'Arschloch',
                       'Wichser123', 'Sh1thead', 'Pussy_Destroyer', 'Lisa88', 'Max_HH', 'Kanake', 'S_c_h_e_i_s_s_e',
                       'SiegHeil', 'Ficker', 'Hakenkreuz', 'n1gg3r', 'Schwuchtel', 'Combat18', 'Kinderporno', 'ArschLoch_77']) x),
  'profanity, slurs, sexual and extremist names are blocked, also with leetspeak, separators, repetitions and codes');
select tests.assert(
  (select bool_and(public.name_violation(x, 'player') = 'name_reserved')
     from unnest(array['Admin', 'Admin123', '4dm1n', 'Support', 'Finn', 'KlarSoft', 'KLS', 'Moderator', 'Staatskasse',
                       'Zentralbank', 'NEXA', 'NEXA30', 'NXB01', 'Null', 'deleted']) x)
  and public.name_violation(replace((select name from public.rich_tycoons order by seed_rank limit 1), ' ', ''), 'player') = 'name_reserved'
  and public.name_violation(replace(replace((select name from public.rich_tycoons order by seed_rank limit 1), ' ', '_'), 'Dr.', ''), 'player') = 'name_reserved',
  'reserved: staff/system words, Finn, NEXA, company names and tickers, every AI tycoon name');
select tests.assert(
  public.name_violation('ab', 'player') = 'name_too_short'
  and public.name_violation(repeat('x', 21), 'player') = 'name_too_long'
  and public.name_violation('Anna Maria', 'player') = 'name_invalid_chars'
  and public.name_violation('Anna!', 'player') = 'name_invalid_chars'
  and public.name_violation('anna', 'player') = 'name_taken',
  'length, characters and taken names (case-insensitive)');
select tests.assert(
  public.name_violation('Klar & Co. Software', 'company') is null
  and public.name_violation('Müller''s Bäckerei-Werk', 'company') is null
  and public.name_violation('KlarSoft AG', 'company') = 'name_reserved'
  and public.name_violation('Fuck GmbH', 'company') = 'name_profanity'
  and public.name_violation('Ab', 'company') = 'name_too_short'
  and public.name_violation('Firma_1', 'company') = 'name_invalid_chars',
  'company names: letters incl. umlauts, digits, space - & . '' (3-30 chars), same filter');

-- registration -------------------------------------------------------------------------
select tests.throws($$insert into auth.users (email, raw_user_meta_data)
  values ('h88@m1.test', '{"invite_code": "M1-TESTS", "age_confirmed": true, "nickname": "Hitler88"}')$$, 'NX019', 'sign-up with a forbidden nickname is rejected');
select tests.throws_key($$insert into auth.users (email, raw_user_meta_data)
  values ('adm@m1.test', '{"invite_code": "M1-TESTS", "age_confirmed": true, "nickname": "Admin"}')$$, 'name_reserved', 'sign-up as Admin is rejected');
select tests.signup(:n, 'Nora_Neu') is not null as ok \gset

select tests.login_as('anon');
select tests.assert(
  public.check_nickname('Nora_Neu') = '{"allowed": false, "reason": "name_taken"}'::jsonb
  and public.check_nickname('F1ck3r') = '{"allowed": false, "reason": "name_profanity"}'::jsonb
  and public.check_nickname('Wunderbar_7') = '{"allowed": true, "reason": null}'::jsonb,
  'check_nickname(): {allowed, reason} for the registration form');
reset role;

-- nickname changes ------------------------------------------------------------------------
select gen_random_uuid() as rq \gset
select tests.login_as('authenticated', :n);
select public.get_my_portfolio() as p0 \gset
select tests.assert((public.check_nickname('Nora_Neu') ->> 'allowed')::boolean, 'check_nickname(): the own name is not "taken"');
select public.change_nickname(:'rq', 'Nora_Nova') as ch1 \gset
select public.change_nickname(:'rq', 'Nora_Nova') as ch1b \gset
select tests.throws_key($$select public.change_nickname(gen_random_uuid(), 'Nora_Noch')$$, 'name_change_too_soon', 'second change within 60 days');
select public.get_my_portfolio() as p1 \gset
reset role;
select tests.assert(
  :'p0'::jsonb ->> 'nickname' = 'Nora_Neu' and (:'p0'::jsonb ->> 'nickname_change_available_at') is null
  and :'ch1'::jsonb ->> 'nickname' = 'Nora_Nova' and :'ch1b'::jsonb = :'ch1'::jsonb
  and (:'ch1'::jsonb ->> 'next_change_at')::timestamptz - (:'ch1'::jsonb ->> 'changed_at')::timestamptz = interval '60 days'
  and :'p1'::jsonb ->> 'nickname' = 'Nora_Nova'
  and (:'p1'::jsonb ->> 'nickname_change_available_at')::timestamptz = (:'ch1'::jsonb ->> 'next_change_at')::timestamptz,
  'change_nickname(): first change at any time, next one after 60 days; idempotent; portfolio shows name and next date');
update public.profiles set nickname_changed_at = now() - interval '61 days' where id = :n;
select tests.login_as('authenticated', :n);
select tests.throws_key($$select public.change_nickname(gen_random_uuid(), 'Ben')$$, 'name_taken', 'change to a taken name');
select tests.throws_key($$select public.change_nickname(gen_random_uuid(), 'W1chs3r')$$, 'name_profanity', 'change to a forbidden name');
select tests.throws_key($$select public.change_nickname(gen_random_uuid(), 'Support')$$, 'name_reserved', 'change to a reserved name');
select tests.assert((public.change_nickname(gen_random_uuid(), 'Nora_Zwei') ->> 'nickname') = 'Nora_Zwei', 'after 60 days the name can change again');
reset role;
