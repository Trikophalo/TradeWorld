import type { CompanyLogoData } from "@/lib/sim/logo";

const INDEX = "0123456789abcdef";

/** Colour of every row at the left or right edge of the banner (transparent cells fall back to the first colour). */
export function edgeColors(banner: CompanyLogoData, side: "left" | "right"): string[] {
  return banner.grid.map((row) => {
    const ch = side === "left" ? row[0] : row[row.length - 1];
    const i = ch === undefined ? -1 : INDEX.indexOf(ch);
    return banner.palette[i] ?? banner.palette[0] ?? "transparent";
  });
}

/**
 * The edge column continued as horizontal stripes, one per banner row and `scale` pixels high, so the space beside
 * the whole-pixel banner looks like the banner itself (ADR-078). Returns a CSS background-image.
 */
export function edgeStripes(banner: CompanyLogoData, side: "left" | "right", scale: number): string {
  const colors = edgeColors(banner, side);
  const stops = colors.map((c, i) => `${c} ${i * scale}px ${(i + 1) * scale}px`);
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}
