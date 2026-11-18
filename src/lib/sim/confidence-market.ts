/**
 * Market harness for ADR-216: a whole small market (AI and player stocks) on the real tick engine, minute by minute,
 * with the AI companies' quarterly business, ordinary stock news (ADR-119), the market forces (ADR-214) and players
 * who buy and chase the trend. `model: "before"` is the market as of ADR-214 (AI business grows with the full sector
 * growth, no confidence); `model: "after"` adds investor confidence, market mood and cyclical AI growth (ADR-216).
 * Pure: randomness only from the seed. Used by scripts/investor-confidence-harness.ts and the tests.
 */
import { BALANCE } from "../../config/balance.ts";
import type { SectorId, SizeClass } from "../../config/balance.ts";
import { INVESTOR_CONFIDENCE } from "../../config/investor-confidence.ts";
import type { MoodPhase } from "../../config/investor-confidence.ts";
import { bondYieldBps } from "./bonds.ts";
import { COMPANY_EVENTS } from "../../config/company-events.ts";
import {
  addBump,
  aiGrowthPerGameYear,
  confidenceTarget,
  decayEvents,
  earningsBump,
  incidentBump,
  incidentChancePerHour,
  incidentSeverity,
  moveBump,
  phaseMinutes,
  stateFactors,
  stepChatter,
  stepConfidence,
  stepMood,
  volatilityOf,
  type ConfidenceFactors,
  type MoodState,
} from "./investor-confidence.ts";
import { initialArchetypeStates } from "./investors.ts";
import {
  forceChancePerHour,
  forceMoveBps,
  forceSentimentDelta,
  perMinute,
  pickForce,
  stockHeat,
} from "./market-forces.ts";
import { legacyCompanyValue, nextAnchor, playerCompanyValue, playerFairValueE4 } from "./player-valuation.ts";
import { createRng } from "./rng.ts";
import { stepMarketTick } from "./tick.ts";
import type { MarketState, PlayerFlow, SecurityState, TickShock } from "./types.ts";

export interface HarnessStock {
  readonly id: string;
  readonly kind: "ai" | "player";
  readonly sector: SectorId;
  readonly size: SizeClass;
  readonly priceE4: number;
  readonly freeFloat: number;
  /** Player companies: fair value growth per quarter (company success). */
  readonly fairGrowthPerQuarter?: number;
  /** Player buying (cents per hour) that ignores the price, and that chases the trend. */
  readonly steadyBuyCentsPerHour?: number;
  readonly chaseBuyCentsPerHour?: number;
  /**
   * A real player company behind the stock (ADR-217): its hourly profit, cash and spending decide the fair value
   * (instead of fairGrowthPerQuarter). The start price is the fair value of the chosen valuation.
   */
  readonly company?: HarnessCompany;
}

/** Economics of a player company in the harness (ADR-217). */
export interface HarnessCompany {
  /** Operating profit per hour at the start (cents) and its growth per day, fading with growthTauDays. */
  readonly profitCentsPerHour: number;
  readonly growthPerDay: number;
  readonly growthTauDays: number;
  /** Hourly noise of the profit (log σ) and a slow random walk of the business per hour (log σ). */
  readonly hourNoise: number;
  readonly walkPerHour: number;
  readonly cashCents: number;
  /** Share of the profit the automatic CEO payout takes (ADR-086); the rest stays as cash. */
  readonly payoutShare: number;
  /** Once a day the founder invests this share of the cash; it pays back over paybackDays as more profit. */
  readonly investShareDaily?: number;
  readonly paybackDays?: number;
}

export interface MarketOptions {
  /** Fair value of player companies: legacy = company value at the quarter close, earnings = ADR-217. */
  readonly valuation?: "legacy" | "earnings";
}

