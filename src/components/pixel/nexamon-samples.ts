import type { NexamonArt, NexamonCard } from "@/config/nexamon/types";
import { bayer } from "./nexamon-raster";

/*
 * Five sample cards with artwork, one per rarity, for the showcase on /dev/ui and the tests (ADR-165). They are
 * fixtures of the renderer and never part of the catalogue: the real cards live in src/config/nexamon.
 * The artworks are drawn by code (blobs with three tones, light from the top left, an ink outline) and come out
 * as the same character grids the catalogue uses.
 */

type Tones = readonly [dark: string, base: string, light: string];

/** A character grid to draw on. "." is transparent. */
class Pad {
  readonly cells: string[][];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
  }
  get(x: number, y: number): string {
    return this.cells[y]?.[x] ?? ".";
  }
  put(x: number, y: number, ch: string): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px >= 0 && py >= 0 && px < this.w && py < this.h) this.cells[py]![px] = ch;
  }
  rect(x: number, y: number, w: number, h: number, ch: string): void {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) this.put(px, py, ch);
  }
  /** Vertical dithered gradient through the given characters. */
  gradient(x: number, y: number, w: number, h: number, stops: readonly string[]): void {
    for (let py = 0; py < h; py++) {
      const pos = (py / Math.max(1, h - 1)) * (stops.length - 1);
      const base = Math.floor(pos);
      for (let px = 0; px < w; px++) {
        const i = pos - base > bayer(x + px, y + py) ? Math.min(stops.length - 1, base + 1) : base;
        this.put(x + px, y + py, stops[i]!);
      }
    }
  }
  /** A flat ellipse. */
  disc(cx: number, cy: number, rx: number, ry: number, ch: string): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.put(x, y, ch);
  }
  /** An ellipse shaded like a ball: light upper left, shadow lower right. */
  blob(cx: number, cy: number, rx: number, ry: number, tones: Tones): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const v = nx * -0.55 + ny * -0.75;
        this.put(x, y, v > 0.42 ? tones[2] : v < -0.48 ? tones[0] : tones[1]);
      }
  }
  /** A filled polygon (even-odd). */
  poly(points: readonly (readonly [number, number])[], ch: string): void {
    const ys = points.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const hits: number[] = [];
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length]!;
        if (a[1] <= y !== b[1] <= y) hits.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      });
      hits.sort((p, q) => p - q);
      for (let i = 0; i + 1 < hits.length; i += 2)
        for (let x = Math.round(hits[i]!); x <= Math.round(hits[i + 1]!); x++) this.put(x, y, ch);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, ch: string, thick = 1): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      if (thick <= 1) this.put(x, y, ch);
      else this.disc(x, y, thick / 2, thick / 2, ch);
    }
  }
  /** A tube of shaded balls along a curve: necks, tails, serpents. */
  tube(curve: (t: number) => readonly [number, number, number], tones: Tones, steps = 60): void {
    for (let i = 0; i <= steps; i++) {
      const [x, y, radius] = curve(i / steps);
      this.blob(x, y, radius, radius, tones);
    }
  }
  /** Draws an ink line around everything on the pad. */
  outline(ch: string): void {
    const marks: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (
          this.get(x, y) === "." &&
          [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)].some((c) => c !== ".")
        )
          marks.push([x, y]);
    for (const [x, y] of marks) this.put(x, y, ch);
  }
  /** Lays another pad on top. */
  stamp(top: Pad, dx = 0, dy = 0): void {
    for (let y = 0; y < top.h; y++)
      for (let x = 0; x < top.w; x++) if (top.cells[y]![x] !== ".") this.put(x + dx, y + dy, top.cells[y]![x]!);
  }
  /** Clears everything outside a rectangle (the part of an ultra artwork that stays inside the window). */
  keepInside(x: number, y: number, w: number, h: number): void {
    for (let py = 0; py < this.h; py++)
      for (let px = 0; px < this.w; px++) if (px < x || py < y || px >= x + w || py >= y + h) this.cells[py]![px] = ".";
  }
  art(palette: Record<string, string>): NexamonArt {
    return { width: this.w, height: this.h, palette, grid: this.cells.map((row) => row.join("")) };
  }
}

