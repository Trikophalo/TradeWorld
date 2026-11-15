import { describe, expect, it } from "vitest";
import type { TickKind } from "../../../config/battles.ts";
import { bearStepTicks, type BearState } from "./bear.ts";
import { dashValue, type DashState } from "./dash.ts";
import { elevatorMask, elevatorSolid, type ElevatorState } from "./elevator.ts";
import { cloneBattle, defaultSimParams, initBattle, simulateBattle, stepBattle, tickInputs } from "./index.ts";
import { laserAt, type LaserState } from "./laser.ts";
import { marginShowTicks, type MarginState } from "./margin.ts";
import { RODEO_HIT, RODEO_MISS, rodeoWindow, type RodeoState } from "./rodeo.ts";

/*
 * The six action games added to the news battles (ADR-160, addendum): Bärenjagd, Dividenden-Dash, Margin Call,
 * Fahrstuhl zum Mond, Laserschranke and Bullen-Rodeo. The TS/SQL vectors are in vectors.test.ts.
 */

function params<K extends TickKind>(kind: K, game: Record<string, unknown> = {}) {
  const p = defaultSimParams(kind);
  return { ...p, game: { ...p.game, ...game } } as never;
}
const repeat = (ch: string, n: number) => ch.repeat(n);

function place<S extends { p: { x: number[]; y: number[]; fx: number[]; fy: number[] } }>(
  s: S,
  tiles: [number, number][],
): S {
  tiles.forEach(([x, y], i) => {
    s.p.x[i] = x;
    s.p.y[i] = y;
    s.p.fx[i] = x;
    s.p.fy[i] = y;
  });
  return s;
}

function run<S extends { done: boolean; tick: number }>(
  kind: TickKind,
  s: S,
  streams: string[],
  until: number,
  p: never,
) {
  while (!s.done && s.tick < until) stepBattle(kind, s as never, tickInputs(streams, s.tick), p);
  return s;
}

describe("Bärenjagd", () => {
  it("bears come out of the den one after another and get faster", () => {
    const g = defaultSimParams("bear").game;
    expect(bearStepTicks(g, 0)).toBe(g.stepStart);
    expect(bearStepTicks(g, 100_000)).toBe(g.stepMin);
    const p = params("bear");
    const s = simulateBattle(
      "bear",
      3,
      ["0", "0", "0"].map((c) => repeat(c, 400)),
      400,
      p,
    ) as BearState;
    expect(s.bears).toBe(g.bearTicks.filter((t) => t < Math.min(400, s.tick)).length);
  });

  it("a bear goes for the closest player and catches whoever stands still", () => {
    const p = params("bear", { bearTicks: [0] });
    const s = place(initBattle("bear", 1, 2, p) as BearState, [
      [5, 1],
      [0, 8],
    ]);
    run("bear", s, [repeat("0", 200), repeat("0", 200)], 200, p);
    expect(s.p.out[0]).toBeGreaterThanOrEqual(0);
    expect(s.p.out[1]).toBe(-1);
    expect(s.done).toBe(true);
  });

  it("walks around the pillars and sits to eat after a catch", () => {
    // the player stands right behind a pillar: the bear needs a detour
    const p = params("bear", { bearTicks: [0], den: [3, 1], pillars: [[3, 2]] });
    const s = place(initBattle("bear", 2, 3, p) as BearState, [
      [3, 3],
      [10, 8],
      [0, 8],
    ]);
    while (!s.done && s.p.out[0]! < 0) stepBattle("bear", s, "000", p);
    expect(s.p.out[0]).toBeGreaterThan(3 * 7);
    expect(s.beat[0]).toBe(s.p.out[0]! + defaultSimParams("bear").game.eatTicks);
  });

  it("swapping tiles with a bear is a catch too", () => {
    const p = params("bear", { bearTicks: [0], den: [5, 4], pillars: [] });
    const s = place(initBattle("bear", 3, 2, p) as BearState, [
      [5, 5],
      [0, 0],
    ]);
    // the player steps up onto the den the tick the bear steps down
    s.bnext[0] = 0;
    stepBattle("bear", s, "10", p);
    stepBattle("bear", s, "10", p);
    expect(s.p.out[0]).toBeGreaterThanOrEqual(0);
  });
});

