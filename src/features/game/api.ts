import { z } from "zod";
import { CAREER_RPC_SCHEMAS, liveCareerEngine } from "./api-careers";
import { ARTWORK_RPC_SCHEMAS, liveArtEngine } from "./api-artworks";
import { COMPANY_RPC_SCHEMAS, liveCompanyEngine } from "./api-company";
import { FRIEND_RPC_SCHEMAS, liveFriendEngine } from "./api-friends";
import { LISTED_RPC_SCHEMAS, liveListedEngine } from "./api-listed";
import { ACCESSORY_RPC_SCHEMAS, liveAccessoryEngine } from "./api-accessories";
import { FRIEND_CHAT_RPC_SCHEMAS, liveFriendChatEngine } from "./api-friend-chats";
import { SOCIAL_RPC_SCHEMAS, liveSocialEngine } from "./api-social";
import { COMPANY_EVENT_RPC_SCHEMAS, liveCompanyEventEngine } from "./api-company-events";
import { CRYPTO_RPC_SCHEMAS, liveCryptoEngine } from "./api-crypto";
import { DEAL_RPC_SCHEMAS, liveDealEngine } from "./api-deals";
import { PROPERTY_RPC_SCHEMAS, livePropertyEngine } from "./api-property";
import { RENTAL_RPC_SCHEMAS, liveRentalEngine } from "./api-rentals";
import { TASK_RPC_SCHEMAS, liveTaskEngine } from "./api-tasks";
import { AWARENESS_RPC_SCHEMAS, liveAwarenessEngine } from "./api-awareness";
import { PITCH_RPC_SCHEMAS, livePitchEngine } from "./api-pitches";
import { PROTEST_RPC_SCHEMAS, liveProtestEngine } from "./api-protests";
import { NEWS_SHOW_RPC_SCHEMAS, liveNewsShowEngine } from "./api-news-show";
import { NEWS_PROMO_RPC_SCHEMAS, liveNewsPromoEngine } from "./api-news-promos";
import { TOPLIST_RPC_SCHEMAS, liveToplistEngine } from "./api-toplists";
import { COMPANY_SKILLS_RPC_SCHEMAS, liveCompanySkillsEngine } from "./api-company-skills";
import { TALENT_RPC_SCHEMAS, liveTalentEngine } from "./api-talents";
import { INTERVIEW_RPC_SCHEMAS, liveInterviewEngine } from "./api-interviews";
import { TOUR_RPC_SCHEMAS, liveTourEngine } from "./api-tours";
import { NFT_RPC_SCHEMAS, liveNftEngine } from "./api-nfts";
import { FLOOR_RPC_SCHEMAS, liveFloorEngine } from "./api-floor";
import { BATTLE_RPC_SCHEMAS, liveBattleEngine } from "./api-battles";
import { NEXAMON_RPC_SCHEMAS, liveNexamonEngine } from "./api-nexamon";
import { NEXAMON_SEALED_RPC_SCHEMAS, liveNexamonSealedEngine } from "./api-nexamon-sealed";
import { PACK_BATTLE_RPC_SCHEMAS, livePackBattleEngine } from "./api-pack-battle";
import { rpc, toErrorKey } from "./rpc";
import {
  type Candle,
  type GameEngine,
  type MarketSnapshot,
  type OrderBook,
  type OrderQuote,
  type OrderResult,
  type Portfolio,
  type SecurityDetails,
  type StockFigures,
  type CompanyMoves,
  type MissionsState,
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
  kind: z.enum(["stock", "bond", "crypto"]),
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
  company_id: z.string().nullable().default(null),
  popularity: num.default(0),
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

const stockFiguresSchema = z.object({
  figures: z.array(
    z.object({
      ticker: z.string(),
      company_kind: z.enum(["ai", "player"]),
      period: z.enum(["day", "quarter"]),
      revenue_cents: num,
      profit_cents: num,
      prev_revenue_cents: nnum,
      hours: nnum,
      last_hour_at: iso.nullable(),
      last_hour_revenue_cents: nnum,
      game_year: nnum,
      quarter: nnum,
      reputation: nnum,
      awareness_bps: nnum,
      history: z.array(num),
    }),
  ),
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
      kind: z.enum(["stock", "bond", "crypto"]),
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
  requested_quantity_e6: num.optional(),
  unfilled_quantity_e6: num.optional(),
  limited_by: z.enum(["supply", "position"]).nullable().optional(),
  impact_bps: num.optional(),
});

const orderQuoteSchema = z.object({
  touch_e4: num,
  requested_quantity_e6: num,
  fill_quantity_e6: num,
  unfilled_quantity_e6: num,
  avg_price_e4: num,
  last_price_e4: num,
  gross_cents: num,
  fee_cents: num,
  tax_cents: num,
  net_cents: num,
  slippage_bps: num,
  impact_bps: num,
  limited_by: z.enum(["supply", "position"]).nullable(),
});

const progressSchema = z.object({ xp_awarded: num, level: num, xp_total: num });

const richNewsSchema = z.array(
  z.object({ published_at: iso, headline: z.string(), body: z.string().nullable(), kind: z.string() }),
);

const missionsSchema = z.object({
  server_time: iso,
  // ADR-166: one swap of the open missions per Berlin day
  reset_available: z.boolean().default(false),
  next_reset_at: iso.nullable().default(null),
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

const mapMissions = (r: z.infer<typeof missionsSchema>): MissionsState => ({
  groups: r.groups.map((g) => ({
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
  })),
  reset: { available: r.reset_available, nextAt: r.next_reset_at },
});

const checkInSchema = z.object({
  xp_awarded: num,
  streak_days: num,
  already_checked_in: z.boolean(),
  level: num,
  xp_total: num,
});

/** Response schemas per RPC, exported for the contract test against real database output. */
const companyMovesSchema = z.object({
  slots: z.number(),
  used: z.number(),
  cash_cents: z.number(),
  tier: z.string(),
  product: z.string().nullable(),
  moves: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(["cash", "awareness", "quality"]),
      risk: z.enum(["safe", "normal", "risky"]),
      branch: z.string(),
      minutes: z.number(),
      cost_cents: z.number(),
      chance_bps: z.number(),
      skill_bonus_bps: z.number(),
      payout_cents: z.number(),
      refund_cents: z.number(),
      gain: z.number(),
      available_at: z.string().nullable(),
      rest_minutes: z.number().default(0),
    }),
  ),
  running: z.array(
    z.object({
      id: z.number(),
      key: z.string(),
      started_at: z.string(),
      ends_at: z.string(),
      cost_cents: z.number(),
      chance_bps: z.number(),
    }),
  ),
  history: z.array(
    z.object({
      id: z.number(),
      key: z.string(),
      status: z.enum(["success", "failure"]),
      cost_cents: z.number(),
      payout_cents: z.number(),
      gain: z.number(),
      resolved_at: z.string(),
    }),
  ),
});

