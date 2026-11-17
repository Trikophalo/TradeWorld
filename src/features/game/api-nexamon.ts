import { z } from "zod";
import { NEXAMON_CONDITIONS, NEXAMON_RULES } from "@/config/nexamon-rules";
import { NEXAMON_RARITIES, NEXAMON_SETS } from "@/config/nexamon/types";
import type {
  NexamonBonusKind,
  NexamonCardStats,
  NexamonCopy,
  NexamonEngine,
  NexamonListing,
  NexamonMarketQuery,
  NexamonPackResult,
} from "./nexamon-types";
import { rpc } from "./rpc";

/*
 * Nexamon collectible cards (ADR-165) against the server: packs, collection, card market, grading.
 */
const num = z.number();
const iso = z.string();
const setKey = z.enum(NEXAMON_SETS);
const rarity = z.enum(NEXAMON_RARITIES);
const condition = z.enum(NEXAMON_CONDITIONS);
/** 1..10 in the steps of grading.grades (8.5 and 9.5), 11 = Black Label. */
const grade = z
  .number()
  .refine((g) => g === 11 || (NEXAMON_RULES.grading.grades as readonly number[]).includes(g))
  .nullable();

const copySchema = z.object({
  id: z.string(),
  card_key: z.string(),
  serial: num,
  condition,
  grade,
  state: z.enum(["raw", "grading", "graded"]),
  grading_until: iso.nullable(),
  graded_at: iso.nullable(),
  value_cents: num,
  listing: z.object({ id: z.string(), price_cents: num, listed_at: iso }).nullable(),
  acquired_at: iso,
});

const bonusKind = z.enum(NEXAMON_RULES.bonuses.kinds as unknown as [NexamonBonusKind, ...NexamonBonusKind[]]);
const cardBonusSchema = z.object({
  kind: bonusKind,
  bps: num,
  boosted_bps: num,
  active: z.boolean(),
  best_grade: num.nullable(),
});

const cardSchema = z.object({
  card_key: z.string(),
  set: setKey,
  number: num,
  rarity,
  value_cents: num,
  start_cents: num,
  change_bps: num,
  population: num,
  listed: num,
  owned: num,
  popularity_bps: num,
  floor_cents: num,
  cap_cents: num,
  // ADR-171: only sent by a database with the card bonuses and the Black Label hype
  bonus: cardBonusSchema.nullable().default(null),
  black_label_bps: num.default(NEXAMON_RULES.grading.blackLabel.valueBps),
  hype_at: iso.nullable().default(null),
});

const listingSchema = z.object({
  id: z.string(),
  copy_id: z.string(),
  card_key: z.string(),
  set: setKey,
  rarity,
  serial: num,
  condition,
  grade,
  price_cents: num,
  value_cents: num,
  seller: z.string(),
  seller_ai: z.boolean(),
  mine: z.boolean(),
  listed_at: iso,
});

const overviewSchema = z.object({
  unlocked: z.boolean(),
  unlock_level: num,
  pack_size: num,
  sets: z.array(
    z.object({
      key: setKey,
      name: z.string(),
      pack_price_cents: num,
      cards: num,
      owned_distinct: num,
      owned_copies: num,
      packs_opened: num,
      population: num,
    }),
  ),
  collection: z.object({
    copies: num,
    distinct: num,
    value_cents: num,
    listed: num,
    grading: num,
    graded: num,
  }),
  limits: z.object({ max_listings: num, max_grading: num, packs_per_minute: num }),
  server_time: iso,
  // ADR-174: only sent by a database with the One of Ones
  one_of_ones: z
    .array(
      z.object({
        card_key: z.string(),
        set: setKey,
        pulled: z.boolean(),
        pulled_by: z.string().nullable(),
        pulled_at: iso.nullable(),
      }),
    )
    .default([]),
});

const packSchema = z.object({
  pack_id: z.string(),
  set: setKey,
  price_cents: num,
  cards: z.array(
    z.object({
      slot: num,
      copy_id: z.string(),
      card_key: z.string(),
      rarity,
      condition,
      is_new: z.boolean(),
      serial: num,
      population: num,
      value_cents: num,
    }),
  ),
  packs_opened: num,
});