describe("Dividenden-Dash", () => {
  it("whoever steps on a coin takes it; a new one appears on a free tile; every fifth is worth more", () => {
    const g = defaultSimParams("dash").game;
    expect([0, 1, 2, 3, 4].map((i) => dashValue(g, i))).toEqual([1, 1, 1, 1, g.goldValue]);
    const p = params("dash", { firstCoin: 0 });
    const s = place(initBattle("dash", 4, 1, p) as DashState, [[0, 0]]);
    s.ct[0] = 1;
    stepBattle("dash", s, "2", p);
    for (let t = 0; t < 4; t++) stepBattle("dash", s, "0", p);
    expect(s.score[0]).toBe(1);
    expect(s.ct[0]).not.toBe(1);
    expect(s.ca[0]).toBe(g.spawnDelay);
  });

  it("a tackle (walking into someone with the action) stuns them", () => {
    const p = params("dash", { firstCoin: 10_000 });
    const s = place(initBattle("dash", 4, 2, p) as DashState, [
      [3, 3],
      [4, 3],
    ]);
    stepBattle("dash", s, "70", p);
    expect(s.p.stun[1]).toBe(defaultSimParams("dash").game.tackleStun);
    expect(s.tackles[0]).toBe(1);
    // without the action it is only a bump
    const s2 = place(initBattle("dash", 4, 2, p) as DashState, [
      [3, 3],
      [4, 3],
    ]);
    stepBattle("dash", s2, "20", p);
    expect(s2.p.stun[1]).toBe(0);
  });

  it("the first to the target wins at once", () => {
    const p = params("dash", { target: 1, firstCoin: 0 });
    const s = place(initBattle("dash", 4, 2, p) as DashState, [
      [0, 0],
      [10, 8],
    ]);
    s.ct[0] = 1;
    stepBattle("dash", s, "20", p);
    expect(s.done).toBe(true);
    expect(s.endTick).toBe(0);
  });
});

describe("Margin Call", () => {
  it("lights spare tiles in the warm-up, then one fewer than players, never under a player", () => {
    const p = params("margin", { firstRound: 0 });
    const s = initBattle("margin", 5, 4, p) as MarginState;
    stepBattle("margin", s, "0000", p);
    const g = defaultSimParams("margin").game;
    expect(s.safe.filter((v) => v === 1)).toHaveLength(4 - 1 + g.warmupRounds);
    for (let i = 0; i < 4; i++) expect(s.safe[s.p.y[i]! * s.w + s.p.x[i]!]).toBe(0);
    expect(s.call).toBe(marginShowTicks(g, 0));
    expect(marginShowTicks(g, 100)).toBe(g.showMin);
  });

  it("at the gong whoever is not on a safe tile is out; closer ranks higher", () => {
    const p = params("margin", { firstRound: 0 });
    const s = place(initBattle("margin", 6, 3, p) as MarginState, [
      [0, 0],
      [10, 8],
      [5, 4],
    ]);
    stepBattle("margin", s, "000", p);
    // put player 0 on a safe tile, the others stay
    const tile = s.safe.findIndex((v) => v === 1);
    s.p.x[0] = tile % s.w;
    s.p.y[0] = Math.floor(tile / s.w);
    while (s.tick <= s.call) stepBattle("margin", s, "000", p);
    expect(s.p.out[0]).toBe(-1);
    expect(s.p.out[1]).toBeGreaterThanOrEqual(0);
    expect(s.p.out[2]).toBeGreaterThanOrEqual(0);
    expect(s.dist[1]! > 0 && s.dist[2]! > 0).toBe(true);
    expect(s.done).toBe(true);
  });

  it("when nobody makes it, nobody is out", () => {
    const p = params("margin", { firstRound: 0 });
    const s = initBattle("margin", 7, 3, p) as MarginState;
    stepBattle("margin", s, "000", p);
    s.safe.fill(0);
    while (s.tick <= s.call) stepBattle("margin", s, "000", p);
    expect(s.p.out).toEqual([-1, -1, -1]);
    expect(s.round).toBe(1);
  });
});

describe("Fahrstuhl zum Mond", () => {
  it("every third row is a bar with gaps, fewer higher up", () => {
    const g = defaultSimParams("elevator").game;
    const bits = (m: number) =>
      m
        .toString(2)
        .split("")
        .filter((b) => b === "1").length;
    expect(elevatorMask(1, g, 11, 0)).toBe(0);
    expect(elevatorMask(1, g, 11, 1)).toBe(0);
    expect(bits(elevatorMask(1, g, 11, 3))).toBe(g.gapStart);
    expect(bits(elevatorMask(1, g, 11, 300))).toBe(g.gapMin);
  });

  it("the bars block, the gaps let through, the top edge holds", () => {
    const p = params("elevator", { firstRise: 10_000 });
    const s = initBattle("elevator", 2, 1, p) as ElevatorState;
    const mask = s.masks[3]!;
    const gap = [...Array(11).keys()].find((x) => (mask & (1 << x)) !== 0)!;
    const wall = [...Array(11).keys()].find((x) => (mask & (1 << x)) === 0)!;
    // row r = 3 is y = 5
    expect(elevatorSolid(s, wall, 5)).toBe(true);
    expect(elevatorSolid(s, gap, 5)).toBe(false);
    place(s, [[wall, 6]]);
    run("elevator", s, [repeat("1", 40)], 40, p);
    expect(s.p.y[0]).toBe(6);
    place(s, [[gap, 6]]);
    run("elevator", s, [repeat("0", 40) + repeat("1", 200)], 240, p);
    expect(s.p.y[0]).toBeLessThanOrEqual(5);
    expect(s.p.y[0]).toBeGreaterThanOrEqual(-s.cam);
  });

  it("whoever stays below the bottom edge is out; the screen climbs ever faster", () => {
    const p = params("elevator");
    const s = simulateBattle("elevator", 3, [repeat("0", 2000), repeat("1", 2000)], 2000, p) as ElevatorState;
    expect(s.done).toBe(true);
    expect(s.p.out.filter((o) => o >= 0)).toHaveLength(1);
    expect(s.cam).toBeGreaterThan(0);
  });
});

