import { describe, expect, it } from "vitest";
import { COMPANY_EVENTS } from "../../config/company-events.ts";
import { MACRO } from "../../config/macro.ts";
import { archetypeOf, eventModifiers, pickArchetype, rollCompanyEvent } from "./company-events.ts";
import {
  combineModifiers,
  countryFactor,
  effectiveCoverage,
  eventSnapshot,
  frictionModifiers,
  lobbyBonusBps,
  lobbyPoliticalFactor,
  overheadShare,
  saturationFactor,
  sizeDecades,
  sizedChancePerDay,
  sizedChanceShare,
  sizedSeverityUniform,
  sizedWeight,
  sizeUnitCents,
} from "./macro.ts";

const MIO = 100_000_000;
const external = COMPANY_EVENTS.archetypes.filter((a) => a.external);

describe("friction by size (ADR-209)", () => {
  it("leaves small companies alone", () => {
    expect(saturationFactor(10 * MIO)).toBe(1);
    expect(overheadShare(10 * MIO)).toBe(0);
    expect(frictionModifiers(1 * MIO, 0)).toEqual({ demandFactor: 1, extraCostShare: 0 });
  });

  it("saturates the demand and adds overhead above the pivot, overhead capped", () => {
    const pivot = MACRO.friction.worthPivotCents;
    expect(saturationFactor(pivot * 10)).toBeCloseTo(Math.pow(0.1, 1 - MACRO.friction.saturationExponent));
    expect(saturationFactor(pivot * 100)).toBeLessThan(saturationFactor(pivot * 10));
    expect(overheadShare(pivot * 10)).toBeCloseTo(MACRO.friction.overheadPerDecadeBps / 10_000);
    expect(overheadShare(pivot * 1e9)).toBe(MACRO.friction.overheadMaxBps / 10_000);
  });

  it("adds the insurance premium and caps all extra costs together", () => {
    expect(frictionModifiers(MIO, 2).extraCostShare).toBeCloseTo(MACRO.insurance.levels[2].premiumBps / 10_000);
    const c = combineModifiers(
      { demandFactor: 0.8, capacityFactor: 0.5, extraCostShare: 0.5 },
      { demandFactor: 0.5, extraCostShare: 0.4 },
    );
    expect(c).toEqual({ demandFactor: 0.4, capacityFactor: 0.5, extraCostShare: MACRO.maxExtraCostShare });
  });
});

describe("events scale with the company value", () => {
  it("decades, chance, crisis share and severity move only above the pivot", () => {
    expect(sizeDecades(MIO)).toBe(0);
    expect(sizeDecades(200 * MIO)).toBeCloseTo(1);
    expect(sizeDecades(1e15)).toBe(MACRO.events.maxDecades);
    expect(sizedChancePerDay(0.6, 0)).toBe(0.6);
    expect(sizedChancePerDay(0.6, 1)).toBeCloseTo(0.8);
    expect(sizedChancePerDay(0.6, 3)).toBe(MACRO.events.maxChancePerDay);
    expect(sizedChanceShare(0.4, 0)).toBe(0.4);
    expect(sizedChanceShare(0.4, 1)).toBeCloseTo(0.32);
    expect(sizedChanceShare(0.4, 10)).toBe(MACRO.events.minChanceShare);
    expect(sizedSeverityUniform(0.3, 0)).toBe(0.3);
    expect(sizedSeverityUniform(0.3, 2)).toBeGreaterThan(0.3);
  });

  it("external archetypes need size; they weigh more the bigger the company", () => {
    const quake = archetypeOf("earthquake")!;
    expect(sizedWeight(quake, undefined)).toBe(0);
    expect(sizedWeight(quake, { worthCents: 5 * MIO })).toBe(0);
    expect(sizedWeight(quake, { worthCents: 2_000 * MIO })).toBeGreaterThan(
      sizedWeight(quake, { worthCents: 20 * MIO }),
    );
    expect(sizedWeight(archetypeOf("antitrust")!, { worthCents: 100 * MIO })).toBe(0);
    expect(sizedWeight(archetypeOf("antitrust")!, { worthCents: 600 * MIO })).toBeGreaterThan(0);
    // internal ones keep their weight
    expect(sizedWeight(archetypeOf("strike")!, { worthCents: 2_000 * MIO })).toBe(archetypeOf("strike")!.weight);
  });

  it("small companies never draw an external event, the old roll stays", () => {
    for (let i = 0; i < 200; i++) {
      expect(pickArchetype(i / 200, "tech", "crisis").external).toBeFalsy();
      expect(pickArchetype(i / 200, "tech", "crisis", COMPANY_EVENTS, { worthCents: 5 * MIO }).external).toBeFalsy();
    }
    const ctx = { sector: "tech" as const, ageHours: 100, hoursSinceLast: null, hasActive: false };
    expect(rollCompanyEvent([0.7, 0.9, 0.5, 0.1], ctx)).toBeNull();
    expect(rollCompanyEvent([0.7, 0.9, 0.5, 0.1], { ...ctx, size: { worthCents: 2_000 * MIO } })).not.toBeNull();
  });

  it("a billion-euro company sees many external events (frequency scales with size)", () => {
    const share = (worth: number) => {
      let n = 0;
      for (let i = 0; i < 1_000; i++)
        if (pickArchetype(i / 1_000, "tech", "crisis", COMPANY_EVENTS, { worthCents: worth }).external) n++;
      return n / 1_000;
    };
    expect(share(30 * MIO)).toBeGreaterThan(0.2);
    expect(share(3_000 * MIO)).toBeGreaterThan(share(30 * MIO));
  });

  it("big companies pay a share of their hourly revenue per cost unit, small ones the old unit", () => {
    expect(sizeUnitCents(1_000 * MIO, 400_000)).toBe(400_000 * MACRO.events.unitRevenueHours);
    expect(sizeUnitCents(5 * MIO, 400_000)).toBe(0);
  });
});

