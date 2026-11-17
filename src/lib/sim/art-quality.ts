/**
 * Art quality (ADR-181): a deterministic critic's score 0..100 for a pixel artwork, from its grid alone. Integer
 * arithmetic only, so the database computes exactly the same (public.art_quality in
 * supabase/migrations/20261204007000_nft_quality.sql); shared cases in supabase/tests/art_quality_cases.inc.
 */
import { BALANCE } from "../../config/balance.ts";

type QualityConfig = typeof BALANCE.nfts.quality;

export interface ArtGrid {
  readonly palette: readonly string[];
  readonly grid: readonly string[];
}

export const ART_QUALITY_KEYS = [
  "coverage",
  "colours",
  "harmony",
  "contrast",
  "structure",
  "outline",
  "composition",
  "detail",
  "shapes",
] as const;
export type ArtQualityKey = (typeof ART_QUALITY_KEYS)[number];

export type ArtCopy = "exact" | "near" | null;

export interface ArtQuality {
  readonly score: number;
  readonly sub: Readonly<Record<ArtQualityKey, number>>;
  readonly copy: ArtCopy;
}

const INDEX = "0123456789abcdef";

interface Parsed {
  readonly size: number;
  /** Per cell: -1 empty, else a colour id (equal hex values share an id). */
  readonly cells: Int32Array;
  readonly rgb: readonly (readonly [number, number, number])[];
}

function parse(art: ArtGrid): Parsed {
  const size = art.grid.length;
  const idOf: number[] = [];
  const rgb: [number, number, number][] = [];
  const seen = new Map<string, number>();
  for (const hex of art.palette) {
    const key = hex.toLowerCase();
    let id = seen.get(key);
    if (id === undefined) {
      id = rgb.length;
      seen.set(key, id);
      rgb.push([parseInt(key.slice(1, 3), 16), parseInt(key.slice(3, 5), 16), parseInt(key.slice(5, 7), 16)]);
    }
    idOf.push(id);
  }
  const cells = new Int32Array(size * size).fill(-1);
  for (let y = 0; y < size; y++) {
    const row = art.grid[y] ?? "";
    for (let x = 0; x < size; x++) {
      const i = INDEX.indexOf(row[x] ?? ".");
      if (i >= 0 && i < idOf.length) cells[y * size + x] = idOf[i]!;
    }
  }
  return { size, cells, rgb };
}

/** Luminance 0..255 (integer). */
function luma([r, g, b]: readonly [number, number, number]): number {
  return Math.floor((299 * r + 587 * g + 114 * b) / 1000);
}

/** Hue bucket 0..11 (30 degrees each) of a saturated colour, or -1 for greys and very dark colours. */
export function hueBucket([r, g, b]: readonly [number, number, number], chromaMinPct: number): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (mx === 0 || d === 0) return -1;
  if (Math.floor((d * 100) / mx) < chromaMinPct || Math.floor((mx * 100) / 255) < chromaMinPct) return -1;
  let h: number;
  if (mx === r) h = Math.floor((60 * (g - b) + 360 * d) / d);
  else if (mx === g) h = Math.floor((60 * (b - r) + 120 * d) / d);
  else h = Math.floor((60 * (r - g) + 240 * d) / d);
  return Math.floor((h % 360) / 30);
}

/**
 * Signature for copy detection: the grid with colours renamed in order of first appearance ("." empty, then
 * a, b, c ...), so a recoloured copy has the same signature.
 */
export function artSignature(art: ArtGrid): string {
  const { cells } = parse(art);
  const names = new Map<number, string>();
  let out = "";
  for (const c of cells) {
    if (c < 0) {
      out += ".";
      continue;
    }
    let n = names.get(c);
    if (n === undefined) {
      n = "abcdefghijklmnop"[names.size]!;
      names.set(c, n);
    }
    out += n;
  }
  return out;
}

