import type { BattleKind } from "../../config/battles";
import type { PixelArt } from "./pixel-icon";

/*
 * Pixel art of the news battles (ADR-160): sprites for the arena (drawn on a canvas, in whole art pixels), the
 * colours of the arena floors and an icon per game. Pure data. "." is transparent.
 */

/** Colours of the arena: the studio around it, floor tiles, cracks, holes. Pixel-art palette (data). */
export const ARENA = {
  void: "#0b0f1e",
  voidLine: "#1a2240",
  chartRed: "#ff4d5e",
  chartRedDim: "#5a1b2a",
  frame: "#1b2238",
  frameLight: "#2b3555",
  tileA: "#2c3658",
  tileB: "#323d63",
  tileEdge: "#222a45",
  tileShine: "#46527d",
  candleUp: "#2fd98c",
  candleUpDark: "#1b8c5a",
  candleDown: "#ff4d5e",
  candleDownDark: "#a8222e",
  crack: "#ff4d5e",
  crackDark: "#5a1b2a",
  warn: "#ffd84a",
  sand: "#c9a36a",
  sandDark: "#a9844e",
  sandLight: "#e0c08a",
  tatami: "#bfae6a",
  tatamiDark: "#9d8c4c",
  tatamiLine: "#7a6a34",
  rope: "#e8e2cf",
  ropeDark: "#b8ae90",
  office: "#3a4563",
  officeDark: "#2e3752",
  officeLine: "#4a5679",
  parquet: "#8a5a3a",
  parquetDark: "#6e4429",
  parquetLight: "#a8724c",
  shadow: "#000000",
  white: "#ffffff",
  gold: "#ffd84a",
  goldDark: "#c9971a",
  gain: "#2fd98c",
  loss: "#ff4d5e",
  toxic: "#7dff5a",
  toxicDark: "#2f9a3a",
  spark: "#ffb02e",
  smoke: "#8a90a6",
} as const;

export const BULL: PixelArt = {
  palette: { b: "#5a3524", B: "#3e2216", w: "#f3efe4", r: "#ff2a3a", n: "#d98a7a", k: "#151722", y: "#ffd84a" },
  grid: [
    "...........w..w.",
    "..........wbbbbw",
    "..bbbbbbbbbbrbbb",
    ".bbbbbbbbbbbbbbb",
    "bbbbbbbbbbbbbbnn",
    "bbbbbbbbbbbbbnyn",
    ".bbbbbbbbbbbbbn.",
    ".bBBbbbbbbbBBb..",
    ".bb.bb....bb.bb.",
    ".kk.kk....kk.kk.",
  ],
};

export const COIN_SPRITE: PixelArt = {
  palette: { y: "#ffd84a", Y: "#c9971a", w: "#fff6c8", k: "#7a5a10" },
  grid: ["..kkkk..", ".kyyyyk.", "kywwyyYk", "kywyyyYk", "kyyyyyYk", "kyyyyYYk", ".kYYYYk.", "..kkkk.."],
};

export const GOLD_BAR: PixelArt = {
  palette: { y: "#ffd84a", Y: "#c9971a", w: "#fff6c8", k: "#7a5a10" },
  grid: ["..kkkkkkk.", ".kwwyyyyyk", "kwyyyyyyYk", "kyyyyyyYYk", "kYYYYYYYYk", ".kkkkkkkk."],
};

export const BEAR: PixelArt = {
  palette: { b: "#7a4a2a", B: "#5a3420", n: "#c48a5a", k: "#151722", r: "#ff2a3a", w: "#ffffff" },
  grid: [
    ".BB......BB.",
    "BbbB....BbbB",
    "BbbbbbbbbbbB",
    ".bbbbbbbbbb.",
    "bbrkbbbbrkbb",
    "bbbbbbbbbbbb",
    "bbbbnnnnbbbb",
    "bbbnnkknnbbb",
    ".bbnwwwwnbb.",
    "..bbbbbbbb..",
    "..BB....BB..",
  ],
};