export interface MarketRun {
  readonly ids: readonly string[];
  readonly kinds: readonly ("ai" | "player")[];
  /** Hourly closes per stock and hourly fair values (index = hour). */
  readonly prices: number[][];
  readonly fairs: number[][];
  readonly confidence: number[][];
  /** Cap-weighted index of the AI stocks per hour (1 = start). */
  readonly index: number[];
  readonly mood: number[];
  readonly phases: MoodPhase[];
  /** Stock incidents drawn per stock. */
  readonly incidents: number[];
  /** Player companies with a business (ADR-217): hourly profit level per stock (empty for the others). */
  readonly profits?: number[][];
}

/** An open stock incident in the harness: the founder works through `steps` (70 % success each, retried). */
interface OpenIncident {
  readonly severity: number;
  readonly deadline: number;
  readonly endsAt: number;
  readonly responds: boolean;
  stepsLeft: number;
  nextStepAt: number;
  solved: boolean;
  lost: boolean;
}

export const HARNESS_STOCKS: readonly HarnessStock[] = [
  { id: "T1", kind: "ai", sector: "tech", size: "bluechip", priceE4: 1_500_000, freeFloat: 40_000_000 },
  { id: "T2", kind: "ai", sector: "tech", size: "midcap", priceE4: 400_000, freeFloat: 12_000_000 },
  { id: "R1", kind: "ai", sector: "retail", size: "bluechip", priceE4: 800_000, freeFloat: 30_000_000 },
  { id: "R2", kind: "ai", sector: "retail", size: "midcap", priceE4: 250_000, freeFloat: 10_000_000 },
  { id: "E1", kind: "ai", sector: "energy", size: "bluechip", priceE4: 600_000, freeFloat: 35_000_000 },
  { id: "E2", kind: "ai", sector: "energy", size: "penny", priceE4: 40_000, freeFloat: 20_000_000 },
  { id: "P1", kind: "ai", sector: "pharma", size: "midcap", priceE4: 900_000, freeFloat: 8_000_000 },
  { id: "P2", kind: "ai", sector: "pharma", size: "penny", priceE4: 60_000, freeFloat: 15_000_000 },
  { id: "L1", kind: "ai", sector: "logistics", size: "midcap", priceE4: 350_000, freeFloat: 12_000_000 },
  { id: "L2", kind: "ai", sector: "logistics", size: "bluechip", priceE4: 1_100_000, freeFloat: 25_000_000 },
  {
    id: "S1",
    kind: "player",
    sector: "tech",
    size: "penny",
    priceE4: 10_000,
    freeFloat: 4_000_000,
    fairGrowthPerQuarter: 0.03,
    steadyBuyCentsPerHour: 500_000,
    chaseBuyCentsPerHour: 1_500_000,
  },
  {
    id: "S2",
    kind: "player",
    sector: "retail",
    size: "penny",
    priceE4: 10_000,
    freeFloat: 4_000_000,
    fairGrowthPerQuarter: 0,
    steadyBuyCentsPerHour: 1_000_000,
    chaseBuyCentsPerHour: 2_000_000,
  },
  {
    id: "S3",
    kind: "player",
    sector: "logistics",
    size: "penny",
    priceE4: 10_000,
    freeFloat: 4_000_000,
    fairGrowthPerQuarter: 0.01,
    steadyBuyCentsPerHour: 0,
    chaseBuyCentsPerHour: 0,
  },
];

const MINUTES_PER_QUARTER = BALANCE.time.quarterHours * 60;

/**
 * Runs the market for `days`. Stock news: one ordinary hint every 12 minutes (±3..12 %, 75 % come true, lead 10..40
 * minutes). Market forces as on the server (one open hint per stock). AI business per quarter: fair value × (1 + g / 4)
 * × e^(0,3 × σ × z), with an earnings surprise ≈ 0,2 × z.
 */