/** Repeatable noise for stars, embers and bubbles. */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/** An eye: a dark oval with a glint in the upper left. */
function eye(pad: Pad, x: number, y: number, ink: string, glint: string, tall = 3): void {
  pad.rect(x, y, 2, tall, ink);
  pad.put(x, y, glint);
}

// ------------------------------------------------------------------ common: a fox cub with a glowing tail

function glimmfuchs(): NexamonArt {
  const palette = {
    a: "#fff1b8", // sky
    b: "#ffd27a",
    c: "#ffa95a",
    d: "#e8743c",
    g: "#7a2f24", // hills
    G: "#5a1f1c",
    h: "#93402a",
    k: "#3a1410", // ink
    o: "#f07a2a", // fur
    O: "#c4521a",
    p: "#ffa64d",
    w: "#fff0d8", // cream
    W: "#e9c9a0",
    y: "#ffe25c", // flame
    Y: "#fff7c4",
    r: "#ff5a36",
    e: "#ffffff",
  };
  const bg = new Pad(60, 40);
  bg.gradient(0, 0, 60, 30, ["a", "a", "b", "c", "d"]);
  bg.disc(46, 9, 6, 6, "Y");
  bg.disc(46, 9, 4.5, 4.5, "e");
  bg.disc(12, 36, 20, 9, "h");
  bg.disc(48, 38, 24, 9, "g");
  bg.rect(0, 35, 60, 5, "G");
  for (let x = 0; x < 60; x++) if (bayer(x, 34) > 0.5) bg.put(x, 34, "G");
  const rand = rng(11);
  for (let i = 0; i < 9; i++) bg.put(4 + rand() * 52, 4 + rand() * 22, rand() > 0.5 ? "y" : "r");

  const fox = new Pad(60, 40);
  const fur: Tones = ["O", "o", "p"];
  // Tail: a flame that licks upwards.
  fox.blob(42, 24, 6.5, 8, ["r", "o", "p"]);
  fox.poly(
    [
      [38, 20],
      [41, 8],
      [44, 15],
      [47, 10],
      [48, 22],
    ],
    "o",
  );
  fox.blob(42.5, 24, 4, 5.5, ["y", "y", "Y"]);
  fox.poly(
    [
      [41, 20],
      [42, 13],
      [44, 19],
    ],
    "y",
  );
  fox.put(42, 24, "e");
  // Body, haunch and paws.
  fox.blob(30, 27, 8.5, 7.5, fur);
  fox.blob(28.5, 28.5, 4.5, 5, ["W", "w", "w"]);
  fox.blob(24, 34, 3, 2, ["W", "w", "w"]);
  fox.blob(33, 34, 3, 2, ["W", "w", "w"]);
  // Ears, head and muzzle.
  fox.poly(
    [
      [18, 12],
      [17, 2],
      [24, 8],
    ],
    "o",
  );
  fox.poly(
    [
      [29, 8],
      [35, 1],
      [35, 12],
    ],
    "o",
  );
  fox.poly(
    [
      [19, 9],
      [18, 5],
      [21, 8],
    ],
    "k",
  );
  fox.poly(
    [
      [31, 8],
      [34, 4],
      [34, 9],
    ],
    "k",
  );
  fox.blob(26, 15.5, 9.5, 7.5, fur);
  fox.blob(22.5, 19, 5.5, 3.5, ["W", "w", "w"]);
  eye(fox, 21, 13, "k", "e");
  eye(fox, 29, 13, "k", "e");
  fox.rect(18, 18, 2, 1, "k");
  fox.put(20, 20, "k");
  fox.put(21, 21, "k");
  fox.put(22, 21, "k");
  fox.put(31, 17, "r");
  fox.put(32, 17, "r");
  fox.outline("k");
  bg.stamp(fox, 2, 1);
  return bg.art(palette);
}

// ------------------------------------------------------------------ rare: a drop of living water

