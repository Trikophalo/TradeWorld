-- =============================================================================
-- 69 · M3j: company banner (ADR-078), forbidden symbols on width × height grids
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set f '''06960696-0000-4000-8000-0000000000f1'''
\set e '''06960696-0000-4000-8000-0000000000e2'''
\set o '''06960696-0000-4000-8000-0000000000a3'''
select tests.signup(:f, 'Bea_Banner') is not null and tests.signup(:e, 'Emil_Fahne') is not null
   and tests.signup(:o, 'Olga_Wimpel') is not null as ok \gset
select tests.set_level(:f, 4);
select tests.set_level(:e, 3);
select tests.fund(:f, 1000000, 'test:m3j:f');

select tests.login_as('authenticated', :f);
select public.found_company(gen_random_uuid(), 'Banner Werk', 'Fahnen für Vereine', 'tech', '#336699', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:f) as fco \gset
select tests.hire(:f, :e, 15000) is not null as ok \gset

-- grids: an empty 48 × 12 banner, a frame, the hooked cross and a plus
create or replace function tests.banner(p_pattern text[] default '{}', p_scale integer default 1, p_ox integer default 0,
                                        p_oy integer default 0, p_char text default '0') returns jsonb language sql as $$
  select case when cardinality(p_pattern) = 0 then to_jsonb(array_fill(repeat('.', 48), array[12]))
              else tests.draw(p_pattern, p_scale, p_ox, p_oy, p_char, array_fill(repeat('.', 48), array[12])) end $$;
grant execute on all functions in schema tests to public;
\set cross '''{x.xxx,x.x..,xxxxx,..x.x,xxx.x}'''
\set plus '''{..x..,..x..,xxxxx,..x..,..x..}'''
select (select to_jsonb(array_agg(case when y in (0, 11) then repeat('0', 48) else '0' || repeat('1', 46) || '0' end order by y))
          from generate_series(0, 11) y) as frame \gset
select jsonb_build_object('palette', '["#112233", "#ffcc00"]'::jsonb, 'grid', :'frame'::jsonb) as b1 \gset
select jsonb_build_object('palette', '["#445566"]'::jsonb, 'grid', tests.banner(:plus, 2, 30, 1)) as b2 \gset

-- =============================================================================
-- A. Forbidden symbols on any width × height
-- =============================================================================
select tests.assert(
  public.logo_has_forbidden_symbol(tests.banner(:cross, 1, 42, 6))
  and public.logo_has_forbidden_symbol(tests.banner(:cross, 2, 30, 1))
  and public.logo_has_forbidden_symbol(tests.banner(array(select reverse(r) from unnest(:cross::text[]) with ordinality u(r, o) order by o), 2, 37, 2))
  and public.logo_has_forbidden_symbol(tests.banner('{x..xxxx,x..x...,x..x...,xxxxxxx,...x..x,...x..x,xxxx..x}', 1, 40, 5, '1')),
  'logo_has_forbidden_symbol(): finds the symbol anywhere in a 48 x 12 banner (beyond column 16, mirrored, scaled, per colour)');
select tests.assert(
  not public.logo_has_forbidden_symbol(tests.banner())
  and not public.logo_has_forbidden_symbol(:'frame'::jsonb)
  and not public.logo_has_forbidden_symbol(tests.banner(:plus, 2, 30, 1))
  and not public.logo_has_forbidden_symbol(to_jsonb(array_fill(repeat('0', 48), array[12])))
  and not public.logo_has_forbidden_symbol(tests.banner('{xxx.x.x,x...x.x,xx...x.,x...x.x,xxx.x.x}', 2, 20, 1)),
  'logo_has_forbidden_symbol(): an empty banner, a frame, a plus, a full banner and letters pass');
