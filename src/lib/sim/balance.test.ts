import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";
import { bondYieldBps } from "./bonds.ts";
import { aiRescueOffer, generateApplicantPool, optionPremiumE4, stepEmployeeLoyalty } from "./stubs.ts";
import { createRng } from "./rng.ts";
import { makePlayerCompany } from "./test-fixtures.ts";

describe("BALANCE", () => {
  it("is JSON-serialisable without loss (one game_config row per section)", () => {
    for (const [section, value] of Object.entries(BALANCE)) {
      expect(JSON.parse(JSON.stringify(value)), section).toEqual(value);
    }
  });

  it("contains only finite numbers, strings, booleans, arrays and plain objects", () => {
    const visit = (value: unknown, path: string): void => {
      if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
      else if (typeof value === "string" || typeof value === "boolean") return;
      else if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}[${i}]`));
      else if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) visit(v, `${path}.${k}`);
      } else throw new Error(`unsupported value at ${path}: ${String(value)}`);
    };
    visit(BALANCE, "BALANCE");
  });

  it("keeps every money and price value a safe integer", () => {
    const visit = (value: unknown, key: string): void => {
      if (typeof value === "number" && /(Cents|E4|Bps)(Per[A-Z]\w*)?$/.test(key) && !/Per\d+Bps$/.test(key)) {
        expect(Number.isSafeInteger(value), key).toBe(true);
      } else if (Array.isArray(value)) value.forEach((v) => visit(v, key));
      else if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) visit(v, k);
      }
    };
    visit(BALANCE, "BALANCE");
  });

  it("has the sections the game_config table expects", () => {
    const sections: (keyof BalanceConfig)[] = [
      "time",
      "economy",
      "trading",
      "centralBank",
      "bonds",
      "sectors",
      "company",
      "ipo",
      "reputation",
      "loans",
      "employees",
      "careers",
      "progression",
      "valuation",
      "aiInvestors",
      "index",
      "events",
      "lifestyle",
      "randomEvents",
      "abuse",
      "money",
      "richList",
      "names",
      "skills",
      "jobs",
      "dailyRewards",
      "avatars",
      "startups",
      "artworks",
      "property",
      "social",
      "companyEvents",
      "upgrades",
      "deals",
      "trust",
      "crypto",
      "stockNews",
      "companyMoves",
      "companyTasks",
      "funNews",
      "wageMood",
      "pitches",
      "protests",
    ];
    expect(Object.keys(BALANCE).sort()).toEqual([...sections].sort());
  });

  it("carries the spec values", () => {
    expect(BALANCE.economy.startingCapitalCents).toBe(1_000_000);
    expect(BALANCE.economy.bankruptcyRestartCents).toBe(250_000);
    expect(BALANCE.economy.basicIncomeCentsPerHour).toBe(10_000);
    expect(BALANCE.economy.vaultCapHours).toBe(8);
    expect(BALANCE.trading.capitalGainsTaxBps).toBe(2500);
    expect(BALANCE.trading.orderFeeCents).toBe(100);
    expect(BALANCE.centralBank.startRateBps).toBe(300);
    expect(BALANCE.company.attractiveness).toEqual({
      qualityExponent: 1.2,
      awarenessExponent: 0.8,
      priceExponent: 1.5,
    });
    expect(BALANCE.time.quarterHours * BALANCE.time.quartersPerGameYear).toBe(24);
    expect(BALANCE.progression.maxLevel).toBeGreaterThan(1000);
    expect(BALANCE.careers.paidHoursPerDayCap).toBe(8);
    expect(BALANCE.bonds.maturities.map((m) => m.years)).toEqual([1, 2, 5, 10]);
    expect(BALANCE.careers.tiers.map((t) => [t.minLevel, t.salaryCentsPerHour])).toEqual([
      [2, 15_000],
      [5, 30_000],
      [12, 70_000],
      [20, 130_000],
      [25, 250_000],
    ]);
    expect(
      BALANCE.company.tiers
        .slice(0, 3)
        .map((t) => [t.minLevel, t.foundingCostCents, t.fixedCostCentsPerQuarter, t.maxEmployees]),
    ).toEqual([
      [10, 1_500_000, 200_000, 5],
      [20, 7_500_000, 1_000_000, 20],
      [25, 30_000_000, 4_000_000, 100],
    ]);
    expect(BALANCE.lifestyle.items.map((i) => i.priceCents)).toEqual([
      2_500_000, 15_000_000, 150_000_000, 2_000_000_000, 10_000_000_000,
    ]);
  });

  it("is internally consistent", () => {
    const cb = BALANCE.centralBank;
    expect(cb.minRateBps).toBeLessThan(cb.startRateBps);
    expect(cb.startRateBps).toBeLessThan(cb.maxRateBps);
    for (const m of BALANCE.bonds.maturities) {
      const y = bondYieldBps(cb.startRateBps, m.years);
      expect(y).toBeGreaterThanOrEqual(200);
      expect(y).toBeLessThanOrEqual(400);
    }
    // Bonds must yield clearly less than the earnings yield of every sector (spec 5.1).
    for (const sector of Object.values(BALANCE.sectors)) {
      expect(10_000 / sector.peRatio).toBeGreaterThan(BALANCE.bonds.maxYieldBps * 0.85);
      expect(sector.costStructure.unitCostCents).toBeLessThan(sector.costStructure.referencePriceCents);
    }
    const capital = Object.values(BALANCE.aiInvestors.archetypes).reduce((sum, a) => sum + a.capitalShare, 0);
    expect(capital).toBeGreaterThan(0.5);
    expect(capital).toBeLessThanOrEqual(1);
    // The highest leverage must leave room above the maintenance margin.
    const maxLeverage = Math.max(...BALANCE.trading.leverageTiers.map((t) => t.maxLeverage));
    expect(10_000 / maxLeverage).toBeGreaterThan(BALANCE.trading.marginCallWarningMarginBps);
    expect(BALANCE.trading.marginCallWarningMarginBps).toBeGreaterThan(BALANCE.trading.maintenanceMarginBps);
    const levels = BALANCE.progression.unlocks.map((u) => u.level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(Math.max(...levels)).toBeLessThanOrEqual(BALANCE.progression.maxLevel);
  });
});

describe("stubs", () => {
  it("fail loudly with their milestone", () => {
    const company = makePlayerCompany("c", "tech");
    const rng = createRng(1);
    expect(() => generateApplicantPool(company, rng)).toThrow("not implemented: M4");
    expect(() =>
      stepEmployeeLoyalty(
        { loyalty: 70, traitKey: null, salaryCents: BigInt(1), marketSalaryCents: BigInt(1), quartersSinceRaise: 0 },
        rng,
      ),
    ).toThrow("not implemented: M4");
    expect(() => aiRescueOffer(company, rng)).toThrow("not implemented: M4");
    expect(() =>
      optionPremiumE4({
        kind: "call",
        spotE4: BigInt(1),
        strikeE4: BigInt(1),
        secondsToExpiry: 1,
        policyRateBps: 300,
        volatility: 0.3,
      }),
    ).toThrow("not implemented");
  });
});
