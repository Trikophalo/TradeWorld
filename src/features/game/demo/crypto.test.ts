import { describe, expect, it, vi } from "vitest";
import { BALANCE } from "@/config/balance";
import { createCryptoEngine, type CryptoHost, type DemoCryptoState } from "./crypto";

const LOGO = {
  palette: ["#000000", "#f2c14e"],
  grid: Array.from({ length: 16 }, (_, y) => (y > 3 && y < 12 ? "0000111111110000" : "0".repeat(16))),
};

function setup(level = 20, cash = 100_000_000) {
  let state: DemoCryptoState | undefined;
  const wallet = { cash };
  const host: CryptoHost = {
    state: () => state,
    setState: (s) => {
      state = s;
    },
    level: () => level,
    nickname: () => "Tester",
    tag: () => "0001",
    trust: () => ({ score: 50, band: "blank" }),
    cashCents: () => wallet.cash,
    pay: (c) => {
      wallet.cash -= c;
    },
    income: (c) => {
      wallet.cash += c;
    },
    realize: () => 0,
    tradeXp: () => 0,
    itScore: () => 10,
    feeDiscountBps: () => 0,
    profane: (name) => name.toLowerCase().includes("mist"),
    takenTickers: () => ["NOVA"],
    rugPull: vi.fn(),
    feed: vi.fn(),
    idempotent: (_id, run) => run(),
    persist: () => {},
  };
  const engine = createCryptoEngine(host);
  return { engine, host, wallet, state: () => state! };
}

describe("demo crypto market", () => {
  it("starts with every coin and a day of history", async () => {
    const { engine } = setup();
    const market = await engine.engine.cryptoMarket();
    expect(market.coins).toHaveLength(BALANCE.crypto.coins.length);
    for (const c of market.coins) expect(c.priceE4).toBeGreaterThan(0);
    const candles = engine.candles("KTL", "1h", 48);
    expect(candles.length).toBeGreaterThan(20);
  });

  it("is locked below the crypto level", async () => {
    const { engine } = setup(BALANCE.crypto.minLevel - 1);
    await expect(engine.engine.cryptoMarket()).rejects.toThrow("locked");
  });

  it("buys and sells against the pool, the price moves with the trade", async () => {
    const { engine, wallet } = setup();
    const before = (await engine.engine.coin("FLX")).priceE4;
    const buy = await engine.engine.cryptoTrade({
      requestId: "a",
      ticker: "FLX",
      side: "buy",
      amountCents: 1_000_000,
      maxSlippageBps: 500,
    });
    expect(buy.quantityE6).toBeGreaterThan(0);
    expect(buy.priceE4).toBeGreaterThan(before);
    expect(wallet.cash).toBe(100_000_000 - 1_000_000);
    expect(buy.feeCents).toBeGreaterThan(BALANCE.trading.orderFeeCents);
    const sell = await engine.engine.cryptoTrade({
      requestId: "b",
      ticker: "FLX",
      side: "sell",
      quantityE6: buy.quantityE6,
      maxSlippageBps: 500,
    });
    // Two pool fees, two order fees and the price impact: a little less back.
    expect(sell.cashCents).toBeLessThan(1_000_000);
    expect(sell.cashCents).toBeGreaterThan(990_000 - 2 * BALANCE.trading.orderFeeCents);
    expect(sell.positionE6).toBe(0);
  });

  it("refuses a trade that slips too far", async () => {
    const { engine } = setup();
    await expect(
      engine.engine.cryptoTrade({
        requestId: "c",
        ticker: "PPD",
        side: "buy",
        amountCents: 5_000_000,
        maxSlippageBps: 100,
      }),
    ).rejects.toThrow("slippage_exceeded");
  });

  it("checks coin names and tickers", async () => {
    const { engine } = setup();
    expect((await engine.engine.checkCoinName("Kryptaler", "ABC")).reason).toBe("name_taken");
    expect((await engine.engine.checkCoinName("Mistcoin", "ABC")).reason).toBe("name_profanity");
    expect((await engine.engine.checkCoinName("Sternmünze", "NOVA")).reason).toBe("ticker_taken");
    expect((await engine.engine.checkCoinName("Sternmünze", "a1")).reason).toBe("invalid_argument");
    expect((await engine.engine.checkCoinName("Sternmünze", "STRN")).allowed).toBe(true);
  });

  it("creates, launches and rugs an own coin", async () => {
    const { engine, host, state } = setup();
    const created = await engine.engine.createCoin("d", "Sternmünze", "STRN", LOGO);
    expect(created.status).toBe("draft");
    await expect(engine.engine.launchCoin("e", 1_000, 1_000_000, 2_000)).rejects.toThrow("coin_tech_too_low");
    state().mine!.stats = { tech: 40, hype: 20, utility: 0 };
    const launched = await engine.engine.launchCoin("f", 1_000, 1_000_000, 2_000);
    expect(launched.status).toBe("listed");
    expect(launched.teamTokensE6).toBeGreaterThan(0);
    // Team share: team / (pool + team) = 20 %.
    const detail = await engine.engine.coin("STRN");
    expect(Math.round((launched.teamTokensE6 / detail.supplyE6) * 100)).toBe(20);
    await expect(engine.engine.createCoin("g", "Zweitmünze", "ZWEI", LOGO)).rejects.toThrow("coin_exists");

    await engine.engine.cryptoTrade({
      requestId: "h",
      ticker: "STRN",
      side: "sell",
      quantityE6: Math.floor(launched.teamTokensE6 / 2),
      maxSlippageBps: 10_000,
    });
    expect(host.rugPull).toHaveBeenCalledTimes(1);
    expect((await engine.engine.myCoin())!.stats.hype).toBe(0);

    const closed = await engine.engine.discontinueCoin("i");
    expect(closed.status).toBe("closed");
    expect(await engine.engine.myCoin()).toBeNull();
    expect((await engine.engine.checkCoinName("Sternmünze", "STRN")).allowed).toBe(true);
  });
});
