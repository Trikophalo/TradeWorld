/**
 * Upgrades (ADR-093): permanent improvements a player buys with game money. Every upgrade has levels; each level costs
 * `baseCostCents × costGrowth^level` (rounded to whole euros) and adds `perLevel` to its effect. The money goes back to
 * the treasury that pays the basic income (closed money system, ADR-041).
 *
 * Plain data, no imports: runs unchanged in Deno and is mirrored in Postgres (game_config.upgrades).
 */
export type UpgradeKey = "vault" | "income" | "study" | "overtime" | "rhetoric";

export interface UpgradeConfig {
  readonly maxLevel: number;
  /** Player level needed for the first purchase. */
  readonly minLevel: number;
  readonly baseCostCents: number;
  readonly costGrowth: number;
  /**
   * Effect per level:
   * - vault: hours of income the vault holds
   * - income: basic income in bps
   * - study: work hours less per branch skill point
   * - overtime: paid work hours more per day
   * - rhetoric: promotion chance in bps (AI bosses)
   */
  readonly perLevel: number;
}

export type UpgradesConfig = Readonly<Record<UpgradeKey, UpgradeConfig>> & {
  /** Display order, also the order on the upgrades page. */
  readonly order: readonly UpgradeKey[];
  /** Branch points never take fewer work hours than this, whatever the study level. */
  readonly minWorkHoursPerBranchPoint: number;
};

export const UPGRADES: UpgradesConfig = {
  order: ["vault", "income", "study", "overtime", "rhetoric"],
  // 8 h → 20 h: 3.000 €, 6.000 €, 12.000 €, 24.000 €, 48.000 €, 96.000 €
  vault: { maxLevel: 6, minLevel: 1, baseCostCents: 300_000, costGrowth: 2, perLevel: 2 },
  // Only a little (owner): +10 % per level, at most +30 %. 4.000 €, 12.000 €, 36.000 €
  income: { maxLevel: 3, minLevel: 3, baseCostCents: 400_000, costGrowth: 3, perLevel: 1_000 },
  // 6 → 3 work hours per branch point: 8.000 €, 24.000 €, 72.000 €
  study: { maxLevel: 3, minLevel: 2, baseCostCents: 800_000, costGrowth: 3, perLevel: 1 },
  // 12 → 14 paid hours a day: 20.000 €, 60.000 €
  overtime: { maxLevel: 2, minLevel: 5, baseCostCents: 2_000_000, costGrowth: 3, perLevel: 1 },
  // +5 % promotion chance per level: 10.000 €, 25.000 €, 62.500 €
  rhetoric: { maxLevel: 3, minLevel: 5, baseCostCents: 1_000_000, costGrowth: 2.5, perLevel: 500 },
  minWorkHoursPerBranchPoint: 3,
};