describe("Laserschranke", () => {
  it("a beam travels one tile every ticksPerTile", () => {
    const l = { line: 0, dir: 1, gap: -1, t0: 10 };
    expect([
      laserAt({ w: 11, h: 9 }, l, 9, 2),
      laserAt({ w: 11, h: 9 }, l, 10, 2),
      laserAt({ w: 11, h: 9 }, l, 13, 2),
    ]).toEqual([-1, 0, 1]);
    expect(laserAt({ w: 11, h: 9 }, { ...l, dir: -1 }, 10, 2)).toBe(8);
    expect(laserAt({ w: 11, h: 9 }, l, 10 + 9 * 2, 2)).toBe(-1);
  });

  it("on the ground the beam costs a heart; a jump at the right moment saves it", () => {
    const p = params("laser", { firstSpawn: 10_000 });
    const s = place(initBattle("laser", 1, 2, p) as LaserState, [
      [2, 0],
      [8, 0],
    ]);
    s.lasers.push({ line: 0, dir: 1, gap: -1, t0: 6 });
    // player 0 jumps at tick 4 (in the air until 12), player 1 stays down
    run("laser", s, [repeat("0", 4) + repeat("5", 20), repeat("0", 24)], 20, p);
    expect(s.hearts).toEqual([3, 2]);
    expect(s.jumps[0]).toBe(1);
  });

  it("holding the action does not jump again; the gap does not burn", () => {
    const p = params("laser", { firstSpawn: 10_000 });
    const s = place(initBattle("laser", 1, 2, p) as LaserState, [
      [2, 0],
      [5, 0],
    ]);
    s.lasers.push({ line: 0, dir: 1, gap: 5, t0: 40 });
    run("laser", s, [repeat("5", 60), repeat("0", 60)], 60, p);
    expect(s.jumps[0]).toBe(1);
    expect(s.hearts).toEqual([2, 3]);
  });

  it("waves of beams come from the seed until one is left", () => {
    const s = simulateBattle(
      "laser",
      5,
      [repeat("0", 2000), repeat("0", 2000), repeat("0", 2000)],
      2000,
      params("laser"),
    ) as LaserState;
    expect(s.done).toBe(true);
    expect(s.lasers.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Bullen-Rodeo", () => {
  it("a new press of the cued direction scores the ticks left; holding it from before does not count", () => {
    const p = params("rodeo", { firstCue: 5 });
    const s = initBattle("rodeo", 9, 3, p) as RodeoState;
    const g = defaultSimParams("rodeo").game;
    while (s.tick < 5) stepBattle("rodeo", s, "000", p);
    const d = String(1 + ((s.cueDir || 0) % 5));
    // the cue opens at tick 5
    stepBattle("rodeo", s, "000", p);
    const cue = String(s.cueDir);
    const wrong = String((s.cueDir % 4) + 1);
    stepBattle("rodeo", s, `${cue}${wrong}0`, p);
    expect(d).toBeTruthy();
    expect(s.resp.slice(0, 2)).toEqual([RODEO_HIT, RODEO_MISS]);
    expect(s.score[0]).toBe(rodeoWindow(g, 0) - 1);
    while (s.cueStart >= 0) stepBattle("rodeo", s, `${cue}${wrong}0`, p);
    expect(s.grip).toEqual([g.grip, g.grip - 1, g.grip - 1]);
    // the next cue: holding the old direction is no press
    while (s.cueStart < 0) stepBattle("rodeo", s, `${cue}${cue}${cue}`, p);
    if (s.cueDir === Number(cue)) {
      while (s.cueStart >= 0) stepBattle("rodeo", s, `${cue}${cue}${cue}`, p);
      expect(s.last).toEqual([RODEO_MISS, RODEO_MISS, RODEO_MISS]);
    }
  });

  it("when every rider misses, nobody loses grip; the windows shrink", () => {
    const g = defaultSimParams("rodeo").game;
    expect(rodeoWindow(g, 0)).toBe(g.windowStart);
    expect(rodeoWindow(g, 1000)).toBe(g.windowMin);
    const s = simulateBattle("rodeo", 3, [repeat("0", 600), repeat("0", 600)], 600, params("rodeo")) as RodeoState;
    expect(s.grip).toEqual([g.grip, g.grip]);
    expect(s.cue).toBeGreaterThan(5);
  });

  it("a clone runs on independently (prediction)", () => {
    const p = params("rodeo");
    const s = initBattle("rodeo", 1, 2, p);
    const c = cloneBattle("rodeo", s);
    for (let t = 0; t < 60; t++) stepBattle("rodeo", c, "12", p);
    expect(s.tick).toBe(0);
    expect((c as RodeoState).prev).not.toEqual((s as RodeoState).prev);
  });
});
