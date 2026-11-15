import { ACCESSORIES, type AccessorySlot } from "@/config/accessories";
import { FURNITURE } from "@/config/furniture";
import type { Property, Tenant } from "@/features/game/types";
import { rotated } from "@/lib/sim/property";
import { createRng, hashSeed } from "@/lib/sim/rng";

/*
 * Tenants in the room (ADR-158): how an AI tenant looks (stable from the name) and where tenants may walk
 * (every tile without furniture of the object layer; rugs and small things on tables do not block).
 */

/** Everyday portraits; the rare ones (royal, legend ...) stay with players. */
const AI_AVATARS = [
  "rookie",
  "trader",
  "analyst",
  "coder",
  "builder",
  "seller",
  "lawyer",
  "scientist",
  "trucker",
  "punk",
  "gamer",
  "chef",
  "pilot",
] as const;
const AI_SLOTS: readonly AccessorySlot[] = ["head", "face", "hand", "pet"];
const AI_ACCESSORIES = ACCESSORIES.filter((a) => a.rarity === "common" || a.rarity === "rare");

const nameSeed = (name: string) => hashSeed(0x7e4a47, name);

/** The look of an AI tenant: a portrait and up to three accessories, always the same for the same name. */
export function aiTenantLook(name: string): { avatarKey: string; accessories: string[] } {
  const rng = createRng(nameSeed(name));
  const avatarKey = AI_AVATARS[rng.int(0, AI_AVATARS.length - 1)]!;
  const accessories: string[] = [];
  for (const slot of AI_SLOTS) {
    if (accessories.length >= 3 || rng.next() >= 0.45) continue;
    const options = AI_ACCESSORIES.filter((a) => a.slot === slot);
    if (options.length > 0) accessories.push(options[rng.int(0, options.length - 1)]!.key);
  }
  return { avatarKey, accessories };
}

/** Portrait and accessories to draw for any tenant. */
export function tenantLook(t: Pick<Tenant, "name" | "isAi" | "avatarKey" | "accessories">) {
  return t.isAi || !t.avatarKey ? aiTenantLook(t.name) : { avatarKey: t.avatarKey, accessories: t.accessories };
}

const ITEM = new Map(FURNITURE.map((f) => [f.key, f]));

/** Tiles a tenant can stand on: inside the floor and not under furniture of the object layer. */
export function freeTiles(property: Pick<Property, "width" | "height" | "placed">): { x: number; y: number }[] {
  const blocked = new Set<number>();
  for (const p of property.placed) {
    const f = ITEM.get(p.itemKey);
    if (!f || f.layer !== "object") continue;
    const { w, h } = rotated(f, p.rot);
    for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) blocked.add(y * property.width + x);
  }
  const tiles: { x: number; y: number }[] = [];
  for (let y = 0; y < property.height; y++)
    for (let x = 0; x < property.width; x++) if (!blocked.has(y * property.width + x)) tiles.push({ x, y });
  return tiles;
}

/** The tile a tenant goes to at step `step` of the walk (stable per name, room and step). */
export function walkTile(
  tiles: readonly { x: number; y: number }[],
  name: string,
  step: number,
): { x: number; y: number } | null {
  if (tiles.length === 0) return null;
  const rng = createRng(hashSeed(nameSeed(name), step));
  return tiles[rng.int(0, tiles.length - 1)]!;
}

/** Pause before the next walk, in milliseconds: 1.5 to 4.5 seconds, stable per name and step. */
export function idleMs(name: string, step: number): number {
  return 1_500 + Math.floor(createRng(hashSeed(nameSeed(name), step, "idle")).next() * 3_000);
}
