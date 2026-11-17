-- =============================================================================
-- NEXA · 6700 · News battles: five more action games as PL/pgSQL (ADR-177)
-- =============================================================================
-- Goldrausch-Zone (zone), Bulle und Bär (tag), Wackelparkett (tiles), Farbrausch (paint) and Crash-Regen (crash):
-- the same integer simulations as src/lib/sim/battle/{zone,tag,tiles,paint,crash}.ts, with the same arguments and
-- answer as the other games (battle_sim_floor ...). A change to the TypeScript rules must be made here too;
-- supabase/tests/b6_battles_prizes.sql and src/lib/sim/battle/vectors.test.ts run both against the same inputs.
--   battle_sim(kind, seed, params, streams, until)   redefined with all seventeen games
--   battle_is_tick(kind)                            patched (replace): the new games are action games
--   battles.kind                                    the check takes the new games
-- Internal helpers: no grants. Idempotent: runs unchanged as supabase/updates/20261204006700_battle_sims_five.sql.

-- ---------------------------------------------------------------------------
-- Goldrausch-Zone (src/lib/sim/battle/zone.ts)
-- ---------------------------------------------------------------------------
-- A free tile inside the zone for coin number p_index: from the drawn tile on, the first without an alive player
-- (p_occ > 0) or a coin; the middle when there is none
create or replace function public.battle_zone_tile(p_seed bigint, p_index integer, p_w integer, p_h integer,
                                                   p_cx integer, p_cy integer, p_r integer, p_occ integer[],
                                                   p_coins integer[])
returns integer
language plpgsql
immutable
as $$
declare
  v_size  integer := p_w * p_h;
  v_start integer := (public.battle_hash(p_seed, 710, p_index) % v_size)::integer;
  v_tile  integer;
  k       integer;
begin
  for k in 0 .. v_size - 1 loop
    v_tile := (v_start + k) % v_size;
    continue when greatest(abs(v_tile % p_w - p_cx), abs(v_tile / p_w - p_cy)) > p_r;
    continue when p_occ[v_tile + 1] > 0 or v_tile = any (coalesce(p_coins, '{}'));
    return v_tile;
  end loop;
  return p_cy * p_w + p_cx;
end;
$$;

create or replace function public.battle_sim_zone(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  g_shrink integer := (g ->> 'firstShrink')::integer;
  g_every  integer := (g ->> 'shrinkEvery')::integer;
  g_rmin   integer := (g ->> 'radiusMin')::integer;
  g_first  integer := (g ->> 'firstCoin')::integer;
  g_per    integer := (g ->> 'coinsPerPlayers')::integer;
  g_cmax   integer := (g ->> 'coinsMax')::integer;
  g_delay  integer := (g ->> 'spawnDelay')::integer;
  g_gevery integer := (g ->> 'goldEvery')::integer;
  g_gval   integer := (g ->> 'goldValue')::integer;
  cx       integer := w / 2;
  cy       integer := h / 2;
  r0       integer := greatest(w / 2, h / 2);
  r        integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  score integer[]; reach integer[]; rk bigint[];
  ct integer[]; ca integer[]; cn integer[];
  occ integer[];
  v_count  integer;
  v_next   integer := 0;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; c integer; nx integer; ny integer; alive integer; v_tile integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  score := mv; reach := mv;
  rk := array_fill(0::bigint, array[n]);
  outt := array_fill(-1, array[n]);
  r := r0;
  occ := array_fill(0, array[w * h]);
  for i in 1 .. n loop
    occ[py[i] * w + px[i] + 1] := i;
  end loop;
  v_count := least(g_cmax, 1 + n / g_per);
  ct := '{}'; ca := '{}'; cn := '{}';
  for c in 1 .. v_count loop
    ct := ct || public.battle_zone_tile(p_seed, v_next, w, h, cx, cy, r, occ, ct);
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
      end if;
    end loop;
    -- walk inside the zone; a tile two want goes to the one with fewer coins, then by lot (walkContested)
    for i in 1 .. n loop
      want[i] := 0;
      continue when outt[i] >= 0 or mv[i] > 0 or stun[i] > 0 or code[i] <= 0;
      d := code[i] % 5;
      continue when d = 0;
      nx := px[i] + dx[d + 1]; ny := py[i] + dy[d + 1];
      if nx >= 0 and ny >= 0 and nx < w and ny < h and greatest(abs(nx - cx), abs(ny - cy)) <= r then
        tx[i] := nx; ty[i] := ny; want[i] := 1;
      end if;
    end loop;
    for i in 1 .. n loop
      rk[i] := case when want[i] = 1 then score[i]::bigint * 4294967296 + public.battle_hash(p_seed, 7100 + t, i - 1) else 0 end;
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
    -- the zone shrinks: who is outside is out, coins outside move in
    if r > g_rmin and t = g_shrink + (r0 - r) * g_every then
      r := r - 1;
      for i in 1 .. n loop
        if outt[i] < 0 and greatest(abs(px[i] - cx), abs(py[i] - cy)) > r then outt[i] := t; end if;
      end loop;
      occ := array_fill(0, array[w * h]);
      for i in 1 .. n loop
        if outt[i] < 0 then occ[py[i] * w + px[i] + 1] := i; end if;
      end loop;
      for c in 1 .. v_count loop
        continue when greatest(abs(ct[c] % w - cx), abs(ct[c] / w - cy)) <= r;
        ct[c] := -1;
        ct[c] := public.battle_zone_tile(p_seed, v_next, w, h, cx, cy, r, occ, ct);
        ca[c] := t + g_delay;
        cn[c] := v_next;
        v_next := v_next + 1;
      end loop;
    end if;
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
      ct[c] := public.battle_zone_tile(p_seed, v_next, w, h, cx, cy, r, occ, ct);
      ca[c] := t + g_delay;
      cn[c] := v_next;
      v_next := v_next + 1;
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
    k2[i] := score[i];
    k3[i] := case when score[i] > 0 then -reach[i] else 0 end;
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(score), 'radius', r);
end;
$$;

