/*
 * Nexamon collectible cards (ADR-165): the shared contract between the catalogue, the artwork, the renderer and
 * the market. Three sets of 77 cards and Cosmic Winds with 90 (ADR-174). Every set has its own rarity layout
 * (`NEXAMON_SET_LAYOUT`): how many cards of each rarity, numbered by rarity. Pure data, no imports.
 */
export const NEXAMON_SETS = [
  "mystic_energy",
  "super_apex",
  "prismatic_peak",
  "cosmic_winds",
  "titans_revenge",
  "yin_yang",
] as const;
export type NexamonSetKey = (typeof NEXAMON_SETS)[number];
/** Prefix of the card keys of a set ("me-001"). */
export const NEXAMON_SET_PREFIX: Record<NexamonSetKey, string> = {
  mystic_energy: "me",
  super_apex: "sa",
  prismatic_peak: "pp",
  cosmic_winds: "cw",
  titans_revenge: "tr",
  yin_yang: "yy",
};

/**
 * Every rarity of every set (ADR-174). A set declares which of them it uses, in card-number order, in
 * `NEXAMON_SET_LAYOUT`; a new set with its own rarities (e.g. Titans Revenge: iron, titanium, diamond, uranium) adds
 * them here and fills the per-rarity records (rank, art size, prices, badges, rules); TypeScript lists every place.
 * "one_of_one": a card that exists exactly once in the whole game.
 */
export const NEXAMON_RARITIES = [
  "common",
  "rare",
  "ultra",
  "prisma",
  "legendary",
  "one_of_one",
  "iron",
  "titanium",
  "diamond",
  "uranium",
] as const;
export type NexamonRarity = (typeof NEXAMON_RARITIES)[number];
/**
 * Rank of a rarity across all sets, higher is rarer: sorting, badges, the Pack Battle tie-break, "is it a hit", the
 * size of the reveal. Ranks may be shared by rarities of different sets (a set's own scale maps onto this one).
 */
export const NEXAMON_RARITY_RANK: Record<NexamonRarity, number> = {
  common: 0,
  rare: 1,
  ultra: 2,
  prisma: 3,
  legendary: 4,
  one_of_one: 5,
  // Titans Revenge (ADR-182): iron is the bulk, titanium the hit of every fifth pack, diamond a prisma-sized moment,
  // uranium the biggest reveal a pack can hold (on par with a One of One)
  iron: 0,
  titanium: 2,
  diamond: 3,
  uranium: 5,
};
/** One entry of a set's layout: a rarity and how many cards of it, numbered on from the entry before. */
export type NexamonLayoutEntry = readonly [rarity: NexamonRarity, count: number];
const CLASSIC_LAYOUT: readonly NexamonLayoutEntry[] = [
  ["common", 50],
  ["rare", 10],
  ["ultra", 10],
  ["prisma", 5],
  ["legendary", 2],
];
/**
 * The rarities of every set in card-number order, worst first, with their counts: the first three sets 1-50,
 * 51-60, 61-70, 71-75, 76-77; Cosmic Winds 1-50, 51-65, 66-80, 81-85, 86-87 and the One of Ones 88-90.
 */
export const NEXAMON_SET_LAYOUT: Record<NexamonSetKey, readonly NexamonLayoutEntry[]> = {
  mystic_energy: CLASSIC_LAYOUT,
  super_apex: CLASSIC_LAYOUT,
  prismatic_peak: CLASSIC_LAYOUT,
  cosmic_winds: [
    ["common", 50],
    ["rare", 15],
    ["ultra", 15],
    ["prisma", 5],
    ["legendary", 2],
    ["one_of_one", 3],
  ],
  titans_revenge: [
    ["iron", 15],
    ["titanium", 7],
    ["diamond", 4],
    ["uranium", 4],
  ],
  yin_yang: [
    ["common", 54],
    ["rare", 30],
    ["ultra", 16],
    ["prisma", 8],
    ["legendary", 2],
  ],
};
/** Cards of a rarity in a set (0 if the set does not use it). */
export const nexamonRarityCount = (set: NexamonSetKey, rarity: NexamonRarity): number =>
  NEXAMON_SET_LAYOUT[set].find(([r]) => r === rarity)?.[1] ?? 0;
/** Cards of a set. */
export const nexamonSetSize = (set: NexamonSetKey): number =>
  NEXAMON_SET_LAYOUT[set].reduce((sum, [, n]) => sum + n, 0);
/** First and last card number of a rarity in a set; null if the set has none. */
export function nexamonRarityRange(set: NexamonSetKey, rarity: NexamonRarity): readonly [number, number] | null {
  let first = 1;
  for (const [r, n] of NEXAMON_SET_LAYOUT[set]) {
    if (r === rarity) return n > 0 ? [first, first + n - 1] : null;
    first += n;
  }
  return null;
}
/** Rarities a set has, worst first (its number order). */
export const nexamonSetRarities = (set: NexamonSetKey): NexamonRarity[] =>
  NEXAMON_SET_LAYOUT[set].filter(([, n]) => n > 0).map(([r]) => r);
/** All rarities by rank, worst first (rarities of different sets mixed). */
export const nexamonRaritiesByRank = (): NexamonRarity[] =>
  [...NEXAMON_RARITIES].sort((a, b) => NEXAMON_RARITY_RANK[a] - NEXAMON_RARITY_RANK[b]);

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
  "cosmic",
] as const;
export type NexamonType = (typeof NEXAMON_TYPES)[number];

