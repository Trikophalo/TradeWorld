import { z } from "zod";
import { NEXAMON_CONDITIONS } from "@/config/nexamon-rules";
import { NEXAMON_RARITIES, NEXAMON_SETS } from "@/config/nexamon/types";
import type { NexamonSealedEngine, NexamonSealedPack } from "./nexamon-sealed-types";
import { rpc } from "./rpc";

/*
 * Sealed Nexamon booster packs (ADR-177) against the server: the inventory, opening one, buying to open later.
 */
const num = z.number();
const setKey = z.enum(NEXAMON_SETS);

const sealedSchema = z.object({
  id: z.string(),
  set: setKey,
  name: z.string(),
  source: z.enum(["battle", "bought"]),
  price_cents: num,
  created_at: z.string(),
});
const sealedListSchema = z.object({ packs: z.array(sealedSchema), unlocked: z.boolean(), server_time: z.string() });
const sealedOpenSchema = z.object({
  pack_id: z.string(),
  sealed_id: z.string(),
  set: setKey,
  price_cents: num,
  cards: z.array(
    z.object({
      slot: num,
      copy_id: z.string(),
      card_key: z.string(),
      rarity: z.enum(NEXAMON_RARITIES),
      condition: z.enum(NEXAMON_CONDITIONS),
      is_new: z.boolean(),
      serial: num,
      population: num,
      value_cents: num,
    }),
  ),
  packs_opened: num,
  sealed_left: num,
});
const sealedBuySchema = z.object({ set: setKey, count: num, price_cents: num, packs: z.array(sealedSchema) });

export const NEXAMON_SEALED_RPC_SCHEMAS = {
  get_nexamon_sealed_packs: sealedListSchema,
  open_nexamon_sealed_pack: sealedOpenSchema,
  buy_nexamon_sealed_pack: sealedBuySchema,
} as const;

const toSealed = (p: z.infer<typeof sealedSchema>): NexamonSealedPack => ({
  id: p.id,
  set: p.set,
  name: p.name,
  source: p.source,
  priceCents: p.price_cents,
  createdAt: p.created_at,
});

export const liveNexamonSealedEngine: NexamonSealedEngine = {
  async nexamonSealedPacks() {
    const r = await rpc("get_nexamon_sealed_packs", {}, sealedListSchema);
    return { packs: r.packs.map(toSealed), unlocked: r.unlocked };
  },
  async openNexamonSealedPack(requestId, packId) {
    const r = await rpc("open_nexamon_sealed_pack", { p_request_id: requestId, p_pack_id: packId }, sealedOpenSchema);
    return {
      packId: r.pack_id,
      sealedId: r.sealed_id,
      set: r.set,
      priceCents: r.price_cents,
      cards: r.cards.map((c) => ({
        slot: c.slot,
        copyId: c.copy_id,
        cardKey: c.card_key,
        rarity: c.rarity,
        condition: c.condition,
        isNew: c.is_new,
        serial: c.serial,
        population: c.population,
        valueCents: c.value_cents,
      })),
      packsOpened: r.packs_opened,
      sealedLeft: r.sealed_left,
    };
  },
  async buyNexamonSealedPack(requestId, set, count) {
    const r = await rpc(
      "buy_nexamon_sealed_pack",
      { p_request_id: requestId, p_set: set, p_count: count },
      sealedBuySchema,
    );
    return { set: r.set, count: r.count, priceCents: r.price_cents, packs: r.packs.map(toSealed) };
  },
};
