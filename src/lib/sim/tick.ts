/**
 * Market tick (ADR-004, ADR-005): price formation for every security.
 *
 * Order of operations per security (see docs/SIMULATION.md):
 *  1. session factors (liquidity, spread, noise)
 *  2. sentiment decay + shocks
 *  3. market-maker inventory absorbs the player flow
 *  4. pressure of the six archetypes (value fund = mean reversion to fair value)
 *  5. return = impact(AI pressure) + immediate impact(player flow) + noise, clamped
 *  6. event jumps (binary events, insolvency) on top, unclamped
 *  7. new price with unbiased stochastic rounding, never below the minimum price
 *  8. EMAs, holdings, quote
 *
 * The function is pure. All randomness comes from `rng.derive("tick", tick, id)`,
 * so the result only depends on (state, inputs, seed) and not on the order of
 * the securities.
 */
import { BALANCE } from "../../config/balance.ts";
import type {
  AiInvestorsConfig,
  BondsConfig,
  CentralBankConfig,
  InvestorArchetypeId,
  SectorConfig,
  SectorId,
  TimeConfig,
  TradingConfig,
} from "../../config/balance.ts";
import { bondYieldBps } from "./bonds.ts";
import { computeAllPressures } from "./investors.ts";
import { halfSpreadBps, quoteAround } from "./market-maker.ts";
import { ZERO, absBig, roundToBigInt } from "./money.ts";
import { depthShares, impactReturn } from "./price-impact.ts";
import type {
  ArchetypeStates,
  MarketState,
  Rng,
  SecurityState,
  TickInputs,
  TickRecord,
  TickResult,
} from "./types.ts";
import { INVESTOR_ARCHETYPES } from "./types.ts";

export interface TickConfig {
  readonly trading: TradingConfig;
  readonly time: TimeConfig;
  readonly aiInvestors: AiInvestorsConfig;
  readonly centralBank: CentralBankConfig;
  readonly bonds: BondsConfig;
  readonly sectors: Readonly<Record<SectorId, SectorConfig>>;
}

const DEFAULT_TICK_CONFIG: TickConfig = BALANCE;

/** Largest single-tick drop an event may cause (keeps the logarithm finite). */
const MIN_EVENT_FACTOR = 0.01;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Advances the whole market by one tick. */
export function stepMarketTick(
  state: MarketState,
  inputs: TickInputs,
  rng: Rng,
  cfg: TickConfig = DEFAULT_TICK_CONFIG,
): TickResult {
  const tenYearYieldBps = bondYieldBps(inputs.policyRateBps, 10, cfg.bonds);
  const securities: SecurityState[] = [];
  const records: TickRecord[] = [];

  for (const security of state.securities) {
    const stream = rng.derive("tick", state.tick, security.id);
    const { next, record } = stepSecurity(security, state.tick, inputs, tenYearYieldBps, stream, cfg);
    securities.push(next);
    records.push(record);
  }
  return { state: { tick: state.tick + 1, securities }, records };
}

