import { z } from "zod";
import { CAREER_RPC_SCHEMAS, liveCareerEngine } from "./api-careers";
import { ARTWORK_RPC_SCHEMAS, liveArtEngine } from "./api-artworks";
import { COMPANY_RPC_SCHEMAS, liveCompanyEngine } from "./api-company";
import { FRIEND_RPC_SCHEMAS, liveFriendEngine } from "./api-friends";
import { SOCIAL_RPC_SCHEMAS, liveSocialEngine } from "./api-social";
import { PROPERTY_RPC_SCHEMAS, livePropertyEngine } from "./api-property";
import { rpc, toErrorKey } from "./rpc";
import {
  type Candle,
  type GameEngine,
  type MarketSnapshot,
  type OrderBook,
  type OrderResult,
  type Portfolio,
  type SecurityDetails,
} from "./types";

/*
 * Live engine: calls the Postgres RPCs (docs/DATA_MODEL.md, "M1 API") and
 * validates every response with Zod, so a server change shows up as a clear
 * error instead of a broken screen.
 */

const num = z.number();
const nnum = z.number().nullable();
const iso = z.string();

const securitySchema = z.object({
  id: z.string(),
  ticker: z.string(),
  name: z.string(),
  kind: z.enum(["stock", "bond"]),
  sector_key: z.string().nullable(),
  size_class: z.enum(["bluechip", "midcap", "penny"]).nullable(),
  last_price_e4: num,
  bid_e4: num,
  ask_e4: num,
  prev_close_e4: num,
  change_bps: num,
  day_high_e4: num,
  day_low_e4: num,
  day_volume_e6: num,
  market_cap_cents: nnum,
  term_game_years: nnum.optional(),
  coupon_bps: nnum.optional(),
  yield_bps: nnum.optional(),
  matures_at: iso.nullable().optional(),
  face_value_cents: nnum.optional(),
  company_kind: z.enum(["ai", "player"]).default("ai"),
  logo: z
    .object({ palette: z.array(z.string()), grid: z.array(z.string()) })
    .nullable()
    .default(null),
});

const snapshotSchema = z.object({
  server_time: iso,
  tick_seq: num,
  session: z.enum(["regular", "after_hours"]),
  paused: z.boolean(),
  policy_rate_bps: num,
  index: z.object({ ticker: z.string(), name: z.string(), value_e4: num, prev_close_e4: num, change_bps: num }),
  securities: z.array(securitySchema),
  economy: z
    .object({ money_supply_cents: num, treasury_cents: num, basic_income_factor_bps: num })
    .nullable()
    .optional(),
});

const candleSchema = z.object({ t: num, o: num, h: num, l: num, c: num, v: num });
const levelSchema = z.object({ price_e4: num, quantity_e6: num, players: num });
const bookSchema = z.object({ bids: z.array(levelSchema), asks: z.array(levelSchema) });

const detailsSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  market_cap_cents: nnum,
  shares_outstanding: nnum,
  pe_x100: nnum,
  dividend_yield_bps: nnum,
  revenue_cents: nnum,
  net_income_cents: nnum,
  margin_bps: nnum,
  news: z.array(z.object({ published_at: iso, headline: z.string(), body: z.string().nullable() })),
});

const portfolioSchema = z.object({
  cash_cents: num,
  reserved_cents: num,
  positions_value_cents: num,
  total_cents: num,
  loss_pot_cents: num,
  vault: z.object({
    accrued_cents: num,
    cap_cents: num,
    rate_cents_per_hour: num,
    factor_bps: num.default(10_000),
    last_claimed_at: iso.nullable(),
    full_at: iso,
    server_time: iso,
  }),
  positions: z.array(
    z.object({
      ticker: z.string(),
      name: z.string(),
      kind: z.enum(["stock", "bond"]),
      quantity_e6: num,
      reserved_quantity_e6: num,
      avg_price_e4: num,
      last_price_e4: num,
      market_value_cents: num,
      cost_basis_cents: num,
      unrealized_pnl_cents: num,
    }),
  ),
  open_orders: z.array(
    z.object({
      id: z.string(),
      ticker: z.string(),
      side: z.enum(["buy", "sell"]),
      type: z.enum(["market", "limit"]),
      quantity_e6: num,
      filled_quantity_e6: num,
      limit_price_e4: nnum,
      status: z.string(),
      created_at: iso,
    }),
  ),
  recent_trades: z.array(
    z.object({
      id: z.string(),
      ticker: z.string(),
      side: z.enum(["buy", "sell"]),
      quantity_e6: num,
      price_e4: num,
      gross_cents: num,
      fee_cents: num,
      tax_cents: num,
      realized_pnl_cents: nnum,
      executed_at: iso,
    }),
  ),
  level: num.default(1),
  xp_total: num.default(0),
  xp_into_level: num.default(0),
  xp_for_next: num.default(0),
  tutorial_completed: z.boolean().default(false),
  nickname: z.string(),
  nickname_change_available_at: iso.nullable(),
  missions_claimable: num.default(0),
  streak_days: num.default(0),
  avatar_key: z.string().default("rookie"),
  skill_points_free: num.default(0),
  daily_reward_claimable: z.boolean().default(false),
  company_value_cents: num.default(0),
  debt_cents: num.default(0),
  debt_withholding_bps: num.default(0),
  founding_locked_until: iso.nullable().default(null),
});

