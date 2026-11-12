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
  // Index characters 0-9, then a-f (artworks have up to 16 colours, ADR-080).
  return { grid: logo.grid, palette: Object.fromEntries(logo.palette.map((c, i) => ["0123456789abcdef"[i]!, c])) };
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

// ------------------------------------------------------------------ forbidden symbols (ADR-076)

/**
 * Hate symbols a logo must not show. Each template is a binary pattern ("x" set, "." free) that is matched in
 * every colour of the logo and in the whole drawing, in both mirror images, scaled 1× to 3×. One wrong cell is
 * tolerated, so a single extra pixel does not get a symbol through. Reports stay the second line of defence.
 */
const FORBIDDEN_TEMPLATES: readonly (readonly string[])[] = [
  // Hooked cross, compact.
  ["x.xxx", "x.x..", "xxxxx", "..x.x", "xxx.x"],
  // Hooked cross with long arms.
  ["x..xxxx", "x..x...", "x..x...", "xxxxxxx", "...x..x", "...x..x", "xxxx..x"],
  // Hooked cross with thin gaps.
  ["x...xxxxx", "x...x....", "x...x....", "x...x....", "xxxxxxxxx", "....x...x", "....x...x", "....x...x", "xxxxx...x"],
];

const mirror = (t: readonly string[]) => t.map((row) => row.split("").reverse().join(""));
const rotate = (t: readonly string[]) =>
  t[0]!.split("").map((_, x) =>
    t
      .map((row) => row[x])
      .reverse()
      .join(""),
  );

function variants(template: readonly string[]): string[][] {
  const out: string[][] = [];
  let current = [...template];
  for (let i = 0; i < 4; i++) {
    out.push(current, mirror(current));
    current = rotate(current);
  }
  const seen = new Set<string>();
  return out.filter((v) => (seen.has(v.join("/")) ? false : (seen.add(v.join("/")), true)));
}

const PATTERNS = FORBIDDEN_TEMPLATES.flatMap(variants);

function matches(mask: readonly boolean[][], pattern: readonly string[], scale: number, ox: number, oy: number) {
  let errors = 0;
  for (let ty = 0; ty < pattern.length; ty++) {
    for (let tx = 0; tx < pattern[0]!.length; tx++) {
      const want = pattern[ty]![tx] === "x";
      let set = 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) if (mask[oy + ty * scale + dy]![ox + tx * scale + dx]) set++;
      }
      const ok = want ? set === scale * scale : set === 0;
      if (!ok && ++errors > 1) return false;
    }
  }
  return true;
}

/** A banner: like a logo, but width × height (ADR-078). */
export function isValidBanner(banner: unknown, cfg: StartupsConfig = BALANCE.startups): banner is CompanyLogoData {
  if (!banner || typeof banner !== "object") return false;
  const { palette, grid } = banner as { palette?: unknown; grid?: unknown };
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > cfg.banner.maxColors) return false;
  if (!palette.every((c) => typeof c === "string" && HEX.test(c))) return false;
  if (!Array.isArray(grid) || grid.length !== cfg.banner.height) return false;
  const allowed = new RegExp(`^[.0-${palette.length - 1}]{${cfg.banner.width}}$`);
  return grid.every((row) => typeof row === "string" && allowed.test(row));
}

/** True if the logo (or banner) shows a forbidden symbol (ADR-076). */
export function hasForbiddenSymbol(logo: CompanyLogoData): boolean {
  const height = logo.grid.length;
  const width = logo.grid[0]?.length ?? 0;
  const masks: boolean[][][] = [logo.grid.map((row) => row.split("").map((c) => c !== "."))];
  for (let i = 0; i < logo.palette.length; i++) {
    const ch = "0123456789abcdef"[i]!;
    masks.push(logo.grid.map((row) => row.split("").map((c) => c === ch)));
  }
  for (const mask of masks) {
    for (const pattern of PATTERNS) {
      const h = pattern.length;
      const w = pattern[0]!.length;
      for (let scale = 1; scale * w <= width && scale * h <= height && scale <= 3; scale++) {
        for (let oy = 0; oy + h * scale <= height; oy++) {
          for (let ox = 0; ox + w * scale <= width; ox++) if (matches(mask, pattern, scale, ox, oy)) return true;
        }
      }
    }
  }
  return false;
}
