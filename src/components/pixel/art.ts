import type { PixelArt } from "./pixel-icon";

/*
 * The first NEXA pixel-art set. Every piece is a character grid plus a palette.
 * Rules (docs/DESIGN_SYSTEM.md): 16×16 for illustrations and logos, 12×12 for
 * single-colour interface icons, at most six colours per piece, one dark
 * outline colour, light from the top left.
 */

/** Mid-tone outline: readable on dark and on light surfaces. */
const OUTLINE = "#5d6679";
/** Eyes and nostrils. */
const INK = "#1b1e2b";

// ---------------------------------------------------------------- sectors

const tech: PixelArt = {
  palette: { k: OUTLINE, s: "#1f2a44", c: "#62e0ff", g: "#2fd98c", b: "#8f9bb3" },
  grid: [
    "................",
    "................",
    ".kkkkkkkkkkkkkk.",
    ".kssssssssssssk.",
    ".ksggsssssssssk.",
    ".kssscccccssssk.",
    ".kssscccssssssk.",
    ".ksggsssssssssk.",
    ".ksssccccccsssk.",
    ".kssssssssssssk.",
    ".kkkkkkkkkkkkkk.",
    "......bbbb......",
    "......bbbb......",
    "....kkkkkkkk....",
    "................",
    "................",
  ],
};

const retail: PixelArt = {
  palette: { k: OUTLINE, b: "#ff9a52", d: "#d4621a", h: "#ffc08f", w: "#fff3e6" },
  grid: [
    "................",
    ".....kkkkkk.....",
    "....kk....kk....",
    "....k......k....",
    "..kkkkkkkkkkkk..",
    "..khhhhhhhhhhk..",
    "..kbbwbbbbwbbk..",
    "..kbbwbbbbwbbk..",
    "..kbbbwwwwbbbk..",
    "..kbbbbbbbbbbk..",
    "..kbbbbbbbbbbk..",
    "..kbbbbbbbbbbk..",
    "..kddddddddddk..",
    "..kkkkkkkkkkkk..",
    "................",
    "................",
  ],
};

const energy: PixelArt = {
  palette: { o: "#7a4a00", y: "#ffd15c", h: "#fff3c4", d: "#f0a52a" },
  grid: [
    "................",
    ".........oooo...",
    "........ohyyo...",
    ".......ohyyo....",
    "......ohyyo.....",
    ".....ohyyo......",
    "....ohyyyoooo...",
    "...ohyyyyyydo...",
    "...ooooyyydo....",
    "......oyydo.....",
    ".....oyydo......",
    "....oyydo.......",
    "...oyydo........",
    "...oooo.........",
    "................",
    "................",
  ],
};

const pharma: PixelArt = {
  palette: { k: OUTLINE, w: "#dfe9f5", p: "#ff7ac3", d: "#d9438f", l: "#ffd3ec" },
  grid: [
    "................",
    ".....kkkkkk.....",
    "......kwwk......",
    "......kwwk......",
    "......kwwk......",
    "......kwwk......",
    ".....kwwwwk.....",
    "....kwwwwwwk....",
    "...kppppppppk...",
    "...kpplpppppk...",
    "..kpppppplpppk..",
    "..kppplppppppk..",
    "..kddddddddddk..",
    "...kkkkkkkkkk...",
    "................",
    "................",
  ],
};

const logistics: PixelArt = {
  palette: { k: OUTLINE, b: "#5aa7ff", d: "#2f7fe6", c: "#ffb84d", w: "#dff1ff", g: "#8f9bb3" },
  grid: [
    "................",
    "................",
    "................",
    ".kkkkkkkkkk.....",
    ".kbbbbbbbbk.....",
    ".kbbbbbbbbkkkk..",
    ".kbbbbbbbbkwwck.",
    ".kbbbbbbbbkwwck.",
    ".kbbbbbbbbkcccck",
    ".kddddddddkcccck",
    ".kkkkkkkkkkkkkkk",
    "..kggk....kggk..",
    "..kggk....kggk..",
    "...kk......kk...",
    "................",
    "................",
  ],
};

export const SECTOR_ICONS = { tech, retail, energy, pharma, logistics } as const;
export type SectorKey = keyof typeof SECTOR_ICONS;

