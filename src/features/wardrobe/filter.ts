import {
  ACCESSORY_RARITIES,
  ACCESSORY_SETS,
  type AccessoryItem,
  type AccessoryRarity,
  type AccessorySet,
  type AccessorySlot,
} from "@/config/accessories";

/** Shop order of the slots: what people look at first. */
export const SHOP_SLOTS: readonly AccessorySlot[] = ["head", "face", "body", "hand", "pet", "back"];

export const WARDROBE_SORTS = ["shop", "priceAsc", "priceDesc", "rarity"] as const;
export type WardrobeSort = (typeof WARDROBE_SORTS)[number];

export interface WardrobeFilter {
  slot: "all" | AccessorySlot;
  rarity: "all" | AccessoryRarity;
  query: string;
  sort: WardrobeSort;
  /** Only what can be bought right now: not owned, level reached, enough cash. */
  affordableOnly: boolean;
}

export const DEFAULT_WARDROBE_FILTER: WardrobeFilter = {
  slot: "all",
  rarity: "all",
  query: "",
  sort: "shop",
  affordableOnly: false,
};

export interface WardrobeContext {
  owned: readonly string[];
  level: number;
  cashCents: number;
}

const rarityRank = (r: AccessoryRarity) => ACCESSORY_RARITIES.indexOf(r);

/** Lower case without accents, so "kurbis" finds "Kürbiskopf". */
export function normalize(text: string): string {
  return text
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss");
}

const COMPARE: Record<WardrobeSort, (a: AccessoryItem, b: AccessoryItem) => number> = {
  shop: (a, b) => SHOP_SLOTS.indexOf(a.slot) - SHOP_SLOTS.indexOf(b.slot) || a.priceCents - b.priceCents,
  priceAsc: (a, b) => a.priceCents - b.priceCents,
  priceDesc: (a, b) => b.priceCents - a.priceCents,
  rarity: (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.priceCents - a.priceCents,
};

export function canBuyNow(item: AccessoryItem, context: WardrobeContext): boolean {
  return !context.owned.includes(item.key) && context.level >= item.minLevel && context.cashCents >= item.priceCents;
}

/** The accessories the shop shows for a filter, in the chosen order. */
export function filterAccessories(
  items: readonly AccessoryItem[],
  filter: WardrobeFilter,
  context: WardrobeContext,
): AccessoryItem[] {
  const words = normalize(filter.query).split(/\s+/).filter(Boolean);
  return items
    .filter((a) => filter.slot === "all" || a.slot === filter.slot)
    .filter((a) => filter.rarity === "all" || a.rarity === filter.rarity)
    .filter((a) => !filter.affordableOnly || canBuyNow(a, context))
    .filter((a) => {
      if (words.length === 0) return true;
      const text = normalize(`${a.name} ${a.description}`);
      return words.every((w) => text.includes(w));
    })
    .toSorted(COMPARE[filter.sort]);
}

export interface AccessoryGroup {
  /** null: things that belong to no set. */
  set: AccessorySet | null;
  items: AccessoryItem[];
}

/** Groups (already filtered and sorted) accessories by themed set; sets in catalogue order, loose pieces last. */
export function groupBySet(items: readonly AccessoryItem[]): AccessoryGroup[] {
  const groups: AccessoryGroup[] = ACCESSORY_SETS.map((set) => ({
    set,
    items: items.filter((a) => a.set === set),
  }));
  groups.push({ set: null, items: items.filter((a) => !a.set) });
  return groups.filter((g) => g.items.length > 0);
}

export function isFiltered(filter: WardrobeFilter): boolean {
  return (
    filter.slot !== DEFAULT_WARDROBE_FILTER.slot ||
    filter.rarity !== DEFAULT_WARDROBE_FILTER.rarity ||
    filter.query.trim() !== "" ||
    filter.affordableOnly
  );
}
