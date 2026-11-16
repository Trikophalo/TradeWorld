import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { NEXAMON_CARDS } from "@/config/nexamon";
import type { NexamonCardStats, NexamonCopy, NexamonListing } from "@/features/game/nexamon-types";
import {
  binderEntries,
  buyableListings,
  centsToInput,
  chanceBps,
  collectionTotals,
  copyStatus,
  dealBps,
  dealTone,
  DEFAULT_BINDER_FILTER,
  formatChance,
  formatDecimal,
  formatFactor,
  gradingQuote,
  gradingQueue,
  groupBySet,
  historyCandles,
  isListablePrice,
  listingProceeds,
  nexamonNotificationLink,
  ownListings,
  packOdds,
  quickSellOffer,
  revealKey,
  setContents,
  sortCopiesBestFirst,
  splitGraded,
  suggestedPriceCents,
  tileMoney,
} from "./view";

const stats = (cardKey: string, valueCents = 1_000): NexamonCardStats => {
  const card = NEXAMON_CARDS.find((c) => c.key === cardKey)!;
  return {
    cardKey,
    set: card.set,
    number: card.number,
    rarity: card.rarity,
    valueCents,
    startCents: valueCents,
    changeBps: 0,
    population: 10,
    listed: 1,
    owned: 0,
    popularityBps: 1_000,
    floorCents: 200,
    capCents: 3_000,
  };
};

let nextId = 0;
const copy = (cardKey: string, patch: Partial<NexamonCopy> = {}): NexamonCopy => ({
  id: `c${nextId++}`,
  cardKey,
  serial: nextId,
  condition: "near_mint",
  grade: null,
  state: "raw",
  gradingUntil: null,
  gradedAt: null,
  valueCents: 1_000,
  listing: null,
  acquiredAt: "2026-01-01T10:00:00Z",
  ...patch,
});

const ALL = NEXAMON_CARDS.map((c) => stats(c.key, c.startPriceCents));

describe("pack odds", () => {
  it("lists every rarity, best first, with the two rolling slots", () => {
    const rows = packOdds();
    expect(rows.map((r) => r.rarity)).toEqual(["legendary", "prisma", "ultra", "rare", "common"]);
    const den = BALANCE.nexamon.odds.denominator;
    for (const slot of ["slot4", "slot5"] as const) expect(rows.reduce((sum, r) => sum + r[slot], 0)).toBe(den);
    expect(rows.find((r) => r.rarity === "legendary")).toMatchObject({ slot4: 0, slot5: 4, oneInPacks: 900 });
    expect(rows.find((r) => r.rarity === "prisma")!.oneInPacks).toBe(80);
    expect(rows.find((r) => r.rarity === "ultra")!.oneInPacks).toBe(12);
    expect(rows.find((r) => r.rarity === "rare")!.oneInPacks).toBe(2);
    expect(rows.find((r) => r.rarity === "common")!.oneInPacks).toBeNull();
    // Five cards per pack on average, whatever the rolls.
    expect(rows.reduce((sum, r) => sum + r.perPack, 0)).toBeCloseTo(BALANCE.nexamon.packSize);
  });

  it("formats chances honestly, small ones with decimals", () => {
    expect(formatChance(chanceBps(900, 3_600))).toBe("25 %");
    expect(formatChance(chanceBps(150, 3_600))).toBe("4,17 %");
    expect(formatChance(chanceBps(4, 3_600))).toBe("0,11 %");
    expect(formatChance(5_000)).toBe("50 %");
    expect(chanceBps(1, 0)).toBe(0);
    expect(formatDecimal(4.394)).toBe("4,39");
    expect(formatFactor(30_000)).toBe("×3");
    expect(formatFactor(12_000)).toBe("×1,2");
  });

  it("lists what a pack of a set can hold, by rarity, with the own cards", () => {
    const groups = setContents("super_apex", [{ cardKey: "sa-077" }, { cardKey: "sa-077" }, { cardKey: "me-001" }]);
    expect(groups.map((g) => [g.rarity, g.cards.length])).toEqual([
      ["legendary", 2],
      ["prisma", 5],
      ["ultra", 10],
      ["rare", 10],
      ["common", 50],
    ]);
    expect(groups.every((g) => g.cards.every((c) => c.card.set === "super_apex"))).toBe(true);
    expect(groups[0]!.owned).toBe(1);
    expect(groups[0]!.cards.find((c) => c.card.key === "sa-077")!.owned).toBe(2);
    expect(groups[0]!.odds.oneInPacks).toBe(900);
    expect(groups[4]!.owned).toBe(0);
    expect(groups[4]!.cards[0]!.card.number).toBe(1);
  });
});

