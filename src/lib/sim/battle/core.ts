/**
 * The shared core of the action games of a news battle (ADR-160): players on an 11×9 tile grid, one input character
 * per player and tick, integer state only. The database runs the same rules (public.battle_sim_* in
 * supabase/migrations/20261204003800_battle_sims.sql); a change here must be made there too (vectors.test.ts and
 * supabase/tests/9s_battles.sql check both against the same inputs).
 *
 * Inputs per tick: "0" nothing, "1" up, "2" right, "3" down, "4" left, "5".."9" the same with the action button;
 * the server writes "x" for a tick without input (late or missing) and "q" when a player left.
 */
import { battleHash } from "./hash.ts";

export interface SimParams<G> {
  readonly w: number;
  readonly h: number;
  /** Ticks one step from tile to tile takes. */
  readonly stepTicks: number;
  readonly spawns: readonly (readonly [number, number])[];
  /** "x" in a row until a player counts as disconnected (out). */
  readonly disconnectTicks: number;
  /** Ticks per second. */
  readonly tps: number;
  readonly game: G;
}

export const MISSED = -1;
export const QUIT = -2;
/** Sorts above every tick: still standing. */
export const ALIVE_KEY = 1_000_000;

/** dx, dy of the directions 0 (none), 1 up, 2 right, 3 down, 4 left. */
export const DX: readonly number[] = [0, 0, 1, 0, -1];
export const DY: readonly number[] = [0, -1, 0, 1, 0];

/** The input code of a character: 0..9, MISSED or QUIT. */
export function inputCode(ch: string | undefined): number {
  if (ch === "q") return QUIT;
  if (ch === undefined) return MISSED;
  const d = ch.charCodeAt(0) - 48;
  return d >= 0 && d <= 9 ? d : MISSED;
}

export const dirOf = (code: number): number => (code > 0 ? code % 5 : 0);
export const actOf = (code: number): boolean => code >= 5;

/** Everything every grid game keeps per player. Plain arrays so a state copies cheaply (prediction). */
export interface Players {
  readonly n: number;
  x: number[];
  y: number[];
  /** The tile of the last step's start (for drawing the step). */
  fx: number[];
  fy: number[];
  /** Ticks left of the current step; 0 = standing. */
  mv: number[];
  /** Length of the current step in ticks (for drawing). */
  st: number[];
  /** Last direction (1..4) the player wanted to go. */
  face: number[];
  /** -1 still in, else the tick the player was eliminated. */
  out: number[];
  stun: number[];
  /** "x" in a row. */
  xrun: number[];
  /** Ticks standing on the same tile. */
  idle: number[];
  /** Tiles walked. */
  steps: number[];
}

export interface GridBase {
  readonly seed: number;
  readonly n: number;
  readonly w: number;
  readonly h: number;
  /** Ticks processed so far; the next step is tick `tick`. */
  tick: number;
  done: boolean;
  /** The last tick processed when the game ended, -1 while running. */
  endTick: number;
  p: Players;
}

const fill = (n: number, v: number) => Array<number>(n).fill(v);

/** Players on their spawn tiles; the order in which spawns are handed out comes from the seed. */
export function spawnPlayers(seed: number, n: number, spawns: readonly (readonly [number, number])[]): Players {
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => battleHash(seed, 1, a) - battleHash(seed, 1, b) || a - b,
  );
  const x = fill(n, 0);
  const y = fill(n, 0);
  order.forEach((slot, k) => {
    const spawn = spawns[k % spawns.length]!;
    x[slot] = spawn[0];
    y[slot] = spawn[1];
  });
  return {
    n,
    x,
    y,
    fx: [...x],
    fy: [...y],
    mv: fill(n, 0),
    st: fill(n, 1),
    face: fill(n, 3),
    out: fill(n, -1),
    stun: fill(n, 0),
    xrun: fill(n, 0),
    idle: fill(n, 0),
    steps: fill(n, 0),
  };
}

export function clonePlayers(p: Players): Players {
  return {
    n: p.n,
    x: [...p.x],
    y: [...p.y],
    fx: [...p.fx],
    fy: [...p.fy],
    mv: [...p.mv],
    st: [...p.st],
    face: [...p.face],
    out: [...p.out],
    stun: [...p.stun],
    xrun: [...p.xrun],
    idle: [...p.idle],
    steps: [...p.steps],
  };
}

export const isIn = (p: Players, i: number): boolean => p.out[i]! < 0;

export function aliveCount(p: Players): number {
  let count = 0;
  for (let i = 0; i < p.n; i++) if (p.out[i]! < 0) count++;
  return count;
}

/**
 * Reads this tick's inputs: "q" leaves, too many "x" in a row disconnect. Returns the codes (MISSED for players who
 * are out).
 */
export function readInputs(p: Players, inputs: string, tick: number, disconnectTicks: number): number[] {
  const codes = fill(p.n, MISSED);
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0) continue;
    const code = inputCode(inputs[i]);
    if (code === QUIT) {
      p.out[i] = tick;
      continue;
    }
    if (code === MISSED) {
      p.xrun[i]! += 1;
      if (p.xrun[i]! >= disconnectTicks) {
        p.out[i] = tick;
        continue;
      }
    } else p.xrun[i] = 0;
    codes[i] = code;
  }
  return codes;
}

/** Steps run on and stuns wear off (the first thing of every tick). */
export function advance(p: Players): void {
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0) continue;
    if (p.mv[i]! > 0) p.mv[i]! -= 1;
    if (p.stun[i]! > 0) p.stun[i]! -= 1;
  }
}

