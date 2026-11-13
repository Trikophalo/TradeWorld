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

/** League trophies (ADR-089): one cup, three metals. */
const TROPHY_GRID = [
  "kkkkkkkkkkkk",
  "kyhyyyyyyydk",
  "kyhyyyyyyydk",
  "kkyhyyyyydkk",
  ".kyyyyyyydk.",
  "..kyyyyydk..",
  "...kyyydk...",
  "....kydk....",
  "....kydk....",
  "...kkkkkk...",
  "..kyyyyydk..",
  "..kkkkkkkk..",
];
export const TROPHIES = {
  gold: { palette: { k: "#4a2a00", y: "#ffd15c", h: "#fff3c4", d: "#c98a1f" }, grid: TROPHY_GRID },
  silver: { palette: { k: "#2a2f3a", y: "#c9d2e0", h: "#ffffff", d: "#8e99ad" }, grid: TROPHY_GRID },
  bronze: { palette: { k: "#3a1d0a", y: "#d9894a", h: "#f5c49a", d: "#9a5524" }, grid: TROPHY_GRID },
} satisfies Record<string, PixelArt>;

/** A lab flask for pharma trials (ADR-090). */
export const FLASK: PixelArt = {
  palette: { k: "#1c2230", d: "#c9d2e0", g: "#2fd98c", h: "#c9f7e0" },
  grid: [
    "...kkkk...",
    "...kddk...",
    "...kddk...",
    "..kddddk..",
    ".kddddddk.",
    "kddggggddk",
    "kdggggggdk",
    "kggghggggk",
    "kgggggggkk",
    ".kkkkkkkk.",
  ],
};

/** Treasure chests for the daily reward (ADR-087): closed, open with coins, open and empty; gold for day 7. */
const CHEST_WOOD = { k: "#2a1a10", w: "#a0612c", h: "#c98a4b", d: "#6e3d1a", g: "#8e99ad", y: "#ffd15c", e: "#1a1410" };
const CHEST_GOLD = { k: "#4a2a00", w: "#e0a92e", h: "#ffe08a", d: "#a8741a", g: "#7a4a00", y: "#fff3c4", e: "#2a1a00" };
const CHEST_CLOSED_GRID = [
  "..kkkkkkkkkkkk..",
  ".khhhhhhhhhhhhk.",
  "kwwwwwwwwwwwwwwk",
  "kgwwwwwwwwwwwwgk",
  "kggggggggggggggk",
  "kddddddkkddddddk",
  "kwwwwwkyykwwwwwk",
  "kgwwwwkyykwwwwgk",
  "kgwwwwwkkwwwwwgk",
  "kgwwwwwwwwwwwwgk",
  "kgddddddddddddgk",
  "kkkkkkkkkkkkkkkk",
];
const CHEST_OPEN_GRID = [
  "..kkkkkkkkkkkk..",
  ".kddddddddddddk.",
  ".khhhhhhhhhhhhk.",
  "..kkkkkkkkkkkk..",
  "..kyyhyykyyhyk..",
  "kkyyyyyyyyyyyykk",
  "kggggggggggggggk",
  "kwwwwwwwwwwwwwwk",
  "kgwwwwwwwwwwwwgk",
  "kgwwwwwwwwwwwwgk",
  "kgddddddddddddgk",
  "kkkkkkkkkkkkkkkk",
];
const CHEST_EMPTY_GRID = [
  "..kkkkkkkkkkkk..",
  ".kddddddddddddk.",
  ".khhhhhhhhhhhhk.",
  "..kkkkkkkkkkkk..",
  "..keeeeeeeeeek..",
  "kkeeeeeeeeeeeekk",
  "kggggggggggggggk",
  "kwwwwwwwwwwwwwwk",
  "kgwwwwwwwwwwwwgk",
  "kgwwwwwwwwwwwwgk",
  "kgddddddddddddgk",
  "kkkkkkkkkkkkkkkk",
];
export const CHESTS = {
  wood: {
    closed: { palette: CHEST_WOOD, grid: CHEST_CLOSED_GRID },
    open: { palette: CHEST_WOOD, grid: CHEST_OPEN_GRID },
    empty: { palette: CHEST_WOOD, grid: CHEST_EMPTY_GRID },
  },
  gold: {
    closed: { palette: CHEST_GOLD, grid: CHEST_CLOSED_GRID },
    open: { palette: CHEST_GOLD, grid: CHEST_OPEN_GRID },
    empty: { palette: CHEST_GOLD, grid: CHEST_EMPTY_GRID },
  },
} satisfies Record<string, Record<"closed" | "open" | "empty", PixelArt>>;

