import { describe, expect, it } from "vitest";
import type { TickKind } from "../../../config/battles.ts";
import type { BullsState } from "./bulls.ts";
import { BEAR, COIN, GOLD, type CoinsState } from "./coins.ts";
import { inputCode, MISSED, QUIT, rankByKeys, spawnPlayers } from "./core.ts";
import type { FloorState } from "./floor.ts";
import {
  acceptChunk,
  cloneBattle,
  defaultSimParams,
  finalTick,
  initBattle,
  quitStream,
  simulateBattle,
  stepBattle,
  tickInputs,
} from "./index.ts";
import type { PotatoState } from "./potato.ts";
import { GOLDEN, GREEN, RED, YELLOW, pumpSchedule, type PumpState } from "./pump.ts";
import type { SumoState } from "./sumo.ts";

/** Parameters of a game with some numbers changed (and the others as configured). */
function params<K extends TickKind>(kind: K, game: Record<string, unknown> = {}, spawns?: [number, number][]) {
  const p = defaultSimParams(kind);
  return { ...p, spawns: spawns ?? p.spawns, game: { ...p.game, ...game } } as never;
}
const repeat = (ch: string, n: number) => ch.repeat(n);

/** Puts the players on these tiles (the spawn order otherwise comes from the seed). */
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

function run<K extends TickKind>(
  kind: K,
  s: ReturnType<typeof initBattle>,
  streams: string[],
  until: number,
  p: never,
) {
  while (!s.done && s.tick < until) stepBattle(kind, s, tickInputs(streams, s.tick), p);
  return s;
}

describe("core", () => {
  it("decodes inputs", () => {
    expect([
      inputCode("0"),
      inputCode("3"),
      inputCode("8"),
      inputCode("x"),
      inputCode("q"),
      inputCode(undefined),
    ]).toEqual([0, 3, 8, MISSED, QUIT, MISSED]);
  });

  it("hands out the spawn tiles in an order drawn from the seed", () => {
    const spawns: [number, number][] = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    const a = spawnPlayers(1, 3, spawns);
    expect(new Set(a.x)).toEqual(new Set([0, 1, 2]));
    const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => spawnPlayers(seed, 3, spawns).x.join()));
    expect(orders.size).toBeGreaterThan(1);
    expect(spawnPlayers(1, 3, spawns).x).toEqual(a.x);
  });

  it("ranks by keys, then by lot", () => {
    expect(rankByKeys(5, 3, (i) => [[1, 3, 2][i]!])).toEqual([1, 2, 0]);
    const tie = rankByKeys(5, 3, () => [0]);
    expect(new Set(tie)).toEqual(new Set([0, 1, 2]));
    expect(rankByKeys(5, 3, () => [0])).toEqual(tie);
  });

  it("players block each other: two players never stand on one tile", () => {
    // two players walk towards each other forever
    const p = params("coins");
    const s = run(
      "coins",
      place(initBattle("coins", 1, 2, p), [
        [2, 4],
        [6, 4],
      ]),
      [repeat("2", 200), repeat("4", 200)],
      200,
      p,
    );
    // both want the tile between them: order-free, nobody gets it
    expect(Math.abs(s.p.x[0]! - s.p.x[1]!)).toBe(2);
  });

  it("80 missing inputs disconnect a player, a quit ends at once", () => {
    const p = params("pump");
    const s = simulateBattle("pump", 3, [repeat("1", 300), "", repeat("0", 10) + "q"], 300, p) as PumpState;
    expect(s.p.out).toEqual([-1, 79, 10]);
    expect(s.done).toBe(true);
    expect(s.endTick).toBe(79);
  });
});

