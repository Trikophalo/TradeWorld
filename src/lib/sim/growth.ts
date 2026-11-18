/**
 * Growth harness (ADR-209): a well-run player company from the garage to the stock exchange, hour by hour with the
 * real formulas (closeStartupHour, expansion, company events, taxes), with or without the size friction of ADR-209.
 * It answers "how long to 10 Mio., 100 Mio., 1 Mrd. € company value?" (docs/BALANCING.md). Not part of the game.
 *
 * The scripted founder: full time, quality 70 %, stage 2, the suggested marketing budget, contract work on, AI workers
 * matched to demand, next legal form as soon as the cash allows (AG = IPO from 5 Mio. € value), expansion whenever
 * the cash holds 1.3 × its price and 30 days of profit pay it back, every crisis answered with the strongest strategy (steps retried until they work),
 * every chance taken, books done by hand every day (listed only). Insurance "Basis" in the friction run.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig, SectorId } from "../../config/balance.ts";
import type { CompanyEventArchetype } from "../../config/company-events.ts";
import {
  costUnitCents,
  eventModifiers,
  eventPhase,
  rollCompanyEvent,
  stepCostCents,
  stepSuccessBps,
  type Severity,
} from "./company-events.ts";
import { progressiveTaxCents } from "./listed.ts";
import { combineModifiers, eventSnapshot, frictionModifiers, sizeUnitCents } from "./macro.ts";
import { createRng } from "./rng.ts";
import {
  closeStartupHour,
  effectivePotentialCents,
  expansionCapacityFactor,
  expansionCostCents,
  fixedCostCents,
  initialStartup,
  maxEmployees,
  startupValueCents,
  type StartupState,
  type StartupTier,
} from "./startup.ts";

export interface GrowthScenario {
  readonly name: string;
  readonly sector: SectorId;
  /** Hidden niche size, cents per game year. */
  readonly potentialAnnualCents: number;
}

export interface GrowthOptions {
  /** ADR-209 on: saturation, overhead, sized events, insurance, progressive tax. */
  readonly friction: boolean;
  readonly hours: number;
  readonly seed: number;
  readonly milestonesCents?: readonly number[];
  readonly cfg?: BalanceConfig;
  /** Called after every hour (to look inside the harness). */
  readonly trace?: (hour: number, info: Readonly<Record<string, number | string>>) => void;
}

export interface GrowthResult {
  /** Hour at which each milestone was first reached, null when not within the run. */
  readonly reachedAt: readonly (number | null)[];
  readonly finalValueCents: number;
  readonly events: number;
  readonly externalEvents: number;
  readonly taxCents: number;
}

export const GROWTH_SCENARIOS: readonly GrowthScenario[] = [
  { name: "Gute Nische (Tech, 200.000 €/Jahr)", sector: "tech", potentialAnnualCents: 20_000_000 },
  { name: "Spitzen-Nische (Pharma, 10 Mio. €/Jahr)", sector: "pharma", potentialAnnualCents: 1_000_000_000 },
];

export const MILESTONES = [1_000_000_000, 10_000_000_000, 100_000_000_000] as const;

const FOUNDER_BPS = 15_000;
const QUALITY = 0.7;
const STAGE = 2;
const IPO_VALUE_CENTS = 500_000_000;

interface RunningEvent {
  archetype: CompanyEventArchetype;
  severity: Severity;
  startedAt: number;
  deadlineAt: number;
  resolvedAt: number | null;
  mitigation: number;
}

function nextTier(tier: StartupTier): StartupTier | null {
  return tier === "garage" ? "small_business" : tier === "small_business" ? "gmbh" : null;
}

function foundingCost(tier: StartupTier, cfg: BalanceConfig): number {
  if (tier === "garage") return cfg.startups.garage.foundingCostCents;
  if (tier === "gmbh") return cfg.startups.gmbh.foundingCostCents;
  return cfg.company.tiers.find((t) => t.id === "small_business")?.foundingCostCents ?? 0;
}

/** Plays the response of the founder: the strongest strategy, every failed step retried. Returns hours and cost. */
function respond(a: CompanyEventArchetype, severity: Severity, unit: number, u: () => number, cfg: BalanceConfig) {
  const working = a.strategies.filter((s) => s.steps.length > 0);
  if (working.length === 0) return null;
  const strategy = working.reduce((best, s) => (s.mitigation > best.mitigation ? s : best));
  let hours = 0;
  let cost = 0;
  for (const step of strategy.steps) {
    const bps = stepSuccessBps(step, severity, 20, cfg.companyEvents);
    let retry = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      hours += step.hours;
      cost += stepCostCents(step, unit, severity, retry, cfg.companyEvents);
      if (u() * 10_000 < bps) break;
      retry = true;
    }
  }
  return { hours, cost, mitigation: strategy.mitigation };
}

