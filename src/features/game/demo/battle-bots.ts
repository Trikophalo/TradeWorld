import type { TickKind } from "@/config/battles";
import { bullAt, bullLength, type BullsState } from "@/lib/sim/battle/bulls";
import { BEAR, type CoinsState } from "@/lib/sim/battle/coins";
import { DX, DY, inBounds, playerAt, type GridBase } from "@/lib/sim/battle/core";
import { floorGone, type FloorState } from "@/lib/sim/battle/floor";
import type { AnyBattleState, SimParams } from "@/lib/sim/battle";
import type { PotatoState } from "@/lib/sim/battle/potato";
import { RED, type PumpState } from "@/lib/sim/battle/pump";
import type { SumoState } from "@/lib/sim/battle/sumo";

/*
 * The made-up opponents of the demo (ADR-160): simple bots that read the true state each tick and answer with one
 * input character, like a player would. Each has a skill (0..1) that decides how fast and how well it reacts, so
 * they are beatable but not pushovers.
 */

export interface BotMemory {
  skill: number;
  dir: number;
  /** Tick until which a reaction is delayed (slow thumbs). */
  wakeAt: number;
}

export const newBotMemory = (random: () => number): BotMemory => ({
  skill: 0.45 + random() * 0.45,
  dir: 0,
  wakeAt: 0,
});

type Params = SimParams<Record<string, unknown>>;
const num = (params: Params, key: string, fallback: number) => {
  const v = params.game[key];
  return typeof v === "number" ? v : fallback;
};
const dist = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by);

/** A step towards (tx, ty) that `ok` allows, or 0. */
function towards(s: GridBase, i: number, tx: number, ty: number, ok: (x: number, y: number) => boolean): number {
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  const dirs = [1, 2, 3, 4]
    .filter((d) => ok(x + DX[d]!, y + DY[d]!))
    .sort((a, b) => dist(x + DX[a]!, y + DY[a]!, tx, ty) - dist(x + DX[b]!, y + DY[b]!, tx, ty));
  const best = dirs[0];
  return best !== undefined && dist(x + DX[best]!, y + DY[best]!, tx, ty) < dist(x, y, tx, ty) ? best : 0;
}

function randomDir(s: GridBase, i: number, ok: (x: number, y: number) => boolean, random: () => number): number {
  const dirs = [1, 2, 3, 4].filter((d) => ok(s.p.x[i]! + DX[d]!, s.p.y[i]! + DY[d]!));
  return dirs[Math.floor(random() * dirs.length)] ?? 0;
}

function floorBot(s: FloorState, i: number, m: BotMemory, params: Params, random: () => number): number {
  const t = s.tick;
  const solid = (x: number, y: number) =>
    inBounds(s.w, s.h, x, y) && s.crack[y * s.w + x] === 0 && playerAt(s.p, x, y) < 0;
  const here = s.p.y[i]! * s.w + s.p.x[i]!;
  const danger = s.crack[here]! > 0 || s.p.idle[i]! >= num(params, "stompTicks", 50) - 10;
  if (danger) {
    if (t < m.wakeAt) return 0;
    const options = [1, 2, 3, 4].filter((d) => solid(s.p.x[i]! + DX[d]!, s.p.y[i]! + DY[d]!));
    const room = (d: number) => {
      const x = s.p.x[i]! + DX[d]!;
      const y = s.p.y[i]! + DY[d]!;
      return [1, 2, 3, 4].filter((e) => solid(x + DX[e]!, y + DY[e]!)).length + random() * 1.5;
    };
    options.sort((a, b) => room(b) - room(a));
    return options[0] ?? randomDir(s, i, (x, y) => inBounds(s.w, s.h, x, y) && !floorGone(s, y * s.w + x, t), random);
  }
  m.wakeAt = t + Math.round((1 - m.skill) * 14);
  return random() < 0.12 ? randomDir(s, i, solid, random) : 0;
}

