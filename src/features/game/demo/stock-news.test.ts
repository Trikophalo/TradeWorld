import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { createStockNewsEngine } from "./stock-news";

function setup(randoms: number[]) {
  const state = { now: Date.parse("2026-11-13T10:00:00Z"), shocks: [] as [string, number][] };
  let i = 0;
  const engine = createStockNewsEngine({
    companies: () => [
      { ticker: "KLS", name: "KlarSoft AG" },
      { ticker: "VLT", name: "Volta Energie AG" },
    ],
    shock: (ticker, bps) => state.shocks.push([ticker, bps]),
    now: () => state.now,
    random: () => randoms[i++ % randoms.length]!,
  });
  return { state, engine };
}

describe("stock news in the demo (ADR-119)", () => {
  const cfg = BALANCE.stockNews;

  it("publishes one hint per interval and keeps its plan to itself", async () => {
    // company 0, up, smallest move, first text, shortest lead, comes true
    const { engine, state } = setup([0, 0, 0, 0, 0, 0]);
    const first = await engine.stockNews();
    expect(first.reliabilityBps).toBe(cfg.reliabilityBps);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      ticker: "KLS",
      direction: "up",
      strength: 1,
      status: "open",
      moveBps: null,
    });
    expect(first.items[0]).not.toHaveProperty("comesTrue");
    state.now += 60_000;
    expect((await engine.stockNews()).items).toHaveLength(1);
  });

  it("moves the price when a true hint is due", async () => {
    const { engine, state } = setup([0, 0, 0, 0, 0, 0]);
    await engine.stockNews();
    state.now += cfg.leadMinMinutes * 60_000;
    const later = await engine.stockNews();
    expect(state.shocks).toEqual([["KLS", cfg.minMoveBps]]);
    expect(later.items.find((i) => i.ticker === "KLS")).toMatchObject({ status: "confirmed", moveBps: cfg.minMoveBps });
  });

  it("a hint that fizzles moves nothing", async () => {
    // ..., last draw 0.99: above the reliability
    const { engine, state } = setup([0, 0.9, 0, 0, 0, 0.99]);
    const first = await engine.stockNews();
    expect(first.items[0]!.direction).toBe("down");
    state.now += cfg.leadMinMinutes * 60_000;
    const later = await engine.stockNews();
    expect(state.shocks).toEqual([]);
    expect(later.items.at(-1)).toMatchObject({ status: "fizzled", moveBps: null });
  });
});