describe("country, insurance and lobby", () => {
  const quake = archetypeOf("earthquake")!;
  it("country risk scales the matching archetypes, neutral without headquarters", () => {
    expect(countryFactor(quake, null)).toBe(1);
    expect(countryFactor(quake, { disasterRisk: ["earthquake"] })).toBe(MACRO.country.disasterListed);
    expect(countryFactor(archetypeOf("tsunami")!, { disasterRisk: ["storm"] })).toBe(MACRO.country.disasterListed);
    expect(countryFactor(quake, { disasterRisk: ["flood"] })).toBe(MACRO.country.disasterOther);
    expect(countryFactor(archetypeOf("war_conflict")!, { warRisk: 50 })).toBe(1 + MACRO.country.warBoost * 0.5);
    expect(countryFactor(archetypeOf("tariffs")!, { tariffExposure: 100 })).toBe(1 + MACRO.country.tariffBoost);
    expect(countryFactor(archetypeOf("political_decision")!, { politicalRisk: 0 })).toBe(1);
  });

  it("insurance takes its coverage of an insurable crisis; a fresh upgrade waits", () => {
    expect(effectiveCoverage(2, 0, null)).toBe(0.8);
    expect(effectiveCoverage(2, 0, 1)).toBe(0);
    expect(effectiveCoverage(2, 1, 1)).toBe(0.5);
    expect(effectiveCoverage(0, 2, 1)).toBe(0);
    const insured = eventSnapshot(quake, 0.8, 0);
    const bare = eventModifiers(quake, 2, "in_force", 0);
    const covered = eventModifiers(insured, 2, "in_force", 0);
    expect(1 - covered.capacityFactor).toBeCloseTo((1 - bare.capacityFactor) * 0.2);
    expect(covered.extraCostShare).toBeCloseTo(bare.extraCostShare * 0.2);
    // not insurable: no coverage
    expect(eventSnapshot(archetypeOf("shitstorm")!, 0.8, 0).insuredShare).toBeUndefined();
  });

  it("won lobby campaigns make lobbying easier and politics rarer", () => {
    expect(lobbyBonusBps(0)).toBe(0);
    expect(lobbyBonusBps(99)).toBe(MACRO.lobby.maxLevel * MACRO.lobby.successBpsPerLevel);
    expect(lobbyPoliticalFactor(2)).toBeCloseTo(1 - 2 * MACRO.lobby.politicalCutPerLevel);
    const pol = archetypeOf("political_decision")!;
    const snap = eventSnapshot(pol, 0, 3);
    const before = pol.strategies.find((s) => s.key === "lobby_campaign")!.steps;
    const after = snap.strategies.find((s) => s.key === "lobby_campaign")!.steps;
    after.forEach((s, i) => expect(s.baseBps).toBe(Math.min(9_500, before[i]!.baseBps + lobbyBonusBps(3))));
    expect(snap.strategies.find((s) => s.key === "comply")).toEqual(pol.strategies.find((s) => s.key === "comply"));
    expect(sizedWeight(pol, { worthCents: 200 * MIO, lobbyLevel: 3 })).toBeLessThan(
      sizedWeight(pol, { worthCents: 200 * MIO }),
    );
    // market leader of its country (ADR-208)
    expect(eventSnapshot(pol, 0, 0, MACRO, 3_000).leaderShare).toBe(0.3);
  });

  it("there are at least ten external kinds, each answerable and with a lobby campaign for politics", () => {
    expect(external.length).toBeGreaterThanOrEqual(10);
    for (const a of external) {
      expect(a.polarity).toBe("crisis");
      expect(a.minWorthCents).toBeGreaterThanOrEqual(20 * MIO);
    }
    const campaign = archetypeOf("political_decision")!.strategies.find((s) => s.key === "lobby_campaign")!;
    expect(campaign.steps.length).toBeGreaterThanOrEqual(4);
  });
});
