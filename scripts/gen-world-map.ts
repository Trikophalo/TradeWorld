/*
 * Builds the pixel world map raster (ADR-208) from Natural Earth country shapes (public domain, via the npm package
 * world-atlas@2.0.2, file countries-50m.json): `pnpm worldmap <path/to/countries-50m.json>`. Download it with
 * `npm pack world-atlas@2.0.2` and unpack it; the data is not a dependency of the app.
 *
 * Writes src/features/company/world/world-raster.generated.ts: WORLD_COLS × WORLD_ROWS cells (equirectangular,
 * 180°W..180°E, 80°N..60°S like src/config/countries.ts), one run-length encoded string per row. Each cell is sampled
 * 4 × 4 times; it is land when at least 5 of 16 samples are, and belongs to the country most samples fall in. Codes:
 *   "."  sea           "o"  lake (hand drawn rings below)
 *   "#"  land          "+"  land on a border to another country
 *   "A".."V"           land of the game countries (index in WORLD_KEYS), "a".."v" their border cells
 */
import { readFileSync, writeFileSync } from "node:fs";
import { COUNTRIES } from "../src/config/countries";

const COLS = 540;
const ROWS = 210;
const SUB = 4;
const LAT_TOP = 80;
const LAT_SPAN = 140;

/** ISO 3166 numeric ids of the game countries in world-atlas. */
const ISO: Record<string, string> = {
  de: "276",
  us: "840",
  cn: "156",
  jp: "392",
  in: "356",
  br: "076",
  gb: "826",
  fr: "250",
  ca: "124",
  mx: "484",
  kr: "410",
  au: "036",
  sg: "702",
  ch: "756",
  ae: "784",
  za: "710",
  ng: "566",
  pl: "616",
  vn: "704",
  se: "752",
  ie: "372",
  tr: "792",
};

type Ring = [number, number][];

/** Large lakes and inland seas the country shapes cover as land (rough outlines, lon/lat). */
const LAKES: Ring[] = [
  // Lake Superior
  [
    [-92.1, 46.7],
    [-89.5, 48.0],
    [-88.3, 48.8],
    [-86.0, 48.7],
    [-84.6, 47.6],
    [-84.6, 46.5],
    [-86.5, 46.4],
    [-88.5, 47.2],
    [-90.5, 46.6],
  ],
  // Lake Michigan
  [
    [-87.9, 41.7],
    [-86.6, 41.8],
    [-86.2, 43.5],
    [-86.3, 45.0],
    [-85.0, 45.9],
    [-86.6, 45.9],
    [-87.6, 44.8],
    [-87.8, 43.0],
  ],
  // Lake Huron and Georgian Bay
  [
    [-84.6, 45.9],
    [-83.5, 46.1],
    [-81.6, 46.1],
    [-80.1, 45.8],
    [-79.7, 44.6],
    [-81.3, 44.9],
    [-81.7, 43.3],
    [-82.5, 43.0],
    [-83.5, 43.9],
    [-83.3, 45.0],
  ],
  // Lake Erie
  [
    [-83.4, 41.7],
    [-81.6, 41.5],
    [-79.0, 42.6],
    [-79.2, 42.9],
    [-81.5, 42.6],
    [-83.1, 42.1],
  ],
  // Lake Ontario
  [
    [-79.8, 43.2],
    [-77.0, 43.3],
    [-76.2, 43.9],
    [-77.5, 44.1],
    [-79.4, 43.7],
  ],
  // Lake Winnipeg
  [
    [-97.2, 50.4],
    [-96.2, 50.8],
    [-97.6, 53.8],
    [-98.8, 53.6],
    [-98.0, 52.0],
  ],
  // Great Slave Lake
  [
    [-117.0, 61.0],
    [-113.5, 61.2],
    [-109.5, 62.5],
    [-111.5, 62.9],
    [-115.0, 62.2],
  ],
  // Great Bear Lake
  [
    [-125.0, 65.0],
    [-121.0, 64.8],
    [-118.0, 65.5],
    [-120.0, 67.0],
    [-124.0, 66.6],
  ],
  // Lake Victoria
  [
    [31.6, -1.0],
    [32.0, 0.3],
    [33.9, 0.3],
    [34.6, -0.4],
    [34.0, -2.3],
    [32.8, -2.8],
    [31.7, -2.2],
  ],
  // Lake Tanganyika
  [
    [29.1, -3.3],
    [29.5, -3.3],
    [30.0, -5.5],
    [31.1, -7.0],
    [31.2, -8.6],
    [30.6, -8.8],
    [29.6, -7.0],
    [29.2, -5.0],
  ],
  // Lake Malawi
  [
    [34.0, -9.4],
    [34.7, -9.6],
    [35.0, -12.0],
    [35.3, -14.3],
    [34.6, -14.3],
    [34.4, -12.0],
  ],
  // Lake Baikal
  [
    [103.7, 51.6],
    [104.6, 51.5],
    [106.5, 52.6],
    [108.3, 53.7],
    [109.9, 55.8],
    [109.2, 55.9],
    [107.0, 53.6],
    [105.0, 52.4],
  ],
  // Lake Balkhash
  [
    [73.5, 46.0],
    [74.5, 46.9],
    [76.5, 46.5],
    [79.2, 46.9],
    [79.0, 46.3],
    [76.5, 45.9],
    [74.5, 45.9],
  ],
  // Lake Ladoga and Onega
  [
    [30.0, 60.0],
    [32.8, 60.6],
    [32.5, 61.5],
    [30.5, 61.3],
  ],
  [
    [34.8, 61.0],
    [36.4, 61.3],
    [35.5, 62.8],
    [34.6, 62.3],
  ],
  // Lake Titicaca
  [
    [-70.0, -15.2],
    [-69.2, -15.4],
    [-68.6, -16.3],
    [-69.3, -16.2],
    [-70.0, -15.8],
  ],
  // Lake Chad
  [
    [13.6, 13.0],
    [14.6, 13.7],
    [14.8, 12.8],
    [14.0, 12.4],
  ],
  // Lake Vänern and Vättern
  [
    [12.4, 58.4],
    [14.0, 58.7],
    [13.8, 59.3],
    [12.6, 59.2],
  ],
];

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: {
    countries: {
      geometries: { type: string; id?: string; arcs: number[][] | number[][][] }[];
    };
  };
}

