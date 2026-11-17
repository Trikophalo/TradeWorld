import type { TickKind } from "@/config/battles";
import type { BearState } from "@/lib/sim/battle/bear";
import { bullAt, bullLength, type BullsState } from "@/lib/sim/battle/bulls";
import { BEAR, type CoinsState } from "@/lib/sim/battle/coins";
import type { DashState } from "@/lib/sim/battle/dash";
import { elevatorSolid, type ElevatorState } from "@/lib/sim/battle/elevator";
import { laserLength, type LaserState } from "@/lib/sim/battle/laser";
import type { MarginState } from "@/lib/sim/battle/margin";
import { RODEO_NONE, type RodeoState } from "@/lib/sim/battle/rodeo";
import { DX, DY, inBounds, playerAt, type GridBase } from "@/lib/sim/battle/core";
import { floorGone, type FloorState } from "@/lib/sim/battle/floor";
import type { AnyBattleState, SimParams } from "@/lib/sim/battle";
import type { PotatoState } from "@/lib/sim/battle/potato";
import { RED, type PumpState } from "@/lib/sim/battle/pump";
import type { SumoState } from "@/lib/sim/battle/sumo";
import { crashCentres, crashGap, crashHits, type CrashState } from "@/lib/sim/battle/crash";
import type { PaintState } from "@/lib/sim/battle/paint";
import type { TagState } from "@/lib/sim/battle/tag";
import { tilesHole, type TilesState } from "@/lib/sim/battle/tiles";
import { zoneDist, zoneShrinkTick, zoneStartRadius, type ZoneState } from "@/lib/sim/battle/zone";

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

// ------------------------------------------------------------------ the games of the addendum to ADR-160

/** Bärenjagd: keep away from the bears, but not into a corner; slow thumbs react later. */
function bearBot(s: BearState, i: number, m: BotMemory, _params: Params, random: () => number): number {
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  const ok = (a: number, b: number) => inBounds(s.w, s.h, a, b) && !s.wall[b * s.w + a] && playerAt(s.p, a, b) < 0;
  if (s.bears === 0) return random() < 0.06 ? randomDir(s, i, ok, random) : 0;
  const danger = (a: number, b: number) => {
    let d = 99;
    for (let k = 0; k < s.bears; k++) d = Math.min(d, dist(a, b, s.bx[k]!, s.by[k]!));
    return d;
  };
  const here = danger(x, y);
  if (here > 3 + Math.round(m.skill * 3) && random() < 0.85) return random() < 0.04 ? randomDir(s, i, ok, random) : 0;
  if (s.tick < m.wakeAt) return m.dir;
  m.wakeAt = s.tick + Math.round((1 - m.skill) * 8);
  const room = (a: number, b: number) => [1, 2, 3, 4].filter((d) => ok(a + DX[d]!, b + DY[d]!)).length;
  const options = [1, 2, 3, 4].filter((d) => ok(x + DX[d]!, y + DY[d]!));
  options.sort((a, b) => {
    const score = (d: number) =>
      danger(x + DX[d]!, y + DY[d]!) * 2 + room(x + DX[d]!, y + DY[d]!) * m.skill + random() * (1.6 - m.skill) * 2;
    return score(b) - score(a);
  });
  return options[0] ?? 0;
}

/** Dividenden-Dash: run for the closest coin; tackle whoever is in the way now and then. */
function dashBot(s: DashState, i: number, m: BotMemory, params: Params, random: () => number): number {
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  const t = s.tick;
  if (t < m.wakeAt) return m.dir;
  m.wakeAt = t + Math.round((1 - m.skill) * 5 * random());
  let best = -1;
  let bestScore = 0;
  for (let c = 0; c < s.ct.length; c++) {
    if (s.ct[c]! < 0 || s.ca[c]! - t > 12) continue;
    const d = dist(x, y, s.ct[c]! % s.w, Math.floor(s.ct[c]! / s.w)) + random() * (1 - m.skill) * 6;
    if (best < 0 || d < bestScore) {
      best = c;
      bestScore = d;
    }
  }
  if (best < 0) return random() < 0.05 ? randomDir(s, i, (a, b) => inBounds(s.w, s.h, a, b), random) : 0;
  const tx = s.ct[best]! % s.w;
  const ty = Math.floor(s.ct[best]! / s.w);
  const free = (a: number, b: number) => inBounds(s.w, s.h, a, b) && playerAt(s.p, a, b) < 0;
  const d = towards(s, i, tx, ty, free);
  if (d) return d;
  // somebody is in the way: tackle them (when rested), else round them
  const step = towards(s, i, tx, ty, (a, b) => inBounds(s.w, s.h, a, b));
  const cool = num(params, "tackleCool", 40);
  if (step && s.cool[i] === 0 && random() < 0.3 + m.skill * 0.5 && cool > 0) return step + 5;
  return randomDir(s, i, free, random);
}

