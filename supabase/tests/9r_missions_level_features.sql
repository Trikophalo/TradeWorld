-- =============================================================================
-- 9r · Harder missions with the level, missions for the new features (ADR-159)
-- =============================================================================
\set QUIET 1
set client_min_messages = notice;

\set lo '''09e29e29-0000-4000-8000-0000000000a1'''
\set hi '''09e29e29-0000-4000-8000-0000000000b1'''
update public.invite_codes set max_uses = max_uses + 2 where code = 'M1-TESTS';
select tests.signup(:lo, 'Stufe_Klein') is not null and tests.signup(:hi, 'Stufe_Gross') is not null as ok \gset
select tests.set_level(:lo, 1);
select tests.set_level(:hi, 30);

-- the same daily template: a level-30 player gets about 2.16 times the target
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward)
select p, 'd_news_chat', 'daily', date '1999-01-01', 1, 1 from unnest(array[:lo, :hi]::uuid[]) p;
update public.mission_templates set weight = case when key = 'd_news_chat' then 100000 else weight end where kind = 'daily';
delete from public.player_missions where template_key = 'd_news_chat' and period_start = date '1999-01-01';
select public.missions_assign(:lo) is not null and public.missions_assign(:hi) is not null as ok \gset
select (select target from public.player_missions where player_id = :lo and template_key = 'd_news_chat') as t_lo,
       (select target from public.player_missions where player_id = :hi and template_key = 'd_news_chat') as t_hi \gset
update public.mission_templates set weight = 40 where key = 'd_news_chat';
select tests.assert(
  :t_lo::int between 3 and 5 and :t_hi::int between round(3 * 2.16) and round(5 * 2.16),
  'missions_assign(): a counted daily mission is harder at level 30 (x1 + 0.04 per level)');

-- the new metrics count through triggers
delete from public.player_missions where player_id = :hi;
insert into public.player_missions (player_id, template_key, kind, period_start, target, xp_reward)
values (:hi, 'q_news_chat', 'quick', date '1999-01-02', 1, 10),
       (:hi, 'm_first_accessory', 'milestone', date '1999-01-03', 1, 10),
       (:hi, 'm_legendary', 'milestone', date '1999-01-04', 1, 10),
       (:hi, 'q_poke', 'quick', date '1999-01-05', 1, 10);
insert into public.news_show_messages (player_id, body) values (:hi, 'Hallo Studio');
insert into public.news_show_messages (player_id, bot_name, body) values (null, 'Jürgen Test', 'Bot');
insert into public.player_accessories (player_id, accessory_key, price_paid_cents)
select :hi, x ->> 'key', 0
  from jsonb_array_elements(public.config_jsonb('accessories', '{items}')) x where x ->> 'rarity' = 'legendary' limit 1;
insert into public.friendships (requester_id, addressee_id, status, responded_at) values (:hi, :lo, 'accepted', now());
insert into public.friend_pokes (poker_id, target_id) values (:hi, :lo);
select tests.assert(
  (select bool_and(status = 'completed') from public.player_missions
    where player_id = :hi and template_key in ('q_news_chat', 'm_first_accessory', 'm_legendary', 'q_poke')),
  'news chat, buying (legendary) accessories and pokes complete their missions');
select tests.assert(
  not public.mission_doable(:hi, 'm_first_accessory', 'accessory_bought')
  and public.mission_doable(:hi, 'q_poke', 'friend_poke')
  and not public.mission_doable(:hi, 'q_team_chat', 'company_chat')
  and public.mission_requirement_ok(:hi, 'accessory') and not public.mission_requirement_ok(:lo, 'accessory'),
  'mission_doable(): first accessory only once, poke needs a friend, team chat a team');
select tests.assert((select count(*) from public.mission_templates where key in
  ('q_poke','q_news_chat','q_team_chat','q_accessory','q_outfit','d_pokes','d_news_chat','d_team_chat','w_accessories','w_pokes',
   'w_news_chat','m_first_accessory','m_accessories_10','m_accessories_30','m_legendary','m_first_poke','m_pokes_100',
   'm_news_chat_50','m_team_chat_100') and is_active) = 19, '19 new mission templates');
delete from public.news_show_messages;
