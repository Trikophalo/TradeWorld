import { z } from "zod";
import { HQ_STYLE_OPTIONS } from "@/config/countries";
import { rpc } from "./rpc";
import { DEFAULT_HQ_STYLE, type HqStyle, type WorldEngine, type WorldState } from "./world-types";

/*
 * Weltkarte und Standorte (ADR-208), against the server.
 */
const styleSchema = z
  .object({
    wall: z.number().optional(),
    roof: z.number().optional(),
    sign: z.number().optional(),
    roofKind: z.string().optional(),
    deco: z.string().optional(),
    flag: z.boolean().optional(),
  })
  .nullable()
  .optional();

const placeSchema = z.object({
  company_id: z.string(),
  name: z.string(),
  owner: z.string().nullable(),
  country: z.string().nullable(),
  kind: z.enum(["hq", "subsidiary", "ai"]),
  hq_tier: z.number(),
  hq_style: styleSchema,
  worth_cents: z.number().nullable(),
  sector: z.string(),
  brand_color: z.string().nullable(),
  mine: z.boolean().nullable(),
  leader: z.boolean().nullable(),
});

const worldSchema = z.object({
  company: z
    .object({
      id: z.string(),
      name: z.string(),
      worth_cents: z.number(),
      free_cash_cents: z.number(),
      listed: z.boolean(),
    })
    .nullable(),
  unlock_worth_cents: z.number(),
  me: z
    .object({
      country: z.string(),
      hq_tier: z.number(),
      hq_style: styleSchema,
      invested_cents: z.number(),
      placed_at: z.string(),
      moved_at: z.string().nullable(),
      relocate_ready_at: z.string(),
      relocation_cost_cents: z.number(),
      next_tier_cost_cents: z.number().nullable(),
      subsidiaries: z.array(
        z.object({
          country: z.string(),
          opened_at: z.string(),
          setup_cost_cents: z.number(),
          ramp: z.number(),
          hourly_cost_cents: z.number(),
        }),
      ),
      next_subsidiary_cost_cents: z.number().nullable(),
      subsidiary_unlocked: z.boolean(),
      image: z.record(
        z.string(),
        z.object({ bonus_bps: z.number(), ready_at: z.string().nullable(), spent_cents: z.number() }),
      ),
      image_campaign_cost_cents: z.number(),
      effect: z.object({
        demand_factor: z.number(),
        cogs_factor: z.number(),
        fixed_factor: z.number(),
        tax_rate_bps: z.number().nullable(),
        subsidiary_share: z.number(),
      }),
      leader: z.boolean().nullable(),
      fee_bps: z.number().nullable(),
      fee_ready_at: z.string().nullable(),
      paying_fee: z
        .object({ fee_bps: z.number(), leader_id: z.string(), leader_name: z.string().nullable() })
        .nullable(),
      fees_paid_cents: z.number(),
      fees_received_cents: z.number(),
    })
    .nullable(),
  places: z.array(placeSchema),
  countries: z.array(z.object({ key: z.string(), leader_id: z.string().nullable(), fee_bps: z.number() })),
});

export const WORLD_RPC_SCHEMAS = {
  get_world: worldSchema,
  world_place_hq: worldSchema,
  world_upgrade_hq: worldSchema,
  world_relocate_hq: worldSchema,
  world_save_hq_style: worldSchema,
  world_open_subsidiary: worldSchema,
  world_close_subsidiary: worldSchema,
  world_image_campaign: worldSchema,
  world_set_location_fee: worldSchema,
} as const;

