import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { daysToDailySkillPoint } from "./components/skill-guide";

const cycle = BALANCE.dailyRewards.cycle.map((c, i) => ({ day: i + 1, ...c }));

describe("daily reward skill points (ADR-095)", () => {
  it("counts the days to the next day with a point", () => {
    // Day 4 and day 7 carry a point.
    expect(daysToDailySkillPoint({ day: 4, claimable: true, cycle })).toBe(0);
    expect(daysToDailySkillPoint({ day: 1, claimable: true, cycle })).toBe(3);
    expect(daysToDailySkillPoint({ day: 4, claimable: false, cycle })).toBe(3);
    expect(daysToDailySkillPoint({ day: 7, claimable: false, cycle })).toBe(4);
    expect(daysToDailySkillPoint({ day: 6, claimable: false, cycle })).toBe(1);
  });

  it("is null without a cycle", () => {
    expect(daysToDailySkillPoint({ day: 1, claimable: true, cycle: [] })).toBeNull();
  });
});
