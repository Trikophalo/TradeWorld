/*
 * Nexamon collectible cards (ADR-165): booster packs, pull rates, card conditions, grading by "ASP", the card
 * market with AI sellers and the supply and demand model behind every card's market value.
 * The catalogue (231 cards in three sets) lives in src/config/nexamon; `pnpm db:config` writes key, set, number,
 * rarity and start price of every card to game_config.nexamon_cards, the rules below to game_config.nexamon.
 * The formulas are in src/lib/sim/nexamon.ts and, as the same rule in PL/pgSQL, in
 * supabase/migrations/20261204005200_nexamon.sql.
 *
 * Purity rules (ADR-012): no imports, JSON-serialisable values only (this file is part of BALANCE).
 */
export const NEXAMON_RULES = {
  /** Cards in a booster pack; the slots are numbered 1 to 5. */
  packSize: 5,
  /** The sets in release order with the price of a booster pack (money to the households). */
  sets: {
    mystic_energy: { name: "Nexamon: Mystic Energy", packPriceCents: 20_000 },
    super_apex: { name: "Nexamon: Super Apex", packPriceCents: 100_000 },
    prismatic_peak: { name: "Nexamon: Prismatic Peak", packPriceCents: 1_000_000 },
  },
  packs: {
    /** At most this many packs per player and minute. */
    perMinute: 20,
  },
  /**
   * Pull rates. Slots 1 to 3 always hold a common. Slot 4 and slot 5 roll once each, in parts of `denominator`;
   * what is left is a common. Per pack this gives exactly (in expectation):
   *   rare      900/3600 + 900/3600 = 1/2   (slot 4 or 5)
   *   ultra     150/3600 + 150/3600 = 1/12  (slot 4 or 5)
   *   prisma     45/3600            = 1/80  (slot 5 only)
   *   legendary   4/3600            = 1/900 (slot 5 only)
   * and 3 to 5 commons, always in the first slots. Within a rarity every card of the set is equally likely;
   * the commons of a pack are all different.
   */
  odds: {
    denominator: 3_600,
    slot4: { legendary: 0, prisma: 0, ultra: 150, rare: 900 },
    slot5: { legendary: 4, prisma: 45, ultra: 150, rare: 900 },
  },
  /**
   * Condition of a pulled card, worst first. Cards worse than "good" are very rare. From "good" upwards a card is
   * worth its market value; every step below "good" costs `belowGoodStepBps` of the value (poor: 95 %).
   */
  conditions: {
    order: ["poor", "good", "near_mint", "mint"],
    weightBps: { poor: 200, good: 1_800, near_mint: 5_000, mint: 3_000 },
    belowGoodStepBps: 500,
  },
  /**
   * Grading by "ASP" (a parody of card grading): costs `feeBps` of what the copy is worth right now (to the
   * households), takes `minutes` of real time and ends with a grade from 1 to 10 in a slab.
   */
  grading: {
    feeBps: 5_000,
    minFeeCents: 100,
    minutes: 60,
    /** At most this many copies of one player at ASP at the same time. */
    maxOpen: 10,
    /**
     * Chance of every grade in basis points, per condition; index 0 is grade 1, index 9 is grade 10.
     * A 10: poor 0.1 %, good 10 %, near mint 60 %, mint 90 %.
     */
    gradeWeightsBps: {
      poor: [500, 1_000, 1_500, 2_000, 2_000, 1_500, 1_000, 400, 90, 10],
      good: [0, 0, 0, 500, 800, 1_200, 2_000, 2_500, 2_000, 1_000],
      near_mint: [0, 0, 0, 0, 0, 100, 400, 1_000, 2_500, 6_000],
      mint: [0, 0, 0, 0, 0, 0, 0, 200, 800, 9_000],
    },
    /**
     * A slab is worth the card's market value x this (the condition no longer counts); index 0 is grade 1.
     * 8 to 10 are always worth more than the raw card, 7 and below less.
     */
    valueBps: [3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 12_000, 16_000, 30_000],
  },
  /** Listings of single copies at a price the seller chooses. */
  market: {
    /** Share of the price a selling player pays to the households. */
    feeBps: 500,
    minPriceCents: 10,
    maxPriceCents: 100_000_000_000,
    /** Open listings per player. */
    maxListings: 30,
    /** Listing and unlisting together, per player and minute. */
    actionsPerMinute: 30,
    pageSize: 24,
    /** Sales shown on a card's page. */
    recentSales: 20,
    /** Days of value history on a card's page. */
    historyDays: 60,
  },
  /**
   * The market value of a card (one per card, not per copy). It starts at the catalogue's start price and moves by
   * trades and by supply against demand.
   */
  value: {
    /** Bounds: never below `floorBps` of the start price, never above the cap. */
    floorBps: 2_000,
    /** Cap = start price x (capBaseBps + capPerDayBps per day since the first pull + capPerTradeBps per counted trade), at most capMaxBps. */
    capBaseBps: 30_000,
    capPerDayBps: 200,
    capPerTradeBps: 50,
    capMaxBps: 200_000,
    /** Per Berlin day the value leaves the day's first value by at most this much. */
    dayMaxRiseBps: 1_500,
    dayMaxFallBps: 2_000,
    /**
     * Trades. A sale counts only if its price per card (price / condition or grade factor) lies within `bandBps` of
     * the value; then the value moves `weightBps` of the way to that price, at most `maxStepBps` per sale. Between
     * the same two players only one sale per card counts in `pairHours`, per buyer and card `perPlayerDay` a day.
     * Upward moves are scaled by the card's popularity (at least `minPopularityBps`).
     */
    trade: {
      bandBps: 2_500,
      weightBps: 2_000,
      maxStepBps: 200,
      pairHours: 24,
      perPlayerDay: 3,
      minPopularityBps: 2_500,
    },
    /** An AI collector buying a player's listing at or below the value raises it by this x popularity. */
    aiBuyBumpBps: 50,
    /**
     * Popularity of a card in basis points: rarity plus a bonus for a low population,
     * rarityBps + scarceBonusBps x popRef / (popRef + population), at most 10 000.
     */
    popularity: {
      rarityBps: { common: 500, rare: 1_500, ultra: 4_000, prisma: 7_000, legendary: 9_000 },
      scarceBonusBps: 3_000,
      popRef: { common: 2_000, rare: 800, ultra: 150, prisma: 30, legendary: 4 },
    },
    /**
     * Supply against demand, once per `everyMinutes` and card.
     *   demand (copies) = want x (popRef + seed) / (popRef + population) + buyWeightMilli/1000 x purchases of the
     *                     last buyDays days (at most maxBuys)
     *   supply (copies) = copies offered at a plausible price (at most the value x (1 + trade.bandBps))
     *   pressure        = (demand - supply) / want, between -1 and +1
     * The value rises by pressure x upStepBps x popularity, or falls by pressure x downStepBps. `want` is what the AI
     * sellers offer at the start, so a new card stands still.
     */
    pressure: {
      everyMinutes: 60,
      upStepBps: 30,
      downStepBps: 30,
      want: { common: 4, rare: 3, ultra: 2, prisma: 1, legendary: 1 },
      buyWeightMilli: 500,
      buyDays: 7,
      maxBuys: 10,
      /** Cards handled per run of the job. */
      perRun: 80,
    },
  },
  /** AI sellers and collectors (households money, like the NFT collectors). */
  ai: {
    sellers: ["Karten-Kalle", "Booster-Berta", "Holo-Hanna", "Sammel-Sven"],
    /** The AI always offers a copy 10 % above what it is worth. */
    askBps: 11_000,
    /** Copies of every card the AI owns at the start; of the prismas only the `seedPrismaCards` cheapest per set. */
    seedCopies: { common: 6, rare: 4, ultra: 2, prisma: 1, legendary: 0 },
    seedPrismaCards: 2,
    /** Copies of a card the AI offers at once; the rest of its stock waits. */
    listedPerCard: { common: 4, rare: 3, ultra: 2, prisma: 1, legendary: 0 },
    /** Per value run (hour) and legendary card the AI holds: chance that one copy goes on sale. */
    legendaryListChanceBps: 20,
    /** The AI opens packs too, so populations level out; its pulls go into its stock. */
    packsPerHour: { mystic_energy: 4, super_apex: 2, prismatic_peak: 1 },
    maxPacksPerRun: 5,
    /** The AI buys a player's listing only up to this share of what the copy is worth (slabs: gradedBuyMaxBps). */
    buyMaxBps: 10_000,
    gradedBuyMaxBps: 7_000,
    /** Chance per minute and listing, x (1 + popularity). */
    buyChanceBps: 300,
    /** The AI buys at most this many copies of a card from players in `buyWindowDays`. */
    buysPerCardWindow: { common: 2, rare: 3, ultra: 3, prisma: 2, legendary: 1 },
    buyWindowDays: 7,
    maxBuysPerRun: 5,
    /** Budget per set and Berlin day: this many pack prices. */
    dailyBudgetPacks: 300,
  },
  /** Instant sale of raw bulk cards to the AI, below value; every copy sold this way lowers the value a little. */
  quickSell: {
    rarities: ["common", "rare"],
    bps: 5_000,
    maxPerCall: 50,
    dropBps: 25,
  },
  /** Pulling a card of these rarities is news for the friends (feed kind nexamon_pull). */
  feedRarities: ["legendary"],
} as const;

export type NexamonRules = typeof NEXAMON_RULES;
export const NEXAMON_CONDITIONS = NEXAMON_RULES.conditions.order;
export type NexamonCondition = (typeof NEXAMON_CONDITIONS)[number];
