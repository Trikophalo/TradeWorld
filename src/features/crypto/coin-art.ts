import type { PixelArt } from "@/components/pixel/pixel-icon";
import type { CoinCategory } from "@/features/game/types";

/*
 * Pixel coins for the AI coins (ADR-101): a round coin in the coin's own colour with a mark for its category. The
 * colours are data (like company colours), shaded here. Player coins show their own pixel logo instead.
 */

const SHAPE = [
  ".....oooooo.....",
  "...oohhcccccoo..",
  "..ohhcccccccdo..",
  ".ohcccccccccddo.",
  ".ohcccccccccddo.",
  "ohcccccccccccddo",
  "ohcccccccccccddo",
  "occcccccccccccdo",
  "occcccccccccccdo",
  "occcccccccccccdo",
  "occcccccccccccdo",
  ".occcccccccccdo.",
  ".occcccccccccdo.",
  "..occcccccccdo..",
  "...oodddddddo...",
  ".....oooooo.....",
];

const MARKS: Record<Exclude<CoinCategory, "player">, readonly string[]> = {
  stable: ["......", "gggggg", "......", "......", "gggggg", "......"],
  major: ["..gg..", ".gggg.", "gggggg", "gggggg", ".gggg.", "..gg.."],
  alt: ["..gg..", "..gg..", ".gggg.", ".gggg.", "gggggg", "......"],
  meme: [".g..g.", ".g..g.", "......", "g....g", ".gggg.", "......"],
};

function clampByte(x: number) {
  return Math.max(0, Math.min(255, Math.round(x)));
}

/** Mixes a #rrggbb colour with black (negative amount) or white (positive), amount in −1..1. */
export function shade(hex: string, amount: number): string {
  const raw = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return hex;
  const target = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const parts = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
  return `#${parts
    .map((v) =>
      clampByte(v + (target - v) * k)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Relative brightness 0..1, to pick a light or dark mark. */
function brightness(hex: string): number {
  const raw = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255);
  return 0.299 * r! + 0.587 * g! + 0.114 * b!;
}

export function coinArt(color: string, category: CoinCategory): PixelArt {
  const mark = MARKS[category === "player" ? "alt" : category];
  const grid = SHAPE.map((row, y) => {
    if (y < 5 || y > 10) return row;
    const line = mark[y - 5]!;
    return row.slice(0, 5) + [...line].map((ch, i) => (ch === "g" ? "g" : row[5 + i])).join("") + row.slice(11);
  });
  return {
    grid,
    palette: {
      o: shade(color, -0.6),
      c: color,
      h: shade(color, 0.5),
      d: shade(color, -0.25),
      g: brightness(color) > 0.6 ? shade(color, -0.65) : shade(color, 0.85),
    },
  };
}
