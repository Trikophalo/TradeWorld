import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import type { NexamonBonusCardInput } from "./nexamon-bonuses.ts";
import {
  nexamonBonusCatalogue,
  nexamonBonusSummary,
  nexamonBoostedBps,
  nexamonCardBonusDef,
  nexamonCollectionReward,
  nexamonCollections,
  nexamonHypeAfterJump,
  nexamonHypeChanceBps,
  nexamonHypeDecay,
  nexamonHypeJumpBps,
  nexamonHypeStep,
  nexamonSlabBoostBps,
  nexamonStackBps,
} from "./nexamon-bonuses.ts";

const cfg = BALANCE.nexamon;
/** A tiny set: two fire commons, one fire ultra, one water prisma, one dark legendary. */
const CARDS: NexamonBonusCardInput[] = [
  { key: "me-001", set: "mystic_energy", number: 1, rarity: "common", type: "fire" },
  { key: "me-002", set: "mystic_energy", number: 2, rarity: "common", type: "fire" },
  { key: "me-061", set: "mystic_energy", number: 61, rarity: "ultra", type: "fire" },
  { key: "me-071", set: "mystic_energy", number: 71, rarity: "prisma", type: "water" },
  { key: "me-076", set: "mystic_energy", number: 76, rarity: "legendary", type: "dark" },
];
const own = (cardKey: string, grade: number | null = null, listed = false) => ({ cardKey, grade, listed });

describe("card bonus definitions", () => {
  it("gives every ultra, prisma, legendary and the extra rares a bonus by type and rarity", () => {
    expect(nexamonCardBonusDef(CARDS[0]!)).toBeNull();
    expect(nexamonCardBonusDef(CARDS[2]!)).toEqual({ kind: "company", bps: 50 });
    expect(nexamonCardBonusDef(CARDS[3]!)).toEqual({ kind: "vault", bps: 100 });
    expect(nexamonCardBonusDef(CARDS[4]!)).toEqual({ kind: "xp", bps: 250 });
    expect(
      nexamonCardBonusDef({ key: "me-060", set: "mystic_energy", number: 60, rarity: "rare", type: "grass" }),
    ).toEqual({ kind: "daily", bps: 50 });
    expect(
      nexamonCardBonusDef({ key: "pp-076", set: "prismatic_peak", number: 76, rarity: "legendary", type: "dark" }),
    ).toEqual({ kind: "xp", bps: 375 });
    expect(Object.keys(nexamonBonusCatalogue(CARDS))).toEqual(["me-061", "me-071", "me-076"]);
  });

  it("boosts a slab of grade 9 or better and a Black Label more", () => {
    expect(nexamonSlabBoostBps(null)).toBe(10_000);
    expect(nexamonSlabBoostBps(8.5)).toBe(10_000);
    expect(nexamonSlabBoostBps(9)).toBe(cfg.bonuses.slab.gradeBps);
    expect(nexamonSlabBoostBps(11)).toBe(cfg.bonuses.slab.blackLabelBps);
    expect(nexamonBoostedBps(250, 10)).toBe(375);
    expect(nexamonBoostedBps(250, 11)).toBe(500);
  });
});

describe("stacking", () => {
  it("counts fully up to the knee, half above it, never more than the cap", () => {
    const cap = cfg.bonuses.caps.xp;
    const knee = (cap * cfg.bonuses.kneeShareBps) / 10_000;
    expect(nexamonStackBps(0, "xp")).toBe(0);
    expect(nexamonStackBps(knee, "xp")).toBe(knee);
    expect(nexamonStackBps(knee + 200, "xp")).toBe(knee + 100);
    expect(nexamonStackBps(100_000, "xp")).toBe(cap);
    expect(nexamonStackBps(-5, "xp")).toBe(0);
  });
});