function decodeArcs(topo: Topology): Ring[] {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty] as [number, number];
    });
  });
}

function ringOf(arcs: Ring[], refs: number[]): Ring {
  const out: Ring = [];
  for (const ref of refs) {
    const arc = ref >= 0 ? arcs[ref]! : [...arcs[~ref]!].reverse();
    out.push(...(out.length ? arc.slice(1) : arc));
  }
  return out;
}

/** Makes the longitudes of a ring continuous across the date line (no jump of 360°). */
function unwrap(ring: Ring): Ring {
  const out: Ring = [];
  let offset = 0;
  ring.forEach(([lon, lat], i) => {
    if (i > 0) {
      const prev = ring[i - 1]![0];
      if (lon - prev > 180) offset -= 360;
      else if (prev - lon > 180) offset += 360;
    }
    out.push([lon + offset, lat]);
  });
  return out;
}

/** Fills the sub-samples inside the rings (even-odd over all rings: holes stay empty) with the value. */
function fill(target: Uint16Array, rings: Ring[], value: number) {
  const W = COLS * SUB;
  const H = ROWS * SUB;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const r of rings)
    for (const [, lat] of r) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  const s0 = Math.max(0, Math.floor(((LAT_TOP - maxLat) / LAT_SPAN) * H - 0.5));
  const s1 = Math.min(H - 1, Math.ceil(((LAT_TOP - minLat) / LAT_SPAN) * H + 0.5));
  for (let s = s0; s <= s1; s++) {
    const lat = LAT_TOP - ((s + 0.5) / H) * LAT_SPAN;
    const xs: number[] = [];
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [x1, y1] = r[i]!;
        const [x2, y2] = r[j]!;
        if (y1 > lat !== y2 > lat) xs.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.ceil(((xs[k]! + 180) / 360) * W - 0.5);
      const b = Math.floor(((xs[k + 1]! + 180) / 360) * W - 0.5);
      for (let i = Math.max(0, a); i <= Math.min(W - 1, b); i++) target[s * W + i] = value;
    }
  }
}

