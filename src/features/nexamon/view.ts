import { BALANCE } from "@/config/balance";
import {
  NEXAMON_CARDS,
  NEXAMON_RARITIES,
  NEXAMON_SETS,
  nexamonCard,
  type NexamonCard,
  type NexamonRarity,
  type NexamonSetKey,
} from "@/config/nexamon";
import type { NexamonCondition } from "@/config/nexamon-rules";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import type { NexamonCardStats, NexamonCopy, NexamonListing } from "@/features/game/nexamon-types";
import {
  NEXAMON_BLACK_LABEL_GRADE,
  nexamonConditionBps,
  nexamonCopyFactorBps,
  nexamonExpectedPerPack,
  nexamonGradeChanceBps,
  nexamonGradingFeeCents,
  nexamonMarketFeeCents,
  nexamonQuickSellCents,
  nexamonSlotOdds,
} from "@/lib/sim/nexamon";

/*
 * What the Nexamon pages show (ADR-165), as pure functions over the engine's answers: the binder with its
 * filters, the honest pull rates of a pack, what a sale or a grading costs and brings. No React in here.
 */
const cfg = BALANCE.nexamon;

// ------------------------------------------------------------------------------------------------ packs

export interface OddsRow {
  rarity: NexamonRarity;
  /** Chance in the two slots that roll, in parts of `denominator`. */
  slot4: number;
  slot5: number;
  denominator: number;
  /** Expected cards of this rarity in one pack. */
  perPack: number;
  /** "One in n packs" on average; null for commons (several per pack). */
  oneInPacks: number | null;
}

/** Pull rates of a pack, best rarity first: the two rolling slots and the average per pack. */
export function packOdds(): OddsRow[] {
  const slot4 = nexamonSlotOdds(4);
  const slot5 = nexamonSlotOdds(5);
  const expected = nexamonExpectedPerPack();
  return [...NEXAMON_RARITIES].reverse().map((rarity) => ({
    rarity,
    slot4: slot4[rarity],
    slot5: slot5[rarity],
    denominator: cfg.odds.denominator,
    perPack: expected[rarity],
    oneInPacks: rarity === "common" || expected[rarity] <= 0 ? null : Math.round(1 / expected[rarity]),
  }));
}

/** A chance as basis points with two decimals kept (4 of 3600 = 11.11 bps), for `formatChance`. */
export const chanceBps = (parts: number, denominator: number): number =>
  denominator > 0 ? (parts / denominator) * 10_000 : 0;

const chanceFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

/** "25 %", "4,17 %", "0,11 %": a chance from basis points, with up to two decimals. */
export function formatChance(bps: number): string {
  return `${chanceFormat.format(bps / 100)} %`;
}

/** A plain number with up to two decimals ("4,39"). */
export const formatDecimal = (value: number): string => chanceFormat.format(value);

/** Cents as the text of a price field: 12 345 is "123,45", 20 000 is "200". */
export const centsToInput = (cents: number): string => String(cents / 100).replace(".", ",");

/** Money under a small tile: exact below 100 €, whole euros up to 10.000 €, short above ("15k €"). */
export function tileMoney(cents: number): string {
  if (cents < 10_000) return formatMoney(cents);
  if (cents < 1_000_000) return formatMoney(cents, { whole: true });
  return formatMoneyShort(cents);
}

export interface SetContentsGroup {
  rarity: NexamonRarity;
  odds: OddsRow;
  /** The cards of the set with this rarity in number order, with the number of own copies. */
  cards: { card: NexamonCard; owned: number }[];
  /** Different cards of the group the player owns. */
  owned: number;
}

/** What a pack of a set can hold: its cards by rarity, best first, with the pull rate and what is owned. */
export function setContents(set: NexamonSetKey, copies: readonly Pick<NexamonCopy, "cardKey">[]): SetContentsGroup[] {
  const count = new Map<string, number>();
  for (const copy of copies) count.set(copy.cardKey, (count.get(copy.cardKey) ?? 0) + 1);
  return packOdds().map((odds) => {
    const cards = NEXAMON_CARDS.filter((card) => card.set === set && card.rarity === odds.rarity).map((card) => ({
      card,
      owned: count.get(card.key) ?? 0,
    }));
    return { rarity: odds.rarity, odds, cards, owned: cards.filter((entry) => entry.owned > 0).length };
  });
}

