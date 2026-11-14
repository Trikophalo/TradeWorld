/**
 * Upgrades (ADR-093, ADR-100, ADR-134): prices and effects. The database applies the same rules
 * (game_config.upgrades); the UI and the demo use these functions.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";
import type { UpgradeKey, UpgradeXpSource } from "../../config/upgrades.ts";
import { applyBps } from "./money.ts";

export type UpgradeLevels = Readonly<Partial<Record<UpgradeKey, number>>>;

const levelOf = (levels: UpgradeLevels, key: UpgradeKey, cfg: BalanceConfig) =>
  Math.max(0, Math.min(cfg.upgrades[key].maxLevel, Math.floor(levels[key] ?? 0)));

/** level × perLevel, clamped to 0..10 000 (bonuses and discounts in bps). */
const bpsOf = (levels: UpgradeLevels, key: UpgradeKey, cfg: BalanceConfig) =>
  Math.max(0, Math.min(10_000, Math.round(levelOf(levels, key, cfg) * cfg.upgrades[key].perLevel)));

/** Price of the next level, rounded to whole euros; null when the upgrade is maxed out. */
export function upgradeCostCents(key: UpgradeKey, currentLevel: number, cfg: BalanceConfig = BALANCE): number | null {
  const u = cfg.upgrades[key];
  const level = Math.max(0, Math.floor(currentLevel));
  if (level >= u.maxLevel) return null;
  return Math.round((u.baseCostCents * u.costGrowth ** level) / 100) * 100;
}

export interface UpgradeEffects {
  /** Hours of income the vault holds (vault and vault_xl). */
  readonly vaultCapHours: number;
  /** Basic income factor in bps (10 000 = base). */
  readonly incomeBps: number;
  /** Work hours per branch skill point. */
  readonly workHoursPerBranchPoint: number;
  /** Paid work hours per day. */
  readonly paidHoursCap: number;
  /** Extra promotion chance with AI bosses, in bps. */
  readonly promotionBonusBps: number;
  /** XP from work hours, in bps (10 000 = base). */
  readonly workXpBps: number;
  /** Discounts in bps: painting artworks, company fixed costs, property, crypto pool fees. */
  readonly artDiscountBps: number;
  readonly fixedCostDiscountBps: number;
  readonly propertyDiscountBps: number;
  readonly cryptoFeeDiscountBps: number;
  /** ADR-134, all in bps: extra money on a vault claim, on the daily reward cash and on every wage payment. */
  readonly vaultInterestBps: number;
  readonly dailyCashBonusBps: number;
  readonly wageBonusBps: number;
  /** Share of the crisis wage cut (ADR-131) the player keeps anyway. */
  readonly wageShieldBps: number;
  /** Company tasks: more pay, less penalty, faster and surer AI workers. */
  readonly taskPayBonusBps: number;
  readonly taskPenaltyDiscountBps: number;
  readonly aiTaskTimeDiscountBps: number;
  readonly aiTaskChanceBps: number;
  /** Business moves: chance, payout of cash moves, shorter rest. */
  readonly moveChanceBps: number;
  readonly movePayoutBonusBps: number;
  readonly moveRestDiscountBps: number;
  /** Own strategies (ADR-132), crisis and chance steps, marketing campaigns, campaigns against companies. */
  readonly pitchChanceBps: number;
  readonly eventCostDiscountBps: number;
  readonly campaignDiscountBps: number;
  readonly protestChanceBps: number;
}

export function upgradeEffects(levels: UpgradeLevels, cfg: BalanceConfig = BALANCE): UpgradeEffects {
  const u = cfg.upgrades;
  const bps = (key: UpgradeKey) => bpsOf(levels, key, cfg);
  return {
    vaultCapHours:
      cfg.economy.vaultCapHours +
      levelOf(levels, "vault", cfg) * u.vault.perLevel +
      levelOf(levels, "vault_xl", cfg) * u.vault_xl.perLevel,
    incomeBps: 10_000 + levelOf(levels, "income", cfg) * u.income.perLevel,
    workHoursPerBranchPoint: Math.max(
      u.minWorkHoursPerBranchPoint,
      cfg.skills.workHoursPerBranchPoint - levelOf(levels, "study", cfg) * u.study.perLevel,
    ),
    paidHoursCap: cfg.careers.paidHoursPerDayCap + levelOf(levels, "overtime", cfg) * u.overtime.perLevel,
    promotionBonusBps: levelOf(levels, "rhetoric", cfg) * u.rhetoric.perLevel,
    workXpBps: 10_000 + levelOf(levels, "mentor", cfg) * u.mentor.perLevel,
    artDiscountBps: levelOf(levels, "artist", cfg) * u.artist.perLevel,
    fixedCostDiscountBps: levelOf(levels, "efficiency", cfg) * u.efficiency.perLevel,
    propertyDiscountBps: levelOf(levels, "makler", cfg) * u.makler.perLevel,
    cryptoFeeDiscountBps: levelOf(levels, "crypto_wallet", cfg) * u.crypto_wallet.perLevel,
    vaultInterestBps: bps("vault_interest"),
    dailyCashBonusBps: bps("daily_bonus"),
    wageBonusBps: bps("wage_bonus"),
    wageShieldBps: bps("wage_shield"),
    taskPayBonusBps: bps("task_pay"),
    taskPenaltyDiscountBps: bps("task_safety"),
    aiTaskTimeDiscountBps: bps("ai_turbo"),
    aiTaskChanceBps: bps("ai_precision"),
    moveChanceBps: bps("move_luck"),
    movePayoutBonusBps: bps("dealmaker"),
    moveRestDiscountBps: bps("move_tempo"),
    pitchChanceBps: bps("strategist"),
    eventCostDiscountBps: bps("crisis_manager"),
    campaignDiscountBps: bps("ad_agency"),
    protestChanceBps: bps("activist"),
  };
}

