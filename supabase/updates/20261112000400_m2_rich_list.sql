-- ===== idempotent copy of migrations/20261112000400_m2_rich_list.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · M2a · 0400 · Rich list: AI tycoons, net worth ranking, snapshots,
--                     rank news
-- =============================================================================

-- One-time seeding of richList.aiTycoons fictional tycoons (after the money
-- genesis, so their cash comes from the "tycoons" allocation). Net worth
-- follows a log-concave curve from tycoonMaxWealthCents (rank 1) to
-- tycoonMinWealthCents (last rank):
--   log W(r) = log max - (log max - log min) * ((r - 1) / (n - 1)) ^ 0.5
-- Cash = W x (tycoon cash pool / sum W) (exactly the pool), the rest is held
-- in AI company shares at the current bid. The 15 richest found the 15
-- companies (largest fortune -> largest market cap) and hold at most 40 % of
-- their company; all tycoons together hold at most 60 % of any company.
create or replace function public.seed_rich_tycoons()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rl      jsonb := coalesce(public.config_jsonb('richList'), '{}'::jsonb);
  v_n       integer := greatest(1, public.cfg_num(v_rl, '{aiTycoons}', 120))::integer;
  v_min     double precision := public.cfg_num(v_rl, '{tycoonMinWealthCents}', 1500000);
  v_max     double precision := public.cfg_num(v_rl, '{tycoonMaxWealthCents}', 40000000000);
  v_pool    bigint;
  v_sum_w   double precision := 0;
  v_cash_left bigint;
  v_first   text[] := array[
    'Henrike:f', 'Jonas:m', 'Clara:f', 'Matthis:m', 'Lena:f', 'Friedrich:m', 'Ida:f', 'Konstantin:m', 'Marlene:f', 'Vincent:m',
    'Greta:f', 'Leopold:m', 'Theresa:f', 'Anton:m', 'Johanna:f', 'Benedikt:m', 'Frieda:f', 'Maximilian:m', 'Charlotte:f', 'Moritz:m',
    'Helene:f', 'Valentin:m', 'Amelie:f', 'Julius:m', 'Sophia:f', 'Felix:m', 'Mathilda:f', 'Emil:m', 'Paulina:f', 'Carl:m',
    'Luisa:f', 'Oskar:m', 'Antonia:f', 'Henri:m', 'Elisa:f', 'Ludwig:m', 'Viktoria:f', 'Jakob:m', 'Margarete:f', 'Philipp:m',
    'Lucia:f', 'Elias:m', 'Nora:f', 'Gustav:m', 'Rosa:f', 'Aurelio:m', 'Chiara:f', 'Lars:m', 'Ingrid:f', 'Pierre:m',
    'Camille:f', 'Marek:m', 'Zofia:f', 'Sven:m', 'Astrid:f', 'Bram:m', 'Femke:f', 'Mateo:m', 'Ines:f', 'Tomasz:m'];
  v_last    text[] := array[
    'Achterberg', 'Brandhorst', 'Clausing', 'Dreesmann', 'Eckhoff', 'Falkenrath', 'Gerdemann', 'Hartwigsen', 'Iversen', 'Jansing',
    'Kesselring', 'Lindemeyer', 'Mertensen', 'Nolting', 'Ostendorp', 'Petermeier', 'Quast', 'Rademaker', 'Seidelmann', 'Thielking',
    'Uhlenbrock', 'Vosskamp', 'Wendtland', 'Zanderhoff', 'Behrensen', 'Dornbusch', 'Ebelmann', 'Frankenberg', 'Grotefend', 'Hesselbarth',
    'Imhoven', 'Juergensmeier', 'Kroegerath', 'Lorentzen', 'Moellenkamp', 'Nagelschmidt', 'Oswaldt', 'Pohlmeyer', 'Reuterhahn', 'Sandkuhl',
    'Tewsdorf', 'Uhligmann', 'Vogtland', 'Winkelhaus', 'Zieglerhof', 'Ricciardi', 'Dubreuil', 'Lindqvist', 'Novakova', 'van Doorn',
    'Moreaux', 'Rossetti', 'Svenning', 'Kowalczyk', 'Ferreirinha', 'Horvathy', 'de Vriesland', 'Brunsberg', 'Kalverkamp', 'Stoltenhoff'];
  v_desc    text[] := array[
    'Erbe einer Hamburger Reederei|Erbin einer Hamburger Reederei', 'Family Office aus Hamburg|Family Office aus Hamburg',
    'Immobilienunternehmer aus München|Immobilienunternehmerin aus München', 'Vermögen aus dem Maschinenbau|Vermögen aus dem Maschinenbau',
    'Erbe einer Brauereidynastie|Erbin einer Brauereidynastie', 'Private-Equity-Investor aus Frankfurt|Private-Equity-Investorin aus Frankfurt',
    'Gründer einer Modekette|Gründerin einer Modekette', 'Hotelier am Bodensee|Hotelière am Bodensee',
    'Vermögen aus Windparks in der Nordsee|Vermögen aus Windparks in der Nordsee', 'Business Angel aus Berlin|Business Angel aus Berlin',
    'Erbe eines Süßwarenimperiums|Erbin eines Süßwarenimperiums', 'Pharma-Erbe aus Basel|Pharma-Erbin aus Basel',
    'Logistikunternehmer aus Bremen|Logistikunternehmerin aus Bremen', 'Vermögen aus dem Autohandel|Vermögen aus dem Autohandel',
    'Gründer eines Software-Start-ups (verkauft)|Gründerin eines Software-Start-ups (verkauft)', 'Weingut-Dynastie aus der Pfalz|Weingut-Dynastie aus der Pfalz',
    'Bauunternehmer aus Köln|Bauunternehmerin aus Köln', 'Vermögen aus dem Rohstoffhandel|Vermögen aus dem Rohstoffhandel',
    'Erbe einer Verlagsgruppe|Erbin einer Verlagsgruppe', 'Investor in Energiewerte|Investorin in Energiewerte',
    'Gründer einer Supermarktkette|Gründerin einer Supermarktkette', 'Kunstsammler und Investor|Kunstsammlerin und Investorin',
    'Vermögen aus der Chemieindustrie|Vermögen aus der Chemieindustrie', 'Daytrader der ersten Stunde|Daytraderin der ersten Stunde',
    'Erbe eines Familienunternehmens aus Schwaben|Erbin eines Familienunternehmens aus Schwaben', 'Hedgefonds-Manager aus Zürich|Hedgefonds-Managerin aus Zürich',
    'Vermögen aus Medizintechnik|Vermögen aus Medizintechnik', 'Gründer eines Online-Marktplatzes|Gründerin eines Online-Marktplatzes',
    'Reederei-Erbe aus Rotterdam|Reederei-Erbin aus Rotterdam', 'Lottomillionär mit Börsenglück|Lottomillionärin mit Börsenglück'];
  r         integer;
  v_fn      text;
  v_gender  text;
  v_name    text;
  v_w       double precision;
  v_cash    bigint;
  v_hold    double precision;
  v_id      uuid;
  v_co_id   uuid;
  v_co_sec  uuid;
  v_co_name text;
  v_co_shares bigint;
  v_co_price bigint;
  v_co_cap  double precision;
  v_desc_t  text;
  v_pieces  integer;
  v_piece   double precision;
  v_take    double precision;
  v_left    double precision;
  v_sec     uuid;
  j         integer;
  c         record;
