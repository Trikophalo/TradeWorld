/**
 * Generates the gallery: the artworks of the game (ADR-080, docs/ARTWORKS.md).
 * Deterministic (fixed seed), so data and database always match. Writes
 *   src/config/gallery.ts             (demo and UI)
 *   supabase/seeds/artworks.sql       (database seed, idempotent)
 * Run with `pnpm artworks` after changing this file.
 */
import { writeFileSync } from "node:fs";

const SIZE = 32;
const IDX = "0123456789abcdef";
type Rarity = "common" | "rare" | "legendary";
interface Art {
  key: string;
  title: string;
  rarity: Rarity;
  palette: string[];
  grid: string[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Canvas {
  px: number[][] = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
  set(x: number, y: number, c: number) {
    if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) this.px[y]![x] = c;
  }
  rect(x0: number, y0: number, w: number, h: number, c: number) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
  }
  circle(cx: number, cy: number, r: number, c: number) {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c);
  }
  rows(): string[] {
    return this.px.map((r) => r.map((c) => IDX[c]!).join(""));
  }
}

const PALETTES = {
  sunset: [
    "#1b1440",
    "#3b1f63",
    "#7a2f7a",
    "#c8486b",
    "#f2865e",
    "#ffc46b",
    "#ffe9a3",
    "#241a3a",
    "#3a2a52",
    "#0f2a4a",
    "#1f4f7a",
  ],
  dawn: [
    "#2a3a6b",
    "#4a5f9a",
    "#8fa3d1",
    "#f2b8a0",
    "#ffd9b0",
    "#fff1d6",
    "#ffe06b",
    "#2d3b4f",
    "#4b5d70",
    "#1e5a6e",
    "#3f8c9e",
  ],
  night: ["#0b0e1f", "#15193a", "#232a57", "#ffe9a3", "#fff6d8", "#2b2f45", "#3c425e", "#ffcf4d", "#9ad8ff", "#5d6679"],
  space: ["#06070f", "#121630", "#2a1f4f", "#5b2d7a", "#ffffff", "#9ad8ff", "#ff9a52", "#ffd15c", "#c8553d", "#62e0ff"],
  forest: ["#bfe6ff", "#8fd0f0", "#2f7a4a", "#2fb45a", "#1d5a36", "#7bd47a", "#6e4a28", "#ffd15c", "#e6f7ff"],
  ocean: ["#d8f3ff", "#9ad8ff", "#4f8cff", "#2f5fd0", "#1d3a8a", "#ffffff", "#ffd15c", "#0f2050"],
  desert: ["#ffd9a0", "#ffbf7a", "#f29a4a", "#d97a2f", "#a8592a", "#7a3f1f", "#fff1c4", "#5a2f1a"],
  aurora: ["#050a14", "#0c1a2a", "#2fd98c", "#62e0ff", "#9a6bff", "#ffffff", "#17303d", "#1f4a3a"],
  gold: ["#1a1206", "#3a2a0c", "#7a5a1a", "#c8962f", "#ffd15c", "#fff1a8", "#ffffff", "#a8792a"],
  mondrian: ["#f3efe4", "#111318", "#d93a2f", "#2f5fd0", "#ffd15c"],
} satisfies Record<string, string[]>;

