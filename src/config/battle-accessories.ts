/*
 * Exclusive accessories (ADR-160): only the winner of a news battle gets one; they cannot be bought. Same shape as
 * src/config/accessories.ts plus `exclusive: true` and no price; the pixel art lives in
 * src/components/pixel/battle-accessories.ts. Keys are stored in the database and must never change.
 *
 * Purity rules (ADR-012): no imports from outside src/config, JSON-serialisable values only (part of BALANCE).
 */
import type { AccessorySlot } from "./accessories.ts";

export interface BattleAccessoryItem {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly slot: AccessorySlot;
  readonly rarity: "legendary";
  /** Never sold: buy_accessory refuses it (accessory_exclusive). */
  readonly exclusive: true;
  readonly minLevel: 1;
}

const item = (key: string, slot: AccessorySlot, name: string, description: string): BattleAccessoryItem => ({
  key,
  name,
  description,
  slot,
  rarity: "legendary",
  exclusive: true,
  minLevel: 1,
});

export const BATTLE_ACCESSORIES: readonly BattleAccessoryItem[] = [
  item(
    "battle_crown",
    "head",
    "Battle-Krone",
    "Gewonnen, nicht gekauft. Samt, Gold und ein Rubin so groß wie dein Ego.",
  ),
  item("laurel_wreath", "head", "Lorbeerkranz", "Wie bei den alten Griechen, nur mit mehr Aktien."),
  item("champion_belt", "body", "Champion-Gürtel", "Schwergewichtsmeister im Kurssturz-Springen."),
  item("victory_cape", "back", "Siegerumhang", "Flattert dramatisch, auch wenn kein Wind weht."),
  item("star_shades", "face", "Siegerbrille", "Wer gewinnt, muss die Blicke der Verlierer nicht sehen."),
  item("golden_joystick", "hand", "Goldener Joystick", "WASD in purem Gold. Nicht zum Zocken, zum Angeben."),
  item("winner_trophy", "hand", "Siegerpokal", "Glänzt. Wiegt. Wird jeden Abend poliert."),
  item("mini_bull", "pet", "Mini-Bulle", "Ein Bulle, der dich nicht über den Haufen rennt. Meistens."),
];

export function battleAccessoryByKey(key: string): BattleAccessoryItem | undefined {
  return BATTLE_ACCESSORIES.find((a) => a.key === key);
}
