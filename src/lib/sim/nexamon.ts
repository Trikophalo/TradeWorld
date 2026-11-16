/**
 * Nexamon collectible cards (ADR-165): pack contents, card conditions, grading, the value of a copy and the supply
 * and demand model behind every card's market value. The database runs the same rules in PL/pgSQL
 * (supabase/migrations/20261204005200_nexamon.sql); the demo and the UI use these.
 *
 * Units: a card's market value is a price, euros x 10 000 (`*E4`); money is cents. A price becomes money once,
 * rounded half to even (ADR-003). Randomness is passed in (`u` uniform in [0, 1), or `rng` returning such numbers).
 */
import { BALANCE } from "../../config/balance.ts";
import type { NexamonCondition } from "../../config/nexamon-rules.ts";
import type { NexamonRarity } from "../../config/nexamon/types.ts";
import { divRoundHalfEven } from "./money.ts";

type Config = typeof BALANCE.nexamon;

const RARITIES_BEST_FIRST = ["legendary", "prisma", "ultra", "rare"] as const;
const BPS = BigInt(10_000);
const big = (n: number) => BigInt(Math.trunc(n));
const clampUnit = (u: number) => Math.min(Math.max(Number.isFinite(u) ? u : 0, 0), 0.999999999);
/** a x b / c, rounded half to even. */
const mulDivRound = (a: number, b: number, c: number) => Number(divRoundHalfEven(big(a) * big(b), big(c)));
/** a x b / c, rounded down (a, b, c >= 0). */
const mulDivFloor = (a: number, b: number, c: number) => Number((big(a) * big(b)) / big(c));

export const NEXAMON_E4_PER_CENT = 100;
export const nexamonE4FromCents = (cents: number) => cents * NEXAMON_E4_PER_CENT;
/** A price as money: cents, rounded half to even. */
export const nexamonCentsFromE4 = (e4: number) => mulDivRound(e4, 1, NEXAMON_E4_PER_CENT);

// ---------------------------------------------------------------------------------------------- packs

/** Chance of every rarity in a slot, in parts of `odds.denominator`. Slots 1 to 3 are always common. */
export function nexamonSlotOdds(slot: number, cfg: Config = BALANCE.nexamon): Record<NexamonRarity, number> {
  const den = cfg.odds.denominator;
  const table = slot === 5 ? cfg.odds.slot5 : slot === 4 ? cfg.odds.slot4 : null;
  if (!table) return { common: den, rare: 0, ultra: 0, prisma: 0, legendary: 0 };
  const better = table.legendary + table.prisma + table.ultra + table.rare;
  return { ...table, common: den - better };
}

/** The rarity a slot holds for the roll `u`: the best rarities take the lowest numbers. */
export function nexamonSlotRarity(slot: number, u: number, cfg: Config = BALANCE.nexamon): NexamonRarity {
  const odds = nexamonSlotOdds(slot, cfg);
  const n = Math.floor(clampUnit(u) * cfg.odds.denominator);
  let edge = 0;
  for (const rarity of RARITIES_BEST_FIRST) {
    edge += odds[rarity];
    if (n < edge) return rarity;
  }
  return "common";
}

/** Expected number of cards of every rarity in one pack (exact fractions of `odds.denominator`). */
export function nexamonExpectedPerPack(cfg: Config = BALANCE.nexamon): Record<NexamonRarity, number> {
  const total: Record<NexamonRarity, number> = { common: 0, rare: 0, ultra: 0, prisma: 0, legendary: 0 };
  for (let slot = 1; slot <= cfg.packSize; slot++) {
    const odds = nexamonSlotOdds(slot, cfg);
    for (const rarity of Object.keys(total) as NexamonRarity[]) total[rarity] += odds[rarity] / cfg.odds.denominator;
  }
  return total;
}

/** Condition of a pulled card for the roll `u` (worst first in `conditions.order`). */
export function nexamonRollCondition(u: number, cfg: Config = BALANCE.nexamon): NexamonCondition {
  const n = Math.floor(clampUnit(u) * 10_000);
  let edge = 0;
  for (const condition of cfg.conditions.order) {
    edge += cfg.conditions.weightBps[condition];
    if (n < edge) return condition;
  }
  return cfg.conditions.order[cfg.conditions.order.length - 1]!;
}