/** Margin Call: when the tiles light up, run to the closest free one (after a moment of shock). */
function marginBot(s: MarginState, i: number, m: BotMemory, _params: Params, random: () => number): number {
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  const t = s.tick;
  if (s.call < 0) return random() < 0.04 ? randomDir(s, i, (a, b) => inBounds(s.w, s.h, a, b), random) : 0;
  if (t < s.shown + Math.round(4 + (1 - m.skill) * 22)) return 0;
  if (s.safe[y * s.w + x] === 1) return 0;
  let best = -1;
  let bestD = 99;
  for (let tile = 0; tile < s.safe.length; tile++) {
    if (s.safe[tile] !== 1) continue;
    const tx = tile % s.w;
    const ty = Math.floor(tile / s.w);
    const other = playerAt(s.p, tx, ty);
    if (other >= 0 && other !== i) continue;
    const d = dist(x, y, tx, ty) + random() * (1 - m.skill) * 4;
    if (d < bestD) {
      best = tile;
      bestD = d;
    }
  }
  if (best < 0) return 0;
  return (
    towards(s, i, best % s.w, Math.floor(best / s.w), (a, b) => inBounds(s.w, s.h, a, b) && playerAt(s.p, a, b) < 0) ||
    randomDir(s, i, (a, b) => inBounds(s.w, s.h, a, b) && playerAt(s.p, a, b) < 0, random)
  );
}

/** Fahrstuhl zum Mond: up where it is free, else sideways to the closest gap of the bar above. */
function elevatorBot(s: ElevatorState, i: number, m: BotMemory, _params: Params, random: () => number): number {
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  if (random() < (1 - m.skill) * 0.25) return 0;
  const ok = (a: number, b: number) =>
    a >= 0 && a < s.w && b <= s.h - 1 && b >= -s.cam && !elevatorSolid(s, a, b) && playerAt(s.p, a, b) < 0;
  // no hurry while far above the bottom edge
  const margin = s.h - 1 - s.cam - y;
  if (margin > 5 + m.skill * 2 && random() < 0.5) return 0;
  if (ok(x, y - 1)) return 1;
  let best = -1;
  for (let a = 0; a < s.w; a++)
    if (!elevatorSolid(s, a, y - 1) && (best < 0 || Math.abs(a - x) < Math.abs(best - x))) best = a;
  if (best < 0) return 0;
  const d = best > x ? 2 : best < x ? 4 : 0;
  return d && ok(x + DX[d]!, y) ? d : randomDir(s, i, ok, random);
}

/** Laserschranke: jump a few ticks before a beam reaches the own tile (skill decides how exactly). */
function laserJump(s: LaserState, i: number, m: BotMemory, params: Params, random: () => number): boolean {
  if (s.air[i]! > 0 || s.jcool[i]! > 0) return false;
  const tpt = num(params, "ticksPerTile", 2);
  const t = s.tick;
  for (let k = s.first; k < s.lasers.length; k++) {
    const l = s.lasers[k]!;
    const len = laserLength(s, l);
    const across = l.line === 0 ? s.p.y[i]! : s.p.x[i]!;
    const along = l.line === 0 ? s.p.x[i]! : s.p.y[i]!;
    if (along === l.gap) continue;
    const step = l.dir > 0 ? across : len - 1 - across;
    const hit = l.t0 + step * tpt;
    if (m.wakeAt !== hit) {
      // plan once per beam: how many ticks early this rider jumps
      if (hit - t > 12 || hit < t) continue;
      m.wakeAt = hit;
      m.dir = Math.round(3 + (random() - 0.5) * (1 - m.skill) * 8);
    }
    if (hit - t === Math.max(0, m.dir)) return true;
  }
  return false;
}

function laserBot(s: LaserState, i: number, m: BotMemory, _params: Params, random: () => number): number {
  // walk to a gap now and then, else stand
  return random() < 0.03 ? randomDir(s, i, (a, b) => inBounds(s.w, s.h, a, b) && playerAt(s.p, a, b) < 0, random) : 0;
}

/** Bullen-Rodeo: press the cued direction after a reaction time; sometimes the wrong one. */
function rodeoBot(s: RodeoState, i: number, m: BotMemory, _params: Params, random: () => number): number {
  if (s.cueStart < 0) {
    m.wakeAt = -1;
    return 0;
  }
  if (s.resp[i] !== RODEO_NONE) return 0;
  if (m.wakeAt < 0) m.wakeAt = s.cueStart + Math.round(5 + (1 - m.skill) * 9 + random() * 7);
  if (s.tick < m.wakeAt) return 0;
  if (random() < 0.06 + (1 - m.skill) * 0.1) return 1 + ((s.cueDir + Math.floor(random() * 3)) % 4);
  return s.cueDir;
}