/** The alive player standing on (x, y), or -1. */
export function playerAt(p: Players, x: number, y: number): number {
  for (let j = 0; j < p.n; j++) if (p.out[j]! < 0 && p.x[j] === x && p.y[j] === y) return j;
  return -1;
}

/**
 * One step for everyone who stands, is not stunned and wants to go somewhere `passable`. Order-free: a target
 * that another alive player stands on, or that two players want, blocks all of them. `onBump(i, j)` is called when
 * player i wants to go where player j stands.
 */
export function walk(
  p: Players,
  codes: readonly number[],
  passable: (x: number, y: number) => boolean,
  stepTicks: (i: number) => number,
  onBump?: (i: number, j: number) => void,
): void {
  const n = p.n;
  const tx = fill(n, 0);
  const ty = fill(n, 0);
  const want = fill(n, 0);
  for (let i = 0; i < n; i++) {
    if (p.out[i]! >= 0 || p.mv[i]! > 0 || p.stun[i]! > 0) continue;
    const d = dirOf(codes[i]!);
    if (d === 0) continue;
    p.face[i] = d;
    const nx = p.x[i]! + DX[d]!;
    const ny = p.y[i]! + DY[d]!;
    if (!passable(nx, ny)) continue;
    tx[i] = nx;
    ty[i] = ny;
    want[i] = 1;
  }
  const go = [...want];
  for (let i = 0; i < n; i++) {
    if (!want[i]) continue;
    for (let j = 0; j < n; j++) {
      if (j === i || p.out[j]! >= 0) continue;
      if (p.x[j] === tx[i] && p.y[j] === ty[i]) {
        go[i] = 0;
        onBump?.(i, j);
      } else if (want[j] && tx[j] === tx[i] && ty[j] === ty[i]) go[i] = 0;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!go[i]) continue;
    p.fx[i] = p.x[i]!;
    p.fy[i] = p.y[i]!;
    p.x[i] = tx[i]!;
    p.y[i] = ty[i]!;
    const ticks = stepTicks(i);
    p.mv[i] = ticks;
    p.st[i] = ticks;
    p.steps[i]! += 1;
  }
}

/**
 * walk() for games with a prize on a tile (Dividenden-Dash, Margin Call): when several players want the same free
 * tile, the one with the lowest `rank` gets it instead of nobody (else they would block each other forever).
 * Everything else as in walk().
 */
export function walkContested(
  p: Players,
  codes: readonly number[],
  passable: (x: number, y: number) => boolean,
  stepTicks: number,
  rank: (i: number) => number,
  onBump?: (i: number, j: number) => void,
): void {
  const n = p.n;
  const tx = fill(n, 0);
  const ty = fill(n, 0);
  const want = fill(n, 0);
  for (let i = 0; i < n; i++) {
    if (p.out[i]! >= 0 || p.mv[i]! > 0 || p.stun[i]! > 0) continue;
    const d = dirOf(codes[i]!);
    if (d === 0) continue;
    p.face[i] = d;
    const nx = p.x[i]! + DX[d]!;
    const ny = p.y[i]! + DY[d]!;
    if (!passable(nx, ny)) continue;
    tx[i] = nx;
    ty[i] = ny;
    want[i] = 1;
  }
  const go = [...want];
  const ranks = Array.from({ length: n }, (_, i) => (want[i] ? rank(i) : 0));
  for (let i = 0; i < n; i++) {
    if (!want[i]) continue;
    for (let j = 0; j < n; j++) {
      if (j === i || p.out[j]! >= 0) continue;
      if (p.x[j] === tx[i] && p.y[j] === ty[i]) {
        go[i] = 0;
        onBump?.(i, j);
      } else if (want[j] && tx[j] === tx[i] && ty[j] === ty[i] && ranks[j]! < ranks[i]!) go[i] = 0;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!go[i]) continue;
    p.fx[i] = p.x[i]!;
    p.fy[i] = p.y[i]!;
    p.x[i] = tx[i]!;
    p.y[i] = ty[i]!;
    p.mv[i] = stepTicks;
    p.st[i] = stepTicks;
    p.steps[i]! += 1;
  }
}

/** Counts how long everyone stands still (after the moves of the tick). */
export function countIdle(p: Players): void {
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0) continue;
    p.idle[i] = p.mv[i] === 0 ? p.idle[i]! + 1 : 0;
  }
}

/**
 * Slots from first to last place: by the keys (higher is better), then by lot from the seed (lower wins).
 */
export function rankByKeys(seed: number, n: number, keys: (slot: number) => readonly number[]): number[] {
  const k = Array.from({ length: n }, (_, i) => keys(i));
  const lot = Array.from({ length: n }, (_, i) => battleHash(seed, 999, i));
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const ka = k[a]!;
    const kb = k[b]!;
    for (let j = 0; j < Math.max(ka.length, kb.length); j++) {
      const diff = (kb[j] ?? 0) - (ka[j] ?? 0);
      if (diff !== 0) return diff;
    }
    return lot[a]! - lot[b]!;
  });
}

/** The game is over: at most one player left (of several), nobody left, or the time is up. */
export function checkEnd(s: GridBase, maxTicks: number): void {
  const alive = aliveCount(s.p);
  if ((s.n >= 2 && alive <= 1) || alive === 0 || s.tick + 1 >= maxTicks) {
    s.done = true;
    s.endTick = s.tick;
  }
}

export const inBounds = (w: number, h: number, x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