function sunset(r: () => number): Canvas {
  const c = new Canvas();
  const bands = [0, 1, 2, 3, 4, 5];
  for (let y = 0; y < 20; y++) c.rect(0, y, SIZE, 1, bands[Math.min(5, Math.floor((y / 20) * 6))]!);
  // dithered band edges
  for (let y = 1; y < 20; y++)
    for (let x = (y % 2) + Math.floor(r() * 2); x < SIZE; x += 4)
      if (r() < 0.3) c.set(x, y, Math.min(5, bands[Math.floor((y / 20) * 6)]! + 1));
  c.circle(8 + Math.floor(r() * 16), 15, 4 + Math.floor(r() * 2), 6);
  let h = 14;
  for (let x = 0; x < SIZE; x++) {
    h += Math.round((r() - 0.5) * 3);
    h = Math.max(10, Math.min(18, h));
    c.rect(x, h, 1, 22 - h, 8);
  }
  let h2 = 18;
  for (let x = 0; x < SIZE; x++) {
    h2 += Math.round((r() - 0.5) * 2);
    h2 = Math.max(16, Math.min(21, h2));
    c.rect(x, h2, 1, 22 - h2, 7);
  }
  c.rect(0, 22, SIZE, 10, 9);
  for (let y = 22; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (r() < 0.12) c.set(x, y, 10);
  return c;
}

function city(r: () => number): Canvas {
  const c = new Canvas();
  for (let y = 0; y < SIZE; y++) c.rect(0, y, SIZE, 1, y < 10 ? 0 : y < 20 ? 1 : 2);
  for (let i = 0; i < 30; i++) c.set(Math.floor(r() * SIZE), Math.floor(r() * 16), r() < 0.7 ? 8 : 4);
  c.circle(25, 6, 3, 4);
  let x = 0;
  while (x < SIZE) {
    const w = 3 + Math.floor(r() * 5);
    const h = 8 + Math.floor(r() * 16);
    const col = r() < 0.5 ? 5 : 6;
    c.rect(x, SIZE - h, w, h, col);
    for (let wy = SIZE - h + 2; wy < SIZE - 1; wy += 2)
      for (let wx = x + 1; wx < x + w - 1; wx += 2) if (r() < 0.55) c.set(wx, wy, r() < 0.8 ? 3 : 7);
    x += w + (r() < 0.3 ? 1 : 0);
  }
  return c;
}

function space(r: () => number): Canvas {
  const c = new Canvas();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) c.set(x, y, r() < 0.04 ? 1 : 0);
  for (let i = 0; i < 18; i++) {
    const cx = Math.floor(r() * SIZE);
    const cy = Math.floor(r() * SIZE);
    for (let k = 0; k < 14; k++)
      c.set(cx + Math.floor((r() - 0.5) * 8), cy + Math.floor((r() - 0.5) * 5), r() < 0.5 ? 2 : 3);
  }
  for (let i = 0; i < 40; i++) c.set(Math.floor(r() * SIZE), Math.floor(r() * SIZE), r() < 0.7 ? 4 : 5);
  const px = 10 + Math.floor(r() * 12);
  const py = 10 + Math.floor(r() * 12);
  const pr = 5 + Math.floor(r() * 3);
  const body = r() < 0.5 ? 6 : 8;
  c.circle(px, py, pr, body);
  for (let y = -pr; y <= pr; y += 2)
    for (let x = -pr; x <= pr; x++) if (x * x + y * y <= pr * pr && r() < 0.5) c.set(px + x, py + y, 7);
  for (let x = -pr - 4; x <= pr + 4; x++) {
    const y = Math.round(x * 0.35);
    if (Math.abs(x) > pr - 1 || y > 0) c.set(px + x, py + y, 9);
  }
  return c;
}

function forest(r: () => number): Canvas {
  const c = new Canvas();
  for (let y = 0; y < SIZE; y++) c.rect(0, y, SIZE, 1, y < 8 ? 0 : 1);
  c.circle(6, 5, 3, 7);
  for (let i = 0; i < 3; i++) c.rect(4 + Math.floor(r() * 20), 2 + i * 3, 5, 1, 8);
  let h = 16;
  for (let x = 0; x < SIZE; x++) {
    h += Math.round((r() - 0.5) * 2);
    h = Math.max(13, Math.min(19, h));
    c.rect(x, h, 1, SIZE - h, 3);
  }
  for (let y = 22; y < SIZE; y++) c.rect(0, y, SIZE, 1, y % 3 === 0 ? 5 : 4);
  for (let i = 0; i < 7; i++) {
    const tx = 2 + Math.floor(r() * 28);
    const ty = 20 + Math.floor(r() * 6);
    c.rect(tx, ty, 1, 4, 6);
    for (let k = 0; k < 5; k++) c.rect(tx - (4 - k) / 2, ty - k - 1, 5 - k, 1, 2);
  }
  return c;
}

function ocean(r: () => number): Canvas {
  const c = new Canvas();
  for (let y = 0; y < 12; y++) c.rect(0, y, SIZE, 1, y < 6 ? 0 : 1);
  c.circle(24, 6, 3, 6);
  const phase = r() * 6;
  for (let y = 12; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const wave = Math.sin(x / 3 + y * 0.6 + phase);
      c.set(x, y, y < 18 ? (wave > 0.6 ? 5 : 2) : y < 25 ? (wave > 0.7 ? 2 : 3) : wave > 0.8 ? 3 : 4);
    }
  }
  const bx = 6 + Math.floor(r() * 18);
  c.rect(bx, 14, 6, 2, 7);
  c.rect(bx + 2, 9, 1, 5, 7);
  for (let k = 0; k < 4; k++) c.rect(bx + 3, 9 + k, 3 - k, 1, 5);
  return c;
}

