import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { NEXAMON_CARDS, nexamonCard } from "@/config/nexamon";
import { nexamonAiAskCents, nexamonGradingFeeCents } from "@/lib/sim/nexamon";
import { createRng } from "@/lib/sim/rng";
import { GameError } from "../types";
import { createNexamonEngine, type DemoNexamonState } from "./nexamon";

const cfg = BALANCE.nexamon;
const HOUR = 3_600_000;

function setup(level = 10, cash = 100_000_000, seed = 1) {
  const rng = createRng(seed);
  const world = {
    cash,
    level,
    now: Date.UTC(2026, 10, 16, 12, 0, 0),
    nexamon: undefined as DemoNexamonState | undefined,
    feed: [] as string[],
    notes: [] as string[],
    tracked: {} as Record<string, number>,
    /** Forced rolls, used before the seeded generator. */
    rolls: [] as number[],
  };
  const requests = new Map<string, unknown>();
  const engine = createNexamonEngine({
    state: () => world.nexamon,
    setState: (value) => {
      world.nexamon = value;
    },
    level: () => world.level,
    nickname: () => "Demo",
    cashCents: () => world.cash,
    pay: (cents) => {
      world.cash -= cents;
    },
    earn: (cents) => {
      world.cash += cents;
    },
    feed: (kind, payload) => world.feed.push(`${kind}:${String(payload.card_key)}`),
    notify: (typeKey) => world.notes.push(typeKey),
    track: (metric, by = 1) => {
      world.tracked[metric] = (world.tracked[metric] ?? 0) + by;
    },
    idempotent: <T>(id: string, run: () => T): T => {
      if (requests.has(id)) return requests.get(id) as T;
      const result = run();
      requests.set(id, result);
      return result;
    },
    now: () => world.now,
    random: () => world.rolls.shift() ?? rng.next(),
  });
  return { world, engine };
}

const key = (run: Promise<unknown>) =>
  run.then(
    () => "ok",
    (error: unknown) => (error instanceof GameError ? error.key : "other"),
  );

/** Rolls for one pack: per slot a card and a condition, slots 4 and 5 a rarity first. */
const packRolls = (slot4: number, slot5: number, condition = 0.99) => [
  ...[0.1, condition, 0.3, condition, 0.5, condition],
  ...[slot4, 0.5, condition],
  ...[slot5, 0.5, condition],
];

