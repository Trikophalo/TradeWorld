/*
 * Nexamon collectible cards (ADR-165): the shared contract between the catalogue, the artwork, the renderer and
 * the market. Three sets of 77 cards each. Pure data, no imports.
 */
export const NEXAMON_SETS = ["mystic_energy", "super_apex", "prismatic_peak"] as const;
export type NexamonSetKey = (typeof NEXAMON_SETS)[number];
/** Prefix of the card keys of a set ("me-001"). */
export const NEXAMON_SET_PREFIX: Record<NexamonSetKey, string> = {
  mystic_energy: "me",
  super_apex: "sa",
  prismatic_peak: "pp",
};

export const NEXAMON_RARITIES = ["common", "rare", "ultra", "prisma", "legendary"] as const;
export type NexamonRarity = (typeof NEXAMON_RARITIES)[number];
/** Cards per rarity in every set, in card-number order: 1-50, 51-60, 61-70, 71-75, 76-77. */
export const NEXAMON_RARITY_COUNTS: Record<NexamonRarity, number> = {
  common: 50,
  rare: 10,
  ultra: 10,
  prisma: 5,
  legendary: 2,
};
export const NEXAMON_SET_SIZE = 77;

export const NEXAMON_TYPES = [
  "fire",
  "water",
  "grass",
  "electric",
  "psychic",
  "rock",
  "dark",
  "steel",
  "fairy",
  "dragon",
] as const;
export type NexamonType = (typeof NEXAMON_TYPES)[number];

export interface NexamonCard {
  /** "<prefix>-<number 3 digits>", e.g. "me-001". Never changes once shipped. */
  key: string;
  set: NexamonSetKey;
  /** 1..77 within the set. */
  number: number;
  rarity: NexamonRarity;
  name: string;
  type: NexamonType;
  hp: number;
  /** Evolution stage 0 (basic), 1 or 2, and the card (same set) it evolves from. */
  stage: 0 | 1 | 2;
  evolvesFrom: string | null;
  attack: { name: string; damage: number; text: string };
  /** Short flavour text (German), at most 110 characters. */
  flavor: string;
  /** Market value at the start, in cents. */
  startPriceCents: number;
}

/**
 * Pixel artwork of a card. One character per pixel, "." is transparent; `palette` maps characters to hex colours.
 * The card itself is a 72 x 100 pixel canvas. Sizes by rarity:
 *   common, rare: 60 x 40 (the art window inside the frame, at x 6, y 14)
 *   ultra:        68 x 48 (drawn at x 2, y 8: it breaks out of the frame at the top and the sides)
 *   prisma, legendary: 72 x 100 (full art; the renderer overlays name, HP and attack)
 */
export interface NexamonArt {
  width: number;
  height: number;
  palette: Readonly<Record<string, string>>;
  grid: readonly string[];
}
export const NEXAMON_CARD_SIZE = { width: 72, height: 100 } as const;
export const NEXAMON_ART_SIZE: Record<NexamonRarity, { width: number; height: number }> = {
  common: { width: 60, height: 40 },
  rare: { width: 60, height: 40 },
  ultra: { width: 68, height: 48 },
  prisma: { width: 72, height: 100 },
  legendary: { width: 72, height: 100 },
};

/** Start price ranges of the first set in cents; super_apex x5, prismatic_peak x25. */
export const NEXAMON_BASE_PRICE_RANGE: Record<NexamonRarity, readonly [number, number]> = {
  common: [100, 1_000],
  rare: [700, 8_000],
  ultra: [16_000, 250_000],
  prisma: [500_000, 2_500_000],
  legendary: [9_000_000, 18_000_000],
};
export const NEXAMON_SET_PRICE_FACTOR: Record<NexamonSetKey, number> = {
  mystic_energy: 1,
  super_apex: 5,
  prismatic_peak: 25,
};

export function nexamonRarityOfNumber(n: number): NexamonRarity {
  return n <= 50 ? "common" : n <= 60 ? "rare" : n <= 70 ? "ultra" : n <= 75 ? "prisma" : "legendary";
}
export const nexamonKey = (set: NexamonSetKey, n: number) => `${NEXAMON_SET_PREFIX[set]}-${String(n).padStart(3, "0")}`;

/** Placeholder cards for a set until its real catalogue is written: valid shape, prices spread over the range. */
export function placeholderSet(set: NexamonSetKey): NexamonCard[] {
  const seen: Partial<Record<NexamonRarity, number>> = {};
  return Array.from({ length: NEXAMON_SET_SIZE }, (_, i) => {
    const number = i + 1;
    const rarity = nexamonRarityOfNumber(number);
    const index = (seen[rarity] = (seen[rarity] ?? 0) + 1) - 1;
    const [lo, hi] = NEXAMON_BASE_PRICE_RANGE[rarity];
    const steps = Math.max(1, NEXAMON_RARITY_COUNTS[rarity] - 1);
    const base = Math.round((lo + ((hi - lo) * index) / steps) / 100) * 100;
    return {
      key: nexamonKey(set, number),
      set,
      number,
      rarity,
      name: `Nexamon ${number}`,
      type: NEXAMON_TYPES[i % NEXAMON_TYPES.length]!,
      hp: 40 + (i % 10) * 10,
      stage: 0,
      evolvesFrom: null,
      attack: { name: "Rempler", damage: 10 + (i % 6) * 10, text: "" },
      flavor: "",
      startPriceCents: base * NEXAMON_SET_PRICE_FACTOR[set],
    };
  });
}
