/**
 * Generates the home catalogue (ADR-082, docs/PROPERTY.md): furniture seen from above, floor tiles and cars seen
 * from the side, as pixel art. Deterministic. Writes
 *   src/config/furniture.ts          (catalogue with sprites, for demo and UI)
 *   supabase/seeds/furniture.sql     (catalogue without sprites, for the server)
 * Run with `pnpm furniture` after changing this file.
 */
import { writeFileSync } from "node:fs";

const T = 16; // art pixels per floor tile
const IDX = "0123456789abcdef";
type Tier = "budget" | "standard" | "premium" | "luxury" | "ultra";
type Category = "seating" | "tables" | "beds" | "kitchen" | "bath" | "plants" | "decor" | "tech" | "rugs" | "fun";

class Sprite {
  px: string[][];
  pal: string[] = [];
  constructor(
    public w: number,
    public h: number,
  ) {
    this.px = Array.from({ length: h }, () => Array<string>(w).fill("."));
  }
  c(color: string): string {
    let i = this.pal.indexOf(color);
    if (i < 0) {
      this.pal.push(color);
      i = this.pal.length - 1;
    }
    if (i >= 16) throw new Error("too many colours");
    return IDX[i]!;
  }
  set(x: number, y: number, color: string) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[Math.floor(y)]![Math.floor(x)] = this.c(color);
  }
  rect(x0: number, y0: number, w: number, h: number, color: string) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, color);
  }
  frame(x0: number, y0: number, w: number, h: number, color: string) {
    for (let x = x0; x < x0 + w; x++) {
      this.set(x, y0, color);
      this.set(x, y0 + h - 1, color);
    }
    for (let y = y0; y < y0 + h; y++) {
      this.set(x0, y, color);
      this.set(x0 + w - 1, y, color);
    }
  }
  circle(cx: number, cy: number, r: number, color: string) {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.5) this.set(cx + x, cy + y, color);
  }
  out() {
    return { palette: this.pal, grid: this.px.map((r) => r.join("")) };
  }
}

const K = "#2b2f3a"; // outline
const M = {
  wood: ["#c89a63", "#9a6b3c", "#6e4a28"],
  pine: ["#e6c48f", "#c89a63", "#9a6b3c"],
  plastic: ["#f3efe4", "#d9d4c7", "#8f9bb3"],
  black: ["#5d6679", "#3a3f4b", "#24272f"],
  leather: ["#b06a3a", "#8a4f2a", "#6b3a1e"],
  velvet: ["#a24aa2", "#7a2f7a", "#5a1f5a"],
  emerald: ["#4fae6e", "#2f7a4a", "#1d5a36"],
  fabric: ["#b3bccd", "#8f9bb3", "#6f7a91"],
  marble: ["#fbfbf8", "#e3e3dc", "#b8b8b0"],
  glass: ["#e6f7ff", "#bfe6ff", "#7fc4e8"],
  gold: ["#fff1a8", "#ffd15c", "#c8962f"],
  white: ["#ffffff", "#e9edf2", "#c5ccd6"],
  red: ["#ff8a8a", "#d93a2f", "#9a2420"],
  blue: ["#9ad8ff", "#4f8cff", "#2f5fd0"],
} as const;
type Mat = keyof typeof M;

interface Item {
  key: string;
  name: string;
  category: Category;
  tier: Tier;
  priceCents: number;
  w: number;
  h: number;
  layer: "floor" | "object";
  sprite: { palette: string[]; grid: string[] };
}
const items: Item[] = [];
const add = (
  key: string,
  name: string,
  category: Category,
  tier: Tier,
  euros: number,
  w: number,
  h: number,
  draw: (s: Sprite) => void,
  layer: "floor" | "object" = "object",
) => {
  const s = new Sprite(w * T, h * T);
  draw(s);
  items.push({ key, name, category, tier, priceCents: euros * 100, w, h, layer, sprite: s.out() });
};