function tropfel(): NexamonArt {
  const palette = {
    a: "#0d2f73", // deep water
    b: "#1650a6",
    c: "#2a7fd6",
    d: "#58b4f0",
    e: "#a8e3ff",
    s: "#e8d9a0", // sand
    S: "#c2ab70",
    k: "#0a1c44", // ink
    u: "#38c6e8", // body
    U: "#1d8fc4",
    v: "#8eeeff",
    w: "#ffffff",
    p: "#ff8fb0", // cheeks
    g: "#2fa36a", // weed
    G: "#1c7048",
  };
  const bg = new Pad(60, 40);
  bg.gradient(0, 0, 60, 40, ["d", "c", "c", "b", "a"]);
  // Shafts of light from the surface.
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 60; x++) {
      const shaft = (x + y * 0.5) % 19;
      if (shaft < 4 && bayer(x, y) > 0.3 + y / 45) bg.put(x, y, y < 10 ? "e" : "d");
    }
  bg.disc(14, 43, 22, 8, "S");
  bg.disc(44, 44, 26, 8, "s");
  for (const [x, top] of [
    [6, 22],
    [9, 27],
    [53, 24],
    [56, 29],
  ] as const)
    for (let y = top; y < 37; y++) bg.put(x + Math.round(Math.sin(y * 0.9) * 1.2), y, y % 3 ? "g" : "G");
  const rand = rng(5);
  for (let i = 0; i < 10; i++) {
    const x = 3 + rand() * 54;
    const y = 2 + rand() * 30;
    bg.put(x, y, "e");
    if (rand() > 0.5) {
      bg.put(x + 1, y, "w");
      bg.put(x, y + 1, "d");
      bg.put(x + 1, y + 1, "e");
    }
  }

  const drop = new Pad(60, 40);
  const body: Tones = ["U", "u", "v"];
  drop.poly(
    [
      [17, 21],
      [10, 15],
      [11, 27],
    ],
    "U",
  );
  drop.poly(
    [
      [43, 21],
      [50, 15],
      [49, 27],
    ],
    "U",
  );
  drop.poly(
    [
      [26, 12],
      [30, 2],
      [34, 12],
    ],
    "u",
  );
  drop.put(30, 4, "v");
  drop.blob(30, 21, 12, 11, body);
  drop.blob(30, 25, 7, 5.5, ["v", "v", "e"]);
  drop.rect(23, 12, 3, 2, "w");
  drop.put(22, 14, "w");
  eye(drop, 24, 18, "k", "w", 4);
  eye(drop, 34, 18, "k", "w", 4);
  drop.rect(21, 23, 2, 1, "p");
  drop.rect(37, 23, 2, 1, "p");
  drop.put(28, 24, "k");
  drop.rect(29, 25, 3, 1, "k");
  drop.put(32, 24, "k");
  drop.outline("k");
  bg.stamp(drop, 0, 1);
  return bg.art(palette);
}

// ------------------------------------------------------------------ ultra: a storm bird that leaves its frame