const orderResultSchema = z.object({
  order_id: z.string(),
  status: z.enum(["filled", "open", "partially_filled"]),
  quantity_e6: num,
  filled_quantity_e6: num,
  avg_price_e4: nnum,
  gross_cents: num,
  fee_cents: num,
  tax_cents: num,
  realized_pnl_cents: nnum,
  cash_cents: num,
  xp_awarded: num.default(0),
  level: num.default(1),
  xp_total: num.default(0),
});

const progressSchema = z.object({ xp_awarded: num, level: num, xp_total: num });

const companyRankingSchema = z.object({
  server_time: iso,
  total: num,
  entries: z.array(
    z.object({
      rank: num,
      company_id: z.string(),
      kind: z.enum(["ai", "player"]),
      name: z.string(),
      color: z.string(),
      logo: z
        .object({ palette: z.array(z.string()), grid: z.array(z.string()) })
        .nullable()
        .default(null),
      ticker: z.string().nullable(),
      sector: z.enum(["tech", "retail", "energy", "pharma", "logistics"]).nullable(),
      tier: z.enum(["garage", "small_business", "gmbh", "ag"]).nullable(),
      founder: z.string().nullable(),
      value_cents: num,
      revenue_cents: nnum,
      team_size: nnum,
      is_mine: z.boolean(),
    }),
  ),
  mine: z.object({ rank: num, value_cents: num }).nullable(),
});

const richListSchema = z.object({
  server_time: iso,
  total: num,
  entries: z.array(
    z.object({
      rank: num,
      kind: z.enum(["player", "tycoon"]),
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      net_worth_cents: num,
      change_24h_bps: nnum,
      rank_change_24h: nnum,
      is_me: z.boolean(),
      avatar_key: z.string().nullable().default(null),
    }),
  ),
  me: z
    .object({
      rank: num,
      net_worth_cents: num,
      next: z.object({ rank: num, name: z.string(), gap_cents: num }).nullable(),
    })
    .nullable(),
});

const richNewsSchema = z.array(
  z.object({ published_at: iso, headline: z.string(), body: z.string().nullable(), kind: z.string() }),
);

const missionsSchema = z.object({
  server_time: iso,
  groups: z.array(
    z.object({
      kind: z.enum(["quick", "daily", "weekly", "milestone"]),
      resets_at: iso.nullable(),
      missions: z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          progress: num,
          target: num,
          xp: num,
          status: z.enum(["active", "completed", "claimed"]),
          expires_at: iso.nullable(),
        }),
      ),
    }),
  ),
});

const checkInSchema = z.object({
  xp_awarded: num,
  streak_days: num,
  already_checked_in: z.boolean(),
  level: num,
  xp_total: num,
});

