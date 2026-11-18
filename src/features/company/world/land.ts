/*
 * The pixel world map (ADR-208): a 540×210 raster (equirectangular, 180°W..180°E, 80°N..60°S like the map positions
 * in src/config/countries.ts) generated from Natural Earth shapes (scripts/gen-world-map.ts). On top of the raster this
 * file paints terrain (ice, tundra, forests, rain forest, savanna, deserts, mountain ranges), coasts, shallow water,
 * waves, lakes and country borders, the 22 game countries with stronger borders. Game styled, not a geographic
 * reference. Pure: the canvas in world-map.tsx paints the result once per theme, scaled by whole numbers only.
 */
import { WORLD_COLS, WORLD_KEYS, WORLD_RLE, WORLD_ROWS } from "./world-raster.generated";

export const MAP_COLS = WORLD_COLS;
export const MAP_ROWS = WORLD_ROWS;
const LAT_TOP = 80;
const LAT_SPAN = 140;

/** One raster row from its run-length encoding ("12." = twelve sea cells). */
export function decodeRow(rle: string): string {
  return rle.replace(/(\d+)(\D)/g, (_, n: string, c: string) => c.repeat(Number(n)));
}

/**
 * The raster, one string per row. Codes: "." sea, "o" lake, "#" land, "+" border, "A".."V" land of the game country
 * WORLD_KEYS[i], "a".."v" its border cells.
 */
export const LAND_GRID: readonly string[] = WORLD_RLE.map(decodeRow);

/** Map cell of a position in percent (as countries.ts `map`). */
export function cellOf(map: { x: number; y: number }): { col: number; row: number } {
  return {
    col: Math.min(MAP_COLS - 1, Math.max(0, Math.floor((map.x / 100) * MAP_COLS))),
    row: Math.min(MAP_ROWS - 1, Math.max(0, Math.floor((map.y / 100) * MAP_ROWS))),
  };
}

/** Longitude and latitude of the center of a cell. */
export function lonLatOf(col: number, row: number): { lon: number; lat: number } {
  return { lon: -180 + ((col + 0.5) / MAP_COLS) * 360, lat: LAT_TOP - ((row + 0.5) / MAP_ROWS) * LAT_SPAN };
}

/** Key of the game country a cell belongs to, or null (sea, lakes, other countries). */
export function countryAt(col: number, row: number): string | null {
  const c = LAND_GRID[row]?.charCodeAt(col) ?? 0;
  if (c >= 65 && c < 65 + WORLD_KEYS.length) return WORLD_KEYS[c - 65]!;
  if (c >= 97 && c < 97 + WORLD_KEYS.length) return WORLD_KEYS[c - 97]!;
  return null;
}

const isLand = (code: string | undefined) => code !== undefined && code !== "." && code !== "o";

// ------------------------------------------------------------------ terrain (data)

type Box = readonly [lon0: number, lat0: number, lon1: number, lat1: number];
type Range = { readonly path: readonly (readonly [number, number])[]; readonly width: number };

const DESERTS: readonly Box[] = [
  [-17, 16, 33, 31], // Sahara
  [35, 15, 58, 31], // Arabia
  [56, 25, 72, 34], // Iran, Thar
  [53, 37, 66, 45], // Karakum, Kysylkum
  [76, 36, 92, 42], // Taklamakan
  [93, 39, 117, 45], // Gobi
  [117, -31, 142, -20], // Australia
  [-117, 28, -105, 37], // Mojave, Sonora
  [12, -28, 24, -19], // Kalahari, Namib
  [-71.5, -27, -68.5, -17], // Atacama
];
const RAIN_FOREST: readonly Box[] = [
  [-76, -13, -47, 5], // Amazon
  [9, -5, 30, 5], // Congo
  [95, -9, 152, 8], // South East Asia, New Guinea
  [-90, 7, -77, 17], // Central America
];
const STEPPE: readonly Box[] = [
  [-71, -52, -65, -38], // Patagonia
  [44, 44, 90, 53], // Kazakh steppe
  [-112, 37, -96, 50], // Great Plains
];
const MOUNTAINS: readonly Range[] = [
  {
    path: [
      [71, 36.5],
      [76, 35],
      [80, 32],
      [85, 29],
      [92, 28],
      [97, 28.5],
    ],
    width: 2.2,
  }, // Himalaya
  {
    path: [
      [82, 34],
      [90, 33],
      [97, 32],
    ],
    width: 2.4,
  }, // Tibet
  {
    path: [
      [-77, 8],
      [-78, -2],
      [-76, -12],
      [-70, -18],
      [-69, -25],
      [-70, -33],
      [-72, -42],
      [-73, -52],
    ],
    width: 1.4,
  }, // Andes
  {
    path: [
      [-150, 62],
      [-136, 60],
      [-124, 53],
      [-116, 47],
      [-110, 42],
      [-106, 37],
      [-106, 31],
    ],
    width: 2,
  }, // Rocky Mountains
  {
    path: [
      [-104, 26],
      [-101, 21],
      [-97, 18],
    ],
    width: 1.2,
  }, // Sierra Madre
  {
    path: [
      [6, 44.5],
      [8, 46],
      [11, 46.8],
      [14, 47],
    ],
    width: 0.9,
  }, // Alps
  {
    path: [
      [-1, 43],
      [2.5, 42.6],
    ],
    width: 0.6,
  }, // Pyrenees
  {
    path: [
      [22, 47.5],
      [25, 46],
      [22, 44.5],
    ],
    width: 0.7,
  }, // Carpathians
  {
    path: [
      [40, 43.5],
      [48, 41.5],
    ],
    width: 0.9,
  }, // Caucasus
  {
    path: [
      [44, 37],
      [50, 33],
      [56, 29],
    ],
    width: 1.1,
  }, // Zagros
  {
    path: [
      [59, 50],
      [59.5, 58],
      [63, 66],
    ],
    width: 0.8,
  }, // Urals
  {
    path: [
      [69, 40],
      [78, 42],
      [86, 43],
      [92, 45],
      [97, 48],
    ],
    width: 1.3,
  }, // Tian Shan, Altai
  {
    path: [
      [38.5, 14],
      [39, 9],
      [37, 2],
      [36, -3],
    ],
    width: 1.4,
  }, // East African highlands
  {
    path: [
      [-8, 31],
      [-2, 33.5],
      [5, 35.5],
      [9, 36],
    ],
    width: 1,
  }, // Atlas
  {
    path: [
      [6, 59],
      [10, 62],
      [14, 65],
      [19, 68.5],
    ],
    width: 1.1,
  }, // Scandinavian mountains
  {
    path: [
      [147, -37.5],
      [151, -32],
      [148, -24],
      [145, -17],
    ],
    width: 0.9,
  }, // Great Dividing Range
  {
    path: [
      [-84, 35],
      [-80, 37.5],
      [-76, 41],
      [-72, 44],
    ],
    width: 0.8,
  }, // Appalachians
];