begin
  if exists (select 1 from public.rich_tycoons) then
    return jsonb_build_object('skipped', 'tycoons_exist');
  end if;
  if not public.money_genesis_done() then
    return jsonb_build_object('skipped', 'no_genesis');
  end if;
  select a.balance_cents into v_pool from public.ledger_accounts a where a.system_key = 'tycoons';

  -- capacity per company: 60 % of the shares (all tycoons), founders 40 % of their own
  drop table if exists pg_temp.nexa_ty_cap;
  create temporary table nexa_ty_cap on commit drop as
  select s.id as security_id, c2.id as company_id, c2.name as company_name, c2.shares_outstanding,
         coalesce(q.bid_e4, q.last_price_e4) as price_e4,
         c2.shares_outstanding::double precision * coalesce(q.bid_e4, q.last_price_e4) / 100 * 0.6 as cap_left,
         row_number() over (order by c2.shares_outstanding::numeric * coalesce(q.bid_e4, q.last_price_e4) desc, c2.id) as cap_rank
    from public.companies c2
    join public.securities s on s.id = c2.security_id and s.status = 'listed'
    join public.security_quotes q on q.security_id = s.id
   where c2.is_ai;
  drop table if exists pg_temp.nexa_ty_hold;
  create temporary table nexa_ty_hold (tycoon_id uuid, security_id uuid, value_cents double precision) on commit drop;

  for r in 1..v_n loop
    v_sum_w := v_sum_w + exp(ln(v_max) - (ln(v_max) - ln(v_min)) * sqrt(case when v_n = 1 then 0 else (r - 1)::double precision / (v_n - 1) end));
  end loop;
  v_cash_left := v_pool;

  for r in 1..v_n loop
    v_w := exp(ln(v_max) - (ln(v_max) - ln(v_min)) * sqrt(case when v_n = 1 then 0 else (r - 1)::double precision / (v_n - 1) end));
    v_fn := split_part(v_first[((r - 1) % 60) + 1], ':', 1);
    v_gender := split_part(v_first[((r - 1) % 60) + 1], ':', 2);
    v_name := case when r % 7 = 3 then 'Dr. ' else '' end || v_fn || ' ' || v_last[(((r - 1) * 7 + ((r - 1) / 60) * 13) % 60) + 1];
    if r = v_n then
      v_cash := v_cash_left;
    else
      v_cash := least(v_cash_left, floor(v_w * v_pool / v_sum_w)::bigint);
    end if;
    v_cash_left := v_cash_left - v_cash;
    v_hold := greatest(0, v_w - v_cash);

    v_co_id := null;
    select t.company_id, t.security_id, t.company_name, t.shares_outstanding, t.price_e4, t.cap_left
      into v_co_id, v_co_sec, v_co_name, v_co_shares, v_co_price, v_co_cap
      from pg_temp.nexa_ty_cap t where t.cap_rank = r;
    if v_co_id is not null then
      v_desc_t := case when v_gender = 'f' then 'Gründerin von ' else 'Gründer von ' end
                  || regexp_replace(v_co_name, '\s+(AG|SE|GmbH)$', '');
    else
      v_desc_t := split_part(v_desc[((r * 11) % array_length(v_desc, 1)) + 1], '|', case when v_gender = 'f' then 2 else 1 end);
    end if;
    insert into public.rich_tycoons (seed_rank, name, description, cash_cents, founder_company_id)
    values (r, v_name, v_desc_t, v_cash, v_co_id)
    returning id into v_id;

    v_left := v_hold;
    if v_co_id is not null then
      -- founder: own company first, at most 40 % of its shares
      v_take := least(v_left, v_co_cap, v_co_shares::double precision * v_co_price / 100 * 0.4);
      if v_take > 0 then
        insert into pg_temp.nexa_ty_hold values (v_id, v_co_sec, v_take);
        update pg_temp.nexa_ty_cap set cap_left = cap_left - v_take where security_id = v_co_sec;
        v_left := v_left - v_take;
      end if;
    else
      -- others: 1 to 3 companies, picked deterministically
      v_pieces := 1 + (r % 3);
      v_piece := v_left / v_pieces;
      for j in 0..v_pieces - 1 loop
        select t.security_id, t.cap_left into c from pg_temp.nexa_ty_cap t
         where t.cap_rank = ((r * 7 + j * 5) % (select count(*) from pg_temp.nexa_ty_cap)) + 1;
        continue when not found;
        v_take := least(v_piece, greatest(c.cap_left, 0));
        if v_take > 0 then
          insert into pg_temp.nexa_ty_hold values (v_id, c.security_id, v_take);
          update pg_temp.nexa_ty_cap set cap_left = cap_left - v_take where security_id = c.security_id;
          v_left := v_left - v_take;
        end if;
      end loop;
    end if;
    -- the rest goes to the companies with the most room left (founders: not their own)
    while v_left > 1 loop
      select t.security_id, t.cap_left into c from pg_temp.nexa_ty_cap t
       where t.cap_left > 1 and t.company_id is distinct from v_co_id
       order by t.cap_left desc limit 1;
      exit when not found;
      v_take := least(v_left, c.cap_left);
      insert into pg_temp.nexa_ty_hold values (v_id, c.security_id, v_take);
      update pg_temp.nexa_ty_cap set cap_left = cap_left - v_take where security_id = c.security_id;
      v_left := v_left - v_take;
    end loop;
  end loop;

  insert into public.rich_tycoon_holdings (tycoon_id, security_id, quantity_e6)
  select h.tycoon_id, h.security_id, floor(sum(h.value_cents) * 100000000 / max(t.price_e4))::bigint
    from pg_temp.nexa_ty_hold h join pg_temp.nexa_ty_cap t on t.security_id = h.security_id
   group by h.tycoon_id, h.security_id
  having floor(sum(h.value_cents) * 100000000 / max(t.price_e4)) > 0;

  drop table pg_temp.nexa_ty_hold;
  drop table pg_temp.nexa_ty_cap;
  return jsonb_build_object('tycoons', v_n, 'cash_cents', v_pool,
                            'holdings', (select count(*) from public.rich_tycoon_holdings));
