import { describe, expect, it } from "vitest";
import { BATTLE_RULES, type TickKind } from "../../../config/battles.ts";
import { crashCentres, crashHits, crashWaveTick, type CrashState } from "./crash.ts";
import { battleRanking, defaultSimParams, initBattle, simulateBattle, stepBattle, tickInputs } from "./index.ts";
import type { PaintState } from "./paint.ts";
import { packsValueCents, pickPackPrize, pickWeighted } from "./prizes.ts";
import type { TagState } from "./tag.ts";
import { tilesBreakDelay, tilesHole, tilesRegrow, type TilesState } from "./tiles.ts";
import { zoneDist, zoneShrinkTick, zoneStartRadius, type ZoneState } from "./zone.ts";

/*
 * The five action games of ADR-177 (Goldrausch-Zone, Bulle und Bär, Wackelparkett, Farbrausch, Crash-Regen) and the
 * prize picking. The TS/SQL vectors are in vectors.test.ts.
 */

function params<K extends TickKind>(kind: K, game: Record<string, unknown> = {}) {
  const p = defaultSimParams(kind);
  return { ...p, game: { ...p.game, ...game } } as never;
}

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

describe("Goldrausch-Zone", () => {
  const g = BATTLE_RULES.games.zone;

  it("starts covering the arena and shrinks ring by ring down to the minimum", () => {
    const p = params("zone");
    const s = initBattle("zone", 1, 3, p) as ZoneState;
    expect(zoneStartRadius(11, 9)).toBe(5);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 11; x++) expect(zoneDist(s, x, y)).toBeLessThanOrEqual(s.r);
    place(s, [
      [5, 4],
      [6, 4],
      [5, 5],
    ]);
    run(
      "zone",
      s,
      ["0", "0", "0"].map((c) => c.repeat(2000)),
      zoneShrinkTick(g, 0) + 1,
      p,
    );
    expect(s.r).toBe(4);
    run(
      "zone",
      s,
      ["0", "0", "0"].map((c) => c.repeat(2000)),
      2000,
      p,
    );
    expect(s.r).toBe(g.radiusMin);
    expect(s.done).toBe(true);
  });

  it("whoever is outside when the zone shrinks is out; nobody can walk out of it", () => {
    const p = params("zone");
    const s = place(initBattle("zone", 2, 3, p) as ZoneState, [
      [0, 0],
      [5, 4],
      [6, 4],
    ]);
    run(
      "zone",
      s,
      ["0", "0", "0"].map((c) => c.repeat(2000)),
      zoneShrinkTick(g, 0) + 1,
      p,
    );
    expect(s.p.out).toEqual([zoneShrinkTick(g, 0), -1, -1]);
    // walking left from the edge of the shrunken zone is blocked
    const left = place(initBattle("zone", 2, 3, p) as ZoneState, [
      [1, 4],
      [5, 4],
      [6, 4],
    ]);
    left.r = 4;
    run("zone", left, ["4".repeat(40), "0".repeat(40), "0".repeat(40)], 30, p);
    expect(left.p.x[0]).toBe(1);
  });

  it("coins lie inside the zone and are taken by stepping on them", () => {
    const p = params("zone");
    const s = initBattle("zone", 5, 6, p) as ZoneState;
    expect(s.ct.length).toBe(Math.min(g.coinsMax, 1 + Math.floor(6 / g.coinsPerPlayers)));
    const final = simulateBattle(
      "zone",
      5,
      Array.from({ length: 6 }, (_, i) => "1234".repeat(500).slice(i)),
      2000,
      p,
    ) as ZoneState;
    for (const tile of final.ct) expect(zoneDist(final, tile % 11, Math.floor(tile / 11))).toBeLessThanOrEqual(final.r);
    expect(final.done).toBe(true);
  });
});