describe("binder", () => {
  const copies = [
    copy("me-003", { acquiredAt: "2026-01-02T10:00:00Z" }),
    copy("me-003", { condition: "mint" }),
    copy("me-003", { state: "graded", grade: 9, gradedAt: "2026-01-03T10:00:00Z", valueCents: 1_600 }),
    copy("sa-010", { acquiredAt: "2026-01-05T10:00:00Z", valueCents: 300 }),
  ];

  it("shows every card in set and number order with the own copies", () => {
    const entries = binderEntries(ALL, copies, DEFAULT_BINDER_FILTER);
    expect(entries).toHaveLength(231);
    expect(entries[0]!.stats.cardKey).toBe("me-001");
    expect(entries[77]!.stats.cardKey).toBe("sa-001");
    const tumpli = entries.find((e) => e.stats.cardKey === "me-003")!;
    expect(tumpli.copies).toHaveLength(3);
    expect(tumpli.bestGrade).toBe(9);
    expect(tumpli.copies[0]!.grade).toBe(9);
    expect(tumpli.copies[1]!.condition).toBe("mint");
    expect(tumpli.ownedValueCents).toBe(3_600);
    expect(entries.find((e) => e.stats.cardKey === "me-001")).toMatchObject({
      copies: [],
      bestGrade: null,
      newestAt: 0,
    });
  });

  it("filters by set, rarity and ownership", () => {
    const filter = (patch: object) => binderEntries(ALL, copies, { ...DEFAULT_BINDER_FILTER, ...patch });
    expect(filter({ set: "super_apex" })).toHaveLength(77);
    expect(filter({ rarity: "legendary" })).toHaveLength(6);
    expect(filter({ ownership: "owned" }).map((e) => e.stats.cardKey)).toEqual(["me-003", "sa-010"]);
    expect(filter({ ownership: "missing" })).toHaveLength(229);
    expect(filter({ ownership: "duplicates" }).map((e) => e.stats.cardKey)).toEqual(["me-003"]);
    expect(filter({ ownership: "owned", set: "prismatic_peak" })).toEqual([]);
  });

  it("sorts by value and by the newest copy", () => {
    const byValue = binderEntries(ALL, copies, { ...DEFAULT_BINDER_FILTER, sort: "value" });
    for (let i = 1; i < byValue.length; i++)
      expect(byValue[i - 1]!.stats.valueCents).toBeGreaterThanOrEqual(byValue[i]!.stats.valueCents);
    const newest = binderEntries(ALL, copies, { ...DEFAULT_BINDER_FILTER, ownership: "owned", sort: "newest" });
    expect(newest.map((e) => e.stats.cardKey)).toEqual(["sa-010", "me-003"]);
  });

  it("groups by set only in number order", () => {
    const entries = binderEntries(ALL, copies, DEFAULT_BINDER_FILTER);
    expect(groupBySet(entries, "number").map((g) => [g.set, g.entries.length])).toEqual([
      ["mystic_energy", 77],
      ["super_apex", 77],
      ["prismatic_peak", 77],
    ]);
    expect(groupBySet(entries, "value")).toHaveLength(1);
    expect(groupBySet([], "value")).toEqual([]);
    const owned = binderEntries(ALL, copies, { ...DEFAULT_BINDER_FILTER, ownership: "owned" });
    expect(groupBySet(owned, "number").map((g) => g.set)).toEqual(["mystic_energy", "super_apex"]);
  });

  it("adds up the collection", () => {
    expect(collectionTotals(copies)).toEqual({ copies: 4, distinct: 2, duplicates: 2, valueCents: 3_900 });
    expect(collectionTotals([])).toEqual({ copies: 0, distinct: 0, duplicates: 0, valueCents: 0 });
  });

  it("puts slabs first, then the best condition, then the lowest serial", () => {
    const a = copy("me-001", { condition: "good", serial: 5 });
    const b = copy("me-001", { condition: "mint", serial: 9 });
    const c = copy("me-001", { condition: "mint", serial: 2 });
    const d = copy("me-001", { state: "graded", grade: 4, condition: "poor" });
    expect(sortCopiesBestFirst([a, b, c, d])).toEqual([d, c, b, a]);
  });

  it("writes money under a tile so it fits", () => {
    expect(tileMoney(390)).toMatch(/^3,90/);
    expect(tileMoney(120_000)).toMatch(/^1\.200/);
    expect(tileMoney(1_450_000)).toMatch(/^14k/);
  });
});