function desert(r: () => number): Canvas {
  const c = new Canvas();
  for (let y = 0; y < 18; y++) c.rect(0, y, SIZE, 1, y < 6 ? 6 : y < 12 ? 0 : 1);
  c.circle(22, 7, 4, 6);
  const pyr = (cx: number, base: number, h: number) => {
    for (let k = 0; k < h; k++) {
      c.rect(cx - k, base - h + k, k + 1, 1, 3);
      c.rect(cx + 1, base - h + k, k, 1, 4);
    }
  };
  pyr(9, 22, 9);
  pyr(20 + Math.floor(r() * 4), 22, 6);
  for (let y = 22; y < SIZE; y++) for (let x = 0; x < SIZE; x++) c.set(x, y, Math.sin(x / 4 + y) > 0.5 ? 2 : 1);
  return c;
}

function aurora(r: () => number): Canvas {
  const c = new Canvas();
  for (let y = 0; y < SIZE; y++) c.rect(0, y, SIZE, 1, y < 16 ? 0 : 1);
  for (let i = 0; i < 30; i++) c.set(Math.floor(r() * SIZE), Math.floor(r() * 20), 5);
  for (let band = 0; band < 3; band++) {
    const base = 6 + band * 4;
    const col = 2 + band;
    for (let x = 0; x < SIZE; x++) {
      const y = base + Math.round(Math.sin(x / 4 + band + r() * 0.3) * 2);
      for (let k = 0; k < 3; k++) if (r() < 0.8 - k * 0.2) c.set(x, y + k, col);
    }
  }
  let h = 24;
  for (let x = 0; x < SIZE; x++) {
    h += Math.round((r() - 0.5) * 2);
    h = Math.max(21, Math.min(27, h));
    c.rect(x, h, 1, SIZE - h, 6);
  }
  for (let y = 28; y < SIZE; y++) c.rect(0, y, SIZE, 1, 7);
  return c;
}

function mondrian(r: () => number): Canvas {
  const c = new Canvas();
  const xs = [0, 7 + Math.floor(r() * 6), 18 + Math.floor(r() * 6), SIZE];
  const ys = [0, 9 + Math.floor(r() * 5), 20 + Math.floor(r() * 5), SIZE];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const roll = r();
      const col = roll < 0.18 ? 2 : roll < 0.32 ? 3 : roll < 0.44 ? 4 : 0;
      c.rect(xs[i]!, ys[j]!, xs[i + 1]! - xs[i]!, ys[j + 1]! - ys[j]!, col);
    }
  }
  for (const x of xs.slice(1, -1)) c.rect(x, 0, 2, SIZE, 1);
  for (const y of ys.slice(1, -1)) c.rect(0, y, SIZE, 2, 1);
  return c;
}

function goldenSeal(r: () => number): Canvas {
  const c = new Canvas();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) c.set(x, y, (x + y) % 7 === 0 ? 1 : 0);
  c.circle(16, 16, 13, 2);
  c.circle(16, 16, 12, 3);
  c.circle(16, 16, 10, 4);
  c.circle(16, 16, 8, 3);
  // the N of NEXA
  for (let y = 10; y < 23; y++) {
    c.set(11, y, 6);
    c.set(12, y, 6);
    c.set(20, y, 6);
    c.set(21, y, 6);
    const d = Math.round(11 + ((y - 10) / 12) * 9);
    c.set(d, y, 6);
    c.set(d + 1, y, 6);
  }
  for (let i = 0; i < 20; i++) c.set(Math.floor(r() * SIZE), Math.floor(r() * SIZE), 5);
  return c;
}

