-- =============================================================================
-- NEXA · 4910 · News battles: four more round games (ADR-160, addendum)
-- =============================================================================
-- Tresorknacker (vault), Ticker-Tippen (ticker), Mehr oder Weniger (higher) and Wer bietet mehr? (auction), judged
-- on the server like Börsenquiz (src/lib/sim/battle/rounds-more.ts is the same judging for the demo and the tests):
-- * vault: the codes stay in battles.plan; every try goes through battle_answer (p_choice = the digits, e.g. 352)
--   into battle_guesses, the server answers with how many digits are in place and how many elsewhere. Cracked =
--   a row in battle_answers (choice = tries). At most maxTries tries, nothing after cracking.
-- * ticker: like the quiz with `options` tickers (listed stocks, else battles.tickers); a wrong tap costs points.
-- * higher: a chart with trends (battles.plan.series, prices in cents); choice 0 higher, 1 lower; hearts as in the
--   bell. The client sees the chart only up to the current candle, the next one after the round closed.
-- * auction: sealed bids (p_value, whole play money, at most what is left: the server checks); the highest bid wins
--   the item's points and pays it. Bids are shown after the gavel.
-- Patched by replace (other migrations may patch the same functions): battle_plan, battle_round_ms,
-- battle_rounds_eval, battle_rounds_json, battle_answer. New: battle_plan_more, battle_rounds_eval_more,
-- battle_round_extra, battle_answer_more, table battle_guesses.
-- Round JSON adds: vault {"digits", "symbols", "guesses": [{"code", "hits", "near"}] (own), "progress": [{"slot",
-- "tries", "cracked"}], "code" (after the round)}; higher {"chart": [price, ...]}; auction {"item_points", "icon",
-- "budget" (own), "budgets": [per slot]}.
-- Idempotent: runs unchanged as supabase/updates/20261204004910_more_battle_games.sql.

-- ---------------------------------------------------------------------------
-- A. The tries of Tresorknacker
-- ---------------------------------------------------------------------------
create table if not exists public.battle_guesses (
  battle_id  bigint not null references public.battles (id) on delete cascade,
  round      smallint not null check (round between 0 and 99),
  player_id  uuid not null references public.profiles (id) on delete cascade,
  n          smallint not null check (n between 1 and 99),
  code       text not null check (code ~ '^[1-9]{1,9}$'),
  hits       smallint not null,
  near       smallint not null,
  guessed_at timestamptz not null,
  primary key (battle_id, round, player_id, n)
);
alter table public.battle_guesses enable row level security;
revoke all on public.battle_guesses from public, anon, authenticated;
create index if not exists battle_guesses_player_idx on public.battle_guesses (player_id);
comment on table public.battle_guesses is
  'Tries in Tresorknacker (news battles, ADR-160) with the server''s answer (hits in place, near elsewhere) and the '
  'server time. Internal; the code stays in battles.plan.';