const collectionSchema = z.object({
  cards: z.array(cardSchema),
  copies: z.array(copySchema),
  server_time: iso,
});

const cardDetailsSchema = z.object({
  card: cardSchema,
  history: z.array(z.object({ at: iso, value_cents: num })),
  graded: z.array(num).length(NEXAMON_RULES.grading.grades.length),
  black_labels: num.default(0),
  hype: z.array(z.object({ at: iso, factor_bps: num, jump_bps: num })).default([]),
  listings: z.array(listingSchema),
  copies: z.array(copySchema),
  sales: z.array(
    z.object({
      at: iso,
      price_cents: num,
      condition,
      grade,
      kind: z.enum(["market", "ai_buy", "quick"]),
      seller: z.string(),
      buyer: z.string(),
    }),
  ),
  server_time: iso,
});

const marketSchema = z.object({
  listings: z.array(listingSchema),
  total: num,
  page: num,
  page_size: num,
  pages: num,
  server_time: iso,
});

const playerSchema = z.object({
  nickname: z.string(),
  is_me: z.boolean(),
  unlocked: z.boolean(),
  summary: z.object({
    copies: num,
    distinct: num,
    total: num,
    value_cents: num,
    graded: num,
    tens: num,
    black_labels: num.default(0),
  }),
  sets: z.array(z.object({ key: setKey, cards: num, distinct: num, copies: num })),
  cards: z.array(
    z.object({
      card_key: z.string(),
      set: setKey,
      number: num,
      rarity,
      copies: num,
      serial: num,
      condition,
      grade,
      value_cents: num,
      total_cents: num,
    }),
  ),
  slabs: z
    .array(
      z.object({
        card_key: z.string(),
        set: setKey,
        number: num,
        rarity,
        serial: num,
        condition,
        grade: num,
        value_cents: num,
      }),
    )
    .default([]),
  badges: z
    .array(
      z.object({ set: setKey, kind: z.enum(["type", "complete", "master"]), type: z.string().nullable(), at: iso }),
    )
    .default([]),
  server_time: iso,
});

const bonusesSchema = z.object({
  totals: z.array(z.object({ kind: bonusKind, raw_bps: num, effective_bps: num, cap_bps: num })),
  cards: z.array(cardBonusSchema.extend({ card_key: z.string() })),
  collections: z.array(
    z.object({
      id: z.string(),
      set: setKey,
      kind: z.enum(["type", "complete", "master"]),
      type: z.string().nullable(),
      have: num,
      need: num,
      complete: z.boolean(),
      missing: z.array(z.string()),
      bonus_kind: bonusKind.nullable(),
      bonus_bps: num,
      completed_at: iso.nullable(),
    }),
  ),
  server_time: iso,
});

const listedSchema = z.object({ listing: listingSchema, copy: copySchema });
const unlistedSchema = z.object({ copy: copySchema });
// ADR-174: several copies at once
const listedManySchema = z.object({ listings: z.array(listingSchema), copies: z.array(copySchema) });
const unlistedManySchema = z.object({ copies: z.array(copySchema) });
const boughtSchema = z.object({
  copy: copySchema,
  card: cardSchema,
  price_cents: num,
  fee_cents: num,
  counted: z.boolean(),
});
const quickSoldSchema = z.object({
  sold: z.array(z.object({ copy_id: z.string(), card_key: z.string(), price_cents: num })),
  count: num,
  total_cents: num,
});
const packsSchema = z.object({ set: setKey, count: num, price_cents: num, packs: z.array(packSchema) });
const gradingSchema = z.object({ copy: copySchema, fee_cents: num, ready_at: iso });
const crackedSchema = z.object({ copy: copySchema, old_grade: num });