describe("copies", () => {
  it("says what a copy is doing", () => {
    expect(copyStatus(copy("me-001"))).toBe("raw");
    expect(copyStatus(copy("me-001", { state: "grading", gradingUntil: "2026-01-01T11:00:00Z" }))).toBe("grading");
    expect(copyStatus(copy("me-001", { state: "graded", grade: 8 }))).toBe("graded");
    const listing = { id: "l1", priceCents: 500, listedAt: "2026-01-01T10:00:00Z" };
    expect(copyStatus(copy("me-001", { listing }))).toBe("listed");
    expect(copyStatus(copy("me-001", { state: "graded", grade: 8, listing }))).toBe("listed");
  });

  it("computes fee and proceeds of a listing", () => {
    expect(listingProceeds(10_000)).toEqual({ feeCents: 500, netCents: 9_500, feeBps: 500 });
    expect(listingProceeds(19)).toEqual({ feeCents: 0, netCents: 19, feeBps: 500 });
  });

  it("accepts prices inside the market's bounds only", () => {
    const { minPriceCents, maxPriceCents } = BALANCE.nexamon.market;
    expect(isListablePrice(minPriceCents)).toBe(true);
    expect(isListablePrice(minPriceCents - 1)).toBe(false);
    expect(isListablePrice(maxPriceCents + 1)).toBe(false);
    expect(isListablePrice(null)).toBe(false);
    expect(isListablePrice(10.5)).toBe(false);
    expect(suggestedPriceCents(0)).toBe(minPriceCents);
    expect(suggestedPriceCents(1_234)).toBe(1_234);
    expect(centsToInput(12_345)).toBe("123,45");
    expect(centsToInput(20_000)).toBe("200");
  });

  it("offers the quick sale for loose commons and rares only", () => {
    expect(quickSellOffer(copy("me-001"), "common")).toBe(500);
    expect(quickSellOffer(copy("me-001"), "rare")).toBe(500);
    expect(quickSellOffer(copy("me-001"), "ultra")).toBeNull();
    expect(quickSellOffer(copy("me-001", { state: "graded", grade: 10 }), "common")).toBeNull();
    expect(quickSellOffer(copy("me-001", { state: "grading" }), "common")).toBeNull();
    const listing = { id: "l1", priceCents: 500, listedAt: "2026-01-01T10:00:00Z" };
    expect(quickSellOffer(copy("me-001", { listing }), "common")).toBeNull();
  });

  it("quotes a grading with fee, duration and the chance table of the condition", () => {
    const mint = gradingQuote({ condition: "mint", valueCents: 10_000 });
    expect(mint.feeCents).toBe(3_000);
    expect(mint.minutes).toBe(BALANCE.nexamon.grading.minutes);
    // Mint is the one condition with a Black Label (grade 11): 1 %, worth ten times the card.
    expect(mint.chances.map((c) => c.grade)).toEqual([11, 10, 9, 8]);
    expect(mint.chances[0]).toEqual({ grade: 11, chanceBps: 100, factorBps: 100_000 });
    expect(mint.chances[1]).toEqual({ grade: 10, chanceBps: 8_900, factorBps: 30_000 });
    expect(mint.blackLabel).toEqual({ grade: 11, chanceBps: 100, factorBps: 100_000, condition: "mint" });
    expect(mint.betterBps).toBe(10_000);
    expect(mint.expectedFactorBps).toBe(
      Math.round((100 * 100_000 + 8_900 * 30_000 + 800 * 16_000 + 200 * 12_000) / 10_000),
    );
    const nearMint = gradingQuote({ condition: "near_mint", valueCents: 10_000 });
    expect(nearMint.chances.map((c) => c.grade)).toEqual([10, 9, 8, 7, 6]);
    expect(nearMint.blackLabel.chanceBps).toBe(0);
    const poor = gradingQuote({ condition: "poor", valueCents: 100 });
    expect(poor.feeCents).toBe(BALANCE.nexamon.grading.minFeeCents);
    expect(poor.chances).toHaveLength(10);
    expect(poor.chances.reduce((sum, c) => sum + c.chanceBps, 0)).toBe(10_000);
    // A raw poor copy is worth 70 %, so grades 6 to 10 already beat it.
    expect(poor.betterBps).toBe(1_500 + 1_000 + 400 + 90 + 10);
    const good = gradingQuote({ condition: "good", valueCents: 10_000 });
    expect(good.betterBps).toBe(2_500 + 2_000 + 1_000);
  });
});

