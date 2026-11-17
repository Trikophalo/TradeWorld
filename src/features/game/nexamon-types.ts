import type { NexamonCondition } from "@/config/nexamon-rules";
import type { NexamonRarity, NexamonSetKey } from "@/config/nexamon/types";

/*
 * Nexamon collectible cards (ADR-165): what the engine returns. The catalogue (names, art, attacks) is static data in
 * src/config/nexamon; the server only knows key, set, number, rarity and prices. All money is cents.
 */
export type { NexamonCondition, NexamonRarity, NexamonSetKey };

/** raw: a loose card. grading: at ASP until `gradingUntil`. graded: in a slab with a grade. */
export type NexamonCopyState = "raw" | "grading" | "graded";

/** One copy of a card a player owns. */
export interface NexamonCopy {
  id: string;
  cardKey: string;
  /** Population number: the n-th copy of this card ever pulled. */
  serial: number;
  condition: NexamonCondition;
  /** 1..10 (with 8.5 and 9.5) once graded by ASP (11 = Black Label, the tier above a 10), else null. */
  grade: number | null;
  state: NexamonCopyState;
  gradingUntil: string | null;
  gradedAt: string | null;
  /** What this copy is worth: the card's value x condition or grade factor. */
  valueCents: number;
  /** The own open listing of this copy, if any. */
  listing: { id: string; priceCents: number; listedAt: string } | null;
  acquiredAt: string;
}

/** Market data of a card (one value per card, not per copy). */
export interface NexamonCardStats {
  cardKey: string;
  set: NexamonSetKey;
  number: number;
  rarity: NexamonRarity;
  valueCents: number;
  startCents: number;
  /** Change against the value at the start of the Berlin day. */
  changeBps: number;
  /** Copies ever pulled (players, AI and the AI's starting stock). */
  population: number;
  /** Copies on the market right now. */
  listed: number;
  /** Copies the player owns. */
  owned: number;
  /** 0..10 000: rare cards with a low population are popular. */
  popularityBps: number;
  /** Bounds of the value right now. */
  floorCents: number;
  capCents: number;
  /** The account bonus this card gives (ADR-171), null for most cards. */
  bonus: NexamonCardBonus | null;
  /** Value factor of this card's Black Labels in bps (ADR-171 hype; base grading.blackLabel.valueBps). */
  blackLabelBps: number;
  /** Last hype jump while the factor is above the base, else null. */
  hypeAt: string | null;
}

/** Account bonus kinds of the card bonuses (ADR-171). */
export type NexamonBonusKind = "xp" | "mission_xp" | "trade_xp" | "wage" | "vault" | "daily" | "company";
export type NexamonCollectionKind = "type" | "complete" | "master";

export interface NexamonCardBonus {
  kind: NexamonBonusKind;
  /** Bonus of a raw copy. */
  bps: number;
  /** With the best own unlisted copy (slab 9+ x1.5, Black Label x2). */
  boostedBps: number;
  /** The viewer owns an unlisted copy. */
  active: boolean;
  bestGrade: number | null;
}

export interface NexamonCollectionProgress {
  id: string;
  set: NexamonSetKey;
  kind: NexamonCollectionKind;
  /** The type of a type collection. */
  type: string | null;
  have: number;
  need: number;
  complete: boolean;
  /** Cards still missing (master: also prismas and legendaries without a slab of 9+). */
  missing: string[];
  /** null = every kind (master set). */
  bonusKind: NexamonBonusKind | null;
  bonusBps: number;
  /** First completion (reward paid), null = never. */
  completedAt: string | null;
}

export interface NexamonBonuses {
  totals: { kind: NexamonBonusKind; rawBps: number; effectiveBps: number; capBps: number }[];
  /** Every card that gives a bonus. */
  cards: (NexamonCardBonus & { cardKey: string })[];
  collections: NexamonCollectionProgress[];
  serverTime: string;
}

export interface NexamonListing {
  id: string;
  copyId: string;
  cardKey: string;
  set: NexamonSetKey;
  rarity: NexamonRarity;
  serial: number;
  condition: NexamonCondition;
  grade: number | null;
  priceCents: number;
  /** What the copy is worth (for "10 % above value" hints). */
  valueCents: number;
  /** Nickname of the selling player or name of the AI seller. */
  seller: string;
  sellerAi: boolean;
  mine: boolean;
  listedAt: string;
}

