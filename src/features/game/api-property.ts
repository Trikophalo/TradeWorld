import { z } from "zod";
import type { FloorMaterial, PropertyTier } from "@/config/balance";
import type { GameEngine, PropertyState } from "./types";
import { rpc } from "./rpc";

/*
 * Own home against the server (ADR-082, docs/PROPERTY.md).
 */
const num = z.number();
const tier = z.enum(["flat", "apartment", "house", "villa", "luxury_villa"]);
const floor = z.enum(["laminate", "carpet", "tiles", "parquet", "stone", "marble", "gold"]);

const propertySchema = z.object({
  owner: z.string(),
  tier: tier.nullable(),
  width: num,
  height: num,
  garage_slots: num,
  wall_color: z.string(),
  floor,
  floors_owned: z.array(floor),
  placed: z.array(
    z.object({ id: z.string(), item_key: z.string(), x: num, y: num, rot: z.union([z.literal(0), z.literal(90)]) }),
  ),
  garage: z.array(z.object({ id: z.string(), car_key: z.string(), slot: num })),
  value_cents: num,
});
const inventorySchema = z.object({
  furniture: z.array(z.object({ id: z.string(), item_key: z.string() })),
  cars: z.array(z.object({ id: z.string(), car_key: z.string() })).default([]),
});
const stateSchema = z.object({ property: propertySchema, inventory: inventorySchema.nullable() });

export const PROPERTY_RPC_SCHEMAS = {
  get_property: stateSchema,
  buy_home: stateSchema.extend({ cost_cents: num }),
  buy_furniture: stateSchema,
  buy_floor: stateSchema,
  save_layout: stateSchema,
  buy_car: stateSchema,
  sell_item: stateSchema.extend({ refund_cents: num }),
};
const S = PROPERTY_RPC_SCHEMAS;

function toState(r: z.infer<typeof stateSchema>): PropertyState {
  const p = r.property;
  return {
    property: {
      owner: p.owner,
      tier: p.tier as PropertyTier | null,
      width: p.width,
      height: p.height,
      garageSlots: p.garage_slots,
      wallColor: p.wall_color,
      floor: p.floor as FloorMaterial,
      floorsOwned: p.floors_owned as FloorMaterial[],
      placed: p.placed.map((x) => ({ id: x.id, itemKey: x.item_key, x: x.x, y: x.y, rot: x.rot })),
      garage: p.garage.map((g) => ({ id: g.id, carKey: g.car_key, slot: g.slot })),
      valueCents: p.value_cents,
    },
    inventory: r.inventory
      ? {
          furniture: r.inventory.furniture.map((f) => ({ id: f.id, itemKey: f.item_key })),
          cars: r.inventory.cars.map((c) => ({ id: c.id, carKey: c.car_key })),
        }
      : null,
  };
}

type PropertyEngine = Pick<
  GameEngine,
  "property" | "buyHome" | "buyFurniture" | "buyFloor" | "saveLayout" | "buyCar" | "sellItem"
>;

export const livePropertyEngine: PropertyEngine = {
  async property(nickname) {
    return toState(await rpc("get_property", { p_nickname: nickname }, S.get_property));
  },
  async buyHome(requestId, t) {
    const r = await rpc("buy_home", { p_request_id: requestId, p_tier: t }, S.buy_home);
    return { ...toState(r), costCents: r.cost_cents };
  },
  async buyFurniture(requestId, itemKey, count) {
    return toState(
      await rpc("buy_furniture", { p_request_id: requestId, p_item_key: itemKey, p_count: count }, S.buy_furniture),
    );
  },
  async buyFloor(requestId, material) {
    return toState(await rpc("buy_floor", { p_request_id: requestId, p_material: material }, S.buy_floor));
  },
  async saveLayout(requestId, wallColor, f, placed) {
    return toState(
      await rpc(
        "save_layout",
        { p_request_id: requestId, p_wall_color: wallColor, p_floor: f, p_placed: placed },
        S.save_layout,
      ),
    );
  },
  async buyCar(requestId, carKey) {
    return toState(await rpc("buy_car", { p_request_id: requestId, p_car_key: carKey }, S.buy_car));
  },
  async sellItem(requestId, kind, id) {
    const r = await rpc("sell_item", { p_request_id: requestId, p_kind: kind, p_id: id }, S.sell_item);
    return { ...toState(r), refundCents: r.refund_cents };
  },
};