function bullsBot(s: BullsState, i: number, m: BotMemory, params: Params, random: () => number): number {
  const t = s.tick;
  const tpt = num(params, "ticksPerTile", 2);
  const warn = num(params, "warnTicks", 26);
  const rows = new Set<number>();
  const cols = new Set<number>();
  for (let k = s.first; k < s.bulls.length; k++) {
    const b = s.bulls[k]!;
    const end = b.t0 + (bullLength(s, b) + 1) * tpt;
    if (t < b.t0 - warn + Math.round((1 - m.skill) * 16) || t >= end) continue;
    const at = bullAt(s, b, t, tpt);
    // a bull that already ran past does not matter
    const mine = b.line === 0 ? s.p.x[i]! : s.p.y[i]!;
    if (at && (at[1] - mine) * b.dir > 0) continue;
    (b.line === 0 ? rows : cols).add(b.idx);
  }
  const safe = (x: number, y: number) =>
    inBounds(s.w, s.h, x, y) && !rows.has(y) && !cols.has(x) && playerAt(s.p, x, y) < 0;
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  if (rows.has(y) || cols.has(x)) {
    const options = [1, 2, 3, 4].filter((d) => inBounds(s.w, s.h, x + DX[d]!, y + DY[d]!));
    options.sort(
      (a, b) => Number(safe(x + DX[b]!, y + DY[b]!)) - Number(safe(x + DX[a]!, y + DY[a]!)) || random() - 0.5,
    );
    return options[0] ?? 0;
  }
  return random() < 0.08 ? randomDir(s, i, safe, random) : 0;
}

function coinsBot(s: CoinsState, i: number, m: BotMemory, params: Params, random: () => number): number {
  const t = s.tick;
  const life = num(params, "lifeTicks", 80);
  const bears = new Set<number>();
  let best: { x: number; y: number; score: number } | null = null;
  for (let k = s.first; k < s.drops.length; k++) {
    const d = s.drops[k]!;
    if (d.taken || t >= d.land + life) continue;
    if (d.type === BEAR) {
      if (d.land - t <= 10) bears.add(d.tile);
      continue;
    }
    if (d.land - t > 12) continue;
    const x = d.tile % s.w;
    const y = Math.floor(d.tile / s.w);
    const score = dist(s.p.x[i]!, s.p.y[i]!, x, y) - d.type * 2 + random() * (1 - m.skill) * 8;
    if (!best || score < best.score) best = { x, y, score };
  }
  const ok = (x: number, y: number) => inBounds(s.w, s.h, x, y) && !bears.has(y * s.w + x) && playerAt(s.p, x, y) < 0;
  if (bears.has(s.p.y[i]! * s.w + s.p.x[i]!)) return randomDir(s, i, ok, random);
  if (!best) return random() < 0.05 ? randomDir(s, i, ok, random) : 0;
  return towards(s, i, best.x, best.y, ok);
}

function sumoBot(s: SumoState, i: number, m: BotMemory, params: Params, random: () => number): number {
  const t = s.tick;
  const warn = num(params, "warnTicks", 40);
  const cx = Math.floor(s.w / 2);
  const cy = Math.floor(s.h / 2);
  const firm = (x: number, y: number) => {
    if (!inBounds(s.w, s.h, x, y)) return false;
    const f = s.fall[y * s.w + x]!;
    return f > 0 && t < f - warn;
  };
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  const free = (a: number, b: number) => firm(a, b) && playerAt(s.p, a, b) < 0;
  if (!firm(x, y)) return towards(s, i, cx, cy, free) || 0;
  if (t < m.wakeAt) return 0;
  // at the edge of the ring: back towards the middle first (most of the time)
  const edge = [1, 2, 3, 4].some((d) => !firm(x + DX[d]!, y + DY[d]!));
  if (edge && random() < 0.4 + m.skill * 0.5) {
    const back = towards(s, i, cx, cy, free);
    if (back) return back;
  }
  // the nearest opponent
  let target = -1;
  for (let j = 0; j < s.n; j++) {
    if (j === i || s.p.out[j]! >= 0) continue;
    if (target < 0 || dist(x, y, s.p.x[j]!, s.p.y[j]!) < dist(x, y, s.p.x[target]!, s.p.y[target]!)) target = j;
  }
  if (target < 0) return 0;
  const tx = s.p.x[target]!;
  const ty = s.p.y[target]!;
  const power = s.cool[i] === 0 && random() < 0.5 * m.skill ? 5 : 0;
  if (dist(x, y, tx, ty) === 1) {
    const d = [1, 2, 3, 4].find((k) => x + DX[k]! === tx && y + DY[k]! === ty)!;
    // shove when it sends them outwards, else get round them
    const outwards = dist(tx + DX[d]!, ty + DY[d]!, cx, cy) >= dist(tx, ty, cx, cy);
    if ((outwards && random() < 0.35 + m.skill * 0.3) || random() < 0.1) {
      m.wakeAt = t + Math.round((1 - m.skill) * 10);
      return d + power;
    }
    return randomDir(s, i, (a, b) => firm(a, b) && playerAt(s.p, a, b) < 0, random);
  }
  return random() < 0.2 + m.skill * 0.25
    ? towards(s, i, tx, ty, (a, b) => firm(a, b) && (playerAt(s.p, a, b) < 0 || (a === tx && b === ty)))
    : 0;
}

