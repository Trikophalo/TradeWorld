import type { PixelArt } from "./pixel-icon";

/*
 * Staff figures for the company office (ADR-078): a person or a robot, 12×16, wearing a T-shirt in the company
 * colour with the logo shrunk onto the chest. Pure data and functions, no React.
 */

const OUTLINE = "#5d6679";
const PANTS = "#2b3245";
const METAL = "#aab6cc";
const EYES = "#62e0ff";
/** Hair and skin tones, picked from the name so a person always looks the same. */
const HAIR = ["#2b1d16", "#5a3a22", "#a8692c", "#e0b25c", "#c2c7d0", "#7a2f2f"] as const;
const SKIN = ["#f2d0b0", "#e0b48f", "#c68c63", "#9a6844", "#6e4a33"] as const;

const PERSON = [
  "....hhhh....",
  "...hhhhhh...",
  "...hssssh...",
  "...skssks...",
  "...ssssss...",
  "....ssss....",
  "..tttttttt..",
  ".tttttttttt.",
  ".tttttttttt.",
  ".stttttttts.",
  ".stttttttts.",
  "..tttttttt..",
  "...pppppp...",
  "...pp..pp...",
  "...pp..pp...",
  "..kkk..kkk..",
];

const ROBOT = [
  ".....kk.....",
  ".....kk.....",
  "...kkkkkk...",
  "...kmmmmk...",
  "...kemmek...",
  "...kmmmmk...",
  "....kkkk....",
  ".kttttttttk.",
  ".tttttttttt.",
  ".mttttttttm.",
  ".mttttttttm.",
  "..tttttttt..",
  "...mmmmmm...",
  "...mm..mm...",
  "...mm..mm...",
  "..kkk..kkk..",
];

/** Chest area for the logo: rows 7–10, columns 4–7. */
const CHEST = { x: 4, y: 7, size: 4 } as const;

export interface FigureLogo {
  readonly palette: readonly string[];
  readonly grid: readonly string[];
}

/** Shrinks a logo to size × size: each block takes its most frequent colour if at least a quarter is drawn. */
export function shrinkLogo(logo: FigureLogo, size: number): string[] {
  const block = Math.floor(logo.grid.length / size);
  return Array.from({ length: size }, (_, by) =>
    Array.from({ length: size }, (_, bx) => {
      const counts = new Map<string, number>();
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const c = logo.grid[by * block + y]?.[bx * block + x] ?? ".";
          if (c !== ".") counts.set(c, (counts.get(c) ?? 0) + 1);
        }
      }
      let best = ".";
      let most = 0;
      for (const [c, n] of counts) if (n > most) [best, most] = [c, n];
      return most * 4 >= block * block ? best : ".";
    }).join(""),
  );
}

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * A staff figure: `kind` person or robot, shirt in the company colour, the logo (if any) on the chest.
 * Logo colours use the digits "0".."5", like the logo itself.
 */
export function staffFigure(kind: "person" | "robot", seed: string, shirt: string, logo: FigureLogo | null): PixelArt {
  const base = kind === "robot" ? ROBOT : PERSON;
  const rows = base.map((r) => r.split(""));
  const palette: Record<string, string> = { k: OUTLINE, t: shirt, p: PANTS, m: METAL, e: EYES };
  if (kind === "person") {
    const h = hash(seed);
    palette.h = HAIR[h % HAIR.length]!;
    palette.s = SKIN[Math.floor(h / HAIR.length) % SKIN.length]!;
  }
  if (logo) {
    shrinkLogo(logo, CHEST.size).forEach((row, y) =>
      row.split("").forEach((c, x) => {
        if (c !== ".") rows[CHEST.y + y]![CHEST.x + x] = c;
      }),
    );
    logo.palette.forEach((color, i) => {
      palette[String(i)] = color;
    });
  }
  return { grid: rows.map((r) => r.join("")), palette };
}

/** Office plants and a desk for the company office (ADR-078). */
export const OFFICE_PLANT: PixelArt = {
  palette: { g: "#2fd98c", d: "#17a866", p: "#c8553d", k: OUTLINE },
  grid: [
    "...gg...",
    "..gddg..",
    ".gd..dg.",
    "gd.gg.dg",
    ".g.dd.g.",
    "...dd...",
    ".kppppk.",
    ".kppppk.",
    "..kppk..",
    "..kkkk..",
  ],
};

export const OFFICE_DESK: PixelArt = {
  palette: { w: "#9a6b3c", d: "#6e4a28", k: OUTLINE },
  grid: ["kkkkkkkkkkkkkk", "wwwwwwwwwwwwww", ".d..........d.", ".d..........d."],
};