describe("collections and summary", () => {
  it("ignores listed copies and takes the best unlisted grade", () => {
    const s = nexamonBonusSummary(CARDS, [own("me-061", null, true), own("me-076", 9), own("me-076", 11, true)]);
    expect(s.sources.filter((x) => x.cardKey)).toEqual([{ cardKey: "me-076", collection: null, kind: "xp", bps: 375 }]);
    expect(s.totals.find((t) => t.kind === "xp")).toMatchObject({ rawBps: 425, effectiveBps: 425 });
  });

  it("knows type collections, the complete set and the master set", () => {
    const all = CARDS.map((c) => own(c.key));
    const cols = nexamonCollections(CARDS, all);
    const fire = cols.find((c) => c.kind === "type" && c.type === "fire")!;
    expect(fire).toMatchObject({ complete: true, have: 3, need: 3, bonusKind: "company" });
    expect(cols.find((c) => c.kind === "complete")!.complete).toBe(true);
    const master = cols.find((c) => c.kind === "master")!;
    expect(master.complete).toBe(false);
    expect(master.missing).toEqual(["me-071", "me-076"]);
    const graded = [...all, own("me-071", 9.5), own("me-076", 9)];
    expect(nexamonCollections(CARDS, graded).find((c) => c.kind === "master")!.complete).toBe(true);
    const partial = nexamonCollections(CARDS, [own("me-001")]);
    expect(partial.find((c) => c.kind === "type" && c.type === "fire")).toMatchObject({
      complete: false,
      have: 1,
      missing: ["me-002", "me-061"],
    });
  });

  it("adds collection bonuses: type to its kind, complete to xp, master to every kind", () => {
    const graded = [...CARDS.map((c) => own(c.key)), own("me-071", 9.5), own("me-076", 9)];
    const s = nexamonBonusSummary(CARDS, graded);
    const master = s.sources.filter((x) => x.collection?.kind === "master");
    expect(master).toHaveLength(cfg.bonuses.kinds.length);
    const company = s.totals.find((t) => t.kind === "company")!;
    // ultra 50 + fire type 50 + master 100
    expect(company.rawBps).toBe(200);
    const xp = s.totals.find((t) => t.kind === "xp")!;
    // legendary slab 375 + dark type 50 + complete 200 + master 100
    expect(xp.rawBps).toBe(725);
    expect(xp.effectiveBps).toBe(nexamonStackBps(725, "xp"));
  });

  it("pays pack prices and XP once per completion", () => {
    expect(nexamonCollectionReward("complete", "super_apex")).toEqual({
      cents: cfg.bonuses.sets.complete.rewardPacks * cfg.sets.super_apex.packPriceCents,
      xp: cfg.bonuses.sets.complete.rewardXp,
    });
  });
});

describe("Black Label hype", () => {
  it("is likelier for rare, popular cards with few Black Labels", () => {
    expect(nexamonHypeChanceBps("legendary", 10_000, 0)).toBe(0);
    expect(nexamonHypeChanceBps("legendary", 10_000, 1)).toBe(240);
    expect(nexamonHypeChanceBps("legendary", 0, 1)).toBe(120);
    expect(nexamonHypeChanceBps("common", 0, 1)).toBe(5);
    expect(nexamonHypeChanceBps("legendary", 0, 4)).toBe(60);
  });

  it("jumps by 10..60 % up to the cap and decays back to the base", () => {
    const base = cfg.grading.blackLabel.valueBps;
    expect(nexamonHypeJumpBps(0)).toBe(cfg.blackLabelHype.minJumpBps);
    expect(nexamonHypeJumpBps(0.9999999999)).toBe(cfg.blackLabelHype.maxJumpBps);
    expect(nexamonHypeAfterJump(base, 2_000)).toBe(120_000);
    expect(nexamonHypeAfterJump(240_000, 6_000)).toBe(cfg.blackLabelHype.capBps);
    expect(nexamonHypeDecay(base)).toBe(base);
    expect(nexamonHypeDecay(120_000)).toBe(119_800);
    expect(nexamonHypeDecay(base + 1)).toBe(base);
    let f = 150_000;
    for (let h = 0; h < 69; h += 1) f = nexamonHypeDecay(f);
    expect(f).toBeGreaterThan(base + 24_000);
    expect(f).toBeLessThan(base + 26_000);
  });

  it("steps: decay, then the roll", () => {
    expect(nexamonHypeStep(120_000, 100, 0.5, 0)).toEqual({ factorBps: 119_800, jumpBps: 0 });
    expect(nexamonHypeStep(120_000, 100, 0.001, 0)).toEqual({ factorBps: 131_780, jumpBps: 1_000 });
  });
});