/** A skill point as a small gem. */
export const GEM: PixelArt = {
  palette: { k: "#1c1440", c: "#9b7bff", h: "#e4dcff", d: "#5b3fd1" },
  grid: ["..kkkk..", ".kchhck.", "kcchccck", "kcccccdk", ".kccdk..", "..kdk...", "...k...."],
};

/** The streak shield (one missed day per week is forgiven). */
export const SHIELD: PixelArt = {
  palette: { k: "#1c2230", b: "#4f8cff", h: "#cfe0ff" },
  grid: ["kkkkkkkk", "kbbhbbbk", "kbhbbbbk", "kbbbbbbk", ".kbbbbk.", "..kbbk..", "...kk..."],
};

/** The vault door (ADR-086): steel frame, door with bolts and a golden wheel; hinges on the left. */
export const VAULT_DOOR: PixelArt = {
  palette: {
    k: "#1c2230",
    h: "#c9d2e0",
    s: "#8e99ad",
    l: "#aab4c6",
    d: "#5d6880",
    g: "#3b4456",
    b: "#d8dee9",
    y: "#f2c14e",
    o: "#a8741a",
  },
  grid: [
    ".kkkkkkkkkkkkkkkkkkkkkk.",
    "khhhhhhhhhhhhhhhhhhhhhhk",
    "khsssssssssssssssssssssk",
    "khslllllllllllllllllkssk",
    "khslddddddddddddddddkssk",
    "khsldbddddddddddddbdkssk",
    "khkgddddddkkkkddddddkssk",
    "khkgddddkyyyyyykddddkssk",
    "khsldddkyyddydyykdddkssk",
    "khsldddyydddyddyydddkssk",
    "khslddkyddddydddykddkssk",
    "khslddkydddoodddykddkssk",
    "khslddkyyyyoodyyykddkssk",
    "khslddkyddddddddykddkssk",
    "khsldddyydddyddyydddkssk",
    "khsldddkyyddydyykdddkssk",
    "khkgddddkyyyyyykddddkssk",
    "khkgddddddkkkkddddddkssk",
    "khsldbddddddddddddbdkssk",
    "khslddddddddddddddddkssk",
    "khskkkkkkkkkkkkkkkkkkssk",
    "khsssssssssssssssssssssk",
    "khsssssssssssssssssssssk",
    ".kkkkkkkkkkkkkkkkkkkkkk.",
  ],
};

/** A gold bar for the inside of the vault. */
export const GOLD_BAR: PixelArt = {
  palette: { k: "#7a4a00", y: "#ffd15c", h: "#fff3c4", o: "#e09a1f" },
  grid: ["..kkkkkkk.", ".kyyhhyyyk", "kyyhyyyyok", "kyyyyyyyok", "kkkkkkkkkk"],
};

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

/** Upgrades (ADR-093): a book for further training, an alarm clock for overtime, a speech bubble for rhetoric. */
export const BOOK: PixelArt = {
  palette: { k: "#1c2230", b: "#4f8cff", h: "#cfe0ff", d: "#2b5bc4", p: "#f2efe6", y: "#f2c14e" },
  grid: [
    "............",
    ".kkkkkkkkkk.",
    ".kbbbbbbbbbk",
    ".kbhbbbbbbbk",
    ".kbhbyyyybbk",
    ".kbhbbbbbbbk",
    ".kbhbyyybbbk",
    ".kbhbbbbbbbk",
    ".kbbbbbbbbbk",
    ".kdddddddddk",
    ".kpppppppppk",
    ".kkkkkkkkkk.",
  ],
};

export const ALARM_CLOCK: PixelArt = {
  palette: { k: "#1c2230", w: "#f2efe6", y: "#f2c14e" },
  grid: [
    "kk........kk",
    "kyk.kkkk.kyk",
    ".kkkwwwwkkk.",
    ".kwwwwkwwwk.",
    "kwwwwwkwwwwk",
    "kwwwwwkwwwwk",
    "kwwwwwkkkwwk",
    "kwwwwwwwwwwk",
    ".kwwwwwwwwk.",
    ".kkwwwwwwkk.",
    ".k.kkkkkk.k.",
    "............",
  ],
};