const toMoves = (r: z.infer<typeof companyMovesSchema>): CompanyMoves => ({
  slots: r.slots,
  used: r.used,
  cashCents: r.cash_cents,
  tier: r.tier,
  product: r.product,
  moves: r.moves.map((m) => ({
    key: m.key,
    kind: m.kind,
    risk: m.risk,
    branch: m.branch,
    minutes: m.minutes,
    costCents: m.cost_cents,
    chanceBps: m.chance_bps,
    skillBonusBps: m.skill_bonus_bps,
    payoutCents: m.payout_cents,
    refundCents: m.refund_cents,
    gain: m.gain,
    availableAt: m.available_at,
    restMinutes: m.rest_minutes,
  })),
  running: r.running.map((m) => ({
    id: m.id,
    key: m.key,
    startedAt: m.started_at,
    endsAt: m.ends_at,
    costCents: m.cost_cents,
    chanceBps: m.chance_bps,
  })),
  history: r.history.map((h) => ({
    id: h.id,
    key: h.key,
    status: h.status,
    costCents: h.cost_cents,
    payoutCents: h.payout_cents,
    gain: h.gain,
    resolvedAt: h.resolved_at,
  })),
});

const companyProfileSchema = z.object({
  company: z.object({
    id: z.string(),
    name: z.string(),
    ticker: z.string().nullable(),
    sector: z.string(),
    is_ai: z.boolean(),
    tier: z.string().nullable(),
    brand_color: z.string().nullable(),
    logo: z.object({ palette: z.array(z.string()), grid: z.array(z.string()) }).nullable(),
    idea: z.string().nullable(),
    founded_at: z.string(),
    listed: z.boolean(),
    price_e4: z.number().nullable(),
    change_bps: z.number().nullable(),
  }),
  founder: z.object({ nickname: z.string(), tag: z.string().nullable(), avatar_key: z.string() }).nullable(),
  facts: z.object({
    value_cents: z.number().nullable(),
    value_basis: z.enum(["market_cap", "company_value"]).nullable().default(null),
    revenue_cents: z.number().nullable(),
    profit_cents: z.number().nullable(),
    period: z.enum(["quarter", "ttm"]).nullable(),
    staff: z.number(),
    max_staff: z.number(),
    ai_workers: z.number(),
    product: z.string().nullable(),
    stage: z.number().nullable(),
    quality_bps: z.number().nullable(),
    awareness_bps: z.number().nullable(),
  }),
  members: z.array(
    z.object({
      nickname: z.string(),
      tag: z.string().nullable(),
      avatar_key: z.string(),
      tier: z.string(),
      title: z.string().nullable(),
      since: z.string(),
    }),
  ),
  news: z
    .array(
      z.object({
        headline: z.string(),
        body: z.string().nullable(),
        category: z.string(),
        published_at: z.string(),
      }),
    )
    .default([]),
});

