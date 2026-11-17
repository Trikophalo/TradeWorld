import { describe, expect, it } from "vitest";
import { companyPulse } from "./pulse";

const hour = {
  hourStart: "2026-11-17T10:00:00Z",
  revenueCents: 100_000,
  profitCents: 20_000,
  demandCents: 80_000,
  capacityCents: 100_000,
  aiWorkers: 3,
  aiWagesDueCents: 9_000,
  aiUtilizationBps: 0,
  awarenessBefore: 0.2,
  awarenessAfter: 0.212,
  awarenessParts: { wordOfMouth: 0.004, marketing: 0.01, decay: 0.004, extra: 0.002, cap: 0.7 },
};

describe("company pulse (ADR-180)", () => {
  it("is neutral without a closed hour", () => {
    const p = companyPulse(null);
    expect(p.ai).toBe("none");
    expect(p.awareness.total).toBe(0);
    expect(p.soldOut).toBe(false);
  });

  it("names idle AI workers when the demand is too small", () => {
    const p = companyPulse(hour);
    expect(p.ai).toBe("idle");
    expect(p.idleAi).toBe(3);
    expect(companyPulse({ ...hour, aiUtilizationBps: 5_000 }).ai).toBe("partly");
    expect(companyPulse({ ...hour, aiUtilizationBps: 5_000 }).idleAi).toBe(1);
    expect(companyPulse({ ...hour, aiUtilizationBps: 10_000 }).ai).toBe("busy");
    expect(companyPulse({ ...hour, aiWorkers: 0 }).ai).toBe("none");
  });

  it("splits the awareness step into points per lever", () => {
    const p = companyPulse(hour);
    expect(p.awareness.total).toBe(1.2);
    expect(p.awareness.marketing).toBe(1);
    expect(p.awareness.wordOfMouth).toBe(0.4);
    expect(p.awareness.decay).toBe(0.4);
    expect(p.awareness.extra).toBe(0.2);
    expect(p.awareness.atCap).toBe(false);
    expect(companyPulse({ ...hour, awarenessAfter: 0.7 }).awareness.atCap).toBe(true);
  });

  it("is sold out when demand is above capacity", () => {
    expect(companyPulse({ ...hour, demandCents: 120_000 }).soldOut).toBe(true);
  });
});
