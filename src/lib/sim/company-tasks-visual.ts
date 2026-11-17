/**
 * Nine drag and see company task games (ADR-186): tiles, bins, untangle, odd, rebuild, align, pipes, sizes and
 * conveyor. Puzzles and grading, mirrored in company_task_puzzle_visual() and company_task_grade_visual() (migration
 * 20261204007600). The server is the authority; this runs the demo and the tests. Pure: randomness comes in as `rng`
 * (0 <= x < 1).
 */
import type { COMPANY_TASK_RULES } from "../../config/company-tasks.ts";

type Rules = typeof COMPANY_TASK_RULES;

export const VISUAL_TASK_GAMES = [
  "tiles",
  "bins",
  "untangle",
  "odd",
  "rebuild",
  "align",
  "pipes",
  "sizes",
  "conveyor",
] as const;
export type VisualTaskGame = (typeof VISUAL_TASK_GAMES)[number];

export type Point = [number, number];

export type VisualPuzzle =
  | { size: number; board: number[] }
  | { items: Point[]; by: number; kinds: number }
  | { grid: number; edges: Point[]; points: Point[] }
  | { rounds: number[][] }
  | { size: number; layout: number[]; show_seconds: number }
  | { slots: number[]; parts: number[] }
  | { size: number; tiles: number[]; turns: number[]; from: number; to: number }
  | { sizes: number[] }
  | { items: number[]; every_ms: number; travel_ms: number };

export type VisualSolution =
  | { size: number; board: number[]; max_moves: number }
  | { bins: number[] }
  | { grid: number; edges: Point[]; step_bps: number; untangled: Point[] }
  | { choices: number[] }
  | { layout: number[] }
  | { at: number[] }
  | { size: number; tiles: number[]; from: number; to: number; path: number[]; need: number[]; open_bps: number }
  | { order: number[] }
  | { bins: number[]; scoring: "net" };

const between = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