const TITLES: Record<string, string[]> = {
  sunset: [
    "Abendrot über der Börse",
    "Letzte Handelsstunde",
    "Violetter Horizont",
    "Sonnenuntergang am Hafen",
    "Glut über den Hügeln",
  ],
  dawn: ["Morgen an der Bucht", "Erste Glocke", "Frühnebel"],
  city: ["Nexa-City bei Nacht", "Lichter der Bankentürme", "Nachtschicht", "Skyline im Mondlicht", "Schlaflose Stadt"],
  space: ["Ferner Ringplanet", "Nebel im Orion", "Rote Welt", "Zwischen den Sternen", "Orbit 7"],
  forest: ["Tannen am Morgen", "Stiller Wald", "Grüne Hügel"],
  ocean: ["Segel im Wind", "Brandung", "Blaue Weite"],
  desert: ["Pyramiden im Abendlicht", "Wüstenwind"],
  aurora: ["Polarlicht", "Grüner Schleier", "Nordische Nacht"],
  mondrian: ["Komposition in Rot", "Raster Nr. 4", "Gelb und Blau", "Ordnung"],
};

const arts: Art[] = [];
let serial = 0;
const add = (kind: string, title: string, rarity: Rarity, palette: string[], canvas: Canvas) => {
  serial += 1;
  arts.push({ key: `gallery_${String(serial).padStart(2, "0")}_${kind}`, title, rarity, palette, grid: canvas.rows() });
};

const plan: [string, () => number, string, keyof typeof PALETTES, (r: () => number) => Canvas][] = [];
let seed = 20261112;
for (const [kind, titles] of Object.entries(TITLES)) {
  titles.forEach((title) => {
    seed += 7919;
    const r = rng(seed);
    const palette =
      kind === "sunset"
        ? "sunset"
        : kind === "dawn"
          ? "dawn"
          : kind === "city"
            ? "night"
            : (kind as keyof typeof PALETTES);
    const make =
      kind === "sunset" || kind === "dawn"
        ? sunset
        : kind === "city"
          ? city
          : kind === "space"
            ? space
            : kind === "forest"
              ? forest
              : kind === "ocean"
                ? ocean
                : kind === "desert"
                  ? desert
                  : kind === "aurora"
                    ? aurora
                    : mondrian;
    plan.push([kind, r, title, palette, make]);
  });
}
plan.forEach(([kind, r, title, palette, make], i) => {
  const rarity: Rarity = i % 4 === 1 ? "rare" : "common";
  add(kind, title, rarity, PALETTES[palette], make(r));
});
// The legendary pieces.
add("seal", "Die Goldene Nexa", "legendary", PALETTES.gold, goldenSeal(rng(1)));
add("aurora", "Das Licht der Gründer", "legendary", PALETTES.aurora, aurora(rng(77)));
add("city", "Die erste Glocke", "legendary", PALETTES.night, city(rng(1234)));

for (const a of arts) {
  if (a.palette.length > 16) throw new Error(`${a.key}: too many colours`);
  for (const row of a.grid) if (row.length !== SIZE || /[^0-9a-f.]/.test(row)) throw new Error(`${a.key}: bad row`);
  const used = new Set(a.grid.join(""));
  for (const ch of used) if (IDX.indexOf(ch) >= a.palette.length) throw new Error(`${a.key}: colour ${ch} missing`);
}

const ts = `/**
 * The gallery: artworks of the game (ADR-080). GENERATED by scripts/gen-artworks.ts, do not edit by hand.
 * Keys are stored in the database and must never change.
 */
export interface GalleryArtwork {
  readonly key: string;
  readonly title: string;
  readonly rarity: "common" | "rare" | "legendary";
  readonly palette: readonly string[];
  readonly grid: readonly string[];
}

export const GALLERY_ARTWORKS: readonly GalleryArtwork[] = ${JSON.stringify(arts, null, 2)};
`;
writeFileSync("src/config/gallery.ts", ts);

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sql = `-- GENERATED by scripts/gen-artworks.ts. Do not edit by hand.
-- The gallery: artworks of the game (ADR-080). Idempotent: existing keys are kept.
insert into public.artworks (gallery_key, title, origin, rarity, pixels)
values
${arts
  .map(
    (a) =>
      `  (${q(a.key)}, ${q(a.title)}, 'game', ${q(a.rarity)}, ${q(JSON.stringify({ palette: a.palette, grid: a.grid }))}::jsonb)`,
  )
  .join(",\n")}
on conflict (gallery_key) do nothing;
`;
writeFileSync("supabase/seeds/artworks.sql", sql);
console.log(
  `${arts.length} artworks: ${arts.filter((a) => a.rarity === "legendary").length} legendary, ${arts.filter((a) => a.rarity === "rare").length} rare`,
);