export function runGrowth(scenario: GrowthScenario, options: GrowthOptions): GrowthResult {
  const cfg = options.cfg ?? BALANCE;
  const sc = cfg.startups;
  const qh = cfg.time.quarterHours;
  const milestones = options.milestonesCents ?? MILESTONES;
  const rng = createRng(options.seed);
  const u = () => rng.next();
  const H = 3_600_000;

  let tier: StartupTier = "garage";
  let level = 0;
  let state: StartupState = {
    ...initialStartup(scenario.potentialAnnualCents, 1_000_000n, cfg.startups as typeof BALANCE.startups),
    quality: QUALITY,
  };
  let quarterProfit = 0n;
  let lastQuarterProfit = 0n;
  let dayProfit = 0;
  let quarterRevenue = 0;
  let lastQuarterRevenue = 0;
  let taxCents = 0;
  let events = 0;
  let externalEvents = 0;
  let current: RunningEvent | null = null;
  let lastEventAt: number | null = null;
  let value = 0;
  const reachedAt: (number | null)[] = milestones.map(() => null);

  for (let h = 0; h < options.hours; h++) {
    const now = h * H;
    const market = effectivePotentialCents(state.potentialAnnualCents, tier, level, sc);
    value = Number(startupValueCents(state.cashCents, lastQuarterProfit, scenario.sector, cfg));

    // the daily roll at 12 o'clock
    if (h % 24 === 12) {
      const active = current !== null && eventPhase(current.archetype, current, now) !== "over";
      const rolled = rollCompanyEvent(
        [u(), u(), u(), u()],
        {
          sector: scenario.sector,
          ageHours: h,
          hoursSinceLast: lastEventAt === null ? null : (now - lastEventAt) / H,
          hasActive: active,
          size: options.friction ? { worthCents: value } : undefined,
        },
        cfg.companyEvents,
      );
      if (rolled) {
        const fixed = fixedCostCents(tier, cfg, level);
        const unit = Math.max(
          costUnitCents(fixed, cfg.companyEvents),
          options.friction ? sizeUnitCents(value, lastQuarterRevenue / qh) : 0,
        );
        const archetype = options.friction
          ? eventSnapshot(rolled.archetype, cfg.macro.insurance.levels[1]!.coverage, 0)
          : rolled.archetype;
        const deadlineAt = now + archetype.deadlineHours * H;
        const r = respond(archetype, rolled.severity, unit, u, cfg);
        let resolvedAt: number | null = null;
        let mitigation = 0;
        if (r) {
          state = { ...state, cashCents: state.cashCents - BigInt(r.cost) };
          const done = now + r.hours * H;
          if (done < deadlineAt) {
            resolvedAt = done;
            mitigation = r.mitigation;
          } else if (archetype.polarity === "crisis") {
            mitigation = r.mitigation * 0.5; // partialCredit (game_config default)
          }
        }
        current = { archetype, severity: rolled.severity, startedAt: now, deadlineAt, resolvedAt, mitigation };
        lastEventAt = now;
        events += 1;
        if (archetype.external) externalEvents += 1;
      }
    }
    const phase = current ? eventPhase(current.archetype, current, now) : "over";
    const ev =
      current && phase !== "over"
        ? eventModifiers(current.archetype, current.severity, phase, current.mitigation, 0, cfg.companyEvents)
        : { demandFactor: 1, capacityFactor: 1, extraCostShare: 0 };
    const mods = options.friction ? combineModifiers(ev, frictionModifiers(value, 1)) : ev;

    // AI workers matched to the demand of the hour (capacity per head from the sector)
    const perHead =
      (sc.capacityCentsPerProductivity[scenario.sector] *
        (1 + sc.stages.capacityBonusPerStage * STAGE) *
        expansionCapacityFactor(level, sc)) /
      qh;
    const demandGuess = (market / 4 / qh) * state.awareness * (0.5 + 0.5 * state.quality) * mods.demandFactor * 1.2;
    const seats = Math.max(0, maxEmployees(tier, cfg, level) - 1);
    const ai = Math.min(seats, Math.max(0, Math.ceil((demandGuess - 1.5 * perHead) / perHead)));
    const marketing = BigInt(
      Math.round(
        Math.min(
          Math.max(
            sc.awareness.marketingMinHalfSaturationCents,
            (market / 4) * sc.awareness.marketingHalfSaturationShare,
          ),
          Math.max(sc.awareness.marketingMinHalfSaturationCents, 0.25 * lastQuarterRevenue),
        ),
      ),
    );
    const r = closeStartupHour(
      state,
      {
        sector: scenario.sector,
        tier,
        marketingCentsPerQuarter: marketing,
        productivityBps: [FOUNDER_BPS, ...Array<number>(ai).fill(10_000)],
        aiWorkers: ai,
        stage: STAGE,
        noise: 0,
        playerWagesCents: 0,
        contractWork: true,
        expansionLevel: level,
        event: mods,
        taskMomentum: 1.2,
      },
      cfg,
    );
    state = { ...state, awareness: r.awareness.next, cashCents: state.cashCents + r.profitCents };
    options.trace?.(h, {
      tier,
      level,
      ai,
      value,
      demand: Number(r.demandCents),
      capacity: Number(r.capacityCents),
      revenue: Number(r.revenueCents),
      profit: Number(r.profitCents),
      demandFactor: mods.demandFactor,
      extraCost: mods.extraCostShare,
    });
    quarterProfit += r.profitCents;
    quarterRevenue += Number(r.revenueCents);
    dayProfit += Number(r.profitCents);
    if ((h + 1) % qh === 0) {
      lastQuarterProfit = quarterProfit;
      lastQuarterRevenue = quarterRevenue;
      quarterRevenue = 0;
      quarterProfit = 0n;
    }
    // listed: the books every day by hand (clean receipts)
    if ((h + 1) % 24 === 0) {
      if (tier === "ag" && dayProfit > 0) {
        const rate = cfg.listed.taxes.rateBps;
        const gross = options.friction
          ? progressiveTaxCents(dayProfit, rate, 24, cfg.listed)
          : Math.floor((dayProfit * rate) / 10_000);
        const tax = gross - Math.floor((gross * cfg.listed.taxes.check.discountBps) / 10_000);
        taxCents += tax;
        state = { ...state, cashCents: state.cashCents - BigInt(tax) };
      }
      dayProfit = 0;
    }

    // growth decisions of the founder
    const next = nextTier(tier);
    const reserve = BigInt(fixedCostCents(tier, cfg, level) * 4);
    if (next) {
      const price = BigInt(Math.max(0, foundingCost(next, cfg) - foundingCost(tier, cfg) * sc.upgradeCreditShare));
      if (state.cashCents >= price + reserve) {
        state = {
          ...state,
          cashCents: state.cashCents - price,
          awareness: Math.max(state.awareness, sc.foundingAwareness[next as "small_business" | "gmbh"]),
        };
        tier = next;
      }
    } else if (tier === "gmbh" && value >= IPO_VALUE_CENTS) {
      tier = "ag";
    }
    if (tier === "gmbh" || tier === "ag") {
      const price = BigInt(expansionCostCents(level, sc));
      // a careful founder: only while the step pays back within 30 game years (days) of the current profit
      if (state.cashCents >= (price * 13n) / 10n + reserve && price <= lastQuarterProfit * 4n * 30n) {
        state = { ...state, cashCents: state.cashCents - price };
        level += 1;
      }
    }
    value = Number(startupValueCents(state.cashCents, lastQuarterProfit, scenario.sector, cfg));
    milestones.forEach((m, i) => {
      if (reachedAt[i] === null && value >= m) reachedAt[i] = h + 1;
    });
  }
  return { reachedAt, finalValueCents: value, events, externalEvents, taxCents };
}

/** Median over seeds of the hour each milestone is reached (null when not reached in most runs). */
export function medianReach(
  scenario: GrowthScenario,
  options: Omit<GrowthOptions, "seed">,
  seeds: readonly number[],
): (number | null)[] {
  const runs = seeds.map((seed) => runGrowth(scenario, { ...options, seed }));
  const n = runs[0]!.reachedAt.length;
  return Array.from({ length: n }, (_, i) => {
    const xs = runs.map((r) => r.reachedAt[i] ?? Infinity).sort((a, b) => a - b);
    const m = xs[Math.floor(xs.length / 2)]!;
    return Number.isFinite(m) ? m : null;
  });
}