function stepSecurity(
  security: SecurityState,
  tick: number,
  inputs: TickInputs,
  tenYearYieldBps: number,
  rng: Rng,
  cfg: TickConfig,
): { next: SecurityState; record: TickRecord } {
  const { trading, time, aiInvestors } = cfg;
  const session = inputs.session;
  const zeroPressures = {} as Record<InvestorArchetypeId, number>;
  for (const a of INVESTOR_ARCHETYPES) zeroPressures[a] = 0;

  if (security.halted) {
    const quote = quoteAround(security.priceE4, halfSpreadBps(security.sizeClass, session, security.sentiment, trading, time.afterHours), trading);
    return {
      next: security,
      record: {
        securityId: security.id,
        tick,
        timeMs: inputs.nowMs,
        priceE4: security.priceE4,
        bidE4: quote.bidE4,
        askE4: quote.askE4,
        volumeShares: ZERO,
        pressures: zeroPressures,
        logReturn: 0,
      },
    };
  }

  // 1. Session factors.
  const depth = depthShares(security.freeFloatShares, session, trading.priceImpact, time.afterHours);
  const noiseFactor = session === "open" ? 1 : time.afterHours.volatilityMultiplier;
  const liquidityFactor = session === "open" ? 1 : time.afterHours.liquidityMultiplier;

  // 2. Sentiment decay and shocks.
  let sentimentDelta = 0;
  let eventFactor = 1;
  for (const shock of inputs.shocks) {
    if (shock.securityId !== security.id) continue;
    sentimentDelta += shock.sentimentDelta ?? 0;
    eventFactor *= Math.max(MIN_EVENT_FACTOR, 1 + (shock.priceReturn ?? 0));
  }
  const sentiment = clamp(security.sentiment * (1 - aiInvestors.sentimentDecayPerTick) + sentimentDelta, -1, 1);

  // 3. Player flow: the market maker takes the other side.
  let playerNet = ZERO;
  let playerVolume = ZERO;
  for (const flow of inputs.playerFlows) {
    if (flow.securityId !== security.id) continue;
    playerNet += flow.netShares;
    playerVolume += absBig(flow.volumeShares);
  }
  const playerNetShares = Number(playerNet);
  const makerInventory = security.archetypes.market_maker.holdingShares - playerNetShares;

  // 4. Archetype pressures.
  const holdings = {} as Record<InvestorArchetypeId, number>;
  for (const a of INVESTOR_ARCHETYPES) holdings[a] = security.archetypes[a].holdingShares;
  holdings.market_maker = makerInventory;
  const price = Number(security.priceE4);
  const pressures = computeAllPressures(
    {
      price,
      fairValue: Number(security.fairValueE4),
      emaFast: security.emaFastE4,
      emaSlow: security.emaSlowE4,
      sentiment,
      freeFloatShares: Number(security.freeFloatShares),
      policyRateBps: inputs.policyRateBps,
      dividendYieldBps: security.dividendYieldBps,
      bondYieldBps: tenYearYieldBps,
      inIndex: security.inIndex,
      liquidityFactor,
    },
    holdings,
    { ai: aiInvestors, centralBank: cfg.centralBank, priceImpact: trading.priceImpact },
  );
  let aiNet = 0;
  let aiGross = 0;
  for (const a of INVESTOR_ARCHETYPES) {
    aiNet += pressures[a];
    aiGross += Math.abs(pressures[a]);
  }

  // 5. Return from order flow and noise, limited by the circuit breaker.
  const flowReturn =
    impactReturn(aiNet, depth, trading.priceImpact) +
    trading.priceImpact.immediateShare * impactReturn(playerNetShares, depth, trading.priceImpact);
  const sigma =
    (aiInvestors.tickNoiseBps[security.sizeClass] / 10_000) *
    cfg.sectors[security.sectorId].volatilityMultiplier *
    noiseFactor;
  const noise = sigma * rng.normal();
  const maxReturn = trading.maxTickReturnBps / 10_000;
  const regularReturn = clamp(flowReturn + noise, -maxReturn, maxReturn);

  // 6. Event jumps are applied on top and are not limited by the circuit breaker.
  const logReturn = regularReturn + Math.log(eventFactor);

  // 7. New price: unbiased stochastic rounding so that small drifts survive on
  //    penny stocks, and a hard floor at the minimum price.
  const exact = price * Math.exp(logReturn);
  const floor = Math.floor(exact);
  const rounded = floor + (rng.next() < exact - floor ? 1 : 0);
  const minPrice = BigInt(trading.minPriceE4);
  let priceE4 = roundToBigInt(rounded);
  if (priceE4 < minPrice) priceE4 = minPrice;
  const newPrice = Number(priceE4);

  // 8. EMAs, holdings, quote.
  const emaFastE4 = security.emaFastE4 + aiInvestors.emaFastAlpha * (newPrice - security.emaFastE4);
  const emaSlowE4 = security.emaSlowE4 + aiInvestors.emaSlowAlpha * (newPrice - security.emaSlowE4);

  const archetypes = {} as Record<InvestorArchetypeId, { holdingShares: number }>;
  for (const a of INVESTOR_ARCHETYPES) {
    archetypes[a] = { holdingShares: security.archetypes[a].holdingShares + pressures[a] };
  }
  // The whole inventory decays at the unwind speed (hedged part via the market,
  // the rest via natural counter flow).
  archetypes.market_maker = {
    holdingShares: makerInventory * (1 - aiInvestors.archetypes.market_maker.reactionSpeed * liquidityFactor),
  };

  const quote = quoteAround(priceE4, halfSpreadBps(security.sizeClass, session, sentiment, trading, time.afterHours), trading);
  const baselineVolume = depth * aiInvestors.baselineVolumeDepthFraction * (0.5 + rng.next());
  const volumeShares = playerVolume + roundToBigInt(Math.round(aiGross + baselineVolume));

  const next: SecurityState = {
    ...security,
    priceE4,
    sentiment,
    emaFastE4,
    emaSlowE4,
    archetypes: archetypes as ArchetypeStates,
  };
  const record: TickRecord = {
    securityId: security.id,
    tick,
    timeMs: inputs.nowMs,
    priceE4,
    bidE4: quote.bidE4,
    askE4: quote.askE4,
    volumeShares,
    pressures,
    logReturn: Math.log(newPrice / price),
  };
  return { next, record };
}