export interface NexamonSetSummary {
  key: NexamonSetKey;
  name: string;
  packPriceCents: number;
  /** Cards in the set (77). */
  cards: number;
  ownedDistinct: number;
  ownedCopies: number;
  /** Packs of this set the player opened. */
  packsOpened: number;
  /** Copies of all cards of the set in existence. */
  population: number;
}

export interface NexamonOverview {
  unlocked: boolean;
  unlockLevel: number;
  packSize: number;
  sets: NexamonSetSummary[];
  collection: {
    copies: number;
    distinct: number;
    valueCents: number;
    listed: number;
    grading: number;
    graded: number;
  };
  limits: { maxListings: number; maxGrading: number; packsPerMinute: number };
  serverTime: string;
}

/** One card pulled from a pack, in slot order (1..5). */
export interface NexamonPull {
  slot: number;
  copyId: string;
  cardKey: string;
  rarity: NexamonRarity;
  condition: NexamonCondition;
  /** The player did not own this card before. */
  isNew: boolean;
  serial: number;
  /** The card's population after this pull. */
  population: number;
  valueCents: number;
}

export interface NexamonPackResult {
  packId: string;
  set: NexamonSetKey;
  priceCents: number;
  cards: NexamonPull[];
  /** Packs of this set the player opened so far. */
  packsOpened: number;
}

export interface NexamonCollection {
  /** Every card of the catalogue (or of the set asked for), in set and number order. */
  cards: NexamonCardStats[];
  /** The own copies, in set, number and serial order. */
  copies: NexamonCopy[];
  serverTime: string;
}

export type NexamonSaleKind = "market" | "ai_buy" | "quick";

export interface NexamonSale {
  at: string;
  priceCents: number;
  condition: NexamonCondition;
  grade: number | null;
  /** market: a listing was bought. ai_buy: an AI collector bought a player's listing. quick: instant sale to the AI. */
  kind: NexamonSaleKind;
  seller: string;
  buyer: string;
}

export interface NexamonCardDetails {
  card: NexamonCardStats;
  /** Value over time, oldest first; the last point is now. */
  history: { at: string; valueCents: number }[];
  /** Graded copies per grade in the order of `grading.grades` (1 … 8, 8.5, 9, 9.5, 10; without the Black Labels). */
  graded: number[];
  /** Copies with the Black Label. */
  blackLabels: number;
  /** Black Label factor history (ADR-171 hype), oldest first; jumpBps > 0 for a jump. */
  hype: { at: string; factorBps: number; jumpBps: number }[];
  /** The cheapest listings of this card. */
  listings: NexamonListing[];
  /** The own copies of this card. */
  copies: NexamonCopy[];
  /** Latest sales, newest first. */
  sales: NexamonSale[];
  serverTime: string;
}

export type NexamonMarketSort = "new" | "price_asc" | "price_desc" | "deal" | "value" | "number";
export type NexamonMarketSeller = "all" | "players" | "ai" | "mine";

export interface NexamonMarketQuery {
  set?: NexamonSetKey | null;
  rarity?: NexamonRarity | null;
  /** new (default), price_asc, price_desc, deal (price against value), value (most valuable card first), number. */
  sort?: NexamonMarketSort;
  /** 1-based. */
  page?: number;
  seller?: NexamonMarketSeller;
  cardKey?: string | null;
  /** true = only slabs, false = only raw cards, null = both. */
  graded?: boolean | null;
  /** true = only Black Labels, false = everything else, null = both. */
  blackLabel?: boolean | null;
}