// ---------------------------------------------------------------------------------------------------------------
// The games of ADR-177
// ---------------------------------------------------------------------------------------------------------------

/** Goldrausch-Zone: the closest coin, but back towards the middle before the zone shrinks. */
function zoneBot(s: ZoneState, i: number, m: BotMemory, params: Params, random: () => number): number {
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  const t = s.tick;
  const inside = (a: number, b: number) =>
    inBounds(s.w, s.h, a, b) && zoneDist(s, a, b) <= s.r && playerAt(s.p, a, b) < 0;
  const next = zoneShrinkTick(params.game as never, zoneStartRadius(s.w, s.h) - s.r);
  const careful = num(params, "warnTicks", 60) * (0.4 + m.skill * 0.6);
  if (next - t < careful && zoneDist(s, x, y) >= s.r)
    return towards(s, i, s.cx, s.cy, inside) || randomDir(s, i, inside, random);
  if (t < m.wakeAt) return m.dir;
  m.wakeAt = t + Math.round((1 - m.skill) * 6 * random());
  let best = -1;
  let bestD = 0;
  for (let c = 0; c < s.ct.length; c++) {
    if (s.ct[c]! < 0) continue;
    const cx = s.ct[c]! % s.w;
    const cy = Math.floor(s.ct[c]! / s.w);
    if (next - t < careful && zoneDist(s, cx, cy) >= s.r) continue;
    const d = dist(x, y, cx, cy) + random() * (1 - m.skill) * 6;
    if (best < 0 || d < bestD) {
      best = c;
      bestD = d;
    }
  }
  if (best < 0) return random() < 0.1 ? randomDir(s, i, inside, random) : 0;
  return towards(s, i, s.ct[best]! % s.w, Math.floor(s.ct[best]! / s.w), inside) || randomDir(s, i, inside, random);
}

/** Bulle und Bär: the bear hunts the closest bull, the bulls keep away from the bear. */
function tagBot(s: TagState, i: number, m: BotMemory, _params: Params, random: () => number): number {
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  const t = s.tick;
  if (t < m.wakeAt) return m.dir;
  m.wakeAt = t + Math.round((1 - m.skill) * 8 * random());
  const ok = (a: number, b: number) => inBounds(s.w, s.h, a, b);
  if (s.bear === i) {
    let prey = -1;
    for (let j = 0; j < s.n; j++) {
      if (j === i || s.p.out[j]! >= 0) continue;
      if (prey < 0 || dist(x, y, s.p.x[j]!, s.p.y[j]!) < dist(x, y, s.p.x[prey]!, s.p.y[prey]!)) prey = j;
    }
    if (prey < 0) return 0;
    // a step onto the bull's tile is the tag (walk bumps)
    return towards(s, i, s.p.x[prey]!, s.p.y[prey]!, ok) || randomDir(s, i, ok, random);
  }
  if (s.bear < 0) return 0;
  const bx = s.p.x[s.bear]!;
  const by = s.p.y[s.bear]!;
  if (dist(x, y, bx, by) > 3 + Math.round(m.skill * 2)) return random() < 0.08 ? randomDir(s, i, ok, random) : 0;
  const free = (a: number, b: number) => ok(a, b) && playerAt(s.p, a, b) < 0;
  const away = [1, 2, 3, 4]
    .filter((d) => free(x + DX[d]!, y + DY[d]!))
    .sort((a, b) => dist(x + DX[b]!, y + DY[b]!, bx, by) - dist(x + DX[a]!, y + DY[a]!, bx, by) || random() - 0.5);
  return away[0] ?? 0;
}

/** Wackelparkett: keep walking onto solid tiles that have room around them. */
function tilesBot(s: TilesState, i: number, m: BotMemory, params: Params, random: () => number): number {
  const t = s.tick;
  const solid = (a: number, b: number) =>
    inBounds(s.w, s.h, a, b) && !tilesHole(s, b * s.w + a, t) && s.crack[b * s.w + a]! < 0 && playerAt(s.p, a, b) < 0;
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  if (s.p.idle[i]! < num(params, "idleMax", 30) * (0.15 + (1 - m.skill) * 0.4) && t < m.wakeAt) return 0;
  m.wakeAt = t + Math.round((1 - m.skill) * 6);
  const room = (d: number) => {
    const a = x + DX[d]!;
    const b = y + DY[d]!;
    return [1, 2, 3, 4].filter((e) => solid(a + DX[e]!, b + DY[e]!)).length + random() * (2 - m.skill);
  };
  const options = [1, 2, 3, 4].filter((d) => solid(x + DX[d]!, y + DY[d]!)).sort((a, b) => room(b) - room(a));
  return options[0] ?? randomDir(s, i, (a, b) => inBounds(s.w, s.h, a, b) && !tilesHole(s, b * s.w + a, t), random);
}

