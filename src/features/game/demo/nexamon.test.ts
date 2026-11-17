import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { NEXAMON_CARDS, nexamonCard } from "@/config/nexamon";
import { nexamonAiAskCents, nexamonGradeFactorBps, nexamonGradingFeeCents } from "@/lib/sim/nexamon";
import { createRng } from "@/lib/sim/rng";
import { GameError } from "../types";
import { createNexamonEngine, demoOtherCopies, type DemoNexamonState } from "./nexamon";

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
    /** Levels of the made-up players the demo knows, by lower-case nickname. */
    others: { anna: 14, bruno: 4 } as Record<string, number>,
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
    playerLevel: (nickname) => world.others[nickname.toLowerCase()] ?? null,
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
      ["cosmic_winds", 500_000, 90],
      ["prismatic_peak", 1_000_000, 77],
    ]);
    expect(overview.oneOfOnes.map((x) => [x.cardKey, x.pulled])).toEqual([
      ["cw-088", false],
      ["cw-089", false],
      ["cw-090", false],
    ]);
    expect(await key(engine.buyNexamonPack("r1", "mystic_energy"))).toBe("nexamon_locked");
    expect(await key(engine.nexamonCollection())).toBe("nexamon_locked");
    expect(await key(engine.nexamonMarket())).toBe("nexamon_locked");
  });

  it("starts with the AI's stock: every card listed 10 % above its start price, no legendary, few prismas", async () => {
    const { engine } = setup();
    const { cards } = await engine.nexamonCollection();
    expect(cards).toHaveLength(321);
    for (const card of cards) {
      expect(card.valueCents).toBe(nexamonCard(card.cardKey)!.startPriceCents);
      expect(card.listed).toBe(Math.min(card.population, cfg.ai.listedPerCard[card.rarity]));
      if (card.rarity === "legendary") expect(card.population).toBe(0);
    }
    expect(cards.filter((c) => c.rarity === "prisma" && c.population > 0)).toHaveLength(8);
    expect(cards.filter((c) => c.rarity === "one_of_one" && c.population > 0)).toHaveLength(0);
    const market = await engine.nexamonMarket({ sort: "price_asc" });
    expect(market.total).toBe(3 * (50 * 4 + 10 * 3 + 10 * 2 + 2) + (50 * 4 + 15 * 3 + 15 * 2 + 2));
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
    world.rolls.push(0.9);
    const overview = await engine.nexamon();
    expect(overview.collection).toMatchObject({ grading: 0, graded: 1 });
    expect(world.notes).toContain("nexamon_graded");
    expect(world.tracked.nexamon_tens).toBe(1);
    const details = await engine.nexamonCard(ultra.cardKey);
    const slab = details.copies.find((c) => c.id === ultra.copyId)!;
    expect(slab).toMatchObject({ state: "graded", grade: 10, condition: "mint" });
    // ADR-174: a 10 is worth 2.5x to 4x by the card's popularity, rounded once from the e4 value
    const factor = nexamonGradeFactorBps(10, details.card.popularityBps);
    expect(factor).toBeGreaterThanOrEqual(25_000);
    expect(factor).toBeLessThanOrEqual(40_000);
    expect(Math.abs(slab.valueCents - (details.card.valueCents * factor) / 10_000)).toBeLessThanOrEqual(2);
    expect(details.graded[11]).toBe(1);
    expect(await key(engine.gradeNexamonCard("g3", ultra.copyId))).toBe("nexamon_not_raw");
    expect(await key(engine.sellNexamonToAi("q0", [ultra.copyId]))).toBe("nexamon_not_sellable");
    const cracked = await engine.crackNexamonSlab("c1", ultra.copyId);
    expect(cracked).toMatchObject({ oldGrade: 10, copy: { state: "raw", grade: null, condition: "mint" } });
    expect(world.cash).toBe(cash - grading.feeCents);
    expect(await key(engine.crackNexamonSlab("c2", ultra.copyId))).toBe("nexamon_not_graded");
    expect(await key(engine.gradeNexamonCard("g4", ultra.copyId))).toBe("ok");
  });

  it("gives a mint card the Black Label on the highest rolls: ten times the value, news, its own count", async () => {
    const { engine, world } = setup();
    world.rolls.push(...packRolls(0, 0.9, 0.99));
    const pack = await engine.buyNexamonPack("r1", "mystic_energy");
    const ultra = pack.cards[3]!;
    const common = pack.cards[0]!;
    expect(ultra.condition).toBe("mint");
    await engine.gradeNexamonCard("g1", ultra.copyId);
    await engine.gradeNexamonCard("g2", common.copyId);
    world.now += HOUR;
    // the two gradings in the order of the copies (the common first): the Black Label takes the top 5 % of a mint roll
    world.rolls.push({ mint: 0.9, near_mint: 0.97, good: 0.9997, poor: 0.99996 }[common.condition], 0.96);
    world.feed.length = 0;
    await engine.nexamon();
    const details = await engine.nexamonCard(ultra.cardKey);
    const slab = details.copies.find((c) => c.id === ultra.copyId)!;
    expect(slab).toMatchObject({ state: "graded", grade: 11, condition: "mint" });
    expect(Math.abs(slab.valueCents - details.card.valueCents * 10)).toBeLessThanOrEqual(5);
    expect(details.blackLabels).toBe(1);
    expect(details.graded).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // the grade stays a surprise until the package is opened: no feed item
    expect(world.feed).toEqual([]);
    expect(world.tracked.nexamon_black_labels).toBe(1);
    // a Black Label is a 10 for the mission of the first 10 as well
    expect(world.tracked.nexamon_tens).toBe(2);
    const plain = (await engine.nexamonCard(common.cardKey)).copies.find((c) => c.id === common.copyId)!;
    expect(plain.grade).toBe(10);
    // the market knows it: listed with its grade, found by the Black Label filter only
    await engine.listNexamonCard("l1", ultra.copyId, slab.valueCents);
    await engine.listNexamonCard("l2", common.copyId, plain.valueCents);
    const black = await engine.nexamonMarket({ blackLabel: true });
    expect(black.listings.map((l) => l.copyId)).toEqual([ultra.copyId]);
    expect(black.listings[0]).toMatchObject({ grade: 11, valueCents: slab.valueCents });
    const others = await engine.nexamonMarket({ blackLabel: false, graded: true });
    expect(others.listings.map((l) => l.copyId)).toEqual([common.copyId]);
    // cracking it returns the raw mint card; the label is gone
    const mine = (await engine.nexamonMarket({ blackLabel: true })).listings[0]!;
    await engine.unlistNexamonCard("u1", mine.id);
    expect(await key(engine.sellNexamonToAi("q0", [ultra.copyId]))).toBe("nexamon_not_sellable");
    const cracked = await engine.crackNexamonSlab("c1", ultra.copyId);
    expect(cracked).toMatchObject({ oldGrade: 11, copy: { state: "raw", grade: null, condition: "mint" } });
    expect((await engine.nexamonCard(ultra.cardKey)).blackLabels).toBe(0);
  });

  it("sells bulk to the AI at the value minus the 35 % bulk fee; better cards go over the market", async () => {
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
    expect(sold.totalCents).toBe(commons.reduce((sum, c) => sum + Math.floor((c.valueCents * 6_500) / 10_000), 0));
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

  it("pulls each One of One of Cosmic Winds only once (ADR-174)", async () => {
    const { engine, world } = setup(10, 10_000_000);
    // slots 1-3: card and condition; slot 4: rarity, card, condition; slot 5: the One of One roll hits (0)
    const sure = () => [...Array<number>(9).fill(0.5), 0, 0, 0.5];
    world.rolls.push(...sure());
    const first = await engine.buyNexamonPack("c1", "cosmic_winds");
    expect(first.priceCents).toBe(500_000);
    expect(first.cards[4]).toMatchObject({ rarity: "one_of_one", cardKey: "cw-088", serial: 1 });
    world.rolls.push(...sure());
    const second = await engine.buyNexamonPack("c2", "cosmic_winds");
    expect(second.cards[4]).toMatchObject({ rarity: "one_of_one", cardKey: "cw-089" });
    const overview = await engine.nexamon();
    expect(overview.oneOfOnes.map((x) => [x.cardKey, x.pulled, x.pulledBy])).toEqual([
      ["cw-088", true, "Demo"],
      ["cw-089", true, "Demo"],
      ["cw-090", false, null],
    ]);
    // AI packs never hold one
    const { cards } = await engine.nexamonCollection("cosmic_winds");
    expect(cards.find((c) => c.cardKey === "cw-090")!.population).toBe(0);
  });

  describe("a player's collectibles on their profile", () => {
    it("shows the own collection: one row per card with its best copy, most valuable first", async () => {
      const { engine, world } = setup();
      world.rolls.push(...packRolls(0.5, 0.5), ...packRolls(0.5, 0.5));
      const first = await engine.buyNexamonPack("r1", "mystic_energy");
      await engine.buyNexamonPack("r2", "mystic_energy");
      const own = await engine.playerNexamon(null);
      const { copies } = await engine.nexamonCollection();
      expect(own.nickname).toBe("Demo");
      expect(own.isMe).toBe(true);
      expect(own.unlocked).toBe(true);
      expect(own.summary).toEqual({
        copies: 10,
        distinct: new Set(copies.map((c) => c.cardKey)).size,
        total: 321,
        valueCents: copies.reduce((sum, c) => sum + c.valueCents, 0),
        graded: 0,
        tens: 0,
        blackLabels: 0,
      });
      // the same rolls twice: every card is owned twice
      expect(own.cards).toHaveLength(5);
      for (const card of own.cards) {
        expect(card.copies).toBe(2);
        expect(card.grade).toBeNull();
        expect(card.totalCents).toBe(
          copies.filter((c) => c.cardKey === card.cardKey).reduce((sum, c) => sum + c.valueCents, 0),
        );
        expect(card.valueCents).toBe(
          Math.max(...copies.filter((c) => c.cardKey === card.cardKey).map((c) => c.valueCents)),
        );
      }
      expect(own.cards.map((c) => c.valueCents)).toEqual([...own.cards.map((c) => c.valueCents)].sort((a, b) => b - a));
      expect(own.sets.map((s) => [s.key, s.cards, s.distinct, s.copies])).toEqual([
        ["mystic_energy", 77, 5, 10],
        ["super_apex", 77, 0, 0],
        ["cosmic_winds", 90, 0, 0],
        ["prismatic_peak", 77, 0, 0],
      ]);
      // by the own name it is the same answer
      expect((await engine.playerNexamon(" demo ")).cards).toEqual(own.cards);

      // a slab is the best copy of its card and counts as a slab (and a ten)
      const copyId = first.cards[4]!.copyId;
      await engine.gradeNexamonCard("g1", copyId);
      world.now += HOUR + 1;
      world.rolls.push(0.999);
      const graded = await engine.playerNexamon(null);
      expect(graded.summary.graded).toBe(1);
      expect(graded.summary.tens).toBe(1);
      const slab = graded.cards.find((c) => c.cardKey === first.cards[4]!.cardKey)!;
      expect(slab.grade).toBeGreaterThanOrEqual(10);
      expect(slab.serial).toBe(first.cards[4]!.serial);
      expect(graded.cards[0]!.valueCents).toBeGreaterThanOrEqual(slab.valueCents);
    });

    it("caps the cards with the limit, never the numbers", async () => {
      const { engine } = setup();
      await engine.buyNexamonPack("r1", "mystic_energy");
      const all = await engine.playerNexamon(null);
      const top = await engine.playerNexamon(null, 2);
      expect(top.cards).toEqual(all.cards.slice(0, 2));
      expect(top.summary).toEqual(all.summary);
      expect((await engine.playerNexamon(null, 0)).cards).toHaveLength(1);
      expect((await engine.playerNexamon(null, 100_000)).cards).toHaveLength(all.cards.length);
    });

    it("shows a made-up friend's cards: the same every time, slabs among them, nothing below the level", async () => {
      const { engine, world } = setup(1);
      // the viewer is a beginner: the profile of others still works
      const anna = await engine.playerNexamon("Anna");
      expect(anna.nickname).toBe("Anna");
      expect(anna.isMe).toBe(false);
      expect(anna.unlocked).toBe(true);
      expect(anna.summary.copies).toBe(demoOtherCopies("Anna", 14, 10).length);
      expect(anna.summary.copies).toBe(5 * 6 * 5);
      expect(anna.summary.distinct).toBe(anna.cards.length);
      expect(anna.summary.graded).toBeGreaterThan(0);
      expect(anna.summary.valueCents).toBe(anna.cards.reduce((sum, c) => sum + c.totalCents, 0));
      expect(anna.sets.reduce((sum, s) => sum + s.copies, 0)).toBe(anna.summary.copies);
      expect(anna.cards.some((c) => c.grade !== null)).toBe(true);
      expect(anna.cards.every((c) => nexamonCard(c.cardKey)?.set === c.set)).toBe(true);
      expect((await engine.playerNexamon("anna")).cards).toEqual(anna.cards);
      expect((await engine.playerNexamon("Anna", 8)).cards).toEqual(anna.cards.slice(0, 8));
      // they live on the profile only: the demo's populations and the own collection do not know them
      expect(world.nexamon!.copies).toHaveLength(0);

      const bruno = await engine.playerNexamon("Bruno");
      expect(bruno.unlocked).toBe(false);
      expect(bruno.summary.copies).toBe(0);
      expect(bruno.cards).toEqual([]);
      expect(await key(engine.playerNexamon("Niemand"))).toBe("player_not_found");
    });
  });
});