-- ---------------------------------------------------------------------------
-- Bulle und Bär (src/lib/sim/battle/tag.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_tag(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  g_bstep  integer := (g ->> 'bearStepTicks')::integer;
  g_freeze integer := (g ->> 'freezeTicks')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  held integer[]; tags integer[];
  bear     integer;
  tagged   integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; alive integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  held := mv; tags := mv;
  outt := array_fill(-1, array[n]);
  bear := (public.battle_hash(p_seed, 801, 0) % n)::integer + 1;
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
    -- a bear who left: the alive player with the fewest bear ticks, then the lot of the tick
    if bear = 0 or outt[bear] >= 0 then
      select s into bear from generate_series(1, n) s
       where outt[s] < 0
       order by held[s], public.battle_hash(p_seed, 8000 + t, s - 1), s
       limit 1;
      bear := coalesce(bear, 0);
    end if;
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
    tagged := 0;
    for i in 1 .. n loop
      go[i] := want[i];
      continue when want[i] = 0;
      for j in 1 .. n loop
        continue when j = i or outt[j] >= 0;
        if px[j] = tx[i] and py[j] = ty[i] then
          go[i] := 0;
          if i = bear and tagged = 0 then tagged := j; end if;
        elsif want[j] = 1 and tx[j] = tx[i] and ty[j] = ty[i] then go[i] := 0;
        end if;
      end loop;
    end loop;
    for i in 1 .. n loop
      if go[i] = 1 then
        px[i] := tx[i]; py[i] := ty[i];
        mv[i] := case when i = bear then g_bstep else st end;
        steps[i] := steps[i] + 1;
      end if;
    end loop;
    if tagged > 0 then
      tags[bear] := tags[bear] + 1;
      bear := tagged;
      stun[tagged] := g_freeze;
    end if;
    if bear > 0 then held[bear] := held[bear] + 1; end if;
    alive := 0;
    for i in 1 .. n loop
      if outt[i] < 0 then alive := alive + 1; end if;
    end loop;
    if (n >= 2 and alive <= 1) or alive = 0 or t + 1 >= g_max then done := true; endt := t; end if;
    t := t + 1;
  end loop;
  k1 := array_fill(0, array[n]); k2 := k1; k3 := k1;
  for i in 1 .. n loop
    k1[i] := case when outt[i] < 0 then 1 else 0 end;
    k2[i] := -held[i];
    k3[i] := tags[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(held), 'bear', bear - 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Wackelparkett (src/lib/sim/battle/tiles.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_tiles(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  g_bstart integer := (g ->> 'breakStart')::integer;
  g_bmin   integer := (g ->> 'breakMin')::integer;
  g_bstep  integer := (g ->> 'breakStepEvery')::integer;
  g_regrow integer := (g ->> 'regrowStart')::integer;
  g_rgrow  integer := (g ->> 'regrowGrowEvery')::integer;
  g_idle   integer := (g ->> 'idleMax')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[]; fx integer[]; fy integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; idle integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  crack integer[]; hole integer[];
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; alive integer; tile integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  fx := px; fy := py;
  mv := array_fill(0, array[n]); stun := mv; xr := mv; idle := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  outt := array_fill(-1, array[n]);
  crack := array_fill(-1, array[w * h]);
  hole := array_fill(0, array[w * h]);
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
    -- walk: holes cannot be entered
    for i in 1 .. n loop
      want[i] := 0;
      continue when outt[i] >= 0 or mv[i] > 0 or stun[i] > 0 or code[i] <= 0;
      d := code[i] % 5;
      continue when d = 0;
      nx := px[i] + dx[d + 1]; ny := py[i] + dy[d + 1];
      if nx >= 0 and ny >= 0 and nx < w and ny < h and hole[ny * w + nx + 1] <= t then
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
      if go[i] = 1 then
        fx[i] := px[i]; fy[i] := py[i];
        px[i] := tx[i]; py[i] := ty[i]; mv[i] := st; steps[i] := steps[i] + 1;
      end if;
    end loop;
    for i in 1 .. n loop
      if outt[i] < 0 then idle[i] := case when mv[i] = 0 then idle[i] + 1 else 0 end; end if;
    end loop;
    -- the tile left cracks; standing still too long breaks the own tile now
    for i in 1 .. n loop
      continue when outt[i] >= 0;
      if go[i] = 1 then
        tile := fy[i] * w + fx[i] + 1;
        if crack[tile] < 0 then crack[tile] := t + greatest(g_bmin, g_bstart - t / g_bstep); end if;
      elsif idle[i] >= g_idle then
        tile := py[i] * w + px[i] + 1;
        if crack[tile] < 0 then crack[tile] := t; end if;
      end if;
    end loop;
    for tile in 1 .. w * h loop
      if crack[tile] >= 0 and crack[tile] <= t then
        crack[tile] := -1;
        hole[tile] := t + g_regrow + t / g_rgrow;
      end if;
    end loop;
    for i in 1 .. n loop
      if outt[i] < 0 and hole[py[i] * w + px[i] + 1] > t then outt[i] := t; end if;
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
-- Farbrausch (src/lib/sim/battle/paint.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_paint(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  g_max    integer := (g ->> 'durationTicks')::integer;
  g_cool   integer := (g ->> 'bombCool')::integer;
  g_rad    integer := (g ->> 'bombRadius')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  own integer[]; score integer[]; cool integer[]; claim integer[];
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; alive integer; tile integer; ex integer; ey integer;
  k1 integer[]; k2 integer[]; k3 integer[];
begin
  if n = 0 then
    return jsonb_build_object('done', true, 'end_tick', -1, 'tick', 0, 'ranking', '[]'::jsonb, 'out', '[]'::jsonb, 'score', '[]'::jsonb);
  end if;
  v_in := public.battle_stream_bytes(p_streams, n, len);
  select sx, sy into px, py from public.battle_spawns(p_seed, n, p_params -> 'spawns');
  mv := array_fill(0, array[n]); stun := mv; xr := mv; steps := mv; code := mv; want := mv; tx := mv; ty := mv; go := mv;
  score := mv; cool := mv;
  outt := array_fill(-1, array[n]);
  -- own: 0 nobody, else the slot (1-based)
  own := array_fill(0, array[w * h]);
  for i in 1 .. n loop
    tile := py[i] * w + px[i] + 1;
    if own[tile] <> i then
      if own[tile] > 0 then score[own[tile]] := score[own[tile]] - 1; end if;
      own[tile] := i; score[i] := score[i] + 1;
    end if;
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
    -- paint bombs: a tile claimed by exactly one bomb takes its colour (claim: 0 none, slot, -1 several)
    claim := array_fill(0, array[w * h]);
    for i in 1 .. n loop
      continue when outt[i] >= 0 or code[i] < 5 or cool[i] > 0;
      cool[i] := g_cool;
      for ey in py[i] - g_rad .. py[i] + g_rad loop
        for ex in px[i] - g_rad .. px[i] + g_rad loop
          continue when ex < 0 or ey < 0 or ex >= w or ey >= h;
          tile := ey * w + ex + 1;
          claim[tile] := case when claim[tile] = 0 then i else -1 end;
        end loop;
      end loop;
    end loop;
    for tile in 1 .. w * h loop
      if claim[tile] > 0 and own[tile] <> claim[tile] then
        if own[tile] > 0 then score[own[tile]] := score[own[tile]] - 1; end if;
        own[tile] := claim[tile]; score[claim[tile]] := score[claim[tile]] + 1;
      end if;
    end loop;
    for i in 1 .. n loop
      continue when outt[i] >= 0;
      tile := py[i] * w + px[i] + 1;
      if own[tile] <> i then
        if own[tile] > 0 then score[own[tile]] := score[own[tile]] - 1; end if;
        own[tile] := i; score[i] := score[i] + 1;
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
    k1[i] := case when outt[i] < 0 then 1 else 0 end;
    k2[i] := score[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(score));
end;
$$;

-- ---------------------------------------------------------------------------
-- Crash-Regen (src/lib/sim/battle/crash.ts)
-- ---------------------------------------------------------------------------
create or replace function public.battle_sim_crash(p_seed bigint, p_params jsonb, p_streams text[], p_until integer)
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
  g_first  integer := (g ->> 'firstWave')::integer;
  g_every  integer := (g ->> 'waveEvery')::integer;
  g_emin   integer := (g ->> 'waveEveryMin')::integer;
  g_estep  integer := (g ->> 'waveEveryStep')::integer;
  g_warn   integer := (g ->> 'warnTicks')::integer;
  g_cstart integer := (g ->> 'countStart')::integer;
  g_cper   integer := (g ->> 'countPerPlayers')::integer;
  g_cmax   integer := (g ->> 'countMax')::integer;
  g_inv    integer := (g ->> 'invulnTicks')::integer;
  dx       integer[] := array[0, 0, 1, 0, -1];
  dy       integer[] := array[0, -1, 0, 1, 0];
  v_in     bytea;
  px integer[]; py integer[];
  mv integer[]; stun integer[]; xr integer[]; outt integer[]; steps integer[];
  code integer[]; want integer[]; tx integer[]; ty integer[]; go integer[];
  hearts integer[]; inv integer[]; centres integer[];
  v_hit    integer := 0;
  v_hit_at integer;
  t        integer := 0;
  done     boolean := false;
  endt     integer := -1;
  i integer; j integer; d integer; b integer; nx integer; ny integer; alive integer; m integer; v_c integer;
  v_struck boolean;
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
  v_hit_at := g_first;
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
        if inv[i] > 0 then inv[i] := inv[i] - 1; end if;
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
    -- the crashes of the due wave hit (a plus of five tiles each)
    if v_hit_at + g_warn = t then
      centres := '{}';
      for m in 0 .. least(g_cmax, g_cstart + v_hit / 2 + n / g_cper) - 1 loop
        centres := centres || (public.battle_hash(p_seed, 1100 + v_hit, m) % (w * h))::integer;
      end loop;
      for i in 1 .. n loop
        continue when outt[i] >= 0 or inv[i] > 0;
        v_struck := false;
        foreach v_c in array centres loop
          if abs(v_c % w - px[i]) + abs(v_c / w - py[i]) <= 1 then v_struck := true; end if;
        end loop;
        continue when not v_struck;
        hearts[i] := hearts[i] - 1;
        inv[i] := g_inv;
        if hearts[i] <= 0 then outt[i] := t; end if;
      end loop;
      v_hit_at := v_hit_at + greatest(g_emin, g_every - v_hit * g_estep);
      v_hit := v_hit + 1;
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
    k2[i] := hearts[i];
  end loop;
  return jsonb_build_object('done', done, 'end_tick', endt, 'tick', t,
                            'ranking', to_jsonb(public.battle_rank(p_seed, n, k1, k2, k3)),
                            'out', to_jsonb(outt), 'score', to_jsonb(hearts));
end;
$$;

-- ---------------------------------------------------------------------------
-- One entry for all games (the definition of 4900 with the five new games)
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
    when 'zone' then public.battle_sim_zone(p_seed, p_params, p_streams, p_until)
    when 'tag' then public.battle_sim_tag(p_seed, p_params, p_streams, p_until)
    when 'tiles' then public.battle_sim_tiles(p_seed, p_params, p_streams, p_until)
    when 'paint' then public.battle_sim_paint(p_seed, p_params, p_streams, p_until)
    when 'crash' then public.battle_sim_crash(p_seed, p_params, p_streams, p_until)
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
  if position('''crash''' in v_def) = 0 then
    if position($q$'rodeo')$q$ in v_def) = 0 then
      raise exception 'battle_is_tick() has an unexpected shape (no ''rodeo'')); add the ADR-177 action games by hand';
    end if;
    v_def := replace(v_def, $q$'rodeo')$q$, $q$'rodeo', 'zone', 'tag', 'tiles', 'paint', 'crash')$q$);
    execute v_def;
  end if;
end;
$do$;

alter table public.battles drop constraint if exists battles_kind_check;
alter table public.battles add constraint battles_kind_check check (kind is null or kind in (
  'floor', 'bulls', 'coins', 'sumo', 'potato', 'pump', 'bear', 'dash', 'margin', 'elevator', 'laser', 'rodeo',
  'zone', 'tag', 'tiles', 'paint', 'crash',
  'quiz', 'estimate', 'bell', 'vault', 'ticker', 'higher', 'auction'));

revoke all on function public.battle_zone_tile(bigint, integer, integer, integer, integer, integer, integer, integer[], integer[]) from public, anon, authenticated;
revoke all on function public.battle_sim_zone(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_tag(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_tiles(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_paint(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim_crash(bigint, jsonb, text[], integer) from public, anon, authenticated;
revoke all on function public.battle_sim(text, bigint, jsonb, text[], integer) from public, anon, authenticated;