const inBox = (b: Box, lon: number, lat: number, pad = 0) =>
  lon >= b[0] - pad && lon <= b[2] + pad && lat >= b[1] - pad && lat <= b[3] + pad;

function distToPath(path: Range["path"], lon: number, lat: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i]!;
    const [bx, by] = path[i + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(lon - (ax + t * dx), lat - (ay + t * dy)));
  }
  return best;
}

/** Deterministic noise in [0, 1) per cell. */
export function hash01(col: number, row: number): number {
  let h = Math.imul(col, 374_761_393) + Math.imul(row, 668_265_263);
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_296;
}

/** Smooth noise in [0, 1): random values on a coarse lattice, blended between. */
function smooth01(col: number, row: number, size = 7): number {
  const gx = col / size;
  const gy = row / size;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v = (x: number, y: number) => hash01(x + 9_000, y + 9_000);
  const top = v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx;
  const bottom = v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

/**
 * Terrain of a land cell: "i" ice, "t" tundra, "f" forest, "F" rain forest, "v" savanna or steppe, "y"/"Y" desert,
 * "m"/"n" mountain (lit, shaded), "M" snowy peak, "g"/"G" grassland.
 */
export function terrainAt(col: number, row: number): string {
  const { lon, lat } = lonLatOf(col, row);
  const n = hash01(col, row);
  const s = smooth01(col, row, 9);
  const big = smooth01(col + 300, row + 300, 16);
  // ragged edges: a slow wobble in degrees plus a little per-pixel dither
  const wobble = (s - 0.5) * 5 + (big - 0.5) * 4 + (n - 0.5) * 1.2;

  const greenland = lon > -74 && lon < -11 && lat > 59.5;
  if ((greenland && lat > 61 + s * 2) || lat > 76 + wobble) return "i";

  for (const m of MOUNTAINS) {
    const d = distToPath(m.path, lon, lat);
    const w = m.width * (0.7 + s * 0.6);
    if (d < w) {
      if (d < w * 0.35) return n > 0.68 ? "M" : "m";
      return n < 0.08 ? "M" : n < 0.4 ? "n" : "m";
    }
  }

  if (lat > 66 + wobble || greenland) return s + (n - 0.5) * 0.3 > 0.72 ? "i" : "t";
  if (DESERTS.some((b) => inBox(b, lon, lat, wobble))) return n < 0.22 ? "Y" : "y";
  if (RAIN_FOREST.some((b) => inBox(b, lon, lat, wobble * 0.6))) return n < 0.2 ? "f" : "F";
  if (STEPPE.some((b) => inBox(b, lon, lat, wobble * 0.7))) return n < 0.2 ? "g" : "v";
  if (lat > 52 + wobble) return n < 0.12 ? "t" : "f";
  if (Math.abs(lat) < 18 + wobble && Math.abs(lat) > 6 + wobble * 0.3) return n < 0.25 ? "g" : "v";
  if (s + (n - 0.5) * 0.15 > 0.6) return n < 0.15 ? "G" : "f";
  return n < 0.3 ? "G" : "g";
}

// ------------------------------------------------------------------ the painted map

let codesMemo: readonly string[] | null = null;

/**
 * The finished map, one string per row, one palette key per cell: "d" deep sea, "w" wave, "S" shelf, "s" shallow
 * water, "o" lake, "c" beach, terrain keys (terrainAt), "b" border, "B" border of a game country. Computed once.
 */
export function worldMapCodes(): readonly string[] {
  if (codesMemo) return codesMemo;
  const W = MAP_COLS;
  const H = MAP_ROWS;
  // distance (in cells, up to 4) from every sea cell to the nearest land
  const dist = new Uint8Array(W * H).fill(255);
  let front: number[] = [];
  for (let row = 0; row < H; row++)
    for (let col = 0; col < W; col++)
      if (isLand(LAND_GRID[row]![col])) {
        dist[row * W + col] = 0;
        front.push(row * W + col);
      }
  for (let d = 1; d <= 4 && front.length; d++) {
    const next: number[] = [];
    for (const i of front) {
      const col = i % W;
      const row = (i - col) / W;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = (col + dx + W) % W;
        const y = row + dy;
        if (y < 0 || y >= H) continue;
        const j = y * W + x;
        if (dist[j]! > d && LAND_GRID[y]![x] === ".") {
          dist[j] = d;
          next.push(j);
        }
      }
    }
    front = next;
  }

  const rows: string[] = [];
  for (let row = 0; row < H; row++) {
    let out = "";
    const line = LAND_GRID[row]!;
    for (let col = 0; col < W; col++) {
      const code = line[col]!;
      if (code === "o") {
        out += "o";
        continue;
      }
      if (code === ".") {
        const d = dist[row * W + col]!;
        if (d <= 1) out += "s";
        else if (d <= 3) out += "S";
        else {
          // short wave crests in rows, shifted per band
          const band = Math.floor(row / 6);
          const wave = row % 6 === 3 && (col + band * 7) % 19 < 3 && hash01(Math.floor(col / 19), band) > 0.35;
          out += wave ? "w" : "d";
        }
        continue;
      }
      if (code === "+") {
        out += "b";
        continue;
      }
      if (code >= "a" && code <= "z") {
        out += "B";
        continue;
      }
      const { lat } = lonLatOf(col, row);
      const coast =
        Math.abs(lat) < 50 &&
        [line[col - 1], line[col + 1], LAND_GRID[row - 1]?.[col], LAND_GRID[row + 1]?.[col]].some((c) => c === ".");
      const t = terrainAt(col, row);
      out += coast && t !== "M" && t !== "m" && t !== "i" ? "c" : t;
    }
    rows.push(out);
  }
  codesMemo = rows;
  return rows;
}