const netWorthHistorySchema = z.object({
  points: z.array(z.object({ at: z.string(), net_worth_cents: z.number() })),
});

const holdingsSchema = z.object({
  visible: z.boolean(),
  total_cents: z.number().nullable(),
  positions: z.array(
    z.object({
      ticker: z.string(),
      name: z.string(),
      kind: z.enum(["stock", "bond", "crypto"]),
      sector: z.string().nullable(),
      quantity_e6: z.number(),
      value_cents: z.number(),
      share_bps: z.number(),
    }),
  ),
});

const stockNewsSchema = z.object({
  reliability_bps: z.number(),
  items: z.array(
    z.object({
      id: z.number(),
      ticker: z.string(),
      name: z.string(),
      headline: z.string(),
      body: z.string(),
      direction: z.enum(["up", "down"]),
      strength: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      published_at: z.string(),
      due_at: z.string(),
      status: z.enum(["open", "confirmed", "fizzled"]),
      move_bps: z.number().nullable().default(null),
    }),
  ),
});

export const RPC_SCHEMAS = {
  get_market_snapshot: snapshotSchema,
  get_candles: z.array(candleSchema),
  get_order_book: bookSchema,
  get_security_details: detailsSchema,
  get_stock_revenue: stockFiguresSchema,
  get_my_portfolio: portfolioSchema,
  place_order: orderResultSchema,
  quote_order: orderQuoteSchema,
  cancel_order: z.object({ order_id: z.string(), status: z.literal("cancelled") }),
  claim_vault: z.object({ claimed_cents: num, cash_cents: num }),
  complete_tutorial: progressSchema,
  get_rich_list_news: richNewsSchema,
  check_nickname: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
  change_nickname: z.object({ nickname: z.string(), changed_at: iso, next_change_at: iso }),
  reset_account: z.object({ ok: z.literal(true), reset_at: iso }),
  delete_account: z.object({ ok: z.literal(true) }),
  get_my_missions: missionsSchema,
  reset_missions: missionsSchema,
  claim_mission: progressSchema,
  daily_check_in: checkInSchema,
  track_event: z.object({ ok: z.boolean() }),
  record_security_view: z.object({ counted: z.boolean() }),
  ...CAREER_RPC_SCHEMAS,
  ...NEWS_PROMO_RPC_SCHEMAS,
  ...TOPLIST_RPC_SCHEMAS,
  ...COMPANY_SKILLS_RPC_SCHEMAS,
  ...TALENT_RPC_SCHEMAS,
  ...COMPANY_RPC_SCHEMAS,
  ...ARTWORK_RPC_SCHEMAS,
  ...PROPERTY_RPC_SCHEMAS,
  ...RENTAL_RPC_SCHEMAS,
  ...TASK_RPC_SCHEMAS,
  ...AWARENESS_RPC_SCHEMAS,
  ...PITCH_RPC_SCHEMAS,
  ...PROTEST_RPC_SCHEMAS,
  ...TOUR_RPC_SCHEMAS,
  ...NEWS_SHOW_RPC_SCHEMAS,
  ...INTERVIEW_RPC_SCHEMAS,
  ...NFT_RPC_SCHEMAS,
  ...FLOOR_RPC_SCHEMAS,
  ...BATTLE_RPC_SCHEMAS,
  ...NEXAMON_RPC_SCHEMAS,
  ...NEXAMON_SEALED_RPC_SCHEMAS,
  ...PACK_BATTLE_RPC_SCHEMAS,
  get_stock_news: stockNewsSchema,
  get_player_holdings: holdingsSchema,
  get_my_net_worth_history: netWorthHistorySchema,
  get_company_profile: companyProfileSchema,
  get_company_moves: companyMovesSchema,
  start_company_move: companyMovesSchema,
  ...FRIEND_RPC_SCHEMAS,
  ...ACCESSORY_RPC_SCHEMAS,
  ...FRIEND_CHAT_RPC_SCHEMAS,
  ...LISTED_RPC_SCHEMAS,
  ...SOCIAL_RPC_SCHEMAS,
  ...COMPANY_EVENT_RPC_SCHEMAS,
  ...DEAL_RPC_SCHEMAS,
  ...CRYPTO_RPC_SCHEMAS,
} as const;