export interface NexamonPackCard {
  readonly key: string;
  readonly rarity: NexamonRarity;
}
export interface NexamonPull {
  /** 1..packSize. */
  slot: number;
  key: string;
  rarity: NexamonRarity;
  condition: NexamonCondition;
}

/**
 * Opens one pack of a set: `cards` are the cards of that set. Per slot: the rarity (slots 4 and 5 roll), then a
 * card of that rarity (commons never twice in a pack), then its condition.
 */
export function nexamonOpenPack(
  cards: readonly NexamonPackCard[],
  rng: () => number,
  cfg: Config = BALANCE.nexamon,
): NexamonPull[] {
  const used = new Set<string>();
  const pulls: NexamonPull[] = [];
  for (let slot = 1; slot <= cfg.packSize; slot++) {
    const rarity = slot >= 4 ? nexamonSlotRarity(slot, rng(), cfg) : "common";
    const pool = cards.filter((c) => c.rarity === rarity && !(rarity === "common" && used.has(c.key)));
    if (pool.length === 0) throw new RangeError(`nexamonOpenPack: no ${rarity} card in the set`);
    const card = pool[Math.floor(clampUnit(rng()) * pool.length)]!;
    used.add(card.key);
    pulls.push({ slot, key: card.key, rarity, condition: nexamonRollCondition(rng(), cfg) });
  }
  return pulls;
}

// ---------------------------------------------------------------------------------------------- copies

/** Value factor of a raw copy by its condition (`conditions.valueBps`). */
export function nexamonConditionBps(condition: NexamonCondition, cfg: Config = BALANCE.nexamon): number {
  return cfg.conditions.valueBps[condition] ?? 10_000;
}

/** Value factor of a copy: the grade's factor in a slab, else the condition's. */
export function nexamonCopyFactorBps(
  condition: NexamonCondition,
  grade: number | null,
  cfg: Config = BALANCE.nexamon,
): number {
  if (grade !== null) {
    if (nexamonIsBlackLabel(grade)) return cfg.grading.blackLabel.valueBps;
    return cfg.grading.valueBps[Math.min(Math.max(Math.round(grade), 1), 10) - 1]!;
  }
  return nexamonConditionBps(condition, cfg);
}

/** What a copy is worth in cents: market value x factor, rounded half to even. */
export function nexamonCopyValueCents(
  valueE4: number,
  condition: NexamonCondition,
  grade: number | null,
  cfg: Config = BALANCE.nexamon,
): number {
  return mulDivRound(valueE4, nexamonCopyFactorBps(condition, grade, cfg), 10_000 * NEXAMON_E4_PER_CENT);
}

/** The AI's asking price for a copy: its value plus 10 %. */
export function nexamonAiAskCents(copyValueCents: number, cfg: Config = BALANCE.nexamon): number {
  return Math.max(cfg.market.minPriceCents, mulDivRound(copyValueCents, cfg.ai.askBps, 10_000));
}

/** Fee a selling player pays to the households. */
export function nexamonMarketFeeCents(priceCents: number, cfg: Config = BALANCE.nexamon): number {
  return mulDivFloor(priceCents, cfg.market.feeBps, 10_000);
}

/** What the AI pays at once for a raw bulk copy; null if the rarity or a slab is not taken. */
export function nexamonQuickSellCents(
  copyValueCents: number,
  rarity: NexamonRarity,
  grade: number | null,
  cfg: Config = BALANCE.nexamon,
): number | null {
  if (grade !== null || !(cfg.quickSell.rarities as readonly string[]).includes(rarity)) return null;
  return mulDivFloor(copyValueCents, cfg.quickSell.bps, 10_000);
}

// ---------------------------------------------------------------------------------------------- grading