/** The toxic stock: a green barrel with a skull and a fuse. */
export const TOXIC: PixelArt = {
  palette: { g: "#4fd94a", G: "#2f9a3a", d: "#1d5a24", k: "#151722", w: "#f3efe4", f: "#c9a36a" },
  grid: [
    "......f.....",
    ".....f......",
    "..kkkkkkkk..",
    ".kgggggggGk.",
    ".kGGGGGGGGk.",
    ".kggwwwwgGk.",
    ".kgwkwwkwGk.",
    ".kgwwwwwwGk.",
    ".kggwkkwgGk.",
    ".kGGGGGGGGk.",
    ".kggggggggk.",
    "..kkkkkkkk..",
  ],
};

/** A potted office plant (the walls of Giftaktie). */
export const PLANT: PixelArt = {
  palette: { g: "#2fd98c", G: "#1b8c5a", d: "#145a3a", p: "#c4502b", P: "#8a3420", k: "#151722" },
  grid: [
    "......g.........",
    "...g..gg..g.....",
    "..gGg.gG.gGg....",
    ".gGdg.gGgGdGg...",
    ".gGdGggGGGdGg...",
    "..gGdGGdGdGg.g..",
    "...gGdGddGGggGg.",
    "..ggGGdddGGdGg..",
    ".gGgGGGdGGGgg...",
    "..gGg.GdG.gGg...",
    "...g...d...g....",
    "....kkkkkkkk....",
    "...kppppppppk...",
    "...kpPpppppPk...",
    "....kpppppPk....",
    "....kppppppk....",
    ".....kkkkkk.....",
  ],
};

export const ROCKET: PixelArt = {
  palette: { w: "#eef0f6", W: "#b8bfd4", r: "#ff4d5e", R: "#c4243a", b: "#4f8cff", k: "#151722" },
  grid: [
    "...rr...",
    "..rrrr..",
    "..wwww..",
    ".wwbbww.",
    ".wbbbbw.",
    ".wwbbww.",
    ".wwwwWw.",
    ".wwwwWw.",
    "rwwwwWwr",
    "rRwwwWRr",
    "rR.kk.Rr",
  ],
};

export const FLAME: readonly [PixelArt, PixelArt] = [
  {
    palette: { y: "#ffd84a", o: "#ff9a2e", r: "#ff4d5e" },
    grid: ["..yy..", ".yooy.", ".oyyo.", "..or..", "..r..."],
  },
  {
    palette: { y: "#ffd84a", o: "#ff9a2e", r: "#ff4d5e" },
    grid: [".y..y.", ".oyyo.", "oyyyyo", ".oro..", "...r.."],
  },
];

export const HEART: PixelArt = {
  palette: { r: "#ff4d5e", R: "#c4243a", w: "#ffd0d6" },
  grid: [".rr.rr.", "rwrrrRr", "rrrrrRr", ".rrrRr.", "..rRr..", "...r..."],
};

export const HEART_EMPTY: PixelArt = {
  palette: { r: "#5a6178" },
  grid: [".rr.rr.", "r..r..r", "r.....r", ".r...r.", "..r.r..", "...r..."],
};

export const BELL: PixelArt = {
  palette: { g: "#ffd84a", G: "#c9971a", D: "#8a6410", w: "#fff6c8", k: "#3a2a10" },
  grid: [
    "...........kk...........",
    "..........kGGk..........",
    "..........kggk..........",
    ".........kggggk.........",
    ".......kkggwwggkk.......",
    "......kgggwwggggGk......",
    ".....kggwwggggggGGk.....",
    ".....kgwwgggggggGGk.....",
    "....kggwggggggggGGGk....",
    "....kgwwggggggggGGGk....",
    "....kgwgggggggggGGGk....",
    "...kggwgggggggggGGGGk...",
    "...kggggggggggggGGGGk...",
    "...kggggggggggggGGGGk...",
    "..kgggggggggggggGGGGGk..",
    "..kgggggggggggggGGGGGk..",
    ".kggggggggggggggGGGGGGk.",
    "kGGGGGGGGGGGGGGGGGGGGGGk",
    "kDDDDDDDDDDDDDDDDDDDDDDk",
    ".kkkkkkkkkkkkkkkkkkkkkk.",
    ".........kggggk.........",
    "..........kGGk..........",
    "...........kk...........",
  ],
};

