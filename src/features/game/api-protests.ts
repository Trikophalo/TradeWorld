import { z } from "zod";
import type { GameEngine, Protests } from "./types";
import { rpc } from "./rpc";

/*
 * Protest campaigns against companies (ADR-133) against the server.
 */
const protestsSchema = z.object({
  start_cost_cents: z.number(),
  min_level: z.number(),
  protests: z.array(
    z.object({
      id: z.number(),
      kind: z.enum(["boycott", "shitstorm", "petition", "protest_march"]),
      company_id: z.string(),
      company: z.string(),
      ticker: z.string().nullable(),
      status: z.enum(["open", "hit", "fizzled", "expired"]),
      goal: z.number(),
      ai_supporters: z.number(),
      players: z.number(),
      joined: z.boolean(),
      started_by: z.string().nullable(),
      mine: z
        .boolean()
        .nullable()
        .transform((v) => v === true),
      against_me: z.boolean(),
      effect_bps: z.number().nullable(),
      created_at: z.string(),
      ends_at: z.string(),
      resolved_at: z.string().nullable(),
    }),
  ),
});

export const PROTEST_RPC_SCHEMAS = {
  get_protests: protestsSchema,
  start_protest: protestsSchema,
  join_protest: protestsSchema,
} as const;

const toProtests = (r: z.infer<typeof protestsSchema>): Protests => ({
  startCostCents: r.start_cost_cents,
  minLevel: r.min_level,
  protests: r.protests.map((p) => ({
    id: p.id,
    kind: p.kind,
    companyId: p.company_id,
    company: p.company,
    ticker: p.ticker,
    status: p.status,
    goal: p.goal,
    aiSupporters: p.ai_supporters,
    players: p.players,
    joined: p.joined,
    startedBy: p.started_by,
    mine: p.mine,
    againstMe: p.against_me,
    effectBps: p.effect_bps,
    createdAt: p.created_at,
    endsAt: p.ends_at,
    resolvedAt: p.resolved_at,
  })),
});

export const liveProtestEngine: Pick<GameEngine, "protests" | "startProtest" | "joinProtest"> = {
  async protests() {
    return toProtests(await rpc("get_protests", {}, protestsSchema));
  },
  async startProtest(requestId, companyId, kind) {
    return toProtests(
      await rpc("start_protest", { p_request_id: requestId, p_company_id: companyId, p_kind: kind }, protestsSchema),
    );
  },
  async joinProtest(requestId, protestId) {
    return toProtests(await rpc("join_protest", { p_request_id: requestId, p_protest_id: protestId }, protestsSchema));
  },
};