function voltaquila(): NexamonArt {
  const palette = {
    a: "#231546", // storm sky
    b: "#3a2470",
    c: "#5a3a9c",
    d: "#8a62c8",
    m: "#2b2350", // clouds
    M: "#473c78",
    k: "#1f1400", // ink
    y: "#f6c21c", // plumage
    Y: "#b9820a",
    z: "#ffe873",
    w: "#fffbe0",
    o: "#ff8a1f", // beak and claws
    e: "#ffffff",
    l: "#bff4ff", // lightning
  };
  const bg = new Pad(68, 48);
  bg.gradient(0, 0, 68, 48, ["a", "b", "c", "d", "c"]);
  for (const [cx, cy, rx] of [
    [12, 12, 12],
    [30, 9, 10],
    [54, 13, 13],
    [20, 43, 16],
    [50, 44, 18],
  ] as const) {
    bg.disc(cx, cy, rx, 4.5, "m");
    bg.disc(cx - 2, cy - 1.5, rx * 0.7, 2.5, "M");
  }
  for (const [x0, y0] of [
    [10, 14],
    [57, 15],
  ] as const) {
    bg.line(x0, y0, x0 - 3, y0 + 8, "l");
    bg.line(x0 - 3, y0 + 8, x0 + 1, y0 + 9, "l");
    bg.line(x0 + 1, y0 + 9, x0 - 3, y0 + 20, "l");
    bg.put(x0 - 1, y0 + 14, "e");
  }
  // The sky stays inside the window; the bird may cross it.
  bg.keepInside(4, 6, 60, 40);

  const bird = new Pad(68, 48);
  const plumage: Tones = ["Y", "y", "z"];
  // Wings: three rows of feathers each, the tips reach past the frame.
  for (const side of [-1, 1] as const) {
    const at = (x: number) => 34 + side * x;
    bird.poly(
      [
        [at(5), 22],
        [at(20), 8],
        [at(33), 3],
        [at(31), 14],
        [at(33), 19],
        [at(27), 22],
        [at(28), 28],
        [at(20), 27],
        [at(17), 33],
        [at(7), 30],
      ],
      "y",
    );
    bird.poly(
      [
        [at(8), 20],
        [at(21), 9],
        [at(32), 4],
        [at(26), 13],
        [at(12), 22],
      ],
      "z",
    );
    bird.poly(
      [
        [at(9), 28],
        [at(20), 25],
        [at(27), 26],
        [at(18), 31],
        [at(10), 31],
      ],
      "Y",
    );
    bird.line(at(14), 23, at(29), 15, "Y");
    bird.line(at(12), 26, at(26), 22, "Y");
  }
  // Tail, body and head.
  bird.poly(
    [
      [30, 34],
      [34, 46],
      [38, 34],
    ],
    "Y",
  );
  bird.poly(
    [
      [32, 34],
      [34, 42],
      [36, 34],
    ],
    "y",
  );
  bird.blob(34, 28, 6.5, 8.5, plumage);
  bird.blob(34, 30, 3.5, 5, ["z", "w", "w"]);
  bird.blob(34, 16, 6.5, 6, plumage);
  // Crest: a bolt that breaks out of the top edge.
  bird.poly(
    [
      [32, 11],
      [35, 0],
      [37, 5],
      [40, 1],
      [38, 12],
    ],
    "z",
  );
  bird.poly(
    [
      [34, 9],
      [35, 3],
      [37, 8],
    ],
    "w",
  );
  eye(bird, 30, 14, "k", "e");
  eye(bird, 37, 14, "k", "e");
  bird.poly(
    [
      [32, 18],
      [34, 23],
      [36, 18],
    ],
    "o",
  );
  bird.rect(29, 37, 3, 2, "o");
  bird.rect(37, 37, 3, 2, "o");
  bird.outline("k");
  // Sparks around the wing tips.
  for (const [x, y] of [
    [3, 9],
    [64, 10],
    [8, 34],
    [60, 35],
    [22, 4],
    [47, 3],
  ] as const) {
    bird.put(x, y, "e");
    bird.put(x + 1, y, "l");
    bird.put(x, y + 1, "l");
  }
  bg.stamp(bird);
  return bg.art(palette);
}

// ------------------------------------------------------------------ prisma: a moon moth over crystal peaks