describe("Kurssturz", () => {
  it("standing still cracks the own tile, it falls after the warning", () => {
    const p = params("floor", { firstWave: 10_000 });
    const s = simulateBattle("floor", 1, [repeat("0", 200), repeat("2", 4) + repeat("4", 200)], 200, p) as FloorState;
    // stompTicks 50 standing (idle counts from tick 0), then warnTicks 24
    expect(s.p.out[0]).toBe(49 + 24);
  });

  it("waves crack tiles that fall warnTicks later; walking onto a hole is a fall", () => {
    const p = params("floor", { firstWave: 5, crackStart: 99, crackMax: 99, stompTicks: 10_000 });
    const s = initBattle("floor", 4, 2, p) as FloorState;
    for (let t = 0; t <= 5; t++) stepBattle("floor", s, "00", p);
    const cracked = s.crack.filter((c) => c > 0);
    expect(cracked.every((c) => c === 5 + 24)).toBe(true);
    expect(cracked.length).toBeGreaterThan(8);
  });

  it("the endgame breaks one tile at a time, so the last one standing wins", () => {
    const p = params("floor");
    const s = simulateBattle("floor", 9, ["", ""], 2000, p) as FloorState;
    expect(s.done).toBe(true);
  });
});

describe("Bullenreiten", () => {
  it("a bull costs a heart, then a moment of invulnerability; three hits are out", () => {
    const p = params("bulls", { firstSpawn: 0, spawnEvery: 30, spawnEveryMin: 30, warnTicks: 4, countMax: 1 });
    const s = initBattle("bulls", 11, 3, p) as BullsState;
    let hits = 0;
    for (let t = 0; t < 1500 && !s.done; t++) {
      const before = s.hearts.reduce((a, b) => a + b, 0);
      stepBattle("bulls", s, "000", p);
      if (s.hearts.reduce((a, b) => a + b, 0) < before) hits++;
    }
    expect(hits).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) if (s.p.out[i]! >= 0) expect(s.hearts[i]).toBe(0);
  });
});

describe("Geldregen", () => {
  it("a coin landing on a player is caught; a bear stuns and costs coins", () => {
    const p = params("coins");
    const s = initBattle("coins", 2, 1, p) as CoinsState;
    const tile = s.p.y[0]! * s.w + s.p.x[0]!;
    s.drops.push({ tile, land: 3, type: GOLD, taken: false }, { tile, land: 5, type: COIN, taken: false });
    s.drops.push({ tile, land: 8, type: BEAR, taken: false });
    s.nextDrop = 10_000;
    for (let t = 0; t < 10; t++) stepBattle("coins", s, "0", p);
    expect(s.score[0]).toBe(4 - 2);
    expect(s.reach[0]).toBe(5);
    expect(s.p.stun[0]).toBeGreaterThan(0);
  });

  it("ends after its duration; most coins win, at a draw who got there first", () => {
    const s = simulateBattle(
      "coins",
      1,
      ["0".repeat(900), "0".repeat(900)],
      2000,
      params("coins", { firstDrop: 10_000 }),
    );
    expect(s.endTick).toBe(899);
  });
});

describe("Sumo am Parkett", () => {
  it("walking into someone shoves them; the shover needs time, off the ring is out", () => {
    const p = params("sumo", { firstShrink: 10_000 });
    const s = run(
      "sumo",
      place(initBattle("sumo", 1, 2, p), [
        [1, 4],
        [0, 4],
      ]),
      [repeat("4", 40), repeat("0", 40)],
      40,
      p,
    ) as SumoState;
    expect(s.p.out[1]).toBeGreaterThanOrEqual(0);
    expect(s.pushes[0]).toBe(1);
    expect(s.done).toBe(true);
  });

  it("nobody walks off the ring alone", () => {
    const p = params("sumo", { firstShrink: 10_000 });
    const s = run(
      "sumo",
      place(initBattle("sumo", 1, 2, p), [
        [0, 4],
        [10, 4],
      ]),
      [repeat("4", 100), repeat("2", 100)],
      100,
      p,
    );
    expect(s.p.out).toEqual([-1, -1]);
  });

  it("two shoves on one player cancel out; a player being shoved cannot shove", () => {
    const p = params("sumo", { firstShrink: 10_000 });
    const s = place(initBattle("sumo", 1, 3, p) as SumoState, [
      [4, 4],
      [5, 4],
      [6, 4],
    ]);
    stepBattle("sumo", s, "240", p);
    expect([s.p.x[0], s.p.x[1], s.p.x[2]]).toEqual([4, 5, 6]);
  });

  it("the ring shrinks from the outside", () => {
    const s = simulateBattle("sumo", 1, ["", "", ""], 2000, params("sumo")) as SumoState;
    expect(s.done).toBe(true);
    expect(s.fall.filter((f) => f > 0).length).toBeGreaterThan(40);
  });
});