/** Is the signature a copy of one of the older ones: exact, near (few pixels differ) or none. */
export function artCopyKind(
  signature: string,
  older: readonly string[],
  cfg: QualityConfig = BALANCE.nfts.quality,
): ArtCopy {
  const drawn = signature.replace(/\./g, "").length;
  const limit = Math.floor((signature.length * cfg.nearCopyPct) / 100);
  let near = false;
  for (const o of older) {
    if (o.length !== signature.length) continue;
    if (o === signature) return "exact";
    if (Math.abs(o.replace(/\./g, "").length - drawn) > limit) continue;
    let diff = 0;
    for (let i = 0; i < o.length && diff <= limit; i++) if (o[i] !== signature[i]) diff++;
    if (diff <= limit) near = true;
  }
  return near ? "near" : null;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** The critic's score with its sub-scores; copy says whether the grid copies an older NFT (caps the score). */
export function artQuality(art: ArtGrid, copy: ArtCopy = null, cfg: QualityConfig = BALANCE.nfts.quality): ArtQuality {
  const { size, cells, rgb } = parse(art);
  const n = size * size;
  const counts = new Map<number, number>();
  let drawn = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const c = cells[i]!;
    counts.set(c, (counts.get(c) ?? 0) + 1);
    if (c >= 0) {
      drawn++;
      sx += i % size;
      sy += Math.floor(i / size);
    }
  }
  const zero = Object.fromEntries(ART_QUALITY_KEYS.map((k) => [k, 0])) as Record<ArtQualityKey, number>;
  if (drawn === 0 || size < 2) return { score: 0, sub: zero, copy };

  // coverage
  let coverage = Math.min(100, Math.floor((drawn * 10_000) / (n * cfg.coverageMinPct)));
  const dom = Math.floor((Math.max(...counts.values()) * 100) / n);
  if (dom > cfg.dominanceMaxPct) coverage = Math.min(coverage, (100 - dom) * 10);

  // colours
  const used = [...counts.keys()].filter((c) => c >= 0).sort((a, b) => a - b);
  const k = used.length;
  const table = cfg.colourScores;
  const stray = used.filter((c) => counts.get(c)! * 100 < drawn * cfg.strayPct).length;
  const colours = clamp(table[Math.min(k, table.length - 1)]! - stray * cfg.strayPenalty);

  // harmony
  const buckets = new Set(used.map((c) => hueBucket(rgb[c]!, cfg.chromaMinPct)).filter((b) => b >= 0));
  const harmony =
    buckets.size <= cfg.hueBuckets
      ? 100
      : Math.max(cfg.hueFloor, 100 - (buckets.size - cfg.hueBuckets) * cfg.huePenalty);

  // contrast
  const lum = used.map((c) => luma(rgb[c]!));
  const minL = Math.min(...lum);
  const maxL = Math.max(...lum);
  const contrast = Math.min(100, Math.floor(((maxL - minL) * 100) / cfg.contrastFull));

  // neighbours: same-coloured count, boundary to empty, transitions
  let isolated = 0;
  let solid = 0;
  let boundary = 0;
  let darkBoundary = 0;
  const threshold = minL + Math.floor((maxL - minL) / 3);
  let transitions = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const c = cells[i]!;
      if (x + 1 < size && cells[i + 1] !== c) transitions++;
      if (y + 1 < size && cells[i + size] !== c) transitions++;
      if (c < 0) continue;
      let same = 0;
      let empty = false;
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const o = cells[ny * size + nx]!;
        if (o === c) same++;
        else if (o < 0) empty = true;
      }
      if (same === 0) isolated++;
      if (same >= 3) solid++;
      if (empty) {
        boundary++;
        if (luma(rgb[c]!) <= threshold) darkBoundary++;
      }
    }
  }

  // regions: 4-connected, same colour
  const seen = new Uint8Array(n);
  let regions = 0;
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (cells[i]! < 0 || seen[i]) continue;
    regions++;
    seen[i] = 1;
    stack.push(i);
    while (stack.length > 0) {
      const j = stack.pop()!;
      const x = j % size;
      const y = Math.floor(j / size);
      const nb = [x > 0 ? j - 1 : -1, x + 1 < size ? j + 1 : -1, y > 0 ? j - size : -1, y + 1 < size ? j + size : -1];
      for (const m of nb) {
        if (m >= 0 && !seen[m] && cells[m] === cells[j]) {
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
  }
  const noise = Math.floor((isolated * 100) / drawn);
  const noiseScore = noise <= cfg.noiseFreePct ? 100 : Math.max(0, 100 - (noise - cfg.noiseFreePct) * 2);
  const frag = Math.floor((regions * 100) / drawn);
  const fragScore = frag <= cfg.fragmentFreePct ? 100 : Math.max(0, 100 - (frag - cfg.fragmentFreePct) * 2);
  const structure = Math.floor((noiseScore + fragScore) / 2);

  const outline = k < 2 ? 40 : boundary === 0 ? 70 : 40 + Math.floor((darkBoundary * 60) / boundary);

  // composition: balance of the centre of mass, mirror symmetry
  const dx = Math.floor((Math.abs(2 * sx - (size - 1) * drawn) * 100) / (drawn * size));
  const dy = Math.floor((Math.abs(2 * sy - (size - 1) * drawn) * 100) / (drawn * size));
  const off = dx + dy;
  const balance = off <= cfg.balanceFreePct ? 100 : Math.max(0, 100 - (off - cfg.balanceFreePct) * 3);
  let pairsH = 0;
  let matchH = 0;
  let pairsV = 0;
  let matchV = 0;
  const half = Math.floor(size / 2);
  for (let a = 0; a < size; a++) {
    for (let b = 0; b < half; b++) {
      const l = cells[a * size + b]!;
      const r = cells[a * size + size - 1 - b]!;
      if (l >= 0 || r >= 0) {
        pairsH++;
        if (l === r) matchH++;
      }
      const t = cells[b * size + a]!;
      const u = cells[(size - 1 - b) * size + a]!;
      if (t >= 0 || u >= 0) {
        pairsV++;
        if (t === u) matchV++;
      }
    }
  }
  const sym = Math.max(
    pairsH === 0 ? 0 : Math.floor((matchH * 100) / pairsH),
    pairsV === 0 ? 0 : Math.floor((matchV * 100) / pairsV),
  );
  const composition = Math.floor((balance * 2 + sym) / 3);

  const e = Math.floor((transitions * 1000) / (2 * size * (size - 1)));
  const detail =
    e < cfg.detailMin
      ? Math.floor((e * 100) / cfg.detailMin)
      : e <= cfg.detailMax
        ? 100
        : Math.max(0, 100 - Math.floor((e - cfg.detailMax) / 4));

  const shapes = Math.min(100, Math.floor((solid * 10_000) / (drawn * cfg.shapeFullPct)));

  const sub: Record<ArtQualityKey, number> = {
    coverage,
    colours,
    harmony,
    contrast,
    structure,
    outline,
    composition,
    detail,
    shapes,
  };
  let sumW = 0;
  let sum = 0;
  for (const key of ART_QUALITY_KEYS) {
    sumW += cfg.weights[key];
    sum += cfg.weights[key] * sub[key];
  }
  const weighted = Math.floor(sum / sumW);
  const gate = Math.min(coverage, colours, detail);
  let score = Math.floor((weighted * (cfg.gateBase * 100 + gate * (100 - cfg.gateBase))) / 10_000);
  if (copy === "exact") score = Math.min(score, cfg.copyCap);
  else if (copy === "near") score = Math.min(score, cfg.nearCopyCap);
  return { score, sub, copy };
}

/** The strongest and the weakest sub-score (first in ART_QUALITY_KEYS order on ties). */
export function artQualityExtremes(sub: Readonly<Record<ArtQualityKey, number>>): {
  best: ArtQualityKey;
  worst: ArtQualityKey;
} {
  let best: ArtQualityKey = ART_QUALITY_KEYS[0];
  let worst: ArtQualityKey = ART_QUALITY_KEYS[0];
  for (const key of ART_QUALITY_KEYS) {
    if (sub[key] > sub[best]) best = key;
    if (sub[key] < sub[worst]) worst = key;
  }
  return { best, worst };
}