export type MapTheme = "light" | "dark";

/** Map colors as data (one set per theme); "h" tints the selected country. */
export const WORLD_PALETTES: Readonly<Record<MapTheme, Readonly<Record<string, string>>>> = {
  light: {
    d: "#86bfe3",
    w: "#a6d3ef",
    S: "#99cbea",
    s: "#b0dbf3",
    o: "#8cc6ea",
    c: "#e9dcab",
    g: "#9fd07f",
    G: "#93c774",
    f: "#6faa5d",
    F: "#4f9550",
    v: "#c4cf7c",
    y: "#ecd89c",
    Y: "#dfc683",
    t: "#b5c6a4",
    i: "#f4f8fb",
    m: "#ac9a7c",
    n: "#8f7f63",
    M: "#e8e3da",
    b: "#6f8d61",
    B: "#2e3a63",
    h: "#ffd15c",
  },
  dark: {
    d: "#0c1a30",
    w: "#17304f",
    S: "#11243f",
    s: "#16304f",
    o: "#1c3d63",
    c: "#8a7b52",
    g: "#2f5c3a",
    G: "#2a5334",
    f: "#22482d",
    F: "#1b3f27",
    v: "#4f5a2f",
    y: "#7c6b43",
    Y: "#6d5e3a",
    t: "#475a4f",
    i: "#c3cfd8",
    m: "#5f574a",
    n: "#4a443a",
    M: "#a9a59d",
    b: "#15291c",
    B: "#e2c76c",
    h: "#ffd15c",
  },
};

const rgbOf = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * The map as RGBA pixels (MAP_COLS × MAP_ROWS) for a canvas. The land of the highlighted game country is tinted
 * with "h".
 */
export function worldMapPixels(theme: MapTheme, highlight?: string | null): Uint8ClampedArray {
  const codes = worldMapCodes();
  const palette = WORLD_PALETTES[theme];
  const rgb = new Map(Object.entries(palette).map(([k, v]) => [k, rgbOf(v)]));
  const tint = rgb.get("h")!;
  const out = new Uint8ClampedArray(MAP_COLS * MAP_ROWS * 4);
  for (let row = 0; row < MAP_ROWS; row++) {
    const line = codes[row]!;
    for (let col = 0; col < MAP_COLS; col++) {
      let [r, g, b] = rgb.get(line[col]!) ?? [255, 0, 255];
      if (highlight && countryAt(col, row) === highlight) {
        const a = line[col] === "B" ? 0.75 : 0.42;
        r = r + (tint[0] - r) * a;
        g = g + (tint[1] - g) * a;
        b = b + (tint[2] - b) * a;
      }
      const i = (row * MAP_COLS + col) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}