end;
$$;

-- Everyone on the list with net worth (players: cash + reserve + positions at
-- the bid; tycoons: cash + holdings at the bid) and ranks (all / players only).
create or replace function public.rich_list_entries()
returns table (entity_kind text, entity_id uuid, name text, description text, net_worth_cents bigint, rank_all integer, rank_players integer)
language sql
stable
security definer
set search_path = ''
as $$
  with players as (
    select p.id,
           coalesce(a.cash, 0) + coalesce(v.val, 0) as nw,
           p.nickname
      from public.profiles p
      left join (select owner_player_id, sum(balance_cents)::bigint as cash from public.ledger_accounts
                  where owner_player_id is not null group by owner_player_id) a on a.owner_player_id = p.id
      left join (select pos.player_id, sum(public.value_cents(pos.quantity_e6, coalesce(q.bid_e4, q.last_price_e4)))::bigint as val
                   from public.positions pos join public.security_quotes q on q.security_id = pos.security_id
                  where pos.status = 'open' and pos.quantity_e6 > 0 group by pos.player_id) v on v.player_id = p.id
     where not p.is_deactivated
  ), tycoons as (
    select t.id, t.name, t.description,
           t.cash_cents + coalesce(sum(public.value_cents(h.quantity_e6, coalesce(q.bid_e4, q.last_price_e4))), 0)::bigint as nw
      from public.rich_tycoons t
      left join public.rich_tycoon_holdings h on h.tycoon_id = t.id
      left join public.security_quotes q on q.security_id = h.security_id
     group by t.id
  ), allx as (
    select 'player'::text as entity_kind, id as entity_id, nickname as name, null::text as description, nw from players
    union all
    select 'tycoon', id, name, description, nw from tycoons
  )
  select x.entity_kind, x.entity_id, x.name, x.description, x.nw,
         (row_number() over (order by x.nw desc, x.entity_kind, x.entity_id))::integer,
         case when x.entity_kind = 'player'
              then (row_number() over (partition by x.entity_kind order by x.nw desc, x.entity_id))::integer end
    from allx x;