/** ASP's fee for grading a copy worth `copyValueCents`. */
export function nexamonGradingFeeCents(copyValueCents: number, cfg: Config = BALANCE.nexamon): number {
  return Math.max(cfg.grading.minFeeCents, mulDivRound(copyValueCents, cfg.grading.feeBps, 10_000));
}

/**
 * The Black Label (ADR-165): the tier above a 10. It is stored as grade 11 and shown as "ASP 10 Black Label".
 */
export const NEXAMON_BLACK_LABEL_GRADE = 11;
export const nexamonIsBlackLabel = (grade: number | null): boolean =>
  grade !== null && Math.round(grade) >= NEXAMON_BLACK_LABEL_GRADE;
/** The number on the label: a Black Label is a 10. */
export const nexamonGradeNumber = (grade: number): number => Math.min(Math.max(Math.round(grade), 1), 10);

/** Chance of a Black Label for a condition: `blackLabel.chanceBps` out of the chance for a 10, only for its condition. */
function blackLabelChanceBps(condition: NexamonCondition, cfg: Config): number {
  const b = cfg.grading.blackLabel;
  if (condition !== b.condition) return 0;
  return Math.min(Math.max(0, b.chanceBps), cfg.grading.gradeWeightsBps[condition][9] ?? 0);
}

/** Chance of a grade (1..10, 11 = Black Label) for a condition, in basis points. */
export function nexamonGradeChanceBps(
  condition: NexamonCondition,
  grade: number,
  cfg: Config = BALANCE.nexamon,
): number {
  const black = blackLabelChanceBps(condition, cfg);
  if (grade === NEXAMON_BLACK_LABEL_GRADE) return black;
  const weight = cfg.grading.gradeWeightsBps[condition][grade - 1] ?? 0;
  return grade === 10 ? weight - black : weight;
}

/**
 * The grade (1..10, 11 = Black Label) ASP gives a copy of this condition for the roll `u`; low grades take the low
 * numbers, the Black Label the highest ones of the 10.
 */
export function nexamonRollGrade(condition: NexamonCondition, u: number, cfg: Config = BALANCE.nexamon): number {
  const weights = cfg.grading.gradeWeightsBps[condition];
  const n = Math.floor(clampUnit(u) * 10_000);
  let edge = 0;
  for (let grade = 1; grade <= 10; grade++) {
    edge += weights[grade - 1]!;
    if (n < edge) {
      const black = grade === 10 && n >= edge - blackLabelChanceBps(condition, cfg);
      return black ? NEXAMON_BLACK_LABEL_GRADE : grade;
    }
  }
  return 10;
}

// ---------------------------------------------------------------------------------------------- market value

/** Popularity of a card in basis points (0..10 000): rarity plus a bonus for a low population. */
export function nexamonPopularityBps(rarity: NexamonRarity, population: number, cfg: Config = BALANCE.nexamon): number {
  const p = cfg.value.popularity;
  const ref = p.popRef[rarity];
  const bonus = Math.floor((p.scarceBonusBps * ref) / (ref + Math.max(0, population)));
  return Math.min(10_000, p.rarityBps[rarity] + bonus);
}

export interface NexamonBoundsInput {
  /** The catalogue's start price as a price (cents x 100). */
  readonly startE4: number;
  /** Whole days since the card's first pull (0 before). */
  readonly ageDays: number;
  /** Sales that counted for the value so far. */
  readonly countedTrades: number;
  /** The value at the start of the Berlin day (the value itself if it has not moved today). */
  readonly dayRefE4: number;
}

/** Cap factor of a card in basis points of its start price. */
export function nexamonCapBps(ageDays: number, countedTrades: number, cfg: Config = BALANCE.nexamon): number {
  const v = cfg.value;
  return Math.min(
    v.capMaxBps,
    v.capBaseBps + v.capPerDayBps * Math.max(0, Math.floor(ageDays)) + v.capPerTradeBps * Math.max(0, countedTrades),
  );
}