/** Basic income per hour with the income upgrade, before the treasury factor. */
export function basicIncomeCentsPerHour(levels: UpgradeLevels, cfg: BalanceConfig = BALANCE): number {
  return Math.round((cfg.economy.basicIncomeCentsPerHour * upgradeEffects(levels, cfg).incomeBps) / 10_000);
}

/**
 * Extra XP of one source in bps (ADR-134): the sum of level × perLevel of every upgrade whose `xpSources` names the
 * source or "*". The database adds the same in grant_xp().
 */
export function xpBonusBps(source: UpgradeXpSource, levels: UpgradeLevels, cfg: BalanceConfig = BALANCE): number {
  let sum = 0;
  for (const key of cfg.upgrades.order) {
    const sources = cfg.upgrades[key].xpSources;
    if (sources && (sources.includes(source) || sources.includes("*"))) sum += bpsOf(levels, key, cfg);
  }
  return sum;
}

/** Base XP with the XP upgrades, before the global XP multiplier (fractions stay, grant_xp rounds once). */
export function xpWithUpgrades(
  baseXp: number,
  source: UpgradeXpSource,
  levels: UpgradeLevels,
  cfg: BalanceConfig = BALANCE,
): number {
  return (baseXp * (10_000 + xpBonusBps(source, levels, cfg))) / 10_000;
}

/** An amount plus `bps` of it, the bonus rounded half even (apply_bps in the database). */
export function withBonusCents(amountCents: bigint, bps: number): bigint {
  return amountCents + bonusCents(amountCents, bps);
}

/** `bps` of an amount, rounded half even; 0 for nothing or a negative amount. */
export function bonusCents(amountCents: bigint, bps: number): bigint {
  if (amountCents <= 0n || bps <= 0) return 0n;
  return applyBps(amountCents, Math.round(bps));
}

/** An amount minus `bps` of it (discounts), never below 0. */
export function discountedCents(amountCents: bigint, bps: number): bigint {
  const off = bonusCents(amountCents, Math.min(10_000, bps));
  return amountCents - off > 0n ? amountCents - off : 0n;
}

/** Wage factor of a crisis (ADR-131) with the wage shield: the cut below 10 000 shrinks by `shieldBps`. */
export function shieldedMoodBps(moodBps: number, shieldBps: number): number {
  const cut = Math.max(0, 10_000 - moodBps);
  return 10_000 - Math.floor((cut * (10_000 - Math.max(0, Math.min(10_000, shieldBps)))) / 10_000);
}

/**
 * Time from the start of a business move until it can run again (ADR-127): its minutes plus minutes × cooldownFactor
 * of rest; move_tempo (ADR-134) takes `tempoBps` off the rest (company_move_rest in the database).
 */
export function moveRestMs(minutes: number, cooldownFactor: number, tempoBps = 0): number {
  const tempo = Math.max(0, Math.min(10_000, tempoBps));
  return Math.round(minutes * 60_000 * (1 + (cooldownFactor * (10_000 - tempo)) / 10_000));
}

/** The single number an upgrade changes, for "now → after" in the shop. */
export function upgradeValue(key: UpgradeKey, level: number, cfg: BalanceConfig = BALANCE): number {
  const levels: UpgradeLevels = { [key]: level };
  const e = upgradeEffects(levels, cfg);
  switch (key) {
    case "vault":
    case "vault_xl":
      return e.vaultCapHours;
    case "income":
      return basicIncomeCentsPerHour({ income: level }, cfg);
    case "study":
      return e.workHoursPerBranchPoint;
    case "overtime":
      return e.paidHoursCap;
    case "rhetoric":
      return e.promotionBonusBps;
    case "mentor":
      return e.workXpBps - 10_000;
    case "artist":
      return e.artDiscountBps;
    case "efficiency":
      return e.fixedCostDiscountBps;
    case "makler":
      return e.propertyDiscountBps;
    case "crypto_wallet":
      return e.cryptoFeeDiscountBps;
    default:
      // ADR-134: every other upgrade is a bonus or discount in bps
      return bpsOf(levels, key, cfg);
  }
}

/** Player level the next stage needs (ADR-100): minLevel + stages bought · levelStep; null when maxed out. */
export function upgradeStageLevel(key: UpgradeKey, currentLevel: number, cfg: BalanceConfig = BALANCE): number | null {
  const u = cfg.upgrades[key];
  const level = Math.max(0, Math.floor(currentLevel));
  if (level >= u.maxLevel) return null;
  return u.minLevel + level * u.levelStep;
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
  if (playerLevel < (upgradeStageLevel(key, currentLevel, cfg) ?? 0)) return "level";
  if (cashCents < cost) return "cash";
  return "ok";
}
