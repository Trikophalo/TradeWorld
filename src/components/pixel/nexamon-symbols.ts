import type { NexamonRarity, NexamonSetKey, NexamonType } from "@/config/nexamon/types";
import type { PixelArt, PixelGrid } from "./pixel-icon";

/*
 * Original symbols and inks of the Nexamon cards (ADR-165, ADR-174, ADR-182): eleven type symbols, six set symbols,
 * ten rarity marks. Everything here is card ink (data), which is why hex colours are allowed.
 */

/** Inks of one type, from the outline to the paper of the text boxes. */
export interface TypeInk {
  /** Outline and text on paper. */
  deep: string;
  /** Shadow side of the frame. */
  dark: string;
  /** The frame colour. */
  base: string;
  /** Light side of the frame. */
  light: string;
  /** Highlights and text on dark plates. */
  pale: string;
  /** Paper of the text boxes. */
  paper: string;
  /** A second, slightly darker paper tone for texture and the flavour box. */
  paperShade: string;
}

export const TYPE_INK: Record<NexamonType, TypeInk> = {
  // stars and void: midnight violet with starlight
  cosmic: {
    deep: "#0d0826",
    dark: "#2b1d6e",
    base: "#5640c8",
    light: "#9f8cff",
    pale: "#ece6ff",
    paper: "#ece9f7",
    paperShade: "#d6d0ec",
  },
  fire: {
    deep: "#4a120c",
    dark: "#9c2a1a",
    base: "#d9482b",
    light: "#ff8a4c",
    pale: "#ffe0b0",
    paper: "#fbead0",
    paperShade: "#f0d3ae",
  },
  water: {
    deep: "#0c2350",
    dark: "#1c4f9c",
    base: "#2f7fd9",
    light: "#6cc0ff",
    pale: "#d6f1ff",
    paper: "#e9f4f7",
    paperShade: "#cfe3ec",
  },
  grass: {
    deep: "#12381a",
    dark: "#256e31",
    base: "#3fa64a",
    light: "#8ede6a",
    pale: "#e3f8c4",
    paper: "#eff5dc",
    paperShade: "#d9e6bd",
  },
  electric: {
    deep: "#4d3600",
    dark: "#a87a00",
    base: "#e8b818",
    light: "#ffe25c",
    pale: "#fff8c8",
    paper: "#fbf3d2",
    paperShade: "#efdfa6",
  },
  psychic: {
    deep: "#36104a",
    dark: "#6e2a8e",
    base: "#a646c9",
    light: "#de8cf5",
    pale: "#f7ddff",
    paper: "#f4e8f6",
    paperShade: "#e3cfe9",
  },
  rock: {
    deep: "#33230f",
    dark: "#6b4c28",
    base: "#9a7446",
    light: "#cfa873",
    pale: "#f3e0c0",
    paper: "#f3e9d6",
    paperShade: "#e2d2b4",
  },
  dark: {
    deep: "#0d0b16",
    dark: "#221e33",
    base: "#3b3552",
    light: "#6d6690",
    pale: "#cbc5e3",
    paper: "#e4e1ec",
    paperShade: "#cbc6d8",
  },
  steel: {
    deep: "#1b242c",
    dark: "#465765",
    base: "#6f8494",
    light: "#aebfcc",
    pale: "#e8f0f5",
    paper: "#eaeef0",
    paperShade: "#d2dade",
  },
  fairy: {
    deep: "#4d1035",
    dark: "#a8366f",
    base: "#e05a9c",
    light: "#ffa3cc",
    pale: "#ffe3f0",
    paper: "#fbeaf1",
    paperShade: "#f1d0de",
  },
  dragon: {
    deep: "#141b4d",
    dark: "#2b3590",
    base: "#4a55c9",
    light: "#8f9aff",
    pale: "#e0e3ff",
    paper: "#ecebf5",
    paperShade: "#d3d2e8",
  },
};

/** Gold of the legendary cards and of the grading label. */
export const GOLD_INK = {
  deep: "#3a2200",
  dark: "#8a5a08",
  base: "#d9a520",
  light: "#ffd75e",
  pale: "#fff4c2",
  plate: "#241503",
} as const;

/**
 * Inks of the One of One (ADR-174): black and gold with an iridescent sheen that runs from teal through violet to
 * rose, unlike the rainbow of the prismas and the plain gold of the legendaries.
 */
export const ONE_OF_ONE_INK = {
  black: "#07060c",
  ink: "#16131f",
  goldDeep: "#5a3a00",
  gold: "#e8b630",
  goldLight: "#ffe38a",
  white: "#fffaf0",
  iris: ["#3ff0d0", "#58b4ff", "#9a7cff", "#e070ff", "#ff7ab0"],
} as const;