describe("Bulle und Bär", () => {
  it("walking into a bull makes it the bear, frozen", () => {
    const p = params("tag");
    const s = initBattle("tag", 3, 3, p) as TagState;
    s.bear = 0;
    place(s, [
      [2, 2],
      [3, 2],
      [8, 7],
    ]);
    run("tag", s, ["2".repeat(10), "0".repeat(10), "0".repeat(10)], 1, p);
    expect(s.bear).toBe(1);
    expect(s.tags[0]).toBe(1);
    expect(s.p.stun[1]).toBe(BATTLE_RULES.games.tag.freezeTicks);
  });

  it("the fewest ticks as bear wins; a leaving bear is replaced", () => {
    const p = params("tag");
    const s = initBattle("tag", 9, 3, p) as TagState;
    const bear = s.bear;
    const streams = ["0", "0", "0"].map((c) => c.repeat(2000));
    streams[bear] = "0".repeat(10) + "q";
    run("tag", s, streams, 30, p);
    expect(s.p.out[bear]).toBe(10);
    expect(s.bear).not.toBe(bear);
    expect(s.p.out[s.bear]).toBe(-1);
    const done = simulateBattle(
      "tag",
      9,
      ["0", "0", "0"].map((c) => c.repeat(2000)),
      2000,
      p,
    ) as TagState;
    expect(done.held.reduce((a, b) => a + b, 0)).toBe(done.tick);
    expect(battleRanking("tag", done).at(-1)).toBe(done.bear);
  });
});

describe("Wackelparkett", () => {
  const g = BATTLE_RULES.games.tiles;

  it("a tile you leave breaks later and grows back", () => {
    expect(tilesBreakDelay(g, 0)).toBe(g.breakStart);
    expect(tilesBreakDelay(g, 100_000)).toBe(g.breakMin);
    expect(tilesRegrow(g, 800)).toBe(g.regrowStart + 100);
    const p = params("tiles");
    const s = place(initBattle("tiles", 4, 3, p) as TilesState, [
      [2, 2],
      [8, 2],
      [8, 6],
    ]);
    run("tiles", s, ["2" + "0".repeat(100), "1032".repeat(50), "1032".repeat(50)], 1, p);
    const tile = 2 * 11 + 2;
    expect(s.crack[tile]).toBe(tilesBreakDelay(g, 0));
    run(
      "tiles",
      s,
      ["2" + "0".repeat(10) + "2".repeat(100), "1032".repeat(50), "1032".repeat(50)],
      g.breakStart + 1,
      p,
    );
    expect(tilesHole(s, tile, g.breakStart)).toBe(true);
  });

  it("standing still too long breaks your own tile", () => {
    const p = params("tiles");
    const s = simulateBattle("tiles", 6, ["0".repeat(2000), "1313".repeat(500), "2424".repeat(500)], 2000, p);
    expect(s.p.out[0]).toBe(g.idleMax - 1);
  });
});

describe("Farbrausch", () => {
  it("tiles take the colour of who stands on them; a bomb paints a square", () => {
    const p = params("paint");
    const s = place(initBattle("paint", 7, 3, p) as PaintState, [
      [2, 2],
      [8, 2],
      [8, 6],
    ]);
    s.own.fill(-1);
    s.score.fill(0);
    run("paint", s, ["5" + "0".repeat(10), "0".repeat(11), "0".repeat(11)], 1, p);
    expect(s.score[0]).toBe(9);
    expect(s.cool[0]).toBe(BATTLE_RULES.games.paint.bombCool);
    run("paint", s, ["5" + "2".repeat(10), "0".repeat(11), "0".repeat(11)], 10, p);
    expect(s.own[2 * 11 + 4]).toBe(0);
    expect(s.score.reduce((a, b) => a + b, 0)).toBe(s.own.filter((o) => o >= 0).length);
  });

  it("two bombs on the same tile in the same tick leave it alone", () => {
    const p = params("paint");
    const s = place(initBattle("paint", 7, 3, p) as PaintState, [
      [2, 2],
      [4, 2],
      [8, 6],
    ]);
    s.own.fill(-1);
    s.score.fill(0);
    run("paint", s, ["5", "5", "0"], 1, p);
    expect(s.own[2 * 11 + 3]).toBe(-1);
    expect(s.own[2 * 11 + 2]).toBe(0);
    expect(s.own[2 * 11 + 4]).toBe(1);
  });
});