// ----------------------------------------------------------------------------------------------- binder

export type BinderOwnership = "all" | "owned" | "missing" | "duplicates";
export type BinderSort = "number" | "value" | "newest";
export const BINDER_OWNERSHIPS: readonly BinderOwnership[] = ["all", "owned", "missing", "duplicates"];
export const BINDER_SORTS: readonly BinderSort[] = ["number", "value", "newest"];

export interface BinderFilter {
  set: NexamonSetKey | "all";
  rarity: NexamonRarity | "all";
  ownership: BinderOwnership;
  sort: BinderSort;
}

export const DEFAULT_BINDER_FILTER: BinderFilter = { set: "all", rarity: "all", ownership: "all", sort: "number" };

export interface BinderEntry {
  stats: NexamonCardStats;
  card: NexamonCard;
  /** The own copies of the card, best first (highest grade, then best condition, then lowest serial). */
  copies: NexamonCopy[];
  /** Value of the own copies; 0 when the card is missing. */
  ownedValueCents: number;
  /** Highest grade among the own slabs, null without one. */
  bestGrade: number | null;
  /** When the newest own copy arrived (epoch ms); 0 when the card is missing. */
  newestAt: number;
}

const CONDITION_RANK: Record<NexamonCondition, number> = { poor: 0, good: 1, near_mint: 2, mint: 3 };
const setOrder = (set: NexamonSetKey) => NEXAMON_SETS.indexOf(set);
const cardOrder = (stats: Pick<NexamonCardStats, "set" | "number">) => setOrder(stats.set) * 1_000 + stats.number;

/** Slabs first (best grade), then the best condition, then the lowest serial: the copy a tile shows. */
export function sortCopiesBestFirst(copies: readonly NexamonCopy[]): NexamonCopy[] {
  return [...copies].sort(
    (a, b) =>
      (b.grade ?? 0) - (a.grade ?? 0) ||
      CONDITION_RANK[b.condition] - CONDITION_RANK[a.condition] ||
      a.serial - b.serial,
  );
}

/** Every card of the answer with the own copies, filtered and sorted for the binder. */
export function binderEntries(
  cards: readonly NexamonCardStats[],
  copies: readonly NexamonCopy[],
  filter: BinderFilter,
): BinderEntry[] {
  const byCard = new Map<string, NexamonCopy[]>();
  for (const copy of copies) {
    const list = byCard.get(copy.cardKey);
    if (list) list.push(copy);
    else byCard.set(copy.cardKey, [copy]);
  }
  const entries: BinderEntry[] = [];
  for (const stats of cards) {
    const card = nexamonCard(stats.cardKey);
    if (!card) continue;
    if (filter.set !== "all" && stats.set !== filter.set) continue;
    if (filter.rarity !== "all" && stats.rarity !== filter.rarity) continue;
    const own = sortCopiesBestFirst(byCard.get(stats.cardKey) ?? []);
    if (filter.ownership === "owned" && own.length === 0) continue;
    if (filter.ownership === "missing" && own.length > 0) continue;
    if (filter.ownership === "duplicates" && own.length < 2) continue;
    entries.push({
      stats,
      card,
      copies: own,
      ownedValueCents: own.reduce((sum, c) => sum + c.valueCents, 0),
      bestGrade: own.reduce<number | null>(
        (best, c) => (c.grade !== null && c.grade > (best ?? 0) ? c.grade : best),
        null,
      ),
      newestAt: own.reduce((latest, c) => Math.max(latest, Date.parse(c.acquiredAt) || 0), 0),
    });
  }
  const byNumber = (a: BinderEntry, b: BinderEntry) => cardOrder(a.stats) - cardOrder(b.stats);
  if (filter.sort === "value") entries.sort((a, b) => b.stats.valueCents - a.stats.valueCents || byNumber(a, b));
  else if (filter.sort === "newest") entries.sort((a, b) => b.newestAt - a.newestAt || byNumber(a, b));
  else entries.sort(byNumber);
  return entries;
}