export const SPEECH: PixelArt = {
  palette: { k: "#1c2230", w: "#f2efe6", a: "#9b7bff" },
  grid: [
    "............",
    ".kkkkkkkkkk.",
    "kwwwwwwwwwwk",
    "kwaawaaawwwk",
    "kwwwwwwwwwwk",
    "kwaaawaawwwk",
    "kwwwwwwwwwwk",
    ".kkwwkkkkkk.",
    "..kwk.......",
    "..kk........",
    "............",
    "............",
  ],
};

/** Marketing campaigns (ADR-097). */
export const MEGAPHONE: PixelArt = {
  palette: { k: "#1c2230", r: "#ef5b5b", h: "#ffb3b3", s: "#8e99ad" },
  grid: [
    "............",
    ".........kk.",
    ".......kkrk.",
    ".....kkrrrk.",
    "kkkkkrrhrrk.",
    "ksskrrrhrrk.",
    "ksskrrrrrrk.",
    "kkkkkrrrrrk.",
    "..k..kkrrrk.",
    "..k....kkrk.",
    "..kk.....kk.",
    "............",
  ],
};

/** A contract with a wax seal: deals between players (ADR-098). */
export const CONTRACT: PixelArt = {
  palette: { k: "#1c2230", p: "#f2efe6", l: "#c9d2e0", r: "#ef5b5b", d: "#a83a3a" },
  grid: [
    ".kkkkkkkk...",
    "kppppppppk..",
    "kpllllllpk..",
    "kppppppppk..",
    "kplllllppk..",
    "kppppppppk..",
    "kpllllllpk..",
    "kppppppppk..",
    "kpllllkkkk..",
    "kppppkrrrrk.",
    "kkkkkkrddrk.",
    "......krrk..",
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
  /** Upgrades (ADR-093): an arrow up out of a box. */
  upgrade: {
    palette: mono,
    grid: [
      ".....xx.....",
      "....xxxx....",
      "...xxxxxx...",
      "..xxxxxxxx..",
      ".....xx.....",
      ".....xx.....",
      "x....xx....x",
      "x....xx....x",
      "x..........x",
      "x..........x",
      "xxxxxxxxxxxx",
      "............",
    ],
  },
  /** Deals between players (ADR-098): two hands meet. */
  deal: {
    palette: mono,
    grid: [
      "............",
      "xx........xx",
      "xxx......xxx",
      "xxxx.xx.xxxx",
      "xx.xxxxxx.xx",
      "xx..xxxxx.xx",
      "xx.xxxxxx.xx",
      "xx..xxxx..xx",
      "xx...xx...xx",
      "............",
      "............",
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
  art: {
    palette: mono,
    grid: [
      "............",
      "xxxxxxxxxxxx",
      "x..........x",
      "x.xx.......x",
      "x.xx....x..x",
      "x......xxx.x",
      "x.....xxxxxx",
      "x..x.xxxxxxx",
      "x.xxxxxxxxxx",
      "xxxxxxxxxxxx",
      "............",
      "............",
    ],
  },
  heart: {
    palette: mono,
    grid: [
      "............",
      "..xx....xx..",
      ".xxxx..xxxx.",
      "xxxxxxxxxxxx",
      "xxxxxxxxxxxx",
      "xxxxxxxxxxxx",
      ".xxxxxxxxxx.",
      "..xxxxxxxx..",
      "...xxxxxx...",
      "....xxxx....",
      ".....xx.....",
      "............",
    ],
  },
  robot: {
    palette: mono,
    grid: [
      ".....xx.....",
      ".....xx.....",
      "..xxxxxxxx..",
      "..x......x..",
      "..x.xx.xx.x.",
      "xxx......xxx",
      "..x.xxxx.x..",
      "..xxxxxxxx..",
      "...x....x...",
      "..xxxxxxxx..",
      "..x.x..x.x..",
      "............",
    ],
  },
} as const satisfies Record<string, PixelArt>;

export type UiIconName = keyof typeof UI_ICONS;

// ---------------------------------------------------------------- company buildings (ADR-071)

/** The headquarters grows with the company tier: garage, shop, office, tower. */
export const COMPANY_BUILDINGS = {
  garage: {
    palette: { k: OUTLINE, w: "#e2cfa8", r: "#c8553d", d: "#9aa6b8" },
    grid: [
      "................",
      "................",
      "................",
      "................",
      "................",
      "......kkkk......",
      "....kkrrrrkk....",
      "..kkrrrrrrrrkk..",
      "kkrrrrrrrrrrrrkk",
      ".kwwwwwwwwwwwwk.",
      ".kwwkkkkkkkkwwk.",
      ".kwwkddddddkwwk.",
      ".kwwkkkkkkkkwwk.",
      ".kwwkddddddkwwk.",
      ".kwwkddddddkwwk.",
      "kkkkkkkkkkkkkkkk",
    ],
  },
  small_business: {
    palette: { k: OUTLINE, w: "#f0e2c4", s: "#ffd15c", a: "#ff6170", b: "#fff3e6", g: "#62c8ff" },
    grid: [
      "................",
      "................",
      "................",
      ".kkkkkkkkkkkkkk.",
      ".kwsssssssssswk.",
      ".kwwwwwwwwwwwwk.",
      "kabababababababk",
      ".kwwwwwwwwwwwwk.",
      ".kwggggwkaakwwk.",
      ".kwgbbgwkaakwwk.",
      ".kwggggwkaakwwk.",
      ".kwggggwkaakwwk.",
      ".kwwwwwwkaakwwk.",
      ".kwwwwwwkaskwwk.",
      ".kwwwwwwkaakwwk.",
      "kkkkkkkkkkkkkkkk",
    ],
  },
  gmbh: {
    palette: { k: OUTLINE, w: "#c9d3e3", g: "#62c8ff", d: "#46597a" },
    grid: [
      "................",
      "................",
      "...kkkkkkkkkk...",
      "...kwwwwwwwwk...",
      "...kwgwgwgwgk...",
      "...kwwwwwwwwk...",
      "...kwgwgwgwgk...",
      "...kwwwwwwwwk...",
      ".kkkkkkkkkkkkkk.",
      ".kwwwwwwwwwwwwk.",
      ".kwgwgwgwgwgwwk.",
      ".kwwwwwwwwwwwwk.",
      ".kwgwgwkddkgwwk.",
      ".kwwwwwkddkwwwk.",
      ".kwwwwwkddkwwwk.",
      "kkkkkkkkkkkkkkkk",
    ],
  },
  ag: {
    palette: { k: OUTLINE, w: "#aab6cc", g: "#7fd8ff", d: "#2f3c58", f: "#ff6170" },
    grid: [
      "......kfff......",
      "......kff.......",
      "......k.........",
      "....kkkkkkkk....",
      "....kgwggwgk....",
      "....kwwwwwwk....",
      "....kgwggwgk....",
      "....kwwwwwwk....",
      "....kgwggwgk....",
      "..kkkwwwwwwkkk..",
      "..kgwgwggwgwgk..",
      "..kwwwwwwwwwwk..",
      "..kgwgwggwgwgk..",
      "..kwwwkddkwwwk..",
      "..kwwwkddkwwwk..",
      "kkkkkkkkkkkkkkkk",
    ],
  },
} as const satisfies Record<string, PixelArt>;

/** Everything, for the showcase page and the shape test. */
export const ALL_PIXEL_ART: Record<string, PixelArt> = {
  ...Object.fromEntries(Object.entries(SECTOR_ICONS).map(([k, v]) => [`sector/${k}`, v])),
  ...Object.fromEntries(Object.entries(COMPANY_LOGOS).map(([k, v]) => [`logo/${k}`, v])),
  coin: COIN,
  book: BOOK,
  alarm_clock: ALARM_CLOCK,
  speech: SPEECH,
  megaphone: MEGAPHONE,
  contract: CONTRACT,
  bull: BULL,
  bear: BEAR,
  ...Object.fromEntries(Object.entries(FINN).map(([k, v]) => [`finn/${k}`, v])),
  ...Object.fromEntries(Object.entries(UI_ICONS).map(([k, v]) => [`ui/${k}`, v])),
  ...Object.fromEntries(Object.entries(COMPANY_BUILDINGS).map(([k, v]) => [`building/${k}`, v])),
};