/** The seven inks of the prism border, in rainbow order. */
export const PRISM_INKS = ["#ff5d6c", "#ff9d47", "#ffe45c", "#6fe58c", "#58cfff", "#7d8bff", "#d07dff"] as const;

/** Five by five glyphs; "#" is ink. */
const TYPE_GLYPH: Record<NexamonType, PixelGrid> = {
  fire: ["..#..", ".##..", ".###.", "##.##", ".###."],
  water: ["..#..", "..#..", ".###.", "#####", ".###."],
  grass: ["...##", ".####", ".###.", ".##..", "#...."],
  electric: ["...#.", "..#..", ".###.", "..#..", ".#..."],
  psychic: [".###.", "#...#", "#.#.#", "#...#", ".###."],
  rock: [".....", ".#...", "###.#", "#####", "#####"],
  dark: [".###.", "##...", "##...", "##..#", ".###."],
  steel: ["#.#.#", ".###.", "##.##", ".###.", "#.#.#"],
  fairy: [".#.#.", "#####", "#####", ".###.", "..#.."],
  dragon: ["#...#", "##.##", ".###.", ".#.#.", "..#.."],
  // a four-pointed star
  cosmic: ["..#..", ".###.", "#####", ".###.", "..#.."],
};

const DISC: PixelGrid = [
  "..ooooo..",
  ".olbbbbo.",
  "olbbbbbbo",
  "obbbbbbbo",
  "obbbbbbbo",
  "obbbbbbbo",
  "obbbbbbdo",
  ".obbbbdo.",
  "..ooooo..",
];

function typeSymbol(type: NexamonType): PixelArt {
  const ink = TYPE_INK[type];
  const glyph = TYPE_GLYPH[type];
  const grid = DISC.map((row, y) => [...row].map((ch, x) => (glyph[y - 2]?.[x - 2] === "#" ? "w" : ch)).join(""));
  return { grid, palette: { o: ink.deep, b: ink.base, l: ink.light, d: ink.dark, w: ink.pale } };
}

/** Type symbols: a nine-pixel disc in the type colour with the glyph in the pale ink. */
export const TYPE_SYMBOL: Record<NexamonType, PixelArt> = {
  fire: typeSymbol("fire"),
  water: typeSymbol("water"),
  grass: typeSymbol("grass"),
  electric: typeSymbol("electric"),
  psychic: typeSymbol("psychic"),
  rock: typeSymbol("rock"),
  dark: typeSymbol("dark"),
  steel: typeSymbol("steel"),
  fairy: typeSymbol("fairy"),
  dragon: typeSymbol("dragon"),
  cosmic: typeSymbol("cosmic"),
};

/** The bare glyph of a type in one ink (placeholder artwork, pack fronts). */
export const typeGlyph = (type: NexamonType, ink: string): PixelArt => ({
  grid: TYPE_GLYPH[type],
  palette: { "#": ink },
});

const SET_GLYPH: Record<NexamonSetKey, PixelGrid> = {
  // A spiral of energy.
  mystic_energy: [".#####.", "#.....#", "#.###.#", "#.#.#.#", "#.#..##", "#.#....", "#..####"],
  // Two chevrons pointing up.
  super_apex: ["...#...", "..###..", ".##.##.", "##.#.##", "..###..", ".##.##.", "##...##"],
  // A prism above a peak.
  prismatic_peak: ["...#...", "..#.#..", "...#...", "...#...", "..###..", ".#####.", "#######"],
  // A ringed planet with a gust of wind.
  cosmic_winds: ["....##.", "..####.", ".#.##.#", "#.####.", ".####..", "##.....", "......."],
  // A titan's eye: a lid around a slit pupil.
  titans_revenge: ["..###..", ".#...#.", "#..#..#", "#.###.#", "#..#..#", ".#...#.", "..###.."],
  // Yin and yang: the S-curve with a dot in each half.
  yin_yang: ["..###..", ".#..##.", "#.#.###", "#..####", "##.##.#", ".####..", "..###.."],
};

/** Set symbols, seven by seven, in one ink. */
export const setSymbol = (set: NexamonSetKey, ink: string): PixelArt => ({
  grid: SET_GLYPH[set],
  palette: { "#": ink },
});

