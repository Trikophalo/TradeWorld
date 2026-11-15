import { z } from "zod";
import type { GameEngine, PokeResult, Wardrobe } from "./types";
import { rpc } from "./rpc";

/*
 * Accessories for the pixel figure and poking friends (ADR-154) against the server.
 */
const wardrobeSchema = z.object({
  owned: z.array(z.string()),
  worn: z.array(z.string()),
  avatar_key: z.string(),
});
const boughtSchema = wardrobeSchema.extend({ paid_cents: z.number() });
const pokeSchema = z.object({
  nickname: z.string(),
  poked_at: z.string(),
  next_at: z.string(),
  left_today: z.number(),
});

export const ACCESSORY_RPC_SCHEMAS = {
  get_accessories: wardrobeSchema,
  buy_accessory: boughtSchema,
  wear_accessory: wardrobeSchema,
  poke_friend: pokeSchema,
} as const;

const toWardrobe = (r: z.infer<typeof wardrobeSchema>): Wardrobe => ({
  owned: r.owned,
  worn: r.worn,
  avatarKey: r.avatar_key,
});

const toPoke = (r: z.infer<typeof pokeSchema>): PokeResult => ({
  nickname: r.nickname,
  pokedAt: r.poked_at,
  nextAt: r.next_at,
  leftToday: r.left_today,
});

export const liveAccessoryEngine: Pick<GameEngine, "accessories" | "buyAccessory" | "wearAccessory" | "pokeFriend"> = {
  async accessories() {
    return toWardrobe(await rpc("get_accessories", {}, wardrobeSchema));
  },
  async buyAccessory(requestId, key) {
    const r = await rpc("buy_accessory", { p_request_id: requestId, p_key: key }, boughtSchema);
    return { ...toWardrobe(r), paidCents: r.paid_cents };
  },
  async wearAccessory(requestId, key, wear) {
    return toWardrobe(
      await rpc("wear_accessory", { p_request_id: requestId, p_key: key, p_wear: wear }, wardrobeSchema),
    );
  },
  async pokeFriend(requestId, nickname) {
    return toPoke(await rpc("poke_friend", { p_request_id: requestId, p_nickname: nickname }, pokeSchema));
  },
};
