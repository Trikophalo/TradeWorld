-- =============================================================================
-- e5 · Redrawing the company logo (ADR-200): founder only, costs startups.logoRedrawCents from the company cash to the
--      treasury, forbidden symbols refused, cooldown, idempotent by request id, feed item, money invariant.
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set a '''0e5e5e5e-0000-4000-8000-0000000000a1'''
\set b '''0e5e5e5e-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:a, 'Le_Anna') is not null and tests.signup(:b, 'Le_Bruno') is not null as ok \gset
select tests.set_level(:a, 20);
select tests.set_level(:b, 20);
select tests.fund(:a, 90000000, 'test:e5:a');

select tests.assert((value ->> 'logoRedrawCents')::bigint = 5000000 and (value ->> 'logoRedrawCooldownHours')::integer = 24,
  'e5: config startups.logoRedrawCents 50 000 €, cooldown 24 h') from public.game_config where key = 'startups';

select tests.login_as('authenticated', :a);
select public.found_company(gen_random_uuid(), 'Logo Fuenf', 'Malt neu', 'tech', '#224466', 'garage') is not null as ok \gset
reset role;
select tests.company_of(:a) as aco \gset
select tests.set_company_cash(:'aco', 12000000);
update public.player_companies set unpaid_cents = 0 where company_id = :'aco';

\set logo1 '''{"palette": ["#112233", "#ffcc00"], "grid": ["................", "................", "....00000000....", "....01111110....", "....01111110....", "....00000000....", "................", "................", "................", "................", "................", "................", "................", "................", "................", "................"]}'''
\set logo2 '''{"palette": ["#334455", "#ffffff"], "grid": ["................", "......0000......", ".....011110.....", ".....011110.....", "......0000......", "................", "................", "................", "................", "................", "................", "................", "................", "................", "................", "................"]}'''
\set cross '''{x.xxx,x.x..,xxxxx,..x.x,xxx.x}'''

-- founder only
select tests.login_as('authenticated', :b);
select tests.throws_key(format($$select public.redraw_company_logo(gen_random_uuid(), %L, %L)$$, :'aco', :logo1),
  'forbidden', 'redraw_company_logo(): only the founder');
select tests.throws_key(format($$select public.get_logo_redraw(%L)$$, :'aco'), 'forbidden',
  'get_logo_redraw(): only the founder');
reset role;
select tests.login_as('authenticated', :a);
select public.get_logo_redraw(:'aco') as g0 \gset
reset role;
select tests.assert((:'g0'::jsonb ->> 'cost_cents')::bigint = 5000000 and :'g0'::jsonb -> 'available_at' = 'null'::jsonb,
  'get_logo_redraw(): price, no cooldown before the first redraw');

select tests.company_cash(:'aco') as c0 \gset
select tests.treasury() as t0 \gset
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.redraw_company_logo(gen_random_uuid(), %L, %L)$$, :'aco',
  jsonb_build_object('palette', '["#111318", "#ffffff"]'::jsonb, 'grid', tests.draw(:cross, 2, 1, 1))),
  'logo_forbidden', 'redraw_company_logo(): forbidden symbol');
select tests.throws_key(format($$select public.redraw_company_logo(gen_random_uuid(), %L, %L)$$, :'aco',
  jsonb_set(:logo1::jsonb, '{grid,0}', '"..."')), 'invalid_argument', 'redraw_company_logo(): invalid grid');
\set rq '''0e5e5e5e-0000-4000-8000-0000000000f1'''
select public.redraw_company_logo(:rq, :'aco', :logo1) as r1 \gset
select public.redraw_company_logo(:rq, :'aco', :logo1) as r2 \gset
reset role;
select tests.assert(:'r1'::jsonb = :'r2'::jsonb and (:'r1'::jsonb ->> 'cost_cents')::bigint = 5000000
  and tests.company_cash(:'aco') = :c0::bigint - 5000000 and tests.treasury() = :t0::bigint + 5000000
  and (select logo -> 'palette' ->> 0 from public.player_companies where company_id = :'aco') = '#112233',
  'redraw_company_logo(): pays 50 000 € once from the company cash to the treasury, idempotent');
select tests.assert((select count(*) from public.feed_items where actor_id = :a and kind = 'logo_redrawn'
                                and payload ->> 'company' = 'Logo Fuenf'
                                and payload -> 'logo' -> 'palette' ->> 0 = '#112233') = 1,
  'redraw_company_logo(): feed item');

-- cooldown
select tests.login_as('authenticated', :a);
select public.get_logo_redraw(:'aco') as g1 \gset
select tests.assert((:'g1'::jsonb ->> 'available_at')::timestamptz > public.game_now() + interval '23 hours',
  'get_logo_redraw(): next redraw after the cooldown');
select tests.throws_key(format($$select public.redraw_company_logo(gen_random_uuid(), %L, %L)$$, :'aco', :logo2),
  'locked', 'redraw_company_logo(): once per cooldown');
reset role;
update public.player_companies set logo_redrawn_at = public.game_now() - interval '25 hours' where company_id = :'aco';
select tests.set_company_cash(:'aco', 4000000);
select tests.login_as('authenticated', :a);
select tests.throws_key(format($$select public.redraw_company_logo(gen_random_uuid(), %L, %L)$$, :'aco', :logo2),
  'insufficient_funds', 'redraw_company_logo(): company cash too low');
reset role;
select tests.set_company_cash(:'aco', 6000000);
select tests.login_as('authenticated', :a);
select public.redraw_company_logo(gen_random_uuid(), :'aco', :logo2) is not null as ok \gset
reset role;
select tests.assert(tests.company_cash(:'aco') = 1000000
  and (select logo -> 'palette' ->> 0 from public.player_companies where company_id = :'aco') = '#334455',
  'redraw_company_logo(): again after the cooldown');

select tests.assert(tests.money_invariant() = 'ok', 'e5: money invariant holds after logo redraws');
select tests.assert(public.feed_item_label('logo_redrawn', '{"company": "Logo Fuenf"}') = 'Logo Fuenf hat ein neues Logo'
                    and public.feed_item_label('accessory_bought', '{"name": "Heiligenschein"}') = 'Heiligenschein gekauft',
  'e5: feed label of the new logo, the other kinds unchanged');