describe("market", () => {
  it("compares a price with the value", () => {
    expect(dealBps(900, 1_000)).toBe(-1_000);
    expect(dealBps(1_100, 1_000)).toBe(1_000);
    expect(dealBps(500, 0)).toBe(0);
    expect(dealTone(-1)).toBe("good");
    expect(dealTone(0)).toBe("fair");
    expect(dealTone(1_000)).toBe("fair");
    expect(dealTone(1_001)).toBe("high");
  });

  it("finds the own listings, newest first, and hides them from the offers to buy", () => {
    const old = copy("me-001", { listing: { id: "l1", priceCents: 500, listedAt: "2026-01-01T10:00:00Z" } });
    const fresh = copy("me-002", { listing: { id: "l2", priceCents: 700, listedAt: "2026-01-02T10:00:00Z" } });
    expect(ownListings([old, copy("me-003"), fresh])).toEqual([fresh, old]);
    const listing = (mine: boolean) => ({ mine }) as NexamonListing;
    expect(buyableListings([listing(true), listing(false)])).toHaveLength(1);
  });

  it("turns a value history into rising candles", () => {
    const candles = historyCandles([
      { at: "2026-01-01T10:00:00Z", valueCents: 100 },
      { at: "2026-01-01T10:00:00Z", valueCents: 110 },
      { at: "2026-01-01T11:00:00Z", valueCents: 120 },
    ]);
    expect(candles.map((c) => c.close)).toEqual([10_000, 11_000, 12_000]);
    expect(candles[1]!.time).toBe(candles[0]!.time + 1);
    expect(candles[2]!.time).toBeGreaterThan(candles[1]!.time);
    expect(candles[0]).toMatchObject({ open: 10_000, high: 10_000, low: 10_000, volume: 0 });
  });
});

describe("grading desk", () => {
  const running = copy("me-001", { state: "grading", gradingUntil: "2026-01-01T12:00:00Z" });
  const sooner = copy("me-002", { state: "grading", gradingUntil: "2026-01-01T11:00:00Z" });
  const slabA = copy("me-003", { state: "graded", grade: 10, gradedAt: "2026-01-02T10:00:00Z" });
  const slabB = copy("me-004", { state: "graded", grade: 7, gradedAt: "2026-01-03T10:00:00Z" });

  it("queues the copies at ASP by their return", () => {
    expect(gradingQueue([running, slabA, sooner, copy("me-009")])).toEqual([sooner, running]);
  });

  it("splits slabs into new and seen ones", () => {
    const all = [running, slabA, slabB];
    expect(splitGraded(all, [])).toEqual({ fresh: [slabB, slabA], seen: [] });
    expect(splitGraded(all, [revealKey(slabA)])).toEqual({ fresh: [slabB], seen: [slabA] });
    // Cracked and graded again: a new reveal.
    const again = { ...slabA, gradedAt: "2026-01-05T10:00:00Z" };
    expect(splitGraded([again], [revealKey(slabA)]).fresh).toEqual([again]);
  });

  it("sends notifications to the tab they belong to", () => {
    expect(nexamonNotificationLink("nexamon_graded", "/nexamon")).toBe("/nexamon?tab=grading");
    expect(nexamonNotificationLink("nexamon_sale", "/nexamon")).toBe("/nexamon?tab=market&view=mine");
    expect(nexamonNotificationLink("friend_request", "/friends")).toBe("/friends");
    expect(nexamonNotificationLink("other", null)).toBeNull();
  });
});
