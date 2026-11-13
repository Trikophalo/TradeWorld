import { describe, expect, it } from "vitest";
import {
  campaignCostCents,
  campaignDemandFactor,
  campaignFactor,
  campaignGainPerHourCents,
  campaignLuck,
  campaignResonance,
} from "./campaigns.ts";

describe("campaign price", () => {
  it("is some hours of the last hour's demand, at least the minimum, in whole euros", () => {
    expect(campaignCostCents("flyer", 50_000)).toBe(100_000);
    expect(campaignCostCents("tv", 50_000)).toBe(900_000);
    expect(campaignCostCents("flyer", 1_000)).toBe(20_000);
    expect(campaignCostCents("online", 12_345)).toBe(74_100);
  });
});

describe("campaign effect", () => {
  it("rolls luck between the bounds", () => {
    expect(campaignLuck(0)).toBeCloseTo(0.4);
    expect(campaignLuck(0.5)).toBeCloseTo(1);
    expect(campaignLuck(2)).toBeCloseTo(1.6);
  });

  it("grows with luck and quality", () => {
    expect(campaignFactor("flyer", 1, 1)).toBeCloseTo(1.25);
    expect(campaignFactor("flyer", 0, 1)).toBeCloseTo(1.125);
    expect(campaignFactor("tv", 0.5, 1.6)).toBeCloseTo(1 + 0.7 * 1.6 * 0.75);
  });

  it("names the resonance", () => {
    expect(campaignResonance(0.5)).toBe("weak");
    expect(campaignResonance(1)).toBe("solid");
    expect(campaignResonance(1.3)).toBe("strong");
  });

  it("acts only while it runs", () => {
    const c = { kind: "flyer" as const, startedAt: 1_000, endsAt: 2_000, demandFactor: 1.2 };
    expect(campaignDemandFactor(c, 999)).toBe(1);
    expect(campaignDemandFactor(c, 1_000)).toBe(1.2);
    expect(campaignDemandFactor(c, 2_000)).toBe(1);
    expect(campaignDemandFactor(null, 1_500)).toBe(1);
  });
});

describe("campaign gain", () => {
  const base = { quality: 1, price: 1, grossMargin: 0.5 };

  it("earns the margin on extra sales where capacity is free", () => {
    // Flyer at quality 1: +25 % demand, 10.000 → 12.500, all sellable.
    expect(campaignGainPerHourCents("flyer", { ...base, demandCents: 10_000, capacityCents: 20_000 })).toBe(1_250);
  });

  it("brings nothing to a sold-out company", () => {
    expect(campaignGainPerHourCents("tv", { ...base, demandCents: 20_000, capacityCents: 10_000 })).toBe(0);
  });
});
