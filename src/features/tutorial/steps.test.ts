import { describe, expect, it } from "vitest";
import messages from "../../../messages/de.json";
import { BALANCE } from "@/config/balance";
import { levelFromTotalXp, scaledXp } from "@/lib/sim/progression";
import { TUTORIAL_STEPS, stepIndex } from "./steps";

describe("tutorial", () => {
  it("has a text for every step and no leftover texts", () => {
    expect(Object.keys(messages.tutorial.steps).sort()).toEqual(TUTORIAL_STEPS.map((step) => step.id).sort());
  });

  it("stays short", () => {
    expect(TUTORIAL_STEPS.length).toBeLessThanOrEqual(14);
    for (const text of Object.values(messages.tutorial.steps)) expect(text.length).toBeLessThanOrEqual(240);
  });

  it("asks for real actions in at least half of the steps", () => {
    const interactive = TUTORIAL_STEPS.filter((step) => step.advance.on !== "next").length;
    expect(interactive).toBeGreaterThanOrEqual(TUTORIAL_STEPS.length / 2);
  });

  it("every recovery and fallback points at an earlier step", () => {
    TUTORIAL_STEPS.forEach((step, index) => {
      if (step.recover && "step" in step.recover) expect(stepIndex(step.recover.step)).toBeLessThan(index);
      if (step.fallback) expect(stepIndex(step.fallback.step)).toBeLessThan(index);
    });
  });

  it("the reward lifts a new player exactly to level 2, as the last text promises", () => {
    expect(levelFromTotalXp(scaledXp(BALANCE.progression.xpSources.tutorial.xp))).toBe(2);
    expect(messages.tutorial.steps.done).toContain("Level 2");
  });
});