/** Warning arrow at the edge of the arena (points right; mirrored for the other sides). */
export const WARN_ARROW: PixelArt = {
  palette: { r: "#ff4d5e", y: "#ffd84a", k: "#151722" },
  grid: ["...k....", "...rk...", "kkkryk..", "ryyyyrk.", "ryyyyrk.", "kkkryk..", "...rk...", "...k...."],
};

/** One icon per game (16×16), for the intro card, the lobby and the showcase. */
export const BATTLE_ICONS: Readonly<Record<BattleKind, PixelArt>> = {
  floor: {
    palette: { g: "#2fd98c", G: "#1b8c5a", r: "#ff4d5e", R: "#a8222e", k: "#151722", s: "#46527d" },
    grid: [
      "..............r.",
      "..g..........rr.",
      "..g.........r.r.",
      ".ggg......rr....",
      ".gGg.....r......",
      ".gGg...rr.......",
      ".ggg..r.........",
      "..g..r..........",
      "..g.r..r........",
      "...r...rr.......",
      "kkkkk..rRr..kkkk",
      "sssss..rRr..ssss",
      "sssss...r...ssss",
      "kkkk..k...k..kkk",
      "......k...k.....",
      ".....k.....k....",
    ],
  },
  bulls: {
    palette: { b: "#5a3524", w: "#f3efe4", r: "#ff2a3a", n: "#d98a7a", y: "#ffd84a", k: "#151722" },
    grid: [
      "w..............w",
      "ww............ww",
      ".www........www.",
      "..wwbbbbbbbbww..",
      "...bbbbbbbbbb...",
      "..bbbbbbbbbbbb..",
      "..bbrkbbbbkrbb..",
      "..bbbbbbbbbbbb..",
      "...bbbbbbbbbb...",
      "...bnnnnnnnnb...",
      "...nnknnnnknn...",
      "...nnnnnnnnnn...",
      "....nnnyynnn....",
      ".....nyyyyn.....",
      "......y..y......",
      "................",
    ],
  },
  coins: {
    palette: { y: "#ffd84a", Y: "#c9971a", w: "#fff6c8", k: "#7a5a10", b: "#4f8cff" },
    grid: [
      "....b.....b.....",
      "...b.....b..b...",
      "......b.....b...",
      "..kkkk..........",
      ".kywyyk...kkkk..",
      ".kwyyYk..kywyyk.",
      ".kyyyYk..kwyyYk.",
      "..kkkk...kyyyYk.",
      ".........kyyYYk.",
      "...kkkkkk.kkkk..",
      "..kwyyyyYk......",
      "..kkkkkkkk......",
      "..kwyyyyYk......",
      "..kkkkkkkk......",
      "..kwyyyyYk......",
      "..kkkkkkkk......",
    ],
  },
  sumo: {
    palette: { s: "#e8b48a", d: "#c47f5c", k: "#151722", w: "#eef0f6", r: "#e8424f", h: "#232634" },
    grid: [
      "......hhhh......",
      ".....hhhhhh.....",
      ".....hsssssh....",
      "....ssksskss....",
      "....sssssssss...",
      ".....ssrrss.....",
      "..sssssssssssss.",
      ".sssssssssssssss",
      "ssddssssssssddss",
      "sssssssssssssss.",
      ".sssswwwwwwssss.",
      "..ssrrrrrrrrss..",
      "...ssrrrrrrss...",
      "...sss....sss...",
      "...sss....sss...",
      "..kkkk....kkkk..",
    ],
  },
  potato: {
    palette: { g: "#4fd94a", G: "#2f9a3a", k: "#151722", w: "#f3efe4", f: "#c9a36a", y: "#ffd84a", o: "#ff9a2e" },
    grid: [
      ".........y.o....",
      "........oyo.....",
      ".......f.y......",
      "......f.........",
      "....kkkkkkkk....",
      "...kggggggggk...",
      "...kGGGGGGGGk...",
      "...kggwwwwggk...",
      "...kgwkwwkwgk...",
      "...kgwwwwwwgk...",
      "...kggwkkwggk...",
      "...kgggwwgggk...",
      "...kGGGGGGGGk...",
      "...kggggggggk...",
      "....kkkkkkkk....",
      "................",
    ],
  },
  pump: {
    palette: { g: "#2fd98c", G: "#1b8c5a", w: "#eef0f6", r: "#ff4d5e", y: "#ffd84a", k: "#151722" },
    grid: [
      ".............g..",
      "............ggg.",
      "...........g.g.g",
      ".............g..",
      "..........g..g..",
      ".........g......",
      "...wr...g.......",
      "..wwrr.g........",
      "..wwwwg.........",
      ".wwkwg..........",
      "..wwwg..........",
      ".yy.g...........",
      "yry..g..........",
      ".y...g..........",
      "kkkkkkkkkkkkkkkk",
      "................",
    ],
  },
  quiz: {
    palette: { a: "#9a7bff", A: "#6b4fd8", w: "#eef0f6", k: "#151722" },
    grid: [
      "....kkkkkkk.....",
      "...kaaaaaaak....",
      "..kaawwwwwaak...",
      "..kawwkkkwwak...",
      "..kawkk.kwwak...",
      "..kkkk..kwwak...",
      ".......kwwaak...",
      "......kwwaak....",
      ".....kwwaak.....",
      ".....kwaak......",
      ".....kwwak......",
      ".....kkkkk......",
      "................",
      ".....kkkkk......",
      ".....kwwAk......",
      ".....kkkkk......",
    ],
  },
  estimate: {
    palette: { r: "#ff4d5e", w: "#eef0f6", k: "#151722", y: "#ffd84a" },
    grid: [
      ".....kkkkkk.....",
      "...kkrrrrrrkk...",
      "..krrwwwwwwrrk..",
      ".krwwrrrrrrwwrk.",
      ".krwrrwwwwrrwrk.",
      "krwrrwrrrrwrrwrk",
      "krwrwrryyrrwrwrk",
      "krwrwryyyyrwrwrk",
      "krwrwryyyyrwrwrk",
      "krwrwrryyrrwrwrk",
      "krwrrwrrrrwrrwrk",
      ".krwrrwwwwrrwrk.",
      ".krwwrrrrrrwwrk.",
      "..krrwwwwwwrrk..",
      "...kkrrrrrrkk...",
      ".....kkkkkk.....",
    ],
  },
  bell: {
    palette: { g: "#ffd84a", G: "#c9971a", w: "#fff6c8", k: "#3a2a10", r: "#ff4d5e" },
    grid: [
      "r......kk......r",
      ".r....kGGk....r.",
      "..r..kggggk..r..",
      ".....kgwggk.....",
      "....kgwggggk....",
      "....kgwgggGk....",
      "...kgwgggggGk...",
      "...kgwggggGGk...",
      "...kggggggGGk...",
      "..kggggggggGGk..",
      "..kggggggggGGk..",
      ".kGGGGGGGGGGGGk.",
      ".kkkkkkkkkkkkkk.",
      "......kggk......",
      ".r.....kk.....r.",
      "r..............r",
    ],
  },
};