function potatoBot(s: PotatoState, i: number, m: BotMemory, _params: Params, random: () => number): number {
  const ok = (x: number, y: number) => inBounds(s.w, s.h, x, y) && !s.wall[y * s.w + x];
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  if (s.tick < m.wakeAt) return m.dir;
  m.wakeAt = s.tick + Math.round((1 - m.skill) * 6);
  if (s.holder === i) {
    let target = -1;
    for (let j = 0; j < s.n; j++) {
      if (j === i || s.p.out[j]! >= 0) continue;
      if (target < 0 || dist(x, y, s.p.x[j]!, s.p.y[j]!) < dist(x, y, s.p.x[target]!, s.p.y[target]!)) target = j;
    }
    if (target < 0) return 0;
    m.dir = towards(s, i, s.p.x[target]!, s.p.y[target]!, (a, b) => ok(a, b)) || randomDir(s, i, ok, random);
    return m.dir;
  }
  if (s.holder < 0) {
    m.dir = random() < 0.1 ? randomDir(s, i, ok, random) : 0;
    return m.dir;
  }
  const hx = s.p.x[s.holder]!;
  const hy = s.p.y[s.holder]!;
  if (dist(x, y, hx, hy) > 6 && random() < 0.6) return 0;
  const options = [1, 2, 3, 4].filter((d) => ok(x + DX[d]!, y + DY[d]!) && playerAt(s.p, x + DX[d]!, y + DY[d]!) < 0);
  options.sort(
    (a, b) =>
      dist(x + DX[b]!, y + DY[b]!, hx, hy) -
      dist(x + DX[a]!, y + DY[a]!, hx, hy) +
      (random() - 0.5) * 2 * (1 - m.skill),
  );
  m.dir = options[0] ?? 0;
  return m.dir;
}

function pumpBot(s: PumpState, _i: number, m: BotMemory, _params: Params, random: () => number): number {
  const t = s.tick;
  let k = s.phase;
  while (k + 1 < s.phaseStart.length && s.phaseStart[k + 1]! <= t) k++;
  const rate = 0.25 + m.skill * 0.25;
  if (s.phaseLight[k] === RED) {
    const since = t - s.phaseStart[k]!;
    const react = Math.round(2 + (1 - m.skill) * 8);
    return (since < react ? random() < rate : random() < 0.01) ? 1 : 0;
  }
  return random() < rate ? 1 : 0;
}

/** The input character of a bot for the tick the state is at. */
export function botInput(
  kind: TickKind,
  state: AnyBattleState,
  slot: number,
  memory: BotMemory,
  params: Params,
  random: () => number,
): string {
  if (state.p.out[slot]! >= 0) return "0";
  // A step (or stun) that ends this tick lets the bot act now: decide afresh instead of repeating the last direction.
  if (kind !== "pump" && (state.p.mv[slot]! > 1 || state.p.stun[slot]! > 1)) return String(memory.dir || 0);
  let code = 0;
  switch (kind) {
    case "floor":
      code = floorBot(state as FloorState, slot, memory, params, random);
      break;
    case "bulls":
      code = bullsBot(state as BullsState, slot, memory, params, random);
      break;
    case "coins":
      code = coinsBot(state as CoinsState, slot, memory, params, random);
      break;
    case "sumo":
      code = sumoBot(state as SumoState, slot, memory, params, random);
      break;
    case "potato":
      code = potatoBot(state as PotatoState, slot, memory, params, random);
      break;
    case "pump":
      code = pumpBot(state as PumpState, slot, memory, params, random);
      break;
  }
  if (kind !== "pump") memory.dir = code % 5;
  return String(code);
}
