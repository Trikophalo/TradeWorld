/**
 * Upgrades (ADR-093): prices and effects. The database applies the same rules (game_config.upgrades); the UI and the
 * demo use these functions.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";
import type { UpgradeKey } from "../../config/upgrades.ts";

export type UpgradeLevels = Readonly<Partial<Record<UpgradeKey, number>>>;

const levelOf = (levels: UpgradeLevels, key: UpgradeKey, cfg: BalanceConfig) =>
  Math.max(0, Math.min(cfg.upgrades[key].maxLevel, Math.floor(levels[key] ?? 0)));

/** Price of the next level, rounded to whole euros; null when the upgrade is maxed out. */
export function upgradeCostCents(key: UpgradeKey, currentLevel: number, cfg: BalanceConfig = BALANCE): number | null {
  const u = cfg.upgrades[key];
  const level = Math.max(0, Math.floor(currentLevel));
  if (level >= u.maxLevel) return null;
  return Math.round((u.baseCostCents * u.costGrowth ** level) / 100) * 100;
}

export interface UpgradeEffects {
  /** Hours of income the vault holds. */
  readonly vaultCapHours: number;
  /** Basic income factor in bps (10 000 = base). */
  readonly incomeBps: number;
  /** Work hours per branch skill point. */
  readonly workHoursPerBranchPoint: number;
  /** Paid work hours per day. */
  readonly paidHoursCap: number;
  /** Extra promotion chance with AI bosses, in bps. */
  readonly promotionBonusBps: number;
}

export function upgradeEffects(levels: UpgradeLevels, cfg: BalanceConfig = BALANCE): UpgradeEffects {
  const u = cfg.upgrades;
  return {
    vaultCapHours: cfg.economy.vaultCapHours + levelOf(levels, "vault", cfg) * u.vault.perLevel,
    incomeBps: 10_000 + levelOf(levels, "income", cfg) * u.income.perLevel,
    workHoursPerBranchPoint: Math.max(
      u.minWorkHoursPerBranchPoint,
      cfg.skills.workHoursPerBranchPoint - levelOf(levels, "study", cfg) * u.study.perLevel,
    ),
    paidHoursCap: cfg.careers.paidHoursPerDayCap + levelOf(levels, "overtime", cfg) * u.overtime.perLevel,
    promotionBonusBps: levelOf(levels, "rhetoric", cfg) * u.rhetoric.perLevel,
  };
}

/** Basic income per hour with the income upgrade, before the treasury factor. */
export function basicIncomeCentsPerHour(levels: UpgradeLevels, cfg: BalanceConfig = BALANCE): number {
  return Math.round((cfg.economy.basicIncomeCentsPerHour * upgradeEffects(levels, cfg).incomeBps) / 10_000);
}

/** The single number an upgrade changes, for "now → after" in the shop. */
export function upgradeValue(key: UpgradeKey, level: number, cfg: BalanceConfig = BALANCE): number {
  const e = upgradeEffects({ [key]: level }, cfg);
  switch (key) {
    case "vault":
      return e.vaultCapHours;
    case "income":
      return basicIncomeCentsPerHour({ income: level }, cfg);
    case "study":
      return e.workHoursPerBranchPoint;
    case "overtime":
      return e.paidHoursCap;
    case "rhetoric":
      return e.promotionBonusBps;
  }
}

export type UpgradeCheck = "ok" | "maxed" | "level" | "cash";

export function upgradeCheck(
  key: UpgradeKey,
  currentLevel: number,
  playerLevel: number,
  cashCents: number,
  cfg: BalanceConfig = BALANCE,
): UpgradeCheck {
  const cost = upgradeCostCents(key, currentLevel, cfg);
  if (cost === null) return "maxed";
  if (playerLevel < cfg.upgrades[key].minLevel) return "level";
  if (cashCents < cost) return "cash";
  return "ok";
}
