import { z } from "zod";
import type { SkillBranch } from "@/config/skills";
import type { CompanyBrief, CompanyEventState, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * Company crises and chances, response steps and company news against the server (ADR-091).
 */
const num = z.number();
const iso = z.string();
const company = z.object({
  id: z.string(),
  name: z.string(),
  idea: z.string(),
  sector: z.string(),
  product_key: z.string().nullable().default(null),
  tier: z.enum(["garage", "small_business", "gmbh", "ag"]),
});
const words = z.record(z.string(), z.array(z.string())).nullable().default(null);
const step = z.object({
  idx: num,
  strategy: z.string(),
  key: z.string(),
  status: z.enum(["running", "succeeded", "failed"]),
  started_at: iso,
  ends_at: iso,
  cost_cents: num,
  success_bps: num,
  retry: z.boolean().default(false),
});
const eventSchema = z.object({
  id: z.string(),
  archetype: z.string(),
  polarity: z.enum(["crisis", "chance"]),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  status: z.enum(["open", "accepted", "solved", "in_force", "expired", "over"]),
  started_at: iso,
  deadline_at: iso,
  resolved_at: iso.nullable(),
  over_at: iso.nullable().default(null),
  strategy: z.string().nullable(),
  mitigation: num,
  ai_headline: z.string().nullable().default(null),
  ai_body: z.string().nullable().default(null),
  ai_cause: z.string().nullable().default(null),
  steps: z.array(step),
  next: z
    .object({
      strategy: z.string(),
      idx: num,
      key: z.string(),
      cost_cents: num,
      success_bps: num,
      staff_ok: z.boolean(),
      hours: num,
    })
    .nullable(),
  options: z.array(
    z.object({
      strategy: z.string(),
      first_step_cost_cents: num.nullable(),
      first_step_success_bps: num.nullable(),
    }),
  ),
});
const stateSchema = z.object({
  company,
  can_act: z.boolean(),
  unit_cents: num,
  headcount: num,
  branch_scores: z.record(z.string(), num),
  event: eventSchema.nullable(),
  history: z
    .array(
      z.object({
        id: z.string(),
        archetype: z.string(),
        polarity: z.enum(["crisis", "chance"]),
        severity: num,
        status: z.string(),
        started_at: iso,
        resolved_at: iso.nullable(),
      }),
    )
    .default([]),
  profile_words: words,
});
const newsSchema = z.object({
  company,
  profile_words: words,
  items: z.array(
    z.object({
      id: num,
      kind: z.string(),
      payload: z.record(z.string(), z.unknown()).default({}),
      created_at: iso,
      ai_headline: z.string().nullable().default(null),
      ai_body: z.string().nullable().default(null),
    }),
  ),
});

export const COMPANY_EVENT_RPC_SCHEMAS = {
  get_company_event: stateSchema,
  choose_event_strategy: stateSchema,
  start_event_step: stateSchema,
  get_company_news: newsSchema,
  company_ai_context: z
    .object({ company: z.object({ id: z.string() }).passthrough(), has_profile: z.boolean() })
    .passthrough(),
} as const;

const toCompany = (c: z.infer<typeof company>): CompanyBrief => ({
  id: c.id,
  name: c.name,
  idea: c.idea,
  sector: c.sector,
  productKey: c.product_key,
  tier: c.tier,
});

function toState(r: z.infer<typeof stateSchema>): CompanyEventState {
  const e = r.event;
  return {
    company: toCompany(r.company),
    canAct: r.can_act,
    unitCents: r.unit_cents,
    headcount: r.headcount,
    branchScores: r.branch_scores as Record<SkillBranch, number>,
    profileWords: r.profile_words,
    history: r.history.map((h) => ({
      id: h.id,
      archetype: h.archetype,
      polarity: h.polarity,
      severity: h.severity,
      status: h.status,
      startedAt: h.started_at,
      resolvedAt: h.resolved_at,
    })),
    event: e
      ? {
          id: e.id,
          archetype: e.archetype,
          polarity: e.polarity,
          severity: e.severity,
          status: e.status,
          startedAt: e.started_at,
          deadlineAt: e.deadline_at,
          resolvedAt: e.resolved_at,
          overAt: e.over_at,
          strategy: e.strategy,
          mitigation: e.mitigation,
          aiHeadline: e.ai_headline,
          aiBody: e.ai_body,
          aiCause: e.ai_cause,
          steps: e.steps.map((s) => ({
            idx: s.idx,
            strategy: s.strategy,
            key: s.key,
            status: s.status,
            startedAt: s.started_at,
            endsAt: s.ends_at,
            costCents: s.cost_cents,
            successBps: s.success_bps,
            retry: s.retry,
          })),
          next: e.next
            ? {
                strategy: e.next.strategy,
                idx: e.next.idx,
                key: e.next.key,
                costCents: e.next.cost_cents,
                successBps: e.next.success_bps,
                staffOk: e.next.staff_ok,
                hours: e.next.hours,
              }
            : null,
          options: e.options.map((o) => ({
            strategy: o.strategy,
            firstStepCostCents: o.first_step_cost_cents ?? 0,
            firstStepSuccessBps: o.first_step_success_bps ?? 10_000,
          })),
        }
      : null,
  };
}

export const liveCompanyEventEngine: Pick<
  GameEngine,
  "companyEvent" | "chooseEventStrategy" | "startEventStep" | "companyNews"
> = {
  async companyEvent(companyId) {
    return toState(await rpc("get_company_event", { p_company_id: companyId ?? null }, stateSchema));
  },
  async chooseEventStrategy(requestId, eventId, strategy) {
    return toState(
      await rpc(
        "choose_event_strategy",
        { p_request_id: requestId, p_event_id: eventId, p_strategy: strategy },
        stateSchema,
      ),
    );
  },
  async startEventStep(requestId, eventId) {
    return toState(await rpc("start_event_step", { p_request_id: requestId, p_event_id: eventId }, stateSchema));
  },
  async companyNews(companyId) {
    const r = await rpc("get_company_news", { p_company_id: companyId ?? null }, newsSchema);
    return {
      company: toCompany(r.company),
      profileWords: r.profile_words,
      items: r.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        payload: i.payload,
        createdAt: i.created_at,
        aiHeadline: i.ai_headline,
        aiBody: i.ai_body,
      })),
    };
  },
};
