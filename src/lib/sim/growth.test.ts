import { describe, expect, it } from "vitest";
import { GROWTH_SCENARIOS, runGrowth } from "./growth.ts";

describe("growth harness (ADR-209)", () => {
  const s = GROWTH_SCENARIOS[0]!;
  const hours = 1_500 * 24;
  const before = runGrowth(s, { friction: false, hours, seed: 1 });
  const after = runGrowth(s, { friction: true, hours, seed: 1 });

  it("the early game stays as it is", () => {
    expect(before.reachedAt[0]).not.toBeNull();
    expect(after.reachedAt[0]).toBe(before.reachedAt[0]);
  });

  it("from 100 Mio. to 1 Mrd. € takes several times longer, but is still possible", () => {
    const [, b100, b1000] = before.reachedAt;
    const [, a100, a1000] = after.reachedAt;
    expect(b1000).not.toBeNull();
    expect(a1000).not.toBeNull();
    expect((a1000! - a100!) / (b1000! - b100!)).toBeGreaterThan(2.2);
    expect(after.externalEvents).toBeGreaterThan(0);
    expect(before.externalEvents).toBe(0);
  });
});
