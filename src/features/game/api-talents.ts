import { z } from "zod";
import type { CompanyTalentsState, GameEngine, OwnTalent, Talent, TalentFacts, TalentMarketState } from "./types";
import { rpc } from "./rpc";

/*
 * Talente and Mit-Geschäftsführung (ADR-199), against the server.
 */
const effect = z.enum(["demand", "capacity", "cogs", "fixed", "quality", "awareness", "reputation", "morale"]);
const facts = z.object({
  reputation: z.number(),
  awareness_bps: z.number(),
  form_rank: z.number(),
  expansion_level: z.number(),
  free_cash_cents: z.number(),
});
const talent = z.object({
  key: z.string(),
  role: z.string(),
  tier: z.number(),
  first_name: z.string(),
  last_name: z.string(),
  avatar: z.string(),
  traits: z.array(z.string()),
  wage_demand_cents: z.number(),
  benefit_demands: z.array(z.string()),
  min_reputation: z.number(),
  min_awareness_bps: z.number(),
  min_form: z.number(),
  effect_bps: z.number(),
  status: z.enum(["available", "off_market", "resting", "employed", "mine"]),
  employer: z.object({ company_id: z.string(), name: z.string() }).nullable(),
  poach_min_cost_cents: z.number().nullable(),
  offer_pending: z.boolean(),
  resting_until: z.string().nullable(),
  is_coceo: z.boolean(),
});
const ownTalent = talent.extend({
  wage_cents: z.number(),
  benefits: z.array(z.string()),
  cost_cents: z.number(),
  hired_at: z.string(),
  satisfaction_bps: z.number(),
  warned: z.boolean(),
  coceo_autonomy: z.enum(["advise", "decide"]),
  coceo_budget_cents: z.number(),
  coceo_spent_cents: z.number(),
  wage_floor_cents: z.number(),
  raise_due_at: z.string().nullable(),
});
const bps = z.record(z.string(), z.number());
const companySchema = z.object({
  company_id: z.string(),
  facts,
  seats: z.array(z.object({ role: z.string(), effect, talent: ownTalent.nullable() })),
  effect: z.object({ bps }),
  cap_bps: bps,
  coceo_max: z.number(),
  incoming: z.array(
    z.object({
      id: z.string(),
      talent_key: z.string(),
      from_name: z.string(),
      wage_cents: z.number(),
      benefits: z.array(z.string()),
      cost_cents: z.number(),
      expires_at: z.string(),
    }),
  ),
  outgoing: z.array(
    z.object({
      id: z.string(),
      talent_key: z.string(),
      to_name: z.string(),
      cost_cents: z.number(),
      expires_at: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.number(),
      talent_key: z.string(),
      kind: z.string(),
      payload: z.record(z.string(), z.unknown()),
      cost_cents: z.number(),
      reversible: z.boolean(),
      created_at: z.string(),
    }),
  ),
  result: z.enum(["hired", "pending"]).optional(),
});
const marketSchema = z.object({
  company_id: z.string().nullable(),
  facts: facts.nullable(),
  talents: z.array(talent),
});

export const TALENT_RPC_SCHEMAS = {
  get_talent_market: marketSchema,
  get_company_talents: companySchema,
  talent_offer: companySchema,
  talent_counter: companySchema,
  talent_dismiss: companySchema,
  talent_raise: companySchema,
  talent_coceo_appoint: companySchema,
  talent_coceo_set: companySchema,
  talent_undo_decision: companySchema,
} as const;

const toFacts = (f: z.infer<typeof facts>): TalentFacts => ({
  reputation: f.reputation,
  awarenessBps: f.awareness_bps,
  formRank: f.form_rank,
  expansionLevel: f.expansion_level,
  freeCashCents: f.free_cash_cents,
});

const toTalent = (t: z.infer<typeof talent>): Talent => ({
  key: t.key,
  role: t.role,
  tier: t.tier,
  firstName: t.first_name,
  lastName: t.last_name,
  avatar: t.avatar,
  traits: t.traits,
  wageDemandCents: t.wage_demand_cents,
  benefitDemands: t.benefit_demands,
  minReputation: t.min_reputation,
  minAwarenessBps: t.min_awareness_bps,
  minForm: t.min_form,
  effectBps: t.effect_bps,
  status: t.status,
  employer: t.employer ? { companyId: t.employer.company_id, name: t.employer.name } : null,
  poachMinCostCents: t.poach_min_cost_cents,
  offerPending: t.offer_pending,
  restingUntil: t.resting_until,
  isCoCeo: t.is_coceo,
});

