/*
 * Pixel flags of the game countries (ADR-208), one hand-drawn design per country key: a 15×9 flag for the map, the
 * country sheet and the lists, and a 4×3 one for the pole on the headquarters. Simplified original pixel drawings
 * (stripes, crosses, stars as single pixels), colors as data. Pure.
 */
import type { PixelArt } from "./pixel-icon";

export const FLAG_SIZE = { width: 15, height: 9 } as const;
export const FLAG_MINI_SIZE = { width: 4, height: 3 } as const;

interface FlagDesign {
  readonly palette: Readonly<Record<string, string>>;
  readonly grid: readonly string[];
  readonly mini: readonly string[];
}

const RED = "#dd0000";

export const FLAGS: Readonly<Record<string, FlagDesign>> = {
  de: {
    palette: { k: "#1a1a1a", r: RED, y: "#ffce00" },
    grid: [
      "kkkkkkkkkkkkkkk",
      "kkkkkkkkkkkkkkk",
      "kkkkkkkkkkkkkkk",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "yyyyyyyyyyyyyyy",
      "yyyyyyyyyyyyyyy",
      "yyyyyyyyyyyyyyy",
    ],
    mini: ["kkkk", "rrrr", "yyyy"],
  },
  us: {
    palette: { r: "#b22234", w: "#ffffff", b: "#3c3b6e" },
    grid: [
      "bbbbbbrrrrrrrrr",
      "bwbwbwwwwwwwwww",
      "bbwbwbrrrrrrrrr",
      "bwbwbwwwwwwwwww",
      "bbbbbbrrrrrrrrr",
      "wwwwwwwwwwwwwww",
      "rrrrrrrrrrrrrrr",
      "wwwwwwwwwwwwwww",
      "rrrrrrrrrrrrrrr",
    ],
    mini: ["bbrr", "bbww", "rrrr"],
  },
  cn: {
    palette: { r: "#de2910", y: "#ffde00" },
    grid: [
      "rrrrrrrrrrrrrrr",
      "rryrryrrrrrrrrr",
      "ryyyrryrrrrrrrr",
      "rryrrryrrrrrrrr",
      "ryryryrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
    ],
    mini: ["yryr", "rrrr", "rrrr"],
  },
  jp: {
    palette: { w: "#ffffff", r: "#bc002d" },
    grid: [
      "wwwwwwwwwwwwwww",
      "wwwwwwwwwwwwwww",
      "wwwwwwrrrwwwwww",
      "wwwwwrrrrrwwwww",
      "wwwwwrrrrrwwwww",
      "wwwwwrrrrrwwwww",
      "wwwwwwrrrwwwwww",
      "wwwwwwwwwwwwwww",
      "wwwwwwwwwwwwwww",
    ],
    mini: ["wwww", "wrrw", "wwww"],
  },
  in: {
    palette: { o: "#ff9933", w: "#ffffff", g: "#138808", b: "#000080" },
    grid: [
      "ooooooooooooooo",
      "ooooooooooooooo",
      "ooooooooooooooo",
      "wwwwwwwbwwwwwww",
      "wwwwwwbwbwwwwww",
      "wwwwwwwbwwwwwww",
      "ggggggggggggggg",
      "ggggggggggggggg",
      "ggggggggggggggg",
    ],
    mini: ["oooo", "wbbw", "gggg"],
  },
  br: {
    palette: { g: "#009c3b", y: "#ffdf00", b: "#002776", w: "#ffffff" },
    grid: [
      "ggggggggggggggg",
      "gggggggyggggggg",
      "gggggyyyyyggggg",
      "gggyyybbbyyyggg",
      "gyyyybwwwbyyyyg",
      "gggyyybbbyyyggg",
      "gggggyyyyyggggg",
      "gggggggyggggggg",
      "ggggggggggggggg",
    ],
    mini: ["gyyg", "ybby", "gyyg"],
  },
  gb: {
    palette: { b: "#012169", w: "#ffffff", r: "#c8102e" },
    grid: [
      "rwbbbbwrwbbbbwr",
      "wrwbbbwrwbbbwrw",
      "bbwrwbwrwbwrwbb",
      "wwwwwwwrwwwwwww",
      "rrrrrrrrrrrrrrr",
      "wwwwwwwrwwwwwww",
      "bbwrwbwrwbwrwbb",
      "wrwbbbwrwbbbwrw",
      "rwbbbbwrwbbbbwr",
    ],
    mini: ["bwrb", "rrrr", "brwb"],
  },
  fr: {
    palette: { b: "#0055a4", w: "#ffffff", r: "#ef4135" },
    grid: Array.from({ length: 9 }, () => "bbbbbwwwwwrrrrr"),
    mini: ["bwwr", "bwwr", "bwwr"],
  },
  ca: {
    palette: { r: "#ff0000", w: "#ffffff" },
    grid: [
      "rrrrwwwwwwwrrrr",
      "rrrrwwwrwwwrrrr",
      "rrrrwwrrrwwrrrr",
      "rrrrwrrrrrwrrrr",
      "rrrrwwrrrwwrrrr",
      "rrrrwrrrrrwrrrr",
      "rrrrwwwrwwwrrrr",
      "rrrrwwwrwwwrrrr",
      "rrrrwwwwwwwrrrr",
    ],
    mini: ["rwwr", "rrrr", "rwwr"],
  },
  mx: {
    palette: { g: "#006847", w: "#ffffff", r: "#ce1126", n: "#8c5a2b" },
    grid: [
      "gggggwwwwwrrrrr",
      "gggggwwwwwrrrrr",
      "gggggwwwwwrrrrr",
      "gggggwwnwwrrrrr",
      "gggggwnnnwrrrrr",
      "gggggwwgwwrrrrr",
      "gggggwwwwwrrrrr",
      "gggggwwwwwrrrrr",
      "gggggwwwwwrrrrr",
    ],
    mini: ["gwwr", "gnwr", "gwwr"],
  },
  kr: {
    palette: { w: "#ffffff", r: "#cd2e3a", b: "#0047a0", k: "#000000" },
    grid: [
      "wwwwwwwwwwwwwww",
      "wkkwwwwwwwwwkkw",
      "wkkwwwrrrwwwkkw",
      "wwwwwrrrrrwwwww",
      "wwwwwrrbbbwwwww",
      "wwwwwbbbbbwwwww",
      "wkkwwwbbbwwwkkw",
      "wkkwwwwwwwwwkkw",
      "wwwwwwwwwwwwwww",
    ],
    mini: ["kwwk", "wrbw", "kwwk"],
  },
  au: {
    palette: { b: "#00008b", w: "#ffffff", r: "#ff0000" },
    grid: [
      "wbrbwbbbbbbwbbb",
      "rrrrrbbbbbbbbwb",
      "wbrbwbbbbwbbbbb",
      "bbbbbbbbbbbbwbb",
      "bbbbbbbbbbbbbbb",
      "bbwbbbbbbbbbwbb",
      "bwwwbbbbbbwbbbb",
      "bbwbbbbbbbbbbbb",
      "bbbbbbbbbbbwbbb",
    ],
    mini: ["wrbb", "rwbw", "bwbb"],
  },
  sg: {
    palette: { r: "#ef3340", w: "#ffffff" },
    grid: [
      "rrrrrrrrrrrrrrr",
      "rwwrrwrrrrrrrrr",
      "rwrrwrwrrrrrrrr",
      "rwwrrwrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "wwwwwwwwwwwwwww",
      "wwwwwwwwwwwwwww",
      "wwwwwwwwwwwwwww",
      "wwwwwwwwwwwwwww",
    ],
    mini: ["rwrr", "rrrr", "wwww"],
  },
  ch: {
    palette: { r: "#ff0000", w: "#ffffff" },
    grid: [
      "rrrrrrrrrrrrrrr",
      "rrrrrrwwwrrrrrr",
      "rrrrrrwwwrrrrrr",
      "rrrwwwwwwwwwrrr",
      "rrrwwwwwwwwwrrr",
      "rrrwwwwwwwwwrrr",
      "rrrrrrwwwrrrrrr",
      "rrrrrrwwwrrrrrr",
      "rrrrrrrrrrrrrrr",
    ],
    mini: ["rwrr", "wwwr", "rwrr"],
  },
  ae: {
    palette: { r: "#ff0000", g: "#00732f", w: "#ffffff", k: "#000000" },
    grid: [
      "rrrrggggggggggg",
      "rrrrggggggggggg",
      "rrrrggggggggggg",
      "rrrrwwwwwwwwwww",
      "rrrrwwwwwwwwwww",
      "rrrrwwwwwwwwwww",
      "rrrrkkkkkkkkkkk",
      "rrrrkkkkkkkkkkk",
      "rrrrkkkkkkkkkkk",
    ],
    mini: ["rggg", "rwww", "rkkk"],
  },
  za: {
    palette: { g: "#007a4d", y: "#ffb612", r: "#de3831", b: "#002395", w: "#ffffff", k: "#000000" },
    grid: [
      "gwrrrrrrrrrrrrr",
      "ygwwrrrrrrrrrrr",
      "kygggwwwwwwwwww",
      "kkygggggggggggg",
      "kkkyggggggggggg",
      "kkygggggggggggg",
      "kygggwwwwwwwwww",
      "ygwwbbbbbbbbbbb",
      "gwbbbbbbbbbbbbb",
    ],
    mini: ["gwrr", "kggg", "gwbb"],
  },
  ng: {
    palette: { g: "#008751", w: "#ffffff" },
    grid: Array.from({ length: 9 }, () => "gggggwwwwwggggg"),
    mini: ["gwwg", "gwwg", "gwwg"],
  },
  pl: {
    palette: { w: "#ffffff", r: "#dc143c" },
    grid: [
      "wwwwwwwwwwwwwww",
      "wwwwwwwwwwwwwww",
      "wwwwwwwwwwwwwww",
      "wwwwwwwwwwwwwww",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
    ],
    mini: ["wwww", "wwww", "rrrr"],
  },
  vn: {
    palette: { r: "#da251d", y: "#ffff00" },
    grid: [
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
      "rrrrrrryrrrrrrr",
      "rrrrrryyyrrrrrr",
      "rrrryyyyyyyrrrr",
      "rrrrryyyyyrrrrr",
      "rrrrryyryyrrrrr",
      "rrrrrrrrrrrrrrr",
      "rrrrrrrrrrrrrrr",
    ],
    mini: ["rrrr", "ryyr", "rrrr"],
  },
  se: {
    palette: { b: "#006aa7", y: "#fecc00" },
    grid: [
      "bbbbyybbbbbbbbb",
      "bbbbyybbbbbbbbb",
      "bbbbyybbbbbbbbb",
      "bbbbyybbbbbbbbb",
      "yyyyyyyyyyyyyyy",
      "bbbbyybbbbbbbbb",
      "bbbbyybbbbbbbbb",
      "bbbbyybbbbbbbbb",
      "bbbbyybbbbbbbbb",
    ],
    mini: ["bybb", "yyyy", "bybb"],
  },
  ie: {
    palette: { g: "#169b62", w: "#ffffff", o: "#ff883e" },
    grid: Array.from({ length: 9 }, () => "gggggwwwwwooooo"),
    mini: ["gwwo", "gwwo", "gwwo"],
  },
  tr: {
    palette: { r: "#e30a17", w: "#ffffff" },
    grid: [
      "rrrrrrrrrrrrrrr",
      "rrrrwwwrrrrrrrr",
      "rrrwwrrrrrrrrrr",
      "rrrwrrrrrrwrrrr",
      "rrwwrrrrrwwwrrr",
      "rrrwrrrrrrwrrrr",
      "rrrwwrrrrrrrrrr",
      "rrrrwwwrrrrrrrr",
      "rrrrrrrrrrrrrrr",
    ],
    mini: ["rwrr", "wrwr", "rwrr"],
  },
};

/** The 15×9 pixel flag of a country, or null for an unknown key. */
export function countryFlagArt(key: string | null | undefined): PixelArt | null {
  const f = key ? FLAGS[key] : undefined;
  return f ? { grid: f.grid, palette: f.palette } : null;
}

/** The 4×3 pixel flag for the pole on the headquarters, or null for an unknown key. */
export function countryFlagMini(key: string | null | undefined): PixelArt | null {
  const f = key ? FLAGS[key] : undefined;
  return f ? { grid: f.mini, palette: f.palette } : null;
}
