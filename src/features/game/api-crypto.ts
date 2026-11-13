import { z } from "zod";
import { rpc } from "./rpc";
import type { CoinDetail, CoinRow, CryptoEvent, CryptoMarket, GameEngine, GameErrorKey, MyCoin } from "./types";

/*
 * Live engine part for cryptocurrencies and own coins (ADR-101, docs/DATA_MODEL.md "Nachtrag: M5a").
 */

const num = z.number();
const iso = z.string();
const band = z.enum(["risky", "shaky", "blank", "reliable", "rock"]);
const logo = z.object({ palette: z.array(z.string()), grid: z.array(z.string()) });
const stats = z.object({ tech: num, hype: num, utility: num });

const coinRowSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  category: z.enum(["stable", "major", "alt", "meme", "player"]),
  status: z.enum(["draft", "listed", "dead", "closed"]),
  // Drafts have no price yet.
  price_e4: num.nullable().transform((v) => v ?? 0),
  change_24h_bps: num.default(0),
  high_24h_e4: num
    .nullable()
    .default(null)
    .transform((v) => v ?? 0),
  low_24h_e4: num
    .nullable()
    .default(null)
    .transform((v) => v ?? 0),
  pool_cents: num,
  market_cap_cents: num.default(0),
  volume_24h_cents: num.default(0),
  fee_bps: num,
  color: z.string(),
  logo: logo.nullable().default(null),
  creator: z
    .object({
      nickname: z.string(),
      tag: z.string().nullable().default(null),
      trust: z.object({ score: num, band }),
    })
    .nullable()
    .default(null),
  stats: stats.nullable().default(null),
  my_quantity_e6: num.default(0),
});

// Market-wide events carry no coin (ticker and name null).
const eventSchema = z.object({
  ticker: z.string().nullable(),
  name: z.string().nullable(),
  key: z.string(),
  shock_bps: num.nullable(),
  at: iso,
  payload: z.record(z.string(), z.unknown()).default({}),
});

const coinDetailSchema = coinRowSchema.extend({
  pool: z.object({ cash_cents: num, tokens_e6: num }),
  supply_e6: num,
  team_tokens_e6: num.nullable().default(null),
  holders: num.default(0),
  my_position: z.object({ quantity_e6: num, avg_price_e4: num, value_cents: num }).nullable().default(null),
  events: z.array(eventSchema).default([]),
});

const actionKey = z.enum([
  "smart_contract",
  "audit",
  "community",
  "influencer",
  "partnership",
  "staking",
  "bugfix",
  "marketing_burn",
]);

const myCoinSchema = coinRowSchema.extend({
  id: z.string(),
  stats,
  action: z.object({ key: actionKey, started_at: iso, ends_at: iso }).nullable().default(null),
  actions: z
    .array(z.object({ key: actionKey, cost_cents: num, hours: num, success_bps: num, available: z.boolean() }))
    .default([]),
  team_tokens_e6: num.default(0),
  team_at_launch_e6: num.default(0),
  team_sold_window_e6: num.default(0),
  rug_limit_e6: num.default(0),
  launch: z
    .object({ start_price_e4: num, liquidity_cents: num, team_share_bps: num, at: iso })
    .nullable()
    .default(null),
  created_at: iso,
  burn_hype: num.default(0),
  burn_min_e6: num.default(1),
  burn_available_at: iso.nullable().default(null),
});

export const CRYPTO_RPC_SCHEMAS = {
  get_crypto_market: z.object({
    regime: z.object({ kind: z.enum(["bull", "flat", "bear"]), until: iso }),
    coins: z.array(coinRowSchema),
    events: z.array(eventSchema).default([]),
  }),
  get_coin: coinDetailSchema,
  crypto_trade: z.object({
    side: z.enum(["buy", "sell"]),
    ticker: z.string(),
    quantity_e6: num,
    cash_cents: num,
    fee_cents: num,
    price_e4: num,
    avg_price_e4: num,
    position_e6: num,
    cash_after_cents: num,
    tax_cents: num.default(0),
    xp_awarded: num.default(0),
    rug_pull: z.boolean().default(false),
  }),
  get_my_coin: z.object({ coin: myCoinSchema.nullable() }),
  check_coin_name: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
  create_coin: myCoinSchema,
  start_coin_action: myCoinSchema,
  launch_coin: myCoinSchema,
  burn_coin_tokens: myCoinSchema,
  discontinue_coin: myCoinSchema,
} as const;

const S = CRYPTO_RPC_SCHEMAS;

const toEvent = (e: z.infer<typeof eventSchema>): CryptoEvent => ({
  ticker: e.ticker ?? "*",
  name: e.name ?? "",
  key: e.key,
  shockBps: e.shock_bps ?? 0,
  at: e.at,
  payload: e.payload,
});

const toRow = (c: z.infer<typeof coinRowSchema>): CoinRow => ({
  ticker: c.ticker,
  name: c.name,
  category: c.category,
  status: c.status,
  priceE4: c.price_e4,
  change24hBps: c.change_24h_bps,
  high24hE4: c.high_24h_e4,
  low24hE4: c.low_24h_e4,
  poolCents: c.pool_cents,
  marketCapCents: c.market_cap_cents,
  volume24hCents: c.volume_24h_cents,
  feeBps: c.fee_bps,
  color: c.color,
  logo: c.logo,
  creator: c.creator ? { nickname: c.creator.nickname, tag: c.creator.tag, trust: c.creator.trust } : null,
  stats: c.stats,
  myQuantityE6: c.my_quantity_e6,
});

