/**
 * Balancing targets for companies: "a company must pay off, but not everyone
 * may succeed". Every target is checked as a hit rate over 5 sectors x 12 seeds
 * (60 runs of 40 quarters = 10 real days each). The measured rates are listed
 * in docs/BALANCING.md section 4; the thresholds here leave a little room so
 * that small balancing changes do not break the build, big ones do.
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import type { CompanyTierId, SectorId } from "../../config/balance.ts";
import { runScenario, summarize } from "./company-scenarios.ts";
import type { Archetype, ScenarioOutcome } from "./company-scenarios.ts";

const SECTORS: readonly SectorId[] = ["tech", "retail", "energy", "pharma", "logistics"];
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const QUARTERS = 40;
const EUR = 100;

const cache = new Map<string, ScenarioOutcome[][]>();
/** All runs (sector x seed) of one line-up; each run has one outcome per company. */
function runs(tier: CompanyTierId, archetypes: readonly Archetype[]): ScenarioOutcome[][] {
  const key = `${tier}:${archetypes.join(",")}`;
  let result = cache.get(key);
  if (!result) {
    result = SECTORS.flatMap((sectorId) =>
      SEEDS.map((seed) => runScenario({ sectorId, tier, archetypes, quarters: QUARTERS, seed })),
    );
    cache.set(key, result);
  }
  return result;
}
const solo = (tier: CompanyTierId, archetype: Archetype) => runs(tier, [archetype]).map((r) => r[0] as ScenarioOutcome);
const rate = <T>(items: readonly T[], predicate: (item: T) => boolean) => items.filter(predicate).length / items.length;

const TIERS: readonly CompanyTierId[] = ["small_business", "gmbh", "ag"];
const jobIncomePerQuarter = (jobTier: "junior" | "team_lead" | "c_level") => {
  const job = BALANCE.careers.tiers.find((t) => t.id === jobTier);
  return ((job?.salaryCentsPerHour ?? 0) * BALANCE.careers.paidHoursPerDayCap) / BALANCE.time.quartersPerGameYear;
};

describe("scenario harness", () => {
  it("is deterministic", () => {
    const options = {
      sectorId: "tech" as const,
      tier: "small_business" as const,
      archetypes: ["solid", "passive"] as const,
      quarters: 12,
      seed: 7,
    };
    expect(runScenario(options)).toEqual(runScenario(options));
    expect(runScenario({ ...options, seed: 8 })).not.toEqual(runScenario(options));
  });

  it("reports one outcome per company with consistent figures", () => {
    const [solid, passive] = runScenario({
      sectorId: "retail",
      tier: "small_business",
      archetypes: ["solid", "passive"],
      quarters: 24,
      seed: 1,
    });
    expect(solid?.netIncomeCents).toHaveLength(24);
    expect(solid?.cumulativeProfitCents).toBe(solid?.netIncomeCents.reduce((a, n) => a + n, 0));
    expect(passive?.insolventAtQuarter).not.toBeNull();
    expect(passive?.netIncomeCents.length).toBe(passive?.insolventAtQuarter);
    expect(summarize([solid as ScenarioOutcome, passive as ScenarioOutcome])).toMatchObject({
      runs: 2,
      insolvencyRate: 0.5,
    });
  });
});