/** "warrior": a lone warrior of Yin Yang (ADR-182), a monster card with a "KRIEGER" label. */
export type NexamonCardKind = "monster" | "event" | "warrior";
export const nexamonCardKind = (card: { kind?: NexamonCardKind }): NexamonCardKind => card.kind ?? "monster";

export interface NexamonCard {
  /** "<prefix>-<number 3 digits>", e.g. "me-001". Never changes once shipped. */
  key: string;
  set: NexamonSetKey;
  /** 1..size of the set (77, Cosmic Winds 90). */
  number: number;
  rarity: NexamonRarity;
  name: string;
  /** "monster" (default) or "event": an object or happening (a galaxy, a comet) without HP (ADR-174). */
  kind?: NexamonCardKind;
  type: NexamonType;
  /** 0 for event cards. */
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
 *   prisma, legendary, one_of_one: 72 x 100 (full art; the renderer overlays name, HP and attack)
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
  one_of_one: { width: 72, height: 100 },
  iron: { width: 60, height: 40 },
  titanium: { width: 68, height: 48 },
  diamond: { width: 72, height: 100 },
  uranium: { width: 72, height: 100 },
};

/**
 * Start price ranges of the first set in cents; super_apex x5, prismatic_peak x37.5, cosmic_winds x22.5. A One of One
 * has its own absolute range (`NEXAMON_ONE_OF_ONE_PRICE_RANGE`), the entry here is unused.
 */
export const NEXAMON_BASE_PRICE_RANGE: Record<NexamonRarity, readonly [number, number]> = {
  common: [100, 1_000],
  rare: [700, 8_000],
  ultra: [16_000, 250_000],
  prisma: [500_000, 2_500_000],
  legendary: [9_000_000, 18_000_000],
  one_of_one: [0, 0],
  iron: [0, 0],
  titanium: [0, 0],
  diamond: [0, 0],
  uranium: [0, 0],
};
/** A One of One is worth 16 to 33 million euros at the start, whatever its set (ADR-174). */
export const NEXAMON_ONE_OF_ONE_PRICE_RANGE = [1_600_000_000, 3_300_000_000] as const;
export const NEXAMON_SET_PRICE_FACTOR: Record<NexamonSetKey, number> = {
  mystic_energy: 1,
  super_apex: 5,
  prismatic_peak: 37.5,
  cosmic_winds: 22.5,
  titans_revenge: 1,
  yin_yang: 10,
};
/**
 * Sets whose ranges are not just the base ranges x their factor (ADR-182): Titans Revenge has its own rarities
 * (`titans-draft.ts`), Yin Yang is worth 10 x the base and 12 % more from ultra upwards (`yinyang-draft.ts`).
 */
export const NEXAMON_SET_PRICE_RANGE: Partial<
  Record<NexamonSetKey, Partial<Record<NexamonRarity, readonly [number, number]>>>
> = {
  // TITAN_PRICE_RANGE x 1.125 (TITAN_VALUE_FACTOR)
  titans_revenge: {
    iron: [281_250, 675_000],
    titanium: [3_375_000, 8_437_500],
    diamond: [33_750_000, 95_625_000],
    uranium: [956_250_000, 3_937_500_000],
  },
  yin_yang: {
    common: [1_000, 10_000],
    rare: [7_000, 80_000],
    ultra: [179_200, 2_800_000],
    prisma: [5_600_000, 28_000_000],
    legendary: [100_800_000, 201_600_000],
  },
};
/** Start price range of a rarity in a set, in cents. */
export function nexamonPriceRange(set: NexamonSetKey, rarity: NexamonRarity): readonly [number, number] {
  if (rarity === "one_of_one") return NEXAMON_ONE_OF_ONE_PRICE_RANGE;
  const own = NEXAMON_SET_PRICE_RANGE[set]?.[rarity];
  if (own) return own;
  const [lo, hi] = NEXAMON_BASE_PRICE_RANGE[rarity];
  return [lo * NEXAMON_SET_PRICE_FACTOR[set], hi * NEXAMON_SET_PRICE_FACTOR[set]];
}

/** The rarity of card number `n` in a set (default: the layout of the first three sets). */
export function nexamonRarityOfNumber(n: number, set: NexamonSetKey = "mystic_energy"): NexamonRarity {
  let last = 0;
  for (const [r, count] of NEXAMON_SET_LAYOUT[set]) {
    last += count;
    if (n <= last && count > 0) return r;
  }
  return nexamonSetRarities(set).at(-1)!;
}
export const nexamonKey = (set: NexamonSetKey, n: number) => `${NEXAMON_SET_PREFIX[set]}-${String(n).padStart(3, "0")}`;

/** Placeholder cards for a set until its real catalogue is written: valid shape, prices spread over the range. */
export function placeholderSet(set: NexamonSetKey): NexamonCard[] {
  const seen: Partial<Record<NexamonRarity, number>> = {};
  return Array.from({ length: nexamonSetSize(set) }, (_, i) => {
    const number = i + 1;
    const rarity = nexamonRarityOfNumber(number, set);
    const index = (seen[rarity] = (seen[rarity] ?? 0) + 1) - 1;
    const [lo, hi] = nexamonPriceRange(set, rarity);
    const steps = Math.max(1, nexamonRarityCount(set, rarity) - 1);
    const startPriceCents = Math.round(lo + ((hi - lo) * index) / steps);
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
      startPriceCents,
    };
  });
}
