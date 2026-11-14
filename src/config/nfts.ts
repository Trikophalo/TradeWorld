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
      decline: [
        "Nein danke, darunter verkaufe ich nicht.",
        "Netter Versuch. Biete mehr.",
        "Das ist zu wenig für dieses Stück.",
      ],
    },
  },
} as const;