/** Response schemas per RPC, exported for the contract test against real database output. */
export const RPC_SCHEMAS = {
  get_market_snapshot: snapshotSchema,
  get_candles: z.array(candleSchema),
  get_order_book: bookSchema,
  get_security_details: detailsSchema,
  get_my_portfolio: portfolioSchema,
  place_order: orderResultSchema,
  cancel_order: z.object({ order_id: z.string(), status: z.literal("cancelled") }),
  claim_vault: z.object({ claimed_cents: num, cash_cents: num }),
  complete_tutorial: progressSchema,
  get_rich_list: richListSchema,
  get_rich_list_news: richNewsSchema,
  get_company_ranking: companyRankingSchema,
  check_nickname: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
  change_nickname: z.object({ nickname: z.string(), changed_at: iso, next_change_at: iso }),
  reset_account: z.object({ ok: z.literal(true), reset_at: iso }),
  delete_account: z.object({ ok: z.literal(true) }),
  get_my_missions: missionsSchema,
  claim_mission: progressSchema,
  daily_check_in: checkInSchema,
  track_event: z.object({ ok: z.boolean() }),
  ...CAREER_RPC_SCHEMAS,
  ...COMPANY_RPC_SCHEMAS,
  ...ARTWORK_RPC_SCHEMAS,
  ...PROPERTY_RPC_SCHEMAS,
  ...FRIEND_RPC_SCHEMAS,
  ...SOCIAL_RPC_SCHEMAS,
} as const;

