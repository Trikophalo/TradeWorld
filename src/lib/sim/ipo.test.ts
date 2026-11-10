import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  aiIpoDemandShares,
  allocateSubscription,
  resolveBookbuilding,
  suggestIpoPriceRange,
  unmetIpoRequirements,
} from "./ipo.ts";
import { createRng } from "./rng.ts";

const b = (n: number) => BigInt(n);

describe("ipo requirements", () => {
  const ready = {
    founderLevel: 25,
    founderReputation: 60,
    historyQuarters: 4,
    trailingRevenueCents: b(BALANCE.ipo.minTrailingRevenueCents),
    hasCfo: true,
    floatBps: 2500,
  };

  it("passes a ready company", () => {
    expect(unmetIpoRequirements(ready)).toEqual([]);
  });

  it("lists everything that is missing", () => {
    expect(
      unmetIpoRequirements({
        founderLevel: 24,
        founderReputation: 49,
        historyQuarters: 3,
        trailingRevenueCents: b(1),
        hasCfo: false,
        floatBps: 9000,
      }),
    ).toEqual(["level", "history", "revenue", "reputation", "cfo", "float"]);
  });
});

describe("bookbuilding", () => {
  const range = suggestIpoPriceRange(b(1_000_000)); // fair value 100 EUR

  it("suggests a range below fair value", () => {
    expect(range.midE4).toBe(b(900_000));
    expect(range.lowE4).toBe(b(765_000));
    expect(range.highE4).toBe(b(1_035_000));
    const tiny = suggestIpoPriceRange(b(1));
    expect(tiny.lowE4 >= b(1) && tiny.highE4 > tiny.lowE4).toBe(true);
  });

  it("fails when undersubscribed", () => {
    expect(resolveBookbuilding(b(1_000), [b(400), b(599)], range)).toEqual({
      status: "failed",
      coverage: 0.999,
      priceE4: null,
      allocationRatio: 0,
    });
  });

  it("prices at the low end when just covered and at the top when oversubscribed", () => {
    expect(resolveBookbuilding(b(1_000), [b(1_000)], range)).toMatchObject({
      status: "priced",
      priceE4: range.lowE4,
      allocationRatio: 1,
    });
    expect(resolveBookbuilding(b(1_000), [b(2_000)], range)).toMatchObject({
      priceE4: range.highE4,
      allocationRatio: 0.5,
    });
    expect(resolveBookbuilding(b(1_000), [b(9_000)], range).priceE4).toBe(range.highE4);
    expect(resolveBookbuilding(b(1_000), [b(1_500)], range).priceE4).toBe(b(900_000));
    expect(() => resolveBookbuilding(b(0), [], range)).toThrow(RangeError);
  });

  it("allocates pro rata without exceeding the offer", () => {
    const subscriptions = [b(700), b(900), b(1_400)];
    const total = b(3_000);
    const allocated = subscriptions.map((s) => allocateSubscription(s, b(1_000), total));
    expect(allocated).toEqual([b(233), b(300), b(466)]);
    expect(allocated.reduce((a, x) => a + x, b(0)) <= b(1_000)).toBe(true);
    expect(allocateSubscription(b(50), b(1_000), b(800))).toBe(b(50));
  });

  it("AI funds subscribe more for reputable founders and cheaper offers", () => {
    const demand = (reputation: number, fair: number, seed = 1) =>
      aiIpoDemandShares(
        { offeredShares: b(1_000_000), fairValueE4: b(fair), range, founderReputation: reputation, sentiment: 0 },
        createRng(seed),
      );
    expect(demand(90, 1_000_000) > demand(50, 1_000_000)).toBe(true);
    expect(demand(50, 1_200_000) > demand(50, 1_000_000)).toBe(true);
    expect(demand(50, 1_000_000)).toBe(demand(50, 1_000_000));
  });

  it("a solid founder usually gets the IPO done, a hyped one prices near the top", () => {
    let priced = 0;
    for (let seed = 0; seed < 200; seed++) {
      const shares = aiIpoDemandShares(
        { offeredShares: b(1_000_000), fairValueE4: b(1_000_000), range, founderReputation: 60, sentiment: 0 },
        createRng(seed),
      );
      if (resolveBookbuilding(b(1_000_000), [shares], range).status === "priced") priced++;
    }
    expect(priced).toBeGreaterThan(190);
  });
});