export function simulateMarket(
  model: "before" | "after",
  days: number,
  seed: number,
  stocksIn: readonly HarnessStock[] = HARNESS_STOCKS,
  options: MarketOptions = {},
): MarketRun {
  const cfg = INVESTOR_CONFIDENCE;
  const after = model === "after";
  const rng = createRng(seed);
  const ev = rng.derive("events");
  const flowRng = rng.derive("flows");
  const bizRng = rng.derive("business");
  const ticksPerMinute = 60 / BALANCE.time.tickSeconds;
  const rate = BALANCE.centralBank.startRateBps;
  const valuation = options.valuation ?? "legacy";
  const peDiscount = BALANCE.startups.valuationPeDiscount;
  // player companies (ADR-217): business state
  const biz = stocksIn.map((s) =>
    s.company
      ? {
          base: s.company.profitCentsPerHour,
          cash: s.company.cashCents,
          anchor: s.company.cashCents,
          hours: [] as number[],
        }
      : null,
  );
  // hours since 1970 at the start (sector P/E cycles start at a different point per seed)
  const hour0 = 490_000 + seed * 37;
  const shareCount = stocksIn.map((s) => s.freeFloat * (s.kind === "player" ? 2 : 1));
  const companyFair = (i: number, minute: number, moodNow: number): number => {
    const b = biz[i]!;
    const s = stocksIn[i]!;
    const pe = BALANCE.sectors[s.sector].peRatio;
    if (valuation === "legacy") {
      const q = b.hours.slice(-BALANCE.time.quarterHours).reduce((a, x) => a + x, 0);
      return playerFairValueE4(legacyCompanyValue(b.cash, q, pe, peDiscount), shareCount[i]!);
    }
    const n = b.hours.length;
    const recent = b.hours.slice(-24).reduce((a, x) => a + x, 0);
    const prior = n >= 48 ? b.hours.slice(-48, -24).reduce((a, x) => a + x, 0) : null;
    const v = playerCompanyValue({
      profitRecentCents: recent,
      hoursRecent: Math.min(24, n),
      profitPriorCents: prior,
      hoursPrior: 24,
      cashCents: b.cash,
      anchorCents: b.anchor,
      sector: s.sector,
      peRatio: pe,
      peDiscount,
      mood: moodNow,
      hours: hour0 + minute / 60,
    });
    return playerFairValueE4(v.valueCents, shareCount[i]!);
  };
  // a company starts with six hours of history at its start profit
  biz.forEach((b) => {
    if (b) for (let h = 0; h < 6; h++) b.hours.push(b.base);
  });
  const stocks = stocksIn.map((s, i) =>
    biz[i] ? { ...s, priceE4: companyFair(i, 0, INVESTOR_CONFIDENCE.mood.start) } : s,
  );
  const held = stocks.map(() => 0);
  const fair = stocks.map((s) => s.priceE4);
  let state: MarketState = {
    tick: 0,
    securities: stocks.map((s): SecurityState => ({
      id: s.id,
      sectorId: s.sector,
      sizeClass: s.size,
      priceE4: BigInt(s.priceE4),
      fairValueE4: BigInt(s.priceE4),
      sharesOutstanding: BigInt(s.freeFloat * (s.kind === "player" ? 2 : 1)),
      freeFloatShares: BigInt(s.freeFloat),
      sentiment: 0,
      emaFastE4: s.priceE4,
      emaSlowE4: s.priceE4,
      dividendYieldBps: 0,
      inIndex: false,
      halted: false,
      archetypes: initialArchetypeStates({
        freeFloatShares: s.freeFloat,
        policyRateBps: rate,
        dividendYieldBps: 0,
        bondYieldBps: bondYieldBps(rate, 10),
        inIndex: false,
      }),
      ...(after ? { confidence: 50 } : {}),
    })),
  };
  const n = stocks.length;
  const factors: ConfidenceFactors[] = stocks.map(() => ({}));
  const chatter = stocks.map(() => 0);
  const conf = stocks.map(() => 50);
  let mood: MoodState = { mood: cfg.mood.start, phase: "calm", phaseMinutesLeft: phaseMinutes("calm", ev.next()) };
  const sectors = Object.keys(BALANCE.sectors) as SectorId[];
  let tilts: Partial<Record<SectorId, number>> = {};
  let nextRotation = 60 * cfg.mood.rotation.minHours;
  const pending: ({ due: number; move: number; hit: boolean; kind: "news" | "market" } | null)[] = stocks.map(
    () => null,
  );
  const minutePrices: number[][] = stocks.map((s) => [s.priceE4]);
  const run: MarketRun = {
    ids: stocks.map((s) => s.id),
    kinds: stocks.map((s) => s.kind),
    prices: stocks.map((s) => [s.priceE4]),
    fairs: stocks.map((s) => [s.priceE4]),
    confidence: stocks.map(() => [50]),
    index: [1],
    mood: [mood.mood],
    phases: [mood.phase],
    incidents: stocks.map(() => 0),
    profits: stocks.map((_, i) => (biz[i] ? [biz[i]!.base] : [])),
  };
  const incident: (OpenIncident | null)[] = stocks.map(() => null);
  const incidentFree = stocks.map(() => 0);
  const aiIdx = stocks.map((s, i) => (s.kind === "ai" ? i : -1)).filter((i) => i >= 0);
  const cap0 = aiIdx.reduce((a, i) => a + stocks[i]!.priceE4 * stocks[i]!.freeFloat, 0);
  const totalMinutes = days * 24 * 60;
  const profitPrev = stocks.map(() => 1);
  const profitNow = stocks.map(() => 1);

  for (let minute = 1; minute <= totalMinutes; minute++) {
    const shocks: TickShock[] = [];
    const prices = state.securities.map((s) => Number(s.priceE4));

    // market mood and sector rotation
    if (after) {
      mood = stepMood(mood, ev.normal(), ev.next(), ev.next(), cfg.mood);
      if (minute >= nextRotation) {
        const up = sectors[Math.floor(ev.next() * sectors.length)]!;
        let down = sectors[Math.floor(ev.next() * sectors.length)]!;
        if (down === up) down = sectors[(sectors.indexOf(up) + 1) % sectors.length]!;
        tilts = { [up]: cfg.mood.rotation.tilt, [down]: -cfg.mood.rotation.tilt };
        nextRotation =
          minute +
          Math.round(
            60 * (cfg.mood.rotation.minHours + ev.next() * (cfg.mood.rotation.maxHours - cfg.mood.rotation.minHours)),
          );
      }
    }

    // quarter: AI business, player company growth
    if (minute % MINUTES_PER_QUARTER === 0) {
      for (let i = 0; i < n; i++) {
        const s = stocks[i]!;
        if (s.kind === "ai") {
          const sec = BALANCE.sectors[s.sector];
          const g = after
            ? aiGrowthPerGameYear(sec.demandGrowthBpsPerGameYear, mood.mood, cfg.aiFundamentals)
            : sec.demandGrowthBpsPerGameYear / 10_000;
          const z = ev.normal();
          fair[i] = Math.max(
            1,
            Math.round(fair[i]! * (1 + g / BALANCE.time.quartersPerGameYear) * Math.exp(0.3 * sec.demandNoise * z)),
          );
          const surprise = Math.max(-1, Math.min(1, 0.2 * z));
          shocks.push({ securityId: s.id, sentimentDelta: Math.max(-0.6, Math.min(0.6, 1.5 * surprise)) });
          if (after) factors[i] = addBump(factors[i]!, "earnings", earningsBump(surprise), cfg);
          profitPrev[i] = profitNow[i]!;
          profitNow[i] = profitNow[i]! * (1 + g / 4) * Math.exp(sec.demandNoise * z);
        } else if (biz[i]) {
          // quarter result of a player company: this quarter's profit against the one before
          const hs = biz[i]!.hours;
          const recent = hs.slice(-BALANCE.time.quarterHours).reduce((a, x) => a + x, 0);
          const prior = hs.slice(-2 * BALANCE.time.quarterHours, -BALANCE.time.quarterHours).reduce((a, x) => a + x, 0);
          if (after && hs.length >= 2 * BALANCE.time.quarterHours)
            factors[i] = addBump(
              factors[i]!,
              "earnings",
              cfg.events.earnings.perSurprise *
                Math.max(-1, Math.min(1, (recent - prior) / Math.max(Math.abs(prior), 100))),
              cfg,
            );
          profitPrev[i] = prior;
          profitNow[i] = recent;
          if (valuation === "legacy") fair[i] = companyFair(i, minute, mood.mood);
        } else {
          fair[i] = Math.max(1, Math.round(fair[i]! * (1 + (s.fairGrowthPerQuarter ?? 0))));
          profitPrev[i] = profitNow[i]!;
          profitNow[i] = profitNow[i]! * (1 + (s.fairGrowthPerQuarter ?? 0));
        }
      }
    }

    // player companies (ADR-217): the hour closes with its profit, the founder invests once a day
    for (let i = 0; i < n; i++) {
      const b = biz[i];
      const c = stocks[i]!.company;
      if (!b || !c) continue;
      if (minute % 60 === 0) {
        const t = minute / 1_440;
        const profit = b.base * Math.exp(c.hourNoise * bizRng.normal());
        b.hours.push(profit);
        if (b.hours.length > 60) b.hours.shift();
        const lastCash = b.cash;
        b.cash += profit * (1 - c.payoutShare);
        b.base *= Math.exp((c.growthPerDay * Math.exp(-t / c.growthTauDays)) / 24 + c.walkPerHour * bizRng.normal());
        if (c.investShareDaily && minute % 1_440 === 0) {
          const spend = b.cash * c.investShareDaily;
          b.cash -= spend;
          b.base += spend / (24 * (c.paybackDays ?? 8));
        }
        b.anchor = nextAnchor(b.anchor, b.cash, lastCash, false);
      }
      if (valuation === "earnings" && minute % 5 === 0) fair[i] = companyFair(i, minute, after ? mood.mood : 50);
    }

    // ordinary stock news every 12 minutes
    if (minute % 12 === 0) {
      const free = stocks.map((_, i) => i).filter((i) => !pending[i]);
      if (free.length > 0) {
        const i = free[Math.floor(ev.next() * free.length)]!;
        const dir = ev.next() < 0.5 ? 1 : -1;
        pending[i] = {
          due: minute + 10 + Math.floor(ev.next() * 31),
          move: dir * (300 + Math.floor(ev.next() * 901)),
          hit: ev.next() < 0.75,
          kind: "news",
        };
      }
    }

    for (let i = 0; i < n; i++) {
      const p = pending[i];
      if (p && p.due <= minute) {
        if (p.hit) {
          shocks.push({
            securityId: stocks[i]!.id,
            priceReturn: p.move / 10_000,
            ...(p.kind === "market" ? { sentimentDelta: forceSentimentDelta(p.move) } : {}),
          });
          if (after)
            factors[i] = addBump(factors[i]!, p.kind, moveBump(p.move, cfg.events[p.kind].pointsPerTenPercent), cfg);
        }
        pending[i] = null;
      }
      if (!pending[i]) {
        const mp = minutePrices[i]!;
        const at = (m: number) => (mp.length > m ? mp[mp.length - 1 - m]! : null);
        const h = stockHeat({
          priceE4: prices[i]!,
          fairValueE4: fair[i]!,
          price24hE4: at(1_440),
          price7dE4: at(10_080),
        });
        if (ev.next() < perMinute(forceChancePerHour(h))) {
          const force = pickForce(h, ev.next());
          if (force) {
            pending[i] = {
              due: minute + 3 + Math.floor(ev.next() * 13),
              move: force.direction * forceMoveBps(force, h, ev.next()),
              hit: ev.next() < 0.85,
              kind: "market",
            };
          }
        }
      }
    }

    // stock incidents of player companies (after): drawn by heat, worked off step by step
    if (after) {
      for (let i = 0; i < n; i++) {
        if (stocks[i]!.kind !== "player") continue;
        const inc = incident[i];
        if (inc) {
          if (inc.responds && !inc.solved && inc.stepsLeft > 0 && minute >= inc.nextStepAt) {
            const ok = ev.next() < 0.7;
            factors[i] = addBump(
              factors[i]!,
              "incident",
              incidentBump(ok ? "stepSucceeded" : "stepFailed", inc.severity),
              cfg,
            );
            if (ok) inc.stepsLeft--;
            inc.nextStepAt = minute + 240 + Math.floor(ev.next() * 240);
            if (inc.stepsLeft === 0 && minute < inc.deadline) {
              inc.solved = true;
              factors[i] = addBump(factors[i]!, "incident", incidentBump("solved", inc.severity), cfg);
            }
          }
          if (!inc.solved && !inc.lost && minute >= inc.deadline) {
            inc.lost = true;
            factors[i] = addBump(factors[i]!, "incident", incidentBump("lost", inc.severity), cfg);
          }
          if (inc.solved || minute >= inc.endsAt) {
            incident[i] = null;
            incidentFree[i] = minute + cfg.incidents.cooldownHours * 60;
          }
          continue;
        }
        if (minute < incidentFree[i]! || minute < cfg.incidents.minListedHours * 60) continue;
        const mp = minutePrices[i]!;
        const at = (m: number) => (mp.length > m ? mp[mp.length - 1 - m]! : null);
        const h = stockHeat({
          priceE4: prices[i]!,
          fairValueE4: fair[i]!,
          price24hE4: at(1_440),
          price7dE4: at(10_080),
        });
        const cap = (prices[i]! / 100) * stocks[i]!.freeFloat * 2;
        if (ev.next() < perMinute(incidentChancePerHour(h.heat, cap, cfg.incidents))) {
          const severity = incidentSeverity(h.heat, cfg.incidents);
          const responds = ev.next() < 0.6;
          incident[i] = {
            severity,
            deadline: minute + 30 * 60,
            endsAt: minute + 30 * 60 + 96 * 60,
            responds,
            stepsLeft: 3,
            nextStepAt: minute + 240,
            solved: false,
            lost: false,
          };
          run.incidents[i]!++;
          factors[i] = addBump(factors[i]!, "incident", incidentBump("start", severity), cfg);
          shocks.push({
            securityId: stocks[i]!.id,
            priceReturn: -COMPANY_EVENTS.shareShockBps[severity - 1]! / 10_000,
          });
        }
      }
    }

    // confidence (once a minute, like the server job)
    if (after) {
      for (let i = 0; i < n; i++) {
        const mp = minutePrices[i]!;
        const hourly: number[] = [];
        for (let m = Math.max(0, mp.length - 1 - 1_440); m < mp.length; m += 60) hourly.push(mp[m]!);
        chatter[i] = stepChatter(chatter[i]!, ev.normal(), cfg.state);
        const p24 = mp.length > 1_440 ? mp[mp.length - 1 - 1_440]! : null;
        const st = stateFactors(
          {
            profitRecentCents: profitNow[i]! * 1e6,
            profitPriorCents: profitPrev[i]! * 1e6,
            reputation: null,
            crisisSeverity: 0,
            incidentSeverity: incident[i]?.severity ?? 0,
            countryRisk: null,
            talentTiers: 0,
            coCeo: false,
            volatility: volatilityOf(hourly),
            mood: mood.mood,
            sectorTilt: tilts[stocks[i]!.sector] ?? 0,
            logReturn24h: p24 ? Math.log(prices[i]! / p24) : null,
            logPremium: Math.log(prices[i]! / fair[i]!),
            chatter: chatter[i]!,
          },
          cfg.state,
        );
        factors[i] = decayEvents(factors[i]!, 1, cfg);
        conf[i] = stepConfidence(conf[i]!, confidenceTarget({ ...factors[i], ...st }), cfg);
      }
    }

    // ticks of this minute
    state = {
      ...state,
      securities: state.securities.map((s, i) => ({
        ...s,
        fairValueE4: BigInt(Math.max(1, Math.round(fair[i]! * (1 - 0.04 * (incident[i]?.severity ?? 0))))),
        ...(after ? { confidence: conf[i]! } : {}),
        ...(biz[i] ? { playerHeldShares: held[i]! } : {}),
      })),
    };
    for (let t = 0; t < ticksPerMinute; t++) {
      const flows: PlayerFlow[] = [];
      for (let i = 0; i < n; i++) {
        const st = stocks[i]!;
        if (!st.steadyBuyCentsPerHour && !st.chaseBuyCentsPerHour) continue;
        const s = state.securities[i]!;
        const trend = s.emaSlowE4 > 0 ? s.emaFastE4 / s.emaSlowE4 - 1 : 0;
        const cents =
          ((st.steadyBuyCentsPerHour ?? 0) + (st.chaseBuyCentsPerHour ?? 0) * Math.tanh(trend / 0.02)) *
          (1 / (60 * ticksPerMinute)) *
          (0.5 + flowRng.next());
        const shares = Math.round((cents * 100) / Math.max(1, Number(s.priceE4)));
        if (biz[i]) held[i] = Math.max(0, held[i]! + shares);
        if (shares !== 0)
          flows.push({ securityId: st.id, netShares: BigInt(shares), volumeShares: BigInt(Math.abs(shares)) });
      }
      state = stepMarketTick(
        state,
        {
          nowMs: (minute * ticksPerMinute + t) * BALANCE.time.tickSeconds * 1000,
          session: "open",
          policyRateBps: rate,
          playerFlows: flows,
          shocks: t === 0 ? shocks : [],
        },
        rng,
      ).state;
    }
    for (let i = 0; i < n; i++) minutePrices[i]!.push(Number(state.securities[i]!.priceE4));

    if (minute % 60 === 0) {
      for (let i = 0; i < n; i++) {
        run.prices[i]!.push(Number(state.securities[i]!.priceE4));
        run.fairs[i]!.push(fair[i]!);
        run.confidence[i]!.push(conf[i]!);
        if (biz[i]) run.profits![i]!.push(biz[i]!.base);
        // keep 8 days of minute prices (heat needs 7 days)
        if (minutePrices[i]!.length > 11_600) minutePrices[i]!.splice(0, minutePrices[i]!.length - 11_600);
      }
      const cap = aiIdx.reduce((a, i) => a + Number(state.securities[i]!.priceE4) * stocks[i]!.freeFloat, 0);
      run.index.push(cap / cap0);
      run.mood.push(mood.mood);
      run.phases.push(mood.phase);
    }
  }
  return run;
}

