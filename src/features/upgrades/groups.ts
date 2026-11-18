import { BALANCE } from "@/config/balance";
import type { UpgradeKey } from "@/config/upgrades";
import { upgradeCheck, upgradeCostCents, upgradeStageLevel } from "@/lib/sim/upgrades";

/** What a closed group of the upgrades page says about itself (ADR-201). */
export interface UpgradeGroupSummary {
  /** Stages bought and stages there are in the group. */
  readonly bought: number;
  readonly total: number;
  /** Upgrades that can be bought right now (level reached, enough cash). */
  readonly buyable: number;
  /** Cheapest next stage the player's level already allows (cash aside); null if none. */
  readonly nextCostCents: number | null;
  /** Without such a stage: the lowest level a next stage needs; null if everything is bought. */
  readonly nextLevel: number | null;
}

export function upgradeGroupSummary(
  keys: readonly UpgradeKey[],
  levels: Partial<Record<UpgradeKey, number>>,
  playerLevel: number,
  cashCents: number,
): UpgradeGroupSummary {
  let bought = 0;
  let total = 0;
  let buyable = 0;
  let nextCostCents: number | null = null;
  let lockedLevel: number | null = null;
  for (const key of keys) {
    const level = levels[key] ?? 0;
    bought += level;
    total += BALANCE.upgrades[key].maxLevel;
    const check = upgradeCheck(key, level, playerLevel, cashCents);
    if (check === "ok") buyable += 1;
    if (check === "ok" || check === "cash") {
      const cost = upgradeCostCents(key, level)!;
      nextCostCents = nextCostCents === null ? cost : Math.min(nextCostCents, cost);
    } else if (check === "level") {
      const needed = upgradeStageLevel(key, level)!;
      lockedLevel = lockedLevel === null ? needed : Math.min(lockedLevel, needed);
    }
  }
  return { bought, total, buyable, nextCostCents, nextLevel: nextCostCents === null ? lockedLevel : null };
}
