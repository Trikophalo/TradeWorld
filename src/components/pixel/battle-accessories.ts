import type { AccessoryArt } from "./accessories";

/*
 * Pixel art of the exclusive battle accessories (ADR-160), in the format of ./accessories.ts: a sprite at (x, y) on
 * the 24×32 player figure. Keys are those of src/config/battle-accessories.ts. Pure data.
 */
export const BATTLE_ACCESSORY_ART: Readonly<Record<string, AccessoryArt>> = {
  battle_crown: {
    x: 6,
    y: 1,
    palette: { g: "#ffd84a", G: "#c9971a", l: "#fff1a8", p: "#7a2fbf", P: "#4c1d80", r: "#ff2a5a" },
    grid: [
      "l....ll....l",
      "gl..glgg..lg",
      "ggg.gggg.ggg",
      "gggggggggggg",
      "gPpgprrgpgPg",
      "gpppprrppppg",
      "GGGGGGGGGGGG",
    ],
  },
  laurel_wreath: {
    x: 5,
    y: 6,
    palette: { L: "#ffe27a", g: "#c9971a", r: "#e8424f" },
    grid: ["...gLg..gLg...", "..Lg..rr..gL..", ".Lg........gL.", ".g..........g.", "Lg..........gL", ".L..........L."],
  },
  champion_belt: {
    x: 7,
    y: 21,
    palette: { b: "#2b2333", k: "#7a5a10", g: "#ffd84a", l: "#fff1a8", r: "#ff2a5a" },
    grid: ["bbkggggkbb", "bkglrrlgkb", "bbkggggkbb"],
  },
  victory_cape: {
    x: 2,
    y: 16,
    palette: { p: "#6b2fbf", P: "#45208a", g: "#ffd84a", G: "#c9971a" },
    grid: [
      "....pp........pp....",
      "...pppppppppppppp...",
      "..pppppppppppppppp..",
      "..pppppppppppppppp..",
      ".pppppppppppppppppp.",
      ".pppppppppppppppppp.",
      ".pppppppppppppppppp.",
      ".pppppppppppppppppp.",
      "pppppppppppppppppppp",
      "pppppppppppppppppppp",
      "pPppppppppppppppppPp",
      "PpPppppppppppppppPpP",
      "gggggggggggggggggggg",
      "GgGgGgGgGgGgGgGgGgGg",
    ],
  },
  star_shades: {
    x: 6,
    y: 11,
    palette: { y: "#ffd84a", k: "#1b1e2b", w: "#fff6c8" },
    grid: ["..yyy..yyy..", "yykwkyykwkyy", "..kkk..kkk..", "...y....y..."],
  },
  golden_joystick: {
    x: 16,
    y: 16,
    palette: { r: "#ff3a4a", l: "#ffb0b0", k: "#3a2a10", g: "#ffd84a", G: "#c9971a", Y: "#fff1a8", y: "#ff3a4a" },
    grid: [
      "..rr...",
      ".rlrr..",
      ".rrrr..",
      "..kk...",
      "..kk...",
      "..kk...",
      "gggggg.",
      "gYggyg.",
      "gggggg.",
      "GGGGGG.",
    ],
  },
  winner_trophy: {
    x: 15,
    y: 14,
    palette: { g: "#ffd84a", G: "#c9971a", l: "#fff1a8", k: "#5a3a10" },
    grid: [
      "ggggggggg",
      "gglgggggg",
      "ggglggggg",
      ".ggggggg.",
      "..ggggg..",
      "...ggg...",
      "....g....",
      "....g....",
      "...GgG...",
      "..GGGGG..",
      "..kkkkk..",
    ],
  },
  mini_bull: {
    x: 0,
    y: 23,
    palette: { w: "#f3efe4", b: "#6a3f2a", k: "#151722", n: "#c98a6a", y: "#ffd84a" },
    grid: ["w......w", "wbb..bbw", ".bbbbbb.", ".bkbbkb.", ".bbbbbb.", ".bnnnnb.", "..nyyn..", ".bbbbbb.", ".b.bb.b."],
  },
};