export const liveEngine: GameEngine = {
  ...liveCareerEngine,
  ...liveCompanyEngine,
  ...liveArtEngine,
  ...livePropertyEngine,
  ...liveFriendEngine,
  ...liveSocialEngine,
  async snapshot(): Promise<MarketSnapshot> {
    const s = await rpc("get_market_snapshot", {}, snapshotSchema);
    return {
      serverTime: s.server_time,
      tickSeq: s.tick_seq,
      session: s.session,
      paused: s.paused,
      policyRateBps: s.policy_rate_bps,
      index: {
        ticker: s.index.ticker,
        name: s.index.name,
        valueE4: s.index.value_e4,
        prevCloseE4: s.index.prev_close_e4,
        changeBps: s.index.change_bps,
      },
      economy: s.economy
        ? {
            moneySupplyCents: s.economy.money_supply_cents,
            treasuryCents: s.economy.treasury_cents,
            basicIncomeFactorBps: s.economy.basic_income_factor_bps,
          }
        : null,
      securities: s.securities.map((x) => ({
        id: x.id,
        ticker: x.ticker,
        name: x.name,
        kind: x.kind,
        sector: (x.sector_key as MarketSnapshot["securities"][number]["sector"]) ?? null,
        sizeClass: x.size_class,
        lastE4: x.last_price_e4,
        bidE4: x.bid_e4,
        askE4: x.ask_e4,
        prevCloseE4: x.prev_close_e4,
        changeBps: x.change_bps,
        dayHighE4: x.day_high_e4,
        dayLowE4: x.day_low_e4,
        dayVolumeE6: x.day_volume_e6,
        marketCapCents: x.market_cap_cents,
        bond:
          x.kind === "bond" && x.term_game_years != null && x.matures_at
            ? {
                termGameYears: x.term_game_years,
                couponBps: x.coupon_bps ?? 0,
                yieldBps: x.yield_bps ?? 0,
                maturesAt: x.matures_at,
                faceValueCents: x.face_value_cents ?? 10_000,
              }
            : null,
        companyKind: x.company_kind,
        logo: x.logo,
      })),
    };
  },

  async candles(ticker, interval, limit): Promise<Candle[]> {
    const rows = await rpc(
      "get_candles",
      { p_ticker: ticker, p_interval: interval, p_limit: limit },
      z.array(candleSchema),
    );
    return rows.map((c) => ({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
  },

  async orderBook(ticker, levels): Promise<OrderBook> {
    const b = await rpc("get_order_book", { p_ticker: ticker, p_levels: levels }, bookSchema);
    const map = (l: z.infer<typeof levelSchema>) => ({
      priceE4: l.price_e4,
      quantityE6: l.quantity_e6,
      players: l.players,
    });
    return { bids: b.bids.map(map), asks: b.asks.map(map) };
  },

  async details(ticker): Promise<SecurityDetails> {
    const d = await rpc("get_security_details", { p_ticker: ticker }, detailsSchema);
    return {
      ticker: d.ticker,
      name: d.name,
      description: d.description,
      marketCapCents: d.market_cap_cents,
      sharesOutstanding: d.shares_outstanding,
      peX100: d.pe_x100,
      dividendYieldBps: d.dividend_yield_bps,
      revenueCents: d.revenue_cents,
      netIncomeCents: d.net_income_cents,
      marginBps: d.margin_bps,
      news: d.news.map((n) => ({ publishedAt: n.published_at, headline: n.headline, body: n.body })),
    };
  },

  async portfolio(): Promise<Portfolio> {
    const p = await rpc("get_my_portfolio", {}, portfolioSchema);
    return {
      cashCents: p.cash_cents,
      reservedCents: p.reserved_cents,
      positionsValueCents: p.positions_value_cents,
      totalCents: p.total_cents,
      lossPotCents: p.loss_pot_cents,
      vault: {
        accruedCents: p.vault.accrued_cents,
        capCents: p.vault.cap_cents,
        rateCentsPerHour: p.vault.rate_cents_per_hour,
        factorBps: p.vault.factor_bps,
        lastClaimedAt: p.vault.last_claimed_at,
        fullAt: p.vault.full_at,
        serverTime: p.vault.server_time,
      },
      positions: p.positions.map((x) => ({
        ticker: x.ticker,
        name: x.name,
        kind: x.kind,
        quantityE6: x.quantity_e6,
        reservedQuantityE6: x.reserved_quantity_e6,
        avgPriceE4: x.avg_price_e4,
        lastPriceE4: x.last_price_e4,
        marketValueCents: x.market_value_cents,
        costBasisCents: x.cost_basis_cents,
        unrealizedPnlCents: x.unrealized_pnl_cents,
      })),
      openOrders: p.open_orders.map((o) => ({
        id: o.id,
        ticker: o.ticker,
        side: o.side,
        type: o.type,
        quantityE6: o.quantity_e6,
        filledQuantityE6: o.filled_quantity_e6,
        limitPriceE4: o.limit_price_e4,
        status: o.status,
        createdAt: o.created_at,
      })),
      recentTrades: p.recent_trades.map((t) => ({
        id: t.id,
        ticker: t.ticker,
        side: t.side,
        quantityE6: t.quantity_e6,
        priceE4: t.price_e4,
        grossCents: t.gross_cents,
        feeCents: t.fee_cents,
        taxCents: t.tax_cents,
        realizedPnlCents: t.realized_pnl_cents,
        executedAt: t.executed_at,
      })),
      level: p.level,
      xpTotal: p.xp_total,
      xpIntoLevel: p.xp_into_level,
      xpForNext: p.xp_for_next,
      tutorialCompleted: p.tutorial_completed,
      nickname: p.nickname,
      nicknameChangeAvailableAt: p.nickname_change_available_at,
      missionsClaimable: p.missions_claimable,
      streakDays: p.streak_days,
      avatarKey: p.avatar_key,
      skillPointsFree: p.skill_points_free,
      dailyRewardClaimable: p.daily_reward_claimable,
      companyValueCents: p.company_value_cents,
      debtCents: p.debt_cents,
      debtWithholdingBps: p.debt_withholding_bps,
      foundingLockedUntil: p.founding_locked_until,
    };
  },

  async placeOrder(input): Promise<OrderResult> {
    const r = await rpc(
      "place_order",
      {
        p_request_id: input.requestId,
        p_ticker: input.ticker,
        p_side: input.side,
        p_type: input.type,
        p_quantity_e6: input.quantityE6 ?? null,
        p_amount_cents: input.amountCents ?? null,
        p_limit_price_e4: input.type === "limit" ? (input.limitPriceE4 ?? null) : null,
      },
      orderResultSchema,
    );
    return {
      orderId: r.order_id,
      status: r.status,
      quantityE6: r.quantity_e6,
      filledQuantityE6: r.filled_quantity_e6,
      avgPriceE4: r.avg_price_e4,
      grossCents: r.gross_cents,
      feeCents: r.fee_cents,
      taxCents: r.tax_cents,
      realizedPnlCents: r.realized_pnl_cents,
      cashCents: r.cash_cents,
      xpAwarded: r.xp_awarded,
      level: r.level,
      xpTotal: r.xp_total,
    };
  },

  async cancelOrder(requestId, orderId) {
    await rpc("cancel_order", { p_request_id: requestId, p_order_id: orderId }, z.object({ order_id: z.string() }));
  },

  async claimVault(requestId) {
    const r = await rpc("claim_vault", { p_request_id: requestId }, z.object({ claimed_cents: num, cash_cents: num }));
    return { claimedCents: r.claimed_cents, cashCents: r.cash_cents };
  },

  async completeTutorial(requestId) {
    const r = await rpc("complete_tutorial", { p_request_id: requestId }, progressSchema);
    return { xpAwarded: r.xp_awarded, level: r.level, xpTotal: r.xp_total };
  },

  async richList(scope, limit, offset) {
    const r = await rpc("get_rich_list", { p_scope: scope, p_limit: limit, p_offset: offset }, richListSchema);
    return {
      serverTime: r.server_time,
      total: r.total,
      entries: r.entries.map((e) => ({
        rank: e.rank,
        kind: e.kind,
        id: e.id,
        name: e.name,
        description: e.description,
        netWorthCents: e.net_worth_cents,
        change24hBps: e.change_24h_bps,
        rankChange24h: e.rank_change_24h,
        isMe: e.is_me,
        avatarKey: e.avatar_key,
      })),
      me: r.me
        ? {
            rank: r.me.rank,
            netWorthCents: r.me.net_worth_cents,
            next: r.me.next ? { rank: r.me.next.rank, name: r.me.next.name, gapCents: r.me.next.gap_cents } : null,
          }
        : null,
    };
  },

  async richNews(limit) {
    const rows = await rpc("get_rich_list_news", { p_limit: limit }, richNewsSchema);
    return rows.map((n) => ({ publishedAt: n.published_at, headline: n.headline, body: n.body, kind: n.kind }));
  },

  async companyRanking(scope, limit) {
    const r = await rpc("get_company_ranking", { p_scope: scope, p_limit: limit }, companyRankingSchema);
    return {
      serverTime: r.server_time,
      total: r.total,
      entries: r.entries.map((e) => ({
        rank: e.rank,
        companyId: e.company_id,
        kind: e.kind,
        name: e.name,
        color: e.color,
        logo: e.logo,
        ticker: e.ticker,
        sector: e.sector,
        tier: e.tier,
        founder: e.founder,
        valueCents: e.value_cents,
        revenueCents: e.revenue_cents,
        teamSize: e.team_size,
        isMine: e.is_mine,
      })),
      mine: r.mine ? { rank: r.mine.rank, valueCents: r.mine.value_cents } : null,
    };
  },

  async checkNickname(nickname) {
    const r = await rpc("check_nickname", { p_nickname: nickname }, RPC_SCHEMAS.check_nickname);
    return { allowed: r.allowed, reason: r.reason ? toErrorKey(r.reason) : null };
  },

  async changeNickname(requestId, nickname) {
    const r = await rpc(
      "change_nickname",
      { p_request_id: requestId, p_nickname: nickname },
      RPC_SCHEMAS.change_nickname,
    );
    return { nickname: r.nickname, nextChangeAt: r.next_change_at };
  },

  async resetAccount(requestId, confirm) {
    await rpc("reset_account", { p_request_id: requestId, p_confirm: confirm }, RPC_SCHEMAS.reset_account);
  },

  async deleteAccount(confirm) {
    await rpc("delete_account", { p_confirm: confirm }, RPC_SCHEMAS.delete_account);
  },

  async missions() {
    const r = await rpc("get_my_missions", {}, missionsSchema);
    return r.groups.map((g) => ({
      kind: g.kind,
      resetsAt: g.resets_at,
      missions: g.missions.map((m) => ({
        id: m.id,
        key: m.key,
        title: m.title,
        description: m.description,
        progress: m.progress,
        target: m.target,
        xp: m.xp,
        status: m.status,
        expiresAt: m.expires_at,
      })),
    }));
  },

  async claimMission(requestId, missionId) {
    const r = await rpc("claim_mission", { p_request_id: requestId, p_mission_id: missionId }, progressSchema);
    return { xpAwarded: r.xp_awarded, level: r.level, xpTotal: r.xp_total };
  },

  async checkIn(requestId) {
    const r = await rpc("daily_check_in", { p_request_id: requestId }, checkInSchema);
    return {
      xpAwarded: r.xp_awarded,
      level: r.level,
      xpTotal: r.xp_total,
      streakDays: r.streak_days,
      alreadyCheckedIn: r.already_checked_in,
    };
  },

  async track(event, ref) {
    await rpc("track_event", { p_kind: event, p_ref: ref ?? null }, z.object({ ok: z.boolean() })).catch(
      () => undefined,
    );
  },
};