function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: pnpm worldmap <countries-50m.json>");
  const topo = JSON.parse(readFileSync(file, "utf8")) as Topology;
  const arcs = decodeArcs(topo);
  const W = COLS * SUB;
  const sub = new Uint16Array(W * ROWS * SUB);
  const keys = COUNTRIES.map((c) => c.key);
  const gameOf = new Map<number, number>();
  topo.objects.countries.geometries.forEach((g, n) => {
    const id = n + 1;
    const polys = (g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : []) as number[][][];
    for (const poly of polys) {
      const rings = poly.map((refs) => unwrap(ringOf(arcs, refs)));
      const lons = rings.flat().map(([lon]) => lon);
      // shapes across the date line are drawn on both sides
      for (const shift of [-360, 0, 360])
        if (Math.max(...lons) + shift > -180 && Math.min(...lons) + shift < 180)
          fill(
            sub,
            rings.map((r) => r.map(([lon, lat]) => [lon + shift, lat] as [number, number])),
            id,
          );
    }
    const key = Object.entries(ISO).find(([, iso]) => iso === g.id)?.[0];
    if (key) gameOf.set(id, keys.indexOf(key));
  });
  const lake = new Uint16Array(W * ROWS * SUB);
  for (const r of LAKES) fill(lake, [r], 1);

  // cells: 0 sea, -1 lake, else the country id
  const cell = new Int32Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) {
      const count = new Map<number, number>();
      let land = 0;
      let water = 0;
      for (let dy = 0; dy < SUB; dy++)
        for (let dx = 0; dx < SUB; dx++) {
          const i = (row * SUB + dy) * W + col * SUB + dx;
          const v = sub[i]!;
          if (lake[i]) water++;
          if (!v) continue;
          land++;
          count.set(v, (count.get(v) ?? 0) + 1);
        }
      let best = 0;
      let most = 0;
      for (const [v, n] of count)
        if (n > most) {
          best = v;
          most = n;
        }
      cell[row * COLS + col] = water >= 7 ? -1 : land >= 5 ? best : 0;
    }

  // every game country owns the cell of its marker
  COUNTRIES.forEach((c, k) => {
    const col = Math.min(COLS - 1, Math.floor((c.map.x / 100) * COLS));
    const row = Math.min(ROWS - 1, Math.floor((c.map.y / 100) * ROWS));
    const id = [...gameOf].find(([, i]) => i === k)?.[0];
    if (id === undefined) throw new Error(`country ${c.key} not in the data`);
    cell[row * COLS + col] = id;
  });

  const codeOf = (row: number, col: number) => {
    const v = cell[row * COLS + col]!;
    if (v === 0) return ".";
    if (v < 0) return "o";
    const right = col + 1 < COLS ? cell[row * COLS + col + 1]! : v;
    const down = row + 1 < ROWS ? cell[(row + 1) * COLS + col]! : v;
    const border = (right > 0 && right !== v) || (down > 0 && down !== v);
    const game = gameOf.get(v);
    if (game === undefined) return border ? "+" : "#";
    return String.fromCharCode((border ? 97 : 65) + game);
  };

  const rows: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    let out = "";
    let col = 0;
    while (col < COLS) {
      const ch = codeOf(row, col);
      let end = col + 1;
      while (end < COLS && codeOf(row, end) === ch) end++;
      out += (end - col > 1 ? String(end - col) : "") + ch;
      col = end;
    }
    rows.push(out);
  }

  const src = `/*
 * Generated by scripts/gen-world-map.ts from Natural Earth (public domain, world-atlas@2.0.2 countries-50m.json).
 * Do not edit. One run-length encoded row per string ("12." = twelve sea cells). Codes: "." sea, "o" lake,
 * "#" land, "+" land on a border, "A".."V" land of WORLD_KEYS[i], "a".."v" its border cells.
 */
export const WORLD_COLS = ${COLS};
export const WORLD_ROWS = ${ROWS};
export const WORLD_KEYS: readonly string[] = ${JSON.stringify(keys)};
export const WORLD_RLE: readonly string[] = [
${rows.map((r) => `  ${JSON.stringify(r)},`).join("\n")}
];
`;
  writeFileSync(new URL("../src/features/company/world/world-raster.generated.ts", import.meta.url), src);
  console.log(`world map: ${COLS}×${ROWS}, ${src.length} bytes`);
}

main();