function shuffled<T>(list: readonly T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

// ---------------------------------------------------------------------------
// tiles: a sliding puzzle; the gap is -1, solved means board[i] = i for every tile
// ---------------------------------------------------------------------------

/** Cells next to `cell` on a size x size board (up, down, left, right). */
export function neighbours(size: number, cell: number): number[] {
  const r = Math.floor(cell / size);
  const c = cell % size;
  const out: number[] = [];
  if (r > 0) out.push(cell - size);
  if (r < size - 1) out.push(cell + size);
  if (c > 0) out.push(cell - 1);
  if (c < size - 1) out.push(cell + 1);
  return out;
}

/** Tiles on their own cell (the gap does not count). */
export function tilesInPlace(board: readonly number[]): number {
  return board.filter((v, i) => v === i).length;
}

/** Replays slides (each the cell of a tile next to the gap); null when one is not allowed. */
export function slideTiles(size: number, board: readonly number[], moves: readonly unknown[]): number[] | null {
  const out = [...board];
  let gap = out.indexOf(-1);
  for (const m of moves) {
    if (!isInt(m) || m < 0 || m >= size * size || !neighbours(size, gap).includes(m)) return null;
    out[gap] = out[m]!;
    out[m] = -1;
    gap = m;
  }
  return out;
}

// ---------------------------------------------------------------------------
// untangle: cables between nodes on a grid; no two cables without a common node may touch
// ---------------------------------------------------------------------------

const orient = (a: Point, b: Point, c: Point) =>
  Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const onSegment = (a: Point, b: Point, c: Point) =>
  Math.min(a[0], b[0]) <= c[0] &&
  c[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= c[1] &&
  c[1] <= Math.max(a[1], b[1]);

/** Whether the segments p1-p2 and q1-q2 meet (crossing, touching or overlapping), integer exact. */
export function segmentsMeet(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = orient(p1, p2, q1);
  const d2 = orient(p1, p2, q2);
  const d3 = orient(q1, q2, p1);
  const d4 = orient(q1, q2, p2);
  if (d1 !== d2 && d3 !== d4) return true;
  if (d1 === 0 && onSegment(p1, p2, q1)) return true;
  if (d2 === 0 && onSegment(p1, p2, q2)) return true;
  if (d3 === 0 && onSegment(q1, q2, p1)) return true;
  if (d4 === 0 && onSegment(q1, q2, p2)) return true;
  return false;
}

/** Pairs of cables without a common node that meet. */
export function crossings(edges: readonly Point[], points: readonly Point[]): number {
  let n = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i]!;
      const [c, d] = edges[j]!;
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsMeet(points[a]!, points[b]!, points[c]!, points[d]!)) n += 1;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// pipes: openings as bits N 1, E 2, S 4, W 8; turning clockwise shifts them left
// ---------------------------------------------------------------------------

/** Openings of a straight (0) or corner (1) pipe at rotation 0. */
export const PIPE_BASE = [5, 3] as const;

export function turnMask(mask: number, turns: number): number {
  const r = ((turns % 4) + 4) % 4;
  return ((mask << r) | (mask >> (4 - r))) & 15;
}

/** Cells the water reaches from the left edge at row `from` (in the order it gets there). */
export function pipesFlow(size: number, tiles: readonly number[], turns: readonly number[], from: number): number[] {
  const open = tiles.map((t, i) => turnMask(PIPE_BASE[t === 1 ? 1 : 0], turns[i] ?? 0));
  const startCell = from * size;
  if (!(open[startCell]! & 8)) return [];
  const seen = new Set([startCell]);
  const queue = [startCell];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const r = Math.floor(cell / size);
    const c = cell % size;
    const steps: [number, number, number][] = [
      [1, r > 0 ? cell - size : -1, 4],
      [2, c < size - 1 ? cell + 1 : -1, 8],
      [4, r < size - 1 ? cell + size : -1, 1],
      [8, c > 0 ? cell - 1 : -1, 2],
    ];
    for (const [dir, next, back] of steps) {
      if (next < 0 || seen.has(next) || !(open[cell]! & dir) || !(open[next]! & back)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return queue;
}

/** Whether water flows from the left edge at row `from` to the right edge at row `to`. */
export function pipesConnected(
  size: number,
  tiles: readonly number[],
  turns: readonly number[],
  from: number,
  to: number,
): boolean {
  const sink = to * size + size - 1;
  return (
    pipesFlow(size, tiles, turns, from).includes(sink) &&
    (turnMask(PIPE_BASE[tiles[sink] === 1 ? 1 : 0], turns[sink] ?? 0) & 2) !== 0
  );
}

/** A route column by column from the left edge (row from) to the right edge (row to), and the openings it needs. */
export function pipeRoute(size: number, rows: readonly number[], from: number, to: number) {
  const path: number[] = [];
  let r = from;
  for (let c = 0; c < size; c++) {
    const goal = c === size - 1 ? to : rows[c]!;
    const dir = goal >= r ? 1 : -1;
    for (let row = r; ; row += dir) {
      path.push(row * size + c);
      if (row === goal) break;
    }
    r = goal;
  }
  const dirTo = (a: number, b: number) => (b === a - size ? 1 : b === a + 1 ? 2 : b === a + size ? 4 : 8);
  const need = path.map((cell, i) => {
    const entry = i === 0 ? 8 : dirTo(cell, path[i - 1]!);
    const exit = i === path.length - 1 ? 2 : dirTo(cell, path[i + 1]!);
    return entry | exit;
  });
  return { path, need };
}

// ---------------------------------------------------------------------------

export function generateVisual(
  game: VisualTaskGame,
  rng: () => number,
  rules: Rules,
): { puzzle: VisualPuzzle; solution: VisualSolution } {
  const g = rules.games;
  switch (game) {
    case "tiles": {
      const c = g.tiles;
      const n = c.size * c.size;
      let board: number[] = [];
      for (let attempt = 0; attempt < 20; attempt++) {
        board = Array.from({ length: n }, (_, i) => (i < n - 1 ? i : -1));
        let gap = n - 1;
        let prev = -1;
        for (let k = 0; k < c.scramble; k++) {
          // never straight back, so the moves do not undo each other
          const options = neighbours(c.size, gap).filter((x) => x !== prev);
          const m = options[Math.floor(rng() * options.length)]!;
          board[gap] = board[m]!;
          board[m] = -1;
          prev = gap;
          gap = m;
        }
        if (n - 1 - tilesInPlace(board) >= c.minWrong) break;
      }
      return { puzzle: { size: c.size, board }, solution: { size: c.size, board, max_moves: c.maxMoves } };
    }
    case "bins": {
      const c = g.bins;
      const items = Array.from(
        { length: c.items },
        () => [between(rng, 0, c.kinds - 1), between(rng, 0, c.kinds - 1)] as Point,
      );
      const by = between(rng, 0, 1);
      return { puzzle: { items, by, kinds: c.kinds }, solution: { bins: items.map((it) => it[by]!) } };
    }
    case "untangle": {
      const c = g.untangle;
      let points: Point[] = [];
      let edges: Point[] = [];
      for (let attempt = 0; attempt < 40; attempt++) {
        const cells = shuffled(
          Array.from({ length: c.grid * c.grid }, (_, i) => i),
          rng,
        ).slice(0, c.nodes);
        points = cells.map((cell) => [cell % c.grid, Math.floor(cell / c.grid)] as Point);
        // a ring in angle order around the middle is a simple polygon, so nothing crosses
        const cx = points.reduce((s, p) => s + p[0], 0) / c.nodes;
        const cy = points.reduce((s, p) => s + p[1], 0) / c.nodes;
        const ring = points
          .map((p, i) => ({ i, a: Math.atan2(p[1] - cy, p[0] - cx) }))
          .sort((x, y) => x.a - y.a || x.i - y.i)
          .map((x) => x.i);
        edges = ring.map((a, k) => [a, ring[(k + 1) % ring.length]!] as Point);
        if (crossings(edges, points) > 0) continue;
        for (let k = 0, added = 0; k < 30 && added < c.chords; k++) {
          const a = between(rng, 0, c.nodes - 1);
          const b = between(rng, 0, c.nodes - 1);
          if (a === b || edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue;
          const next = [...edges, [a, b] as Point];
          if (crossings(next, points) === 0) {
            edges = next;
            added += 1;
          }
        }
        break;
      }
      // the nodes swap places until enough cables cross
      let start = points;
      for (let k = 0; k < 40; k++) {
        start = shuffled(points, rng);
        if (crossings(edges, start) >= c.minCrossings) break;
      }
      return {
        puzzle: { grid: c.grid, edges, points: start },
        // untangled: the layout the nodes were swapped from, one answer without crossings (tests, never shown)
        solution: { grid: c.grid, edges, step_bps: c.stepBps, untangled: points },
      };
    }
    case "odd": {
      const c = g.odd;
      const rounds: number[][] = [];
      const choices: number[] = [];
      for (let r = 0; r < c.rounds; r++) {
        const kind = between(rng, 0, c.kinds - 1);
        const at = between(rng, 0, c.cells - 1);
        const flaw = between(rng, 1, c.flaws);
        rounds.push(Array.from({ length: c.cells }, (_, i) => kind * 4 + (i === at ? flaw : 0)));
        choices.push(at);
      }
      return { puzzle: { rounds }, solution: { choices } };
    }
    case "rebuild": {
      const c = g.rebuild;
      const cells = shuffled(
        Array.from({ length: c.size * c.size }, (_, i) => i),
        rng,
      ).slice(0, c.items);
      const layout = Array.from({ length: c.size * c.size }, (_, i) => cells.indexOf(i));
      return {
        puzzle: { size: c.size, layout, show_seconds: c.showSeconds },
        solution: { layout },
      };
    }
    case "align": {
      const c = g.align;
      const kinds = shuffled(
        Array.from({ length: c.kinds }, (_, i) => i),
        rng,
      );
      const parts = kinds.slice(0, c.parts);
      const slots = shuffled(kinds.slice(0, c.slots), rng);
      return { puzzle: { slots, parts }, solution: { at: parts.map((k) => slots.indexOf(k)) } };
    }
    case "pipes": {
      const c = g.pipes;
      const n = c.size * c.size;
      const from = between(rng, 0, c.size - 1);
      const to = between(rng, 0, c.size - 1);
      const rows = Array.from({ length: c.size }, () => between(rng, 0, c.size - 1));
      const { path, need } = pipeRoute(c.size, rows, from, to);
      const tiles = Array.from({ length: n }, (_, i) => {
        const k = path.indexOf(i);
        if (k < 0) return between(rng, 0, 1);
        return need[k] === 5 || need[k] === 10 ? 0 : 1;
      });
      const right = (i: number, turn: number) => turnMask(PIPE_BASE[tiles[i]!]!, turn) === need[path.indexOf(i)];
      let turns: number[] = [];
      for (let attempt = 0; attempt < 20; attempt++) {
        turns = Array.from({ length: n }, () => between(rng, 0, 3));
        // at least minWrong pipes of the route point the wrong way
        for (const cell of path) {
          if (path.filter((x) => !right(x, turns[x]!)).length >= Math.min(c.minWrong, path.length)) break;
          if (right(cell, turns[cell]!)) turns[cell] = (turns[cell]! + 1) % 4;
        }
        if (!pipesConnected(c.size, tiles, turns, from, to)) break;
      }
      return {
        puzzle: { size: c.size, tiles, turns, from, to },
        solution: { size: c.size, tiles, from, to, path, need, open_bps: c.openBps },
      };
    }
    case "sizes": {
      const c = g.sizes;
      let sizes: number[] = [];
      for (let attempt = 0; attempt < 50; attempt++) {
        sizes = Array.from({ length: c.items }, () => between(rng, c.min, c.max));
        const sorted = [...sizes].sort((x, y) => x - y);
        if (sorted.every((v, i) => i === 0 || v - sorted[i - 1]! >= c.minGap)) break;
        sizes = [];
      }
      if (sizes.length === 0) {
        // fallback: evenly spread, shuffled
        sizes = shuffled(
          Array.from({ length: c.items }, (_, i) => c.min + i * c.minGap),
          rng,
        );
      }
      const order = sizes
        .map((v, i) => ({ v, i }))
        .sort((x, y) => x.v - y.v)
        .map((x) => x.i);
      return { puzzle: { sizes }, solution: { order } };
    }
    case "conveyor": {
      const c = g.conveyor;
      const items = Array.from({ length: c.items }, () => between(rng, 0, c.kinds - 1));
      return {
        puzzle: { items, every_ms: c.everyMs, travel_ms: c.travelMs },
        solution: { bins: items, scoring: "net" },
      };
    }
  }
}

/** Share of positions where the answer equals the solution. */
function share(want: readonly number[], got: unknown): number {
  if (!Array.isArray(got)) return 0;
  const hits = want.filter((w, i) => (got as unknown[])[i] === w).length;
  return Math.trunc((hits * 10_000) / Math.max(want.length, 1));
}

/** Score in bps (0..10 000), same rules as the server. */
export function gradeVisual(game: VisualTaskGame, solution: VisualSolution, answer: unknown): number {
  if (!answer || typeof answer !== "object") return 0;
  const ans = answer as Record<string, unknown>;
  switch (game) {
    case "tiles": {
      // replay the slides; every tile on its own cell counts
      const sol = solution as { size: number; board: number[]; max_moves: number };
      if (!Array.isArray(ans.moves) || ans.moves.length > sol.max_moves) return 0;
      const end = slideTiles(sol.size, sol.board, ans.moves as unknown[]);
      if (!end) return 0;
      return Math.trunc((tilesInPlace(end) * 10_000) / Math.max(sol.board.length - 1, 1));
    }
    case "bins":
    case "odd":
    case "align":
    case "sizes": {
      const key = game === "bins" ? "bins" : game === "odd" ? "choices" : game === "align" ? "at" : "order";
      const want = (solution as Record<string, number[]>)[key]!;
      return share(want, ans[key]);
    }
    case "untangle": {
      // every node on its own grid point; every pair of cables that meets costs step_bps
      const sol = solution as { grid: number; edges: Point[]; step_bps: number };
      const nodes = 1 + Math.max(...sol.edges.flat());
      if (!Array.isArray(ans.points) || ans.points.length !== nodes) return 0;
      const pts = ans.points as unknown[];
      const ok = pts.every(
        (p) => Array.isArray(p) && p.length === 2 && p.every((v) => isInt(v) && v >= 0 && v < sol.grid),
      );
      if (!ok) return 0;
      const points = pts as Point[];
      if (new Set(points.map((p) => p[1] * sol.grid + p[0])).size !== points.length) return 0;
      return Math.max(0, 10_000 - crossings(sol.edges, points) * sol.step_bps);
    }
    case "rebuild": {
      // each good at most once; the share of goods on their cell counts
      const want = (solution as { layout: number[] }).layout;
      if (!Array.isArray(ans.layout) || ans.layout.length !== want.length) return 0;
      const got = ans.layout as unknown[];
      const items = want.filter((v) => v >= 0).length;
      if (!got.every((v) => isInt(v) && v >= -1 && v < items)) return 0;
      const placed = (got as number[]).filter((v) => v >= 0);
      if (new Set(placed).size !== placed.length) return 0;
      const hits = want.filter((v, i) => v >= 0 && got[i] === v).length;
      return Math.trunc((hits * 10_000) / Math.max(items, 1));
    }
    case "pipes": {
      // connected: full marks; else the share of the route's pipes that point right, times open_bps
      const sol = solution as {
        size: number;
        tiles: number[];
        from: number;
        to: number;
        path: number[];
        need: number[];
        open_bps: number;
      };
      if (!Array.isArray(ans.turns) || ans.turns.length !== sol.tiles.length) return 0;
      const got = ans.turns as unknown[];
      if (!got.every((v) => isInt(v) && v >= 0 && v <= 3)) return 0;
      const turns = got as number[];
      if (pipesConnected(sol.size, sol.tiles, turns, sol.from, sol.to)) return 10_000;
      const right = sol.path.filter(
        (cell, k) => turnMask(PIPE_BASE[sol.tiles[cell]!]!, turns[cell]!) === sol.need[k],
      ).length;
      return Math.trunc((Math.trunc((right * 10_000) / Math.max(sol.path.length, 1)) * sol.open_bps) / 10_000);
    }
    case "conveyor": {
      // right bins minus wrong bins; a missed item (-1) counts neither way
      const want = (solution as { bins: number[] }).bins;
      if (!Array.isArray(ans.bins)) return 0;
      const got = ans.bins as unknown[];
      let net = 0;
      want.forEach((w, i) => {
        const v = got[i];
        if (!isInt(v) || v < 0) return;
        net += v === w ? 1 : -1;
      });
      return Math.max(0, Math.trunc((net * 10_000) / Math.max(want.length, 1)));
    }
  }
}
