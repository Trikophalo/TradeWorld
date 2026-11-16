import { describe, expect, it } from "vitest";
import { MONTH_DAYS, staffValue } from "./staff-value";

const base = {
  founder: { nickname: "Chefin", productivityBps: 20_000 },
  members: [{ id: "j1", nickname: "Max", salaryCentsPerHour: 2_000, productivityBps: 10_000 }],
  aiWorkers: 1,
  aiWageCentsPerHour: 12_000,
  aiProductivityBps: 10_000,
  teamProductivityBps: 40_000,
  hourRevenuesCents: Array.from({ length: 24 }, () => 10_000),
  paidHoursPerDay: 8,
};

describe("staff value per month", () => {
  it("splits the revenue by productivity and prices wages for 30 days", () => {
    const v = staffValue(base);
    const month = 10_000 * 24 * MONTH_DAYS;
    expect(v.contributionCents).toBe(month);
    const max = v.rows.find((r) => r.id === "j1")!;
    expect(max.contributionCents).toBe(month / 4);
    expect(max.costCents).toBe(2_000 * 8 * 30);
    expect(max.worth).toBe("yes");
    const ai = v.rows.find((r) => r.kind === "ai")!;
    expect(ai.costCents).toBe(12_000 * 24 * 30);
    expect(ai.worth).toBe("no");
    expect(v.costCents).toBe(max.costCents + ai.costCents);
  });

  it("sorts by what is left and never judges the founder", () => {
    const v = staffValue(base);
    expect(v.rows[0]!.kind).toBe("founder");
    expect(v.rows[0]!.worth).toBeNull();
    expect(v.rows.at(-1)!.kind).toBe("ai");
  });

  it("scales fewer hours to a day and judges nothing without revenue", () => {
    expect(staffValue({ ...base, hourRevenuesCents: [10_000, 10_000] }).contributionCents).toBe(
      10_000 * 24 * MONTH_DAYS,
    );
    const empty = staffValue({ ...base, hourRevenuesCents: [] });
    expect(empty.noRevenue).toBe(true);
    expect(empty.rows.every((r) => r.contributionCents === 0 && (r.kind === "founder" || r.worth === null))).toBe(true);
  });
});
