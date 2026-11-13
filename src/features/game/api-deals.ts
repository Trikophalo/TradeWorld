import { z } from "zod";
import { rpc } from "./rpc";
import type { Deal, DealParty, DealsOverview, GameEngine, TrustInfo } from "./types";

/*
 * Live engine part for deals between players and trust (ADR-098, docs/DATA_MODEL.md "Nachtrag M4j").
 */

const num = z.number();
const iso = z.string();
const band = z.enum(["risky", "shaky", "blank", "reliable", "rock"]);

export const trustSchema = z.object({
  score: num,
  band,
  kept: num.nullable().default(null),
  broken: num.nullable().default(null),
});

export const toTrust = (t: z.infer<typeof trustSchema>): TrustInfo => ({
  score: t.score,
  band: t.band,
  kept: t.kept,
  broken: t.broken,
});

const partySchema = z.object({
  nickname: z.string(),
  tag: z.string().nullable().default(null),
  avatar_key: z.string(),
  level: num,
  trust: z.object({ score: num, band }),
});

const companyRef = z.object({ id: z.string(), name: z.string() }).nullable().default(null);
const optNum = num.nullable().optional();

const dealSchema = z.object({
  id: z.string(),
  kind: z.enum(["loan", "supply", "stake"]),
  status: z.enum([
    "open",
    "active",
    "overdue",
    "defaulted",
    "completed",
    "forgiven",
    "broken",
    "cancelled",
    "declined",
    "expired",
  ]),
  my_role: z.enum(["lender", "borrower", "supplier", "buyer", "investor", "company"]).nullable(),
  proposer_role: z.enum(["lender", "borrower", "supplier", "buyer", "investor", "company"]),
  is_proposer: z.boolean(),
  proposer: partySchema,
  counterparty: partySchema.nullable(),
  supplier_company: companyRef,
  buyer_company: companyRef,
  company: companyRef,
  terms: z.object({
    hours: num,
    principal_cents: optNum,
    interest_bps: optNum,
    volume_cents_per_hour: optNum,
    fee_bps: optNum,
    prepay_bps: optNum,
    amount_cents: optNum,
    share_bps: optNum,
  }),
  message: z.string().nullable().default(null),
  created_at: iso,
  expires_at: iso.nullable().default(null),
  accepted_at: iso.nullable().default(null),
  ends_at: iso.nullable().default(null),
  closed_at: iso.nullable().default(null),
  progress: z
    .object({
      due_cents: optNum,
      repaid_cents: optNum,
      left_cents: optNum,
      delivered_cents: optNum,
      needed_cents: optNum,
      fees_paid_cents: optNum,
      prepay_cents: optNum,
      prepay_left_cents: optNum,
      payouts_cents: optNum,
    })
    .default({}),
  broken_by_me: z.boolean().default(false),
});

const toParty = (p: z.infer<typeof partySchema>): DealParty => ({
  nickname: p.nickname,
  tag: p.tag,
  avatarKey: p.avatar_key,
  level: p.level,
  trust: { score: p.trust.score, band: p.trust.band },
});

/** Drops nulls, so optional terms stay absent. */
const defined = <T extends Record<string, number | null | undefined>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number")) as {
    [K in keyof T]?: number;
  };

export const toDeal = (d: z.infer<typeof dealSchema>): Deal => {
  const terms = defined(d.terms);
  const progress = defined(d.progress);
  return {
    id: d.id,
    kind: d.kind,
    status: d.status,
    myRole: d.my_role,
    proposerRole: d.proposer_role,
    isProposer: d.is_proposer,
    proposer: toParty(d.proposer),
    counterparty: d.counterparty ? toParty(d.counterparty) : null,
    supplierCompany: d.supplier_company,
    buyerCompany: d.buyer_company,
    company: d.company,
    terms: {
      hours: d.terms.hours,
      principalCents: terms.principal_cents,
      interestBps: terms.interest_bps,
      volumeCentsPerHour: terms.volume_cents_per_hour,
      feeBps: terms.fee_bps,
      prepayBps: terms.prepay_bps,
      amountCents: terms.amount_cents,
      shareBps: terms.share_bps,
    },
    message: d.message,
    createdAt: d.created_at,
    expiresAt: d.expires_at,
    acceptedAt: d.accepted_at,
    endsAt: d.ends_at,
    closedAt: d.closed_at,
    progress: {
      dueCents: progress.due_cents,
      repaidCents: progress.repaid_cents,
      leftCents: progress.left_cents,
      deliveredCents: progress.delivered_cents,
      neededCents: progress.needed_cents,
      feesPaidCents: progress.fees_paid_cents,
      prepayCents: progress.prepay_cents,
      prepayLeftCents: progress.prepay_left_cents,
      payoutsCents: progress.payouts_cents,
    },
    brokenByMe: d.broken_by_me,
  };
};