// ---------------------------------------------------------------- company logos

const volta: PixelArt = {
  palette: { n: "#17306b", y: "#ffd15c", h: "#fff3c4" },
  grid: [
    ".nnnnnnnnnnnnnn.",
    "nnnnnnnnnnnnnnnn",
    "nnnnnnnnhyyynnnn",
    "nnnnnnnhyyynnnnn",
    "nnnnnnhyyynnnnnn",
    "nnnnnhyyynnnnnnn",
    "nnnnhyyyyyyynnnn",
    "nnnnyyyyyyyynnnn",
    "nnnnnnnnyyynnnnn",
    "nnnnnnnyyynnnnnn",
    "nnnnnnyyynnnnnnn",
    "nnnnnyyynnnnnnnn",
    "nnnnyyynnnnnnnnn",
    "nnnnnnnnnnnnnnnn",
    "nnnnnnnnnnnnnnnn",
    ".nnnnnnnnnnnnnn.",
  ],
};

const brotzeit: PixelArt = {
  palette: { m: "#7d2a2a", b: "#f0b46a", c: "#b8742f", w: "#fff0cf" },
  grid: [
    ".mmmmmmmmmmmmmm.",
    "mmmmmmmmmmmmmmmm",
    "mmmmmmmmmmmmmmmm",
    "mmmmmbbbbbbmmmmm",
    "mmmbbbbbbbbbbmmm",
    "mmbbbwbbwbbwbbmm",
    "mmbbwbbwbbwbbbmm",
    "mmbbbbbbbbbbbbmm",
    "mmbbbbbbbbbbbbmm",
    "mmcbbbbbbbbbbcmm",
    "mmccccccccccccmm",
    "mmmccccccccccmmm",
    "mmmmmmmmmmmmmmmm",
    "mmmmmmmmmmmmmmmm",
    "mmmmmmmmmmmmmmmm",
    ".mmmmmmmmmmmmmm.",
  ],
};

const klarsoft: PixelArt = {
  palette: { t: "#0f6f7a", w: "#f3fbfc", a: "#62e0ff" },
  grid: [
    ".tttttttttttttt.",
    "tttttttttttttttt",
    "tttttttttttttttt",
    "ttttwwttttwwtttt",
    "ttttwwtttwwttttt",
    "ttttwwttwwtttttt",
    "ttttwwtwwttttttt",
    "ttttwwwwtttttttt",
    "ttttwwwwtttttttt",
    "ttttwwtwwttttttt",
    "ttttwwttwwtttttt",
    "ttttwwtttwwttttt",
    "ttttwwttttwwaatt",
    "tttttttttttttttt",
    "tttttttttttttttt",
    ".tttttttttttttt.",
  ],
};

export const COMPANY_LOGOS = { VLT: volta, BRZ: brotzeit, KLS: klarsoft } as const;

// ---------------------------------------------------------------- mascots and objects

export const COIN: PixelArt = {
  palette: { o: "#7a4a00", y: "#ffd15c", h: "#fff3c4", d: "#e09a1f" },
  grid: [
    ".....oooooo.....",
    "...ooyyyyyyoo...",
    "..oyhhyyyyyyyo..",
    ".oyhyyyyyyyyydo.",
    ".oyhyyyooyyyydo.",
    "oyhyyyoyyoyyyydo",
    "oyhyyyoyyyyyyydo",
    "oyyyyyyooyyyyydo",
    "oyyyyyyyyoyyyydo",
    "oyyyyyoyyoyyyydo",
    "oyyyyyyooyyyyddo",
    ".oyyyyyyyyyyddo.",
    ".oyyyyyyyyydddo.",
    "..oyyyyyyydddo..",
    "...ooddddddoo...",
    ".....oooooo.....",
  ],
};

export const BULL: PixelArt = {
  palette: { h: "#e9c88a", g: "#2fd98c", d: "#17a866", k: INK, s: "#c9f7e0" },
  grid: [
    "................",
    ".h............h.",
    ".hh..........hh.",
    "..hhh......hhh..",
    "...hggggggggh...",
    "...gggggggggg...",
    "..gggggggggggg..",
    "..ggkkggggkkgg..",
    "..ggkkggggkkgg..",
    "..dggggggggggd..",
    "...dggggggggd...",
    "...dssssssssd...",
    "...ssksssskss...",
    "...ssssssssss...",
    "....ssssssss....",
    "................",
  ],
};

