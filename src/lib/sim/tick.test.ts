import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { createRng } from "./rng.ts";
import { makeSecurity } from "./test-fixtures.ts";
import { stepMarketTick } from "./tick.ts";
import type { MarketState, PlayerFlow, TickInputs, TickShock } from "./types.ts";

const b = (n: number) => BigInt(n);

function inputs(tick: number, overrides: Partial<TickInputs> = {}): TickInputs {
  return { nowMs: tick * 5_000, session: "open", policyRateBps: 300, playerFlows: [], shocks: [], ...overrides };
}

function market(): MarketState {
  return {
    tick: 0,
    securities: [
      makeSecurity({ id: "BLUE", sizeClass: "bluechip", priceE4: b(1_000_000) }),
      makeSecurity({ id: "MID", sizeClass: "midcap", sectorId: "tech", priceE4: b(400_000) }),
      makeSecurity({ id: "PENNY", sizeClass: "penny", sectorId: "pharma", priceE4: b(5_000) }),
    ],
  };
}

function run(
  state: MarketState,
  ticks: number,
  seed: number,
  perTick: (tick: number) => Partial<TickInputs> = () => ({}),
): MarketState {
  const rng = createRng(seed);
  let current = state;
  for (let t = 0; t < ticks; t++) current = stepMarketTick(current, inputs(t, perTick(t)), rng).state;
  return current;
}

const priceOf = (state: MarketState, id: string) => Number(state.securities.find((s) => s.id === id)?.priceE4);