export const NEXAMON_RPC_SCHEMAS = {
  get_nexamon_collection: collectionSchema,
  get_nexamon_card: cardDetailsSchema,
  get_nexamon_market: marketSchema,
  get_nexamon: overviewSchema,
  get_player_nexamon: playerSchema,
  buy_nexamon_pack: packSchema,
  buy_nexamon_packs: packsSchema,
  list_nexamon_card: listedSchema,
  unlist_nexamon_card: unlistedSchema,
  list_nexamon_cards: listedManySchema,
  unlist_nexamon_cards: unlistedManySchema,
  buy_nexamon_listing: boughtSchema,
  sell_nexamon_to_ai: quickSoldSchema,
  bulk_sell_nexamon: quickSoldSchema,
  grade_nexamon_card: gradingSchema,
  crack_nexamon_slab: crackedSchema,
  get_nexamon_bonuses: bonusesSchema,
} as const;

const toPack = (r: z.infer<typeof packSchema>): NexamonPackResult => ({
  packId: r.pack_id,
  set: r.set,
  priceCents: r.price_cents,
  cards: r.cards.map((c) => ({
    slot: c.slot,
    copyId: c.copy_id,
    cardKey: c.card_key,
    rarity: c.rarity,
    condition: c.condition,
    isNew: c.is_new,
    serial: c.serial,
    population: c.population,
    valueCents: c.value_cents,
  })),
  packsOpened: r.packs_opened,
});

const toCopy = (c: z.infer<typeof copySchema>): NexamonCopy => ({
  id: c.id,
  cardKey: c.card_key,
  serial: c.serial,
  condition: c.condition,
  grade: c.grade,
  state: c.state,
  gradingUntil: c.grading_until,
  gradedAt: c.graded_at,
  valueCents: c.value_cents,
  listing: c.listing ? { id: c.listing.id, priceCents: c.listing.price_cents, listedAt: c.listing.listed_at } : null,
  acquiredAt: c.acquired_at,
});

const toCard = (c: z.infer<typeof cardSchema>): NexamonCardStats => ({
  cardKey: c.card_key,
  set: c.set,
  number: c.number,
  rarity: c.rarity,
  valueCents: c.value_cents,
  startCents: c.start_cents,
  changeBps: c.change_bps,
  population: c.population,
  listed: c.listed,
  owned: c.owned,
  popularityBps: c.popularity_bps,
  floorCents: c.floor_cents,
  capCents: c.cap_cents,
  bonus: c.bonus ? toBonus(c.bonus) : null,
  blackLabelBps: c.black_label_bps,
  hypeAt: c.hype_at,
});

function toBonus(b: z.infer<typeof cardBonusSchema>) {
  return { kind: b.kind, bps: b.bps, boostedBps: b.boosted_bps, active: b.active, bestGrade: b.best_grade };
}

const toListing = (l: z.infer<typeof listingSchema>): NexamonListing => ({
  id: l.id,
  copyId: l.copy_id,
  cardKey: l.card_key,
  set: l.set,
  rarity: l.rarity,
  serial: l.serial,
  condition: l.condition,
  grade: l.grade,
  priceCents: l.price_cents,
  valueCents: l.value_cents,
  seller: l.seller,
  sellerAi: l.seller_ai,
  mine: l.mine,
  listedAt: l.listed_at,
});

