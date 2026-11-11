/**
 * Company logos from the pixel editor (ADR-065): a 16×16 grid, one character per
 * pixel ("." transparent, "0".."5" palette index), up to six colours.
 * The database checks the same rules.
 */
import { BALANCE } from "../../config/balance.ts";
import type { StartupsConfig } from "../../config/balance.ts";

export interface CompanyLogoData {
  readonly palette: readonly string[];
  readonly grid: readonly string[];
}

const HEX = /^#[0-9a-f]{6}$/;

export function isValidLogo(logo: unknown, cfg: StartupsConfig = BALANCE.startups): logo is CompanyLogoData {
  if (!logo || typeof logo !== "object") return false;
  const { palette, grid } = logo as { palette?: unknown; grid?: unknown };
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > cfg.logo.maxColors) return false;
  if (!palette.every((c) => typeof c === "string" && HEX.test(c))) return false;
  if (!Array.isArray(grid) || grid.length !== cfg.logo.size) return false;
  const allowed = new RegExp(`^[.0-${palette.length - 1}]{${cfg.logo.size}}$`);
  if (!grid.every((row) => typeof row === "string" && allowed.test(row))) return false;
  // At least a few pixels, so an empty logo does not replace the colour tile.
  return grid.join("").replace(/\./g, "").length >= 8;
}

/** As art for PixelIcon: palette characters stay the indices. */
export function logoArt(logo: CompanyLogoData): { grid: readonly string[]; palette: Record<string, string> } {
  return { grid: logo.grid, palette: Object.fromEntries(logo.palette.map((c, i) => [String(i), c])) };
}

/** Flood fill on the grid (editor tool). */
export function floodFill(grid: readonly string[], x: number, y: number, value: string): string[] {
  const rows = grid.map((r) => r.split(""));
  const target = rows[y]?.[x];
  if (target === undefined || target === value) return [...grid];
  const stack: [number, number][] = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (rows[cy]?.[cx] !== target) continue;
    rows[cy]![cx] = value;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return rows.map((r) => r.join(""));
}