const toMyCoin = (c: z.infer<typeof myCoinSchema>): MyCoin => ({
  ...toRow(c),
  id: c.id,
  stats: c.stats,
  action: c.action ? { key: c.action.key, startedAt: c.action.started_at, endsAt: c.action.ends_at } : null,
  actions: c.actions.map((a) => ({
    key: a.key,
    costCents: a.cost_cents,
    hours: a.hours,
    successBps: a.success_bps,
    available: a.available,
  })),
  teamTokensE6: c.team_tokens_e6,
  teamAtLaunchE6: c.team_at_launch_e6,
  teamSoldWindowE6: c.team_sold_window_e6,
  rugLimitE6: c.rug_limit_e6,
  launch: c.launch
    ? {
        startPriceE4: c.launch.start_price_e4,
        liquidityCents: c.launch.liquidity_cents,
        teamShareBps: c.launch.team_share_bps,
        at: c.launch.at,
      }
    : null,
  createdAt: c.created_at,
  burnHype: c.burn_hype,
  burnMinE6: c.burn_min_e6,
  burnAvailableAt: c.burn_available_at,
});

type CryptoEngine = Pick<
  GameEngine,
  | "cryptoMarket"
  | "coin"
  | "cryptoTrade"
  | "myCoin"
  | "checkCoinName"
  | "createCoin"
  | "startCoinAction"
  | "launchCoin"
  | "burnCoinTokens"
  | "discontinueCoin"
>;

export const liveCryptoEngine: CryptoEngine = {
  async cryptoMarket(): Promise<CryptoMarket> {
    const r = await rpc("get_crypto_market", {}, S.get_crypto_market);
    return { regime: r.regime, coins: r.coins.map(toRow), events: r.events.map(toEvent) };
  },

  async coin(ticker): Promise<CoinDetail> {
    const c = await rpc("get_coin", { p_ticker: ticker }, S.get_coin);
    return {
      ...toRow(c),
      pool: { cashCents: c.pool.cash_cents, tokensE6: c.pool.tokens_e6 },
      supplyE6: c.supply_e6,
      teamTokensE6: c.team_tokens_e6,
      holders: c.holders,
      myPosition: c.my_position
        ? {
            quantityE6: c.my_position.quantity_e6,
            avgPriceE4: c.my_position.avg_price_e4,
            valueCents: c.my_position.value_cents,
          }
        : null,
      events: c.events.map(toEvent),
    };
  },

  async cryptoTrade(input) {
    const r = await rpc(
      "crypto_trade",
      {
        p_request_id: input.requestId,
        p_ticker: input.ticker,
        p_side: input.side,
        p_amount_cents: input.amountCents ?? null,
        p_quantity_e6: input.quantityE6 ?? null,
        p_max_slippage_bps: input.maxSlippageBps,
      },
      S.crypto_trade,
    );
    return {
      side: r.side,
      ticker: r.ticker,
      quantityE6: r.quantity_e6,
      cashCents: r.cash_cents,
      feeCents: r.fee_cents,
      priceE4: r.price_e4,
      avgPriceE4: r.avg_price_e4,
      positionE6: r.position_e6,
      cashAfterCents: r.cash_after_cents,
      taxCents: r.tax_cents,
      xpAwarded: r.xp_awarded,
      rugPull: r.rug_pull,
    };
  },

  async myCoin() {
    const r = await rpc("get_my_coin", {}, S.get_my_coin);
    return r.coin ? toMyCoin(r.coin) : null;
  },

  async checkCoinName(name, ticker) {
    const r = await rpc("check_coin_name", { p_name: name, p_ticker: ticker }, S.check_coin_name);
    return { allowed: r.allowed, reason: r.reason as GameErrorKey | null };
  },

  async createCoin(requestId, name, ticker, logoData) {
    return toMyCoin(
      await rpc(
        "create_coin",
        { p_request_id: requestId, p_name: name, p_ticker: ticker, p_logo: logoData },
        S.create_coin,
      ),
    );
  },

  async startCoinAction(requestId, action) {
    return toMyCoin(await rpc("start_coin_action", { p_request_id: requestId, p_action: action }, S.start_coin_action));
  },

  async launchCoin(requestId, startPriceE4, liquidityCents, teamShareBps) {
    return toMyCoin(
      await rpc(
        "launch_coin",
        {
          p_request_id: requestId,
          p_start_price_e4: startPriceE4,
          p_liquidity_cents: liquidityCents,
          p_team_share_bps: teamShareBps,
        },
        S.launch_coin,
      ),
    );
  },

  async burnCoinTokens(requestId, quantityE6) {
    return toMyCoin(
      await rpc("burn_coin_tokens", { p_request_id: requestId, p_quantity_e6: quantityE6 }, S.burn_coin_tokens),
    );
  },

  async discontinueCoin(requestId) {
    return toMyCoin(await rpc("discontinue_coin", { p_request_id: requestId }, S.discontinue_coin));
  },
};