describe("Nexamon card bonuses and Black Label hype in the demo (ADR-171)", () => {
  const give = (world: ReturnType<typeof setup>["world"], cardKey: string, grade: number | null = null) => {
    const s = world.nexamon!;
    const id = `t-${s.nextId++}`;
    s.copies.push({
      id,
      cardKey,
      serial: 1,
      condition: "mint",
      grade,
      gradingUntil: null,
      gradedAt: null,
      acquiredAt: world.now,
      listing: null,
    });
    return id;
  };

  it("activates a card bonus while owned and not listed, with notifications", async () => {
    const { world, engine } = setup();
    await engine.nexamon();
    const water = NEXAMON_CARDS.find((c) => c.set === "mystic_energy" && c.rarity === "prisma" && c.type === "water")!;
    const copy = give(world, water.key);
    let b = await engine.nexamonBonuses();
    expect(b.totals.find((t) => t.kind === "vault")!.effectiveBps).toBe(100);
    expect(b.cards.find((c) => c.cardKey === water.key)!.active).toBe(true);
    expect(world.tracked.nexamon_bonus_cards).toBe(1);
    expect((await engine.nexamonCard(water.key)).card.bonus).toMatchObject({ kind: "vault", bps: 100, active: true });
    await engine.listNexamonCard("l1", copy, 100_000);
    b = await engine.nexamonBonuses();
    expect(b.totals.find((t) => t.kind === "vault")!.effectiveBps).toBe(0);
    expect(world.notes).toContain("nexamon_bonus");
  });

  it("rewards a type collection once and lists what is missing", async () => {
    const { world, engine } = setup();
    await engine.nexamon();
    const cards = NEXAMON_CARDS.filter((c) => c.set === "super_apex" && c.type === "dragon");
    for (const c of cards.slice(1)) give(world, c.key);
    let b = await engine.nexamonBonuses();
    expect(b.collections.find((c) => c.id === "col:super_apex:type:dragon")!.missing).toEqual([cards[0]!.key]);
    const cash = world.cash;
    give(world, cards[0]!.key);
    b = await engine.nexamonBonuses();
    expect(b.collections.find((c) => c.id === "col:super_apex:type:dragon")!.complete).toBe(true);
    expect(world.cash).toBe(cash + 3 * cfg.sets.super_apex.packPriceCents);
    await engine.nexamonBonuses();
    expect(world.cash).toBe(cash + 3 * cfg.sets.super_apex.packPriceCents);
    expect(world.tracked.nexamon_type_sets).toBe(1);
    expect((await engine.playerNexamon(null)).badges).toHaveLength(1);
  });

  it("lets the Black Labels of a card jump, the copy value follows", async () => {
    const { world, engine } = setup();
    await engine.nexamon();
    const legend = NEXAMON_CARDS.find((c) => c.rarity === "legendary")!;
    give(world, legend.key, 11);
    await engine.nexamonCard(legend.key);
    // the last hour handled lies an hour back: one step, with a jump (rolls 0, 0)
    world.nexamon!.hype![legend.key]!.at -= HOUR;
    world.rolls.push(0, 0);
    const d = await engine.nexamonCard(legend.key);
    expect(d.card.blackLabelBps).toBe(110_000);
    expect(d.hype.at(-1)!.jumpBps).toBe(1_000);
    expect(d.copies[0]!.valueCents).toBe(Math.round((d.card.valueCents * 110_000) / 10_000));
    expect(world.notes).toContain("nexamon_hype");
    expect((await engine.playerNexamon(null)).slabs[0]).toMatchObject({ cardKey: legend.key, grade: 11 });
  });
});
