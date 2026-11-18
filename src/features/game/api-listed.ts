import { z } from "zod";
import type { BoardMotionKind, LedgerCategory, ListedItemKind, ListedPurpose } from "@/config/listed";
import type {
  BoardMotion,
  BoardMotionInput,
  CompanyAccounting,
  CompanyBoard,
  ListedCompany,
  ListedEngine,
  ListedRestrictions,
  TaxPeriod,
} from "./listed-types";
import { rpc } from "./rpc";

/*
 * Listed player companies (ADR-167): research, benefits, satisfaction, reputation, dividends, books, taxes and the
 * board. The server sends snake_case JSON; this file checks it and hands the client its own shapes.
 */
const amounts = z.record(z.string(), z.number());
const price = z.enum(["budget", "normal", "premium"]);

const restrictionsSchema = z.object({
  payout_cap_bps: z.number().nullable(),
  payout_cap_until: z.string().nullable(),
  withdraw_block_until: z.string().nullable(),
  price_lock: price.nullable(),
  price_lock_until: z.string().nullable(),
});
const budgetSchema = z.object({ purpose: z.string(), amount_cents: z.number() });

const periodSchema = z.object({
  id: z.number(),
  kind: z.enum(["books", "late_fee"]),
  period_start: z.string(),
  period_end: z.string(),
  revenue_cents: z.number(),
  costs_cents: z.number(),
  profit_cents: z.number(),
  loss_used_cents: z.number(),
  taxable_cents: z.number(),
  rate_bps: z.number(),
  discount_cents: z.number(),
  tax_cents: z.number(),
  penalty_cents: z.number(),
  paid_cents: z.number(),
  status: z.enum(["due", "paid"]),
  closed_by: z.enum(["founder", "advisor", "finanzamt"]),
  check_correct: z.number().nullable(),
  stage: z.number(),
  due_at: z.string(),
  paid_at: z.string().nullable(),
});

const effectsSchema = z.object({
  demandBps: z.number(),
  marketBps: z.number(),
  capacityBps: z.number(),
  qualityBps: z.number(),
  awarenessBps: z.number(),
  marginBps: z.number(),
  fixedCostBps: z.number(),
  taxRateBps: z.number(),
  satisfaction: z.number(),
  reputation: z.number(),
});

const listedSchema = z.object({
  company_id: z.string(),
  name: z.string(),
  ticker: z.string().nullable(),
  cash_cents: z.number(),
  unpaid_cents: z.number(),
  reserved_cents: z.number(),
  free_cash_cents: z.number(),
  ref_revenue_cents: z.number(),
  ref_profit_cents: z.number(),
  avg_profit_cents: z.number(),
  research_started: z.number(),
  headcount: z.number(),
  founder_payout_bps: z.number(),
  reputation: z.object({
    value: z.number(),
    target: z.number(),
    demand_factor: z.number(),
    price_factor: z.number(),
    payout_ratio_bps: z.number(),
    drivers: amounts,
  }),
  satisfaction: z.object({
    value: z.number(),
    target: z.number(),
    zone: z.enum(["green", "yellow", "red"]),
    green: z.number(),
    red: z.number(),
    capacity_factor: z.number(),
    quality_add_bps: z.number(),
    red_hours: z.number(),
    drivers: amounts,
  }),
  effects: effectsSchema,
  hour: z.object({
    awareness_add: z.number(),
    quality_add: z.number(),
    demand_factor: z.number(),
    capacity_factor: z.number(),
    cogs_factor: z.number(),
    fixed_factor: z.number(),
  }),
  upkeep: amounts,
  upkeep_per_hour_cents: z.number(),
  items: z.array(
    z.object({
      key: z.string(),
      kind: z.string(),
      status: z.enum(["none", "running", "active", "paused"]),
      level: z.number(),
      max_level: z.number(),
      ready_at: z.string().nullable(),
      cooldown_until: z.string().nullable(),
      cost_cents: z.number(),
      slow_cost_cents: z.number().nullable(),
      slow_hours: z.number().nullable(),
      upkeep_cents: z.number(),
      missing: z.array(z.string()),
    }),
  ),
  budgets: z.array(budgetSchema),
  restrictions: restrictionsSchema,
  dividends: z.object({
    max_cents: z.number(),
    min_cents: z.number(),
    can_declare: z.boolean(),
    streak: z.number(),
    total_e6: z.number(),
    founder_share_bps: z.number(),
    last: z.array(
      z.object({
        id: z.number(),
        source: z.enum(["founder", "board"]),
        total_cents: z.number(),
        players_cents: z.number(),
        float_cents: z.number(),
        holders: z.number(),
        paid_at: z.string(),
      }),
    ),
  }),
  books: z.object({
    period_start: z.string(),
    revenue_cents: z.number(),
    costs_cents: z.number(),
    profit_cents: z.number(),
    by_category: amounts,
    loss_carry_cents: z.number(),
    rate_bps: z.number(),
    estimated_tax_cents: z.number(),
    receipts: z.array(z.object({ id: z.number(), key: z.string(), amount_cents: z.number() })),
    receipt_categories: z.array(z.string()),
    can_close: z.boolean(),
    done_today: z.boolean(),
    hours_open: z.number(),
    stage: z.enum(["none", "open", "reminder", "late", "estimate"]),
    reminder_at: z.string(),
    late_fee_at: z.string(),
    estimate_at: z.string(),
    streak: z.number(),
    last_day: z.string().nullable(),
  }),
  taxes: z.object({
    due_cents: z.number(),
    rate_bps: z.number(),
    loss_carry_cents: z.number(),
    advisor: z.boolean(),
    advisor_wage_cents: z.number(),
    advisor_discount_bps: z.number(),
    periods: z.array(periodSchema),
  }),
  history: z.array(
    z.object({
      at: z.string(),
      satisfaction: z.number(),
      reputation: z.number(),
      demand_factor: z.number(),
      capacity_factor: z.number(),
      upkeep_cents: z.number(),
    }),
  ),
  board: z.object({
    open_motions: z.number(),
    to_vote: z.number(),
    my_share_bps: z.number(),
    can_convene: z.boolean(),
  }),
});