/** A stored style, completed with the defaults and limited to the editor's options. */
export function toHqStyle(raw: z.infer<typeof styleSchema>): HqStyle {
  const s = raw ?? {};
  const idx = (v: number | undefined, d: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 8 ? v : d;
  return {
    wall: idx(s.wall, DEFAULT_HQ_STYLE.wall),
    roof: idx(s.roof, DEFAULT_HQ_STYLE.roof),
    sign: idx(s.sign, DEFAULT_HQ_STYLE.sign),
    roofKind: (HQ_STYLE_OPTIONS.roofs as readonly string[]).includes(s.roofKind ?? "")
      ? (s.roofKind as HqStyle["roofKind"])
      : DEFAULT_HQ_STYLE.roofKind,
    deco: (HQ_STYLE_OPTIONS.decorations as readonly string[]).includes(s.deco ?? "")
      ? (s.deco as HqStyle["deco"])
      : DEFAULT_HQ_STYLE.deco,
    flag: s.flag ?? DEFAULT_HQ_STYLE.flag,
  };
}

export function toWorld(r: z.infer<typeof worldSchema>): WorldState {
  const me = r.me;
  return {
    company: r.company
      ? {
          id: r.company.id,
          name: r.company.name,
          worthCents: r.company.worth_cents,
          freeCashCents: r.company.free_cash_cents,
          listed: r.company.listed,
        }
      : null,
    unlockWorthCents: r.unlock_worth_cents,
    me: me
      ? {
          country: me.country,
          hqTier: me.hq_tier,
          hqStyle: toHqStyle(me.hq_style),
          investedCents: me.invested_cents,
          placedAt: me.placed_at,
          movedAt: me.moved_at,
          relocateReadyAt: me.relocate_ready_at,
          relocationCostCents: me.relocation_cost_cents,
          nextTierCostCents: me.next_tier_cost_cents,
          subsidiaries: me.subsidiaries.map((s) => ({
            country: s.country,
            openedAt: s.opened_at,
            setupCostCents: s.setup_cost_cents,
            ramp: s.ramp,
            hourlyCostCents: s.hourly_cost_cents,
          })),
          nextSubsidiaryCostCents: me.next_subsidiary_cost_cents,
          subsidiaryUnlocked: me.subsidiary_unlocked,
          image: Object.fromEntries(
            Object.entries(me.image).map(([k, v]) => [
              k,
              { bonusBps: v.bonus_bps, readyAt: v.ready_at, spentCents: v.spent_cents },
            ]),
          ),
          imageCampaignCostCents: me.image_campaign_cost_cents,
          effect: {
            demandFactor: me.effect.demand_factor,
            cogsFactor: me.effect.cogs_factor,
            fixedFactor: me.effect.fixed_factor,
            taxRateBps: me.effect.tax_rate_bps,
            subsidiaryShare: me.effect.subsidiary_share,
          },
          leader: me.leader ?? false,
          feeBps: me.fee_bps ?? 0,
          feeReadyAt: me.fee_ready_at,
          payingFee: me.paying_fee
            ? {
                feeBps: me.paying_fee.fee_bps,
                leaderId: me.paying_fee.leader_id,
                leaderName: me.paying_fee.leader_name,
              }
            : null,
          feesPaidCents: me.fees_paid_cents,
          feesReceivedCents: me.fees_received_cents,
        }
      : null,
    places: r.places.flatMap((p) =>
      p.country
        ? [
            {
              companyId: p.company_id,
              name: p.name,
              owner: p.owner,
              country: p.country,
              kind: p.kind,
              hqTier: p.hq_tier,
              hqStyle: toHqStyle(p.hq_style),
              worthCents: p.worth_cents,
              sector: p.sector,
              brandColor: p.brand_color,
              mine: p.mine ?? false,
              leader: p.leader ?? false,
            },
          ]
        : [],
    ),
    countries: r.countries.map((c) => ({ key: c.key, leaderId: c.leader_id, feeBps: c.fee_bps })),
  };
}

const call = async (name: keyof typeof WORLD_RPC_SCHEMAS, args: Record<string, unknown>) =>
  toWorld(await rpc(name, args, worldSchema));

export const liveWorldEngine: WorldEngine = {
  world: () => call("get_world", {}),
  worldPlaceHq: (requestId, country) => call("world_place_hq", { p_request_id: requestId, p_country: country }),
  worldUpgradeHq: (requestId) => call("world_upgrade_hq", { p_request_id: requestId }),
  worldRelocateHq: (requestId, country) => call("world_relocate_hq", { p_request_id: requestId, p_country: country }),
  worldSaveHqStyle: (requestId, style) => call("world_save_hq_style", { p_request_id: requestId, p_style: style }),
  worldOpenSubsidiary: (requestId, country) =>
    call("world_open_subsidiary", { p_request_id: requestId, p_country: country }),
  worldCloseSubsidiary: (requestId, country) =>
    call("world_close_subsidiary", { p_request_id: requestId, p_country: country }),
  worldImageCampaign: (requestId, country) =>
    call("world_image_campaign", { p_request_id: requestId, p_country: country }),
  worldSetLocationFee: (requestId, feeBps) =>
    call("world_set_location_fee", { p_request_id: requestId, p_fee_bps: feeBps }),
};