function lunafalter(): NexamonArt {
  const palette = {
    a: "#120a33", // night
    b: "#24104f",
    c: "#431a78",
    d: "#7a2a9c",
    e: "#c2489e",
    f: "#f08aa8",
    m: "#fff6d8", // moon
    M: "#f3dca0",
    n: "#d9b96c",
    s: "#ffffff", // stars
    S: "#b9a5ff",
    k: "#150828", // ink
    p: "#ff9bd8", // wings
    P: "#c85ab8",
    q: "#ffd3f0",
    v: "#8f6cff", // lower wings
    V: "#5a3fc4",
    u: "#c4b3ff",
    t: "#5ff0e0", // eye spots and crystals
    T: "#1fa8b8",
    w: "#fff8ff", // fur
    W: "#d9c8ee",
    g: "#2a1a5c", // peaks
    G: "#1b1040",
    h: "#4a36a0",
  };
  const bg = new Pad(72, 100);
  bg.gradient(0, 0, 72, 100, ["a", "a", "b", "c", "d", "e", "f"]);
  bg.disc(36, 30, 19, 19, "c");
  bg.blob(36, 30, 16, 16, ["n", "M", "m"]);
  bg.disc(30, 25, 3, 2.5, "M");
  bg.disc(42, 36, 2.5, 2, "n");
  bg.disc(41, 22, 1.5, 1.5, "M");
  const rand = rng(23);
  for (let i = 0; i < 70; i++) {
    const x = 2 + rand() * 68;
    const y = 2 + rand() * 66;
    if (Math.hypot(x - 36, y - 30) < 20) continue;
    const big = rand() > 0.85;
    bg.put(x, y, big ? "s" : "S");
    if (big)
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        bg.put(x + ox, y + oy, "S");
  }
  // Crystal peaks with a lit left face.
  for (const [cx, top, half] of [
    [10, 66, 13],
    [58, 62, 16],
    [34, 74, 17],
    [70, 78, 10],
    [0, 80, 9],
  ] as const) {
    bg.poly(
      [
        [cx - half, 100],
        [cx, top],
        [cx + half, 100],
      ],
      "g",
    );
    bg.poly(
      [
        [cx - half, 100],
        [cx, top],
        [cx - half * 0.2, 100],
      ],
      "h",
    );
    bg.poly(
      [
        [cx - 2, top + 8],
        [cx, top],
        [cx + 1, top + 9],
      ],
      "t",
    );
    bg.line(cx, top, cx + half * 0.4, 100, "G");
  }
  bg.gradient(0, 92, 72, 8, ["g", "G", "G"]);

  const moth = new Pad(72, 100);
  for (const side of [-1, 1] as const) {
    const at = (x: number) => 36 + side * x;
    // Lower wing with a long tail, then the upper wing.
    moth.blob(at(11), 55, 9, 9, ["V", "v", "u"]);
    moth.poly(
      [
        [at(8), 60],
        [at(17), 59],
        [at(19), 74],
        [at(15), 68],
      ],
      "v",
    );
    moth.disc(at(12), 56, 3.2, 3.2, "T");
    moth.disc(at(12), 56, 1.8, 1.8, "t");
    moth.poly(
      [
        [at(2), 44],
        [at(14), 27],
        [at(29), 24],
        [at(31), 36],
        [at(24), 48],
        [at(8), 50],
      ],
      "p",
    );
    moth.poly(
      [
        [at(5), 43],
        [at(15), 30],
        [at(27), 27],
        [at(20), 36],
      ],
      "q",
    );
    moth.poly(
      [
        [at(22), 46],
        [at(29), 37],
        [at(30), 30],
        [at(31), 36],
        [at(24), 48],
      ],
      "P",
    );
    moth.disc(at(20), 38, 4, 4, "k");
    moth.disc(at(20), 38, 3, 3, "t");
    moth.disc(at(20), 38, 1.4, 1.4, "s");
    moth.line(at(3), 46, at(18), 46, "P");
    // Antennae: feathery combs.
    moth.line(at(2), 37, at(8), 26, "W");
    for (let i = 0; i < 4; i++) moth.put(at(4 + i * 1.5) + side, 33 - i * 2.4, "w");
  }
  moth.blob(36, 53, 3.5, 9, ["W", "w", "w"]);
  moth.blob(36, 41, 5, 4.5, ["W", "w", "w"]);
  for (let y = 48; y < 62; y += 3) moth.rect(34, y, 5, 1, "W");
  eye(moth, 33, 40, "k", "s");
  eye(moth, 38, 40, "k", "s");
  moth.outline("k");
  bg.stamp(moth, 0, -4);
  // Dust falling from the wings.
  for (let i = 0; i < 26; i++) bg.put(8 + rand() * 56, 58 + rand() * 30, rand() > 0.5 ? "q" : "t");
  return bg.art(palette);
}

// ------------------------------------------------------------------ legendary: a dragon coiled around the sun