const motionSchema = z.object({
  id: z.number(),
  kind: z.string(),
  params: z.object({
    purpose: z.string().optional(),
    amount_cents: z.number().optional(),
    bps: z.number().optional(),
    days: z.number().optional(),
    price_level: price.optional(),
  }),
  status: z.enum(["open", "passed", "rejected", "no_quorum", "cancelled"]),
  label: z.string(),
  proposer: z.string().nullable(),
  mine: z.boolean(),
  created_at: z.string(),
  closes_at: z.string(),
  closed_at: z.string().nullable(),
  yes_e6: z.number(),
  no_e6: z.number(),
  ai_e6: z.number(),
  total_e6: z.number(),
  my_vote: z.enum(["yes", "no"]).nullable(),
  votes: z.array(z.object({ nickname: z.string(), yes: z.boolean() })),
  result: z.record(z.string(), z.unknown()),
});

const boardSchema = z.object({
  company: z.object({ id: z.string(), name: z.string(), ticker: z.string().nullable(), color: z.string().nullable() }),
  is_founder: z.boolean(),
  total_e6: z.number(),
  my_e6: z.number(),
  my_share_bps: z.number(),
  float_e6: z.number(),
  min_share_bps: z.number(),
  can_convene: z.boolean(),
  can_vote: z.boolean(),
  reputation: z.number(),
  ai_votes: z.boolean(),
  cash_cents: z.number(),
  free_cash_cents: z.number(),
  holders: z.array(z.object({ nickname: z.string(), share_bps: z.number(), is_founder: z.boolean(), me: z.boolean() })),
  budgets: z.array(budgetSchema),
  restrictions: restrictionsSchema,
  founder_payout_bps: z.number(),
  motions: z.array(motionSchema),
  history: z.array(motionSchema),
});

const accountingSchema = z.object({
  cash_cents: z.number(),
  from: z.string(),
  days: z.array(
    z.object({
      day: z.string(),
      in_cents: z.number(),
      out_cents: z.number(),
      operating_cents: z.number(),
      by_category: amounts,
    }),
  ),
  totals: amounts,
  entries: z.array(
    z.object({
      id: z.number(),
      at: z.string(),
      amount_cents: z.number(),
      balance_after_cents: z.number(),
      description: z.string().nullable(),
      category: z.string(),
      item: z.string().nullable(),
    }),
  ),
  next_before: z.number().nullable(),
});