describe("Crash-Regen", () => {
  const g = BATTLE_RULES.games.crash;

  it("waves come faster and bigger", () => {
    expect(crashWaveTick(g, 0)).toBe(g.firstWave);
    expect(crashWaveTick(g, 1) - crashWaveTick(g, 0)).toBe(g.waveEvery);
    expect(crashWaveTick(g, 100) - crashWaveTick(g, 99)).toBe(g.waveEveryMin);
    expect(crashCentres(1, g, 3, 11, 9, 0).length).toBe(g.countStart + 1);
    expect(crashCentres(1, g, 10, 11, 9, 200).length).toBe(g.countMax);
    expect(crashHits(11, 13, 2, 1)).toBe(true);
    expect(crashHits(11, 13, 3, 2)).toBe(false);
  });

  it("a crash costs a heart, then a moment of safety", () => {
    const p = params("crash");
    const s = initBattle("crash", 11, 3, p) as CrashState;
    const c = crashCentres(11, g, 3, 11, 9, 0)[0]!;
    place(s, [
      [c % 11, Math.floor(c / 11)],
      [0, 0],
      [10, 8],
    ]);
    run(
      "crash",
      s,
      ["0", "0", "0"].map((ch) => ch.repeat(2000)),
      g.firstWave + g.warnTicks + 1,
      p,
    );
    expect(s.hearts[0]).toBe(g.hearts - 1);
    expect(s.inv[0]).toBe(g.invulnTicks);
    const end = simulateBattle(
      "crash",
      11,
      ["0", "0", "0"].map((ch) => ch.repeat(2000)),
      2000,
      p,
    ) as CrashState;
    expect(end.done).toBe(true);
  });
});

describe("prizes", () => {
  const sets = [
    { key: "mystic_energy", priceCents: 20_000 },
    { key: "super_apex", priceCents: 100_000 },
    { key: "prismatic_peak", priceCents: 1_000_000 },
  ];
  const cap = BATTLE_RULES.prizes.packsCapCents;

  it("sealed packs never exceed the cap", () => {
    for (let a = 0; a < 10; a++)
      for (let b = 0; b < 10; b++)
        for (const c of [0.1, 0.9])
          for (let d = 0; d < 5; d++) {
            const packs = pickPackPrize(sets, cap, BATTLE_RULES.prizes.packsMax, a / 10, b / 10, c, d / 5);
            expect(packs.length).toBeGreaterThan(0);
            expect(packsValueCents(packs, sets)).toBeLessThanOrEqual(cap);
            expect(packs.reduce((n, p) => n + p.count, 0)).toBeLessThanOrEqual(BATTLE_RULES.prizes.packsMax);
            for (const p of packs) expect(p.count).toBeGreaterThan(0);
          }
  });

  it("mixes a pricey pack with cheaper ones, or none when nothing fits", () => {
    expect(pickPackPrize(sets, cap, 8, 0, 0, 0.1, 0.99)).toEqual([
      { set: "prismatic_peak", count: 1 },
      { set: "mystic_energy", count: 7 },
    ]);
    expect(pickPackPrize(sets, cap, 8, 0.99, 0.99, 0.9, 0)).toEqual([{ set: "mystic_energy", count: 8 }]);
    expect(pickPackPrize(sets, 10_000, 8, 0.5, 0.5, 0.1, 0.5)).toEqual([]);
  });

  it("weighted picks follow the sorted keys", () => {
    expect(pickWeighted({ b: 1, a: 1 }, 0.1)).toBe("a");
    expect(pickWeighted({ b: 1, a: 1 }, 0.9)).toBe("b");
    expect(pickWeighted({}, 0.5)).toBeNull();
    expect(pickWeighted(BATTLE_RULES.prizes.accessoryTiers, 0.99)).toBe("rare");
  });
});