function aurodrak(): NexamonArt {
  const palette = {
    a: "#1a0612", // sky
    b: "#3d0c1c",
    c: "#7a1420",
    d: "#c2401c",
    e: "#f08a24",
    y: "#ffd75e", // sun
    Y: "#fff4c2",
    z: "#f0a52a",
    k: "#0e0a24", // ink
    i: "#3848c8", // scales
    I: "#1f2a7a",
    j: "#7f92ff",
    g: "#ffd75e", // belly, horns
    G: "#c98a10",
    h: "#fff4c2",
    r: "#ff4d3d", // wing skin
    R: "#a81c2c",
    q: "#ff8a5c",
    w: "#ffffff",
    m: "#2a0a14", // rock
    M: "#4a1420",
  };
  const bg = new Pad(72, 100);
  bg.gradient(0, 0, 72, 100, ["a", "b", "c", "d", "e", "d", "c", "b"]);
  // The sun with its rays.
  for (let y = 0; y < 76; y++)
    for (let x = 0; x < 72; x++) {
      const angle = Math.atan2(y - 36, x - 36);
      const d = Math.hypot(x - 36, y - 36);
      if (d > 17 && d < 44 && Math.sin(angle * 10) > 0.35 && bayer(x, y) > d / 52) bg.put(x, y, d < 30 ? "z" : "e");
    }
  bg.blob(36, 36, 17, 17, ["z", "y", "Y"]);
  bg.disc(36, 36, 11, 11, "Y");
  // Rocks at the foot.
  for (const [cx, top, half] of [
    [6, 78, 12],
    [66, 76, 13],
    [36, 88, 22],
  ] as const) {
    bg.poly(
      [
        [cx - half, 100],
        [cx - 2, top],
        [cx + half, 100],
      ],
      "m",
    );
    bg.poly(
      [
        [cx - half, 100],
        [cx - 2, top],
        [cx - half * 0.3, 100],
      ],
      "M",
    );
  }
  const rand = rng(41);
  for (let i = 0; i < 30; i++) bg.put(3 + rand() * 66, 3 + rand() * 90, rand() > 0.6 ? "y" : "e");

  const dragon = new Pad(72, 100);
  const scales: Tones = ["I", "i", "j"];
  // Wings: three fingers and the skin between them.
  for (const side of [-1, 1] as const) {
    const at = (x: number) => 36 + side * x;
    dragon.poly(
      [
        [at(6), 44],
        [at(14), 22],
        [at(33), 16],
        [at(30), 30],
        [at(33), 40],
        [at(25), 42],
        [at(26), 52],
        [at(17), 49],
        [at(13), 56],
      ],
      "r",
    );
    dragon.poly(
      [
        [at(9), 42],
        [at(15), 26],
        [at(30), 19],
        [at(22), 32],
      ],
      "q",
    );
    dragon.poly(
      [
        [at(24), 42],
        [at(29), 31],
        [at(33), 40],
      ],
      "R",
    );
    dragon.poly(
      [
        [at(16), 49],
        [at(22), 40],
        [at(26), 52],
      ],
      "R",
    );
    dragon.line(at(6), 44, at(14), 22, "i", 2);
    dragon.line(at(14), 22, at(33), 16, "i", 2);
    dragon.line(at(14), 23, at(25), 42, "I");
    dragon.line(at(14), 23, at(15), 54, "I");
    dragon.put(at(14), 20, "g");
    dragon.put(at(34), 15, "g");
  }
  // The body winds down from the head in an S and ends in a tail to the right.
  const spine = (t: number) => [36 + Math.sin(t * Math.PI * 2.1) * (9 + t * 9), 40 + t * 46, 6.2 - t * 4.2] as const;
  dragon.tube(spine, scales, 90);
  dragon.tube(
    (t) => {
      const [x, y, radius] = spine(t);
      return [x - 0.5, y + 1, Math.max(0.6, radius * 0.45)] as const;
    },
    ["G", "g", "h"],
    90,
  );
  dragon.poly(
    [
      [30, 86],
      [24, 84],
      [27, 91],
    ],
    "g",
  );
  // Head: horns, snout, eyes with a hard brow.
  dragon.poly(
    [
      [30, 30],
      [24, 17],
      [33, 27],
    ],
    "g",
  );
  dragon.poly(
    [
      [42, 30],
      [48, 17],
      [39, 27],
    ],
    "g",
  );
  dragon.put(24, 17, "h");
  dragon.put(48, 17, "h");
  dragon.blob(36, 33, 8, 7, scales);
  dragon.blob(36, 39, 5.5, 4.5, scales);
  dragon.rect(30, 30, 4, 1, "k");
  dragon.rect(39, 30, 4, 1, "k");
  dragon.rect(31, 31, 2, 3, "g");
  dragon.rect(40, 31, 2, 3, "g");
  dragon.put(32, 32, "k");
  dragon.put(40, 32, "k");
  dragon.put(31, 31, "w");
  dragon.put(41, 31, "w");
  dragon.put(34, 40, "k");
  dragon.put(38, 40, "k");
  dragon.rect(33, 43, 7, 1, "k");
  dragon.put(34, 44, "w");
  dragon.put(38, 44, "w");
  dragon.outline("k");
  bg.stamp(dragon, 0, -2);
  // Embers from its breath.
  for (let i = 0; i < 16; i++) bg.put(26 + rand() * 20, 44 + rand() * 10, rand() > 0.5 ? "Y" : "y");
  return bg.art(palette);
}