const getListedSchema = z.object({ listed: listedSchema.nullable() });
const stateSchema = z.object({ listed: listedSchema });
const dividendSchema = z.object({
  listed: listedSchema,
  dividend: z.object({ total_cents: z.number(), players_cents: z.number(), float_cents: z.number() }),
});
const booksSchema = z.object({ listed: listedSchema, period: periodSchema, paid_cents: z.number() });
const paySchema = z.object({ listed: listedSchema, paid_cents: z.number() });
const boardStateSchema = z.object({ board: boardSchema });

export const LISTED_RPC_SCHEMAS = {
  get_listed_company: getListedSchema,
  company_invest_stop: stateSchema,
  company_invest: stateSchema,
  company_declare_dividend: dividendSchema,
  company_books_close: booksSchema,
  company_tax_pay: paySchema,
  company_tax_advisor: stateSchema,
  get_company_accounting: accountingSchema,
  get_company_board: boardStateSchema,
  board_propose: boardStateSchema,
  board_vote: boardStateSchema,
} as const;

const toRestrictions = (r: z.infer<typeof restrictionsSchema>): ListedRestrictions => ({
  payoutCapBps: r.payout_cap_bps,
  payoutCapUntil: r.payout_cap_until,
  withdrawBlockUntil: r.withdraw_block_until,
  priceLock: r.price_lock,
  priceLockUntil: r.price_lock_until,
});

const toBudgets = (list: z.infer<typeof budgetSchema>[]) =>
  list.map((b) => ({ purpose: b.purpose as ListedPurpose, amountCents: b.amount_cents }));

export function toTaxPeriod(p: z.infer<typeof periodSchema>): TaxPeriod {
  return {
    id: p.id,
    kind: p.kind,
    periodStart: p.period_start,
    periodEnd: p.period_end,
    revenueCents: p.revenue_cents,
    costsCents: p.costs_cents,
    profitCents: p.profit_cents,
    lossUsedCents: p.loss_used_cents,
    taxableCents: p.taxable_cents,
    rateBps: p.rate_bps,
    discountCents: p.discount_cents,
    taxCents: p.tax_cents,
    penaltyCents: p.penalty_cents,
    paidCents: p.paid_cents,
    status: p.status,
    closedBy: p.closed_by,
    checkCorrect: p.check_correct,
    stage: p.stage,
    dueAt: p.due_at,
    paidAt: p.paid_at,
  };
}