-- scale 3 needs 15 rows: does not fit in 12 rows, so only the cut-off top of a 3x cross is drawn
select tests.assert(
  not public.logo_has_forbidden_symbol((select to_jsonb(array_agg(r order by o))
                                          from jsonb_array_elements_text(tests.draw(:cross, 3, 0, 0, '0', array_fill(repeat('.', 48), array[15])))
                                               with ordinality a(r, o) where o <= 12)),
  'logo_has_forbidden_symbol(): scales only while the template fits in both dimensions');
select tests.assert(
  public.logo_has_forbidden_symbol(tests.draw(:cross, 1, 3, 4))
  and public.logo_has_forbidden_symbol(tests.draw(:cross, 3, 0, 0))
  and not public.logo_has_forbidden_symbol(tests.draw(:plus, 3, 0, 0))
  and not public.logo_has_forbidden_symbol(to_jsonb(array_fill(repeat('0', 16), array[16]))),
  'logo_has_forbidden_symbol(): 16 x 16 logos are checked as before');

-- =============================================================================
-- B. banner_valid (isValidBanner)
-- =============================================================================
select tests.assert(
  public.banner_valid(:'b1') and public.banner_valid(:'b2')
  and public.banner_valid(jsonb_build_object('palette', '["#000000"]'::jsonb, 'grid', tests.banner())),
  'banner_valid(): 48 x 12 with 1..6 colours, an empty banner is allowed');
select tests.assert(
  not public.banner_valid(jsonb_set(:'b1', '{grid}', (:'b1'::jsonb -> 'grid') - 11))
  and not public.banner_valid(jsonb_set(:'b1', '{grid}', (:'b1'::jsonb -> 'grid') || '["000000000000000000000000000000000000000000000000"]'))
  and not public.banner_valid(jsonb_set(:'b1', '{grid,3}', to_jsonb(repeat('0', 47))))
  and not public.banner_valid(jsonb_set(:'b1', '{grid,3}', to_jsonb(repeat('0', 49))))
  and not public.banner_valid(jsonb_set(:'b1', '{grid,3}', to_jsonb(repeat('2', 48))))
  and not public.banner_valid(jsonb_set(:'b1', '{palette,0}', '"#AABBCC"'))
  and not public.banner_valid(jsonb_set(:'b1', '{palette}', '["#000000", "#111111", "#222222", "#333333", "#444444", "#555555", "#666666"]'))
  and not public.banner_valid(jsonb_set(:'b1', '{palette}', '[]'))
  and not public.banner_valid(jsonb_build_object('palette', '["#112233"]'::jsonb, 'grid', tests.draw(:plus, 1, 0, 0)))
  and not public.banner_valid('[]') and not public.banner_valid('{"palette": ["#112233"]}'),
  'banner_valid(): wrong height, width, index, colour format or count and a 16 x 16 grid are rejected');

-- =============================================================================
-- C. set_company_banner
-- =============================================================================
select tests.login_as('authenticated', :f);
select gen_random_uuid() as rid1 \gset
select public.set_company_banner(:'rid1', :'b1') as r1 \gset
select public.get_my_company() -> 'company' as mc1 \gset
select banner as col1 from public.player_companies where company_id = :'fco' \gset
reset role;
select tests.assert(:'r1'::jsonb -> 'company' -> 'banner' = :'b1'::jsonb and :'mc1'::jsonb -> 'banner' = :'b1'::jsonb
  and :'col1'::jsonb = :'b1'::jsonb and :'r1'::jsonb -> 'company' -> 'logo' = 'null'::jsonb
  and (select logo is null and logo_version = 0 from public.player_companies where company_id = :'fco'),
  'set_company_banner(): saved, returned as {company: {banner}} and in get_my_company, readable column; logo untouched');

select tests.login_as('authenticated', :f);
select tests.throws_key(format($$select public.set_company_banner(gen_random_uuid(), %L)$$,
  jsonb_set(:'b1', '{grid,3}', to_jsonb(repeat('0', 47)))), 'invalid_argument', 'set_company_banner(): wrong width');
