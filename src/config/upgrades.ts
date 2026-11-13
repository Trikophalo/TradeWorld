/**
 * Upgrades (ADR-093): permanent improvements a player buys with game money. Every upgrade has levels; each level costs
 * `baseCostCents × costGrowth^level` (rounded to whole euros) and adds `perLevel` to its effect. The money goes back to
 * the treasury that pays the basic income (closed money system, ADR-041).
 *
 * Plain data, no imports: runs unchanged in Deno and is mirrored in Postgres (game_config.upgrades).
 */
export type UpgradeKey =
  | "vault"
  | "income"
  | "study"
  | "overtime"
  | "rhetoric"
  | "mentor"
  | "artist"
  | "efficiency"
  | "makler"
  | "crypto_wallet";

export interface UpgradeConfig {
  readonly maxLevel: number;
  /** Player level needed for the first purchase. */
  readonly minLevel: number;
  /** Every further stage needs this many more levels (ADR-100): stage n needs minLevel + (n − 1) · levelStep. */
  readonly levelStep: number;
  readonly baseCostCents: number;
  readonly costGrowth: number;
  /**
   * Effect per level:
   * - vault: hours of income the vault holds
   * - income: basic income in bps
   * - study: work hours less per branch skill point
   * - overtime: paid work hours more per day
   * - rhetoric: promotion chance in bps (AI bosses)
   * - mentor: XP from work hours in bps
   * - artist: discount on painting an artwork in bps
   * - efficiency: less fixed costs of the own company in bps
   * - makler: discount on homes, furniture, floors and cars in bps
   * - crypto_wallet: less pool fees on crypto trades in bps
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
  order: [
    "vault",
    "income",
    "study",
    "mentor",
    "overtime",
    "rhetoric",
    "artist",
    "efficiency",
    "makler",
    "crypto_wallet",
  ],
  // 8 h → 20 h: 3.000 €, 6.000 €, 12.000 €, 24.000 €, 48.000 €, 96.000 €; levels 1, 3, 5, 7, 9, 11
  vault: { maxLevel: 6, minLevel: 1, levelStep: 2, baseCostCents: 300_000, costGrowth: 2, perLevel: 2 },
  // Only a little (owner): +10 % per level, at most +30 %. 4.000 €, 12.000 €, 36.000 €; levels 3, 7, 11
  income: { maxLevel: 3, minLevel: 3, levelStep: 4, baseCostCents: 400_000, costGrowth: 3, perLevel: 1_000 },
  // 6 → 3 work hours per branch point: 8.000 €, 24.000 €, 72.000 €; levels 2, 6, 10
  study: { maxLevel: 3, minLevel: 2, levelStep: 4, baseCostCents: 800_000, costGrowth: 3, perLevel: 1 },
  // +10 % XP from work per level: 6.000 €, 18.000 €, 54.000 €; levels 4, 8, 12
  mentor: { maxLevel: 3, minLevel: 4, levelStep: 4, baseCostCents: 600_000, costGrowth: 3, perLevel: 1_000 },
  // 8 → 10 paid hours a day: 20.000 €, 60.000 €; levels 5, 11
  overtime: { maxLevel: 2, minLevel: 5, levelStep: 6, baseCostCents: 2_000_000, costGrowth: 3, perLevel: 1 },
  // +5 % promotion chance per level: 10.000 €, 25.000 €, 62.500 €; levels 5, 10, 15
  rhetoric: { maxLevel: 3, minLevel: 5, levelStep: 5, baseCostCents: 1_000_000, costGrowth: 2.5, perLevel: 500 },
  // −10 % on painting an artwork per level: 5.000 €, 12.500 €, 31.250 €; levels 4, 7, 10
  artist: { maxLevel: 3, minLevel: 4, levelStep: 3, baseCostCents: 500_000, costGrowth: 2.5, perLevel: 1_000 },
  // −5 % fixed costs of the own company per level: 12.000 €, 30.000 €, 75.000 €; levels 6, 10, 14
  efficiency: { maxLevel: 3, minLevel: 6, levelStep: 4, baseCostCents: 1_200_000, costGrowth: 2.5, perLevel: 500 },
  // −5 % on homes, furniture, floors and cars per level: 15.000 €, 37.500 €, 93.750 €; levels 8, 12, 16
  makler: { maxLevel: 3, minLevel: 8, levelStep: 4, baseCostCents: 1_500_000, costGrowth: 2.5, perLevel: 500 },
  // −25 % crypto pool fees per level: 20.000 €, 60.000 €; levels 10, 15
  crypto_wallet: { maxLevel: 2, minLevel: 10, levelStep: 5, baseCostCents: 2_000_000, costGrowth: 3, perLevel: 2_500 },
  minWorkHoursPerBranchPoint: 3,
};