export function toListed(r: z.infer<typeof listedSchema>): ListedCompany {
  return {
    companyId: r.company_id,
    name: r.name,
    ticker: r.ticker,
    cashCents: r.cash_cents,
    unpaidCents: r.unpaid_cents,
    reservedCents: r.reserved_cents,
    freeCashCents: r.free_cash_cents,
    refRevenueCents: r.ref_revenue_cents,
    refProfitCents: r.ref_profit_cents,
    avgProfitCents: r.avg_profit_cents,
    researchStarted: r.research_started,
    headcount: r.headcount,
    founderPayoutBps: r.founder_payout_bps,
    reputation: {
      value: r.reputation.value,
      target: r.reputation.target,
      demandFactor: r.reputation.demand_factor,
      priceFactor: r.reputation.price_factor,
      payoutRatioBps: r.reputation.payout_ratio_bps,
      drivers: r.reputation.drivers,
    },
    satisfaction: {
      value: r.satisfaction.value,
      target: r.satisfaction.target,
      zone: r.satisfaction.zone,
      green: r.satisfaction.green,
      red: r.satisfaction.red,
      capacityFactor: r.satisfaction.capacity_factor,
      qualityAddBps: r.satisfaction.quality_add_bps,
      redHours: r.satisfaction.red_hours,
      drivers: r.satisfaction.drivers,
    },
    effects: r.effects,
    hour: {
      awarenessAdd: r.hour.awareness_add,
      qualityAdd: r.hour.quality_add,
      demandFactor: r.hour.demand_factor,
      capacityFactor: r.hour.capacity_factor,
      cogsFactor: r.hour.cogs_factor,
      fixedFactor: r.hour.fixed_factor,
    },
    upkeep: r.upkeep,
    upkeepPerHourCents: r.upkeep_per_hour_cents,
    items: r.items.map((i) => ({
      key: i.key,
      kind: i.kind as ListedItemKind,
      status: i.status,
      level: i.level,
      maxLevel: i.max_level,
      readyAt: i.ready_at,
      cooldownUntil: i.cooldown_until,
      costCents: i.cost_cents,
      slowCostCents: i.slow_cost_cents,
      slowHours: i.slow_hours,
      upkeepCents: i.upkeep_cents,
      missing: i.missing,
    })),
    budgets: toBudgets(r.budgets),
    restrictions: toRestrictions(r.restrictions),
    dividends: {
      maxCents: r.dividends.max_cents,
      minCents: r.dividends.min_cents,
      canDeclare: r.dividends.can_declare,
      streak: r.dividends.streak,
      totalE6: r.dividends.total_e6,
      founderShareBps: r.dividends.founder_share_bps,
      last: r.dividends.last.map((d) => ({
        id: d.id,
        source: d.source,
        totalCents: d.total_cents,
        playersCents: d.players_cents,
        floatCents: d.float_cents,
        holders: d.holders,
        paidAt: d.paid_at,
      })),
    },
    books: {
      periodStart: r.books.period_start,
      revenueCents: r.books.revenue_cents,
      costsCents: r.books.costs_cents,
      profitCents: r.books.profit_cents,
      byCategory: r.books.by_category,
      lossCarryCents: r.books.loss_carry_cents,
      rateBps: r.books.rate_bps,
      estimatedTaxCents: r.books.estimated_tax_cents,
      receipts: r.books.receipts.map((x) => ({ id: x.id, key: x.key, amountCents: x.amount_cents })),
      receiptCategories: r.books.receipt_categories as LedgerCategory[],
      canClose: r.books.can_close,
      doneToday: r.books.done_today,
      hoursOpen: r.books.hours_open,
      stage: r.books.stage,
      reminderAt: r.books.reminder_at,
      lateFeeAt: r.books.late_fee_at,
      estimateAt: r.books.estimate_at,
      streak: r.books.streak,
      lastDay: r.books.last_day,
    },
    taxes: {
      dueCents: r.taxes.due_cents,
      rateBps: r.taxes.rate_bps,
      lossCarryCents: r.taxes.loss_carry_cents,
      advisor: r.taxes.advisor,
      advisorWageCents: r.taxes.advisor_wage_cents,
      advisorDiscountBps: r.taxes.advisor_discount_bps,
      periods: r.taxes.periods.map(toTaxPeriod),
    },
    history: r.history.map((h) => ({
      at: h.at,
      satisfaction: h.satisfaction,
      reputation: h.reputation,
      demandFactor: h.demand_factor,
      capacityFactor: h.capacity_factor,
      upkeepCents: h.upkeep_cents,
    })),
    board: {
      openMotions: r.board.open_motions,
      toVote: r.board.to_vote,
      myShareBps: r.board.my_share_bps,
      canConvene: r.board.can_convene,
    },
  };
}

function toMotion(m: z.infer<typeof motionSchema>): BoardMotion {
  return {
    id: m.id,
    kind: m.kind as BoardMotionKind,
    params: {
      purpose: m.params.purpose as ListedPurpose | undefined,
      amountCents: m.params.amount_cents,
      bps: m.params.bps,
      days: m.params.days,
      priceLevel: m.params.price_level,
    },
    status: m.status,
    label: m.label,
    proposer: m.proposer,
    mine: m.mine,
    createdAt: m.created_at,
    closesAt: m.closes_at,
    closedAt: m.closed_at,
    yesE6: m.yes_e6,
    noE6: m.no_e6,
    aiE6: m.ai_e6,
    totalE6: m.total_e6,
    myVote: m.my_vote,
    votes: m.votes,
    result: m.result,
  };
}

export function toBoard(b: z.infer<typeof boardSchema>): CompanyBoard {
  return {
    company: b.company,
    isFounder: b.is_founder,
    totalE6: b.total_e6,
    myE6: b.my_e6,
    myShareBps: b.my_share_bps,
    floatE6: b.float_e6,
    minShareBps: b.min_share_bps,
    canConvene: b.can_convene,
    canVote: b.can_vote,
    reputation: b.reputation,
    aiVotes: b.ai_votes,
    cashCents: b.cash_cents,
    freeCashCents: b.free_cash_cents,
    holders: b.holders.map((h) => ({ nickname: h.nickname, shareBps: h.share_bps, isFounder: h.is_founder, me: h.me })),
    budgets: toBudgets(b.budgets),
    restrictions: toRestrictions(b.restrictions),
    founderPayoutBps: b.founder_payout_bps,
    motions: b.motions.map(toMotion),
    history: b.history.map(toMotion),
  };
}

