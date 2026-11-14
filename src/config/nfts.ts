/*
 * NFTs (ADR-135): the pixel artworks of ADR-080, now called NFTs. Creators earn a royalty on every resale, AI
 * collectors buy listed NFTs only at a fair price and write lowball offers, every NFT has an offer chat.
 * Tables and RPCs keep the "artwork" names. Texts in messages/de.json ("art"); the AI lines below are short German
 * chat messages shown as they are.
 */
export const NFT_RULES = {
  /** Every resale (seller is not the creator) pays the creator this share of the price, out of the proceeds. */
  royaltyBps: 1_000,
  /** XP for minting an NFT (before the alpha multiplier). */
  mintXp: 100,
  /** A fixed price ("Sofort kaufen") and an offer in the chat need at least this much. */
  minAskCents: 10_000,
  minOfferCents: 10_000,
  chat: {
    maxLength: 200,
    /** At most this many messages per player and minute (all NFTs together). */
    perMinute: 6,
    /** The chat shows the latest messages. */
    history: 60,
    /** An offer is open this long, then it expires. */
    offerHours: 24,
  },
  /** AI collectors (households money; what they pay comes back to the households when they resell). */
  ai: {
    /** What a collector thinks an NFT is worth: anchor x (1 + bonuses). Anchor = max(last price, mint cost, floor). */
    floorCents: 100_000,
    likeBps: 400,
    maxLikes: 40,
    /** Reputation: per earlier sale of an NFT by the same creator. */
    creatorSaleBps: 300,
    maxCreatorSales: 10,
    /** Vintage: per day since minting. */
    ageBpsPerDay: 100,
    maxAgeDays: 30,
    /** Per minute: a listing at or below the valuation is bought with this chance. */
    buyChanceBps: 2_500,
    /** Per minute and NFT: a collector writes a lowball offer (listing above the value, or not for sale). */
    listedOfferChanceBps: 800,
    unlistedOfferChanceBps: 80,
    /** Lowball offers: this share of the valuation, rounded down to whole euros. */
    lowballMinBps: 6_500,
    lowballMaxBps: 9_000,
    /** At most this many purchases by all collectors per Berlin day, and this many AI messages per minute. */
    maxBuysPerDay: 20,
    maxMessagesPerRun: 4,
    /** An NFT the AI holds is offered for its valuation x this. */
    resaleMarkupBps: 12_500,
    /** The AI accepts a player's offer on an NFT it holds from this share of its valuation. */
    acceptBps: 10_500,
    /**
     * Demand (ADR-141): open offers and recent sales make an NFT hot; the collectors then value it higher
     * (on top of likes) and want it more often.
     */
    demand: {
      offerBps: 600,
      maxOffers: 6,
      saleBps: 500,
      maxSales: 6,
      /** Sales of the last this many days count. */
      days: 7,
    },
    /**
     * The collectors trade among themselves (ADR-141): per minute and NFT a collector holds, another one buys it with
     * a chance that grows with popularity. The price follows the buyer's taste around the fair value (mint cost x
     * bonuses, not the last price) and moves only part of the way from the last price, so prices wander up and down
     * instead of climbing for ever. The buyer offers it again at its markup.
     */
    trade: {
      chanceBps: 60,
      /** Popularity raises the chance: per like, per open offer, per recent sale (bps of the base chance). */
      likeWeightBps: 1_500,
      offerWeightBps: 4_000,
      saleWeightBps: 2_500,
      maxChanceBps: 1_500,
      /** A collector keeps a new NFT at least this long. */
      minHoldMinutes: 30,
      perRun: 2,
      perDay: 30,
      /** Taste of the buying collector: fair value x 85 % .. 125 %. */
      tasteMinBps: 8_500,
      tasteMaxBps: 12_500,
      /** The price moves this share of the way from the last price to the buyer's target. */
      reversionBps: 5_000,
    },
    collectors: [
      "Vera Vermeer",
      "Konrad Kollektor",
      "Pixel-Paula",
      "Baron von Bit",
      "Mia Mosaik",
      "Otto Original",
      "Gräfin Glitzer",
      "Sammler Sam",
    ],
    lines: {
      offer: [
        "Schönes Stück. Mehr ist es mir aber nicht wert.",
        "Für meine Sammlung würde ich so viel zahlen.",
        "Mein Angebot. Überleg es dir nicht zu lange.",
        "Hübsch! Wäre das ein fairer Preis?",
        "Ich biete das. Nimm es, solange ich gute Laune habe.",
      ],
      buy: [
        "Gekauft! Das kommt in meine Sammlung.",
        "Zu diesem Preis konnte ich nicht widerstehen.",
        "Ein fairer Preis. Danke!",
      ],
      accept: ["Abgemacht! Viel Freude damit.", "Einverstanden, es gehört dir."],
      trade: [
        "Endlich gehört es mir! Das wollte ich schon lange.",
        "Ich musste es einfach haben.",
        "Gekauft von einer Kollegin. Jetzt steht es zum Verkauf, wer bietet mehr?",
        "Ein Schnäppchen unter Sammlern.",
        "Das Stück ist gefragt. Ich habe zugeschlagen.",
      ],
      decline: [
        "Nein danke, darunter verkaufe ich nicht.",
        "Netter Versuch. Biete mehr.",
        "Das ist zu wenig für dieses Stück.",
      ],
    },
  },
} as const;
