import { z } from "zod";
import type { PropertyTier } from "@/config/balance";
import { propertySchema, tenantSchema, toProperty, toTenant } from "./api-property";
import type { GameEngine, RentalOffer, RentalsState, RentLimits } from "./types";
import { rpc } from "./rpc";

/*
 * Wohnwert and renting out places in the home (ADR-158) against the server.
 */
const num = z.number();
const tier = z.enum(["flat", "apartment", "house", "villa", "luxury_villa"]);
const period = z.enum(["hour", "day"]);
const noticeBy = z.enum(["tenant", "owner"]).nullable();

const limitsSchema = z.object({ min_cents: num, max_cents: num, fair_cents: num });
const wohnwertSchema = z.object({
  total: num,
  parts: z.object({ value: num, variety: num, fill: num, layers: num, style: num, floor: num }),
  value_cents: num,
  target_cents: num,
  categories: num,
  coverage_bps: num,
  rugs: num,
  tops: num,
  pieces: num,
});

const rentalsSchema = z.object({
  home: z
    .object({
      tier,
      places: num,
      wohnwert: wohnwertSchema,
      limits: z.object({ hour: limitsSchema, day: limitsSchema }),
    })
    .nullable(),
  offer: z
    .object({ period, price_cents: num, is_open: z.boolean(), ai_check_at: z.string(), chance_bps: num })
    .nullable(),
  tenants: z.array(
    tenantSchema.omit({ since: true }).extend({
      period,
      price_cents: num,
      started_at: z.string(),
      next_due_at: z.string(),
      ends_at: z.string().nullable(),
      notice_by: noticeBy,
      paid_cents: num,
    }),
  ),
  past: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      is_ai: z.boolean(),
      ended_at: z.string(),
      end_reason: z.string().nullable(),
      paid_cents: num,
    }),
  ),
  earned_7d_cents: num,
  earned_total_cents: num,
  renting: z
    .object({
      id: z.string(),
      owner: z.string(),
      owner_avatar_key: z.string().nullable(),
      owner_accessories: z.array(z.string()),
      tier: tier.nullable(),
      wohnwert: num,
      period,
      price_cents: num,
      started_at: z.string(),
      next_due_at: z.string(),
      ends_at: z.string().nullable(),
      notice_by: noticeBy,
      paid_cents: num,
      xp_total: num,
      property: propertySchema,
      tenants: z.array(tenantSchema),
    })
    .nullable(),
});

const marketSchema = z.object({
  offers: z.array(
    z.object({
      owner: z.string(),
      avatar_key: z.string().nullable(),
      accessories: z.array(z.string()),
      tier,
      wohnwert: num,
      period,
      price_cents: num,
      places: num,
      free: num,
      property: propertySchema,
      tenants: z.array(tenantSchema),
    }),
  ),
});

export const RENTAL_RPC_SCHEMAS = {
  get_rentals: rentalsSchema,
  get_rental_market: marketSchema,
  set_rental_offer: rentalsSchema,
  rent_home: rentalsSchema,
  end_tenancy: rentalsSchema,
} as const;

const toLimits = (l: z.infer<typeof limitsSchema>): RentLimits => ({
  minCents: l.min_cents,
  maxCents: l.max_cents,
  fairCents: l.fair_cents,
});

function toRentals(r: z.infer<typeof rentalsSchema>): RentalsState {
  const w = r.home?.wohnwert;
  return {
    home:
      r.home && w
        ? {
            tier: r.home.tier as PropertyTier,
            places: r.home.places,
            wohnwert: {
              total: w.total,
              parts: w.parts,
              valueCents: w.value_cents,
              targetCents: w.target_cents,
              categories: w.categories,
              coverageBps: w.coverage_bps,
              rugs: w.rugs,
              tops: w.tops,
              pieces: w.pieces,
            },
            limits: { hour: toLimits(r.home.limits.hour), day: toLimits(r.home.limits.day) },
          }
        : null,
    offer: r.offer
      ? {
          period: r.offer.period,
          priceCents: r.offer.price_cents,
          isOpen: r.offer.is_open,
          aiCheckAt: r.offer.ai_check_at,
          chanceBps: r.offer.chance_bps,
        }
      : null,
    tenants: r.tenants.map((t) => ({
      ...toTenant({ ...t, since: t.started_at }),
      period: t.period,
      priceCents: t.price_cents,
      startedAt: t.started_at,
      nextDueAt: t.next_due_at,
      endsAt: t.ends_at,
      noticeBy: t.notice_by,
      paidCents: t.paid_cents,
    })),
    past: r.past.map((p) => ({
      id: p.id,
      name: p.name,
      isAi: p.is_ai,
      endedAt: p.ended_at,
      endReason: p.end_reason,
      paidCents: p.paid_cents,
    })),
    earned7dCents: r.earned_7d_cents,
    earnedTotalCents: r.earned_total_cents,
    renting: r.renting
      ? {
          id: r.renting.id,
          owner: r.renting.owner,
          ownerAvatarKey: r.renting.owner_avatar_key,
          ownerAccessories: r.renting.owner_accessories,
          tier: r.renting.tier as PropertyTier | null,
          wohnwert: r.renting.wohnwert,
          period: r.renting.period,
          priceCents: r.renting.price_cents,
          startedAt: r.renting.started_at,
          nextDueAt: r.renting.next_due_at,
          endsAt: r.renting.ends_at,
          noticeBy: r.renting.notice_by,
          paidCents: r.renting.paid_cents,
          xpTotal: r.renting.xp_total,
          property: toProperty(r.renting.property),
          tenants: r.renting.tenants.map(toTenant),
        }
      : null,
  };
}

const toOffer = (o: z.infer<typeof marketSchema>["offers"][number]): RentalOffer => ({
  owner: o.owner,
  avatarKey: o.avatar_key,
  accessories: o.accessories,
  tier: o.tier as PropertyTier,
  wohnwert: o.wohnwert,
  period: o.period,
  priceCents: o.price_cents,
  places: o.places,
  free: o.free,
  property: toProperty(o.property),
  tenants: o.tenants.map(toTenant),
});

export const liveRentalEngine: Pick<
  GameEngine,
  "rentals" | "rentalMarket" | "setRentalOffer" | "rentHome" | "endTenancy"
> = {
  async rentals() {
    return toRentals(await rpc("get_rentals", {}, rentalsSchema));
  },
  async rentalMarket() {
    return (await rpc("get_rental_market", {}, marketSchema)).offers.map(toOffer);
  },
  async setRentalOffer(requestId, p, priceCents, open) {
    return toRentals(
      await rpc(
        "set_rental_offer",
        { p_request_id: requestId, p_period: p, p_price_cents: priceCents, p_open: open },
        rentalsSchema,
      ),
    );
  },
  async rentHome(requestId, owner) {
    return toRentals(await rpc("rent_home", { p_request_id: requestId, p_owner: owner }, rentalsSchema));
  },
  async endTenancy(requestId, tenancyId) {
    return toRentals(await rpc("end_tenancy", { p_request_id: requestId, p_tenancy_id: tenancyId }, rentalsSchema));
  },
};
