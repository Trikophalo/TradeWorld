/**
 * Aktie pumpen (ADR-160): tap to pump your stock. Green and yellow count one, the golden window three; a tap while
 * the light is red (the crash) costs a quarter of your points and freezes you. At most one tap per tick counts
 * (20 per second, faster than any thumb). The light schedule comes from the seed. Most points wins; at a draw, who
 * got there first. Mirrored by public.battle_sim_pump.
 */
import type { PumpParams } from "../../../config/battles.ts";
import { checkEnd, rankByKeys, readInputs, spawnPlayers, type GridBase, type SimParams } from "./core.ts";
import { battleHash } from "./hash.ts";

export const GREEN = 0;
export const GOLDEN = 1;
export const YELLOW = 2;
export const RED = 3;

export interface PumpState extends GridBase {
  /** Start tick and light of every phase, in order. */
  phaseStart: number[];
  phaseLight: number[];
  phase: number;
  score: number[];
  reach: number[];
  frozen: number[];
  busts: number[];
}

/** The light schedule of a seed: green (with a golden end every goldEvery-th time), yellow, red, again. */
export function pumpSchedule(seed: number, g: PumpParams): { start: number[]; light: number[] } {
  const start: number[] = [];
  const light: number[] = [];
  let t = 0;
  for (let j = 0; t < g.durationTicks; j++) {
    const green = g.greenMin + (battleHash(seed, 500, j) % g.greenJitter);
    const golden = j % g.goldEvery === g.goldEvery - 1 && green > g.goldTicks;
    start.push(t);
    light.push(GREEN);
    if (golden) {
      start.push(t + green - g.goldTicks);
      light.push(GOLDEN);
    }
    t += green;
    start.push(t);
    light.push(YELLOW);
    t += g.yellowTicks;
    start.push(t);
    light.push(RED);
    t += g.redMin + (battleHash(seed, 501, j) % g.redJitter);
  }
  return { start, light };
}

export function pumpInit(seed: number, n: number, params: SimParams<PumpParams>): PumpState {
  const schedule = pumpSchedule(seed, params.game);
  return {
    seed,
    n,
    w: params.w,
    h: params.h,
    tick: 0,
    done: false,
    endTick: -1,
    p: spawnPlayers(seed, n, params.spawns),
    phaseStart: schedule.start,
    phaseLight: schedule.light,
    phase: 0,
    score: Array<number>(n).fill(0),
    reach: Array<number>(n).fill(0),
    frozen: Array<number>(n).fill(0),
    busts: Array<number>(n).fill(0),
  };
}

export function pumpClone(s: PumpState): PumpState {
  return {
    ...s,
    p: { ...s.p, out: [...s.p.out], xrun: [...s.p.xrun] },
    score: [...s.score],
    reach: [...s.reach],
    frozen: [...s.frozen],
    busts: [...s.busts],
  };
}

/** The light at `tick` (from the phase index onwards). */
export function pumpLight(s: PumpState, tick: number): number {
  let k = s.phase;
  while (k + 1 < s.phaseStart.length && s.phaseStart[k + 1]! <= tick) k++;
  return s.phaseLight[k]!;
}

export function pumpStep(s: PumpState, inputs: string, params: SimParams<PumpParams>): void {
  if (s.done) return;
  const g = params.game;
  const t = s.tick;
  const p = s.p;
  const codes = readInputs(p, inputs, t, params.disconnectTicks);
  while (s.phase + 1 < s.phaseStart.length && s.phaseStart[s.phase + 1]! <= t) s.phase += 1;
  const light = s.phaseLight[s.phase]!;
  for (let i = 0; i < p.n; i++) {
    if (p.out[i]! >= 0) continue;
    if (s.frozen[i]! > 0) {
      s.frozen[i]! -= 1;
      continue;
    }
    if (codes[i]! <= 0) continue;
    if (light === RED) {
      s.score[i]! -= Math.floor((s.score[i]! * g.bustLossBps) / 10_000);
      s.busts[i]! += 1;
      s.frozen[i] = g.bustFreezeTicks;
    } else {
      s.score[i]! += light === GOLDEN ? g.goldValue : 1;
      s.reach[i] = t;
    }
  }
  checkEnd(s, g.durationTicks);
  s.tick = t + 1;
}

export function pumpRanking(s: PumpState): number[] {
  return rankByKeys(s.seed, s.n, (i) => [s.p.out[i]! < 0 ? 1 : 0, s.score[i]!, s.score[i]! > 0 ? -s.reach[i]! : 0]);
}