-- ---------------------------------------------------------------------------
-- B. Plans: codes, tickers, the chart, the items
-- ---------------------------------------------------------------------------
create or replace function public.battle_plan_more(p_kind text, p_params jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cfg      jsonb := public.battles_cfg();
  g        jsonb := p_params -> 'game';
  v_rounds integer := (g ->> 'rounds')::integer;
  v_list   jsonb := '[]'::jsonb;
  v_pool   jsonb;
  v_opts   jsonb;
  v_target jsonb;
  v_code   text;
  v_series integer[];
  v_dir    integer;
  v_bps    integer;
  v_move   integer;
  v_next   integer;
  v_hist   integer;
  v_name   text;
  q        jsonb;
  r        integer;
begin
  if p_kind = 'vault' then
    for r in 1 .. v_rounds loop
      select string_agg(z.d::text, '' order by z.o) into v_code
        from (select d, random() as o from generate_series(1, (g ->> 'symbols')::integer) d
               order by 2 limit (g ->> 'digits')::integer) z;
      v_list := v_list || jsonb_build_array(jsonb_build_object('q', 'Tresor ' || r, 'code', v_code));
    end loop;
    return jsonb_build_object('questions', v_list);
  elsif p_kind = 'ticker' then
    select jsonb_agg(jsonb_build_object('ticker', s.ticker, 'name', s.name) order by s.o) into v_pool
      from (select sec.ticker, sec.name, random() as o from public.securities sec
             where sec.kind = 'stock' and sec.status = 'listed' and sec.ticker is not null and sec.name is not null) s;
    if coalesce(jsonb_array_length(v_pool), 0) < (g ->> 'options')::integer + v_rounds then
      select jsonb_agg(x order by random()) into v_pool from jsonb_array_elements(cfg -> 'tickers') x;
    end if;
    for r in 0 .. v_rounds - 1 loop
      v_target := v_pool -> (r % jsonb_array_length(v_pool));
      select jsonb_agg(z.t order by random()) into v_opts
        from (select v_target ->> 'ticker' as t
              union all
              (select y ->> 'ticker' from jsonb_array_elements(v_pool) y
                where y ->> 'ticker' <> v_target ->> 'ticker' order by random() limit (g ->> 'options')::integer - 1)) z;
      v_list := v_list || jsonb_build_array(jsonb_build_object(
        'q', v_target ->> 'name', 'options', v_opts,
        'correct', (select (i - 1)::integer from jsonb_array_elements_text(v_opts) with ordinality o(t, i)
                     where t = v_target ->> 'ticker' limit 1)));
    end loop;
    return jsonb_build_object('questions', v_list);
  elsif p_kind = 'higher' then
    -- a chart with trends (higherSeries in rounds-more.ts): a move goes on with trendPct %, never flat
    v_hist := (g ->> 'history')::integer;
    v_series := array[5000 + floor(random() * 15001)::integer];
    v_dir := case when random() < 0.5 then 1 else -1 end;
    while cardinality(v_series) < v_hist + v_rounds + 1 loop
      if random() * 100 >= (g ->> 'trendPct')::integer then v_dir := -v_dir; end if;
      v_bps := (g ->> 'moveMinBps')::integer
               + floor(random() * ((g ->> 'moveMaxBps')::integer - (g ->> 'moveMinBps')::integer + 1))::integer;
      v_move := greatest(1, round(v_series[cardinality(v_series)] * v_bps / 10000.0)::integer);
      v_next := v_series[cardinality(v_series)] + v_dir * v_move;
      if v_next < 100 then
        v_dir := 1;
        v_next := v_series[cardinality(v_series)] + v_move;
      end if;
      v_series := v_series || v_next;
    end loop;
    select sec.name into v_name from public.securities sec where sec.kind = 'stock' and sec.status = 'listed'
     order by random() limit 1;
    v_name := coalesce(v_name, 'NEXA-Index');
    for r in 0 .. v_rounds - 1 loop
      v_list := v_list || jsonb_build_array(jsonb_build_object(
        'q', v_name,
        'correct', case when v_series[v_hist + r + 2] > v_series[v_hist + r + 1] then 0 else 1 end,
        'value', round(v_series[v_hist + r + 2] / 100.0, 2), 'unit', '€', 'decimals', 2));
    end loop;
    return jsonb_build_object('questions', v_list, 'series', to_jsonb(v_series));
  elsif p_kind = 'auction' then
    for q in select x from jsonb_array_elements(cfg -> 'auctionItems') x order by random() limit v_rounds loop
      v_list := v_list || jsonb_build_array(jsonb_build_object('q', q ->> 'name', 'points', (q ->> 'points')::integer,
                                                               'icon', q ->> 'icon'));
    end loop;
    return jsonb_build_object('questions', v_list);
  end if;
  return '{}'::jsonb;
end;
$$;

-- ---------------------------------------------------------------------------
-- C. Judging (vaultEval, tickerEval, higherEval, auctionEval in rounds-more.ts)
-- ---------------------------------------------------------------------------
-- {"closed", "hearts", "points", "time", "out", "results", "done", "finish_ms", "ranking", "budget"}
create or replace function public.battle_rounds_eval_more(p_battle public.battles, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g        jsonb := p_battle.params -> 'game';
  v_kind   text := p_battle.kind;
  v_ms     bigint := public.battle_ms(p_battle.started_at, p_now);
  v_answer integer := (g ->> 'answerMs')::integer;
  n        integer;
  v_rounds integer;
  v_closed integer := 0;
  v_hearts integer;
  hearts integer[]; points integer[]; times bigint[]; outr integer[]; lft integer[]; budget integer[];
  v_alive  integer[];
  v_losers integer[];
  v_res    jsonb := '[]'::jsonb;
  v_ans    jsonb;
  v_lost   integer[];
  v_done   boolean := false;
  v_last   integer := -1;
  v_finish bigint;
  t        integer[];
  r integer; i integer; k integer;
  a        record;
  v_right  boolean;
  v_pts    integer;
  v_code   text;
  v_tries  integer;
  v_crack  integer;
  v_cms    bigint;
  v_lms    bigint;
  v_first  boolean;
  v_items  integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  select count(*)::integer into n from public.battle_players p where p.battle_id = p_battle.id and p.slot is not null;
  v_rounds := least((g ->> 'rounds')::integer, coalesce(jsonb_array_length(p_battle.plan -> 'questions'), 0));
  v_hearts := case when v_kind = 'higher'
                   then case when n <= (g ->> 'smallGroup')::integer then (g ->> 'heartsSmall')::integer
                             else (g ->> 'heartsLarge')::integer end
                   else 1 end;
  hearts := array_fill(v_hearts, array[greatest(n, 1)]);
  points := array_fill(0, array[greatest(n, 1)]);
  times := array_fill(0::bigint, array[greatest(n, 1)]);
  outr := array_fill(-1, array[greatest(n, 1)]);
  lft := array_fill(-1, array[greatest(n, 1)]);
  budget := array_fill(coalesce((g ->> 'budget')::integer, 0), array[greatest(n, 1)]);
  -- the round a player left in
  for a in select p.slot, p.left_at from public.battle_players p
            where p.battle_id = p_battle.id and p.slot is not null and p.left_at is not null loop
    k := 0;
    while k < v_rounds - 1 and public.battle_ms(p_battle.started_at, a.left_at) >= (public.battle_round_ms(p_battle, k))[3] loop
      k := k + 1;
    end loop;
    lft[a.slot + 1] := k;
  end loop;
  while v_closed < v_rounds and v_ms >= (public.battle_round_ms(p_battle, v_closed))[2] loop
    v_closed := v_closed + 1;
  end loop;
  r := 0;
  while r < v_closed and not v_done loop
    t := public.battle_round_ms(p_battle, r);
    for i in 1 .. n loop
      if outr[i] < 0 and lft[i] >= 0 and lft[i] <= r then outr[i] := r; end if;
    end loop;
    v_alive := '{}';
    for i in 1 .. n loop
      if outr[i] < 0 then v_alive := v_alive || i; end if;
    end loop;
    v_losers := '{}';
    v_ans := '[]'::jsonb;
    v_lost := '{}';
    if v_kind = 'vault' then
      v_code := p_battle.plan -> 'questions' -> r ->> 'code';
      foreach i in array v_alive loop
        select count(*)::integer, min(z.n) filter (where z.code = v_code), max(z.ms)
          into v_tries, v_crack, v_lms
          from (select x.n, x.code, public.battle_ms(p_battle.started_at, x.guessed_at) - t[1] as ms
                  from public.battle_guesses x join public.battle_players p on p.battle_id = x.battle_id and p.player_id = x.player_id
                 where x.battle_id = p_battle.id and x.round = r and p.slot = i - 1
                 order by x.n limit (g ->> 'maxTries')::integer) z;
        v_cms := null;
        if v_crack is not null then
          select public.battle_ms(p_battle.started_at, x.guessed_at) - t[1] into v_cms
            from public.battle_guesses x join public.battle_players p on p.battle_id = x.battle_id and p.player_id = x.player_id
           where x.battle_id = p_battle.id and x.round = r and p.slot = i - 1 and x.n = v_crack;
        end if;
        v_pts := case when v_cms is not null
                      then (g ->> 'basePoints')::integer
                           + ((g ->> 'speedPoints')::integer * greatest(0, least(v_answer, v_answer - v_cms))) / v_answer
                           + (g ->> 'tryBonus')::integer * greatest(0, (g ->> 'maxTries')::integer - v_crack)
                      else 0 end;
        points[i] := points[i] + v_pts;
        times[i] := times[i] + case when v_cms is not null then least(v_answer, greatest(0, v_cms)) else v_answer end;
        if v_tries > 0 then
          v_ans := v_ans || jsonb_build_array(jsonb_build_object('slot', i - 1, 'choice', coalesce(v_crack, v_tries),
            'ms', coalesce(v_cms, v_lms), 'points', v_pts, 'right', v_cms is not null));
        end if;
      end loop;
    elsif v_kind in ('ticker', 'higher') then
      foreach i in array v_alive loop
        select x.choice, public.battle_ms(p_battle.started_at, x.answered_at) - t[1] as ms into a
          from public.battle_answers x join public.battle_players p on p.battle_id = x.battle_id and p.player_id = x.player_id
         where x.battle_id = p_battle.id and x.round = r and p.slot = i - 1 and x.answered_at is not null;
        v_right := a.ms is not null and a.choice = (p_battle.plan -> 'questions' -> r ->> 'correct')::integer;
        v_pts := case when v_right
                      then (g ->> 'basePoints')::integer
                           + ((g ->> 'speedPoints')::integer * greatest(0, least(v_answer, v_answer - a.ms))) / v_answer
                      when v_kind = 'ticker' and a.ms is not null then -(g ->> 'wrongPoints')::integer
                      else 0 end;
        points[i] := points[i] + v_pts;
        if v_kind = 'ticker' then
          times[i] := times[i] + case when v_right then least(v_answer, greatest(0, a.ms)) else v_answer end;
        else
          times[i] := times[i] + case when a.ms is not null then least(v_answer, greatest(0, a.ms)) else v_answer end;
        end if;
        if a.ms is not null then
          v_ans := v_ans || jsonb_build_array(jsonb_build_object('slot', i - 1, 'choice', a.choice, 'ms', a.ms,
                                                                 'points', v_pts, 'right', v_right));
        end if;
        if not v_right then v_losers := v_losers || i; end if;
      end loop;
      -- hearts in Mehr oder Weniger (not when that would be everyone still in)
      if v_kind = 'higher' and cardinality(v_losers) > 0 and cardinality(v_losers) < cardinality(v_alive) then
        foreach i in array v_losers loop
          hearts[i] := hearts[i] - 1;
          if hearts[i] <= 0 then outr[i] := r; end if;
          v_lost := v_lost || (i - 1);
        end loop;
      end if;
    else
      -- the auction: the highest bid above zero wins (then the earlier one, then the lot)
      v_items := (p_battle.plan -> 'questions' -> r ->> 'points')::integer;
      v_first := true;
      for a in
        select p.slot, (x.value_e4 / 10000)::integer as bid, public.battle_ms(p_battle.started_at, x.answered_at) - t[1] as ms
          from public.battle_answers x join public.battle_players p on p.battle_id = x.battle_id and p.player_id = x.player_id
         where x.battle_id = p_battle.id and x.round = r and x.value_e4 is not null and x.answered_at is not null
           and p.slot + 1 = any (v_alive) and x.value_e4 >= 0 and x.value_e4 / 10000 <= budget[p.slot + 1]
         order by x.value_e4 desc, 3, public.battle_hash(p_battle.seed, 999, p.slot)
      loop
        v_right := v_first and a.bid > 0;
        v_first := false;
        if v_right then
          points[a.slot + 1] := points[a.slot + 1] + v_items;
          budget[a.slot + 1] := budget[a.slot + 1] - a.bid;
        end if;
        times[a.slot + 1] := times[a.slot + 1] + least(v_answer, greatest(0, a.ms));
        v_ans := v_ans || jsonb_build_array(jsonb_build_object('slot', a.slot, 'value', a.bid, 'ms', a.ms,
                                                               'points', case when v_right then v_items else 0 end,
                                                               'right', v_right));
      end loop;
    end if;
    v_res := v_res || jsonb_build_array(jsonb_build_object('round', r, 'answers', v_ans, 'lost', to_jsonb(v_lost)));
    v_last := r;
    if (select count(*) from unnest(outr) o where o < 0) <= 1 or r = v_rounds - 1 then v_done := true; end if;
    r := r + 1;
  end loop;
  if n > 0 and (select count(*) from unnest(outr) o where o < 0) <= 1 then v_done := true; end if;
  v_finish := case when v_last >= 0 then (public.battle_round_ms(p_battle, v_last))[3] else 0 end;
  k1 := array_fill(0, array[greatest(n, 1)]); k2 := k1; k3 := k1;
  for i in 1 .. n loop
    if v_kind = 'higher' then
      k1[i] := case when outr[i] < 0 then 1000000 else outr[i] end;
      k2[i] := hearts[i] * 1000000 + points[i];
    elsif v_kind = 'auction' then
      k1[i] := case when outr[i] < 0 then 1 else 0 end;
      k2[i] := points[i] * 10000 + budget[i];
    else
      k1[i] := case when outr[i] < 0 then 1 else 0 end;
      k2[i] := points[i];
    end if;
    k3[i] := -least(times[i], 2000000000)::integer;
  end loop;
  return jsonb_build_object('closed', v_closed, 'hearts', to_jsonb(hearts[1:n]), 'points', to_jsonb(points[1:n]),
                            'time', to_jsonb(times[1:n]), 'out', to_jsonb(outr[1:n]), 'results', v_res, 'done', v_done,
                            'finish_ms', v_finish, 'budget', to_jsonb(budget[1:n]),
                            'ranking', to_jsonb(public.battle_rank(p_battle.seed, n, k1, k2, k3)));
end;
$$;

-- ---------------------------------------------------------------------------
-- D. What the client sees of a round beyond the quiz fields
-- ---------------------------------------------------------------------------
create or replace function public.battle_round_extra(p_battle public.battles, p_round integer, p_viewer uuid,
                                                     p_slot integer, p_closed boolean, p_eval jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g jsonb := p_battle.params -> 'game';
  q jsonb := p_battle.plan -> 'questions' -> p_round;
begin
  if p_battle.kind = 'vault' then
    return jsonb_build_object(
      'digits', (g ->> 'digits')::integer, 'symbols', (g ->> 'symbols')::integer,
      'guesses', coalesce((select jsonb_agg(jsonb_build_object('code', x.code, 'hits', x.hits, 'near', x.near) order by x.n)
                             from public.battle_guesses x
                            where x.battle_id = p_battle.id and x.round = p_round and x.player_id = p_viewer), '[]'::jsonb),
      'progress', coalesce((select jsonb_agg(jsonb_build_object(
                              'slot', p.slot,
                              'tries', (select count(*) from public.battle_guesses x
                                         where x.battle_id = p_battle.id and x.round = p_round and x.player_id = p.player_id),
                              'cracked', exists (select 1 from public.battle_answers x
                                                  where x.battle_id = p_battle.id and x.round = p_round
                                                    and x.player_id = p.player_id and x.answered_at is not null))
                              order by p.slot)
                             from public.battle_players p where p.battle_id = p_battle.id and p.slot is not null), '[]'::jsonb),
      'code', case when p_closed then q ->> 'code' end);
  elsif p_battle.kind = 'higher' then
    return jsonb_build_object('chart', (select jsonb_agg(round(x::numeric / 100, 2) order by o)
                                          from jsonb_array_elements_text(p_battle.plan -> 'series') with ordinality s(x, o)
                                         where o <= (g ->> 'history')::integer + p_round + 1));
  elsif p_battle.kind = 'auction' then
    return jsonb_build_object('item_points', (q ->> 'points')::integer, 'icon', q ->> 'icon',
                              'budget', case when p_slot is not null then p_eval -> 'budget' -> p_slot end,
                              'budgets', p_eval -> 'budget');
  end if;
  return '{}'::jsonb;
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Answers: checked here, after battle_answer checked the battle, the player and the open round
-- ---------------------------------------------------------------------------
create or replace function public.battle_answer_more(p_battle public.battles, p_player uuid, p_slot integer,
                                                     p_round integer, p_choice integer, p_value numeric,
                                                     p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g       jsonb := p_battle.params -> 'game';
  v_code  text;
  v_guess text;
  v_tries integer;
  v_hits  integer := 0;
  v_near  integer := 0;
  v_eval  jsonb;
  k       integer;
begin
  if p_battle.kind = 'vault' then
    v_guess := p_choice::text;
    if p_choice is null or p_choice <= 0
       or v_guess !~ ('^[1-' || (g ->> 'symbols') || ']{' || (g ->> 'digits') || '}$')
       or (select count(distinct c) from regexp_split_to_table(v_guess, '') c) <> (g ->> 'digits')::integer then
      perform public.api_error('invalid_argument');
    end if;
    -- one try after the other per player
    perform 1 from public.battle_players x where x.battle_id = p_battle.id and x.player_id = p_player for update;
    if exists (select 1 from public.battle_answers x where x.battle_id = p_battle.id and x.round = p_round
                  and x.player_id = p_player and x.answered_at is not null) then
      perform public.api_error('battle_round_closed');
    end if;
    select count(*)::integer into v_tries from public.battle_guesses x
     where x.battle_id = p_battle.id and x.round = p_round and x.player_id = p_player;
    if v_tries >= (g ->> 'maxTries')::integer then
      perform public.api_error('battle_round_closed');
    end if;
    v_code := p_battle.plan -> 'questions' -> p_round ->> 'code';
    for k in 1 .. char_length(v_guess) loop
      if substr(v_guess, k, 1) = substr(v_code, k, 1) then v_hits := v_hits + 1;
      elsif position(substr(v_guess, k, 1) in v_code) > 0 then v_near := v_near + 1;
      end if;
    end loop;
    insert into public.battle_guesses (battle_id, round, player_id, n, code, hits, near, guessed_at)
    values (p_battle.id, p_round, p_player, v_tries + 1, v_guess, v_hits, v_near, p_now);
    if v_hits = char_length(v_code) then
      insert into public.battle_answers (battle_id, round, player_id, choice, answered_at)
      values (p_battle.id, p_round, p_player, v_tries + 1, p_now)
      on conflict (battle_id, round, player_id) do nothing;
    end if;
    return;
  end if;
  if p_battle.kind = 'ticker' and (p_choice is null or p_choice < 0 or p_choice >= (g ->> 'options')::integer) then
    perform public.api_error('invalid_argument');
  end if;
  if p_battle.kind = 'higher' and (p_choice is null or p_choice not in (0, 1)) then
    perform public.api_error('invalid_argument');
  end if;
  if p_battle.kind = 'auction' then
    if p_value is null or p_value < 0 or p_value <> trunc(p_value) then
      perform public.api_error('invalid_argument');
    end if;
    -- never more than what is left
    v_eval := public.battle_rounds_eval_more(p_battle, p_now);
    if p_value > coalesce((v_eval -> 'budget' ->> p_slot)::integer, 0) then
      perform public.api_error('invalid_argument');
    end if;
  end if;
  insert into public.battle_answers (battle_id, round, player_id, choice, value_e4, answered_at)
  values (p_battle.id, p_round, p_player, case when p_battle.kind <> 'auction' then p_choice end,
          case when p_battle.kind = 'auction' then (p_value * 10000)::bigint end, p_now)
  on conflict (battle_id, round, player_id) do update
     set choice = excluded.choice, value_e4 = excluded.value_e4, answered_at = excluded.answered_at
   where public.battle_answers.answered_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Wiring into the round games of 4720 (patched by replace, so other patches of these functions stay)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text;
begin
  -- the plan
  v_def := pg_get_functiondef('public.battle_plan(text, jsonb)'::regprocedure);
  if position('battle_plan_more' in v_def) = 0 then
    v_def := replace(v_def, $q$begin
  if p_kind = 'quiz' then$q$, $q$begin
  if p_kind in ('vault', 'ticker', 'higher', 'auction') then
    return public.battle_plan_more(p_kind, p_params);
  end if;
  if p_kind = 'quiz' then$q$);
    if position('battle_plan_more' in v_def) = 0 then
      raise exception 'battle_plan() has an unexpected shape; add the new round games by hand';
    end if;
    execute v_def;
  end if;
  -- the timing: like the quiz
  v_def := pg_get_functiondef('public.battle_round_ms(public.battles, integer)'::regprocedure);
  if position('''auction''' in v_def) = 0 then
    v_def := replace(v_def, $q$if p_battle.kind in ('quiz', 'estimate') then$q$,
                     $q$if p_battle.kind in ('quiz', 'estimate', 'vault', 'ticker', 'higher', 'auction') then$q$);
    if position('''auction''' in v_def) = 0 then
      raise exception 'battle_round_ms() has an unexpected shape; add the new round games by hand';
    end if;
    execute v_def;
  end if;
  -- the judging
  v_def := pg_get_functiondef('public.battle_rounds_eval(public.battles, timestamptz)'::regprocedure);
  if position('battle_rounds_eval_more' in v_def) = 0 then
    v_def := replace(v_def, $q$begin
  select count(*)::integer into n from public.battle_players p where p.battle_id = p_battle.id and p.slot is not null;
  v_rounds := case v_kind when 'bell'$q$, $q$begin
  if v_kind in ('vault', 'ticker', 'higher', 'auction') then
    return public.battle_rounds_eval_more(p_battle, p_now);
  end if;
  select count(*)::integer into n from public.battle_players p where p.battle_id = p_battle.id and p.slot is not null;
  v_rounds := case v_kind when 'bell'$q$);
    if position('battle_rounds_eval_more' in v_def) = 0 then
      raise exception 'battle_rounds_eval() has an unexpected shape; add the new round games by hand';
    end if;
    execute v_def;
  end if;
  -- what the client sees
  v_def := pg_get_functiondef('public.battle_rounds_json(public.battles, uuid, timestamptz)'::regprocedure);
  if position('battle_round_extra' in v_def) = 0 then
    v_def := replace(v_def, $q$    if r < jsonb_array_length(v_eval -> 'results') then$q$,
                     $q$    v_item := v_item || public.battle_round_extra(p_battle, r, p_viewer, v_slot, v_ms >= t[2], v_eval);
    if r < jsonb_array_length(v_eval -> 'results') then$q$);
    if position('battle_round_extra' in v_def) = 0 then
      raise exception 'battle_rounds_json() has an unexpected shape; add the new round games by hand';
    end if;
    execute v_def;
  end if;
  -- the answers
  v_def := pg_get_functiondef('public.battle_answer(uuid, bigint, integer, integer, numeric)'::regprocedure);
  if position('battle_answer_more' in v_def) = 0 then
    v_def := replace(v_def, $q$  if b.kind = 'quiz' and (p_choice is null or p_choice < 0 or p_choice > 3) then$q$,
                     $q$  if b.kind in ('vault', 'ticker', 'higher', 'auction') then
    perform public.battle_answer_more(b, v_player, p.slot, p_round, p_choice, p_value, v_now);
    return public.request_complete(v_player, p_request_id, public.battle_state(v_player, v_now));
  end if;
  if b.kind = 'quiz' and (p_choice is null or p_choice < 0 or p_choice > 3) then$q$);
    if position('battle_answer_more' in v_def) = 0 then
      raise exception 'battle_answer() has an unexpected shape; add the new round games by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

do $do$
declare
  f text;
begin
  foreach f in array array[
    'public.battle_plan_more(text, jsonb)', 'public.battle_rounds_eval_more(public.battles, timestamptz)',
    'public.battle_round_extra(public.battles, integer, uuid, integer, boolean, jsonb)',
    'public.battle_answer_more(public.battles, uuid, integer, integer, integer, numeric, timestamptz)',
    'public.battle_plan(text, jsonb)', 'public.battle_round_ms(public.battles, integer)',
    'public.battle_rounds_eval(public.battles, timestamptz)', 'public.battle_rounds_json(public.battles, uuid, timestamptz)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  execute 'revoke all on function public.battle_answer(uuid, bigint, integer, integer, numeric) from public, anon';
  execute 'grant execute on function public.battle_answer(uuid, bigint, integer, integer, numeric) to authenticated';
end;
$do$;
