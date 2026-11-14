import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  basicIncomeCentsPerHour,
  bonusCents,
  discountedCents,
  moveRestMs,
  shieldedMoodBps,
  upgradeCheck,
  upgradeCostCents,
  upgradeEffects,
  upgradeStageLevel,
  upgradeValue,
  withBonusCents,
  xpBonusBps,
  xpWithUpgrades,
} from "./upgrades.ts";

describe("upgrade prices", () => {
  it("grow by the factor and stop at the last level", () => {
    expect(upgradeCostCents("vault", 0)).toBe(300_000);
    expect(upgradeCostCents("vault", 1)).toBe(600_000);
    expect(upgradeCostCents("vault", 5)).toBe(9_600_000);
    expect(upgradeCostCents("vault", 6)).toBe(19_200_000);
    expect(upgradeCostCents("vault", 7)).toBe(38_400_000);
    expect(upgradeCostCents("vault", 8)).toBeNull();
    expect(upgradeCostCents("rhetoric", 2)).toBe(6_250_000);
  });

  it("are whole euros", () => {
    for (const key of BALANCE.upgrades.order) {
      for (let level = 0; level < BALANCE.upgrades[key].maxLevel; level++) {
        expect(upgradeCostCents(key, level)! % 100).toBe(0);
      }
    }
  });
});

describe("upgrade effects", () => {
  it("start at the base values", () => {
    expect(upgradeEffects({})).toEqual({
      vaultCapHours: 8,
      incomeBps: 10_000,
      workHoursPerBranchPoint: 6,
      paidHoursCap: 8,
      promotionBonusBps: 0,
      workXpBps: 10_000,
      artDiscountBps: 0,
      fixedCostDiscountBps: 0,
      propertyDiscountBps: 0,
      cryptoFeeDiscountBps: 0,
      vaultInterestBps: 0,
      dailyCashBonusBps: 0,
      wageBonusBps: 0,
      wageShieldBps: 0,
      taskPayBonusBps: 0,
      taskPenaltyDiscountBps: 0,
      aiTaskTimeDiscountBps: 0,
      aiTaskChanceBps: 0,
      moveChanceBps: 0,
      movePayoutBonusBps: 0,
      moveRestDiscountBps: 0,
      pitchChanceBps: 0,
      eventCostDiscountBps: 0,
      campaignDiscountBps: 0,
      protestChanceBps: 0,
    });
  });

  it("need a higher player level for every further stage (ADR-100)", () => {
    expect(upgradeStageLevel("vault", 0)).toBe(1);
    expect(upgradeStageLevel("vault", 1)).toBe(3);
    expect(upgradeStageLevel("vault", 5)).toBe(11);
    expect(upgradeStageLevel("vault", 7)).toBe(15);
    expect(upgradeStageLevel("vault", 8)).toBeNull();
    expect(upgradeCheck("vault", 1, 2, 9_999_999)).toBe("level");
    expect(upgradeCheck("vault", 1, 3, 9_999_999)).toBe("ok");
    expect(upgradeEffects({ makler: 2, crypto_wallet: 1 })).toMatchObject({
      propertyDiscountBps: 1_000,
      cryptoFeeDiscountBps: 2_500,
    });
  });

  it("add per level and clamp to the maximum", () => {
    const e = upgradeEffects({ vault: 3, income: 9, study: 3, overtime: 2, rhetoric: 1 });
    expect(e.vaultCapHours).toBe(14);
    expect(e.incomeBps).toBe(13_000);
    expect(e.workHoursPerBranchPoint).toBe(3);
    expect(e.paidHoursCap).toBe(10);
    expect(e.promotionBonusBps).toBe(500);
  });

  it("raise the basic income only a little", () => {
    expect(basicIncomeCentsPerHour({})).toBe(10_000);
    expect(basicIncomeCentsPerHour({ income: 1 })).toBe(11_000);
    expect(basicIncomeCentsPerHour({ income: 3 })).toBe(13_000);
  });

  it("show one number per upgrade for the shop", () => {
    expect(upgradeValue("vault", 1)).toBe(10);
    expect(upgradeValue("income", 2)).toBe(12_000);
    expect(upgradeValue("study", 1)).toBe(5);
    expect(upgradeValue("overtime", 1)).toBe(9);
    expect(upgradeValue("rhetoric", 3)).toBe(1_500);
  });
});

describe("buying", () => {
  it("needs the level, the money and a free level", () => {
    expect(upgradeCheck("vault", 0, 1, 300_000)).toBe("ok");
    expect(upgradeCheck("vault", 0, 1, 299_999)).toBe("cash");
    expect(upgradeCheck("overtime", 0, 4, 9_999_999)).toBe("level");
    expect(upgradeCheck("overtime", 2, 50, 9_999_999)).toBe("maxed");
  });
});