/** Returns over `hours` windows (non-overlapping, stepped by `stepHours`) of every stock in a group. */
export function windowReturns(
  run: MarketRun,
  kind: "ai" | "player",
  hours: number,
  stepHours = hours,
  relativeToFair = false,
): number[] {
  const out: number[] = [];
  run.ids.forEach((_, i) => {
    if (run.kinds[i] !== kind) return;
    const p = run.prices[i]!;
    const f = run.fairs[i]!;
    for (let h = hours; h < p.length; h += stepHours) {
      const r = p[h]! / p[h - hours]!;
      out.push(relativeToFair ? r / (f[h]! / f[h - hours]!) - 1 : r - 1);
    }
  });
  return out;
}

/** Largest fall from a running peak (0.3 = −30 %) and largest rise from a running trough. */
export function drawdowns(series: readonly number[]): { maxDrawdown: number; maxRally: number } {
  let peak = series[0] ?? 1;
  let trough = series[0] ?? 1;
  let maxDrawdown = 0;
  let maxRally = 0;
  for (const x of series) {
    peak = Math.max(peak, x);
    trough = Math.min(trough, x);
    maxDrawdown = Math.max(maxDrawdown, 1 - x / peak);
    maxRally = Math.max(maxRally, x / trough - 1);
  }
  return { maxDrawdown, maxRally };
}
