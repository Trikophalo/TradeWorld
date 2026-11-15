-- =============================================================================
-- NEXA · 4900 · News battles: six more action games as PL/pgSQL (ADR-160, addendum)
-- =============================================================================
-- Bärenjagd (bear), Dividenden-Dash (dash), Margin Call (margin), Fahrstuhl zum Mond (elevator), Laserschranke
-- (laser) and Bullen-Rodeo (rodeo): the same integer simulations as src/lib/sim/battle/{bear,dash,margin,elevator,
-- laser,rodeo}.ts, with the same arguments and answer as the games of 4710 (battle_sim_floor ...). A change to the
-- TypeScript rules must be made here too; supabase/tests/9x_battle_games.sql and src/lib/sim/battle/vectors.test.ts
-- run both against the same inputs and expect the same results.
--   battle_sim(kind, seed, params, streams, until)   redefined with all twelve games
--   battle_is_tick(kind)                            patched (replace): the new games are action games
--   battles.kind                                    the check takes the new games
-- Internal helpers: no grants. Idempotent: runs unchanged as supabase/updates/20261204004900_battle_sims_more.sql.

-- ---------------------------------------------------------------------------
-- Bärenjagd (src/lib/sim/battle/bear.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_bear(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  g        jsonb := p_params -> 'game';
  w        integer := (p_params ->> 'w')::integer;
  h        integer := (p_params ->> 'h')::integer;
  st       integer := (p_params ->> 'stepTicks')::integer;
  disc     integer := (p_params ->> 'disconnectTicks')::integer;
  n        integer := coalesce(array_length(p_streams, 1), 0);
  len      integer := greatest(p_until, 1);
  g_max    integer := (g ->> 'maxTicks')::integer;
  g_sstart integer := (g ->> 'stepStart')::integer;
  g_smin   integer := (g ->> 'stepMin')::integer;
  g_severy integer := (g ->> 'speedEvery')::integer;
  g_eat    integer := (g ->> 'eatTicks')::integer;
  den_x    integer := (g #>> '{den,0}')::integer;
  den_y    integer := (g #>> '{den,1}')::integer;
  btick    integer[];
  nbt      integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[]; ox integer[]; oy integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  lot      bigint[];
  wall     boolean[];
  nb       integer := 0;
  bear_x integer[]; bear_y integer[]; bear_fx integer[]; bear_fy integer[]; bnext integer[]; beat integer[]; bmoved boolean[];
  cx integer[]; cy integer[];
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; k integer; c integer; nx integer; ny integer; alive integer;
  v_target integer; v_bd integer; v_bl bigint; v_d integer; v_dx integer; v_dy integer; v_sx integer; v_sy integer;
  v_flip integer; v_step integer; v_taken boolean; v_on boolean; v_swap boolean;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, coalesce(g -> 'spawns', p_params -> 'spawns'));
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  outt := array_fill(-1, array[n]);
  select array_agg(public.battle_hash(p_seed, 601, s) order by s) into lot from generate_series(0, n - 1) s;
  select array_agg(x::integer order by o) into btick from jsonb_array_elements_text(g -> 'bearTicks') with ordinality z(x, o);
  nbt := coalesce(array_length(btick, 1), 0);
  wall := array_fill(false, array[w * h]);
  for k in 0 .. coalesce(jsonb_array_length(g -> 'pillars'), 0) - 1 loop
    wall[(g -> 'pillars' -> k ->> 1)::integer * w + (g -> 'pillars' -> k ->> 0)::integer + 1] := true;
  end loop;
  bear_x := array_fill(den_x, array[greatest(nbt, 1)]); bear_y := array_fill(den_y, array[greatest(nbt, 1)]);
  bear_fx := bear_x; bear_fy := bear_y;
  bnext := array_fill(0, array[greatest(nbt, 1)]); beat := bnext;
  while not done and t < p_until loop
    -- inputs
    for i in 1 .. n loop
      code[i] := -1;
      continue when outt[i] >= 0;
      b := get_byte(v_in, (i - 1) * len + t);
      if b = 113 then outt[i] := t; continue; end if;
      if b between 48 and 57 then
        xr[i] := 0; code[i] := b - 48;
      else
        xr[i] := xr[i] + 1;
        if xr[i] >= disc then outt[i] := t; end if;
      end if;
    end loop;
    -- advance
    for i in 1 .. n loop
      if outt[i] < 0 then
        if mv[i] > 0 then mv[i] := mv[i] - 1; end if;
        if stun[i] > 0 then stun[i] := stun[i] - 1; end if;
      end if;
    end loop;
    ox := px; oy := py;
    -- walk (not through pillars; into a bear: caught)
    for i in 1 .. n loop
      want[i] := 0;
      continue when outt[i] >= 0 or mv[i] > 0 or stun[i] > 0 or code[i] <= 0;
      d := code[i] % 5;
      continue when d = 0;
      nx := px[i] + dx[d + 1]; ny := py[i] + dy[d + 1];
      if nx >= 0 and ny >= 0 and nx < w and ny < h and not wall[ny * w + nx + 1] then
        tx[i] := nx; ty[i] := ny; want[i] := 1;
      end if;
    end loop;
    for i in 1 .. n loop
      go[i] := want[i];
      continue when want[i] = 0;
      for j in 1 .. n loop
        continue when j = i or outt[j] >= 0;
        if px[j] = tx[i] and py[j] = ty[i] then go[i] := 0;
        elsif want[j] = 1 and tx[j] = tx[i] and ty[j] = ty[i] then go[i] := 0;
        end if;
      end loop;
    end loop;
    for i in 1 .. n loop
      if go[i] = 1 then px[i] := tx[i]; py[i] := ty[i]; mv[i] := st; steps[i] := steps[i] + 1; end if;
    end loop;
    -- a new bear leaves the den
    if nb < nbt and t >= btick[nb + 1] then
      nb := nb + 1;
      bear_x[nb] := den_x; bear_y[nb] := den_y; bear_fx[nb] := den_x; bear_fy[nb] := den_y;
      bnext[nb] := t + g_sstart;
    end if;
    bmoved := array_fill(false, array[greatest(nbt, 1)]);
    for k in 1 .. nb loop
      continue when t < bnext[k] or t < beat[k];
      v_target := 0;
      for i in 1 .. n loop
        continue when outt[i] >= 0;
        v_d := abs(px[i] - bear_x[k]) + abs(py[i] - bear_y[k]);
        if v_target = 0 or v_d < v_bd or (v_d = v_bd and lot[i] < v_bl) then
          v_target := i; v_bd := v_d; v_bl := lot[i];
        end if;
      end loop;
      continue when v_target = 0;
      v_dx := px[v_target] - bear_x[k]; v_dy := py[v_target] - bear_y[k];
      v_sx := case when v_dx > 0 then 1 when v_dx < 0 then -1 else 0 end;
      v_sy := case when v_dy > 0 then 1 when v_dy < 0 then -1 else 0 end;
      v_flip := case when public.battle_hash(p_seed, 602, t) % 2 = 1 then -1 else 1 end;
      cx := '{}'; cy := '{}';
      if abs(v_dx) >= abs(v_dy) then
        if v_sx <> 0 then cx := cx || v_sx; cy := cy || 0; end if;
        if v_sy <> 0 then cx := cx || 0; cy := cy || v_sy; end if;
        cx := cx || array[0, 0]; cy := cy || array[v_flip, -v_flip];
      else
        if v_sy <> 0 then cx := cx || 0; cy := cy || v_sy; end if;
        if v_sx <> 0 then cx := cx || v_sx; cy := cy || 0; end if;
        cx := cx || array[v_flip, -v_flip]; cy := cy || array[0, 0];
      end if;
      v_step := greatest(g_smin, g_sstart - t / g_severy);
      bnext[k] := t + v_step;
      for c in 1 .. array_length(cx, 1) loop
        nx := bear_x[k] + cx[c]; ny := bear_y[k] + cy[c];
        continue when nx < 0 or ny < 0 or nx >= w or ny >= h or wall[ny * w + nx + 1];
        v_taken := false;
        for j in 1 .. nb loop
          if j <> k and bear_x[j] = nx and bear_y[j] = ny then v_taken := true; end if;
        end loop;
        continue when v_taken;
        bear_fx[k] := bear_x[k]; bear_fy[k] := bear_y[k]; bear_x[k] := nx; bear_y[k] := ny; bmoved[k] := true;
        exit;
      end loop;
    end loop;
    -- caught: on the bear's tile, or swapped tiles with it
    for k in 1 .. nb loop
      for i in 1 .. n loop
        continue when outt[i] >= 0;
        v_on := px[i] = bear_x[k] and py[i] = bear_y[k];
        v_swap := bmoved[k] and (ox[i] <> px[i] or oy[i] <> py[i]) and ox[i] = bear_x[k] and oy[i] = bear_y[k]
                  and px[i] = bear_fx[k] and py[i] = bear_fy[k];
        continue when not v_on and not v_swap;
        outt[i] := t;
        beat[k] := t + g_eat;
      end loop;
    end loop;
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then alive := alive + 1; end if;
    end loop;
    if (n >= 2 and alive <= 1) or alive = 0 or t + 1 >= g_max then done := true; endt := t; end if;
    t := t + 1;
  end loop;
  k1 := array_fill(0, array[n]); k2 := k1; k3 := k1;
  for i in 1 .. n loop
    k1[i] := case when outt[i] < 0 then 1000000 else outt[i] end;
    k2[i] := steps[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(steps));
end;
$$;

-- ---------------------------------------------------------------------------
-- Dividenden-Dash (src/lib/sim/battle/dash.ts)
-- ---------------------------------------------------------------------------
-- A free tile for coin number p_index: from the drawn tile on, the first without an alive player or a coin
create or replace function public.battle_dash_tile(p_seed bigint, p_index integer, p_size integer, p_occ integer[],
                                                   p_coins integer[])
returns integer
language plpgsql
immutable
as $$
declare
  v_start integer := (public.battle_hash(p_seed, 700, p_index) % p_size)::integer;
  v_tile  integer;
  k       integer;
begin
  for k in 0 .. p_size - 1 loop
    v_tile := (v_start + k) % p_size;
    continue when p_occ[v_tile + 1] > 0 or v_tile = any (coalesce(p_coins, '{}'));
    return v_tile;
  end loop;
  return v_start;
end;
$$;

create or replace function public.battle_sim_dash(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  g        jsonb := p_params -> 'game';
  w        integer := (p_params ->> 'w')::integer;
  h        integer := (p_params ->> 'h')::integer;
  st       integer := (p_params ->> 'stepTicks')::integer;
  disc     integer := (p_params ->> 'disconnectTicks')::integer;
  n        integer := coalesce(array_length(p_streams, 1), 0);
  len      integer := greatest(p_until, 1);
  g_max    integer := (g ->> 'maxTicks')::integer;
  g_target integer := (g ->> 'target')::integer;
  g_first  integer := (g ->> 'firstCoin')::integer;
  g_per    integer := (g ->> 'coinsPerPlayers')::integer;
  g_cmax   integer := (g ->> 'coinsMax')::integer;
  g_delay  integer := (g ->> 'spawnDelay')::integer;
  g_gevery integer := (g ->> 'goldEvery')::integer;
  g_gval   integer := (g ->> 'goldValue')::integer;
  g_stun   integer := (g ->> 'tackleStun')::integer;
  g_cool   integer := (g ->> 'tackleCool')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  score integer[]; reach integer[]; cool integer[];
  hi integer[]; hj integer[]; rk bigint[];
  ct integer[]; ca integer[]; cn integer[];
  occ integer[];
  v_count  integer;
  v_next   integer := 0;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; c integer; nx integer; ny integer; alive integer; v_tile integer;
  v_won boolean;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  score := mv; reach := mv; cool := mv;
  rk := array_fill(0::bigint, array[n]);
  outt := array_fill(-1, array[n]);
  occ := array_fill(0, array[w * h]);
  for i in 1 .. n loop
    occ[py[i] * w + px[i] + 1] := 1;
  end loop;
  v_count := least(g_cmax, 1 + n / g_per);
  ct := '{}'; ca := '{}'; cn := '{}';
  for c in 1 .. v_count loop
    ct := ct || public.battle_dash_tile(p_seed, v_next, w * h, occ, ct);
    ca := ca || g_first;
    cn := cn || v_next;
    v_next := v_next + 1;
  end loop;
  while not done and t < p_until loop
    for i in 1 .. n loop
      code[i] := -1;
      continue when outt[i] >= 0;
      b := get_byte(v_in, (i - 1) * len + t);
      if b = 113 then outt[i] := t; continue; end if;
      if b between 48 and 57 then
        xr[i] := 0; code[i] := b - 48;
      else
        xr[i] := xr[i] + 1;
        if xr[i] >= disc then outt[i] := t; end if;
      end if;
    end loop;
    for i in 1 .. n loop
      if outt[i] < 0 then
        if mv[i] > 0 then mv[i] := mv[i] - 1; end if;
        if stun[i] > 0 then stun[i] := stun[i] - 1; end if;
        if cool[i] > 0 then cool[i] := cool[i] - 1; end if;
      end if;
    end loop;
    -- walk; walking into someone with the action held is a tackle
    hi := '{}'; hj := '{}';
    for i in 1 .. n loop
      want[i] := 0;
      continue when outt[i] >= 0 or mv[i] > 0 or stun[i] > 0 or code[i] <= 0;
      d := code[i] % 5;
      continue when d = 0;
      nx := px[i] + dx[d + 1]; ny := py[i] + dy[d + 1];
      if nx >= 0 and ny >= 0 and nx < w and ny < h then
        tx[i] := nx; ty[i] := ny; want[i] := 1;
      end if;
    end loop;
    -- a tile two want goes to the one with fewer dividends, then by lot (walkContested)
    for i in 1 .. n loop
      rk[i] := case when want[i] = 1 then score[i]::bigint * 4294967296 + public.battle_hash(p_seed, 7000 + t, i - 1) else 0 end;
    end loop;
    for i in 1 .. n loop
      go[i] := want[i];
      continue when want[i] = 0;
      for j in 1 .. n loop
        continue when j = i or outt[j] >= 0;
        if px[j] = tx[i] and py[j] = ty[i] then
          go[i] := 0;
          if code[i] >= 5 and cool[i] = 0 then hi := hi || i; hj := hj || j; end if;
        elsif want[j] = 1 and tx[j] = tx[i] and ty[j] = ty[i] and rk[j] < rk[i] then go[i] := 0;
        end if;
      end loop;
    end loop;
    for i in 1 .. n loop
      if go[i] = 1 then px[i] := tx[i]; py[i] := ty[i]; mv[i] := st; steps[i] := steps[i] + 1; end if;
    end loop;
    for c in 1 .. coalesce(array_length(hi, 1), 0) loop
      stun[hj[c]] := greatest(stun[hj[c]], g_stun);
      cool[hi[c]] := g_cool;
    end loop;
    -- coins
    occ := array_fill(0, array[w * h]);
    for i in 1 .. n loop
      if outt[i] < 0 then occ[py[i] * w + px[i] + 1] := i; end if;
    end loop;
    for c in 1 .. v_count loop
      continue when t < ca[c];
      v_tile := ct[c];
      j := occ[v_tile + 1];
      continue when j = 0;
      score[j] := score[j] + case when (cn[c] + 1) % g_gevery = 0 then g_gval else 1 end;
      reach[j] := t;
      ct[c] := -1;
      ct[c] := public.battle_dash_tile(p_seed, v_next, w * h, occ, ct);
      ca[c] := t + g_delay;
      cn[c] := v_next;
      v_next := v_next + 1;
    end loop;
    v_won := false;
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then
        alive := alive + 1;
        if score[i] >= g_target then v_won := true; end if;
      end if;
    end loop;
    if v_won or (n >= 2 and alive <= 1) or alive = 0 or t + 1 >= g_max then done := true; endt := t; end if;
    t := t + 1;
  end loop;
  k1 := array_fill(0, array[n]); k2 := k1; k3 := k1;
  for i in 1 .. n loop
    k1[i] := case when outt[i] < 0 then 1 else 0 end;
    k2[i] := score[i];
    k3[i] := case when score[i] > 0 then -reach[i] else 0 end;
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(score));
end;
$$;

-- ---------------------------------------------------------------------------
-- Margin Call (src/lib/sim/battle/margin.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_margin(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  g        jsonb := p_params -> 'game';
  w        integer := (p_params ->> 'w')::integer;
  h        integer := (p_params ->> 'h')::integer;
  st       integer := (p_params ->> 'stepTicks')::integer;
  disc     integer := (p_params ->> 'disconnectTicks')::integer;
  n        integer := coalesce(array_length(p_streams, 1), 0);
  len      integer := greatest(p_until, 1);
  g_max    integer := (g ->> 'maxTicks')::integer;
  g_show   integer := (g ->> 'showTicks')::integer;
  g_smin   integer := (g ->> 'showMin')::integer;
  g_sstep  integer := (g ->> 'showStep')::integer;
  g_pause  integer := (g ->> 'pauseTicks')::integer;
  g_warm   integer := (g ->> 'warmupRounds')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  dist integer[]; safe integer[]; occ integer[]; failing integer[]; rk bigint[];
  v_round  integer := 0;
  v_call   integer := -1;
  v_nextr  integer := (g ->> 'firstRound')::integer;
  v_count  integer;
  v_best   integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; alive integer; v_tile integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  dist := mv;
  rk := array_fill(0::bigint, array[n]);
  outt := array_fill(-1, array[n]);
  safe := array_fill(0, array[w * h]);
  while not done and t < p_until loop
    for i in 1 .. n loop
      code[i] := -1;
      continue when outt[i] >= 0;
      b := get_byte(v_in, (i - 1) * len + t);
      if b = 113 then outt[i] := t; continue; end if;
      if b between 48 and 57 then
        xr[i] := 0; code[i] := b - 48;
      else
        xr[i] := xr[i] + 1;
        if xr[i] >= disc then outt[i] := t; end if;
      end if;
    end loop;
    for i in 1 .. n loop
      if outt[i] < 0 then
        if mv[i] > 0 then mv[i] := mv[i] - 1; end if;
        if stun[i] > 0 then stun[i] := stun[i] - 1; end if;
      end if;
    end loop;
    for i in 1 .. n loop
      want[i] := 0;
      continue when outt[i] >= 0 or mv[i] > 0 or stun[i] > 0 or code[i] <= 0;
      d := code[i] % 5;
      continue when d = 0;
      nx := px[i] + dx[d + 1]; ny := py[i] + dy[d + 1];
      if nx >= 0 and ny >= 0 and nx < w and ny < h then
        tx[i] := nx; ty[i] := ny; want[i] := 1;
      end if;
    end loop;
    -- a tile two want goes to one of them by lot (walkContested)
    for i in 1 .. n loop
      rk[i] := case when want[i] = 1 then public.battle_hash(p_seed, 5000 + t, i - 1) else 0 end;
    end loop;
    for i in 1 .. n loop
      go[i] := want[i];
      continue when want[i] = 0;
      for j in 1 .. n loop
        continue when j = i or outt[j] >= 0;
        if px[j] = tx[i] and py[j] = ty[i] then go[i] := 0;
        elsif want[j] = 1 and tx[j] = tx[i] and ty[j] = ty[i] and rk[j] < rk[i] then go[i] := 0;
        end if;
      end loop;
    end loop;
    for i in 1 .. n loop
      if go[i] = 1 then px[i] := tx[i]; py[i] := ty[i]; mv[i] := st; steps[i] := steps[i] + 1; end if;
    end loop;
    -- a round: safe tiles on free tiles, drawn from the seed
    if t = v_nextr then
      alive := 0;
      occ := array_fill(0, array[w * h]);
      for i in 1 .. n loop
        if outt[i] < 0 then alive := alive + 1; occ[py[i] * w + px[i] + 1] := 1; end if;
      end loop;
      v_count := greatest(1, alive - 1 + greatest(0, g_warm - v_round));
      safe := array_fill(0, array[w * h]);
      for v_tile in
        select z.ti from (select s.ti, public.battle_hash(p_seed, 800 + v_round, s.ti) as hh
                            from generate_series(0, w * h - 1) s(ti) where occ[s.ti + 1] = 0) z
         order by z.hh, z.ti limit v_count
      loop
        safe[v_tile + 1] := 1;
      end loop;
      v_call := t + greatest(g_smin, g_show - v_round * g_sstep);
      v_nextr := -1;
    end if;
    -- the gong
    if t = v_call then
      alive := 0;
      failing := '{}';
      for i in 1 .. n loop
        continue when outt[i] >= 0;
        alive := alive + 1;
        if safe[py[i] * w + px[i] + 1] <> 1 then failing := failing || i; end if;
      end loop;
      if coalesce(array_length(failing, 1), 0) < alive then
        foreach i in array failing loop
          v_best := 1000;
          for v_tile in 0 .. w * h - 1 loop
            if safe[v_tile + 1] = 1 then
              v_best := least(v_best, abs(v_tile % w - px[i]) + abs(v_tile / w - py[i]));
            end if;
          end loop;
          outt[i] := t;
          dist[i] := v_best;
        end loop;
      end if;
      v_round := v_round + 1;
      v_call := -1;
      v_nextr := t + g_pause;
    end if;
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then alive := alive + 1; end if;
    end loop;
    if (n >= 2 and alive <= 1) or alive = 0 or t + 1 >= g_max then done := true; endt := t; end if;
    t := t + 1;
  end loop;
  k1 := array_fill(0, array[n]); k2 := k1; k3 := k1;
  for i in 1 .. n loop
    k1[i] := case when outt[i] < 0 then 1000000 else outt[i] end;
    k2[i] := -dist[i];
    k3[i] := steps[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(dist));
end;
$$;

-- ---------------------------------------------------------------------------
-- Fahrstuhl zum Mond (src/lib/sim/battle/elevator.ts)
-- ---------------------------------------------------------------------------
-- The gaps of barrier row r as a bit mask over the columns (0: no barrier)
create or replace function public.battle_elevator_mask(p_seed bigint, p_game jsonb, p_w integer, p_r integer)
returns integer
language plpgsql
immutable
as $$
declare
  v_count integer;
  v_mask  integer := 0;
  x       integer;
begin
  if p_r <= 0 or p_r % (p_game ->> 'barrierEvery')::integer <> 0 then
    return 0;
  end if;
  v_count := greatest((p_game ->> 'gapMin')::integer,
                      (p_game ->> 'gapStart')::integer - p_r / (p_game ->> 'gapShrinkEvery')::integer);
  for x in select c from generate_series(0, p_w - 1) c order by public.battle_hash(p_seed, 900 + p_r, c), c limit v_count loop
    v_mask := v_mask | (1 << x);
  end loop;
  return v_mask;
end;
$$;

create or replace function public.battle_sim_elevator(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  g        jsonb := p_params -> 'game';
  w        integer := (p_params ->> 'w')::integer;
  h        integer := (p_params ->> 'h')::integer;
  st       integer := (p_params ->> 'stepTicks')::integer;
  disc     integer := (p_params ->> 'disconnectTicks')::integer;
  n        integer := coalesce(array_length(p_streams, 1), 0);
  len      integer := greatest(p_until, 1);
  g_max    integer := (g ->> 'maxTicks')::integer;
  g_rstart integer := (g ->> 'riseStart')::integer;
  g_rmin   integer := (g ->> 'riseMin')::integer;
  g_rstep  integer := (g ->> 'riseStep')::integer;
  g_revery integer := (g ->> 'riseStepEvery')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  best integer[];
  masks    integer[] := '{}';
  cam      integer := 0;
  rises    integer := 0;
  nextr    integer := (g ->> 'firstRise')::integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; alive integer; v_mask integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  outt := array_fill(-1, array[n]);
  best := py;
  while coalesce(array_length(masks, 1), 0) < cam + h loop
    masks := masks || public.battle_elevator_mask(p_seed, g, w, coalesce(array_length(masks, 1), 0));
  end loop;
  while not done and t < p_until loop
    for i in 1 .. n loop
      code[i] := -1;
      continue when outt[i] >= 0;
      b := get_byte(v_in, (i - 1) * len + t);
      if b = 113 then outt[i] := t; continue; end if;
      if b between 48 and 57 then
        xr[i] := 0; code[i] := b - 48;
      else
        xr[i] := xr[i] + 1;
        if xr[i] >= disc then outt[i] := t; end if;
      end if;
    end loop;
    for i in 1 .. n loop
      if outt[i] < 0 then
        if mv[i] > 0 then mv[i] := mv[i] - 1; end if;
        if stun[i] > 0 then stun[i] := stun[i] - 1; end if;
      end if;
    end loop;
    -- walk: inside the screen, not into a candle of a bar (row r = h - 1 - y)
    for i in 1 .. n loop
      want[i] := 0;
      continue when outt[i] >= 0 or mv[i] > 0 or stun[i] > 0 or code[i] <= 0;
      d := code[i] % 5;
      continue when d = 0;
      nx := px[i] + dx[d + 1]; ny := py[i] + dy[d + 1];
      continue when nx < 0 or nx >= w or ny > h - 1 or ny < -cam;
      v_mask := coalesce(masks[h - 1 - ny + 1], 0);
      if v_mask = 0 or (v_mask & (1 << nx)) <> 0 then
        tx[i] := nx; ty[i] := ny; want[i] := 1;
      end if;
    end loop;
    for i in 1 .. n loop
      go[i] := want[i];
      continue when want[i] = 0;
      for j in 1 .. n loop
        continue when j = i or outt[j] >= 0;
        if px[j] = tx[i] and py[j] = ty[i] then go[i] := 0;
        elsif want[j] = 1 and tx[j] = tx[i] and ty[j] = ty[i] then go[i] := 0;
        end if;
      end loop;
    end loop;
    for i in 1 .. n loop
      if go[i] = 1 then px[i] := tx[i]; py[i] := ty[i]; mv[i] := st; steps[i] := steps[i] + 1; end if;
    end loop;
    if t = nextr then
      cam := cam + 1;
      rises := rises + 1;
      nextr := t + greatest(g_rmin, g_rstart - (rises / g_revery) * g_rstep);
      while coalesce(array_length(masks, 1), 0) < cam + h loop
        masks := masks || public.battle_elevator_mask(p_seed, g, w, coalesce(array_length(masks, 1), 0));
      end loop;
    end if;
    for i in 1 .. n loop
      continue when outt[i] >= 0;
      if py[i] > h - 1 - cam then outt[i] := t; else best[i] := least(best[i], py[i]); end if;
    end loop;
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then alive := alive + 1; end if;
    end loop;
    if (n >= 2 and alive <= 1) or alive = 0 or t + 1 >= g_max then done := true; endt := t; end if;
    t := t + 1;
  end loop;
  k1 := array_fill(0, array[n]); k2 := k1; k3 := k1;
  for i in 1 .. n loop
    k1[i] := case when outt[i] < 0 then 1000000 else outt[i] end;
    k2[i] := -best[i];
    k3[i] := steps[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(best));
end;
$$;

-- ---------------------------------------------------------------------------
-- Laserschranke (src/lib/sim/battle/laser.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_laser(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  g        jsonb := p_params -> 'game';
  w        integer := (p_params ->> 'w')::integer;
  h        integer := (p_params ->> 'h')::integer;
  st       integer := (p_params ->> 'stepTicks')::integer;
  disc     integer := (p_params ->> 'disconnectTicks')::integer;
  n        integer := coalesce(array_length(p_streams, 1), 0);
  len      integer := greatest(p_until, 1);
  g_max    integer := (g ->> 'maxTicks')::integer;
  g_hearts integer := (g ->> 'hearts')::integer;
  g_every  integer := (g ->> 'spawnEvery')::integer;
  g_emin   integer := (g ->> 'spawnEveryMin')::integer;
  g_estep  integer := (g ->> 'spawnEveryStep')::integer;
  g_grow   integer := (g ->> 'countGrowEvery')::integer;
  g_cmax   integer := (g ->> 'countMax')::integer;
  g_stag   integer := (g ->> 'staggerTicks')::integer;
  g_warn   integer := (g ->> 'warnTicks')::integer;
  g_tpt    integer := (g ->> 'ticksPerTile')::integer;
  g_gap    integer := (g ->> 'gapPct')::integer;
  g_jump   integer := (g ->> 'jumpTicks')::integer;
  g_jcool  integer := (g ->> 'jumpCool')::integer;
  g_inv    integer := (g ->> 'invulnTicks')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  hearts integer[]; inv integer[]; air integer[]; jcool integer[]; held integer[];
  ll integer[] := '{}'; ld integer[] := '{}'; lg integer[] := '{}'; lt integer[] := '{}';
  nl       integer := 0;
  lfirst   integer := 1;
  spawn    integer := 0;
  nexts    integer := (g ->> 'firstSpawn')::integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; k integer; nx integer; ny integer; alive integer;
  r bigint; v_line integer; v_len integer; v_cnt integer; v_kk integer; v_at integer; v_act boolean;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  inv := mv; air := mv; jcool := mv; held := mv;
  hearts := array_fill(g_hearts, array[n]);
  outt := array_fill(-1, array[n]);
  while not done and t < p_until loop
    for i in 1 .. n loop
      code[i] := -1;
      continue when outt[i] >= 0;
      b := get_byte(v_in, (i - 1) * len + t);
      if b = 113 then outt[i] := t; continue; end if;
      if b between 48 and 57 then
        xr[i] := 0; code[i] := b - 48;
      else
        xr[i] := xr[i] + 1;
        if xr[i] >= disc then outt[i] := t; end if;
      end if;
    end loop;
    for i in 1 .. n loop
      if outt[i] < 0 then
        if mv[i] > 0 then mv[i] := mv[i] - 1; end if;
        if stun[i] > 0 then stun[i] := stun[i] - 1; end if;
      end if;
    end loop;
    -- jumps: a new press of the action, on the ground and rested
    for i in 1 .. n loop
      continue when outt[i] >= 0;
      if inv[i] > 0 then inv[i] := inv[i] - 1; end if;
      if air[i] > 0 then
        air[i] := air[i] - 1;
        if air[i] = 0 then jcool[i] := g_jcool; end if;
      elsif jcool[i] > 0 then
        jcool[i] := jcool[i] - 1;
      end if;
      v_act := code[i] >= 5;
      if v_act and held[i] = 0 and air[i] = 0 and jcool[i] = 0 then air[i] := g_jump; end if;
      held[i] := case when v_act then 1 else 0 end;
    end loop;
    for i in 1 .. n loop
      want[i] := 0;
      continue when outt[i] >= 0 or mv[i] > 0 or stun[i] > 0 or code[i] <= 0;
      d := code[i] % 5;
      continue when d = 0;
      nx := px[i] + dx[d + 1]; ny := py[i] + dy[d + 1];
      if nx >= 0 and ny >= 0 and nx < w and ny < h then
        tx[i] := nx; ty[i] := ny; want[i] := 1;
      end if;
    end loop;
    for i in 1 .. n loop
      go[i] := want[i];
      continue when want[i] = 0;
      for j in 1 .. n loop
        continue when j = i or outt[j] >= 0;
        if px[j] = tx[i] and py[j] = ty[i] then go[i] := 0;
        elsif want[j] = 1 and tx[j] = tx[i] and ty[j] = ty[i] then go[i] := 0;
        end if;
      end loop;
    end loop;
    for i in 1 .. n loop
      if go[i] = 1 then px[i] := tx[i]; py[i] := ty[i]; mv[i] := st; steps[i] := steps[i] + 1; end if;
    end loop;
    -- a wave of beams
    if t = nexts then
      v_cnt := least(g_cmax, 1 + spawn / g_grow);
      for k in 0 .. v_cnt - 1 loop
        r := public.battle_hash(p_seed, 1000 + spawn, k);
        v_line := (r % 2)::integer;
        ll := ll || v_line;
        ld := ld || case when (r / 2) % 2 = 0 then 1 else -1 end;
        lg := lg || case when ((r / 4) % 100)::integer < g_gap then ((r / 400) % (case when v_line = 0 then w else h end))::integer else -1 end;
        lt := lt || (t + g_warn + k * g_stag);
        nl := nl + 1;
      end loop;
      spawn := spawn + 1;
      nexts := t + greatest(g_emin, g_every - spawn * g_estep);
    end if;
    while lfirst <= nl loop
      exit when t < lt[lfirst] + (case when ll[lfirst] = 0 then h else w end) * g_tpt;
      lfirst := lfirst + 1;
    end loop;
    for k in lfirst .. nl loop
      continue when t < lt[k];
      v_len := case when ll[k] = 0 then h else w end;
      v_kk := (t - lt[k]) / g_tpt;
      continue when v_kk >= v_len;
      v_at := case when ld[k] > 0 then v_kk else v_len - 1 - v_kk end;
      for i in 1 .. n loop
        continue when outt[i] >= 0 or inv[i] > 0 or air[i] > 0;
        continue when (case when ll[k] = 0 then py[i] else px[i] end) <> v_at;
        continue when (case when ll[k] = 0 then px[i] else py[i] end) = lg[k];
        hearts[i] := hearts[i] - 1;
        inv[i] := g_inv;
        if hearts[i] <= 0 then outt[i] := t; end if;
      end loop;
    end loop;
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then alive := alive + 1; end if;
    end loop;
    if (n >= 2 and alive <= 1) or alive = 0 or t + 1 >= g_max then done := true; endt := t; end if;
    t := t + 1;
  end loop;
  k1 := array_fill(0, array[n]); k2 := k1; k3 := k1;
  for i in 1 .. n loop
    k1[i] := case when outt[i] < 0 then 1000000 else outt[i] end;
    k2[i] := hearts[i];
    k3[i] := steps[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(hearts));
end;
$$;

-- ---------------------------------------------------------------------------
-- Bullen-Rodeo (src/lib/sim/battle/rodeo.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_rodeo(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  g        jsonb := p_params -> 'game';
  disc     integer := (p_params ->> 'disconnectTicks')::integer;
  n        integer := coalesce(array_length(p_streams, 1), 0);
  len      integer := greatest(p_until, 1);
  g_max    integer := (g ->> 'maxTicks')::integer;
  g_grip   integer := (g ->> 'grip')::integer;
  g_wstart integer := (g ->> 'windowStart')::integer;
  g_wmin   integer := (g ->> 'windowMin')::integer;
  g_wstep  integer := (g ->> 'windowStep')::integer;
  g_gmin   integer := (g ->> 'gapMin')::integer;
  g_gjit   integer := (g ->> 'gapJitter')::integer;
  v_in     bytea;
  xr integer[]; outt integer[]; code integer[];
  grip integer[]; score integer[]; prev integer[]; resp integer[];
  v_cue    integer := 0;
  v_start  integer := -1;
  v_dir    integer := 0;
  v_win    integer := 0;
  v_next   integer := (g ->> 'firstCue')::integer;
  v_losers integer[];
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; b integer; d integer; alive integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  xr := array_fill(0, array[n]); code := xr; score := xr; prev := xr; resp := xr;
  grip := array_fill(g_grip, array[n]);
  outt := array_fill(-1, array[n]);
  while not done and t < p_until loop
    for i in 1 .. n loop
      code[i] := -1;
      continue when outt[i] >= 0;
      b := get_byte(v_in, (i - 1) * len + t);
      if b = 113 then outt[i] := t; continue; end if;
      if b between 48 and 57 then
        xr[i] := 0; code[i] := b - 48;
      else
        xr[i] := xr[i] + 1;
        if xr[i] >= disc then outt[i] := t; end if;
      end if;
    end loop;
    if t = v_next then
      v_start := t;
      v_dir := 1 + (public.battle_hash(p_seed, 1100, v_cue) % 4)::integer;
      v_win := greatest(g_wmin, g_wstart - v_cue * g_wstep);
      resp := array_fill(0, array[n]);
      v_next := -1;
    end if;
    -- the first new press in the window counts
    for i in 1 .. n loop
      continue when outt[i] >= 0;
      d := case when code[i] > 0 then code[i] % 5 else 0 end;
      if v_start >= 0 and resp[i] = 0 and d > 0 and d <> prev[i] then
        if d = v_dir then
          resp[i] := 1;
          score[i] := score[i] + v_win - (t - v_start);
        else
          resp[i] := 2;
        end if;
      end if;
      prev[i] := d;
    end loop;
    -- the end of the window: a grip off for every miss, unless everyone missed
    if v_start >= 0 and t = v_start + v_win - 1 then
      alive := 0;
      v_losers := '{}';
      for i in 1 .. n loop
        continue when outt[i] >= 0;
        alive := alive + 1;
        if resp[i] <> 1 then v_losers := v_losers || i; end if;
      end loop;
      if coalesce(array_length(v_losers, 1), 0) < alive then
        foreach i in array v_losers loop
          grip[i] := grip[i] - 1;
          if grip[i] <= 0 then outt[i] := t; end if;
        end loop;
      end if;
      v_cue := v_cue + 1;
      v_start := -1;
      v_next := t + 1 + g_gmin + (public.battle_hash(p_seed, 1101, v_cue) % g_gjit)::integer;
    end if;
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then alive := alive + 1; end if;
    end loop;
    if (n >= 2 and alive <= 1) or alive = 0 or t + 1 >= g_max then done := true; endt := t; end if;
    t := t + 1;
  end loop;
  k1 := array_fill(0, array[n]); k2 := k1; k3 := k1;
  for i in 1 .. n loop
    k1[i] := case when outt[i] < 0 then 1000000 else outt[i] end;
    k2[i] := grip[i];
    k3[i] := score[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(score));
end;
$$;

-- ---------------------------------------------------------------------------
-- One entry for all games (the definition of 4710 with the six new games)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim(p_kind text, p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
returns jsonb
language plpgsql
immutable
as $$
begin
  return case p_kind
    when 'floor' then public.battle_sim_floor(p_seed, p_params, p_streams, p_until)
    when 'bulls' then public.battle_sim_bulls(p_seed, p_params, p_streams, p_until)
    when 'coins' then public.battle_sim_coins(p_seed, p_params, p_streams, p_until)
    when 'sumo' then public.battle_sim_sumo(p_seed, p_params, p_streams, p_until)
    when 'potato' then public.battle_sim_potato(p_seed, p_params, p_streams, p_until)
    when 'pump' then public.battle_sim_pump(p_seed, p_params, p_streams, p_until)
    when 'bear' then public.battle_sim_bear(p_seed, p_params, p_streams, p_until)
    when 'dash' then public.battle_sim_dash(p_seed, p_params, p_streams, p_until)
    when 'margin' then public.battle_sim_margin(p_seed, p_params, p_streams, p_until)
    when 'elevator' then public.battle_sim_elevator(p_seed, p_params, p_streams, p_until)
    when 'laser' then public.battle_sim_laser(p_seed, p_params, p_streams, p_until)
    when 'rodeo' then public.battle_sim_rodeo(p_seed, p_params, p_streams, p_until)
    else null end;
end;
$$;

-- ---------------------------------------------------------------------------
-- The new games are action games; battles takes their kinds
-- ---------------------------------------------------------------------------
do $do$
declare
  v_def text := pg_get_functiondef('public.battle_is_tick(text)'::regprocedure);
begin
  if position('''rodeo''' in v_def) = 0 then
    v_def := replace(v_def, $q$'pump')$q$, $q$'pump', 'bear', 'dash', 'margin', 'elevator', 'laser', 'rodeo')$q$);
    if position('''rodeo''' in v_def) = 0 then
      raise exception 'battle_is_tick() has an unexpected shape; add the new action games by hand';
    end if;
    execute v_def;
  end if;
end;
$do$;

alter table public.battles drop constraint if exists battles_kind_check;
alter table public.battles add constraint battles_kind_check check (kind is null or kind in (
  'floor', 'bulls', 'coins', 'sumo', 'potato', 'pump', 'bear', 'dash', 'margin', 'elevator', 'laser', 'rodeo',
  'quiz', 'estimate', 'bell', 'vault', 'ticker', 'higher', 'auction'));

revoke all on function public.battle_sim_bear(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_dash_tile(bigint, integer, integer, integer[], integer[]) from public, anon, authenticated;
revoke all on function public.battle_sim_dash(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_margin(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_elevator_mask(bigint, jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.battle_sim_elevator(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_laser(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_rodeo(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim(text, bigint, jsonb, text[], integer) from public, anon, authenticated;