/** The binder in sets: with the number sort every set gets its own block, other sorts are one list. */
export function groupBySet(
  entries: readonly BinderEntry[],
  sort: BinderSort,
): { set: NexamonSetKey | null; entries: BinderEntry[] }[] {
  if (sort !== "number") return entries.length > 0 ? [{ set: null, entries: [...entries] }] : [];
  return NEXAMON_SETS.map((set) => ({ set, entries: entries.filter((e) => e.stats.set === set) })).filter(
    (group) => group.entries.length > 0,
  );
}

export interface CollectionTotals {
  copies: number;
  distinct: number;
  duplicates: number;
  valueCents: number;
}

export function collectionTotals(copies: readonly NexamonCopy[]): CollectionTotals {
  const distinct = new Set(copies.map((c) => c.cardKey)).size;
  return {
    copies: copies.length,
    distinct,
    duplicates: copies.length - distinct,
    valueCents: copies.reduce((sum, c) => sum + c.valueCents, 0),
  };
}

// ------------------------------------------------------------------------------------------------ copies

export type CopyStatus = "raw" | "listed" | "grading" | "graded";

/** What a copy is doing right now. A slab on the market counts as listed. */
export function copyStatus(copy: Pick<NexamonCopy, "state" | "listing">): CopyStatus {
  if (copy.state === "grading") return "grading";
  if (copy.listing) return "listed";
  return copy.state === "graded" ? "graded" : "raw";
}

/** Value factor of a raw copy's condition in basis points (Poor 7 000, Good 9 000, Near Mint and Mint 10 000). */
export const conditionFactorBps = (condition: NexamonCondition): number => nexamonConditionBps(condition);

/** What a listing brings: the fee the seller pays and what arrives. */
export function listingProceeds(priceCents: number): { feeCents: number; netCents: number; feeBps: number } {
  const feeCents = nexamonMarketFeeCents(priceCents);
  return { feeCents, netCents: priceCents - feeCents, feeBps: cfg.market.feeBps };
}

/** Whether a price may be listed at all. */
export const isListablePrice = (priceCents: number | null): priceCents is number =>
  priceCents !== null &&
  Number.isInteger(priceCents) &&
  priceCents >= cfg.market.minPriceCents &&
  priceCents <= cfg.market.maxPriceCents;

/** The price the sell form starts with: what the copy is worth, at least the smallest price. */
export const suggestedPriceCents = (valueCents: number): number => Math.max(cfg.market.minPriceCents, valueCents);

/** What the AI pays at once for a copy; null where it does not buy (slabs, ultra and better, busy copies). */
export function quickSellOffer(copy: NexamonCopy, rarity: NexamonRarity): number | null {
  if (copyStatus(copy) !== "raw") return null;
  return nexamonQuickSellCents(copy.valueCents, rarity, copy.grade);
}

export interface GradeChance {
  grade: number;
  chanceBps: number;
  /** Value factor of the slab against the card's market value. */
  factorBps: number;
}

export interface GradingQuote {
  feeCents: number;
  minutes: number;
  /** Grades this condition can get, best first (grade 11 is the Black Label). */
  chances: GradeChance[];
  /** The Black Label for this condition: chance 0 unless the copy is in the condition that qualifies. */
  blackLabel: GradeChance & { condition: NexamonCondition };
  /** Chance that the slab is worth more than the raw copy. */
  betterBps: number;
  /** Average value factor of the slab against the market value. */
  expectedFactorBps: number;
}

/** Fee, duration and the chance table of ASP for a raw copy. */
export function gradingQuote(copy: Pick<NexamonCopy, "condition" | "valueCents">): GradingQuote {
  const rawBps = nexamonConditionBps(copy.condition);
  const chances: GradeChance[] = [];
  let betterBps = 0;
  let expected = 0;
  for (let grade = NEXAMON_BLACK_LABEL_GRADE; grade >= 1; grade--) {
    const chance = nexamonGradeChanceBps(copy.condition, grade);
    if (chance <= 0) continue;
    const factorBps = nexamonCopyFactorBps(copy.condition, grade);
    chances.push({ grade, chanceBps: chance, factorBps });
    if (factorBps > rawBps) betterBps += chance;
    expected += chance * factorBps;
  }
  return {
    feeCents: nexamonGradingFeeCents(copy.valueCents),
    minutes: cfg.grading.minutes,
    chances,
    blackLabel: {
      grade: NEXAMON_BLACK_LABEL_GRADE,
      chanceBps: nexamonGradeChanceBps(copy.condition, NEXAMON_BLACK_LABEL_GRADE),
      factorBps: cfg.grading.blackLabel.valueBps,
      condition: cfg.grading.blackLabel.condition,
    },
    betterBps,
    expectedFactorBps: Math.round(expected / 10_000),
  };
}