export const liveNexamonEngine: NexamonEngine = {
  async nexamon() {
    const r = await rpc("get_nexamon", {}, overviewSchema);
    return {
      unlocked: r.unlocked,
      unlockLevel: r.unlock_level,
      packSize: r.pack_size,
      sets: r.sets.map((s) => ({
        key: s.key,
        name: s.name,
        packPriceCents: s.pack_price_cents,
        cards: s.cards,
        ownedDistinct: s.owned_distinct,
        ownedCopies: s.owned_copies,
        packsOpened: s.packs_opened,
        population: s.population,
      })),
      collection: {
        copies: r.collection.copies,
        distinct: r.collection.distinct,
        valueCents: r.collection.value_cents,
        listed: r.collection.listed,
        grading: r.collection.grading,
        graded: r.collection.graded,
      },
      oneOfOnes: r.one_of_ones.map((x) => ({
        cardKey: x.card_key,
        set: x.set,
        pulled: x.pulled,
        pulledBy: x.pulled_by,
        pulledAt: x.pulled_at,
      })),
      limits: {
        maxListings: r.limits.max_listings,
        maxGrading: r.limits.max_grading,
        packsPerMinute: r.limits.packs_per_minute,
      },
      serverTime: r.server_time,
    };
  },
  async buyNexamonPack(requestId, set) {
    return toPack(await rpc("buy_nexamon_pack", { p_request_id: requestId, p_set: set }, packSchema));
  },
  async buyNexamonPacks(requestId, set, count) {
    const r = await rpc("buy_nexamon_packs", { p_request_id: requestId, p_set: set, p_count: count }, packsSchema);
    return { set: r.set, count: r.count, priceCents: r.price_cents, packs: r.packs.map(toPack) };
  },
  async nexamonCollection(set = null) {
    const r = await rpc("get_nexamon_collection", { p_set: set }, collectionSchema);
    return { cards: r.cards.map(toCard), copies: r.copies.map(toCopy), serverTime: r.server_time };
  },
  async nexamonCard(cardKey) {
    const r = await rpc("get_nexamon_card", { p_key: cardKey }, cardDetailsSchema);
    return {
      card: toCard(r.card),
      history: r.history.map((h) => ({ at: h.at, valueCents: h.value_cents })),
      graded: r.graded,
      blackLabels: r.black_labels,
      hype: r.hype.map((h) => ({ at: h.at, factorBps: h.factor_bps, jumpBps: h.jump_bps })),
      listings: r.listings.map(toListing),
      copies: r.copies.map(toCopy),
      sales: r.sales.map((s) => ({
        at: s.at,
        priceCents: s.price_cents,
        condition: s.condition,
        grade: s.grade,
        kind: s.kind,
        seller: s.seller,
        buyer: s.buyer,
      })),
      serverTime: r.server_time,
    };
  },
  async nexamonMarket(query: NexamonMarketQuery = {}) {
    const r = await rpc(
      "get_nexamon_market",
      {
        p_set: query.set ?? null,
        p_rarity: query.rarity ?? null,
        p_sort: query.sort ?? "new",
        p_page: query.page ?? 1,
        p_seller: query.seller ?? "all",
        p_card_key: query.cardKey ?? null,
        p_graded: query.graded ?? null,
        // only sent when set: a database before the Black Label does not know the argument
        ...(query.blackLabel == null ? {} : { p_black_label: query.blackLabel }),
      },
      marketSchema,
    );
    return {
      listings: r.listings.map(toListing),
      total: r.total,
      page: r.page,
      pageSize: r.page_size,
      pages: r.pages,
      serverTime: r.server_time,
    };
  },
  async playerNexamon(nickname, limit = null) {
    const r = await rpc("get_player_nexamon", { p_nickname: nickname, p_limit: limit }, playerSchema);
    return {
      nickname: r.nickname,
      isMe: r.is_me,
      unlocked: r.unlocked,
      summary: {
        copies: r.summary.copies,
        distinct: r.summary.distinct,
        total: r.summary.total,
        valueCents: r.summary.value_cents,
        graded: r.summary.graded,
        tens: r.summary.tens,
        blackLabels: r.summary.black_labels,
      },
      sets: r.sets,
      cards: r.cards.map((c) => ({
        cardKey: c.card_key,
        set: c.set,
        number: c.number,
        rarity: c.rarity,
        copies: c.copies,
        serial: c.serial,
        condition: c.condition,
        grade: c.grade,
        valueCents: c.value_cents,
        totalCents: c.total_cents,
      })),
      slabs: r.slabs.map((c) => ({
        cardKey: c.card_key,
        set: c.set,
        number: c.number,
        rarity: c.rarity,
        serial: c.serial,
        condition: c.condition,
        grade: c.grade,
        valueCents: c.value_cents,
      })),
      badges: r.badges,
      serverTime: r.server_time,
    };
  },
  async listNexamonCard(requestId, copyId, priceCents) {
    const r = await rpc(
      "list_nexamon_card",
      { p_request_id: requestId, p_copy_id: copyId, p_price_cents: priceCents },
      listedSchema,
    );
    return { listing: toListing(r.listing), copy: toCopy(r.copy) };
  },
  async unlistNexamonCard(requestId, listingId) {
    const r = await rpc("unlist_nexamon_card", { p_request_id: requestId, p_listing_id: listingId }, unlistedSchema);
    return { copy: toCopy(r.copy) };
  },
  async bulkSellNexamon(requestId, copyIds) {
    const r = await rpc("bulk_sell_nexamon", { p_request_id: requestId, p_copy_ids: copyIds }, quickSoldSchema);
    return {
      sold: r.sold.map((s) => ({ copyId: s.copy_id, cardKey: s.card_key, priceCents: s.price_cents })),
      count: r.count,
      totalCents: r.total_cents,
    };
  },
  async listNexamonCards(requestId, cardKey, condition, grade, count, priceCents) {
    const r = await rpc(
      "list_nexamon_cards",
      {
        p_request_id: requestId,
        p_card_key: cardKey,
        p_condition: condition,
        p_grade: grade,
        p_count: count,
        p_price_cents: priceCents,
      },
      listedManySchema,
    );
    return { listings: r.listings.map(toListing), copies: r.copies.map(toCopy) };
  },
  async unlistNexamonCards(requestId, listingIds) {
    const r = await rpc(
      "unlist_nexamon_cards",
      { p_request_id: requestId, p_listing_ids: listingIds },
      unlistedManySchema,
    );
    return { copies: r.copies.map(toCopy) };
  },
  async buyNexamonListing(requestId, listingId, priceCents) {
    const r = await rpc(
      "buy_nexamon_listing",
      { p_request_id: requestId, p_listing_id: listingId, p_price_cents: priceCents },
      boughtSchema,
    );
    return {
      copy: toCopy(r.copy),
      card: toCard(r.card),
      priceCents: r.price_cents,
      feeCents: r.fee_cents,
      counted: r.counted,
    };
  },
  async sellNexamonToAi(requestId, copyIds) {
    const r = await rpc("sell_nexamon_to_ai", { p_request_id: requestId, p_copy_ids: copyIds }, quickSoldSchema);
    return {
      sold: r.sold.map((s) => ({ copyId: s.copy_id, cardKey: s.card_key, priceCents: s.price_cents })),
      count: r.count,
      totalCents: r.total_cents,
    };
  },
  async gradeNexamonCard(requestId, copyId) {
    const r = await rpc("grade_nexamon_card", { p_request_id: requestId, p_copy_id: copyId }, gradingSchema);
    return { copy: toCopy(r.copy), feeCents: r.fee_cents, readyAt: r.ready_at };
  },
  async crackNexamonSlab(requestId, copyId) {
    const r = await rpc("crack_nexamon_slab", { p_request_id: requestId, p_copy_id: copyId }, crackedSchema);
    return { copy: toCopy(r.copy), oldGrade: r.old_grade };
  },
  async nexamonBonuses() {
    const r = await rpc("get_nexamon_bonuses", {}, bonusesSchema);
    return {
      totals: r.totals.map((t) => ({
        kind: t.kind,
        rawBps: t.raw_bps,
        effectiveBps: t.effective_bps,
        capBps: t.cap_bps,
      })),
      cards: r.cards.map((c) => ({ cardKey: c.card_key, ...toBonus(c) })),
      collections: r.collections.map((c) => ({
        id: c.id,
        set: c.set,
        kind: c.kind,
        type: c.type,
        have: c.have,
        need: c.need,
        complete: c.complete,
        missing: c.missing,
        bonusKind: c.bonus_kind,
        bonusBps: c.bonus_bps,
        completedAt: c.completed_at,
      })),
      serverTime: r.server_time,
    };
  },
};
