import { BALANCE } from "@/config/balance";
import type { UpgradeKey } from "@/config/upgrades";
import { upgradeCheck, upgradeCostCents, upgradeEffects, upgradeStageLevel, upgradeValue } from "@/lib/sim/upgrades";
import { vaultRateCentsPerHour } from "@/lib/sim/vault";

/*
 * What the vault yields and what would raise it (ADR-201), for the open vault. Pure: the numbers come from the
 * server's vault status, the bought upgrades and the balance config.
 */

export interface VaultYieldInput {
  /** Basic income with the upgrades, before level bonus and treasury factor. */
  readonly incomeCentsPerHour: number;
  /** Effective vault income per hour (after level bonus and treasury factor). */
  readonly rateCentsPerHour: number;
  readonly factorBps: number;
  readonly capHours: number;
  readonly level: number;
  readonly upgrades: Partial<Record<UpgradeKey, number>>;
  readonly cashCents: number;
}

export type VaultBoostKey = "level" | "income" | "vault" | "vault_xl" | "vault_interest" | "deposits";

export interface VaultBoost {
  readonly key: VaultBoostKey;
  /** More vault income per hour (level, income). */
  readonly gainCentsPerHour?: number;
  /** More hours the vault holds (vault, vault_xl). */
  readonly gainHours?: number;
  /** More interest per claim in bps (vault_interest), level bonus in bps (level). */
  readonly gainBps?: number;
  /** Price of the next stage; null for level and deposits. */
  readonly costCents: number | null;
  /** Level the next step needs, null when it is open now. */
  readonly fromLevel: number | null;
  /** Can be bought (or used) right now. */
  readonly ready: boolean;
}

/** Interest on every claim from the upgrades (the Nexamon card bonus comes on top on the server). */
export function vaultInterestBps(upgrades: Partial<Record<UpgradeKey, number>>): number {
  return upgradeEffects(upgrades).vaultInterestBps;
}

/** A day of vault income with the interest, when the player claims before the vault is full. */
export function vaultDailyCents(input: VaultYieldInput): number {
  const hours = Math.min(24, Math.max(0, input.capHours) * 2);
  return Math.round(input.rateCentsPerHour * hours * (1 + vaultInterestBps(input.upgrades) / 10_000));
}

const withFactor = (cents: number, factorBps: number) => Math.round((cents * factorBps) / 10_000);

/** The next steps that raise the vault yield, the ones open now first. */
export function vaultBoosts(input: VaultYieldInput): VaultBoost[] {
  const boosts: VaultBoost[] = [];
  const cfg = BALANCE.vault;
  const now = vaultRateCentsPerHour(input.incomeCentsPerHour, input.level);

  if (input.level < cfg.levelBonusMaxLevel) {
    boosts.push({
      key: "level",
      gainCentsPerHour: withFactor(
        vaultRateCentsPerHour(input.incomeCentsPerHour, input.level + 1) - now,
        input.factorBps,
      ),
      gainBps: cfg.levelBonusBps,
      costCents: null,
      fromLevel: input.level + 1,
      ready: false,
    });
  }

  const upgrade = (key: Exclude<VaultBoostKey, "level" | "deposits">, gain: Partial<VaultBoost>) => {
    const owned = input.upgrades[key] ?? 0;
    const cost = upgradeCostCents(key, owned);
    if (cost === null) return;
    const check = upgradeCheck(key, owned, input.level, input.cashCents);
    boosts.push({
      key,
      ...gain,
      costCents: cost,
      fromLevel: check === "level" ? upgradeStageLevel(key, owned) : null,
      ready: check === "ok",
    });
  };
  const incomeLevel = input.upgrades.income ?? 0;
  upgrade("income", {
    gainCentsPerHour: withFactor(
      vaultRateCentsPerHour(upgradeValue("income", incomeLevel + 1), input.level) - now,
      input.factorBps,
    ),
  });
  upgrade("vault", { gainHours: BALANCE.upgrades.vault.perLevel });
  upgrade("vault_xl", { gainHours: BALANCE.upgrades.vault_xl.perLevel });
  upgrade("vault_interest", { gainBps: BALANCE.upgrades.vault_interest.perLevel });

  boosts.push({
    key: "deposits",
    costCents: null,
    fromLevel: input.level < cfg.deposits.minLevel ? cfg.deposits.minLevel : null,
    ready: input.level >= cfg.deposits.minLevel,
  });

  // open now first, then by the level they need; the next level always last
  const rank = (b: VaultBoost) => (b.key === "level" ? 2 : b.fromLevel === null ? 0 : 1);
  return boosts
    .map((b, i) => ({ b, i }))
    .sort((x, y) => rank(x.b) - rank(y.b) || (x.b.fromLevel ?? 0) - (y.b.fromLevel ?? 0) || x.i - y.i)
    .map((x) => x.b);
}