/** Floor and cap of a card's value and the corridor of the day. */
export function nexamonValueBounds(b: NexamonBoundsInput, cfg: Config = BALANCE.nexamon) {
  const v = cfg.value;
  return {
    floorE4: mulDivRound(b.startE4, v.floorBps, 10_000),
    capE4: mulDivRound(b.startE4, nexamonCapBps(b.ageDays, b.countedTrades, cfg), 10_000),
    dayLowE4: mulDivRound(b.dayRefE4, 10_000 - v.dayMaxFallBps, 10_000),
    dayHighE4: mulDivRound(b.dayRefE4, 10_000 + v.dayMaxRiseBps, 10_000),
  };
}

/** A value inside the day's corridor and, above all, between floor and cap. */
export function nexamonClampValue(valueE4: number, b: NexamonBoundsInput, cfg: Config = BALANCE.nexamon): number {
  const bounds = nexamonValueBounds(b, cfg);
  const inDay = Math.min(Math.max(valueE4, bounds.dayLowE4), bounds.dayHighE4);
  return Math.max(bounds.floorE4, Math.min(bounds.capE4, inDay));
}

/** The price per card of a sale: the price without the copy's condition or grade factor. */
export function nexamonPricePerCardE4(priceCents: number, factorBps: number): number {
  return mulDivRound(priceCents * NEXAMON_E4_PER_CENT, 10_000, Math.max(1, factorBps));
}

/** Whether a price per card is near enough to the value to mean anything (absurd prices are ignored). */
export function nexamonPriceIsPlausible(pricePerCardE4: number, valueE4: number, cfg: Config = BALANCE.nexamon) {
  return (
    big(Math.abs(pricePerCardE4 - valueE4)) * BPS <= big(valueE4) * big(cfg.value.trade.bandBps) && pricePerCardE4 > 0
  );
}

export interface NexamonSaleInput {
  readonly valueE4: number;
  readonly priceCents: number;
  /** nexamonCopyFactorBps of the copy sold. */
  readonly factorBps: number;
  readonly rarity: NexamonRarity;
  readonly population: number;
  /** Counted sales of this card between the same two players in the last `pairHours` (0 if an AI is involved). */
  readonly pairSales: number;
  /** Counted purchases of this card by the buyer today. */
  readonly buyerSalesToday: number;
}

/** Whether a sale moves the value: a plausible price, and not the same two players or the same buyer again. */
export function nexamonSaleCounts(s: NexamonSaleInput, cfg: Config = BALANCE.nexamon): boolean {
  const t = cfg.value.trade;
  return (
    nexamonPriceIsPlausible(nexamonPricePerCardE4(s.priceCents, s.factorBps), s.valueE4, cfg) &&
    s.pairSales < 1 &&
    s.buyerSalesToday < t.perPlayerDay
  );
}

/**
 * The value after a sale between players or from an AI seller to a player (before the bounds): part of the way to
 * the price per card, at most `maxStepBps`; upward moves scaled by popularity. Unchanged if the sale does not count.
 */
export function nexamonValueAfterSale(s: NexamonSaleInput, cfg: Config = BALANCE.nexamon): number {
  if (!nexamonSaleCounts(s, cfg)) return s.valueE4;
  const t = cfg.value.trade;
  const diff = nexamonPricePerCardE4(s.priceCents, s.factorBps) - s.valueE4;
  const maxStep = Math.max(1, mulDivFloor(s.valueE4, t.maxStepBps, 10_000));
  let step = Math.min(mulDivRound(Math.abs(diff), t.weightBps, 10_000), maxStep);
  if (diff > 0) {
    const pop = Math.max(nexamonPopularityBps(s.rarity, s.population, cfg), t.minPopularityBps);
    step = mulDivFloor(step, pop, 10_000);
  }
  return s.valueE4 + Math.sign(diff) * step;
}

/** The value after an AI collector bought a player's listing (before the bounds): up by aiBuyBumpBps x popularity. */
export function nexamonValueAfterAiBuy(
  valueE4: number,
  rarity: NexamonRarity,
  population: number,
  cfg: Config = BALANCE.nexamon,
): number {
  const pop = nexamonPopularityBps(rarity, population, cfg);
  return valueE4 + Number((big(valueE4) * big(cfg.value.aiBuyBumpBps) * big(pop)) / (BPS * BPS));
}

