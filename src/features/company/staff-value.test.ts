import { describe, expect, it } from "vitest";
import { MONTH_DAYS, staffValue, type StaffHour } from "./staff-value";

const hour = (x: Partial<StaffHour> = {}): StaffHour => ({
  revenueCents: 10_000,
  contractRevenueCents: 0,
  strengthBonusCents: 0,
  demandCents: 20_000,
  capacityCents: 20_000,
  aiUtilizationBps: 10_000,
  aiWagesPaidCents: 12_000,
  playerWagesPaidCents: 2_000,
  ...x,
});

const base = {
  founder: { nickname: "Chefin", productivityBps: 20_000 },
  members: [{ id: "j1", nickname: "Max", salaryCentsPerHour: 2_000, productivityBps: 10_000 }],
  aiWorkers: 1,
  aiWageCentsPerHour: 12_000,
  aiProductivityBps: 10_000,
  hours: Array.from({ length: 24 }, () => hour()),
  paidHoursPerDay: 8,
};
const month = (perHour: number) => perHour * 24 * MONTH_DAYS;

describe("staff value per month (ADR-183)", () => {
  it("everyone busy: the revenue splits by productivity, costs are the wages the hours paid", () => {
    const v = staffValue(base);
    expect(v.contributionCents).toBe(month(10_000));
    const max = v.rows.find((r) => r.id === "j1")!;
    expect(max.contributionCents).toBe(month(2_500));
    expect(max.costCents).toBe(month(2_000));
    const ai = v.rows.find((r) => r.kind === "ai")!;
    expect(ai.contributionCents).toBe(month(2_500));
    expect(ai.costCents).toBe(month(12_000));
    expect(ai.worth).toBe("no");
    expect(v.aiUtilizationBps).toBe(10_000);
  });

  it("founder and players serve first: an idle AI worker brings nothing and costs the standby wage", () => {
    // capacity 20 000 of which the humans have 15 000; the demand of 12 000 never reaches the AI worker
    const v = staffValue({
      ...base,
      hours: [hour({ demandCents: 12_000, aiUtilizationBps: 0, aiWagesPaidCents: 3_000 })],
    });
    const ai = v.rows.find((r) => r.kind === "ai")!;
    expect(ai.contributionCents).toBe(0);
    expect(ai.costCents).toBe(month(3_000));
    const founder = v.rows.find((r) => r.kind === "founder")!;
    expect(founder.contributionCents).toBe(month((10_000 * 2) / 3));
    expect(v.aiUtilizationBps).toBe(0);
  });

  it("a half-busy AI worker brings its sold part; contract work goes to whoever had capacity free", () => {
    // humans 15 000, AI 5 000; demand 17 500 → AI sells 2 500 of 5 000; contract 1 000 from the AI's free 2 500
    const v = staffValue({
      ...base,
      hours: [
        hour({ revenueCents: 18_500, contractRevenueCents: 1_000, demandCents: 17_500, aiUtilizationBps: 5_000 }),
      ],
    });
    const ai = v.rows.find((r) => r.kind === "ai")!;
    expect(ai.contributionCents).toBe(month((17_500 * 2_500) / 17_500 + 1_000));
    expect(v.contributionCents).toBe(month(18_500));
    expect(v.aiUtilizationBps).toBe(5_000);
  });

  it("the strengths bonus travels with the sales", () => {
    const v = staffValue({ ...base, hours: [hour({ revenueCents: 11_000, strengthBonusCents: 1_000 })] });
    expect(v.contributionCents).toBe(month(11_000));
  });

  it("older servers without capacity: by utilization, then by productivity; full wages", () => {
    const old = { demandCents: null, capacityCents: null, aiWagesPaidCents: null, playerWagesPaidCents: null };
    const byUse = staffValue({ ...base, hours: [hour({ ...old, aiUtilizationBps: 0 })] });
    expect(byUse.rows.find((r) => r.kind === "ai")!.contributionCents).toBe(0);
    expect(byUse.rows.find((r) => r.kind === "ai")!.costCents).toBe(month(12_000));
    const byProd = staffValue({ ...base, hours: [hour({ ...old, aiUtilizationBps: null })] });
    expect(byProd.rows.find((r) => r.kind === "ai")!.contributionCents).toBe(month(2_500));
    expect(byProd.rows.find((r) => r.id === "j1")!.costCents).toBe(2_000 * 8 * MONTH_DAYS);
  });

  it("sorts by what is left and never judges the founder", () => {
    const v = staffValue(base);
    expect(v.rows[0]!.kind).toBe("founder");
    expect(v.rows[0]!.worth).toBeNull();
    expect(v.rows.at(-1)!.kind).toBe("ai");
  });

  it("scales fewer hours to a month and judges nothing without a closed hour", () => {
    expect(staffValue({ ...base, hours: [hour(), hour()] }).contributionCents).toBe(month(10_000));
    const empty = staffValue({ ...base, hours: [] });
    expect(empty.noRevenue).toBe(true);
    expect(empty.hours).toBe(0);
    expect(empty.rows.every((r) => r.contributionCents === 0 && (r.kind === "founder" || r.worth === null))).toBe(true);
  });
});
