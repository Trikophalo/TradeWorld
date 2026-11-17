/**
 * Nexamon collectible cards (ADR-165): pack contents, card conditions, grading, the value of a copy and the supply
 * and demand model behind every card's market value. The database runs the same rules in PL/pgSQL
 * (supabase/migrations/20261204005200_nexamon.sql); the demo and the UI use these.
 *
 * Units: a card's market value is a price, euros x 10 000 (`*E4`); money is cents. A price becomes money once,
 * rounded half to even (ADR-003). Randomness is passed in (`u` uniform in [0, 1), or `rng` returning such numbers).
 */
import { BALANCE } from "../../config/balance.ts";
import type { NexamonCondition, NexamonTierPackRule } from "../../config/nexamon-rules.ts";
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
  if (!table) return { common: den, rare: 0, ultra: 0, prisma: 0, legendary: 0, one_of_one: 0 };
  const better = table.legendary + table.prisma + table.ultra + table.rare;
  return { ...table, common: den - better, one_of_one: 0 };
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
  const total: Record<NexamonRarity, number> = { common: 0, rare: 0, ultra: 0, prisma: 0, legendary: 0, one_of_one: 0 };
  for (let slot = 1; slot <= cfg.packSize; slot++) {
    const odds = nexamonSlotOdds(slot, cfg);
    for (const rarity of Object.keys(total) as NexamonRarity[]) total[rarity] += odds[rarity] / cfg.odds.denominator;
  }
  return total;
}

/** Chance per pack of a One of One while at least one of the set is still out there (ADR-174): 1 / packs. */
export const nexamonOneOfOneChance = (cfg: Config = BALANCE.nexamon): number => 1 / cfg.oneOfOne.packs;

/** Whether the roll `u` hits the One of One chance of slot `oneOfOne.slot`. */
export const nexamonOneOfOneHit = (u: number, cfg: Config = BALANCE.nexamon): boolean =>
  Math.floor(clampUnit(u) * cfg.oneOfOne.packs) === 0;

/** Whether the AI may pull, hold or buy cards of this rarity (ADR-174: never a One of One). */
export const nexamonAiAllowed = (rarity: NexamonRarity, cfg: Config = BALANCE.nexamon): boolean =>
  !(cfg.ai.excludedRarities as readonly string[]).includes(rarity);

/** Whether a rarity's value moves only by trades between players (no supply-and-demand step, no AI buys). */
export const nexamonTradeOnly = (rarity: NexamonRarity, cfg: Config = BALANCE.nexamon): boolean =>
  (cfg.value.tradeOnlyRarities as readonly string[]).includes(rarity);

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

export interface NexamonPackOptions {
  /**
   * One of Ones of the set nobody has pulled yet (ADR-174). Only a player's pack passes them; empty or missing
   * means the One of One roll is skipped (an AI pack, a set without One of Ones, all three gone).
   */
  readonly freeOneOfOnes?: readonly string[];
  /** The set's own pack composition (`packRules[set]`); missing: the slot table `odds`. */
  readonly rule?: NexamonTierPackRule | null;
}

/** The pack rule of a set: its entry in `packRules`, or null for the slot table. */
export function nexamonPackRule(set: string, cfg: Config = BALANCE.nexamon): NexamonTierPackRule | null {
  return (cfg.packRules as Readonly<Record<string, NexamonTierPackRule>>)[set] ?? null;
}

/**
 * The rarity of every slot under a tier rule: each tier, best first, appears with 1 / packs and then takes min..max
 * slots from the back; the rest is the base rarity. Two rolls per tier (hit, then count).
 */
export function nexamonTierRarities(
  rule: NexamonTierPackRule,
  rng: () => number,
  cfg: Config = BALANCE.nexamon,
): string[] {
  const slots: string[] = Array.from({ length: cfg.packSize }, () => rule.base);
  let free = cfg.packSize;
  for (const tier of rule.tiers) {
    const hit = Math.floor(clampUnit(rng()) * Math.max(1, tier.packs)) === 0;
    const span = Math.max(0, tier.max - tier.min);
    const count = tier.min + Math.floor(clampUnit(rng()) * (span + 1));
    if (!hit) continue;
    for (let i = 0; i < count && free > 0; i++) slots[--free] = tier.rarity;
  }
  return slots;
}

