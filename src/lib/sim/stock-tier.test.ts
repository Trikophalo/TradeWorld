import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { nextStockTier, stockTierProgress, tierRung } from "./stock-tier.ts";

const cfg = BALANCE.trading.playerStockTiers;
const at = (tier: string) => cfg.ladder.find((r) => r.tier === tier)!.minMarketCapCents;

describe("player stock tiers (ADR-218)", () => {
  it("ladder runs penny → smallcap → midcap → largecap → bluechip with rising thresholds", () => {
    expect(cfg.ladder.map((r) => r.tier)).toEqual(["penny", "smallcap", "midcap", "largecap", "bluechip"]);
    expect(cfg.ladder[0]!.minMarketCapCents).toBe(0);
    for (let i = 1; i < cfg.ladder.length; i++) {
      expect(cfg.ladder[i]!.minMarketCapCents).toBeGreaterThan(cfg.ladder[i - 1]!.minMarketCapCents);
    }
  });

  it("climbs to the highest rung reached, also several at once", () => {
    expect(nextStockTier("penny", at("smallcap") - 1, null)).toBe("penny");
    expect(nextStockTier("penny", at("smallcap"), null)).toBe("smallcap");
    expect(nextStockTier("penny", at("largecap") + 1, null)).toBe("largecap");
    expect(nextStockTier("largecap", at("bluechip") * 10, 100)).toBe("bluechip");
  });

  it("falls back one rung only below the hysteresis line (no flapping at the threshold)", () => {
    const mid = at("midcap");
    expect(nextStockTier("midcap", mid - 1, 100)).toBe("midcap");
    expect(nextStockTier("midcap", Math.ceil((mid * cfg.downBps) / 10_000), 100)).toBe("midcap");
    expect(nextStockTier("midcap", Math.floor((mid * cfg.downBps) / 10_000) - 1, 100)).toBe("smallcap");
    // a crash falls one rung per check
    expect(nextStockTier("bluechip", 0, 100)).toBe("largecap");
    expect(nextStockTier("penny", 0, 100)).toBe("penny");
  });

  it("waits minHoursBetweenChanges after a change", () => {
    expect(nextStockTier("smallcap", at("midcap") * 2, cfg.minHoursBetweenChanges - 0.1)).toBe("smallcap");
    expect(nextStockTier("smallcap", at("midcap") * 2, cfg.minHoursBetweenChanges)).toBe("midcap");
    expect(nextStockTier("midcap", 0, 1)).toBe("midcap");
  });

  it("an unknown (null) tier is made explicit: treated as the bottom rung, not as mid cap", () => {
    expect(tierRung(null)).toBe(0);
    expect(nextStockTier(null, 0, 0)).toBe("penny");
    expect(nextStockTier(null, at("midcap"), 0)).toBe("midcap");
  });

  it("shows the way to the next rung", () => {
    const p = stockTierProgress("smallcap", (at("smallcap") + at("midcap")) / 2);
    expect(p.next).toBe("midcap");
    expect(p.nextAtCents).toBe(at("midcap"));
    expect(p.share).toBeCloseTo(0.5, 9);
    expect(p.downAtCents).toBe(Math.round((at("smallcap") * cfg.downBps) / 10_000));
    const top = stockTierProgress("bluechip", 1);
    expect(top.next).toBeNull();
    expect(top.share).toBe(1);
    expect(stockTierProgress("penny", 0).downAtCents).toBeNull();
  });

  it("a higher tier means a deeper book: less slippage, less noise, more AI interest", () => {
    const t = BALANCE.trading;
    for (let i = 1; i < cfg.ladder.length; i++) {
      const lo = cfg.ladder[i - 1]!.tier;
      const hi = cfg.ladder[i]!.tier;
      expect(t.playerImpact.depthCentsPer100Bps[hi]).toBeGreaterThan(t.playerImpact.depthCentsPer100Bps[lo]);
      expect(t.spread.halfSpreadBps[hi]).toBeLessThan(t.spread.halfSpreadBps[lo]);
      expect(BALANCE.aiInvestors.tickNoiseBps[hi]).toBeLessThan(BALANCE.aiInvestors.tickNoiseBps[lo]);
      expect(BALANCE.aiInvestors.playerWeight.referenceActivityCents[hi]).toBeGreaterThan(
        BALANCE.aiInvestors.playerWeight.referenceActivityCents[lo],
      );
    }
  });
});
