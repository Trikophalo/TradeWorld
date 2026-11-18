import { z } from "zod";
import type { CompanyRisks, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * Size, risk and the world outside (ADR-209): the "Risiken" card (get_company_risks) and the insurance
 * (set_company_insurance). All numbers come from the server.
 */
const num = z.number();
const risksSchema = z.object({
  company_id: z.string(),
  worth_cents: num,
  decades: num,
  event_pivot_cents: num,
  friction_pivot_cents: num,
  saturation_bps: num,
  overhead_bps: num,
  chance_per_day_bps: num,
  crisis_share_bps: num,
  unit_cents: num,
  exposure: z.array(z.object({ archetype: z.string(), bps: num, insurable: z.boolean(), risk: z.string().nullable() })),
  upcoming: z.array(z.object({ archetype: z.string(), from_cents: num })),
  ref_revenue_cents: num,
  insurance: z.object({
    level: num,
    coverage_bps: num,
    changed_at: z.string().nullable(),
    full_from: z.string().nullable(),
    levels: z.array(
      z.object({ level: num, key: z.string(), coverage_bps: num, premium_bps: num, premium_cents_per_hour: num }),
    ),
  }),
  lobby: z.object({ level: num, max: num, bonus_bps: num, political_cut_bps: num, leader: z.boolean() }),
  country: z.object({ key: z.string(), name: z.string().nullable() }).nullable(),
});

export const MACRO_RPC_SCHEMAS = {
  get_company_risks: risksSchema,
  set_company_insurance: risksSchema,
} as const;

export function toRisks(r: z.infer<typeof risksSchema>): CompanyRisks {
  return {
    companyId: r.company_id,
    worthCents: r.worth_cents,
    decades: r.decades,
    eventPivotCents: r.event_pivot_cents,
    frictionPivotCents: r.friction_pivot_cents,
    saturationBps: r.saturation_bps,
    overheadBps: r.overhead_bps,
    chancePerDayBps: r.chance_per_day_bps,
    crisisShareBps: r.crisis_share_bps,
    unitCents: r.unit_cents,
    exposure: r.exposure.map((e) => ({ archetype: e.archetype, bps: e.bps, insurable: e.insurable, risk: e.risk })),
    upcoming: r.upcoming.map((u) => ({ archetype: u.archetype, fromCents: u.from_cents })),
    refRevenueCents: r.ref_revenue_cents,
    insurance: {
      level: r.insurance.level,
      coverageBps: r.insurance.coverage_bps,
      changedAt: r.insurance.changed_at,
      fullFrom: r.insurance.full_from,
      levels: r.insurance.levels.map((l) => ({
        level: l.level,
        key: l.key,
        coverageBps: l.coverage_bps,
        premiumBps: l.premium_bps,
        premiumCentsPerHour: l.premium_cents_per_hour,
      })),
    },
    lobby: {
      level: r.lobby.level,
      max: r.lobby.max,
      bonusBps: r.lobby.bonus_bps,
      politicalCutBps: r.lobby.political_cut_bps,
      leader: r.lobby.leader,
    },
    country: r.country ? { key: r.country.key, name: r.country.name } : null,
  };
}

export const liveMacroEngine: Pick<GameEngine, "companyRisks" | "setCompanyInsurance"> = {
  async companyRisks() {
    return toRisks(await rpc("get_company_risks", {}, risksSchema));
  },
  async setCompanyInsurance(requestId, level) {
    return toRisks(await rpc("set_company_insurance", { p_request_id: requestId, p_level: level }, risksSchema));
  },
};