describe("Nexamon in the demo (ADR-165)", () => {
  it("is locked below level 10, but the overview shows the sets", async () => {
    const { engine } = setup(9);
    const overview = await engine.nexamon();
    expect(overview.unlocked).toBe(false);
    expect(overview.unlockLevel).toBe(10);
    expect(overview.sets.map((s) => [s.key, s.packPriceCents, s.cards])).toEqual([
      ["mystic_energy", 20_000, 77],
      ["super_apex", 100_000, 77],
      ["prismatic_peak", 500_000, 77],
    ]);
    expect(await key(engine.buyNexamonPack("r1", "mystic_energy"))).toBe("nexamon_locked");
    expect(await key(engine.nexamonCollection())).toBe("nexamon_locked");
    expect(await key(engine.nexamonMarket())).toBe("nexamon_locked");
  });

  it("starts with the AI's stock: every card listed 10 % above its start price, no legendary, few prismas", async () => {
    const { engine } = setup();
    const { cards } = await engine.nexamonCollection();
    expect(cards).toHaveLength(231);
    for (const card of cards) {
      expect(card.valueCents).toBe(nexamonCard(card.cardKey)!.startPriceCents);
      expect(card.listed).toBe(Math.min(card.population, cfg.ai.listedPerCard[card.rarity]));
      if (card.rarity === "legendary") expect(card.population).toBe(0);
    }
    expect(cards.filter((c) => c.rarity === "prisma" && c.population > 0)).toHaveLength(6);
    const market = await engine.nexamonMarket({ sort: "price_asc" });
    expect(market.total).toBe(3 * (50 * 4 + 10 * 3 + 10 * 2 + 2));
    expect(market.listings).toHaveLength(cfg.market.pageSize);
    for (const listing of market.listings) {
      expect(listing.sellerAi).toBe(true);
      expect(listing.priceCents).toBe(nexamonAiAskCents(listing.valueCents));
    }
    expect((await engine.nexamonMarket({ rarity: "legendary" })).total).toBe(0);
    expect((await engine.nexamonMarket({ seller: "mine" })).total).toBe(0);
    expect((await engine.nexamonMarket({ set: "super_apex", rarity: "ultra" })).total).toBe(20);
  });

  it("buys a pack: pays the price, five pulls in slot order, populations up, the same request replays", async () => {
    const { engine, world } = setup();
    const pack = await engine.buyNexamonPack("r1", "mystic_energy");
    expect(await engine.buyNexamonPack("r1", "mystic_energy")).toEqual(pack);
    expect(world.cash).toBe(100_000_000 - 20_000);
    expect(pack.cards.map((c) => c.slot)).toEqual([1, 2, 3, 4, 5]);
    for (const pull of pack.cards.slice(0, 3)) expect(pull.rarity).toBe("common");
    for (const pull of pack.cards) {
      expect(pull.cardKey.startsWith("me-")).toBe(true);
      expect(nexamonCard(pull.cardKey)!.rarity).toBe(pull.rarity);
      expect(pull.population).toBe(pull.serial);
    }
    expect(pack.cards[0]!.isNew).toBe(true);
    expect(pack.packsOpened).toBe(1);
    const overview = await engine.nexamon();
    expect(overview.collection.copies).toBe(5);
    expect(overview.sets[0]!.packsOpened).toBe(1);
    expect(world.tracked.nexamon_packs).toBe(1);
    expect(await key(engine.buyNexamonPack("r2", "nope" as "mystic_energy"))).toBe("nexamon_unknown");
  });

  it("pulls what the slots roll: an ultra in slot 4, a legendary in slot 5 is news", async () => {
    const { engine, world } = setup();
    world.rolls.push(...packRolls(0, 0));
    const pack = await engine.buyNexamonPack("r1", "super_apex");
    expect(pack.cards.map((c) => c.rarity)).toEqual(["common", "common", "common", "ultra", "legendary"]);
    expect(pack.cards[4]!.population).toBe(1);
    expect(pack.cards[4]!.condition).toBe("mint");
    expect(world.feed).toEqual([`nexamon_pull:${pack.cards[4]!.cardKey}`]);
    expect(world.tracked).toMatchObject({ nexamon_rares: 2, nexamon_ultras: 2, nexamon_packs: 1 });
  });

  it("refuses a pack without the money and more than the packs per minute", async () => {
    const { engine, world } = setup(10, 19_999);
    expect(await key(engine.buyNexamonPack("r1", "mystic_energy"))).toBe("insufficient_funds");
    world.cash = 100_000_000;
    for (let i = 0; i < cfg.packs.perMinute; i++) await engine.buyNexamonPack(`p${i}`, "mystic_energy");
    expect(await key(engine.buyNexamonPack("over", "mystic_energy"))).toBe("rate_limited");
    world.now += 61_000;
    expect(await key(engine.buyNexamonPack("later", "mystic_energy"))).toBe("ok");
  });

  it("buys from the AI at value + 10 %: the value rises a little, the AI offers the next copy", async () => {
    const { engine, world } = setup();
    const before = (await engine.nexamonCard("me-051")).card;
    const listing = (await engine.nexamonMarket({ cardKey: "me-051", sort: "price_asc" })).listings[0]!;
    expect(await key(engine.buyNexamonListing("b0", listing.id, listing.priceCents - 1))).toBe("nexamon_price_changed");
    const bought = await engine.buyNexamonListing("b1", listing.id, listing.priceCents);
    expect(world.cash).toBe(100_000_000 - listing.priceCents);
    expect(bought.counted).toBe(true);
    expect(bought.copy.cardKey).toBe("me-051");
    expect(bought.card.valueCents).toBeGreaterThan(before.valueCents);
    expect(bought.card.valueCents).toBeLessThanOrEqual(Math.round(before.valueCents * 1.02));
    expect(bought.card.owned).toBe(1);
    expect(bought.card.population).toBe(before.population);
    const after = await engine.nexamonCard("me-051");
    expect(after.listings).toHaveLength(3);
    for (const l of after.listings) expect(l.priceCents).toBe(nexamonAiAskCents(l.valueCents));
    expect(after.sales[0]).toMatchObject({ kind: "market", buyer: "Demo", priceCents: listing.priceCents });
    expect(after.history.at(-1)!.valueCents).toBe(after.card.valueCents);
    expect(await key(engine.buyNexamonListing("b2", listing.id, listing.priceCents))).toBe("nexamon_not_listed");
  });

  it("counts only three purchases of a card per day for the value", async () => {
    const { engine } = setup();
    const counted: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const listing = (await engine.nexamonMarket({ cardKey: "me-010", sort: "price_asc" })).listings[0]!;
      counted.push((await engine.buyNexamonListing(`b${i}`, listing.id, listing.priceCents)).counted);
    }
    expect(counted).toEqual([true, true, true, false]);
  });

  it("lists and takes back own copies; the limits hold", async () => {
    const { engine, world } = setup();
    const pack = await engine.buyNexamonPack("r1", "mystic_energy");
    const copyId = pack.cards[0]!.copyId;
    expect(await key(engine.listNexamonCard("l0", copyId, 5))).toBe("invalid_argument");
    const listed = await engine.listNexamonCard("l1", copyId, 12_345);
    expect(listed.listing).toMatchObject({ mine: true, sellerAi: false, seller: "Demo", priceCents: 12_345 });
    expect(listed.copy.listing?.priceCents).toBe(12_345);
    expect(await key(engine.listNexamonCard("l2", copyId, 500))).toBe("nexamon_listed");
    expect(await key(engine.gradeNexamonCard("g0", copyId))).toBe("nexamon_listed");
    expect(await key(engine.buyNexamonListing("b0", listed.listing.id, 12_345))).toBe("nexamon_own_listing");
    expect((await engine.nexamonMarket({ seller: "mine" })).total).toBe(1);
    expect((await engine.nexamonMarket({ seller: "players" })).total).toBe(1);
    const back = await engine.unlistNexamonCard("u1", listed.listing.id);
    expect(back.copy.listing).toBeNull();
    expect(await key(engine.unlistNexamonCard("u2", listed.listing.id))).toBe("nexamon_not_listed");
    expect(await key(engine.listNexamonCard("l3", "nx-999", 500))).toBe("nexamon_unknown");
    expect(world.cash).toBe(100_000_000 - 20_000);
  });

  it("lets AI collectors buy a fairly priced listing, never an absurd one", async () => {
    const { engine, world } = setup();
    world.rolls.push(...packRolls(0.5, 0.2));
    const pack = await engine.buyNexamonPack("r1", "mystic_energy");
    const rare = pack.cards[4]!;
    expect(rare.rarity).toBe("rare");
    const common = pack.cards[0]!;
    await engine.listNexamonCard("l1", rare.copyId, rare.valueCents);
    await engine.listNexamonCard("l2", common.copyId, common.valueCents * 100);
    const cash = world.cash;
    const before = (await engine.nexamonCard(rare.cardKey)).card.valueCents;
    world.now += 10 * HOUR;
    const overview = await engine.nexamon();
    expect(overview.collection.listed).toBe(1);
    expect(world.cash).toBe(cash + rare.valueCents - Math.floor(rare.valueCents * 0.05));
    expect(world.notes).toContain("nexamon_sale");
    expect(world.tracked.nexamon_sold).toBe(1);
    const card = await engine.nexamonCard(rare.cardKey);
    expect(card.sales.some((s) => s.kind === "ai_buy" && s.seller === "Demo")).toBe(true);
    expect(card.card.valueCents).toBeGreaterThanOrEqual(before);
    expect(card.copies).toHaveLength(0);
    // the absurd listing is still there after days
    world.now += 72 * HOUR;
    expect((await engine.nexamonMarket({ seller: "mine" })).listings.map((l) => l.copyId)).toEqual([common.copyId]);
  });

  it("grades at ASP: half the value, one hour, a mint card most likely a 10; cracking returns the raw card", async () => {
    const { engine, world } = setup();
    world.rolls.push(...packRolls(0, 0.9, 0.99));
    const pack = await engine.buyNexamonPack("r1", "mystic_energy");
    const ultra = pack.cards[3]!;
    expect(ultra.condition).toBe("mint");
    const cash = world.cash;
    const grading = await engine.gradeNexamonCard("g1", ultra.copyId);
    expect(grading.feeCents).toBe(nexamonGradingFeeCents(ultra.valueCents));
    expect(world.cash).toBe(cash - grading.feeCents);
    expect(grading.copy.state).toBe("grading");
    expect(new Date(grading.readyAt).getTime()).toBe(world.now + HOUR);
    expect(await key(engine.gradeNexamonCard("g2", ultra.copyId))).toBe("nexamon_grading");
    expect(await key(engine.listNexamonCard("l1", ultra.copyId, 5_000))).toBe("nexamon_grading");
    expect(await key(engine.crackNexamonSlab("c0", ultra.copyId))).toBe("nexamon_grading");
    world.now += HOUR - 1_000;
    expect((await engine.nexamon()).collection.grading).toBe(1);
    world.now += 1_000;
    world.rolls.push(0.5);
    const overview = await engine.nexamon();
    expect(overview.collection).toMatchObject({ grading: 0, graded: 1 });
    expect(world.notes).toContain("nexamon_graded");
    expect(world.tracked.nexamon_tens).toBe(1);
    const details = await engine.nexamonCard(ultra.cardKey);
    const slab = details.copies.find((c) => c.id === ultra.copyId)!;
    expect(slab).toMatchObject({ state: "graded", grade: 10, condition: "mint" });
    expect(slab.valueCents).toBe(Math.round(details.card.valueCents * 3));
    expect(details.graded[9]).toBe(1);
    expect(await key(engine.gradeNexamonCard("g3", ultra.copyId))).toBe("nexamon_not_raw");
    expect(await key(engine.sellNexamonToAi("q0", [ultra.copyId]))).toBe("nexamon_not_sellable");
    const cracked = await engine.crackNexamonSlab("c1", ultra.copyId);
    expect(cracked).toMatchObject({ oldGrade: 10, copy: { state: "raw", grade: null, condition: "mint" } });
    expect(world.cash).toBe(cash - grading.feeCents);
    expect(await key(engine.crackNexamonSlab("c2", ultra.copyId))).toBe("nexamon_not_graded");
    expect(await key(engine.gradeNexamonCard("g4", ultra.copyId))).toBe("ok");
  });

  it("sells bulk to the AI at half the value; better cards go over the market", async () => {
    const { engine, world } = setup();
    world.rolls.push(...packRolls(0, 0.9));
    const pack = await engine.buyNexamonPack("r1", "mystic_energy");
    const commons = pack.cards.filter((c) => c.rarity === "common");
    const cash = world.cash;
    const before = (await engine.nexamonCard(commons[0]!.cardKey)).card;
    const sold = await engine.sellNexamonToAi(
      "q1",
      commons.map((c) => c.copyId),
    );
    expect(sold.count).toBe(commons.length);
    expect(sold.totalCents).toBe(commons.reduce((sum, c) => sum + Math.floor(c.valueCents * 0.5), 0));
    expect(world.cash).toBe(cash + sold.totalCents);
    const after = (await engine.nexamonCard(commons[0]!.cardKey)).card;
    expect(after.owned).toBe(0);
    expect(after.population).toBe(before.population);
    expect(after.valueCents).toBeLessThanOrEqual(before.valueCents);
    expect(await key(engine.sellNexamonToAi("q2", [pack.cards[3]!.copyId]))).toBe("nexamon_not_sellable");
    expect(await key(engine.sellNexamonToAi("q3", []))).toBe("invalid_argument");
    expect(await key(engine.sellNexamonToAi("q4", [commons[0]!.copyId]))).toBe("nexamon_unknown");
  });

  it("moves values with supply and demand over time and lets the AI open packs", async () => {
    const { engine, world } = setup();
    const start = await engine.nexamonCollection("mystic_energy");
    // buy up a seeded prisma and hold it: the value climbs hour by hour
    const prisma = start.cards.find((c) => c.rarity === "prisma" && c.listed > 0)!;
    const listing = (await engine.nexamonMarket({ cardKey: prisma.cardKey })).listings[0]!;
    const bought = await engine.buyNexamonListing("b1", listing.id, listing.priceCents);
    world.now += 6 * HOUR;
    const later = await engine.nexamonCollection("mystic_energy");
    const held = later.cards.find((c) => c.cardKey === prisma.cardKey)!;
    expect(held.valueCents).toBeGreaterThan(bought.card.valueCents);
    expect(held.valueCents).toBeLessThanOrEqual(held.capCents);
    // the AI opened packs meanwhile (4 an hour in this set)
    const population = (cards: typeof later.cards) => cards.reduce((sum, c) => sum + c.population, 0);
    expect(population(later.cards)).toBe(population(start.cards) + 6 * cfg.ai.packsPerHour.mystic_energy * 5);
    // nothing leaves its bounds, however long the demo sleeps
    world.now += 400 * 24 * HOUR;
    const muchLater = await engine.nexamonCollection();
    for (const card of muchLater.cards) {
      expect(card.valueCents).toBeGreaterThanOrEqual(card.floorCents);
      expect(card.valueCents).toBeLessThanOrEqual(card.capCents);
      expect(card.listed).toBeLessThanOrEqual(cfg.ai.listedPerCard[card.rarity] + card.owned);
    }
    expect((await engine.nexamonMarket({ rarity: "legendary" })).total).toBe(0);
  });

  it("keeps a card that never moved on the catalogue's start price", async () => {
    const { engine, world } = setup();
    await engine.nexamon();
    const state = world.nexamon!;
    const card = NEXAMON_CARDS[0]!;
    state.cards[card.key]!.valueE4 = 1;
    expect((await engine.nexamonCard(card.key)).card.valueCents).toBe(card.startPriceCents);
  });
});