const RARITY_GLYPH: Record<NexamonRarity, PixelGrid> = {
  common: [".###.", "#####", "#####", "#####", ".###."],
  rare: ["..#..", ".###.", "#####", ".###.", "..#.."],
  ultra: ["..#..", "#####", ".###.", "##.##", "#...#"],
  prisma: ["..r..", "..y..", "bgwyr", "..g..", "..b.."],
  legendary: ["#.#.#", "#.#.#", "#####", "#####", "....."],
  // "1" in a black diamond with a gold rim
  one_of_one: ["..g..", ".gkg.", "gkwkg", ".gkg.", "..g.."],
  // Titans Revenge (ADR-182): a rivet, a hexagon bolt, a cut gem, the trefoil
  iron: [".###.", "#...#", "#.#.#", "#...#", ".###."],
  titanium: [".###.", "#####", "##.##", "#####", ".###."],
  diamond: ["#####", ".#.#.", "..#..", ".....", "....."],
  uranium: ["#...#", "##.##", "..g..", ".###.", ".###."],
};

/** Rarity marks, five by five. The prism mark keeps its own colours, the crown is always gold. */
export function rarityMark(rarity: NexamonRarity, ink: string): PixelArt {
  if (rarity === "prisma")
    return {
      grid: RARITY_GLYPH.prisma,
      palette: { r: PRISM_INKS[0], y: PRISM_INKS[2], g: PRISM_INKS[3], b: PRISM_INKS[4], w: "#ffffff" },
    };
  if (rarity === "one_of_one")
    return { grid: RARITY_GLYPH.one_of_one, palette: { g: GOLD_INK.light, k: ONE_OF_ONE_INK.black, w: "#ffffff" } };
  if (rarity === "diamond") return { grid: RARITY_GLYPH.diamond, palette: { "#": DIAMOND_INK.pale } };
  if (rarity === "uranium")
    return { grid: RARITY_GLYPH.uranium, palette: { "#": URANIUM_INK.glow, g: URANIUM_INK.pale } };
  return { grid: RARITY_GLYPH[rarity], palette: { "#": rarity === "legendary" ? GOLD_INK.light : ink } };
}

/** Inks of the three sets (pack fronts, set chips). */
export const SET_INK: Record<NexamonSetKey, { deep: string; dark: string; base: string; light: string; pale: string }> =
  {
    mystic_energy: { deep: "#150b33", dark: "#3a1d7a", base: "#7b3fd4", light: "#35d6c4", pale: "#d9fff6" },
    super_apex: { deep: "#3d0a08", dark: "#9c1a12", base: "#e2401c", light: "#ffa42b", pale: "#fff0b8" },
    prismatic_peak: { deep: "#101a3d", dark: "#27408a", base: "#4f8fe0", light: "#bfe9ff", pale: "#ffffff" },
    cosmic_winds: { deep: "#04030f", dark: "#1a1450", base: "#3b2f9e", light: "#ff8ad8", pale: "#e8f4ff" },
    titans_revenge: { deep: "#07080a", dark: "#22262c", base: "#4a4f57", light: "#ff5a1f", pale: "#d8dde3" },
    yin_yang: { deep: "#0a0a0a", dark: "#3a3a3a", base: "#8a8a8a", light: "#c8231e", pale: "#f4f1ea" },
  };

/** Rusted iron (Titans Revenge, ADR-182): the frame, its rust, the rivets and the sparks. */
export const IRON_INK = {
  deep: "#14100e",
  dark: "#2b2420",
  base: "#4a403a",
  light: "#6e625a",
  rust: "#8a4a26",
  rustLight: "#b8682f",
  rivet: "#9c928a",
  spark: "#ffb347",
  paper: "#e4ddd3",
  paperShade: "#cfc5b8",
} as const;

/** Brushed titanium: cool silver with a blue cast. */
export const TITANIUM_INK = {
  deep: "#0f1a26",
  dark: "#3d5266",
  base: "#7d93a8",
  light: "#b9cad9",
  pale: "#eef5fb",
  blue: "#5c8fc4",
  paper: "#eef2f6",
  paperShade: "#d5dee7",
} as const;

/** Diamond: ice-white facets with a prismatic edge. */
export const DIAMOND_INK = {
  deep: "#0b1c33",
  dark: "#1f4a7a",
  base: "#6fb6e8",
  light: "#c6ecff",
  pale: "#ffffff",
  plate: "#0e2440",
} as const;

/** Uranium: black with a radioactive green glow. */
export const URANIUM_INK = {
  black: "#030503",
  deep: "#0a140a",
  dark: "#123f12",
  base: "#2fbf2a",
  glow: "#7dff3a",
  pale: "#e2ffb8",
} as const;

/** The two legendaries of Yin Yang (ADR-182): ink black (Yin) and paper white (Yang), a red seal on both. */
export const YIN_YANG_INK = {
  black: "#0b0b0b",
  ink: "#26262a",
  grey: "#6d6d72",
  silver: "#c9c9cc",
  paper: "#f6f3ec",
  white: "#ffffff",
  seal: "#c8231e",
} as const;
