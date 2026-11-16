import { fillRect, type Raster } from "./nexamon-raster";

/*
 * A three by five pixel alphabet for lettering that belongs to the artwork itself (the logo on the card back, the
 * booster packs, the grading label). Card text that players read is real text above the canvas, never this.
 */
const GLYPHS: Record<string, readonly string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  " ": ["..", "..", "..", "..", ".."],
};

/** Width in art pixels of a word at the given integer scale (one pixel between letters). */
export function microTextWidth(text: string, scale = 1): number {
  let width = 0;
  for (const ch of text.toUpperCase()) width += ((GLYPHS[ch] ?? GLYPHS[" "]!)[0]!.length + 1) * scale;
  return Math.max(0, width - scale);
}

/** Draws a word; unknown characters become a gap. Returns the x after the last letter. */
export function drawMicroText(
  r: Raster,
  text: string,
  x: number,
  y: number,
  hex: string,
  scale = 1,
  alpha = 1,
): number {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "]!;
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++)
        if (row[gx] === "#") fillRect(r, cx + gx * scale, y + gy * scale, scale, scale, hex, alpha);
    });
    cx += (glyph[0]!.length + 1) * scale;
  }
  return cx;
}

/** Draws a word centred on `cx`. */
export function drawMicroTextCentered(
  r: Raster,
  text: string,
  cx: number,
  y: number,
  hex: string,
  scale = 1,
  alpha = 1,
): void {
  drawMicroText(r, text, Math.round(cx - microTextWidth(text, scale) / 2), y, hex, scale, alpha);
}