describe("Giftaktie", () => {
  it("bumping someone passes the stock; whoever holds it at the bang is out", () => {
    const p = params("potato", {
      firstRound: 0,
      walls: [],
      fuseBaseSeconds: 3,
      fuseMinSeconds: 3,
      fuseJitterSeconds: 1,
    });
    const s = place(initBattle("potato", 5, 3, p) as PotatoState, [
      [2, 4],
      [3, 4],
      [9, 4],
    ]);
    stepBattle("potato", s, "000", p);
    const first = s.holder;
    expect(first).toBeGreaterThanOrEqual(0);
    const inputs = first === 0 ? "200" : first === 1 ? "040" : "000";
    for (let t = 0; t < 4; t++) stepBattle("potato", s, inputs, p);
    if (first < 2) expect(s.holder).toBe(1 - first);
    for (let t = 0; t < 80 && s.p.out.every((o) => o < 0); t++) stepBattle("potato", s, "000", p);
    expect(s.p.out.filter((o) => o >= 0)).toHaveLength(1);
  });
});

describe("Aktie pumpen", () => {
  it("the light schedule covers the game, with golden windows", () => {
    const g = defaultSimParams("pump").game;
    const { start, light } = pumpSchedule(1, g);
    expect(start[0]).toBe(0);
    expect(start.at(-1)!).toBeLessThan(g.durationTicks);
    expect(light).toContain(GOLDEN);
    expect(new Set(light)).toEqual(new Set([GREEN, GOLDEN, YELLOW, RED]));
  });

  it("taps count on green, triple on gold, a tap in red costs a quarter and freezes", () => {
    const p = params("pump");
    const s = initBattle("pump", 8, 1, p) as PumpState;
    s.phaseStart = [0, 10, 20, 30];
    s.phaseLight = [GREEN, GOLDEN, RED, GREEN];
    for (let t = 0; t < 21; t++) stepBattle("pump", s, "1", p);
    expect(s.score[0]).toBe(Math.floor((10 + 30) * 0.75));
    expect(s.busts[0]).toBe(1);
    expect(s.frozen[0]).toBeGreaterThan(0);
  });
});

describe("stream rules (battle_input)", () => {
  it("nothing is rewritten, late ticks are x, nothing far ahead, only digits", () => {
    expect(acceptChunk("", 0, "1234", 0, 100, 10)).toBe("1234");
    expect(acceptChunk("12", 0, "9999", 0, 100, 10)).toBe("1299");
    expect(acceptChunk("12", 5, "33", 0, 100, 10)).toBe("12xxx33");
    expect(acceptChunk("", 0, "11111", 3, 100, 10)).toBe("xxx11");
    expect(acceptChunk("", 0, "2".repeat(30), 0, 5, 10)).toBe("2".repeat(16));
    expect(acceptChunk("", 0, "a1?", 0, 100, 10)).toBe("010");
    expect(acceptChunk("12q", 3, "44", 0, 100, 10)).toBe("12q");
    expect(quitStream("12", 5)).toBe("12xxxq");
    expect(quitStream("1234", 2)).toBe("1234q");
  });

  it("final ticks lag the clock by the grace time", () => {
    expect(finalTick(500, 50, 1000)).toBe(0);
    expect(finalTick(3000, 50, 1000)).toBe(40);
  });

  it("a cloned state runs on independently (prediction)", () => {
    const p = params("floor");
    const s = initBattle("floor", 1, 2, p);
    const c = cloneBattle("floor", s);
    for (let t = 0; t < 10; t++) stepBattle("floor", c, tickInputs(["2222222222", "3333333333"], t), p);
    expect(s.tick).toBe(0);
    expect(c.tick).toBe(10);
    expect(s.p.x).not.toEqual(c.p.x);
  });
});