/** The value after one copy was dumped on the AI by instant sale (before the bounds). */
export function nexamonValueAfterQuickSell(valueE4: number, cfg: Config = BALANCE.nexamon): number {
  return valueE4 - mulDivFloor(valueE4, cfg.quickSell.dropBps, 10_000);
}

/** Demand for a card in thousandths of a copy. */
export function nexamonDemandMilli(
  rarity: NexamonRarity,
  population: number,
  recentBuys: number,
  cfg: Config = BALANCE.nexamon,
): number {
  const p = cfg.value.pressure;
  const ref = cfg.value.popularity.popRef[rarity];
  const base = Math.floor(
    (1_000 * p.want[rarity] * (ref + cfg.ai.seedCopies[rarity])) / (ref + Math.max(0, population)),
  );
  return base + p.buyWeightMilli * Math.min(Math.max(0, recentBuys), p.maxBuys);
}

export interface NexamonPressureInput {
  readonly rarity: NexamonRarity;
  readonly population: number;
  /** Copies offered at a plausible price (players and AI). */
  readonly supply: number;
  /** Copies bought in the last `pressure.buyDays` days (counted sales and AI purchases). */
  readonly recentBuys: number;
}

/** Pressure on the value in basis points, -10 000 (far too many on offer) to +10 000 (wanted and not on offer). */
export function nexamonPressureBps(i: NexamonPressureInput, cfg: Config = BALANCE.nexamon): number {
  if (i.population <= 0) return 0;
  const want = cfg.value.pressure.want[i.rarity];
  const diff = nexamonDemandMilli(i.rarity, i.population, i.recentBuys, cfg) - 1_000 * Math.max(0, i.supply);
  return Math.min(10_000, Math.max(-10_000, Math.trunc((diff * 10) / want)));
}

/** The value after one supply and demand step (before the bounds). */
export function nexamonValueAfterPressure(
  valueE4: number,
  i: NexamonPressureInput,
  cfg: Config = BALANCE.nexamon,
): number {
  const p = cfg.value.pressure;
  const pressure = nexamonPressureBps(i, cfg);
  if (pressure > 0) {
    const pop = nexamonPopularityBps(i.rarity, i.population, cfg);
    return valueE4 + Number((big(valueE4) * big(pressure) * big(p.upStepBps) * big(pop)) / (BPS * BPS * BPS));
  }
  return valueE4 - Number((big(valueE4) * big(-pressure) * big(p.downStepBps)) / (BPS * BPS));
}

// ---------------------------------------------------------------------------------------------- AI

/** The AI buys a player's listing only up to what the copy is worth (slabs: a share of it). */
export function nexamonAiWouldBuy(
  priceCents: number,
  copyValueCents: number,
  grade: number | null,
  cfg: Config = BALANCE.nexamon,
): boolean {
  const maxBps = grade === null ? cfg.ai.buyMaxBps : cfg.ai.gradedBuyMaxBps;
  return priceCents > 0 && big(priceCents) * BPS <= big(copyValueCents) * big(maxBps);
}

/** Chance per minute that an AI collector buys a fairly priced listing: higher for popular cards. */
export function nexamonAiBuyChanceBps(
  rarity: NexamonRarity,
  population: number,
  cfg: Config = BALANCE.nexamon,
): number {
  return Math.min(
    10_000,
    Math.floor((cfg.ai.buyChanceBps * (10_000 + nexamonPopularityBps(rarity, population, cfg))) / 10_000),
  );
}

/** Copies of a card the AI holds at the start: prismas only for the cheapest ones of a set, never a legendary. */
export function nexamonSeedCopies(
  rarity: NexamonRarity,
  /** 0-based rank of the card by start price among the cards of its rarity and set (ties by number). */
  priceRank: number,
  cfg: Config = BALANCE.nexamon,
): number {
  if (rarity === "prisma" && priceRank >= cfg.ai.seedPrismaCards) return 0;
  return cfg.ai.seedCopies[rarity];
}