describe("a well-run company pays off (solid manager)", () => {
  it("never becomes insolvent and never even touches the overdraft", () => {
    for (const tier of TIERS) {
      const outcomes = solo(tier, "solid");
      expect(
        rate(outcomes, (o) => o.insolventAtQuarter === null),
        tier,
      ).toBeGreaterThanOrEqual(0.95);
      expect(
        rate(outcomes, (o) => o.firstNegativeCashQuarter === null),
        tier,
      ).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("small business: pays back the 15 000 EUR founding cost after roughly 4 real days", () => {
    const outcomes = solo("small_business", "solid");
    // Measured: 100 % between quarter 15 and 18.
    expect(
      rate(outcomes, (o) => o.paybackQuarter !== null && o.paybackQuarter >= 12 && o.paybackQuarter <= 32),
    ).toBeGreaterThanOrEqual(0.9);
    expect(
      rate(outcomes, (o) => o.paybackQuarter !== null && o.paybackQuarter >= 14 && o.paybackQuarter <= 24),
    ).toBeGreaterThanOrEqual(0.8);
  });

  it("small business: steady profit of 1 to 3 junior salaries, not a money printer", () => {
    // 8-hour day (ADR-103): 600 EUR per quarter = 2 400 EUR per real day.
    const junior = jobIncomePerQuarter("junior");
    expect(junior).toBe(600 * EUR);
    const outcomes = solo("small_business", "solid");
    // Measured: 1 190 to 1 688 EUR per quarter.
    expect(
      rate(
        outcomes,
        (o) => (o.steadyProfitCentsPerQuarter ?? 0) >= junior && (o.steadyProfitCentsPerQuarter ?? 0) <= 3 * junior,
      ),
    ).toBeGreaterThanOrEqual(0.9);
  });

  it("GmbH and AG: pay back on a similar horizon (4 to 8 real days)", () => {
    for (const tier of ["gmbh", "ag"] as const) {
      const outcomes = solo(tier, "solid");
      // Measured: GmbH quarter 15 to 29, AG quarter 14 to 24.
      expect(
        rate(outcomes, (o) => o.paybackQuarter !== null && o.paybackQuarter >= 12 && o.paybackQuarter <= 32),
        tier,
      ).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("profit grows with the tier, faster than the job income of the same level", () => {
    const steady = (tier: CompanyTierId) => summarize(solo(tier, "solid")).medianSteadyProfitCentsPerQuarter ?? 0;
    const small = steady("small_business");
    const gmbh = steady("gmbh");
    const ag = steady("ag");
    expect(gmbh).toBeGreaterThan(small * 3);
    expect(ag).toBeGreaterThan(gmbh * 3);
    // Measured multiples of the job income with the 8-hour day (ADR-103): about 2x (junior), 3.6x (team lead),
    // 10x (C-level).
    expect(gmbh / jobIncomePerQuarter("team_lead")).toBeGreaterThan(1);
    expect(gmbh / jobIncomePerQuarter("team_lead")).toBeLessThan(6);
    expect(ag / jobIncomePerQuarter("c_level")).toBeGreaterThan(2);
    expect(ag / jobIncomePerQuarter("c_level")).toBeLessThan(13);
  });
});

describe("not everyone may succeed", () => {
  it("passive founder: bleeds and is clearly unprofitable within 2 to 4 real days", () => {
    for (const tier of TIERS) {
      const outcomes = solo(tier, "passive");
      expect(
        rate(outcomes, (o) => o.cumulativeProfitCents < 0 && o.paybackQuarter === null),
        tier,
      ).toBe(1);
      // Insolvent by quarter 16, or losing money in every quarter of days 3 and 4.
      expect(
        rate(
          outcomes,
          (o) =>
            (o.insolventAtQuarter !== null && o.insolventAtQuarter <= 16) ||
            (o.midProfitCentsPerQuarter !== null && o.midProfitCentsPerQuarter < 0),
        ),
        tier,
      ).toBeGreaterThanOrEqual(0.95);
      expect(
        rate(outcomes, (o) => o.insolventAtQuarter !== null),
        tier,
      ).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("passive founder: is not ruined overnight", () => {
    for (const tier of TIERS) {
      for (const o of solo(tier, "passive")) {
        // Measured: first negative cash not before quarter 5, insolvency not before quarter 9.
        expect(o.firstNegativeCashQuarter ?? 99, `${tier} ${o.sectorId}`).toBeGreaterThanOrEqual(4);
        expect(o.insolventAtQuarter ?? 99, `${tier} ${o.sectorId}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("no company dies within a day of its first negative cash balance (grace period)", () => {
    const archetypes: Archetype[] = ["passive", "greedy", "dumper", "over_expander"];
    for (const tier of TIERS) {
      for (const archetype of archetypes) {
        for (const o of solo(tier, archetype)) {
          if (o.insolventAtQuarter === null) continue;
          const first = o.firstNegativeCashQuarter as number;
          expect(o.insolventAtQuarter - first, `${tier} ${archetype}`).toBeGreaterThanOrEqual(
            BALANCE.company.insolvency.graceQuarters,
          );
        }
      }
    }
  });

  it("greedy founder (highest price, no investment): loses the customers and the company", () => {
    for (const tier of TIERS) {
      const outcomes = solo(tier, "greedy");
      expect(
        rate(outcomes, (o) => o.cumulativeProfitCents < 0 && o.paybackQuarter === null),
        tier,
      ).toBe(1);
      expect(
        rate(outcomes, (o) => o.insolventAtQuarter !== null && o.insolventAtQuarter <= 16),
        tier,
      ).toBeGreaterThanOrEqual(0.9);
      expect(
        rate(outcomes, (o) => o.finalMarketShare < 0.05),
        tier,
      ).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("price dumper: wins market share but no margin", () => {
    for (const tier of TIERS) {
      const dumpers = solo(tier, "dumper");
      const passives = solo(tier, "passive");
      expect(
        rate(dumpers, (o) => o.cumulativeProfitCents < 0 && o.paybackQuarter === null),
        tier,
      ).toBeGreaterThanOrEqual(0.95);
      const meanShare = (outcomes: ScenarioOutcome[]) =>
        outcomes.reduce((a, o) => a + o.finalMarketShare, 0) / outcomes.length;
      expect(meanShare(dumpers), tier).toBeGreaterThan(meanShare(passives) * 2);
    }
  });

  it("over-expander: hiring to the cap at once with a huge marketing budget ruins the company", () => {
    for (const tier of TIERS) {
      const outcomes = solo(tier, "over_expander");
      expect(
        rate(outcomes, (o) => o.cumulativeProfitCents < 0 && o.paybackQuarter === null),
        tier,
      ).toBe(1);
      // Measured: 100 % insolvent for small business and GmbH, about 90 % for the AG.
      expect(
        rate(outcomes, (o) => o.insolventAtQuarter !== null),
        tier,
      ).toBeGreaterThanOrEqual(0.8);
    }
  });
});

describe("rivalry between player companies in the same market", () => {
  const MIXED: readonly Archetype[] = ["solid", "mediocre", "sloppy", "passive"];

  it("crowded niche: the best-managed company is clearly profitable, the weakest lose money", () => {
    for (const tier of TIERS) {
      const all = runs(tier, MIXED);
      const profit = (r: ScenarioOutcome[], i: number) => (r[i] as ScenarioOutcome).cumulativeProfitCents;
      // The solid founder is the best of the four and in the black.
      expect(
        rate(all, (r) => r.every((o) => o.cumulativeProfitCents <= profit(r, 0))),
        tier,
      ).toBeGreaterThanOrEqual(0.9);
      expect(
        rate(all, (r) => profit(r, 0) > 0),
        tier,
      ).toBeGreaterThanOrEqual(0.9);
      // The passive and the sloppy founder lose money, the sloppy one goes bust.
      expect(
        rate(all, (r) => profit(r, 3) < 0 && profit(r, 2) < 0),
        tier,
      ).toBeGreaterThanOrEqual(0.95);
      expect(
        rate(all, (r) => (r[2] as ScenarioOutcome).insolventAtQuarter !== null),
        tier,
      ).toBeGreaterThanOrEqual(0.9);
      // The mediocre founder does clearly worse than the solid one.
      expect(
        rate(all, (r) => profit(r, 1) < profit(r, 0) * 0.6),
        tier,
      ).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("small business in a crowded niche still pays back, but later than alone", () => {
    const crowded = runs("small_business", MIXED).map((r) => r[0] as ScenarioOutcome);
    const alone = solo("small_business", "solid");
    expect(rate(crowded, (o) => o.paybackQuarter !== null && o.paybackQuarter <= 32)).toBeGreaterThanOrEqual(0.9);
    expect(summarize(crowded).medianPaybackQuarter as number).toBeGreaterThan(
      summarize(alone).medianPaybackQuarter as number,
    );
  });

  it("a local market carries two good companies, gets tight with three and breaks with four", () => {
    const median = (n: number) =>
      summarize(
        runs(
          "small_business",
          Array.from({ length: n }, () => "solid" as const),
        ).map((r) => r[0] as ScenarioOutcome),
      );
    const one = median(1);
    const two = median(2);
    const three = median(3);
    const four = median(4);
    expect(two.profitableRate).toBeGreaterThanOrEqual(0.9);
    expect(two.medianCumulativeProfitCents).toBeLessThan(one.medianCumulativeProfitCents);
    expect(three.medianCumulativeProfitCents).toBeLessThan(two.medianCumulativeProfitCents * 0.5);
    expect(four.profitableRate).toBeLessThanOrEqual(0.1);
    expect(four.insolvencyRate).toBeGreaterThanOrEqual(0.9);
  });

  it("the same holds one tier up: two GmbHs share a regional market, four do not fit", () => {
    const of = (n: number) =>
      summarize(
        runs(
          "gmbh",
          Array.from({ length: n }, () => "solid" as const),
        ).map((r) => r[0] as ScenarioOutcome),
      );
    expect(of(2).profitableRate).toBeGreaterThanOrEqual(0.9);
    expect(of(2).medianCumulativeProfitCents).toBeLessThan(of(1).medianCumulativeProfitCents);
    expect(of(4).profitableRate).toBeLessThanOrEqual(0.1);
  });
});
