import { z } from "zod";
import type { CompanyOffices, GameEngine } from "./types";
import { rpc } from "./rpc";

/*
 * Büroflächen (ADR-218): get_company_offices() and buy_company_office(request_id). All numbers come from the server.
 */
const num = z.number();
export const officesSchema = z.object({
  level: num,
  steps: num,
  tier: z.string(),
  seats: z.object({
    tier: num,
    expansion: num,
    headquarters: num,
    offices: num,
    total: num,
    max: num,
    used: num,
  }),
  rent_cents_per_hour: num,
  worth_cents: num,
  free_cash_cents: num,
  next: z
    .object({
      n: num,
      seats: num,
      cost_cents: num,
      min_worth_cents: num,
      tiers: z.array(z.string()),
    })
    .nullable(),
  block: z.enum(["max_level", "seats_max", "legal_form", "worth", "cash"]).nullable().catch(null),
});
const buySchema = z.object({ offices: officesSchema });

export const OFFICE_RPC_SCHEMAS = {
  get_company_offices: officesSchema,
  buy_company_office: buySchema,
} as const;

export function toOffices(r: z.infer<typeof officesSchema>): CompanyOffices {
  return {
    level: r.level,
    steps: r.steps,
    tier: r.tier,
    seats: { ...r.seats },
    rentCentsPerHour: r.rent_cents_per_hour,
    worthCents: r.worth_cents,
    freeCashCents: r.free_cash_cents,
    next: r.next
      ? {
          n: r.next.n,
          seats: r.next.seats,
          costCents: r.next.cost_cents,
          minWorthCents: r.next.min_worth_cents,
          tiers: r.next.tiers,
        }
      : null,
    block: r.block,
  };
}

export const liveOfficeEngine: Pick<GameEngine, "companyOffices" | "buyCompanyOffice"> = {
  async companyOffices() {
    return toOffices(await rpc("get_company_offices", {}, officesSchema));
  },
  async buyCompanyOffice(requestId) {
    return toOffices((await rpc("buy_company_office", { p_request_id: requestId }, buySchema)).offices);
  },
};