/** Chance per pack that a tier of a tier rule shows up, and how many cards it brings on average. */
export function nexamonTierOdds(
  rule: NexamonTierPackRule,
): { rarity: string; perPack: number; min: number; max: number }[] {
  return rule.tiers.map((t) => ({ rarity: t.rarity, perPack: 1 / Math.max(1, t.packs), min: t.min, max: t.max }));
}

/**
 * Opens one pack of a set: `cards` are the cards of that set. Per slot: the rarity (slots 4 and 5 roll), then a
 * card of that rarity (commons never twice in a pack), then its condition. With free One of Ones, slot
 * `oneOfOne.slot` first rolls 1 in `oneOfOne.packs` for one of them (picked uniformly among the free ones).
 */
export function nexamonOpenPack(
  cards: readonly NexamonPackCard[],
  rng: () => number,
  cfg: Config = BALANCE.nexamon,
  opts: NexamonPackOptions = {},
): NexamonPull[] {
  const used = new Set<string>();
  const pulls: NexamonPull[] = [];
  const free = opts.freeOneOfOnes ?? [];
  const tiers = opts.rule ? nexamonTierRarities(opts.rule, rng, cfg) : null;
  const base = opts.rule?.base ?? "common";
  for (let slot = 1; slot <= cfg.packSize; slot++) {
    if (slot === cfg.oneOfOne.slot && free.length > 0 && nexamonOneOfOneHit(rng(), cfg)) {
      const key = free[Math.floor(clampUnit(rng()) * free.length)]!;
      used.add(key);
      pulls.push({ slot, key, rarity: "one_of_one", condition: nexamonRollCondition(rng(), cfg) });
      continue;
    }
    const rarity = tiers
      ? (tiers[slot - 1] as NexamonRarity)
      : slot >= 4
        ? nexamonSlotRarity(slot, rng(), cfg)
        : "common";
    const pool = cards.filter((c) => c.rarity === rarity && !(rarity === base && used.has(c.key)));
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
    return cfg.grading.valueBps[nexamonGradeIndex(grade, cfg)]!;
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

/** The bulk rarities of a set (ADR-174): `quickSell.setRarities[set]`, else `quickSell.rarities`. */
export function nexamonBulkRarities(set: string | null, cfg: Config = BALANCE.nexamon): readonly string[] {
  const own = set ? (cfg.quickSell.setRarities as Readonly<Record<string, readonly string[]>>)[set] : undefined;
  return own ?? (cfg.quickSell.rarities as readonly string[]);
}

/** Whether a copy is bulk: raw and of a bulk rarity of its set. */
export const nexamonIsBulk = (
  rarity: NexamonRarity,
  grade: number | null,
  set: string | null = null,
  cfg: Config = BALANCE.nexamon,
): boolean => grade === null && nexamonBulkRarities(set, cfg).includes(rarity);

/** What the game pays at once for a raw bulk copy (value minus the bulk fee); null if it is not bulk. */
export function nexamonQuickSellCents(
  copyValueCents: number,
  rarity: NexamonRarity,
  grade: number | null,
  cfg: Config = BALANCE.nexamon,
  set: string | null = null,
): number | null {
  if (!nexamonIsBulk(rarity, grade, set, cfg)) return null;
  return mulDivFloor(copyValueCents, cfg.quickSell.bps, 10_000);
}

/** A bulk sale of several copies: their value, the fee and the payout (each copy rounded down, like the server). */
export function nexamonBulkPayout(
  copyValuesCents: readonly number[],
  cfg: Config = BALANCE.nexamon,
): { valueCents: number; feeCents: number; payoutCents: number } {
  const valueCents = copyValuesCents.reduce((a, b) => a + b, 0);
  const payoutCents = copyValuesCents.reduce((a, v) => a + mulDivFloor(v, cfg.quickSell.bps, 10_000), 0);
  return { valueCents, feeCents: valueCents - payoutCents, payoutCents };
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
  grade !== null && grade >= NEXAMON_BLACK_LABEL_GRADE - 0.25;

/** The grades ASP gives, worst first (1 to 8, 8.5, 9, 9.5, 10), without the Black Label. */
export const nexamonGrades = (cfg: Config = BALANCE.nexamon): readonly number[] => cfg.grading.grades;

/** Position of a grade in `grading.grades`: the nearest grade ASP gives (a Black Label counts as a 10). */
export function nexamonGradeIndex(grade: number, cfg: Config = BALANCE.nexamon): number {
  const grades = cfg.grading.grades;
  const g = Number.isFinite(grade) ? grade : 1;
  let best = 0;
  for (let i = 1; i < grades.length; i++) {
    if (Math.abs(grades[i]! - g) <= Math.abs(grades[best]! - g)) best = i;
  }
  return best;
}

/** The number on the label: a grade ASP gives (8.5 and 9.5 included); a Black Label is a 10. */
export const nexamonGradeNumber = (grade: number, cfg: Config = BALANCE.nexamon): number =>
  cfg.grading.grades[nexamonGradeIndex(grade, cfg)]!;

/** Chance of a Black Label for a condition: `blackLabel.chanceBps` out of the chance for a 10, only for its condition. */
function blackLabelChanceBps(condition: NexamonCondition, cfg: Config): number {
  const chance = (cfg.grading.blackLabel.chanceBps as Partial<Record<NexamonCondition, number>>)[condition] ?? 0;
  const weights = cfg.grading.gradeWeightsBps[condition];
  return Math.min(Math.max(0, chance), weights[weights.length - 1] ?? 0);
}

/** Chance of a grade (1..10 with 8.5 and 9.5, 11 = Black Label) for a condition, in basis points. */
export function nexamonGradeChanceBps(
  condition: NexamonCondition,
  grade: number,
  cfg: Config = BALANCE.nexamon,
): number {
  const black = blackLabelChanceBps(condition, cfg);
  if (grade === NEXAMON_BLACK_LABEL_GRADE) return black;
  const i = cfg.grading.grades.indexOf(grade as never);
  if (i < 0) return 0;
  const weight = cfg.grading.gradeWeightsBps[condition][i] ?? 0;
  return i === cfg.grading.grades.length - 1 ? weight - black : weight;
}

/**
 * The grade (1..10 with 8.5 and 9.5, 11 = Black Label) ASP gives a copy of this condition for the roll `u`; low
 * grades take the low numbers, the Black Label the highest ones of the 10.
 */
export function nexamonRollGrade(condition: NexamonCondition, u: number, cfg: Config = BALANCE.nexamon): number {
  const grades = cfg.grading.grades;
  const weights = cfg.grading.gradeWeightsBps[condition];
  const n = Math.floor(clampUnit(u) * 10_000);
  const top = grades.length - 1;
  let edge = 0;
  for (let i = 0; i <= top; i++) {
    edge += weights[i] ?? 0;
    if (n < edge) {
      const black = i === top && n >= edge - blackLabelChanceBps(condition, cfg);
      return black ? NEXAMON_BLACK_LABEL_GRADE : grades[i]!;
    }
  }
  return grades[top]!;
}

/**
 * What grading a copy of this condition gives back on average, as a factor of the card's market value in basis
 * points (the grade factors weighted by their chances, Black Label included; without ASP's fee).
 */
export function nexamonExpectedGradeFactorBps(condition: NexamonCondition, cfg: Config = BALANCE.nexamon): number {
  let sum = nexamonGradeChanceBps(condition, NEXAMON_BLACK_LABEL_GRADE, cfg) * cfg.grading.blackLabel.valueBps;
  for (const grade of cfg.grading.grades) {
    sum += nexamonGradeChanceBps(condition, grade, cfg) * nexamonCopyFactorBps(condition, grade, cfg);
  }
  return sum / 10_000;
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
  if (i.population <= 0 || nexamonTradeOnly(i.rarity, cfg)) return 0;
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

/** The premium AI collectors pay above a copy's value, in basis points: by condition, in a slab by grade. */
export function nexamonAiPremiumBps(
  condition: NexamonCondition,
  grade: number | null,
  cfg: Config = BALANCE.nexamon,
): number {
  if (grade === null) return cfg.ai.premiumBps[condition] ?? 0;
  if (nexamonIsBlackLabel(grade)) return cfg.ai.blackLabelPremiumBps;
  return cfg.ai.gradePremiumBps[nexamonGradeIndex(grade, cfg)] ?? 0;
}

/** The most an AI collector pays for a copy: its value x (1 + premium), rounded down. */
export function nexamonAiMaxPriceCents(
  copyValueCents: number,
  condition: NexamonCondition,
  grade: number | null,
  cfg: Config = BALANCE.nexamon,
): number {
  return mulDivFloor(copyValueCents, 10_000 + nexamonAiPremiumBps(condition, grade, cfg), 10_000);
}

/**
 * Chance per minute that an AI collector buys a player's listing, in basis points: certain (10 000) at or below the
 * copy's value; above it `buyChanceBps` x (1 + popularity), falling linearly to `atMaxChanceBps` of that at the
 * most the AI pays (nexamonAiMaxPriceCents); 0 above that or for a price of 0.
 */
export function nexamonAiBuyChanceBps(
  i: {
    priceCents: number;
    copyValueCents: number;
    condition: NexamonCondition;
    grade: number | null;
    rarity: NexamonRarity;
    population: number;
  },
  cfg: Config = BALANCE.nexamon,
): number {
  if (!nexamonAiAllowed(i.rarity, cfg)) return 0;
  const full = Math.min(
    10_000,
    Math.floor((cfg.ai.buyChanceBps * (10_000 + nexamonPopularityBps(i.rarity, i.population, cfg))) / 10_000),
  );
  if (i.priceCents <= 0) return 0;
  if (i.priceCents <= i.copyValueCents) return 10_000;
  const max = nexamonAiMaxPriceCents(i.copyValueCents, i.condition, i.grade, cfg);
  if (i.priceCents > max) return 0;
  // linear from the full chance at the value to atMaxChanceBps of it at the maximum
  const share =
    10_000 - mulDivFloor(10_000 - cfg.ai.atMaxChanceBps, i.priceCents - i.copyValueCents, max - i.copyValueCents);
  return mulDivFloor(full, share, 10_000);
}

/**
 * Whether an AI buy moves the card's value: its price per card (price / factor) lies within `value.trade.bandBps`
 * of the value, and fewer than `ai.buysPerCardWindow` counted AI buys of the card happened in `ai.buyWindowDays`.
 */
export function nexamonAiBuyCounts(
  i: { priceCents: number; factorBps: number; valueE4: number; rarity: NexamonRarity; countedInWindow: number },
  cfg: Config = BALANCE.nexamon,
): boolean {
  if (!nexamonAiAllowed(i.rarity, cfg) || i.countedInWindow >= cfg.ai.buysPerCardWindow[i.rarity]) return false;
  const norm = nexamonPricePerCardE4(i.priceCents, i.factorBps);
  return norm > 0 && Math.abs(norm - i.valueE4) * 10_000 <= i.valueE4 * cfg.value.trade.bandBps;
}

/** Minutes until an AI collector buys, on average, at a chance per minute (null: never). */
export function nexamonAiExpectedMinutes(chanceBps: number): number | null {
  if (chanceBps <= 0) return null;
  return Math.max(1, Math.round(10_000 / chanceBps));
}

/** Copies of a card the AI holds at the start: prismas only for the cheapest ones of a set, never a legendary. */
export function nexamonSeedCopies(
  rarity: NexamonRarity,
  /** 0-based rank of the card by start price among the cards of its rarity and set (ties by number). */
  priceRank: number,
  cfg: Config = BALANCE.nexamon,
): number {
  if (!nexamonAiAllowed(rarity, cfg)) return 0;
  if (rarity === "prisma" && priceRank >= cfg.ai.seedPrismaCards) return 0;
  return cfg.ai.seedCopies[rarity];
}
