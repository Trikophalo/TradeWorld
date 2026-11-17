import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  battleKnownSlots,
  battleShownSlots,
  battleTimeline,
  decideBattle,
  decideMultiBattle,
  multiBattleTimeline,
  multiKnownCards,
  multiRevealAt,
  multiShownCards,
  packBattleCostCents,
  packBattleLineupOk,
  type BattlePull,
} from "./nexamon-battle.ts";

const pull = (rarity: BattlePull["rarity"], valueCents: number): BattlePull => ({ rarity, valueCents });
const cfg = BALANCE.nexamon;
const size = cfg.packSize;

describe("decideMultiBattle", () => {
  it("the highest total over all packs wins", () => {
    const d = decideMultiBattle([[pull("common", 100)], [pull("common", 300)], [pull("rare", 200)], []], 0);
    expect(d).toEqual({ winner: 1, tieBreak: "value", totals: [100, 300, 200, 0] });
  });

  it("a tie among the leaders goes to the rarest card, then the coin among those still tied", () => {
    const seats = [[pull("rare", 500)], [pull("ultra", 500)], [pull("legendary", 100)]];
    expect(decideMultiBattle(seats, 0)).toMatchObject({ winner: 1, tieBreak: "rarest" });
    const coin = [[pull("rare", 500)], [pull("common", 100)], [pull("rare", 500)], [pull("rare", 500)]];
    expect(decideMultiBattle(coin, 0)).toMatchObject({ winner: 0, tieBreak: "coin" });
    expect(decideMultiBattle(coin, 1).winner).toBe(2);
    expect(decideMultiBattle(coin, 5).winner).toBe(3);
  });

  it("two seats decide like the classic duel", () => {
    for (const seed of [0, 1, 2, 7]) {
      for (const [a, c] of [
        [[pull("common", 100)], [pull("rare", 100)]],
        [[pull("rare", 100)], [pull("rare", 100)]],
        [[pull("rare", 300)], [pull("ultra", 100)]],
      ] as BattlePull[][][]) {
        const duel = decideBattle(a!, c!, seed);
        const multi = decideMultiBattle([a!, c!], seed);
        expect(multi.winner).toBe(duel.winner === "challenger" ? 0 : 1);
        expect(multi.tieBreak).toBe(duel.tieBreak);
      }
    }
  });
});

describe("lineup and cost", () => {
  it("the cost is the sum of the pack prices", () => {
    const sets = ["mystic_energy", "super_apex", "mystic_energy"];
    expect(packBattleCostCents(sets)).toBe(
      cfg.sets.mystic_energy.packPriceCents * 2 + cfg.sets.super_apex.packPriceCents,
    );
  });

  it("limits packs and players", () => {
    expect(packBattleLineupOk(["mystic_energy"], 2)).toBe(true);
    expect(packBattleLineupOk(Array(cfg.packBattle.maxPacks).fill("mystic_energy"), cfg.packBattle.maxPlayers)).toBe(
      true,
    );
    expect(packBattleLineupOk([], 2)).toBe(false);
    expect(packBattleLineupOk(Array(cfg.packBattle.maxPacks + 1).fill("mystic_energy"), 2)).toBe(false);
    expect(packBattleLineupOk(["mystic_energy"], 1)).toBe(false);
    expect(packBattleLineupOk(["mystic_energy"], cfg.packBattle.maxPlayers + 1)).toBe(false);
    expect(packBattleLineupOk(["nope"], 2)).toBe(false);
  });
});

describe("multi-pack timeline", () => {
  it("one pack is the classic battle clock", () => {
    const classic = battleTimeline(1_000);
    const multi = multiBattleTimeline(1_000, 1);
    expect(multi).toEqual({ startsAt: classic.startsAt, decideAt: classic.decideAt, endsAt: classic.endsAt });
    for (let t = classic.startsAt - 500; t < classic.endsAt; t += 300) {
      expect(multiKnownCards(classic.startsAt, t, 1)).toBe(battleKnownSlots(classic.startsAt, t));
      expect(multiShownCards(classic.startsAt, t, 1)).toBe(battleShownSlots(classic.startsAt, t));
    }
  });

  it("each pack tears after the last card of the one before", () => {
    const s = 10_000;
    const b = cfg.battles;
    expect(multiRevealAt(s, 0)).toBe(s + b.tearMs);
    expect(multiRevealAt(s, size)).toBe(s + 2 * b.tearMs + size * b.slotMs);
    expect(multiShownCards(s, multiRevealAt(s, size) - 1, 3)).toBe(size);
    expect(multiShownCards(s, multiRevealAt(s, size), 3)).toBe(size + 1);
    const t = multiBattleTimeline(s - b.startDelayMs, 3);
    expect(multiShownCards(s, t.decideAt, 3)).toBe(3 * size);
    expect(multiKnownCards(s, t.decideAt, 3)).toBe(3 * size);
    expect(multiKnownCards(s, s - 1, 3)).toBe(0);
  });
});