$$;

create or replace function public.player_rich_rank(p_player uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select e.rank_all from public.rich_list_entries() e where e.entity_kind = 'player' and e.entity_id = p_player;
$$;

-- Snapshot every richList.snapshotMinutes (run_due_jobs), rank news, 8 days kept.
create or replace function public.rich_list_snapshot(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rl     jsonb := coalesce(public.config_jsonb('richList'), '{}'::jsonb);
  v_now    timestamptz := public.game_now();
  v_prev   timestamptz;
  v_day    date := (public.game_now() at time zone 'Europe/Berlin')::date;
  v_ranks  integer[];
  v_news   integer := 0;
  v_rows   integer;
  r        record;
  v_r      integer;
  v_q      record;
  v_run    bigint;
begin
  select max(s.taken_at) into v_prev from public.rich_list_snapshots s;
  if not p_force and v_prev is not null
     and v_prev > v_now - make_interval(secs => public.cfg_num(v_rl, '{snapshotMinutes}', 5) * 60 - 5) then
    return jsonb_build_object('skipped', 'recent');
  end if;
  select coalesce(array_agg((x #>> '{}')::integer order by (x #>> '{}')::integer), array[1, 3, 10, 25, 50, 100])
    into v_ranks from jsonb_array_elements(coalesce(v_rl -> 'newsRanks', '[]'::jsonb)) x;

  insert into public.rich_list_snapshots (taken_at, entity_kind, entity_id, net_worth_cents, rank_all, rank_players)
  select v_now, e.entity_kind, e.entity_id, e.net_worth_cents, e.rank_all, e.rank_players from public.rich_list_entries() e
  on conflict do nothing;
  get diagnostics v_rows = row_count;

  if v_prev is not null then
    for r in
      select n.entity_id, n.rank_all, n.rank_players, n.net_worth_cents, p.rank_all as prev_all, p.rank_players as prev_players,
             pr.nickname
        from public.rich_list_snapshots n
        join public.rich_list_snapshots p on p.taken_at = v_prev and p.entity_kind = 'player' and p.entity_id = n.entity_id
        join public.profiles pr on pr.id = n.entity_id
       where n.taken_at = v_now and n.entity_kind = 'player'
    loop
      -- entering a news rank (the best threshold crossed), number one overall
      select min(t) into v_r from unnest(v_ranks) t where r.rank_all <= t and r.prev_all > t;
      if v_r = 1 then
        perform public.rich_news('rich_number_one', r.entity_id, r.nickname, null, r.rank_all, 1, r.net_worth_cents, null);
        v_news := v_news + 1;
      elsif v_r is not null then
        perform public.rich_news('rich_rank_entry', r.entity_id, r.nickname, null, r.rank_all, v_r, r.net_worth_cents, null);
        v_news := v_news + 1;
      end if;
      -- number one among players
      if r.rank_players = 1 and r.prev_players > 1 then
        perform public.rich_news('rich_players_one', r.entity_id, r.nickname, null, r.rank_all, 1, r.net_worth_cents, null);
        v_news := v_news + 1;
      end if;
      -- overtaking another player (the best ranked one overtaken, once per pair and day)
      select o.entity_id, pr2.nickname into v_q
        from public.rich_list_snapshots o
        join public.rich_list_snapshots op on op.taken_at = v_prev and op.entity_kind = 'player' and op.entity_id = o.entity_id
        join public.profiles pr2 on pr2.id = o.entity_id
       where o.taken_at = v_now and o.entity_kind = 'player' and o.entity_id <> r.entity_id
         and op.rank_players < r.prev_players and o.rank_players > r.rank_players
       order by o.rank_players limit 1;
      if v_q.entity_id is not null and not exists (
           select 1 from public.news_items ni
            where ni.template_key = 'rich_overtake' and ni.actor_player_id = r.entity_id
              and ni.headline like '%' || v_q.nickname
              and (ni.published_at at time zone 'Europe/Berlin')::date = v_day) then
        perform public.rich_news('rich_overtake', r.entity_id, r.nickname, v_q.nickname, r.rank_all, r.rank_all, r.net_worth_cents, null);
        v_news := v_news + 1;
      end if;
    end loop;
  end if;

  -- biggest 24 h gainer, once per Berlin day, from 22:00 on
  if extract(hour from v_now at time zone 'Europe/Berlin') >= 22 then
    insert into public.job_runs (job_name, run_key, status, finished_at) values ('rich_top_gainer', v_day::text, 'succeeded', now())
    on conflict (job_name, run_key) do nothing
    returning id into v_run;
    if v_run is not null then
      select n.entity_id, pr.nickname, n.net_worth_cents,
             round((n.net_worth_cents - o.net_worth_cents) * 10000.0 / o.net_worth_cents)::integer as bps
        into v_q
        from public.rich_list_snapshots n
        join public.profiles pr on pr.id = n.entity_id
        join lateral (select s.net_worth_cents from public.rich_list_snapshots s
                       where s.entity_id = n.entity_id and s.taken_at <= v_now - interval '24 hours'
                       order by s.taken_at desc limit 1) o on true
       where n.taken_at = v_now and n.entity_kind = 'player' and o.net_worth_cents > 0
         and n.net_worth_cents > o.net_worth_cents
       order by bps desc limit 1;
      if v_q.entity_id is not null then
        perform public.rich_news('rich_top_gainer', v_q.entity_id, v_q.nickname, null, null, null, v_q.net_worth_cents,
                                 '+' || replace(to_char(v_q.bps / 100.0, 'FM999990.0'), '.', ',') || ' %');
        v_news := v_news + 1;
      end if;
    end if;
  end if;

  -- missions that depend on net worth / rank
  for r in select p.id from public.profiles p
            where exists (select 1 from public.player_missions m join public.mission_templates t on t.key = m.template_key
                           where m.player_id = p.id and m.status = 'active' and t.mode = 'state')
  loop
    perform public.mission_refresh_state(r.id);
  end loop;

  delete from public.rich_list_snapshots where taken_at < v_now - interval '8 days';
  return jsonb_build_object('taken_at', v_now, 'rows', v_rows, 'news', v_news);
end;
$$;

create or replace function public.rich_news(
  p_key text, p_player uuid, p_name text, p_other text, p_position integer, p_rank integer, p_worth bigint, p_pct text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head text;
  v_body text;
  v_imp  smallint;
begin
  select t.headline_template, t.body_template, t.importance into v_head, v_body, v_imp from public.news_templates t where t.key = p_key;
  v_head := replace(replace(replace(replace(replace(coalesce(v_head, '{name}'),
              '{name}', p_name), '{other}', coalesce(p_other, '')), '{rank}', coalesce(p_rank::text, '')),
              '{position}', coalesce(p_position::text, '')), '{pct}', coalesce(p_pct, ''));
  v_body := replace(replace(replace(replace(replace(replace(coalesce(v_body, ''),
              '{name}', p_name), '{other}', coalesce(p_other, '')), '{rank}', coalesce(p_rank::text, '')),
              '{position}', coalesce(p_position::text, '')), '{pct}', coalesce(p_pct, '')),
              '{worth}', public.format_eur_short(p_worth));
  insert into public.news_items (category, headline, body, importance, actor_player_id, template_key, published_at)
  values ('player', v_head, nullif(v_body, ''), coalesce(v_imp, 1), p_player, p_key, now());
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.get_rich_list(p_limit integer default 100, p_offset integer default 0, p_scope text default 'all')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player  uuid;
  v_limit   integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset  integer := greatest(coalesce(p_offset, 0), 0);
  v_scope   text := coalesce(p_scope, 'all');
  v_now     timestamptz := public.game_now();
  v_snap    timestamptz;
  v_out     jsonb;
begin
  v_player := public.require_player();
  if v_scope not in ('all', 'players') then
    perform public.api_error('invalid_argument');
  end if;
  -- the latest snapshot that is at least 24 h old
  select max(s.taken_at) into v_snap from public.rich_list_snapshots s where s.taken_at <= v_now - interval '24 hours';

  with lst as materialized (
    select e.entity_kind, e.entity_id, e.name, e.description, e.net_worth_cents,
           case when v_scope = 'players' then e.rank_players else e.rank_all end as rnk,
           case when s.net_worth_cents > 0 then round((e.net_worth_cents - s.net_worth_cents) * 10000.0 / s.net_worth_cents)::integer end as change_bps,
           case when s.entity_id is not null
                then (case when v_scope = 'players' then s.rank_players else s.rank_all end)
                   - (case when v_scope = 'players' then e.rank_players else e.rank_all end) end as rank_change
      from public.rich_list_entries() e
      left join public.rich_list_snapshots s on s.taken_at = v_snap and s.entity_kind = e.entity_kind and s.entity_id = e.entity_id
     where v_scope = 'all' or e.entity_kind = 'player'
  ), me as (
    select * from lst where entity_kind = 'player' and entity_id = v_player
  )
  select jsonb_build_object(
           'server_time', v_now,
           'total', (select count(*) from lst),
           'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                          'rank', x.rnk, 'kind', x.entity_kind, 'id', x.entity_id, 'name', x.name, 'description', x.description,
                          'net_worth_cents', x.net_worth_cents, 'change_24h_bps', x.change_bps, 'rank_change_24h', x.rank_change,
                          'is_me', x.entity_kind = 'player' and x.entity_id = v_player) order by x.rnk), '[]'::jsonb)
                         from (select * from lst order by rnk offset v_offset limit v_limit) x),
           'me', (select jsonb_build_object(
                           'rank', m.rnk, 'net_worth_cents', m.net_worth_cents,
                           'next', (select jsonb_build_object('rank', n.rnk, 'name', n.name, 'gap_cents', n.net_worth_cents - m.net_worth_cents)
                                      from lst n where n.rnk = m.rnk - 1))
                    from me m))
    into v_out;
  return v_out;
end;
$$;

create or replace function public.get_rich_list_news(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_player();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'published_at', n.published_at, 'headline', n.headline, 'body', n.body,
             'kind', substr(n.template_key, 6), 'player_id', n.actor_player_id) order by n.published_at desc, n.id desc), '[]'::jsonb)
      from (select x.* from public.news_items x
             where x.template_key like 'rich\_%' and x.published_at <= now()
             order by x.published_at desc, x.id desc
             limit least(greatest(coalesce(p_limit, 20), 1), 100)) n);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.seed_rich_tycoons()', 'public.rich_list_entries()', 'public.player_rich_rank(uuid)',
    'public.rich_list_snapshot(boolean)', 'public.rich_news(text, uuid, text, text, integer, integer, bigint, text)',
    'public.get_rich_list(integer, integer, text)', 'public.get_rich_list_news(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.get_rich_list(integer, integer, text) to authenticated;
  grant execute on function public.get_rich_list_news(integer) to authenticated;
end;
$$;