select tests.throws_key(format($$select public.set_company_banner(gen_random_uuid(), %L)$$,
  jsonb_set(:'b1', '{grid}', (:'b1'::jsonb -> 'grid') - 0)), 'invalid_argument', 'set_company_banner(): wrong height');
select tests.throws_key(format($$select public.set_company_banner(gen_random_uuid(), %L)$$,
  jsonb_set(:'b1', '{palette,1}', '"#FFCC00"')), 'invalid_argument', 'set_company_banner(): colour not lowercase #rrggbb');
select tests.throws_key(format($$select public.set_company_banner(null, %L)$$, :'b1'), 'invalid_argument',
  'set_company_banner(): request id required');
select tests.throws_key(format($$select public.set_company_banner(gen_random_uuid(), %L)$$,
  jsonb_build_object('palette', '["#111318", "#ffffff"]'::jsonb, 'grid', tests.banner(:cross, 2, 33, 1))),
  'logo_forbidden', 'set_company_banner(): forbidden symbol (NX065)');
select tests.throws_key(format($$select public.set_company_banner(gen_random_uuid(), %L)$$,
  jsonb_build_object('palette', '["#111318", "#ffffff"]'::jsonb,
                     'grid', tests.draw(:cross, 1, 43, 7, '1', array_fill(repeat('0', 48), array[12])))),
  'logo_forbidden', 'set_company_banner(): forbidden symbol in one colour on a filled banner');
reset role;
select tests.assert((select banner = :'b1'::jsonb from public.player_companies where company_id = :'fco'),
  'set_company_banner(): rejected banners leave the saved one');

select tests.login_as('authenticated', :f);
select public.set_company_banner(gen_random_uuid(), :'b2') -> 'company' -> 'banner' as r2 \gset
select public.set_company_banner(:'rid1', :'b1') as r1again \gset
reset role;
select tests.assert(:'r2'::jsonb = :'b2'::jsonb and :'r1again'::jsonb = :'r1'::jsonb
  and (select banner = :'b2'::jsonb from public.player_companies where company_id = :'fco'),
  'set_company_banner(): may be changed again; a replayed request returns the first answer and changes nothing');

-- only the founder
select tests.login_as('authenticated', :e);
select tests.throws_key(format($$select public.set_company_banner(gen_random_uuid(), %L)$$, :'b1'), 'company_not_found',
  'set_company_banner(): an employee cannot set the banner');
select tests.login_as('authenticated', :o);
select tests.throws_key(format($$select public.set_company_banner(gen_random_uuid(), %L)$$, :'b1'), 'company_not_found',
  'set_company_banner(): a player without a company cannot set a banner');
select tests.throws_key($$select public.set_company_banner(gen_random_uuid(), null)$$, 'company_not_found',
  'set_company_banner(): a player without a company cannot remove one');
reset role;
select tests.assert((select banner = :'b2'::jsonb from public.player_companies where company_id = :'fco'),
  'set_company_banner(): others leave the banner unchanged');

-- null removes (SQL null and JSON null)
select tests.login_as('authenticated', :f);
select public.set_company_banner(gen_random_uuid(), null) -> 'company' as rn1 \gset
select public.set_company_banner(gen_random_uuid(), :'b1') is not null as ok \gset
select public.set_company_banner(gen_random_uuid(), 'null'::jsonb) -> 'company' as rn2 \gset
reset role;
select tests.assert((:'rn1'::jsonb ? 'banner') and :'rn1'::jsonb -> 'banner' = 'null'::jsonb
  and :'rn2'::jsonb -> 'banner' = 'null'::jsonb
  and (select banner is null from public.player_companies where company_id = :'fco'),
  'set_company_banner(null): removes the banner; COMPANY shows "banner": null');

select tests.assert(tests.money_invariant() = 'ok', 'money invariant holds (banners move no money)');
