import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  basicIncomeCentsPerHour,
  upgradeCheck,
  upgradeCostCents,
  upgradeEffects,
  upgradeStageLevel,
  upgradeValue,
} from "./upgrades.ts";

describe("upgrade prices", () => {
  it("grow by the factor and stop at the last level", () => {
    expect(upgradeCostCents("vault", 0)).toBe(300_000);
    expect(upgradeCostCents("vault", 1)).toBe(600_000);
    expect(upgradeCostCents("vault", 5)).toBe(9_600_000);
    expect(upgradeCostCents("vault", 6)).toBeNull();
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
    });
  });

  it("need a higher player level for every further stage (ADR-100)", () => {
    expect(upgradeStageLevel("vault", 0)).toBe(1);
    expect(upgradeStageLevel("vault", 1)).toBe(3);
    expect(upgradeStageLevel("vault", 5)).toBe(11);
    expect(upgradeStageLevel("vault", 6)).toBeNull();
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