describe("more upgrades (ADR-134)", () => {
  const u = BALANCE.upgrades;

  it("has at least 20 new upgrades, every one in exactly one group", () => {
    expect(u.order.length).toBeGreaterThanOrEqual(30);
    expect(new Set(u.order).size).toBe(u.order.length);
    expect(u.groups.flatMap((g) => g.keys)).toEqual([...u.order]);
    for (const key of u.order) {
      const c = u[key];
      expect(c.maxLevel).toBeGreaterThanOrEqual(2);
      expect(c.costGrowth).toBeGreaterThan(1);
      expect(c.minLevel).toBeGreaterThanOrEqual(1);
      // the last stage is reachable by level 30 (ADR-100 stages, ADR-134 spread over levels 1 to 30)
      expect(c.minLevel + (c.maxLevel - 1) * c.levelStep).toBeLessThanOrEqual(30);
    }
  });

  it("make the vault bigger: vault 8 stages, vault_xl +4 h a stage", () => {
    expect(upgradeEffects({ vault: 8 }).vaultCapHours).toBe(24);
    expect(upgradeEffects({ vault: 8, vault_xl: 3 }).vaultCapHours).toBe(36);
    expect(upgradeValue("vault_xl", 1)).toBe(12);
    expect(upgradeCostCents("vault_xl", 0)).toBe(10_000_000);
    expect(upgradeStageLevel("vault_xl", 2)).toBe(26);
  });

  it("add XP per source, ambition on every source", () => {
    expect(xpBonusBps("trade", {})).toBe(0);
    expect(xpBonusBps("trade", { trader: 2 })).toBe(2_000);
    expect(xpBonusBps("mission", { trader: 2 })).toBe(0);
    expect(xpBonusBps("daily_login", { early_bird: 1 })).toBe(2_000);
    expect(xpBonusBps("streak_bonus", { early_bird: 1 })).toBe(2_000);
    expect(xpBonusBps("ipo_success", { balance_sheet: 3 })).toBe(4_500);
    expect(xpBonusBps("work_task", { teamplayer: 1, ambition: 2 })).toBe(2_500);
    expect(xpBonusBps("trade", { trader: 9 })).toBe(3_000);
    expect(xpWithUpgrades(10, "trade", { trader: 1 })).toBe(11);
    expect(xpWithUpgrades(50, "mission", { mission_hunter: 2 })).toBe(60);
  });

  it("pay bonuses and discounts rounded half even", () => {
    expect(bonusCents(10_000n, 500)).toBe(500n);
    expect(bonusCents(10n, 500)).toBe(0n);
    expect(bonusCents(30n, 500)).toBe(2n);
    expect(bonusCents(-100n, 500)).toBe(0n);
    expect(withBonusCents(10_000n, 2_500)).toBe(12_500n);
    expect(discountedCents(20_000n, 3_000)).toBe(14_000n);
    expect(discountedCents(20_000n, 12_000)).toBe(0n);
  });

  it("shorten the rest between business moves", () => {
    expect(moveRestMs(20, 2)).toBe(60 * 60_000);
    expect(moveRestMs(20, 2, 3_000)).toBe(48 * 60_000);
    expect(moveRestMs(20, 2, 10_000)).toBe(20 * 60_000);
  });

  it("shield the wage from a crisis cut", () => {
    expect(shieldedMoodBps(10_000, 7_500)).toBe(10_000);
    expect(shieldedMoodBps(7_000, 0)).toBe(7_000);
    expect(shieldedMoodBps(7_000, 7_500)).toBe(9_250);
    expect(shieldedMoodBps(7_001, 2_500)).toBe(7_751);
  });

  it("read the new effects from the levels and clamp them", () => {
    const e = upgradeEffects({
      vault_interest: 4,
      daily_bonus: 3,
      wage_bonus: 2,
      task_pay: 1,
      ai_turbo: 3,
      move_luck: 3,
      dealmaker: 2,
      move_tempo: 1,
      strategist: 2,
      crisis_manager: 3,
      ad_agency: 1,
      activist: 9,
    });
    expect(e).toMatchObject({
      vaultInterestBps: 2_000,
      dailyCashBonusBps: 7_500,
      wageBonusBps: 1_000,
      taskPayBonusBps: 1_000,
      aiTaskTimeDiscountBps: 4_500,
      moveChanceBps: 900,
      movePayoutBonusBps: 2_000,
      moveRestDiscountBps: 1_500,
      pitchChanceBps: 800,
      eventCostDiscountBps: 3_000,
      campaignDiscountBps: 1_000,
      protestChanceBps: 1_500,
    });
    expect(upgradeValue("dealmaker", 2)).toBe(2_000);
    expect(upgradeValue("wage_shield", 3)).toBe(7_500);
    expect(upgradeCheck("ambition", 0, 17, 99_999_999)).toBe("level");
    expect(upgradeCheck("ambition", 0, 18, 10_000_000)).toBe("ok");
  });
});