export interface NexamonMarketPage {
  listings: NexamonListing[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  serverTime: string;
}

export interface NexamonListResult {
  listing: NexamonListing;
  copy: NexamonCopy;
}

export interface NexamonBuyResult {
  copy: NexamonCopy;
  card: NexamonCardStats;
  priceCents: number;
  /** What the seller paid to the households (the whole price for an AI seller). */
  feeCents: number;
  /** Whether the sale moved the card's value. */
  counted: boolean;
}

export interface NexamonQuickSellResult {
  sold: { copyId: string; cardKey: string; priceCents: number }[];
  count: number;
  totalCents: number;
}

export interface NexamonGradeResult {
  copy: NexamonCopy;
  feeCents: number;
  readyAt: string;
}

export interface NexamonCrackResult {
  copy: NexamonCopy;
  oldGrade: number;
}

/** One card a player owns, as their profile shows it: the best copy and how many there are. */
export interface PlayerNexamonCard {
  cardKey: string;
  set: NexamonSetKey;
  number: number;
  rarity: NexamonRarity;
  /** Copies of this card the player owns. */
  copies: number;
  /** The best copy (the most valuable one): its population number, condition and grade (null = raw). */
  serial: number;
  condition: NexamonCondition;
  grade: number | null;
  /** Value of the best copy. */
  valueCents: number;
  /** Value of all copies of this card. */
  totalCents: number;
}

/** One slab of a player, for the "Nur gegradete" view (ADR-171). */
export interface PlayerNexamonSlab {
  cardKey: string;
  set: NexamonSetKey;
  number: number;
  rarity: NexamonRarity;
  serial: number;
  condition: NexamonCondition;
  grade: number;
  valueCents: number;
}

/** A player's collection for their profile (ADR-165). Listings and gradings in progress stay private. */
export interface PlayerNexamon {
  nickname: string;
  isMe: boolean;
  /** false: the player has not reached the Nexamon level, nothing is shown. */
  unlocked: boolean;
  summary: {
    copies: number;
    distinct: number;
    /** Cards in the catalogue (231). */
    total: number;
    valueCents: number;
    /** Slabs, and how many of them carry a 10. */
    graded: number;
    tens: number;
    blackLabels: number;
  };
  sets: { key: NexamonSetKey; cards: number; distinct: number; copies: number }[];
  /** One entry per owned card, most valuable first; capped by the limit asked for. */
  cards: PlayerNexamonCard[];
  /** Every slab (ADR-171 "Nur gegradete"), by grade, then value. */
  slabs: PlayerNexamonSlab[];
  /** Completed collections (ADR-171), first completion first. */
  badges: { set: NexamonSetKey; kind: NexamonCollectionKind; type: string | null; at: string }[];
  serverTime: string;
}

export interface NexamonEngine {
  /** Sets with pack prices, the own collection in numbers, unlock. Works while locked (`unlocked: false`). */
  nexamon(): Promise<NexamonOverview>;
  /** Buys and opens one booster pack of a set. */
  buyNexamonPack(requestId: string, set: NexamonSetKey): Promise<NexamonPackResult>;
  /** All cards (value, population, on the market, owned) and the own copies; `set` narrows both. */
  nexamonCollection(set?: NexamonSetKey | null): Promise<NexamonCollection>;
  /** One card: value, history, population, listings, own copies, recent sales. */
  nexamonCard(cardKey: string): Promise<NexamonCardDetails>;
  nexamonMarket(query?: NexamonMarketQuery): Promise<NexamonMarketPage>;
  /**
   * What a player collected, for their profile; null is the own collection. `limit` caps the cards (the most
   * valuable ones), the numbers always cover everything. Works while the viewer's own area is still locked.
   */
  playerNexamon(nickname: string | null, limit?: number | null): Promise<PlayerNexamon>;
  listNexamonCard(requestId: string, copyId: string, priceCents: number): Promise<NexamonListResult>;
  unlistNexamonCard(requestId: string, listingId: string): Promise<{ copy: NexamonCopy }>;
  /** `priceCents` is the price the player saw; a changed price fails with nexamon_price_changed. */
  buyNexamonListing(requestId: string, listingId: string, priceCents: number): Promise<NexamonBuyResult>;
  /** Instant sale of raw commons and rares to the AI for half their value. */
  sellNexamonToAi(requestId: string, copyIds: string[]): Promise<NexamonQuickSellResult>;
  /** Sends a raw copy to ASP: half its value, back after an hour with a grade. */
  gradeNexamonCard(requestId: string, copyId: string): Promise<NexamonGradeResult>;
  /** Cracks a slab: the raw card with its condition comes back, no refund. */
  crackNexamonSlab(requestId: string, copyId: string): Promise<NexamonCrackResult>;
  /** The own card bonuses, their totals against the caps and the collections (ADR-171). */
  nexamonBonuses(): Promise<NexamonBonuses>;
}