/** Farbrausch: walk to tiles that are not yours yet; throw the bomb where others' paint is. */
function paintBot(s: PaintState, i: number, m: BotMemory, _params: Params, random: () => number): number {
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  const t = s.tick;
  if (t < m.wakeAt) return m.dir;
  m.wakeAt = t + Math.round((1 - m.skill) * 5 * random());
  const free = (a: number, b: number) => inBounds(s.w, s.h, a, b) && playerAt(s.p, a, b) < 0;
  let foreign = 0;
  for (let b = y - 1; b <= y + 1; b++)
    for (let a = x - 1; a <= x + 1; a++) if (inBounds(s.w, s.h, a, b) && s.own[b * s.w + a] !== i) foreign++;
  const options = [1, 2, 3, 4]
    .filter((d) => free(x + DX[d]!, y + DY[d]!))
    .sort((a, b) => {
      const va = s.own[(y + DY[a]!) * s.w + x + DX[a]!] === i ? 0 : 1;
      const vb = s.own[(y + DY[b]!) * s.w + x + DX[b]!] === i ? 0 : 1;
      return vb - va || random() - 0.5;
    });
  const step = options[0] ?? 0;
  if (s.cool[i] === 0 && foreign >= 5 + Math.round((1 - m.skill) * 3)) return step + 5;
  return step;
}

/** Crash-Regen: step off the tiles a crash is about to hit (after a moment of shock). */
function crashBot(s: CrashState, i: number, m: BotMemory, params: Params, random: () => number): number {
  const t = s.tick;
  const danger = new Set<number>();
  let k = s.hit;
  let at = s.hitAt;
  while (at <= t) {
    if (t - at >= Math.round((1 - m.skill) * 14)) {
      const centres = crashCentres(s.seed, params.game as never, s.n, s.w, s.h, k);
      for (let tile = 0; tile < s.w * s.h; tile++)
        if (centres.some((c) => crashHits(s.w, c, tile % s.w, Math.floor(tile / s.w)))) danger.add(tile);
    }
    at += crashGap(params.game as never, k);
    k += 1;
    if (k > s.hit + 3) break;
  }
  const x = s.p.x[i]!;
  const y = s.p.y[i]!;
  const safe = (a: number, b: number) =>
    inBounds(s.w, s.h, a, b) && !danger.has(b * s.w + a) && playerAt(s.p, a, b) < 0;
  if (!danger.has(y * s.w + x)) return random() < 0.05 ? randomDir(s, i, safe, random) : 0;
  const options = [1, 2, 3, 4].filter((d) => safe(x + DX[d]!, y + DY[d]!));
  if (options.length) return options[Math.floor(random() * options.length)]!;
  return randomDir(s, i, (a, b) => inBounds(s.w, s.h, a, b) && playerAt(s.p, a, b) < 0, random);
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
  if (kind === "rodeo") return String(rodeoBot(state as RodeoState, slot, memory, params, random));
  // a jump over a laser beam comes whatever the legs do
  if (kind === "laser" && laserJump(state as LaserState, slot, memory, params, random))
    return String((state.p.mv[slot]! > 1 ? 0 : laserBot(state as LaserState, slot, memory, params, random)) + 5);
  // A step (or stun) that ends this tick lets the bot act now: decide afresh instead of repeating the last direction.
  if (kind !== "pump" && (state.p.mv[slot]! > 1 || state.p.stun[slot]! > 1))
    return String(kind === "laser" ? 0 : memory.dir || 0);
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
    case "bear":
      code = bearBot(state as BearState, slot, memory, params, random);
      break;
    case "dash":
      code = dashBot(state as DashState, slot, memory, params, random);
      break;
    case "margin":
      code = marginBot(state as MarginState, slot, memory, params, random);
      break;
    case "elevator":
      code = elevatorBot(state as ElevatorState, slot, memory, params, random);
      break;
    case "laser":
      code = laserBot(state as LaserState, slot, memory, params, random);
      break;
    case "zone":
      code = zoneBot(state as ZoneState, slot, memory, params, random);
      break;
    case "tag":
      code = tagBot(state as TagState, slot, memory, params, random);
      break;
    case "tiles":
      code = tilesBot(state as TilesState, slot, memory, params, random);
      break;
    case "paint":
      code = paintBot(state as PaintState, slot, memory, params, random);
      break;
    case "crash":
      code = crashBot(state as CrashState, slot, memory, params, random);
      break;
  }
  // (Laserschranke keeps its jump plan in memory.dir)
  if (kind !== "pump" && kind !== "laser") memory.dir = code % 5;
  return String(code);
}