export const DEAL_RPC_SCHEMAS = {
  get_deals: z.object({
    incoming: z.array(dealSchema),
    outgoing: z.array(dealSchema),
    running: z.array(dealSchema),
    history: z.array(dealSchema),
    trust: trustSchema,
    limits: z.object({ company_deal_max_cents: num.nullable(), loan_max_cents: num }).nullable().default(null),
  }),
  get_deal_board: z.object({ offers: z.array(dealSchema) }),
  propose_deal: dealSchema,
  respond_deal: dealSchema,
  cancel_deal: dealSchema,
  break_deal: dealSchema,
  repay_loan: dealSchema,
  forgive_loan: dealSchema,
} as const;

const S = DEAL_RPC_SCHEMAS;

type DealEngine = Pick<
  GameEngine,
  "deals" | "dealBoard" | "proposeDeal" | "respondDeal" | "cancelDeal" | "breakDeal" | "repayLoan" | "forgiveLoan"
>;

export const liveDealEngine: DealEngine = {
  async deals(): Promise<DealsOverview> {
    const r = await rpc("get_deals", {}, S.get_deals);
    return {
      incoming: r.incoming.map(toDeal),
      outgoing: r.outgoing.map(toDeal),
      running: r.running.map(toDeal),
      history: r.history.map(toDeal),
      trust: toTrust(r.trust),
      limits: r.limits
        ? { companyDealMaxCents: r.limits.company_deal_max_cents, loanMaxCents: r.limits.loan_max_cents }
        : null,
    };
  },

  async dealBoard() {
    const r = await rpc("get_deal_board", {}, S.get_deal_board);
    return r.offers.map(toDeal);
  },

  async proposeDeal(input) {
    const t = input.terms;
    const terms =
      input.kind === "loan"
        ? { principal_cents: t.principalCents, interest_bps: t.interestBps, hours: t.hours }
        : input.kind === "supply"
          ? {
              volume_cents_per_hour: t.volumeCentsPerHour,
              fee_bps: t.feeBps,
              prepay_bps: t.prepayBps ?? 0,
              hours: t.hours,
            }
          : { amount_cents: t.amountCents, share_bps: t.shareBps, hours: t.hours };
    return toDeal(
      await rpc(
        "propose_deal",
        {
          p_request_id: input.requestId,
          p_kind: input.kind,
          p_role: input.role,
          p_counterparty: input.counterparty,
          p_terms: terms,
          p_message: input.message.trim() || null,
        },
        S.propose_deal,
      ),
    );
  },

  async respondDeal(requestId, dealId, accept) {
    return toDeal(
      await rpc("respond_deal", { p_request_id: requestId, p_deal_id: dealId, p_accept: accept }, S.respond_deal),
    );
  },

  async cancelDeal(requestId, dealId) {
    return toDeal(await rpc("cancel_deal", { p_request_id: requestId, p_deal_id: dealId }, S.cancel_deal));
  },

  async breakDeal(requestId, dealId) {
    return toDeal(await rpc("break_deal", { p_request_id: requestId, p_deal_id: dealId }, S.break_deal));
  },

  async repayLoan(requestId, dealId, amountCents) {
    return toDeal(
      await rpc(
        "repay_loan",
        { p_request_id: requestId, p_deal_id: dealId, p_amount_cents: amountCents },
        S.repay_loan,
      ),
    );
  },

  async forgiveLoan(requestId, dealId) {
    return toDeal(await rpc("forgive_loan", { p_request_id: requestId, p_deal_id: dealId }, S.forgive_loan));
  },
};