export const BEAR: PixelArt = {
  palette: { r: "#ff6170", d: "#c93a4c", k: INK, s: "#ffd9dd" },
  grid: [
    "................",
    "..rrr......rrr..",
    ".rrdrr....rrdrr.",
    ".rrdrrrrrrrrdrr.",
    "..rrrrrrrrrrrr..",
    "..rrrrrrrrrrrr..",
    ".rrrrrrrrrrrrrr.",
    ".rrrkkrrrrkkrrr.",
    ".rrrkkrrrrkkrrr.",
    ".rrrrrrrrrrrrrr.",
    ".drrrssssssrrrd.",
    "..drsskkkkssrd..",
    "..drssskksssrd..",
    "...ddssssssdd...",
    "....dddddddd....",
    "................",
  ],
};

// ---------------------------------------------------------------- mascot

/*
 * Finn, the "Börsenfuchs" (German for a shrewd trader). He guides new players
 * through the tutorial. One base drawing plus row overrides per expression,
 * so all frames stay pixel-identical outside the face. The bow tie uses the
 * app accent colour.
 */
const FINN_PALETTE = { o: "#ff9a52", d: "#c2571a", w: "#fff3e6", k: INK, t: "var(--accent)" } as const;

const FINN_BASE = [
  "................",
  ".oo..........oo.",
  ".ooo........ooo.",
  ".odoo......oodo.",
  ".odoooooooooodo.",
  ".oooooooooooooo.",
  ".oooooooooooooo.",
  ".ookkooooookkoo.",
  ".ookkooooookkoo.",
  ".wwooooooooooww.",
  ".wwwwookkoowwww.",
  "..wwwwwkkwwwww..",
  "...wwwwwwwwww...",
  "....wwwwwwww....",
  "....tt.tt.tt....",
  ".....tttttt.....",
] as const;

function finnFrame(overrides: Record<number, string>): PixelArt {
  return { palette: FINN_PALETTE, grid: FINN_BASE.map((row, index) => overrides[index] ?? row) };
}

export const FINN = {
  idle: finnFrame({}),
  blink: finnFrame({ 7: ".oooooooooooooo." }),
  talk: finnFrame({ 12: "...wwwwkkwwww..." }),
  happy: finnFrame({ 7: ".ookkooooookkoo.", 8: ".okookooookooko.", 12: "...wwwkkkkwww..." }),
} as const satisfies Record<string, PixelArt>;

export type FinnMood = keyof typeof FINN;

// ---------------------------------------------------------------- interface icons (12×12, single colour)

const mono = { x: "currentColor" } as const;