describe("stepMarketTick", () => {
  it("is deterministic for the same seed (property)", () => {
    for (const seed of [1, 2, 3, 99, 123456]) {
      const flows = (t: number): Partial<TickInputs> => ({
        playerFlows:
          t % 7 === 0 ? [{ securityId: "MID", netShares: b(500 - (t % 3) * 400), volumeShares: b(900) }] : [],
        shocks: t === 50 ? [{ securityId: "PENNY", sentimentDelta: 0.8 }] : [],
        session: t % 40 < 30 ? "open" : "after_hours",
      });
      const a = run(market(), 300, seed, flows);
      const again = run(market(), 300, seed, flows);
      expect(again).toEqual(a);
    }
  });

  it("produces different paths for different seeds", () => {
    expect(priceOf(run(market(), 50, 1), "BLUE")).not.toBe(priceOf(run(market(), 50, 2), "BLUE"));
  });

  it("does not depend on the order of the securities", () => {
    const forward = stepMarketTick(market(), inputs(0), createRng(7));
    const reversedState = { tick: 0, securities: [...market().securities].reverse() };
    const backward = stepMarketTick(reversedState, inputs(0), createRng(7));
    for (const record of forward.records) {
      expect(backward.records.find((r) => r.securityId === record.securityId)).toEqual(record);
    }
  });

  it("does not mutate its input and advances the tick counter", () => {
    const state = market();
    const snapshot = JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const result = stepMarketTick(state, inputs(0), createRng(1));
    expect(JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
    expect(result.state.tick).toBe(1);
    expect(result.records).toHaveLength(3);
  });

  it("never produces a price <= 0, even under extreme stress (property)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const stress = createRng(seed * 1000 + 1);
      let state: MarketState = {
        tick: 0,
        securities: [
          makeSecurity({ id: "A", sizeClass: "penny", priceE4: b(3), fairValueE4: b(1) }),
          makeSecurity({ id: "B", sizeClass: "penny", priceE4: b(1), fairValueE4: b(50_000) }),
          makeSecurity({ id: "C", sizeClass: "midcap", priceE4: b(200_000), fairValueE4: b(1) }),
          makeSecurity({ id: "D", sizeClass: "bluechip", priceE4: b(1_000_000), freeFloatShares: b(10) }),
        ],
      };
      const rng = createRng(seed);
      for (let t = 0; t < 1_500; t++) {
        const shocks: TickShock[] = [];
        const playerFlows: PlayerFlow[] = [];
        for (const s of state.securities) {
          if (stress.chance(0.05))
            shocks.push({
              securityId: s.id,
              priceReturn: stress.range(-1.5, 0.7),
              sentimentDelta: stress.range(-2, 2),
            });
          if (stress.chance(0.2)) {
            playerFlows.push({
              securityId: s.id,
              netShares: b(stress.int(-5_000_000, 5_000_000)),
              volumeShares: b(5_000_000),
            });
          }
        }
        const result = stepMarketTick(
          state,
          inputs(t, {
            shocks,
            playerFlows,
            session: stress.chance(0.5) ? "open" : "after_hours",
            policyRateBps: stress.int(50, 1000),
          }),
          rng,
        );
        state = result.state;
        for (const record of result.records) {
          expect(record.priceE4 >= b(BALANCE.trading.minPriceE4)).toBe(true);
          expect(record.bidE4 >= b(1)).toBe(true);
          expect(record.askE4 > record.bidE4).toBe(true);
          expect(record.volumeShares >= b(0)).toBe(true);
          expect(Number.isFinite(record.logReturn)).toBe(true);
        }
        for (const s of state.securities) {
          expect(s.sentiment).toBeGreaterThanOrEqual(-1);
          expect(s.sentiment).toBeLessThanOrEqual(1);
          expect(Number.isFinite(s.emaFastE4) && Number.isFinite(s.emaSlowE4)).toBe(true);
        }
      }
    }
  });

  it("limits the regular return per tick (circuit breaker)", () => {
    const state: MarketState = { tick: 0, securities: [makeSecurity({ id: "X", freeFloatShares: b(1_000) })] };
    const result = stepMarketTick(
      state,
      inputs(0, { playerFlows: [{ securityId: "X", netShares: b(1_000_000), volumeShares: b(1_000_000) }] }),
      createRng(1),
    );
    const max = BALANCE.trading.maxTickReturnBps / 10_000;
    expect(result.records[0]?.logReturn).toBeLessThanOrEqual(max + 1e-6);
  });

  it("reverts to the fair value over time", () => {
    for (const seed of [1, 2, 3]) {
      const state: MarketState = {
        tick: 0,
        securities: [
          makeSecurity({ id: "UNDER", priceE4: b(700_000), fairValueE4: b(1_000_000) }),
          makeSecurity({ id: "OVER", priceE4: b(1_400_000), fairValueE4: b(1_000_000) }),
        ],
      };
      const end = run(state, 4_320, seed); // one quarter
      expect(Math.abs(Math.log(priceOf(end, "UNDER") / 1_000_000))).toBeLessThan(0.12);
      expect(Math.abs(Math.log(priceOf(end, "OVER") / 1_000_000))).toBeLessThan(0.12);
    }
  });

  it("stays in a plausible band around the fair value over a whole day", () => {
    const end = run(market(), 17_280, 5, (t) => ({ session: t < 10_080 ? "open" : "after_hours" }));
    expect(Math.abs(Math.log(priceOf(end, "BLUE") / 1_000_000))).toBeLessThan(0.15);
    expect(Math.abs(Math.log(priceOf(end, "MID") / 400_000))).toBeLessThan(0.3);
    expect(Math.abs(Math.log(priceOf(end, "PENNY") / 5_000))).toBeLessThan(0.8);
  });

  it("penny stocks are more volatile than blue chips", () => {
    const rng = createRng(11);
    let state = market();
    const sumSquares: Record<string, number> = { BLUE: 0, MID: 0, PENNY: 0 };
    for (let t = 0; t < 2_000; t++) {
      const result = stepMarketTick(state, inputs(t), rng);
      state = result.state;
      for (const r of result.records) sumSquares[r.securityId] = (sumSquares[r.securityId] ?? 0) + r.logReturn ** 2;
    }
    expect(sumSquares.PENNY).toBeGreaterThan((sumSquares.MID ?? 0) * 2);
    expect(sumSquares.MID).toBeGreaterThan((sumSquares.BLUE ?? 0) * 2);
  });

  it("player buying moves the price up, selling down (same noise)", () => {
    const flow =
      (net: number) =>
      (t: number): Partial<TickInputs> => ({
        playerFlows: t < 20 ? [{ securityId: "BLUE", netShares: b(net), volumeShares: b(Math.abs(net)) }] : [],
      });
    const neutral = priceOf(run(market(), 60, 3), "BLUE");
    const bought = priceOf(run(market(), 60, 3, flow(2_000)), "BLUE");
    const sold = priceOf(run(market(), 60, 3, flow(-2_000)), "BLUE");
    expect(bought).toBeGreaterThan(neutral);
    expect(sold).toBeLessThan(neutral);
  });

  it("a round trip fades: players buy and sell again, value funds pull the price back", () => {
    const flow = (t: number): Partial<TickInputs> => ({
      playerFlows:
        t < 10
          ? [{ securityId: "BLUE", netShares: b(10_000), volumeShares: b(10_000) }]
          : t < 20
            ? [{ securityId: "BLUE", netShares: b(-10_000), volumeShares: b(10_000) }]
            : [],
    });
    const late = priceOf(run(market(), 6_000, 3, flow), "BLUE") - priceOf(run(market(), 6_000, 3), "BLUE");
    const buyOnly = (t: number): Partial<TickInputs> => ({
      playerFlows: t < 10 ? [{ securityId: "BLUE", netShares: b(10_000), volumeShares: b(10_000) }] : [],
    });
    const early = priceOf(run(market(), 10, 3, buyOnly), "BLUE") - priceOf(run(market(), 10, 3), "BLUE");
    expect(early).toBeGreaterThan(0);
    expect(Math.abs(late)).toBeLessThan(early * 0.5);
  });

  it("what players hold keeps lifting the price (ADR-056)", () => {
    const buyAndHold = (t: number): Partial<TickInputs> => ({
      playerFlows: t < 10 ? [{ securityId: "MID", netShares: b(20_000), volumeShares: b(20_000) }] : [],
    });
    const held = priceOf(run(market(), 6_000, 3, buyAndHold), "MID");
    const control = priceOf(run(market(), 6_000, 3), "MID");
    expect(held).toBeGreaterThan(control * 1.02);
  });

  it("many players outweigh the AI traders", () => {
    const busy = makeSecurity({ id: "B", playerActivityCents: 1e12 });
    const quiet = makeSecurity({ id: "B" });
    const noiseOf = (security: typeof busy) => {
      let sum = 0;
      let state: MarketState = { tick: 0, securities: [security] };
      for (let t = 0; t < 400; t++) {
        const step = stepMarketTick(state, inputs(t), createRng(9));
        sum += Math.abs(step.records[0]?.logReturn ?? 0);
        state = step.state;
      }
      return sum;
    };
    expect(noiseOf(busy)).toBeLessThan(noiseOf(quiet) * 0.5);
  });

  it("positive news lifts the price, negative news hits it", () => {
    const shock =
      (delta: number) =>
      (t: number): Partial<TickInputs> => ({
        shocks: t === 0 ? [{ securityId: "MID", sentimentDelta: delta }] : [],
      });
    const neutral = priceOf(run(market(), 400, 4), "MID");
    expect(priceOf(run(market(), 400, 4, shock(0.6)), "MID")).toBeGreaterThan(neutral * 1.02);
    expect(priceOf(run(market(), 400, 4, shock(-0.6)), "MID")).toBeLessThan(neutral * 0.98);
  });

  it("sentiment decays", () => {
    const state: MarketState = { tick: 0, securities: [makeSecurity({ id: "S", sentiment: 0.8 })] };
    const end = run(state, 1_000, 1);
    const sentiment = end.securities[0]?.sentiment ?? 1;
    expect(sentiment).toBeGreaterThan(0);
    expect(sentiment).toBeLessThan(0.2);
  });

  it("a binary event jumps the price immediately", () => {
    const up = stepMarketTick(
      market(),
      inputs(0, { shocks: [{ securityId: "PENNY", priceReturn: 0.6 }] }),
      createRng(1),
    );
    const down = stepMarketTick(
      market(),
      inputs(0, { shocks: [{ securityId: "PENNY", priceReturn: -0.6 }] }),
      createRng(1),
    );
    const flat = stepMarketTick(market(), inputs(0), createRng(1));
    const price = (r: typeof up) => Number(r.records.find((x) => x.securityId === "PENNY")?.priceE4);
    expect(price(up) / price(flat)).toBeCloseTo(1.6, 1);
    expect(price(down) / price(flat)).toBeCloseTo(0.4, 1);
  });

  it("a rate hike pushes the market down (pension funds rotate into bonds)", () => {
    const hiked = run(market(), 1_500, 6, () => ({ policyRateBps: 500 }));
    const baseline = run(market(), 1_500, 6);
    for (const id of ["BLUE", "MID", "PENNY"]) expect(priceOf(hiked, id)).toBeLessThan(priceOf(baseline, id));
  });

  it("index inclusion makes index funds buy and the price jump", () => {
    const outside: MarketState = { tick: 0, securities: [makeSecurity({ id: "NEW", inIndex: false })] };
    const included: MarketState = {
      tick: 0,
      securities: [{ ...(outside.securities[0] as (typeof outside.securities)[number]), inIndex: true }],
    };
    const without = priceOf(run(outside, 600, 8), "NEW");
    const withInclusion = priceOf(run(included, 600, 8), "NEW");
    expect(withInclusion).toBeGreaterThan(without * 1.05);
  });

  it("after hours: wider spread and stronger player impact", () => {
    const state = market();
    const open = stepMarketTick(state, inputs(0), createRng(1)).records[0];
    const late = stepMarketTick(state, inputs(0, { session: "after_hours" }), createRng(1)).records[0];
    const spread = (r: typeof open) => Number((r?.askE4 ?? b(0)) - (r?.bidE4 ?? b(0)));
    expect(spread(late)).toBeGreaterThan(spread(open) * 2);

    const flow: PlayerFlow[] = [{ securityId: "BLUE", netShares: b(500), volumeShares: b(500) }];
    const impact = (session: "open" | "after_hours") => {
      const withFlow = stepMarketTick(state, inputs(0, { session, playerFlows: flow }), createRng(1)).records[0];
      const withoutFlow = stepMarketTick(state, inputs(0, { session }), createRng(1)).records[0];
      return Number(withFlow?.priceE4) - Number(withoutFlow?.priceE4);
    };
    expect(impact("after_hours")).toBeGreaterThan(impact("open") * 2);
  });

  it("leaves halted securities untouched", () => {
    const state: MarketState = { tick: 5, securities: [makeSecurity({ id: "H", halted: true, sentiment: 0.5 })] };
    const result = stepMarketTick(state, inputs(5, { shocks: [{ securityId: "H", priceReturn: -0.9 }] }), createRng(1));
    expect(result.state.securities[0]).toEqual(state.securities[0]);
    expect(result.records[0]).toMatchObject({ priceE4: b(1_000_000), volumeShares: b(0), logReturn: 0 });
  });

  it("can leave the minimum price again (no absorbing state)", () => {
    const state: MarketState = {
      tick: 0,
      securities: [makeSecurity({ id: "Z", sizeClass: "penny", priceE4: b(1), fairValueE4: b(1_000) })],
    };
    expect(priceOf(run(state, 6_000, 2), "Z")).toBeGreaterThan(1);
  });
});
