-- ===== idempotent copy of migrations/20261204004710_battle_sims.sql =====
-- (the migration itself is written idempotently; keep both files identical below this line)
-- =============================================================================
-- NEXA · 4710 · News battles: the action games as PL/pgSQL (ADR-160)
-- =============================================================================
-- The same integer simulations as src/lib/sim/battle/*.ts, so the server decides who won from nothing but the seed
-- and the players' inputs (one character per player and tick, see battle_input in 3800). A change to the TypeScript
-- rules must be made here too; supabase/tests/9s_battles.sql and src/lib/sim/battle/vectors.test.ts run both
-- against the same inputs and expect the same results.
--
--   battle_hash(seed, a, b)                         the hash of src/lib/sim/battle/hash.ts (lowbias32)
--   battle_sim(kind, seed, params, streams, until)  -> {"done", "end_tick", "tick", "ranking": [slot, ...],
--                                                       "out": [tick | -1], "score": [...]}
--   battle_sim_floor | _bulls | _coins | _sumo | _potato | _pump: one per game, same arguments and answer.
-- params = battles.params: {"w", "h", "stepTicks", "spawns": [[x, y], ...], "disconnectTicks", "tps", "game": {...}}.
-- streams: one text per slot; ticks past the end of a stream count as "x" (no input).
-- Internal helpers: no grants. Idempotent: runs unchanged as supabase/updates/20261204004710_battle_sims.sql.

-- ---------------------------------------------------------------------------
-- The hash
-- ---------------------------------------------------------------------------
-- a * b modulo 2^32 for 0 <= a, b < 2^32, without overflowing bigint
create or replace function public.battle_mul32(a bigint, b bigint)
returns bigint
language sql
immutable
parallel safe
as $$
  select ((a * (b & 65535)) + (((a * (b >> 16)) & 65535) << 16)) & 4294967295;
$$;

create or replace function public.battle_mix32(p_value bigint)
returns bigint
language plpgsql
immutable
parallel safe
as $$
declare
  x bigint := p_value & 4294967295;
begin
  x := x # (x >> 16);
  x := ((x * 13613) + (((x * 32747) & 65535) << 16)) & 4294967295;   -- x * 0x7feb352d
  x := x # (x >> 15);
  x := ((x * 42635) + (((x * 33900) & 65535) << 16)) & 4294967295;   -- x * 0x846ca68b
  x := x # (x >> 16);
  return x;
end;
$$;

create or replace function public.battle_hash(p_seed bigint, p_a bigint, p_b bigint)
returns bigint
language plpgsql
immutable
parallel safe
as $$
declare
  v_first bigint;
begin
  v_first := public.battle_mix32((p_seed + public.battle_mul32(p_a, 2654435761) + 1779033703) & 4294967295);
  return public.battle_mix32((v_first + public.battle_mul32(p_b, 2246822519)) & 4294967295);
end;
$$;

-- All streams as one byte string, each padded with "x" (or cut) to p_len.
create or replace function public.battle_stream_bytes(p_streams text[], p_n integer, p_len integer)
returns bytea
language sql
immutable
as $$
  select convert_to(coalesce(string_agg(rpad(coalesce(p_streams[k], ''), greatest(p_len, 1), 'x'), '' order by k), ''), 'UTF8')
    from generate_series(1, p_n) k;
$$;

-- Spawn tiles in the order drawn from the seed: x and y per player (1-based arrays)
create or replace function public.battle_spawns(p_seed bigint, p_n integer, p_spawns jsonb)
returns table (sx integer[], sy integer[])
language plpgsql
immutable
as $$
declare
  v_order integer[];
  v_x integer[] := array_fill(0, array[p_n]);
  v_y integer[] := array_fill(0, array[p_n]);
  v_len integer := greatest(1, jsonb_array_length(p_spawns));
  k integer;
begin
  select array_agg(s order by public.battle_hash(p_seed, 1, s), s) into v_order from generate_series(0, p_n - 1) s;
  for k in 1 .. p_n loop
    v_x[v_order[k] + 1] := (p_spawns -> ((k - 1) % v_len) ->> 0)::integer;
    v_y[v_order[k] + 1] := (p_spawns -> ((k - 1) % v_len) ->> 1)::integer;
  end loop;
  return query select v_x, v_y;
end;
$$;

-- Slots from first to last: keys descending, then the lot (hash 999) ascending
create or replace function public.battle_rank(p_seed bigint, p_n integer, p_k1 integer[], p_k2 integer[], p_k3 integer[])
returns integer[]
language sql
immutable
as $$
  select coalesce(array_agg(s order by p_k1[s + 1] desc, p_k2[s + 1] desc, p_k3[s + 1] desc, public.battle_hash(p_seed, 999, s)),
                  '{}'::integer[])
    from generate_series(0, p_n - 1) s;
$$;

-- ---------------------------------------------------------------------------
-- Kurssturz (src/lib/sim/battle/floor.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_floor(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  g_first  integer := (g ->> 'firstWave')::integer;
  g_every  integer := (g ->> 'waveEvery')::integer;
  g_emin   integer := (g ->> 'waveEveryMin')::integer;
  g_estep  integer := (g ->> 'waveEveryStep')::integer;
  g_cstart integer := (g ->> 'crackStart')::integer;
  g_cmax   integer := (g ->> 'crackMax')::integer;
  g_cgrow  integer := (g ->> 'crackGrowEvery')::integer;
  g_warn   integer := (g ->> 'warnTicks')::integer;
  g_stomp  integer := (g ->> 'stompTicks')::integer;
  g_endg   integer := (g ->> 'endgameTiles')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; idle integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  crack    integer[];
  wave     integer := 0;
  nextw    integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; k integer; tile integer; alive integer;
  v_solid  integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; idle := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  outt := array_fill(-1, array[n]);
  crack := array_fill(0, array[w * h]);
  nextw := g_first;
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
    -- walk (holes are walkable: you fall)
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
    for i in 1 .. n loop
      if outt[i] < 0 then idle[i] := case when mv[i] = 0 then idle[i] + 1 else 0 end; end if;
    end loop;
    -- a wave of cracks
    if t = nextw then
      v_solid := 0;
      for k in 1 .. w * h loop
        if crack[k] = 0 then v_solid := v_solid + 1; end if;
      end loop;
      k := case when v_solid <= g_endg then 1 else least(g_cmax, g_cstart + wave / g_cgrow) end;
      for tile in
        select z.ti from (select s.ti, public.battle_hash(p_seed, 100 + wave, s.ti) as hh
                            from generate_series(0, w * h - 1) s(ti) where crack[s.ti + 1] = 0) z
         order by z.hh, z.ti limit k
      loop
        crack[tile + 1] := t + g_warn;
      end loop;
      wave := wave + 1;
      nextw := t + greatest(g_emin, g_every - wave * g_estep);
    end if;
    -- standing still cracks the tile
    for i in 1 .. n loop
      continue when outt[i] >= 0 or idle[i] < g_stomp;
      tile := py[i] * w + px[i] + 1;
      if crack[tile] = 0 then crack[tile] := t + g_warn; end if;
    end loop;
    -- falls
    for i in 1 .. n loop
      continue when outt[i] >= 0;
      tile := py[i] * w + px[i] + 1;
      if crack[tile] > 0 and t >= crack[tile] then outt[i] := t; end if;
    end loop;
    -- end
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
-- Bullenreiten (src/lib/sim/battle/bulls.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_bulls(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  g_first  integer := (g ->> 'firstSpawn')::integer;
  g_every  integer := (g ->> 'spawnEvery')::integer;
  g_emin   integer := (g ->> 'spawnEveryMin')::integer;
  g_estep  integer := (g ->> 'spawnEveryStep')::integer;
  g_grow   integer := (g ->> 'countGrowEvery')::integer;
  g_cmax   integer := (g ->> 'countMax')::integer;
  g_warn   integer := (g ->> 'warnTicks')::integer;
  g_tpt    integer := (g ->> 'ticksPerTile')::integer;
  g_stun   integer := (g ->> 'stunTicks')::integer;
  g_inv    integer := (g ->> 'invulnTicks')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  hearts integer[]; inv integer[];
  bl integer[] := '{}'; bi integer[] := '{}'; bd integer[] := '{}'; bt integer[] := '{}';
  nb       integer := 0;
  bfirst   integer := 1;
  spawn    integer := 0;
  nexts    integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; k integer; alive integer;
  r bigint; v_line integer; v_idx integer; v_dir integer; v_cnt integer; v_from integer; twin boolean;
  v_len integer; kk integer; head integer; tail integer; along integer; across integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  inv := mv;
  hearts := array_fill(g_hearts, array[n]);
  outt := array_fill(-1, array[n]);
  nexts := g_first;
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
      if outt[i] < 0 and inv[i] > 0 then inv[i] := inv[i] - 1; end if;
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
    -- new bulls
    if t = nexts then
      v_cnt := least(g_cmax, 1 + spawn / g_grow);
      v_from := nb;
      for k in 0 .. v_cnt - 1 loop
        r := public.battle_hash(p_seed, 200 + spawn, k);
        v_line := (r % 2)::integer;
        v_idx := ((r / 2) % (case when v_line = 0 then h else w end))::integer;
        v_dir := case when (r / 64) % 2 = 0 then 1 else -1 end;
        twin := false;
        for j in v_from + 1 .. nb loop
          if bl[j] = v_line and bi[j] = v_idx then twin := true; end if;
        end loop;
        if not twin then
          nb := nb + 1;
          bl[nb] := v_line; bi[nb] := v_idx; bd[nb] := v_dir; bt[nb] := t + g_warn;
        end if;
      end loop;
      spawn := spawn + 1;
      nexts := t + greatest(g_emin, g_every - spawn * g_estep);
    end if;
    while bfirst <= nb loop
      exit when t < bt[bfirst] + ((case when bl[bfirst] = 0 then w else h end) + 1) * g_tpt;
      bfirst := bfirst + 1;
    end loop;
    -- hits
    for k in bfirst .. nb loop
      continue when t < bt[k];
      v_len := case when bl[k] = 0 then w else h end;
      kk := (t - bt[k]) / g_tpt;
      continue when kk > v_len;
      head := case when bd[k] > 0 then kk else v_len - 1 - kk end;
      tail := head - bd[k];
      for i in 1 .. n loop
        continue when outt[i] >= 0 or inv[i] > 0;
        along := case when bl[k] = 0 then px[i] else py[i] end;
        across := case when bl[k] = 0 then py[i] else px[i] end;
        continue when across <> bi[k] or (along <> head and along <> tail);
        hearts[i] := hearts[i] - 1;
        stun[i] := g_stun;
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
-- Geldregen (src/lib/sim/battle/coins.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_coins(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  g_dur    integer := (g ->> 'durationTicks')::integer;
  g_first  integer := (g ->> 'firstDrop')::integer;
  g_every  integer := (g ->> 'dropEvery')::integer;
  g_emin   integer := (g ->> 'dropEveryMin')::integer;
  g_fall   integer := (g ->> 'fallTicks')::integer;
  g_life   integer := (g ->> 'lifeTicks')::integer;
  g_bear   integer := (g ->> 'bearPct')::integer;
  g_gold   integer := (g ->> 'goldPct')::integer;
  g_gval   integer := (g ->> 'goldValue')::integer;
  g_bstun  integer := (g ->> 'bearStunTicks')::integer;
  g_bloss  integer := (g ->> 'bearLoss')::integer;
  g_jack   integer := (g ->> 'jackpotTicks')::integer;
  g_jgold  integer := (g ->> 'jackpotGoldPct')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  score integer[]; reach integer[];
  dt integer[] := '{}'; dl integer[] := '{}'; dk integer[] := '{}'; dtk boolean[] := '{}';
  nd       integer := 0;
  dfirst   integer := 1;
  di       integer := 0;
  nextd    integer;
  v_every  integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; k integer; alive integer;
  r bigint; v_roll integer; v_goldp integer; v_type integer; v_x integer; v_y integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  score := mv; reach := mv;
  outt := array_fill(-1, array[n]);
  nextd := g_first;
  v_every := greatest(g_emin, g_every - n / 3);
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
    -- a new drop
    if t = nextd then
      r := public.battle_hash(p_seed, 300, di);
      v_roll := ((r / 65536) % 100)::integer;
      v_goldp := case when t >= g_dur - g_jack then g_jgold else g_gold end;
      v_type := case when v_roll < g_bear then 2 when v_roll < g_bear + v_goldp then 1 else 0 end;
      nd := nd + 1;
      dt[nd] := (r % (w * h))::integer; dl[nd] := t + g_fall; dk[nd] := v_type; dtk[nd] := false;
      di := di + 1;
      nextd := t + v_every;
    end if;
    while dfirst <= nd and dl[dfirst] + g_life <= t loop
      dfirst := dfirst + 1;
    end loop;
    for k in dfirst .. nd loop
      continue when dtk[k] or t < dl[k] or t >= dl[k] + g_life;
      v_x := dt[k] % w; v_y := dt[k] / w;
      if dk[k] = 2 then
        dtk[k] := true;
        for i in 1 .. n loop
          continue when outt[i] >= 0 or px[i] <> v_x or py[i] <> v_y;
          stun[i] := g_bstun;
          score[i] := score[i] - least(score[i], g_bloss);
        end loop;
        continue;
      end if;
      for i in 1 .. n loop
        continue when outt[i] >= 0 or px[i] <> v_x or py[i] <> v_y;
        score[i] := score[i] + case when dk[k] = 1 then g_gval else 1 end;
        reach[i] := t;
        dtk[k] := true;
        exit;
      end loop;
    end loop;
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then alive := alive + 1; end if;
    end loop;
    if (n >= 2 and alive <= 1) or alive = 0 or t + 1 >= g_dur then done := true; endt := t; end if;
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
-- Sumo am Parkett (src/lib/sim/battle/sumo.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_sumo(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  g_first  integer := (g ->> 'firstShrink')::integer;
  g_every  integer := (g ->> 'shrinkEvery')::integer;
  g_stun   integer := (g ->> 'stunTicks')::integer;
  g_recov  integer := coalesce((g ->> 'recoverTicks')::integer, 0);
  g_cool   integer := (g ->> 'powerCooldown')::integer;
  g_cut    integer := (g ->> 'cornerCut')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[]; ox integer[]; oy integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[]; code integer[];
  pushes integer[]; cool integer[];
  target integer[]; dirs integer[]; power boolean[]; walkto integer[]; aimed integer[]; cnt integer[];
  destx integer[]; desty integer[]; ok boolean[]; shoved boolean[];
  fall     integer[];
  cx       integer := w / 2;
  cy       integer := h / 2;
  maxring  integer := 0;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; k integer; d integer; b integer; nx integer; ny integer; alive integer;
  x integer; y integer; x1 integer; y1 integer; x2 integer; y2 integer; occ integer; v_free boolean; blocked boolean;
  ddx integer; ddy integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, coalesce(g -> 'spawns', p_params -> 'spawns'));
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; pushes := mv; cool := mv;
  outt := array_fill(-1, array[n]);
  fall := array_fill(0, array[w * h]);
  for y in 0 .. h - 1 loop
    for x in 0 .. w - 1 loop
      ddx := abs(x - cx); ddy := abs(y - cy);
      if ddx + ddy < g_cut then maxring := greatest(maxring, greatest(ddx, ddy)); end if;
    end loop;
  end loop;
  for y in 0 .. h - 1 loop
    for x in 0 .. w - 1 loop
      ddx := abs(x - cx); ddy := abs(y - cy);
      fall[y * w + x + 1] := case when ddx + ddy < g_cut then g_first + (maxring - greatest(ddx, ddy)) * g_every else 0 end;
    end loop;
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
    -- intents
    target := array_fill(-1, array[n]); dirs := array_fill(0, array[n]); power := array_fill(false, array[n]);
    walkto := array_fill(-1, array[n]);
    for i in 1 .. n loop
      continue when outt[i] >= 0 or mv[i] > 0 or stun[i] > 0 or code[i] <= 0;
      d := code[i] % 5;
      continue when d = 0;
      nx := px[i] + dx[d + 1]; ny := py[i] + dy[d + 1];
      continue when nx < 0 or ny < 0 or nx >= w or ny >= h;
      occ := -1;
      for j in 1 .. n loop
        if outt[j] < 0 and px[j] = nx and py[j] = ny then occ := j; exit; end if;
      end loop;
      if occ > 0 then
        target[i] := occ; dirs[i] := d; power[i] := code[i] >= 5 and cool[i] = 0;
      elsif fall[ny * w + nx + 1] > 0 and t < fall[ny * w + nx + 1] then
        walkto[i] := ny * w + nx;
      end if;
    end loop;
    -- whoever is being shoved cannot shove
    aimed := array_fill(0, array[n]);
    for i in 1 .. n loop
      if target[i] > 0 then aimed[target[i]] := aimed[target[i]] + 1; end if;
    end loop;
    for i in 1 .. n loop
      if target[i] > 0 and aimed[i] > 0 then target[i] := -1; end if;
    end loop;
    cnt := array_fill(0, array[n]);
    for i in 1 .. n loop
      if target[i] > 0 then cnt[target[i]] := cnt[target[i]] + 1; end if;
    end loop;
    destx := array_fill(0, array[n]); desty := array_fill(0, array[n]); ok := array_fill(false, array[n]);
    for i in 1 .. n loop
      j := target[i];
      continue when j < 0;
      continue when cnt[j] <> 1;
      d := dirs[i];
      x1 := px[j] + dx[d + 1]; y1 := py[j] + dy[d + 1];
      -- free(x1, y1)
      v_free := true;
      if x1 >= 0 and y1 >= 0 and x1 < w and y1 < h then
        for k in 1 .. n loop
          if outt[k] < 0 and px[k] = x1 and py[k] = y1 then v_free := (k = i or k = j); exit; end if;
        end loop;
      end if;
      continue when not v_free;
      x := x1; y := y1;
      if power[i] and x1 >= 0 and y1 >= 0 and x1 < w and y1 < h then
        x2 := x1 + dx[d + 1]; y2 := y1 + dy[d + 1];
        v_free := true;
        if x2 >= 0 and y2 >= 0 and x2 < w and y2 < h then
          for k in 1 .. n loop
            if outt[k] < 0 and px[k] = x2 and py[k] = y2 then v_free := (k = i or k = j); exit; end if;
          end loop;
        end if;
        if v_free then x := x2; y := y2; end if;
      end if;
      destx[i] := x; desty[i] := y; ok[i] := true;
    end loop;
    -- two targets onto one tile: both fail
    for i in 1 .. n loop
      continue when not ok[i] or destx[i] < 0 or desty[i] < 0 or destx[i] >= w or desty[i] >= h;
      for k in 1 .. n loop
        if k <> i and ok[k] and destx[k] = destx[i] and desty[k] = desty[i] then ok[i] := false; ok[k] := false; end if;
      end loop;
    end loop;
    ox := px; oy := py;
    shoved := array_fill(false, array[n]);
    for i in 1 .. n loop
      continue when not ok[i];
      j := target[i];
      shoved[j] := true;
      px[j] := destx[i]; py[j] := desty[i]; mv[j] := st; stun[j] := g_stun;
      px[i] := ox[j]; py[i] := oy[j]; mv[i] := st; stun[i] := g_recov;
      steps[i] := steps[i] + 1; pushes[i] := pushes[i] + 1;
      if power[i] then cool[i] := g_cool; end if;
    end loop;
    -- walks
    for i in 1 .. n loop
      continue when walkto[i] < 0 or shoved[i] or ok[i];
      x := walkto[i] % w; y := walkto[i] / w;
      blocked := false;
      for j in 1 .. n loop
        continue when j = i or outt[j] >= 0;
        if (ox[j] = x and oy[j] = y) or (px[j] = x and py[j] = y) then blocked := true; end if;
        if walkto[j] = walkto[i] and not shoved[j] and not ok[j] then blocked := true; end if;
      end loop;
      continue when blocked;
      px[i] := x; py[i] := y; mv[i] := st; steps[i] := steps[i] + 1;
    end loop;
    -- off the ring
    for i in 1 .. n loop
      continue when outt[i] >= 0;
      if px[i] < 0 or py[i] < 0 or px[i] >= w or py[i] >= h then
        outt[i] := t;
      elsif not (fall[py[i] * w + px[i] + 1] > 0 and t < fall[py[i] * w + px[i] + 1]) then
        outt[i] := t;
      end if;
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
    k2[i] := pushes[i];
    k3[i] := steps[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(pushes));
end;
$$;

-- ---------------------------------------------------------------------------
-- Giftaktie (src/lib/sim/battle/potato.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_potato(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  tps      integer := (p_params ->> 'tps')::integer;
  n        integer := coalesce(array_length(p_streams, 1), 0);
  len      integer := greatest(p_until, 1);
  g_max    integer := (g ->> 'maxTicks')::integer;
  g_first  integer := (g ->> 'firstRound')::integer;
  g_pause  integer := (g ->> 'pauseTicks')::integer;
  g_hstep  integer := (g ->> 'holderStepTicks')::integer;
  g_back   integer := (g ->> 'passBackTicks')::integer;
  g_rstun  integer := (g ->> 'receiverStunTicks')::integer;
  g_fbase  integer := (g ->> 'fuseBaseSeconds')::integer;
  g_fmin   integer := (g ->> 'fuseMinSeconds')::integer;
  g_fjit   integer := (g ->> 'fuseJitterSeconds')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  held integer[];
  wall     boolean[];
  holder   integer := 0;      -- 1-based, 0 = nobody
  v_round  integer := 0;
  nextr    integer;
  bang     integer := 0;
  lasth    integer := 0;
  passt    integer := -1000000;
  passto   integer;
  v_hold   integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; alive integer; v_alive integer[]; v_sec integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  held := mv;
  outt := array_fill(-1, array[n]);
  wall := array_fill(false, array[w * h]);
  for i in 0 .. coalesce(jsonb_array_length(g -> 'walls'), 0) - 1 loop
    wall[(g -> 'walls' -> i ->> 1)::integer * w + (g -> 'walls' -> i ->> 0)::integer + 1] := true;
  end loop;
  nextr := g_first;
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
    v_hold := holder;
    passto := 0;
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
        if px[j] = tx[i] and py[j] = ty[i] then
          go[i] := 0;
          if i = v_hold and outt[v_hold] < 0 and (j <> lasth or t - passt >= g_back) then passto := j; end if;
        elsif want[j] = 1 and tx[j] = tx[i] and ty[j] = ty[i] then
          go[i] := 0;
        end if;
      end loop;
    end loop;
    for i in 1 .. n loop
      if go[i] = 1 then
        px[i] := tx[i]; py[i] := ty[i];
        mv[i] := case when i = v_hold then g_hstep else st end;
        steps[i] := steps[i] + 1;
      end if;
    end loop;
    if passto > 0 then
      lasth := v_hold; holder := passto; passt := t; stun[passto] := g_rstun;
    end if;
    -- a new round: a random remaining player gets a lit stock
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then alive := alive + 1; end if;
    end loop;
    if holder = 0 and t >= nextr and alive >= 2 then
      v_alive := '{}';
      for i in 1 .. n loop
        if outt[i] < 0 then v_alive := v_alive || i; end if;
      end loop;
      holder := v_alive[(public.battle_hash(p_seed, 401, v_round) % alive)::integer + 1];
      v_sec := greatest(g_fmin, g_fbase - n) + (public.battle_hash(p_seed, 402, v_round) % g_fjit)::integer;
      bang := t + v_sec * tps;
      lasth := 0; passt := -1000000;
    end if;
    if holder > 0 then
      held[holder] := held[holder] + 1;
      if outt[holder] >= 0 or t >= bang then
        if outt[holder] < 0 then outt[holder] := t; end if;
        holder := 0;
        v_round := v_round + 1;
        nextr := t + g_pause;
      end if;
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
    k2[i] := -held[i];
    k3[i] := steps[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(held));
end;
$$;

-- ---------------------------------------------------------------------------
-- Aktie pumpen (src/lib/sim/battle/pump.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_pump(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  g        jsonb := p_params -> 'game';
  disc     integer := (p_params ->> 'disconnectTicks')::integer;
  n        integer := coalesce(array_length(p_streams, 1), 0);
  len      integer := greatest(p_until, 1);
  g_dur    integer := (g ->> 'durationTicks')::integer;
  g_gmin   integer := (g ->> 'greenMin')::integer;
  g_gjit   integer := (g ->> 'greenJitter')::integer;
  g_yel    integer := (g ->> 'yellowTicks')::integer;
  g_rmin   integer := (g ->> 'redMin')::integer;
  g_rjit   integer := (g ->> 'redJitter')::integer;
  g_gevery integer := (g ->> 'goldEvery')::integer;
  g_gticks integer := (g ->> 'goldTicks')::integer;
  g_gval   integer := (g ->> 'goldValue')::integer;
  g_freeze integer := (g ->> 'bustFreezeTicks')::integer;
  g_loss   integer := (g ->> 'bustLossBps')::integer;
  v_in     bytea;
  xr integer[]; outt integer[]; code integer[];
  score integer[]; reach integer[]; frozen integer[]; busts integer[];
  phs integer[] := '{}'; phl integer[] := '{}';
  ph       integer := 1;
  light    integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; b integer; alive integer; v_t integer; v_green integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  xr := array_fill(0, array[n]); code := xr; score := xr; reach := xr; frozen := xr; busts := xr;
  outt := array_fill(-1, array[n]);
  -- the light schedule: 0 green, 1 golden, 2 yellow, 3 red
  v_t := 0; j := 0;
  while v_t < g_dur loop
    v_green := g_gmin + (public.battle_hash(p_seed, 500, j) % g_gjit)::integer;
    phs := phs || v_t; phl := phl || 0;
    if j % g_gevery = g_gevery - 1 and v_green > g_gticks then
      phs := phs || (v_t + v_green - g_gticks); phl := phl || 1;
    end if;
    v_t := v_t + v_green;
    phs := phs || v_t; phl := phl || 2;
    v_t := v_t + g_yel;
    phs := phs || v_t; phl := phl || 3;
    v_t := v_t + g_rmin + (public.battle_hash(p_seed, 501, j) % g_rjit)::integer;
    j := j + 1;
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
    while ph + 1 <= array_length(phs, 1) and phs[ph + 1] <= t loop
      ph := ph + 1;
    end loop;
    light := phl[ph];
    for i in 1 .. n loop
      continue when outt[i] >= 0;
      if frozen[i] > 0 then frozen[i] := frozen[i] - 1; continue; end if;
      continue when code[i] <= 0;
      if light = 3 then
        score[i] := score[i] - (score[i] * g_loss) / 10000;
        busts[i] := busts[i] + 1;
        frozen[i] := g_freeze;
      else
        score[i] := score[i] + case when light = 1 then g_gval else 1 end;
        reach[i] := t;
      end if;
    end loop;
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then alive := alive + 1; end if;
    end loop;
    if (n >= 2 and alive <= 1) or alive = 0 or t + 1 >= g_dur then done := true; endt := t; end if;
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
-- One entry for all games
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
    else null end;
end;
$$;

revoke all on function public.battle_mul32(bigint, bigint) from public, anon, authenticated;
revoke all on function public.battle_mix32(bigint) from public, anon, authenticated;
revoke all on function public.battle_hash(bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.battle_stream_bytes(text[], integer, integer) from public, anon, authenticated;
revoke all on function public.battle_spawns(bigint, integer, jsonb) from public, anon, authenticated;
revoke all on function public.battle_rank(bigint, integer, integer[], integer[], integer[]) from public, anon, authenticated;
revoke all on function public.battle_sim_floor(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_bulls(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_coins(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_sumo(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_potato(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_pump(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim(text, bigint, jsonb, text[], integer) from public, anon, authenticated;