export const UI_ICONS = {
  home: {
    palette: mono,
    grid: [
      ".....xx.....",
      "....xxxx....",
      "...xxxxxx...",
      "..xxxxxxxx..",
      ".xxxxxxxxxx.",
      "xxxxxxxxxxxx",
      "..xxxxxxxx..",
      "..xxx..xxx..",
      "..xxx..xxx..",
      "..xxx..xxx..",
      "..xxx..xxx..",
      "............",
    ],
  },
  portfolio: {
    palette: mono,
    grid: [
      "............",
      "....xxxx....",
      "....x..x....",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      ".xxxx..xxxx.",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      "............",
      "............",
    ],
  },
  markets: {
    palette: mono,
    grid: [
      "............",
      ".........xx.",
      ".........xx.",
      "......xx.xx.",
      "......xx.xx.",
      "...xx.xx.xx.",
      "...xx.xx.xx.",
      "xx.xx.xx.xx.",
      "xx.xx.xx.xx.",
      "xx.xx.xx.xx.",
      "............",
      "............",
    ],
  },
  company: {
    palette: mono,
    grid: [
      "...xxxxxx...",
      "...x.xx.x...",
      "...xxxxxx...",
      "...x.xx.x...",
      "...xxxxxx...",
      "...x.xx.x...",
      "...xxxxxx...",
      "...x.xx.x...",
      "...xxxxxx...",
      ".xxxx..xxxx.",
      ".xxxx..xxxx.",
      "............",
    ],
  },
  profile: {
    palette: mono,
    grid: [
      "....xxxx....",
      "...xxxxxx...",
      "...xxxxxx...",
      "...xxxxxx...",
      "....xxxx....",
      "............",
      "..xxxxxxxx..",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      "............",
    ],
  },
  lock: {
    palette: mono,
    grid: [
      "....xxxx....",
      "...xx..xx...",
      "...x....x...",
      "...x....x...",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      ".xxxx..xxxx.",
      ".xxxx..xxxx.",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      "............",
      "............",
    ],
  },
  search: {
    palette: mono,
    grid: [
      "...xxxx.....",
      "..x....x....",
      ".x......x...",
      ".x......x...",
      ".x......x...",
      ".x......x...",
      "..x....x....",
      "...xxxxx....",
      ".......xx...",
      "........xx..",
      ".........xx.",
      "............",
    ],
  },
  bell: {
    palette: mono,
    grid: [
      ".....xx.....",
      "....xxxx....",
      "...xxxxxx...",
      "...xxxxxx...",
      "...xxxxxx...",
      "..xxxxxxxx..",
      "..xxxxxxxx..",
      ".xxxxxxxxxx.",
      ".xxxxxxxxxx.",
      "............",
      ".....xx.....",
      "............",
    ],
  },
  flame: {
    palette: mono,
    grid: [
      ".....x......",
      "....xx......",
      "....xxx.....",
      "...xxxx..x..",
      "...xxxxx.x..",
      "..xxxxxxxx..",
      "..xxxx.xxx..",
      ".xxxx...xxx.",
      ".xxx.....xx.",
      ".xxx.....xx.",
      "..xxx...xx..",
      "...xxxxxx...",
    ],
  },
  gift: {
    palette: mono,
    grid: [
      "..xx....xx..",
      ".x..x..x..x.",
      ".x...xx...x.",
      "..xxxxxxxx..",
      "xxxxxxxxxxxx",
      "x....xx....x",
      "xxxxxxxxxxxx",
      ".x...xx...x.",
      ".x...xx...x.",
      ".x...xx...x.",
      ".x...xx...x.",
      ".xxxxxxxxxx.",
    ],
  },
  briefcase: {
    palette: mono,
    grid: [
      "............",
      "....xxxx....",
      "...x....x...",
      ".xxxxxxxxxx.",
      "x..........x",
      "x..........x",
      "xxxxx..xxxxx",
      "x....xx....x",
      "x..........x",
      "x..........x",
      ".xxxxxxxxxx.",
      "............",
    ],
  },
  star: {
    palette: mono,
    grid: [
      ".....xx.....",
      ".....xx.....",
      "....xxxx....",
      "xxxxxxxxxxxx",
      ".xxxxxxxxxx.",
      "..xxxxxxxx..",
      "...xxxxxx...",
      "..xxxxxxxx..",
      "..xxx..xxx..",
      ".xxx....xxx.",
      ".xx......xx.",
      "............",
    ],
  },
  card: {
    palette: mono,
    grid: [
      "............",
      "xxxxxxxxxxxx",
      "x..........x",
      "x.xxx......x",
      "x.xxx.xxxx.x",
      "x.xxx......x",
      "x.....xxx..x",
      "x.xxx......x",
      "x..........x",
      "xxxxxxxxxxxx",
      "............",
      "............",
    ],
  },
} as const satisfies Record<string, PixelArt>;

export type UiIconName = keyof typeof UI_ICONS;

/** Everything, for the showcase page and the shape test. */
export const ALL_PIXEL_ART: Record<string, PixelArt> = {
  ...Object.fromEntries(Object.entries(SECTOR_ICONS).map(([k, v]) => [`sector/${k}`, v])),
  ...Object.fromEntries(Object.entries(COMPANY_LOGOS).map(([k, v]) => [`logo/${k}`, v])),
  coin: COIN,
  bull: BULL,
  bear: BEAR,
  ...Object.fromEntries(Object.entries(FINN).map(([k, v]) => [`finn/${k}`, v])),
  ...Object.fromEntries(Object.entries(UI_ICONS).map(([k, v]) => [`ui/${k}`, v])),
};
