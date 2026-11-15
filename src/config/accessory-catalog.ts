/*
 * The whole accessory catalogue: the shop (src/config/accessories.ts, ADR-155) plus the exclusive accessories only
 * news battles give away (src/config/battle-accessories.ts, ADR-160). The database merges them the same way
 * (public.accessories_cfg()). Purity rules (ADR-012): imports only from src/config.
 */
import { accessoryByKey, type AccessoryItem } from "./accessories.ts";
import { battleAccessoryByKey, type BattleAccessoryItem } from "./battle-accessories.ts";

export type CatalogItem = AccessoryItem | BattleAccessoryItem;

export function catalogItemByKey(key: string): CatalogItem | undefined {
  return accessoryByKey(key) ?? battleAccessoryByKey(key);
}

export const isExclusive = (item: CatalogItem): item is BattleAccessoryItem => "exclusive" in item && item.exclusive;
