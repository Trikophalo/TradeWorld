import { z } from "zod";
import type { CompanySkillsState, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * Fertigkeiten of player companies (ADR-194), against the server.
 */
const effect = z.enum(["demand", "capacity", "cogs", "fixed", "quality"]);
const bps = z.object({
  demand: z.number(),
  capacity: z.number(),
  cogs: z.number(),
  fixed: z.number(),
  quality: z.number(),
});
const skillsSchema = z.object({
  company_id: z.string(),
  free_cash_cents: z.number(),
  skills: z.array(
    z.object({
      key: z.string(),
      branch: z.string(),
      effect,
      level: z.number(),
      max_level: z.number(),
      training_until: z.string().nullable(),
      requires: z.array(z.string()),
      next_requires: z.string().nullable(),
      missing: z.string().nullable(),
      next_cost_cents: z.number().nullable(),
      next_hours: z.number().nullable(),
      effect_bps: z.number(),
      next_effect_bps: z.number().nullable(),
    }),
  ),
  total: z.object({
    demand_bps: z.number(),
    capacity_bps: z.number(),
    cogs_bps: z.number(),
    fixed_bps: z.number(),
    quality_bps: z.number(),
  }),
  cap_bps: bps.partial(),
});

export const COMPANY_SKILLS_RPC_SCHEMAS = {
  get_company_skills: skillsSchema,
  learn_company_skill: skillsSchema,
} as const;

export function toCompanySkills(r: z.infer<typeof skillsSchema>): CompanySkillsState {
  return {
    freeCashCents: r.free_cash_cents,
    skills: r.skills.map((s) => ({
      key: s.key,
      branch: s.branch,
      effect: s.effect,
      level: s.level,
      maxLevel: s.max_level,
      trainingUntil: s.training_until,
      requires: s.requires,
      nextRequires: s.next_requires,
      missing: s.missing,
      nextCostCents: s.next_cost_cents,
      nextHours: s.next_hours,
      effectBps: s.effect_bps,
      nextEffectBps: s.next_effect_bps,
    })),
    totalBps: {
      demand: r.total.demand_bps,
      capacity: r.total.capacity_bps,
      cogs: r.total.cogs_bps,
      fixed: r.total.fixed_bps,
      quality: r.total.quality_bps,
    },
    capBps: {
      demand: r.cap_bps.demand ?? 0,
      capacity: r.cap_bps.capacity ?? 0,
      cogs: r.cap_bps.cogs ?? 0,
      fixed: r.cap_bps.fixed ?? 0,
      quality: r.cap_bps.quality ?? 0,
    },
  };
}

export const liveCompanySkillsEngine: Pick<GameEngine, "companySkills" | "learnCompanySkill"> = {
  async companySkills() {
    return toCompanySkills(await rpc("get_company_skills", {}, skillsSchema));
  },
  async learnCompanySkill(requestId, key) {
    return toCompanySkills(await rpc("learn_company_skill", { p_request_id: requestId, p_key: key }, skillsSchema));
  },
};
