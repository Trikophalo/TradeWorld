import { describe, expect, it } from "vitest";
import { companyProgress } from "./progress";

const stages = (reached: number) => Array.from({ length: 4 }, (_, i) => ({ reached: i < reached }));

describe("company progress (ADR-191)", () => {
  it("counts the growth stages first", () => {
    expect(companyProgress({ stages: stages(0), expansionLevel: 0 })).toEqual({
      stagesDone: 0,
      step: 0,
      next: { kind: "stage", n: 1 },
    });
    expect(companyProgress({ stages: stages(3), expansionLevel: 0 }).next).toEqual({ kind: "stage", n: 4 });
  });

  it("continues with the endless levels right after stage 4", () => {
    expect(companyProgress({ stages: stages(4), expansionLevel: 0 })).toEqual({
      stagesDone: 4,
      step: 4,
      next: { kind: "level", n: 1 },
    });
    expect(companyProgress({ stages: stages(4), expansionLevel: 7 })).toEqual({
      stagesDone: 4,
      step: 11,
      next: { kind: "level", n: 8 },
    });
  });

  it("keeps levels bought before the last stage and never goes down", () => {
    const p = companyProgress({ stages: stages(2), expansionLevel: 3 });
    expect(p.step).toBe(5);
    expect(p.next).toEqual({ kind: "stage", n: 3 });
    expect(companyProgress({ stages: stages(3), expansionLevel: 3 }).step).toBeGreaterThan(p.step);
    expect(companyProgress({ stages: stages(4), expansionLevel: -2 }).step).toBe(4);
  });
});