export const liveEngine: GameEngine = {
  ...liveTaskEngine,
  ...liveAwarenessEngine,
  ...livePitchEngine,
  ...liveProtestEngine,
  ...liveTourEngine,
  ...liveNewsShowEngine,
  ...liveNewsPromoEngine,
  ...liveToplistEngine,
  ...liveCompanySkillsEngine,
  ...liveTalentEngine,
  ...liveInterviewEngine,
  ...liveBattleEngine,
  ...liveNexamonEngine,
  ...liveNexamonSealedEngine,
  ...livePackBattleEngine,
  ...liveCareerEngine,
  ...liveCompanyEngine,
  ...liveArtEngine,
  ...liveNftEngine,
  ...liveFloorEngine,
  ...livePropertyEngine,
  ...liveRentalEngine,
  ...liveFriendEngine,
  ...liveAccessoryEngine,
  ...liveFriendChatEngine,
  ...liveListedEngine,
  async companyMoves() {
    return toMoves(await rpc("get_company_moves", {}, companyMovesSchema));
  },
  async startCompanyMove(requestId, key) {
    return toMoves(await rpc("start_company_move", { p_request_id: requestId, p_key: key }, companyMovesSchema));
  },
  async companyProfile(companyId) {
    const r = await rpc("get_company_profile", { p_company_id: companyId }, companyProfileSchema);
    const c = r.company;
    const f = r.facts;
    return {
      company: {
        id: c.id,
        name: c.name,
        ticker: c.ticker,
        sector: c.sector,
        isAi: c.is_ai,
        tier: c.tier,
        brandColor: c.brand_color,
        logo: c.logo,
        idea: c.idea,
        foundedAt: c.founded_at,
        listed: c.listed,
        priceE4: c.price_e4,
        changeBps: c.change_bps,
      },
      founder: r.founder ? { nickname: r.founder.nickname, tag: r.founder.tag, avatarKey: r.founder.avatar_key } : null,
      facts: {
        valueCents: f.value_cents,
        valueBasis: f.value_basis,
        revenueCents: f.revenue_cents,
        profitCents: f.profit_cents,
        period: f.period,
        staff: f.staff,
        maxStaff: f.max_staff,
        aiWorkers: f.ai_workers,
        product: f.product,
        stage: f.stage,
        qualityBps: f.quality_bps,
        awarenessBps: f.awareness_bps,
      },
      members: r.members.map((m) => ({
        nickname: m.nickname,
        tag: m.tag,
        avatarKey: m.avatar_key,
        tier: m.tier,
        title: m.title,
        since: m.since,
      })),
      news: r.news.map((n) => ({
        headline: n.headline,
        body: n.body,
        category: n.category,
        publishedAt: n.published_at,
      })),
    };
  },
  async netWorthHistory(hours) {
    const r = await rpc("get_my_net_worth_history", { p_hours: hours }, netWorthHistorySchema);
    return r.points.map((p) => ({ at: p.at, netWorthCents: p.net_worth_cents }));
  },
  async playerHoldings(nickname) {
    const r = await rpc("get_player_holdings", { p_nickname: nickname }, holdingsSchema);
    return {
      visible: r.visible,
      totalCents: r.total_cents,
      positions: r.positions.map((p) => ({
        ticker: p.ticker,
        name: p.name,
        kind: p.kind,
        sector: p.sector,
        quantityE6: p.quantity_e6,
        valueCents: p.value_cents,
        shareBps: p.share_bps,
      })),
    };
  },
  async stockNews(limit = 20) {
    const r = await rpc("get_stock_news", { p_limit: limit }, stockNewsSchema);
    return {
      reliabilityBps: r.reliability_bps,
      items: r.items.map((i) => ({
        id: i.id,
        ticker: i.ticker,
        name: i.name,
        headline: i.headline,
        body: i.body,
        direction: i.direction,
        strength: i.strength,
        publishedAt: i.published_at,
        dueAt: i.due_at,
        status: i.status,
        moveBps: i.move_bps,
      })),
    };
  },
  ...liveSocialEngine,
  ...liveCompanyEventEngine,
  ...liveDealEngine,
  ...liveCryptoEngine,
  async recordView(requestId, ticker) {
    const r = await rpc(
      "record_security_view",
      { p_request_id: requestId, p_ticker: ticker },
      z.object({ counted: z.boolean() }),
    );
    return r.counted;
  },
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
        companyId: x.company_id,
        popularity: x.popularity,
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

  async stockFigures(ticker): Promise<StockFigures[]> {
    const r = await rpc("get_stock_revenue", ticker ? { p_ticker: ticker } : {}, stockFiguresSchema);
    return r.figures.map((f) => ({
      ticker: f.ticker,
      companyKind: f.company_kind,
      period: f.period,
      revenueCents: f.revenue_cents,
      profitCents: f.profit_cents,
      prevRevenueCents: f.prev_revenue_cents,
      hours: f.hours,
      lastHourAt: f.last_hour_at,
      lastHourRevenueCents: f.last_hour_revenue_cents,
      gameYear: f.game_year,
      quarter: f.quarter,
      reputation: f.reputation,
      awarenessBps: f.awareness_bps,
      history: f.history,
    }));
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
      requestedQuantityE6: r.requested_quantity_e6,
      unfilledQuantityE6: r.unfilled_quantity_e6,
      limitedBy: r.limited_by ?? null,
      impactBps: r.impact_bps,
    };
  },

  async quoteOrder(input): Promise<OrderQuote> {
    const r = await rpc(
      "quote_order",
      {
        p_ticker: input.ticker,
        p_side: input.side,
        p_quantity_e6: input.quantityE6 ?? null,
        p_amount_cents: input.amountCents ?? null,
      },
      orderQuoteSchema,
    );
    return {
      touchE4: r.touch_e4,
      requestedQuantityE6: r.requested_quantity_e6,
      fillQuantityE6: r.fill_quantity_e6,
      unfilledQuantityE6: r.unfilled_quantity_e6,
      avgPriceE4: r.avg_price_e4,
      lastPriceE4: r.last_price_e4,
      grossCents: r.gross_cents,
      feeCents: r.fee_cents,
      taxCents: r.tax_cents,
      netCents: r.net_cents,
      slippageBps: r.slippage_bps,
      impactBps: r.impact_bps,
      limitedBy: r.limited_by,
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

  async richNews(limit) {
    const rows = await rpc("get_rich_list_news", { p_limit: limit }, richNewsSchema);
    return rows.map((n) => ({ publishedAt: n.published_at, headline: n.headline, body: n.body, kind: n.kind }));
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
    return mapMissions(await rpc("get_my_missions", {}, missionsSchema));
  },

  async resetMissions(requestId) {
    return mapMissions(await rpc("reset_missions", { p_request_id: requestId }, missionsSchema));
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
    const send = () => rpc("track_event", { p_kind: event, p_ref: ref ?? null }, z.object({ ok: z.boolean() }));
    // Right after a page load the session may not be ready yet: try once more a little later, then give up quietly.
    await send().catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await send().catch(() => undefined);
    });
  },
};