/** Value factor as a multiplier text: 30 000 bps is "×3", 12 000 "×1,2". */
export function formatFactor(bps: number): string {
  return `×${chanceFormat.format(bps / 10_000)}`;
}

// ----------------------------------------------------------------------------------------------- history

export interface ValueCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * A value history as flat candles for the price chart: cents drawn as a "price" (1 cent = 100 in the chart's e4
 * scale), times in seconds and strictly rising (points of the same second are spread by one).
 */
export function historyCandles(points: readonly { at: string; valueCents: number }[]): ValueCandle[] {
  const candles: ValueCandle[] = [];
  let last = 0;
  for (const point of points) {
    const e4 = point.valueCents * 100;
    const time = Math.max(last + 1, Math.floor((Date.parse(point.at) || 0) / 1000));
    last = time;
    candles.push({ time, open: e4, high: e4, low: e4, close: e4, volume: 0 });
  }
  return candles;
}

// ------------------------------------------------------------------------------------------------ market

/** How far a price is from the copy's value, in basis points: negative is a bargain. */
export function dealBps(priceCents: number, valueCents: number): number {
  if (valueCents <= 0) return 0;
  return Math.round(((priceCents - valueCents) / valueCents) * 10_000);
}

export type DealTone = "good" | "fair" | "high";

/** Below value is good, up to the AI's usual mark-up fair, anything above high. */
export function dealTone(bps: number): DealTone {
  if (bps < 0) return "good";
  return bps <= cfg.ai.askBps - 10_000 ? "fair" : "high";
}

/** The own open listings out of the collection, newest first. */
export function ownListings(copies: readonly NexamonCopy[]): NexamonCopy[] {
  return copies
    .filter((c) => c.listing !== null)
    .sort((a, b) => b.listing!.listedAt.localeCompare(a.listing!.listedAt) || a.id.localeCompare(b.id));
}

/** Listings of other sellers only (the own ones cannot be bought). */
export const buyableListings = (listings: readonly NexamonListing[]): NexamonListing[] =>
  listings.filter((l) => !l.mine);

// ----------------------------------------------------------------------------------------------- grading

/** Copies at ASP, the one that is back first on top. */
export function gradingQueue(copies: readonly NexamonCopy[]): NexamonCopy[] {
  return copies
    .filter((c) => c.state === "grading")
    .sort((a, b) => (a.gradingUntil ?? "").localeCompare(b.gradingUntil ?? "") || a.id.localeCompare(b.id));
}

/** Slabs the player has not looked at yet (newest first) and the ones already revealed. */
export function splitGraded(
  copies: readonly NexamonCopy[],
  revealed: readonly string[],
): { fresh: NexamonCopy[]; seen: NexamonCopy[] } {
  const graded = copies
    .filter((c) => c.state === "graded" && c.grade !== null)
    .sort((a, b) => (b.gradedAt ?? "").localeCompare(a.gradedAt ?? "") || a.id.localeCompare(b.id));
  const known = new Set(revealed);
  return { fresh: graded.filter((c) => !known.has(revealKey(c))), seen: graded.filter((c) => known.has(revealKey(c))) };
}

/** A slab is one reveal: the same copy graded again after cracking is a new one. */
export const revealKey = (copy: Pick<NexamonCopy, "id" | "gradedAt">): string => `${copy.id}@${copy.gradedAt ?? ""}`;

/** Where a notification of a kind should lead (the server sends "/nexamon" for all of them). */
export function nexamonNotificationLink(typeKey: string, link: string | null): string | null {
  if (typeKey === "nexamon_graded") return "/nexamon?tab=grading";
  if (typeKey === "nexamon_sale") return "/nexamon?tab=market&view=mine";
  return link;
}