export function toAccounting(r: z.infer<typeof accountingSchema>): CompanyAccounting {
  return {
    cashCents: r.cash_cents,
    from: r.from,
    days: r.days.map((d) => ({
      day: d.day,
      inCents: d.in_cents,
      outCents: d.out_cents,
      operatingCents: d.operating_cents,
      byCategory: d.by_category,
    })),
    totals: r.totals,
    entries: r.entries.map((e) => ({
      id: e.id,
      at: e.at,
      amountCents: e.amount_cents,
      balanceAfterCents: e.balance_after_cents,
      description: e.description,
      category: e.category as LedgerCategory,
      item: e.item,
    })),
    nextBefore: r.next_before,
  };
}

/** The motion as the server's params (snake_case). */
export function motionParams(motion: BoardMotionInput): Record<string, unknown> {
  switch (motion.kind) {
    case "earmark":
      return { purpose: motion.purpose, amount_cents: motion.amountCents };
    case "release":
      return { purpose: motion.purpose };
    case "dividend":
    case "debt":
      return { amount_cents: motion.amountCents };
    case "payout_cap":
      return { bps: motion.bps, days: motion.days };
    case "withdraw_ban":
      return { days: motion.days };
    case "price_level":
      return { price_level: motion.priceLevel, days: motion.days };
  }
}

export const liveListedEngine: ListedEngine = {
  async listedCompany() {
    const r = await rpc("get_listed_company", {}, getListedSchema);
    return r.listed ? toListed(r.listed) : null;
  },
  async companyInvest(requestId, key, slow = false) {
    return toListed(
      (await rpc("company_invest", { p_request_id: requestId, p_key: key, p_slow: slow }, stateSchema)).listed,
    );
  },
  async companyInvestStop(requestId, key) {
    return toListed((await rpc("company_invest_stop", { p_request_id: requestId, p_key: key }, stateSchema)).listed);
  },
  async declareDividend(requestId, totalCents) {
    const r = await rpc(
      "company_declare_dividend",
      { p_request_id: requestId, p_total_cents: totalCents },
      dividendSchema,
    );
    return {
      listed: toListed(r.listed),
      dividend: {
        totalCents: r.dividend.total_cents,
        playersCents: r.dividend.players_cents,
        floatCents: r.dividend.float_cents,
      },
    };
  },
  async closeCompanyBooks(requestId, answers, pay) {
    const r = await rpc(
      "company_books_close",
      { p_request_id: requestId, p_answers: answers, p_pay: pay },
      booksSchema,
    );
    return { listed: toListed(r.listed), period: toTaxPeriod(r.period), paidCents: r.paid_cents };
  },
  async payCompanyTax(requestId) {
    const r = await rpc("company_tax_pay", { p_request_id: requestId }, paySchema);
    return { listed: toListed(r.listed), paidCents: r.paid_cents };
  },
  async setTaxAdvisor(requestId, hire) {
    return toListed((await rpc("company_tax_advisor", { p_request_id: requestId, p_hire: hire }, stateSchema)).listed);
  },
  async companyAccounting(days = 7, before = null) {
    return toAccounting(await rpc("get_company_accounting", { p_days: days, p_before: before }, accountingSchema));
  },
  async companyBoard(companyId = null) {
    return toBoard((await rpc("get_company_board", { p_company_id: companyId }, boardStateSchema)).board);
  },
  async proposeBoardMotion(requestId, companyId, motion) {
    const r = await rpc(
      "board_propose",
      { p_request_id: requestId, p_company_id: companyId, p_kind: motion.kind, p_params: motionParams(motion) },
      boardStateSchema,
    );
    return toBoard(r.board);
  },
  async voteBoardMotion(requestId, motionId, yes) {
    const r = await rpc("board_vote", { p_request_id: requestId, p_motion_id: motionId, p_yes: yes }, boardStateSchema);
    return toBoard(r.board);
  },
};