const toOwn = (t: z.infer<typeof ownTalent>): OwnTalent => ({
  ...toTalent(t),
  wageCents: t.wage_cents,
  benefits: t.benefits,
  costCents: t.cost_cents,
  hiredAt: t.hired_at,
  satisfactionBps: t.satisfaction_bps,
  warned: t.warned,
  coCeoAutonomy: t.coceo_autonomy,
  coCeoBudgetCents: t.coceo_budget_cents,
  coCeoSpentCents: t.coceo_spent_cents,
  wageFloorCents: t.wage_floor_cents,
  raiseDueAt: t.raise_due_at,
});

const KINDS = ["demand", "capacity", "cogs", "fixed", "quality", "awareness", "reputation", "morale"] as const;
const toBps = (r: Record<string, number>) =>
  Object.fromEntries(KINDS.map((k) => [k, r[k] ?? 0])) as CompanyTalentsState["effectBps"];

export function toCompanyTalents(r: z.infer<typeof companySchema>): CompanyTalentsState {
  return {
    facts: toFacts(r.facts),
    seats: r.seats.map((s) => ({ role: s.role, effect: s.effect, talent: s.talent ? toOwn(s.talent) : null })),
    effectBps: toBps(r.effect.bps),
    capBps: toBps(r.cap_bps),
    coCeoMax: r.coceo_max,
    incoming: r.incoming.map((o) => ({
      id: o.id,
      talentKey: o.talent_key,
      fromName: o.from_name,
      wageCents: o.wage_cents,
      benefits: o.benefits,
      costCents: o.cost_cents,
      expiresAt: o.expires_at,
    })),
    outgoing: r.outgoing.map((o) => ({
      id: o.id,
      talentKey: o.talent_key,
      toName: o.to_name,
      costCents: o.cost_cents,
      expiresAt: o.expires_at,
    })),
    events: r.events.map((e) => ({
      id: e.id,
      talentKey: e.talent_key,
      kind: e.kind,
      payload: e.payload,
      costCents: e.cost_cents,
      reversible: e.reversible,
      createdAt: e.created_at,
    })),
    result: r.result,
  };
}

export function toTalentMarket(r: z.infer<typeof marketSchema>): TalentMarketState {
  return { facts: r.facts ? toFacts(r.facts) : null, talents: r.talents.map(toTalent) };
}

type TalentEngine = Pick<
  GameEngine,
  | "talentMarket"
  | "companyTalents"
  | "offerTalent"
  | "counterTalentOffer"
  | "dismissTalent"
  | "raiseTalent"
  | "appointCoCeo"
  | "setCoCeo"
  | "undoTalentDecision"
>;

export const liveTalentEngine: TalentEngine = {
  async talentMarket(role) {
    return toTalentMarket(await rpc("get_talent_market", { p_role: role }, marketSchema));
  },
  async companyTalents() {
    return toCompanyTalents(await rpc("get_company_talents", {}, companySchema));
  },
  async offerTalent(requestId, key, wageCents, benefits) {
    return toCompanyTalents(
      await rpc(
        "talent_offer",
        { p_request_id: requestId, p_talent_key: key, p_wage_cents: wageCents, p_benefits: benefits },
        companySchema,
      ),
    );
  },
  async counterTalentOffer(requestId, offerId, wageCents, benefits) {
    return toCompanyTalents(
      await rpc(
        "talent_counter",
        { p_request_id: requestId, p_offer_id: offerId, p_wage_cents: wageCents, p_benefits: benefits },
        companySchema,
      ),
    );
  },
  async dismissTalent(requestId, key) {
    return toCompanyTalents(await rpc("talent_dismiss", { p_request_id: requestId, p_talent_key: key }, companySchema));
  },
  async raiseTalent(requestId, key, wageCents, benefits) {
    return toCompanyTalents(
      await rpc(
        "talent_raise",
        { p_request_id: requestId, p_talent_key: key, p_wage_cents: wageCents, p_benefits: benefits },
        companySchema,
      ),
    );
  },
  async appointCoCeo(requestId, key, wageCents, autonomy, budgetCents) {
    return toCompanyTalents(
      await rpc(
        "talent_coceo_appoint",
        {
          p_request_id: requestId,
          p_talent_key: key,
          p_wage_cents: wageCents,
          p_autonomy: autonomy,
          p_budget_cents: budgetCents,
        },
        companySchema,
      ),
    );
  },
  async setCoCeo(requestId, key, autonomy, budgetCents, remove) {
    return toCompanyTalents(
      await rpc(
        "talent_coceo_set",
        {
          p_request_id: requestId,
          p_talent_key: key,
          p_autonomy: autonomy,
          p_budget_cents: budgetCents,
          p_remove: remove,
        },
        companySchema,
      ),
    );
  },
  async undoTalentDecision(requestId, eventId) {
    return toCompanyTalents(
      await rpc("talent_undo_decision", { p_request_id: requestId, p_event_id: eventId }, companySchema),
    );
  },
};
