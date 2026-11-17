/*
 * Nexamon collectible cards (ADR-165): booster packs, pull rates, card conditions, grading by "ASP", the card
 * market with AI sellers and the supply and demand model behind every card's market value.
 * The catalogue (461 cards in six sets) lives in src/config/nexamon; `pnpm db:config` writes key, set, number,
 * rarity and start price of every card to game_config.nexamon_cards, the rules below to game_config.nexamon.
 * The formulas are in src/lib/sim/nexamon.ts and, as the same rule in PL/pgSQL, in
 * supabase/migrations/20261204005200_nexamon.sql.
 *
 * Purity rules (ADR-012): no imports, JSON-serialisable values only (this file is part of BALANCE).
 */
export const NEXAMON_RULES = {
  /** Cards in a booster pack; the slots are numbered 1 to 5. */
  packSize: 5,
  /**
   * The sets in release order with the price of a booster pack (money to the households). `releaseAt` (ADR-182): a
   * set cannot be bought, opened, sealed or battled before this instant (UTC); the shop shows it as "Neu ab".
   */
  sets: {
    mystic_energy: { name: "Nexamon: Mystic Energy", packPriceCents: 20_000 },
    super_apex: { name: "Nexamon: Super Apex", packPriceCents: 100_000 },
    prismatic_peak: { name: "Nexamon: Prismatic Peak", packPriceCents: 1_000_000 },
    cosmic_winds: { name: "Nexamon: Cosmic Winds", packPriceCents: 500_000 },
    titans_revenge: { name: "Nexamon: Titans Revenge", packPriceCents: 10_000_000, releaseAt: "2026-11-17T16:30:00Z" },
    yin_yang: { name: "Nexamon: Yin Yang", packPriceCents: 200_000, releaseAt: "2026-11-17T16:30:00Z" },
  },
  packs: {
    /** At most this many packs per player and minute. */
    perMinute: 20,
    /** Packs of one set in one purchase (ADR-182); every one counts for perMinute. */
    maxPerBuy: 10,
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
   * One of One (ADR-174): in a set with One of One cards, slot `slot` of a player's pack first rolls 1 in `packs`.
   * On a hit it holds one of the set's One of Ones nobody has pulled yet (each exists exactly once in the game,
   * enforced by the database); if none is left, the slot rolls the normal table. AI packs never roll it.
   */
  oneOfOne: { slot: 5, packs: 5_000 },
  /**
   * A set's own slot table (ADR-182), same shape as `odds`, used instead of it. Yin Yang: every chance from ultra
   * upwards x 0.9 (YINYANG_CHASE_PULL_FACTOR), in parts of 36 000 so it stays exact; what is freed goes to the rare
   * (slot 4: ultra 1 350 instead of 1 500, rare 9 150; slot 5: legendary 36, prisma 405, ultra 1 350, rare 9 199).
   * The commons stay as they are.
   */
  setOdds: {
    yin_yang: {
      denominator: 36_000,
      slot4: { legendary: 0, prisma: 0, ultra: 1_350, rare: 9_150 },
      slot5: { legendary: 36, prisma: 405, ultra: 1_350, rare: 9_199 },
    },
  } as Readonly<Record<string, NexamonOddsTable>>,
  /**
   * Pack composition per set (ADR-174). A set without an entry uses `odds` (slots 1-3 common, slots 4 and 5 roll)
   * and `oneOfOne`. A set with an entry of kind "tiers" fills its pack like this: every tier, best first, appears in
   * a pack with the chance 1 / `packs`; then it holds `min` to `max` cards (uniform), filled from the last slot
   * backwards into the slots still free. Every slot left holds the `base` rarity (never twice the same card).
   * Titans Revenge (ADR-182): base "iron", tiers uranium 1/500 (1), diamond 1/50 (1), titanium 1/5 (1-2), so every
   * pack holds 3 to 5 iron cards. Expected value about 90 % of the pack price (docs/BALANCING.md).
   */
  packRules: {
    titans_revenge: {
      kind: "tiers",
      base: "iron",
      tiers: [
        { rarity: "uranium", packs: 500, min: 1, max: 1 },
        { rarity: "diamond", packs: 50, min: 1, max: 1 },
        { rarity: "titanium", packs: 5, min: 1, max: 2 },
      ],
    },
  } as Readonly<Record<string, NexamonTierPackRule>>,
  /**
   * Condition of a pulled card, worst first. Cards worse than "good" are very rare. A raw copy is worth its card's
   * market value x `valueBps` of its condition: poor 70 %, good 90 %, near mint and mint 100 %.
   */
  conditions: {
    order: ["poor", "good", "near_mint", "mint"],
    weightBps: { poor: 200, good: 1_800, near_mint: 5_000, mint: 3_000 },
    valueBps: { poor: 7_000, good: 9_000, near_mint: 10_000, mint: 10_000 },
  },
  /**
   * Grading by "ASP" (a parody of card grading): costs `feeBps` of what the copy is worth right now (to the
   * households), takes `minutes` of real time and ends with a grade from 1 to 10 (with 8.5 and 9.5) in a slab.
   */
  grading: {
    feeBps: 4_000,
    minFeeCents: 100,
    minutes: 60,
    /** At most this many copies of one player at ASP at the same time. */
    maxOpen: 10,
    /**
     * The grades ASP gives, worst first: whole grades 1 to 8, then half steps 8.5, 9, 9.5 and 10 (ADR-165). The
     * arrays below are in this order. The database stores a grade as numeric(3,1) (11 = Black Label).
     */
    grades: [1, 2, 3, 4, 5, 6, 7, 8, 8.5, 9, 9.5, 10],
    /**
     * Chance of every grade in basis points, per condition, in the order of `grades` (index 0 is grade 1, the last
     * one grade 10, Black Label included). A 10 or better: poor 0.05 %, good 0.5 %, near mint 3.5 % (1 % of it a
     * Black Label), mint 40 % (5 % of it a Black Label, so a plain 10 is 35 %, ADR-198).
     */
    gradeWeightsBps: {
      poor: [800, 1_200, 1_500, 2_000, 2_000, 1_500, 700, 200, 50, 30, 15, 5],
      good: [0, 0, 0, 750, 1_200, 2_000, 2_500, 1_700, 1_000, 600, 200, 50],
      near_mint: [0, 0, 0, 0, 0, 500, 1_200, 2_200, 2_400, 2_400, 950, 350],
      mint: [0, 0, 0, 0, 0, 0, 200, 500, 1_000, 2_300, 2_000, 4_000],
    },
    /**
     * A slab is worth the card's market value x this (the condition no longer counts), in the order of `grades`.
     * 8 and better are worth more than the raw card, 7 and below less. A 10 is rare, so it is worth 4x.
     */
    valueBps: [3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 12_000, 14_000, 17_000, 23_000, 40_000],
    /**
     * ADR-174: a 10 is worth 2.5x to 4x the card, a 9.5 1.8x to 2.6x, by the card's popularity (0 = low end,
     * 10 000 = high end). `valueBps` above stays the fallback where the card is not known. The 9.5 range starts above
     * a 9 (1.7x) and every 10 lies above the 9.5 of the same card, so the ladder stays in order.
     */
    tenFactorRange: [25_000, 40_000],
    nineHalfFactorRange: [18_000, 26_000],
    /**
     * The Black Label, one tier above a 10 (stored as grade 11, shown as "ASP 10 Black Label"). Only copies in the
     * conditions of `chanceBps` can get it: that share of their gradings, taken out of their chance for a 10 (mint 5 %,
     * near mint 1 %). The slab is worth the card's market value x `valueBps`.
     */
    blackLabel: { chanceBps: { near_mint: 100, mint: 500 }, valueBps: 100_000 },
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
      rarityBps: {
        common: 500,
        rare: 1_500,
        ultra: 4_000,
        prisma: 7_000,
        legendary: 9_000,
        one_of_one: 10_000,
        iron: 800,
        titanium: 4_000,
        diamond: 7_000,
        uranium: 9_500,
      },
      scarceBonusBps: 3_000,
      popRef: {
        common: 2_000,
        rare: 800,
        ultra: 150,
        prisma: 30,
        legendary: 4,
        one_of_one: 1,
        iron: 1_500,
        titanium: 150,
        diamond: 30,
        uranium: 4,
      },
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
      want: {
        common: 4,
        rare: 3,
        ultra: 2,
        prisma: 1,
        legendary: 1,
        one_of_one: 1,
        iron: 4,
        titanium: 2,
        diamond: 1,
        uranium: 1,
      },
      buyWeightMilli: 500,
      buyDays: 7,
      maxBuys: 10,
      /** Cards handled per run of the job. */
      perRun: 80,
    },
    /**
     * Rarities whose value moves only by trades between players (ADR-174): no supply-and-demand step, no AI
     * purchases. The band, the steps and the anti-manipulation rules of `trade` still apply.
     */
    tradeOnlyRarities: ["one_of_one"],
  },
  /** AI sellers and collectors (households money, like the NFT collectors). */
  ai: {
    sellers: ["Karten-Kalle", "Booster-Berta", "Holo-Hanna", "Sammel-Sven"],
    /** The AI always offers a copy 10 % above what it is worth. */
    askBps: 11_000,
    /**
     * Copies of every card the AI owns at the start; of the prismas only the `seedPrismaCards` cheapest per set.
     * Titans Revenge (ADR-182): iron and titanium like common and ultra, no diamond (the AI gets one only from its own
     * packs, about 1 in 50, and offers it once), never uranium (`excludedRarities`).
     */
    seedCopies: {
      common: 6,
      rare: 4,
      ultra: 2,
      prisma: 1,
      legendary: 0,
      one_of_one: 0,
      iron: 6,
      titanium: 2,
      diamond: 0,
      uranium: 0,
    },
    seedPrismaCards: 2,
    /** Copies of a card the AI offers at once; the rest of its stock waits. */
    listedPerCard: {
      common: 4,
      rare: 3,
      ultra: 2,
      prisma: 1,
      legendary: 0,
      one_of_one: 0,
      iron: 4,
      titanium: 2,
      diamond: 1,
      uranium: 0,
    },
    /** Per value run (hour) and legendary card the AI holds: chance that one copy goes on sale. */
    legendaryListChanceBps: 20,
    /** The AI opens packs too, so populations level out; its pulls go into its stock. */
    packsPerHour: {
      mystic_energy: 4,
      super_apex: 2,
      prismatic_peak: 1,
      cosmic_winds: 1,
      titans_revenge: 1,
      yin_yang: 2,
    },
    maxPacksPerRun: 5,
    /**
     * AI collectors buy players' listings (ADR-165). At or below the copy's value they always buy, on the next run of
     * the minute job (only the households' daily budget per set stops them). Above the value they pay a premium for a
     * good copy: at most value x (1 + premium), the premium by condition for a raw copy and by grade for a slab
     * (order of `grading.grades`, the Black Label its own). Up there the chance per minute is `buyChanceBps`
     * x (1 + popularity) just above the value, falling linearly to `atMaxChanceBps` of it at the maximum.
     */
    buyChanceBps: 3_000,
    atMaxChanceBps: 2_000,
    premiumBps: { poor: 0, good: 300, near_mint: 800, mint: 1_200 },
    gradePremiumBps: [0, 0, 0, 0, 0, 0, 0, 500, 700, 1_000, 1_200, 1_500],
    blackLabelPremiumBps: 2_000,
    /**
     * An AI buy moves the card's value (aiBuyBumpBps) only if its price per card lies within `value.trade.bandBps`
     * of the value and the card had fewer than this many such counted AI buys in `buyWindowDays`; else it still
     * sells, without moving the value.
     */
    buysPerCardWindow: {
      common: 6,
      rare: 6,
      ultra: 4,
      prisma: 3,
      legendary: 2,
      one_of_one: 0,
      iron: 6,
      titanium: 4,
      diamond: 2,
      uranium: 0,
    },
    buyWindowDays: 1,
    maxBuysPerRun: 100,
    /** Budget per set and Berlin day: this many pack prices. */
    dailyBudgetPacks: 300,
    /**
     * Rarities the AI never pulls, holds or buys (ADR-174): One of Ones change hands only between players, and so do
     * the uranium cards of Titans Revenge (ADR-182; an AI pack that rolls uranium gets iron in that slot).
     */
    excludedRarities: ["one_of_one", "uranium"],
    /**
     * The AI's offers do not pile up (ADR-174): every `listingResetHours` all AI listings go, the AI's stock of a card
     * above `stockCap` is retired (newest first; the population still counts it) and it lists its normal amounts
     * again at the current value.
     */
    listingResetHours: 6,
    stockCap: {
      common: 12,
      rare: 8,
      ultra: 4,
      prisma: 2,
      legendary: 1,
      one_of_one: 0,
      iron: 12,
      titanium: 4,
      diamond: 1,
      uranium: 0,
    },
    /**
     * Graded copies never leave circulation (ADR-165): a slab that reaches the AI (an AI collector's buy, a leaving
     * player) is never retired; the AI holds it `minHours` + (`maxHours` - `minHours`) x u^`skewPow` hours (u uniform,
     * so most come back within a day, some are held for days) and then lists it at its current value plus `askBps`.
     */
    slabHold: { minHours: 1, maxHours: 72, skewPow: 2 },
  },
  /**
   * Bulk (ADR-174): raw copies of the bulk rarities (`rarities`, or per set `setRarities[set]`, e.g. Titans Revenge's
   * iron) can be sold to the game at once for `bps` of their value (a 35 % fee, since ADR-174; before 50 %), from the
   * households. Every copy sold this way lowers its card's value by `dropBps`. Up to `maxPerCall` copies per call and
   * `callsPerMinute` calls of the collection's bulk mode per minute.
   */
  quickSell: {
    rarities: ["common", "rare"],
    setRarities: { titans_revenge: ["iron"] } as Readonly<Record<string, readonly string[]>>,
    bps: 6_500,
    maxPerCall: 500,
    callsPerMinute: 10,
    dropBps: 25,
  },
  /**
   * Pulling a card of these rarities is news for the friends (feed kind nexamon_pull). A Black Label always is
   * (feed kind nexamon_black_label).
   */
  feedRarities: ["legendary", "uranium"],
  /**
   * A pull worth more than this at pull time (copy value incl. condition) is news for everyone (ADR-190): every
   * other active player gets the notification nexamon_big_pull, the friends the feed item. At most one broadcast
   * per puller every `bigPullNotifySeconds`; several big pulls of one opening (one call) make one notification.
   */
  bigPullNotifyCents: 10_000_000,
  bigPullNotifySeconds: 60,
  /**
   * Who is on the Collectibles tab (ADR-172): the page asks every `pingSeconds`; a player counts as there for
   * `presenceSeconds` after the last ask. At most `maxPlayers` figures are shown.
   */
  presence: { pingSeconds: 15, presenceSeconds: 60, maxPlayers: 24 },
  /**
   * Pack Battles (ADR-172): two friends on the tab open one pack of the same set each; the higher total value of
   * the pulls (at pull time) takes all ten cards. Tie: the rarest single card, then a coin flip (seed stored).
   * Timing of the shared reveal, from the accept: `startDelayMs` until both packs tear, `tearMs` for the tear,
   * then one slot every `slotMs` on both sides at once; the winner shows one slot after the last card, the view
   * stays live `outroMs` longer. A slot's card reaches the clients `leadMs` before it shows (never before the start).
   */
  battles: {
    challengeSeconds: 60,
    perHour: 6,
    cooldownSeconds: 20,
    startDelayMs: 3_000,
    tearMs: 2_400,
    slotMs: 1_800,
    leadMs: 800,
    outroMs: 8_000,
    /** A win of at least this many cents is gossip for NEXA Nachrichten (feed kind nexamon_battle_big). */
    gossipMinCents: 500_000,
  },
  /**
   * Pack Battles with several packs and up to four players (ADR-192): the creator picks a lineup of 1..`maxPacks`
   * packs (any released sets, in order) and the size (`minPlayers`..`maxPlayers`). Everyone pays the sum of the
   * lineup when taking a seat (held in escrow), the battle starts when the last seat is taken, every player opens
   * the same lineup pack by pack on the shared clock (`battles` timing per pack). A lobby that is not full after
   * `lobbySeconds`, or that the creator cancels, refunds every seat in full.
   */
  packBattle: {
    maxPacks: 10,
    minPlayers: 2,
    maxPlayers: 4,
    lobbySeconds: 120,
  },
  /**
   * Live openings (ADR-172): every opened pack can be watched while it is revealed. The opener's page reports each
   * card as it shows; spectators see only what the opener has seen. Without a report for `staleMs`, one more card
   * shows every `fallbackSlotMs`. A session lives at most `maxMs` and `lingerMs` after the last card.
   */
  live: {
    /**
     * ADR-182: a player's next pack that starts at most this long after their live opening ended (or while it runs)
     * continues that session; spectators stay and see the next pack.
     */
    continueSeconds: 30,
    staleMs: 10_000,
    fallbackSlotMs: 2_500,
    lingerMs: 8_000,
    maxMs: 120_000,
    viewerSeconds: 10,
    reactions: ["🔥", "😱", "👏", "💎", "😂"],
    reactionsPerMinute: 30,
    maxSessions: 12,
  },
  /**
   * Card bonuses (ADR-171): some cards give a small passive account bonus while the player owns a copy that is not
   * on the market (a listed copy does not count, so selling costs the bonus). Every card of `rarities` gives one,
   * and in every set the rares numbered `extraNumbers`. The kind follows the card's type (`typeKind`), the size its
   * rarity (`rarityBps`) times its set (`setBps`). A slab of the card at `slab.minGrade` or better multiplies it by
   * `slab.gradeBps`, a Black Label by `slab.blackLabelBps` (the best own copy counts, each card once).
   * Bonuses of one kind add up to `raw`; the effective bonus is raw up to the knee (kneeShareBps of the cap), above
   * it only `tailBps` of the rest counts, never more than `caps[kind]`.
   */
  bonuses: {
    kinds: ["xp", "mission_xp", "trade_xp", "wage", "vault", "daily", "company"],
    typeKind: {
      fire: "company",
      dragon: "company",
      water: "vault",
      grass: "daily",
      electric: "trade_xp",
      psychic: "mission_xp",
      fairy: "mission_xp",
      rock: "wage",
      steel: "wage",
      dark: "xp",
      // stars and void: knowledge from far away, so plain XP (ADR-174)
      cosmic: "xp",
    },
    /** Titans Revenge (ADR-182): titanium like an ultra, diamond like a prisma, uranium like a legendary. */
    rarities: ["ultra", "prisma", "legendary", "one_of_one", "titanium", "diamond", "uranium"],
    extraNumbers: [60],
    rarityBps: {
      common: 25,
      rare: 50,
      ultra: 50,
      prisma: 100,
      legendary: 250,
      one_of_one: 500,
      iron: 25,
      titanium: 50,
      diamond: 100,
      uranium: 250,
    },
    setBps: {
      mystic_energy: 10_000,
      super_apex: 12_500,
      prismatic_peak: 15_000,
      cosmic_winds: 15_000,
      titans_revenge: 17_500,
      yin_yang: 15_000,
    },
    slab: { minGrade: 9, gradeBps: 15_000, blackLabelBps: 20_000 },
    /** Hard cap per kind in bps (xp 10 %, mission and trade XP 15 %, wage 10 %, vault 15 %, daily 20 %, company 10 %). */
    caps: { xp: 1_000, mission_xp: 1_500, trade_xp: 1_500, wage: 1_000, vault: 1_500, daily: 2_000, company: 1_000 },
    kneeShareBps: 5_000,
    tailBps: 5_000,
    /**
     * Collections. "type": every card of one type in a set; "complete": all cards of a set; "master": all of them and
     * every prisma and legendary of the set as an own slab of grade `masterMinGrade` or better. Owned means not
     * listed, like the cards. While a collection stays complete it adds `bps` (times the set's setBps) to the type's
     * kind ("type"), to `kind` ("complete") or to every kind ("master"); the first completion pays `rewardPacks`
     * pack prices of the set (from the households, as far as they have it) and `rewardXp` XP, once per player.
     */
    sets: {
      /** A type with fewer than `minCards` cards in a set is no collection (ADR-182: Titans has one-card types). */
      type: { bps: 50, rewardPacks: 3, rewardXp: 300, minCards: 3 },
      complete: { kind: "xp", bps: 200, rewardPacks: 20, rewardXp: 2_500 },
      master: { bps: 100, rewardPacks: 75, rewardXp: 10_000 },
      /**
       * The money of one reward pack where it is not the set's pack price (ADR-182): a Titans pack costs 100.000 €,
       * but a type collection of iron and titanium cards is worth far less; there a reward pack counts 10.000 €.
       */
      rewardPackCents: { titans_revenge: 1_000_000 } as Readonly<Record<string, number>>,
      masterMinGrade: 9,
      /** Titans Revenge (ADR-182): its diamonds and uranium cards as slabs. */
      masterRarities: ["prisma", "legendary", "diamond", "uranium"],
      /** Cards of these rarities count for no collection (ADR-174): nobody can be asked to own a One of One. */
      excludeRarities: ["one_of_one"],
    },
  },
  /**
   * Black Label hype (ADR-171): the Black Labels of a card carry their own factor (start grading.blackLabel.valueBps).
   * Once per hour per card with at least one Black Label, the chance
   *   rarityChanceBps[rarity] x (10 000 + popularity) / 10 000 x blRef / (blRef + Black Labels of the card - 1)
   * that the factor jumps by minJumpBps..maxJumpBps of itself (uniform), at most capBps. Every hour the factor loses
   * decayBps of what it lies above the base (half-life about 69 hours). A jump of bigJumpBps or more is news.
   */
  blackLabelHype: {
    rarityChanceBps: {
      common: 5,
      rare: 10,
      ultra: 25,
      prisma: 60,
      legendary: 120,
      one_of_one: 200,
      iron: 5,
      titanium: 25,
      diamond: 60,
      uranium: 150,
    },
    blRef: 3,
    minJumpBps: 1_000,
    maxJumpBps: 6_000,
    capBps: 250_000,
    decayBps: 100,
    bigJumpBps: 4_000,
    /** Points of the hype history on a card's page. */
    historyPoints: 30,
  },
} as const;

export type NexamonRules = typeof NEXAMON_RULES;
/** A slot table (see `odds` and `setOdds`). */
export interface NexamonOddsTable {
  denominator: number;
  slot4: { legendary: number; prisma: number; ultra: number; rare: number };
  slot5: { legendary: number; prisma: number; ultra: number; rare: number };
}
/** A set's own pack composition (see `packRules`). Rarity names are those of src/config/nexamon/types.ts. */
export interface NexamonTierPackRule {
  kind: "tiers";
  base: string;
  tiers: readonly { rarity: string; packs: number; min: number; max: number }[];
}
export const NEXAMON_CONDITIONS = NEXAMON_RULES.conditions.order;
export type NexamonCondition = (typeof NEXAMON_CONDITIONS)[number];
