/**
 * Company economy harness (ADR-180): runs typical player companies through `closeStartupHour` (and the quarter for
 * quality) with the current config and prints revenue, costs, profit per hour, what the AI workers cost and bring,
 * and awareness over time. Run: pnpm exec tsx scripts/company-harness.ts [hours]
 */
import { BALANCE } from "../src/config/balance.ts";
import type { SectorId } from "../src/config/balance.ts";
import {
  closeStartupHour,
  closeStartupQuarter,
  initialStartup,
  potentialFromUniform,
  type StartupState,
  type StartupTier,
} from "../src/lib/sim/startup.ts";

interface Scenario {
  readonly name: string;
  readonly tier: StartupTier;
  readonly sector: SectorId;
  readonly ai: number;
  readonly teamScore: number;
  readonly stage: number;
  /** Marketing budget per quarter as a multiple of the suggested one (half saturation). */
  readonly marketing: number;
  /** Solved tasks per waking hour (8..24 Uhr). */
  readonly tasksPerHour: number;
  /** Hidden market size: uniform draw (0.5 = median). */
  readonly u: number;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "Garage solo",
    tier: "garage",
    sector: "tech",
    ai: 0,
    teamScore: 8,
    stage: 0,
    marketing: 1,
    tasksPerHour: 1,
    u: 0.5,
  },
  {
    name: "Kleinunternehmen, 3 KI",
    tier: "small_business",
    sector: "retail",
    ai: 3,
    teamScore: 16,
    stage: 1,
    marketing: 1,
    tasksPerHour: 2,
    u: 0.5,
  },
  {
    name: "GmbH, 8 KI + Marketing",
    tier: "gmbh",
    sector: "logistics",
    ai: 8,
    teamScore: 30,
    stage: 2,
    marketing: 2,
    tasksPerHour: 3,
    u: 0.5,
  },
  {
    name: "AG (börsennotiert)",
    tier: "ag",
    sector: "tech",
    ai: 20,
    teamScore: 50,
    stage: 3,
    marketing: 2,
    tasksPerHour: 3,
    u: 0.5,
  },
];

const FOUNDER_BPS = 15_000;

function suggestedMarketing(potential: number, tier: StartupTier): number {
  const a = BALANCE.startups.awareness;
  const market = potential * BALANCE.startups.marketFactorByTier[tier];
  return Math.max(a.marketingMinHalfSaturationCents, (market / 4) * a.marketingHalfSaturationShare);
}

export function runScenario(s: Scenario, hours: number) {
  const potential = potentialFromUniform(s.u);
  const startTier = s.tier === "ag" ? "gmbh" : s.tier;
  let state: StartupState = initialStartup(potential, BigInt(1_000_000), BALANCE.startups, startTier);
  const marketingPerQuarter = BigInt(Math.round(suggestedMarketing(potential, s.tier) * s.marketing));
  const productivity = [FOUNDER_BPS, ...Array<number>(s.ai).fill(10_000)];
  const mom = BALANCE.companyTasks.momentum;
  let momentum = 1;
  const rows: {
    hour: number;
    revenue: number;
    costs: number;
    profit: number;
    aiWage: number;
    aiUtil: number;
    awMarketing: number;
    aiContribution: number;
    awareness: number;
  }[] = [];
  for (let h = 0; h < hours; h++) {
    const waking = h % 24 >= 8;
    momentum = Math.max(1, 1 + (momentum - 1) * (1 - mom.decayPerHourBps / 10_000));
    if (waking)
      momentum = Math.min(
        1 + mom.maxBps / 10_000,
        momentum + (s.tasksPerHour * (mom.perSolveBps + mom.perfectBonusBps)) / 10_000,
      );
    const input = {
      sector: s.sector,
      tier: s.tier,
      marketingCentsPerQuarter: marketingPerQuarter,
      productivityBps: productivity,
      aiWorkers: s.ai,
      stage: s.stage,
      noise: 0,
      playerWagesCents: 0,
      taskMomentum: momentum,
    };
    const r = closeStartupHour(state, input);
    // What the AI workers bring: the hour without them (same demand, smaller capacity).
    const solo = closeStartupHour(state, { ...input, productivityBps: [FOUNDER_BPS], aiWorkers: 0 });
    const gross = (x: typeof r) => Number(x.revenueCents - x.cogsCents);
    state = { ...state, awareness: r.awareness.next };
    rows.push({
      hour: h + 1,
      revenue: Number(r.revenueCents),
      costs: Number(r.cogsCents + r.aiWagesPaidCents + r.fixedCents + r.marketingCents),
      profit: Number(r.profitCents),
      aiWage: Number(r.aiWagesPaidCents),
      aiUtil: r.aiUtilizationBps / 100,
      awMarketing: r.awareness.marketing,
      aiContribution: gross(r) - gross(solo),
      awareness: state.awareness,
    });
    if ((h + 1) % BALANCE.time.quarterHours === 0) {
      const q = closeStartupQuarter(state, {
        sector: s.sector,
        tier: s.tier,
        marketingCents: marketingPerQuarter,
        productivityBps: productivity,
        aiWorkers: s.ai,
        teamSectorScore: s.teamScore,
        stage: s.stage,
        noise: 0,
      });
      state = { ...state, quality: q.next.quality, quartersActive: q.next.quartersActive };
    }
  }
  return { potential, marketingPerQuarter: Number(marketingPerQuarter), rows };
}

const eur = (c: number) => (c / 100).toFixed(0).padStart(7);

function main() {
  const hours = Number(process.argv[2] ?? 72);
  for (const s of SCENARIOS) {
    const { potential, marketingPerQuarter, rows } = runScenario(s, hours);
    console.log(`\n## ${s.name} (Markt ${eur(potential)} €/Jahr, Marketing ${eur(marketingPerQuarter)} €/Quartal)`);
    console.log(
      "Stunde | Umsatz €/h | Kosten €/h | Gewinn €/h | KI-Lohn €/h | KI-Beitrag €/h | KI-Auslastung | Bekanntheit | durch Marketing/h",
    );
    for (const at of [1, 6, 12, 24, 48, 72, 120, 200].filter((x) => x <= hours)) {
      const window = rows.slice(Math.max(0, at - 6), at);
      const avg = (k: keyof (typeof rows)[number]) => window.reduce((a, r) => a + r[k], 0) / window.length;
      console.log(
        `${String(at).padStart(6)} | ${eur(avg("revenue"))} | ${eur(avg("costs"))} | ${eur(avg("profit"))} | ${eur(avg("aiWage"))} | ${eur(avg("aiContribution"))} | ${avg("aiUtil").toFixed(0).padStart(5)} % | ${(rows[at - 1]!.awareness * 100).toFixed(1)} % | +${(rows[at - 1]!.awMarketing * 100).toFixed(2)}`,
      );
    }
  }
}

main();
