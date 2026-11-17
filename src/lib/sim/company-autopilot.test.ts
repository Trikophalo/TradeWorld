import { describe, expect, it } from "vitest";
import { COMPANY_TASK_RULES } from "../../config/company-tasks.ts";
import {
  autopilotChanceBps,
  autopilotExpectedCents,
  autopilotMood,
  autopilotSucceeds,
  taskPayFactorBps,
  taskRewardCents,
} from "./company-autopilot.ts";

const a = COMPANY_TASK_RULES.autopilot;

describe("autopilot (ADR-180)", () => {
  it("mood comes from the team strength, or the satisfaction of a listed company", () => {
    expect(autopilotMood(50)).toBe(0.5);
    expect(autopilotMood(50, 90)).toBe(0.9);
    expect(autopilotMood(-3)).toBe(0);
    expect(autopilotMood(140)).toBe(1);
    expect(autopilotMood(Number.NaN)).toBe(0);
  });

  it("chance: 60 % at the worst mood, 90 % at half, 120 % at the best", () => {
    expect(autopilotChanceBps(0)).toBe(a.baseChanceBps);
    expect(autopilotChanceBps(0.5)).toBe(9_000);
    expect(autopilotChanceBps(1)).toBe(a.maxChanceBps);
    expect(autopilotChanceBps(2)).toBe(a.maxChanceBps);
  });

  it("from 100 % every task succeeds, below the draw decides", () => {
    expect(autopilotSucceeds(10_000, 0.9999)).toBe(true);
    expect(autopilotSucceeds(6_000, 0.59)).toBe(true);
    expect(autopilotSucceeds(6_000, 0.6)).toBe(false);
  });

  it("pays 70 % of a perfect manual run; the chance above 100 % is a bonus; failure costs less", () => {
    expect(taskRewardCents(100_000, 10_000, "manual")).toBe(100_000);
    expect(taskRewardCents(100_000, 10_000, "autopilot", { chanceBps: 9_000 })).toBe(70_000);
    expect(taskRewardCents(100_000, 10_000, "autopilot", { chanceBps: 12_000 })).toBe(84_000);
    expect(taskRewardCents(100_000, 0, "autopilot")).toBe(-30_000);
    expect(taskRewardCents(100_000, 0, "manual")).toBe(-60_000);
    expect(taskRewardCents(100_000, 10_000, "ai")).toBe(60_000);
  });

  it("strong companies earn more per task: 0.9x at overall 0 up to 1.5x at 100", () => {
    expect(taskPayFactorBps(0)).toBe(9_000);
    expect(taskPayFactorBps(50)).toBe(12_000);
    expect(taskPayFactorBps(100)).toBe(15_000);
    expect(taskRewardCents(100_000, 10_000, "manual", { payFactorBps: 15_000 })).toBe(150_000);
    expect(taskRewardCents(100_000, 10_000, "manual", { payFactorBps: 9_000 })).toBe(90_000);
    // the founder's task_pay upgrade comes on top
    expect(taskRewardCents(100_000, 10_000, "manual", { payFactorBps: 10_000, payBonusBps: 1_000 })).toBe(110_000);
  });

  it("manual play stays worth more than the autopilot even at the best mood", () => {
    const best = autopilotExpectedCents(100_000, a.maxChanceBps, 10_000);
    expect(best).toBeLessThan(taskRewardCents(100_000, 10_000, "manual"));
    // and the autopilot never loses money on average, even at 60 %
    expect(autopilotExpectedCents(100_000, a.baseChanceBps, 10_000)).toBeGreaterThan(0);
  });
});
