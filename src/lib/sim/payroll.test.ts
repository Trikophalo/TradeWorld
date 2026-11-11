import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { dissolve, isInsolvent, withholdIncome } from "./insolvency.ts";
import { distributeBonus, payFactorBps } from "./payroll.ts";
import { createRng } from "./rng.ts";
import {
  analystProfitCents,
  correctOption,
  customerProfitCents,
  generateWorkTask,
  gradeWorkTask,
  loanCostCents,
  workTaskKind,
} from "./work-tasks.ts";

const b = (n: number) => BigInt(n);

describe("profit-linked pay (ADR-052)", () => {
  it("pays in full when the result covers the wages", () => {
    expect(payFactorBps(b(10_000), b(10_000))).toBe(10_000);
    expect(payFactorBps(b(0), b(0))).toBe(10_000);
  });

  it("lowers the pay with a weak result, at most to the floor", () => {
    expect(payFactorBps(b(8_000), b(10_000))).toBe(8_000);
    expect(payFactorBps(b(-5_000), b(10_000))).toBe(BALANCE.jobs.profitLinkedPay.minFactor * 10_000);
  });

  it("shares a bonus by wage weight, capped, only above the wages", () => {
    const team = [
      { id: "a", baseWagesCents: b(30_000) },
      { id: "b", baseWagesCents: b(10_000) },
    ];
    expect(distributeBonus(b(40_000), b(40_000), team).size).toBe(0);
    const bonus = distributeBonus(b(140_000), b(40_000), team); // surplus 100.000, pool 20 %
    expect(bonus.get("a")).toBe(b(15_000));
    expect(bonus.get("b")).toBe(b(5_000));
    const huge = distributeBonus(b(100_000_000), b(40_000), team);
    expect(huge.get("a")).toBe(b(30_000 * BALANCE.jobs.profitLinkedPay.maxBonusFactor));
  });
});

describe("insolvency (ADR-058)", () => {
  it("company cash pays first, the rest to the founder", () => {
    const r = dissolve({
      companyCashCents: b(100_000),
      unpaidCents: b(30_000),
      severancesCents: [b(20_000)],
      founderCashCents: b(0),
    });
    expect(r).toMatchObject({
      fromCompanyCents: b(50_000),
      fromFounderCents: b(0),
      loanCents: b(0),
      toFounderCents: b(50_000),
    });
  });

  it("the founder pays what is missing, a forced loan covers the rest", () => {
    const r = dissolve({
      companyCashCents: b(0),
      unpaidCents: b(50_000),
      severancesCents: [b(30_000), b(20_000)],
      founderCashCents: b(40_000),
    });
    expect(r.totalDebtCents).toBe(b(100_000));
    expect(r.fromFounderCents).toBe(b(40_000));
    expect(r.loanCents).toBe(b(60_000));
    expect(r.toFounderCents).toBe(b(0));
  });

  it("is insolvent after the grace quarters", () => {
    const grace = BALANCE.startups.insolvency.graceQuarters;
    expect(isInsolvent(grace - 1)).toBe(false);
    expect(isInsolvent(grace)).toBe(true);
  });

  it("keeps back half of every income until the loan is repaid", () => {
    expect(withholdIncome(b(10_000), b(100_000))).toEqual({ netCents: b(5_000), repaidCents: b(5_000) });
    expect(withholdIncome(b(10_000), b(2_000))).toEqual({ netCents: b(8_000), repaidCents: b(2_000) });
    expect(withholdIncome(b(10_000), b(0))).toEqual({ netCents: b(10_000), repaidCents: b(0) });
  });
});

describe("work tasks (ADR-059)", () => {
  it("fit the job's field", () => {
    expect(workTaskKind("finance")).toBe("finance_choice");
    expect(workTaskKind("sales")).toBe("sales_pick");
    expect(workTaskKind("it")).toBe("analyst_estimate");
  });

  it("always have exactly one clear right answer", () => {
    const rng = createRng(7);
    for (const kind of ["finance_choice", "sales_pick", "analyst_estimate"] as const) {
      for (let i = 0; i < 200; i++) {
        const task = generateWorkTask(kind, rng.derive(kind, i));
        const right = correctOption(task);
        expect(right).toBeGreaterThanOrEqual(0);
        if (task.kind === "finance_choice") {
          const costs = task.params.offers.map((o) => loanCostCents(task.params.amountCents, task.params.years, o));
          expect(costs[right]).toBe(Math.min(...costs));
        } else if (task.kind === "sales_pick") {
          const profits = task.params.customers.map(customerProfitCents);
          expect(profits[right]).toBe(Math.max(...profits));
        } else {
          expect(task.params.options[right]).toBe(analystProfitCents(task.params));
          expect(new Set(task.params.options).size).toBe(4);
        }
      }
    }
  });

  it("pay 50 to 150 XP by quality", () => {
    expect(gradeWorkTask(false, 10)).toEqual({ xp: 50, bonusShare: 0 });
    expect(gradeWorkTask(true, 10)).toEqual({ xp: 150, bonusShare: 1 });
    expect(gradeWorkTask(true, 120)).toEqual({ xp: 100, bonusShare: 1 });
  });
});