// ---------------------------------------------------------------- drawing helpers (top-down)
function chair(s: Sprite, m: Mat) {
  const [l, c, d] = M[m];
  s.rect(3, 2, 10, 3, d);
  s.rect(3, 5, 10, 8, c);
  s.rect(4, 6, 8, 2, l);
  s.frame(3, 2, 10, 11, K);
}
function armchair(s: Sprite, m: Mat) {
  const [l, c, d] = M[m];
  s.rect(1, 1, 14, 4, d);
  s.rect(1, 5, 3, 9, d);
  s.rect(12, 5, 3, 9, d);
  s.rect(4, 5, 8, 9, c);
  s.rect(5, 6, 6, 3, l);
  s.frame(1, 1, 14, 13, K);
}
function sofa(s: Sprite, m: Mat) {
  const [l, c, d] = M[m];
  s.rect(1, 1, s.w - 2, 4, d);
  s.rect(1, 5, 3, 9, d);
  s.rect(s.w - 4, 5, 3, 9, d);
  s.rect(4, 5, s.w - 8, 9, c);
  for (let x = 4; x < s.w - 4; x += T) {
    s.rect(x + 1, 6, T - 3, 3, l);
    s.rect(x + T - 1, 5, 1, 9, d);
  }
  s.frame(1, 1, s.w - 2, 13, K);
}
function table(s: Sprite, m: Mat, round = false) {
  const [l, c, d] = M[m];
  if (round) {
    const r = Math.floor(Math.min(s.w, s.h) / 2) - 2;
    s.circle(s.w / 2, s.h / 2, r, K);
    s.circle(s.w / 2, s.h / 2, r - 1, c);
    s.circle(s.w / 2 - 2, s.h / 2 - 2, Math.max(1, r - 5), l);
    return;
  }
  s.rect(2, 2, s.w - 4, s.h - 4, c);
  s.rect(3, 3, s.w - 6, 2, l);
  s.frame(2, 2, s.w - 4, s.h - 4, K);
  if (m === "marble") for (let i = 0; i < s.w; i += 5) s.set(3 + i, 4 + ((i * 7) % (s.h - 8)), d);
  if (m === "glass") for (let i = 0; i < 6; i++) s.set(5 + i, s.h - 6 - i, "#ffffff");
}
function bed(s: Sprite, blanket: Mat, frameMat: Mat) {
  const [bl, bc, bd] = M[blanket];
  const [, fc] = M[frameMat];
  s.rect(1, 1, s.w - 2, s.h - 2, fc);
  s.rect(1, 1, s.w - 2, 4, M[frameMat][2]);
  const pillows = s.w > 2 * T ? 2 : 1;
  const pw = (s.w - 6 - (pillows - 1) * 2) / pillows;
  for (let i = 0; i < pillows; i++) s.rect(3 + i * (pw + 2), 6, pw, 5, "#ffffff");
  s.rect(2, 13, s.w - 4, s.h - 15, bc);
  s.rect(2, 13, s.w - 4, 3, bl);
  s.rect(2, s.h - 4, s.w - 4, 1, bd);
  s.frame(1, 1, s.w - 2, s.h - 2, K);
}
function rug(s: Sprite, a: string, b: string, pattern: "plain" | "stripes" | "persian" | "fur" | "checker") {
  for (let y = 1; y < s.h - 1; y++)
    for (let x = 1; x < s.w - 1; x++) {
      let col = a;
      if (pattern === "stripes" && Math.floor(y / 3) % 2 === 0) col = b;
      if (pattern === "checker" && (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0) col = b;
      if (
        pattern === "persian" &&
        (x < 3 || y < 3 || x > s.w - 4 || y > s.h - 4 || (x + y) % 9 === 0 || Math.abs(x - y) % 9 === 0)
      )
        col = b;
      if (pattern === "fur" && (x * 7 + y * 13) % 5 === 0) col = b;
      s.set(x, y, col);
    }
}
function plant(s: Sprite, kind: "small" | "monstera" | "palm" | "bonsai" | "olive", potMat: Mat) {
  const cx = s.w / 2;
  const cy = s.h / 2;
  s.circle(cx, cy, Math.floor(s.w / 2) - 4, M[potMat][1]);
  const g = ["#4fae6e", "#2f7a4a", "#7bd47a"];
  if (kind === "palm") {
    for (let a = 0; a < 8; a++) {
      const dx = Math.cos((a * Math.PI) / 4);
      const dy = Math.sin((a * Math.PI) / 4);
      for (let r = 1; r < s.w / 2 - 1; r++) s.set(cx + dx * r, cy + dy * r, g[r % 2]!);
    }
  } else {
    const r = kind === "small" ? 3 : kind === "bonsai" ? 4 : Math.floor(s.w / 2) - 2;
    s.circle(cx, cy, r, g[1]!);
    for (let i = 0; i < r * 3; i++) s.set(cx + ((i * 5) % (2 * r)) - r, cy + ((i * 3) % (2 * r)) - r, g[i % 3]!);
    if (kind === "olive") for (let i = 0; i < 6; i++) s.set(cx - 4 + i * 2, cy - 2 + (i % 3) * 2, "#5a6b2f");
  }
}

// ---------------------------------------------------------------- the catalogue
// seating
add("chair_plastic", "Plastikstuhl", "seating", "budget", 25, 1, 1, (s) => chair(s, "plastic"));
add("chair_wood", "Holzstuhl", "seating", "budget", 80, 1, 1, (s) => chair(s, "pine"));
add("chair_leather", "Lederstuhl", "seating", "standard", 450, 1, 1, (s) => chair(s, "leather"));
add("chair_designer", "Designerstuhl", "seating", "premium", 3_500, 1, 1, (s) => chair(s, "black"));
add("armchair_fabric", "Sessel", "seating", "standard", 600, 1, 1, (s) => armchair(s, "fabric"));
add("armchair_velvet", "Samtsessel", "seating", "premium", 4_800, 1, 1, (s) => armchair(s, "velvet"));
add("throne_gold", "Goldener Thron", "seating", "ultra", 750_000, 1, 1, (s) => armchair(s, "gold"));
add("sofa_basic", "Schlafcouch", "seating", "budget", 350, 2, 1, (s) => sofa(s, "fabric"));
add("sofa_leather", "Ledersofa", "seating", "standard", 2_400, 3, 1, (s) => sofa(s, "leather"));
add("sofa_velvet", "Samtsofa", "seating", "premium", 12_000, 3, 1, (s) => sofa(s, "emerald"));
add("sofa_designer", "Designer-Lounge", "seating", "luxury", 85_000, 4, 1, (s) => sofa(s, "white"));
// tables
add("table_folding", "Klapptisch", "tables", "budget", 40, 1, 1, (s) => table(s, "plastic"));
add("table_pine", "Esstisch Kiefer", "tables", "budget", 220, 2, 1, (s) => table(s, "pine"));
add("table_oak", "Eichentisch", "tables", "standard", 1_400, 2, 2, (s) => table(s, "wood"));
add("table_round", "Runder Tisch", "tables", "standard", 900, 2, 2, (s) => table(s, "wood", true));
add("table_glass", "Glastisch", "tables", "premium", 6_500, 2, 1, (s) => table(s, "glass"));
add("table_marble", "Marmortisch", "tables", "luxury", 48_000, 3, 2, (s) => table(s, "marble"));
add("table_marble_round", "Runder Marmortisch", "tables", "luxury", 36_000, 2, 2, (s) => table(s, "marble", true));
add("table_gold", "Tafel aus Gold", "tables", "ultra", 1_200_000, 4, 2, (s) => table(s, "gold"));
add("desk_pc", "Schreibtisch mit PC", "tech", "standard", 1_800, 2, 1, (s) => {
  table(s, "wood");
  s.rect(10, 3, 12, 4, K);
  s.rect(11, 4, 10, 2, "#62e0ff");
  s.rect(9, 9, 14, 2, "#3a3f4b");
});
// beds
add("bed_mattress", "Matratze", "beds", "budget", 150, 2, 2, (s) => bed(s, "fabric", "plastic"));
add("bed_single", "Einzelbett", "beds", "budget", 320, 2, 3, (s) => bed(s, "blue", "pine"));
add("bed_double", "Doppelbett", "beds", "standard", 1_500, 3, 3, (s) => bed(s, "red", "wood"));
add("bed_boxspring", "Boxspringbett", "beds", "premium", 9_000, 3, 3, (s) => bed(s, "fabric", "black"));
add("bed_kingsize", "Kingsize-Bett", "beds", "luxury", 55_000, 4, 3, (s) => bed(s, "velvet", "black"));
add("bed_royal", "Königsbett", "beds", "ultra", 900_000, 4, 3, (s) => bed(s, "red", "gold"));
// kitchen
const counter = (s: Sprite, m: Mat) => {
  s.rect(0, 0, s.w, s.h, M[m][1]);
  s.rect(1, 1, s.w - 2, s.h - 3, M[m][0]);
  s.rect(0, s.h - 2, s.w, 2, M[m][2]);
};
add("kitchen_counter", "Küchenzeile", "kitchen", "budget", 250, 1, 1, (s) => counter(s, "white"));
add("kitchen_stove", "Herd", "kitchen", "budget", 380, 1, 1, (s) => {
  counter(s, "black");
  for (const [x, y] of [
    [5, 4],
    [11, 4],
    [5, 10],
    [11, 10],
  ])
    s.circle(x!, y!, 2, "#d93a2f");
});
add("kitchen_fridge", "Kühlschrank", "kitchen", "standard", 700, 1, 1, (s) => {
  counter(s, "white");
  s.rect(12, 3, 1, 8, "#8f9bb3");
});
add("kitchen_sink", "Spüle", "kitchen", "standard", 420, 1, 1, (s) => {
  counter(s, "white");
  s.rect(3, 4, 10, 7, "#9ad8ff");
  s.frame(3, 4, 10, 7, "#8f9bb3");
  s.rect(7, 2, 2, 3, "#8f9bb3");
});
add("kitchen_espresso", "Siebträger-Maschine", "kitchen", "premium", 2_900, 1, 1, (s) => {
  counter(s, "marble");
  s.rect(4, 3, 8, 7, "#c5ccd6");
  s.rect(6, 5, 4, 3, K);
});
add("kitchen_island_marble", "Kochinsel aus Marmor", "kitchen", "luxury", 42_000, 3, 1, (s) => counter(s, "marble"));
add("kitchen_island_gold", "Goldene Kochinsel", "kitchen", "ultra", 600_000, 3, 1, (s) => counter(s, "gold"));
// bath
add("toilet", "Toilette", "bath", "budget", 180, 1, 1, (s) => {
  s.rect(4, 1, 8, 4, "#e9edf2");
  s.circle(8, 9, 5, "#ffffff");
  s.circle(8, 9, 3, "#9ad8ff");
});
add("toilet_gold", "Goldene Toilette", "bath", "ultra", 450_000, 1, 1, (s) => {
  s.rect(4, 1, 8, 4, "#c8962f");
  s.circle(8, 9, 5, "#ffd15c");
  s.circle(8, 9, 3, "#fff1a8");
});
add("shower", "Dusche", "bath", "standard", 1_100, 1, 1, (s) => {
  s.rect(0, 0, 16, 16, "#bfe6ff");
  for (let i = 0; i < 16; i += 4) {
    s.rect(i, 0, 1, 16, "#e6f7ff");
    s.rect(0, i, 16, 1, "#e6f7ff");
  }
  s.circle(8, 8, 1, "#8f9bb3");
});
add("bathtub", "Badewanne", "bath", "standard", 1_600, 2, 1, (s) => {
  s.rect(1, 1, 30, 14, "#ffffff");
  s.rect(3, 3, 26, 10, "#9ad8ff");
  s.frame(1, 1, 30, 14, K);
});
add("bath_marble", "Marmorwanne", "bath", "luxury", 38_000, 2, 1, (s) => {
  s.rect(1, 1, 30, 14, "#e3e3dc");
  s.rect(3, 3, 26, 10, "#62e0ff");
  s.frame(1, 1, 30, 14, "#b8b8b0");
});
add("jacuzzi", "Whirlpool", "bath", "luxury", 75_000, 2, 2, (s) => {
  s.circle(16, 16, 14, "#c5ccd6");
  s.circle(16, 16, 12, "#4f8cff");
  for (let i = 0; i < 12; i++) s.set(8 + ((i * 7) % 16), 8 + ((i * 5) % 16), "#e6f7ff");
});
// plants
add("plant_small", "Kleine Pflanze", "plants", "budget", 30, 1, 1, (s) => plant(s, "small", "leather"));
add("plant_monstera", "Monstera", "plants", "standard", 160, 1, 1, (s) => plant(s, "monstera", "white"));
add("plant_bonsai", "Bonsai", "plants", "premium", 2_200, 1, 1, (s) => plant(s, "bonsai", "black"));
add("plant_palm", "Palme", "plants", "premium", 1_400, 1, 1, (s) => plant(s, "palm", "pine"));
add("plant_olive", "Olivenbaum", "plants", "luxury", 22_000, 2, 2, (s) => plant(s, "olive", "marble"));
// rugs (under furniture)
add("rug_basic", "Läufer", "rugs", "budget", 60, 2, 1, (s) => rug(s, "#8f9bb3", "#6f7a91", "stripes"), "floor");
add("rug_checker", "Karoteppich", "rugs", "budget", 140, 2, 2, (s) => rug(s, "#f3efe4", "#3a3f4b", "checker"), "floor");
add("rug_wool", "Wollteppich", "rugs", "standard", 650, 3, 2, (s) => rug(s, "#c8553d", "#9a2420", "stripes"), "floor");
add("rug_fur", "Fellteppich", "rugs", "premium", 4_200, 3, 2, (s) => rug(s, "#ffffff", "#e9edf2", "fur"), "floor");
add(
  "rug_persian",
  "Perserteppich",
  "rugs",
  "luxury",
  32_000,
  4,
  3,
  (s) => rug(s, "#9a2420", "#ffd15c", "persian"),
  "floor",
);
add(
  "rug_royal",
  "Königlicher Teppich",
  "rugs",
  "ultra",
  380_000,
  5,
  3,
  (s) => rug(s, "#5a1f5a", "#ffd15c", "persian"),
  "floor",
);
// decor
add("lamp_floor", "Stehlampe", "decor", "budget", 70, 1, 1, (s) => {
  s.circle(8, 8, 6, "#ffe9a3");
  s.circle(8, 8, 3, "#fff6d8");
  s.frame(2, 2, 12, 12, "#c8962f");
});
add("bookshelf", "Bücherregal", "decor", "standard", 480, 2, 1, (s) => {
  s.rect(0, 0, 32, 16, "#6e4a28");
  const colors = ["#d93a2f", "#4f8cff", "#2fd98c", "#ffd15c", "#a24aa2", "#ff9a52"];
  for (let x = 2; x < 30; x += 2) s.rect(x, 2, 2, 10, colors[(x / 2) % colors.length]!);
});
add("fireplace", "Kamin", "decor", "luxury", 28_000, 2, 1, (s) => {
  s.rect(0, 0, 32, 16, "#8f9bb3");
  s.rect(6, 4, 20, 10, K);
  s.circle(16, 10, 4, "#ff9a52");
  s.circle(16, 11, 2, "#ffe06b");
});
add("aquarium", "Aquarium", "decor", "premium", 5_500, 2, 1, (s) => {
  s.rect(0, 2, 32, 12, "#2f5fd0");
  s.rect(1, 3, 30, 10, "#4f8cff");
  for (const [x, y, c] of [
    [6, 6, "#ff9a52"],
    [14, 9, "#ffd15c"],
    [22, 5, "#ff6170"],
    [26, 10, "#2fd98c"],
  ] as const)
    s.rect(x, y, 3, 2, c);
  s.frame(0, 2, 32, 12, K);
});
add("statue_marble", "Marmorstatue", "decor", "luxury", 65_000, 1, 1, (s) => {
  s.circle(8, 8, 7, "#b8b8b0");
  s.circle(8, 8, 4, "#fbfbf8");
  s.circle(8, 6, 2, "#e3e3dc");
});
add("statue_gold", "Goldene Statue", "decor", "ultra", 1_500_000, 1, 1, (s) => {
  s.circle(8, 8, 7, "#c8962f");
  s.circle(8, 8, 4, "#ffd15c");
  s.circle(8, 6, 2, "#fff1a8");
});
add("safe", "Tresor", "decor", "premium", 8_000, 1, 1, (s) => {
  s.rect(1, 1, 14, 14, "#5d6679");
  s.frame(1, 1, 14, 14, K);
  s.circle(8, 8, 3, "#c5ccd6");
  s.set(8, 6, K);
});
// tech
add("tv_small", "Fernseher", "tech", "budget", 299, 2, 1, (s) => {
  s.rect(2, 6, 28, 8, "#6e4a28");
  s.rect(4, 2, 24, 4, K);
  s.rect(5, 3, 22, 2, "#4f8cff");
});
add("tv_big", "Großbild-TV", "tech", "standard", 1_900, 3, 1, (s) => {
  s.rect(2, 6, 44, 8, "#3a3f4b");
  s.rect(3, 1, 42, 5, K);
  s.rect(4, 2, 40, 3, "#62e0ff");
});
add("cinema", "Heimkino", "tech", "luxury", 120_000, 4, 2, (s) => {
  s.rect(0, 0, 64, 8, K);
  s.rect(2, 1, 60, 5, "#62e0ff");
  for (let x = 4; x < 60; x += 12) {
    s.rect(x, 14, 10, 12, "#7a2f7a");
    s.rect(x, 14, 10, 3, "#5a1f5a");
  }
});
add("gaming_setup", "Gaming-Setup", "tech", "premium", 7_500, 2, 1, (s) => {
  table(s, "black");
  s.rect(4, 3, 10, 4, K);
  s.rect(18, 3, 10, 4, K);
  s.rect(5, 4, 8, 2, "#2fd98c");
  s.rect(19, 4, 8, 2, "#ff6170");
});
// fun
add("arcade", "Spielautomat", "fun", "premium", 3_900, 1, 1, (s) => {
  s.rect(1, 1, 14, 14, "#3a3f4b");
  s.rect(3, 2, 10, 6, "#9a6bff");
  s.circle(6, 11, 1, "#ff6170");
  s.circle(10, 11, 1, "#2fd98c");
});
add("pool_table", "Billardtisch", "fun", "luxury", 26_000, 3, 2, (s) => {
  s.rect(0, 0, 48, 32, "#6e4a28");
  s.rect(3, 3, 42, 26, "#2f7a4a");
  for (const [x, y] of [
    [3, 3],
    [23, 3],
    [44, 3],
    [3, 28],
    [23, 28],
    [44, 28],
  ])
    s.rect(x!, y!, 2, 2, K);
  for (const [x, y, c] of [
    [14, 14, "#ffffff"],
    [30, 12, "#d93a2f"],
    [32, 16, "#ffd15c"],
    [34, 14, "#4f8cff"],
  ] as const)
    s.rect(x, y, 2, 2, c);
});
add("piano", "Klavier", "fun", "luxury", 18_000, 2, 1, (s) => {
  s.rect(0, 0, 32, 10, K);
  s.rect(1, 10, 30, 5, "#ffffff");
  for (let x = 2; x < 30; x += 3) s.rect(x, 10, 1, 3, K);
});
add("grand_piano", "Konzertflügel", "fun", "ultra", 650_000, 3, 2, (s) => {
  s.circle(28, 18, 13, K);
  s.rect(4, 4, 24, 24, K);
  s.rect(4, 26, 26, 5, "#ffffff");
  for (let x = 5; x < 29; x += 3) s.rect(x, 26, 1, 3, K);
  s.rect(10, 8, 14, 10, "#3a3f4b");
});

// ---------------------------------------------------------------- floors (one 16 × 16 tile each)
function floorTile(kind: string): { palette: string[]; grid: string[] } {
  const s = new Sprite(T, T);
  const fill = (c: string) => s.rect(0, 0, T, T, c);
  switch (kind) {
    case "laminate":
      fill("#d6b98c");
      for (let y = 0; y < T; y += 4) s.rect(0, y, T, 1, "#b8986a");
      for (let y = 0; y < T; y += 4) s.set((y * 5) % T, y + 2, "#b8986a");
      break;
    case "carpet":
      fill("#8f9bb3");
      for (let i = 0; i < 40; i++) s.set((i * 7) % T, (i * 11) % T, "#7f8aa1");
      break;
    case "tiles":
      fill("#e9edf2");
      for (let i = 0; i < T; i += 8) {
        s.rect(i, 0, 1, T, "#c5ccd6");
        s.rect(0, i, T, 1, "#c5ccd6");
      }
      break;
    case "parquet":
      fill("#9a6b3c");
      for (let y = 0; y < T; y += 4)
        for (let x = 0; x < T; x += 8) {
          s.rect(x + ((y / 4) % 2) * 4, y, 4, 4, "#b07b45");
          s.set(x + ((y / 4) % 2) * 4, y, "#6e4a28");
        }
      break;
    case "stone":
      fill("#8f8f8a");
      for (let i = 0; i < T; i += 8) {
        s.rect(0, i, T, 1, "#6f6f6a");
        s.rect((i * 3) % T, i, 1, 8, "#6f6f6a");
      }
      break;
    case "marble":
      fill("#f3f3f0");
      for (let i = 0; i < T; i++) s.set(i, Math.floor(8 + Math.sin(i / 2) * 3), "#c8c8c0");
      s.rect(0, 0, T, 1, "#e3e3dc");
      s.rect(0, 0, 1, T, "#e3e3dc");
      break;
    case "gold":
      fill("#ffd15c");
      for (let i = 0; i < T; i += 8) {
        s.rect(i, 0, 1, T, "#c8962f");
        s.rect(0, i, T, 1, "#c8962f");
      }
      s.rect(2, 2, 3, 1, "#fff1a8");
      s.rect(10, 10, 3, 1, "#fff1a8");
      break;
  }
  return s.out();
}
const FLOORS = ["laminate", "carpet", "tiles", "parquet", "stone", "marble", "gold"];
const floorTiles = Object.fromEntries(FLOORS.map((f) => [f, floorTile(f)]));

// ---------------------------------------------------------------- cars (side view, 48 × 20)
interface Car {
  key: string;
  name: string;
  brand: string;
  tier: Tier;
  priceCents: number;
  sprite: { palette: string[]; grid: string[] };
}
const cars: Car[] = [];
type Shape = "compact" | "sedan" | "suv" | "pickup" | "sports" | "super" | "hyper" | "classic" | "van" | "electric";
function car(shape: Shape, body: [string, string, string]): { palette: string[]; grid: string[] } {
  const s = new Sprite(48, 20);
  const [l, c, d] = body;
  // roof line and body profile: for every x the top of the body and of the cabin
  const low = shape === "super" || shape === "hyper" || shape === "sports";
  const bodyTop = (x: number) => {
    if (shape === "pickup") return x > 26 ? 9 : 8;
    if (low) return 11 - (x < 10 ? 0 : 0);
    if (shape === "suv" || shape === "van") return 8;
    return 10;
  };
  const cabin: [number, number, number] =
    shape === "compact"
      ? [12, 34, 4]
      : shape === "sedan" || shape === "electric"
        ? [13, 33, 5]
        : shape === "suv"
          ? [10, 38, 3]
          : shape === "van"
            ? [6, 42, 2]
            : shape === "pickup"
              ? [10, 24, 3]
              : shape === "classic"
                ? [15, 31, 4]
                : shape === "sports"
                  ? [16, 32, 7]
                  : shape === "super"
                    ? [17, 31, 8]
                    : [18, 30, 8];
  const bottom = 15;
  for (let x = 2; x < 46; x++) {
    let top = bodyTop(x);
    if (low) top = x < 6 || x > 42 ? 13 : x < 14 ? 12 : 11;
    if (shape === "classic") top = x < 8 || x > 40 ? 12 : 10;
    s.rect(x, top, 1, bottom - top, c);
    s.set(x, top, l);
  }
  // cabin
  const [x0, x1, cTop] = cabin;
  for (let x = x0; x < x1; x++) {
    const slope = Math.min(x - x0, x1 - 1 - x);
    const top = cTop + Math.max(0, (low ? 3 : 2) - slope);
    s.rect(x, top, 1, bodyTop(x) - top + (low ? 1 : 0), c);
    if (x > x0 + 1 && x < x1 - 2) s.rect(x, top + 1, 1, Math.max(1, (low ? 10 : bodyTop(x)) - top - 2), "#9ad8ff");
  }
  s.rect(Math.floor((x0 + x1) / 2), cTop + 1, 1, 6, c);
  // details
  s.rect(2, bottom - 1, 44, 1, d);
  s.rect(44, bottom - 4, 2, 2, "#fff1a8");
  s.rect(2, bottom - 4, 2, 2, "#ff6170");
  if (shape === "hyper" || shape === "super") s.rect(1, 9, 6, 1, d); // spoiler
  // wheels
  for (const wx of [11, 37]) {
    s.circle(wx, 16, 3, K);
    s.circle(wx, 16, 1, "#c5ccd6");
  }
  return s.out();
}
const addCar = (
  key: string,
  name: string,
  brand: string,
  tier: Tier,
  euros: number,
  shape: Shape,
  body: [string, string, string],
) => cars.push({ key, name, brand, tier, priceCents: euros * 100, sprite: car(shape, body) });

addCar("car_city", "Citylino", "Volka", "budget", 9_000, "compact", ["#bfe6ff", "#4f8cff", "#2f5fd0"]);
addCar("car_compact", "Kompakt GT", "Opalis", "budget", 18_000, "compact", ["#ff8a8a", "#d93a2f", "#9a2420"]);
addCar("car_sedan", "Limousine 5", "Bavaro", "standard", 48_000, "sedan", ["#c5ccd6", "#8f9bb3", "#5d6679"]);
addCar("car_electric", "Volt S", "Tesra", "standard", 62_000, "electric", ["#ffffff", "#e9edf2", "#8f9bb3"]);
addCar("car_suv", "Terra X", "Audrin", "standard", 75_000, "suv", ["#5d6679", "#3a3f4b", "#24272f"]);
addCar("car_pickup", "Ranchero", "Fordson", "standard", 55_000, "pickup", ["#e6c48f", "#c89a63", "#9a6b3c"]);
addCar("car_van", "Familia Van", "Volka", "budget", 32_000, "van", ["#c8e6c9", "#4fae6e", "#2f7a4a"]);
addCar("car_classic", "Oldtimer 1960", "Mercurio", "premium", 140_000, "classic", ["#fff1c4", "#e6c48f", "#9a6b3c"]);
addCar("car_sports", "Carrera Nove", "Stuttgarda", "premium", 180_000, "sports", ["#ffe06b", "#ffd15c", "#c8962f"]);
addCar("car_luxury", "Phantasma", "Royce & Co.", "luxury", 480_000, "sedan", ["#3a3f4b", "#24272f", "#111318"]);
addCar("car_toro", "Toro Furioso", "Toro Veloce", "luxury", 420_000, "super", ["#ffe06b", "#ffb000", "#c87800"]);
addCar("car_cavallo", "Rosso 812", "Cavallo Rosso", "luxury", 390_000, "super", ["#ff8a8a", "#d93a2f", "#9a2420"]);
addCar("car_hyper", "Ventus Hyper", "Bugatto", "ultra", 3_200_000, "hyper", ["#9ad8ff", "#2f5fd0", "#17306b"]);
addCar("car_gold", "Aurum Edition", "Toro Veloce", "ultra", 7_500_000, "hyper", ["#fff1a8", "#ffd15c", "#c8962f"]);

// ---------------------------------------------------------------- write
for (const i of items) if (i.sprite.palette.length > 16) throw new Error(`${i.key}: too many colours`);
const ts = `/**
 * Home catalogue (ADR-082): furniture from above, floor tiles, cars from the side.
 * GENERATED by scripts/gen-furniture.ts, do not edit by hand. Keys are stored in the database and must never change.
 */
import type { FloorMaterial } from "./balance";

export type FurnitureTier = "budget" | "standard" | "premium" | "luxury" | "ultra";
export type FurnitureCategory = "seating" | "tables" | "beds" | "kitchen" | "bath" | "plants" | "decor" | "tech" | "rugs" | "fun";

export interface Sprite {
  readonly palette: readonly string[];
  readonly grid: readonly string[];
}

export interface FurnitureItem {
  readonly key: string;
  readonly name: string;
  readonly category: FurnitureCategory;
  readonly tier: FurnitureTier;
  readonly priceCents: number;
  /** Size in floor tiles (before rotation). */
  readonly w: number;
  readonly h: number;
  /** Rugs lie under furniture. */
  readonly layer: "floor" | "object";
  readonly sprite: Sprite;
}

export interface CarItem {
  readonly key: string;
  readonly name: string;
  /** Made-up brands only. */
  readonly brand: string;
  readonly tier: FurnitureTier;
  readonly priceCents: number;
  readonly sprite: Sprite;
}

/** Art pixels per floor tile. */
export const TILE = ${T};

export const FURNITURE: readonly FurnitureItem[] = ${JSON.stringify(items)};

export const CARS: readonly CarItem[] = ${JSON.stringify(cars)};

export const FLOOR_TILES: Readonly<Record<FloorMaterial, Sprite>> = ${JSON.stringify(floorTiles)};
`;
writeFileSync("src/config/furniture.ts", ts);

const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
const sql = `-- GENERATED by scripts/gen-furniture.ts. Do not edit by hand.
-- Home catalogue (ADR-082): furniture and cars without their pictures. Prices and sizes may be updated.
insert into public.furniture_catalog (key, name, category, tier, price_cents, width, height, layer)
values
${items.map((i) => `  (${q(i.key)}, ${q(i.name)}, ${q(i.category)}, ${q(i.tier)}, ${i.priceCents}, ${i.w}, ${i.h}, ${q(i.layer)})`).join(",\n")}
on conflict (key) do update set name = excluded.name, category = excluded.category, tier = excluded.tier,
  price_cents = excluded.price_cents, width = excluded.width, height = excluded.height, layer = excluded.layer;

insert into public.car_catalog (key, name, brand, tier, price_cents)
values
${cars.map((c) => `  (${q(c.key)}, ${q(c.name)}, ${q(c.brand)}, ${q(c.tier)}, ${c.priceCents})`).join(",\n")}
on conflict (key) do update set name = excluded.name, brand = excluded.brand, tier = excluded.tier,
  price_cents = excluded.price_cents;
`;
writeFileSync("supabase/seeds/furniture.sql", sql);
console.log(`${items.length} furniture items, ${cars.length} cars, ${FLOORS.length} floors`);
