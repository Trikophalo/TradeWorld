import { z } from "zod";
import type { CompanyAwareness, GameEngine } from "./types";
import { rpc } from "./rpc";

/** get_company_awareness (ADR-188): one value, its cap and why, the strength, what moved it by source. */
const parts = z.record(z.string(), z.number());
export const awarenessSchema = z.object({
  awareness: z.number(),
  cap: z.number(),
  floor: z.number(),
  tier: z.string(),
  stage: z.number(),
  expansion_level: z.number(),
  tier_cap: z.number(),
  per_stage: z.number(),
  per_expansion_level: z.number(),
  strength: z.number(),
  last_hour: z.object({ hour_start: z.string(), parts }).nullable(),
  since: parts,
  history: z.array(z.object({ hour_start: z.string(), after: z.number() })),
});

export const toAwareness = (r: z.infer<typeof awarenessSchema>): CompanyAwareness => ({
  awareness: r.awareness,
  cap: r.cap,
  floor: r.floor,
  tier: r.tier,
  stage: r.stage,
  expansionLevel: r.expansion_level,
  tierCap: r.tier_cap,
  perStage: r.per_stage,
  perExpansionLevel: r.per_expansion_level,
  strength: r.strength,
  lastHour: r.last_hour ? { hourStart: r.last_hour.hour_start, parts: r.last_hour.parts } : null,
  since: r.since,
  history: r.history.map((h) => ({ hourStart: h.hour_start, after: h.after })),
});

export const AWARENESS_RPC_SCHEMAS = {
  get_company_awareness: awarenessSchema,
} as const;

export const liveAwarenessEngine: Pick<GameEngine, "companyAwareness"> = {
  async companyAwareness() {
    return toAwareness(await rpc("get_company_awareness", {}, awarenessSchema));
  },
};