const card = (
  number: number,
  rarity: NexamonCard["rarity"],
  rest: Pick<NexamonCard, "name" | "type" | "hp" | "stage" | "evolvesFrom" | "attack" | "flavor" | "set">,
): NexamonCard => ({
  key: `demo-${String(number).padStart(3, "0")}`,
  number,
  rarity,
  startPriceCents: 0,
  ...rest,
});

/** One sample card per rarity, in rarity order. */
export const NEXAMON_SAMPLE_CARDS: readonly NexamonCard[] = [
  card(12, "common", {
    set: "mystic_energy",
    name: "Glimmfuchs",
    type: "fire",
    hp: 60,
    stage: 0,
    evolvesFrom: null,
    attack: { name: "Funkenbiss", damage: 20, text: "Wirf eine Münze. Bei Kopf ist der Gegner verbrannt." },
    flavor: "Sein Schweif glimmt heller, je näher eine Kursrallye rückt. Händler halten ihn für ein gutes Omen.",
  }),
  card(54, "rare", {
    set: "mystic_energy",
    name: "Tropfel",
    type: "water",
    hp: 90,
    stage: 1,
    evolvesFrom: "demo-011",
    attack: { name: "Gezeitenstoß", damage: 50, text: "Heile 10 Schaden bei dir selbst." },
    flavor: "Es sammelt Regen aus hundert Jahren in sich. Wer es schüttelt, hört das Meer.",
  }),
  card(66, "ultra", {
    set: "super_apex",
    name: "Voltaquila",
    type: "electric",
    hp: 150,
    stage: 2,
    evolvesFrom: "demo-031",
    attack: { name: "Donnerschwinge", damage: 120, text: "Lege eine Energie von dieser Karte ab." },
    flavor: "Wo ihr Schatten fällt, flackern die Kurstafeln. Kein Gehege hat sie je gehalten.",
  }),
  card(73, "prisma", {
    set: "prismatic_peak",
    name: "Lunafalter",
    type: "psychic",
    hp: 130,
    stage: 1,
    evolvesFrom: "demo-040",
    attack: { name: "Mondstaub", damage: 90, text: "Der Gegner schläft jetzt." },
    flavor: "Nur bei Vollmond öffnet er alle vier Flügel. Der Staub darauf zeigt, was morgen geschieht.",
  }),
  card(77, "legendary", {
    set: "prismatic_peak",
    name: "Aurodrak",
    type: "dragon",
    hp: 220,
    stage: 0,
    evolvesFrom: null,
    attack: { name: "Sonnenhort", damage: 200, text: "Dieses Nexamon kann im nächsten Zug nicht angreifen." },
    flavor: "Der erste Drache hütet kein Gold. Er ist das Gold, und die Sonne ist sein Nest.",
  }),
];

/** Names of the cards the samples evolve from (the catalogue resolves these by key). */
export const NEXAMON_SAMPLE_EVOLVES: Readonly<Record<string, string>> = {
  "demo-011": "Tröpfling",
  "demo-031": "Voltküken",
  "demo-040": "Lunalarve",
};

let artCache: Record<string, NexamonArt> | null = null;

/** Artwork of the sample cards by card key, built on first use. */
export function nexamonSampleArt(): Readonly<Record<string, NexamonArt>> {
  artCache ??= {
    "demo-012": glimmfuchs(),
    "demo-054": tropfel(),
    "demo-066": voltaquila(),
    "demo-073": lunafalter(),
    "demo-077": aurodrak(),
  };
  return artCache;
}
