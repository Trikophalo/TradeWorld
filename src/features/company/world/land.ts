/*
 * The pixel world map (ADR-208): continents as rough outlines (lon/lat), rasterized once into a coarse grid. The map
 * shows 80°N to 60°S like src/config/countries.ts (map positions in percent of width and height). Game styled, not
 * a geographic reference. Pure.
 */
import type { PixelArt } from "@/components/pixel/pixel-icon";

export const MAP_COLS = 90;
export const MAP_ROWS = 35;
const LAT_TOP = 80;
const LAT_SPAN = 140;

type Ring = readonly (readonly [number, number])[];

const LAND: readonly Ring[] = [
  // North America
  [
    [-168, 66],
    [-162, 70],
    [-140, 70],
    [-125, 72],
    [-95, 74],
    [-80, 72],
    [-65, 62],
    [-55, 52],
    [-67, 45],
    [-75, 38],
    [-81, 30],
    [-80, 25],
    [-90, 29],
    [-97, 26],
    [-97, 20],
    [-90, 16],
    [-83, 9],
    [-78, 8],
    [-86, 14],
    [-105, 20],
    [-112, 30],
    [-117, 33],
    [-124, 40],
    [-124, 48],
    [-135, 58],
    [-150, 60],
    [-165, 60],
  ],
  // Greenland
  [
    [-55, 60],
    [-45, 60],
    [-20, 70],
    [-20, 80],
    [-60, 80],
    [-70, 76],
    [-55, 68],
  ],
  // South America
  [
    [-80, 9],
    [-72, 12],
    [-60, 10],
    [-50, 0],
    [-35, -5],
    [-38, -15],
    [-48, -26],
    [-58, -38],
    [-65, -55],
    [-72, -50],
    [-74, -40],
    [-71, -20],
    [-81, -5],
  ],
  // Europe
  [
    [-10, 36],
    [-9, 43],
    [-2, 44],
    [-5, 48],
    [0, 50],
    [5, 53],
    [8, 57],
    [5, 62],
    [15, 69],
    [28, 71],
    [40, 68],
    [60, 70],
    [60, 50],
    [50, 45],
    [40, 41],
    [28, 41],
    [26, 38],
    [22, 36],
    [15, 38],
    [12, 44],
    [8, 44],
    [3, 42],
    [-5, 36],
  ],
  // Great Britain and Ireland
  [
    [-6, 50],
    [2, 51],
    [0, 54],
    [-2, 59],
    [-6, 58],
    [-5, 54],
  ],
  [
    [-10, 51],
    [-6, 51],
    [-6, 55],
    [-10, 55],
  ],
  // Africa
  [
    [-17, 21],
    [-10, 30],
    [-5, 36],
    [10, 37],
    [20, 32],
    [32, 31],
    [35, 28],
    [43, 12],
    [51, 12],
    [40, -2],
    [40, -15],
    [35, -25],
    [28, -34],
    [18, -35],
    [12, -18],
    [13, -5],
    [9, 4],
    [-8, 4],
    [-17, 14],
  ],
  [
    [44, -25],
    [47, -25],
    [50, -15],
    [49, -12],
    [44, -17],
  ],
  // Asia
  [
    [26, 41],
    [36, 36],
    [35, 30],
    [43, 13],
    [52, 16],
    [58, 23],
    [57, 26],
    [50, 30],
    [62, 25],
    [67, 25],
    [73, 20],
    [77, 8],
    [80, 15],
    [88, 22],
    [92, 22],
    [98, 16],
    [100, 7],
    [104, 1],
    [104, 10],
    [109, 12],
    [108, 21],
    [118, 24],
    [122, 30],
    [121, 37],
    [125, 40],
    [129, 35],
    [130, 43],
    [142, 47],
    [141, 53],
    [156, 59],
    [162, 60],
    [180, 66],
    [180, 72],
    [140, 74],
    [110, 78],
    [80, 74],
    [60, 70],
    [60, 50],
    [50, 45],
    [40, 41],
  ],
  // Japan
  [
    [130, 31],
    [141, 35],
    [142, 40],
    [145, 44],
    [141, 45],
    [139, 40],
    [135, 34],
  ],
  // Indonesia and New Guinea
  [
    [95, 5],
    [106, -6],
    [115, -8],
    [120, -9],
    [141, -8],
    [150, -10],
    [140, -3],
    [130, -2],
    [125, 1],
    [119, -5],
    [117, 7],
    [109, 1],
    [103, -1],
  ],
  // Australia and New Zealand
  [
    [114, -22],
    [122, -18],
    [130, -12],
    [137, -12],
    [142, -11],
    [146, -19],
    [153, -25],
    [151, -34],
    [144, -38],
    [138, -35],
    [130, -32],
    [115, -34],
  ],
  [
    [166, -46],
    [174, -41],
    [178, -38],
    [173, -35],
    [172, -41],
    [168, -46],
  ],
];

function inside(ring: Ring, lon: number, lat: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Map cell of a position in percent (as countries.ts `map`). */
export function cellOf(map: { x: number; y: number }): { col: number; row: number } {
  return {
    col: Math.min(MAP_COLS - 1, Math.max(0, Math.floor((map.x / 100) * MAP_COLS))),
    row: Math.min(MAP_ROWS - 1, Math.max(0, Math.floor((map.y / 100) * MAP_ROWS))),
  };
}

/** One row per string: "#" land, "." sea. */
export const LAND_GRID: readonly string[] = Array.from({ length: MAP_ROWS }, (_, row) =>
  Array.from({ length: MAP_COLS }, (_, col) => {
    const lon = -180 + ((col + 0.5) / MAP_COLS) * 360;
    const lat = LAT_TOP - ((row + 0.5) / MAP_ROWS) * LAT_SPAN;
    return LAND.some((ring) => inside(ring, lon, lat)) ? "#" : ".";
  }).join(""),
);

/**
 * The map as pixel art: sea, land with a lighter coast, and the cells of the given countries highlighted. Colors are
 * design tokens (the map follows light and dark mode).
 */
export function worldMapArt(highlight: readonly { x: number; y: number }[] = []): PixelArt {
  const marks = new Set(highlight.map((m) => `${cellOf(m).col}:${cellOf(m).row}`));
  const grid = LAND_GRID.map((line, row) =>
    [...line]
      .map((c, col) => {
        if (marks.has(`${col}:${row}`)) return "h";
        if (c === "#") {
          const coast = [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0],
          ].some(([dx, dy]) => LAND_GRID[row + dy!]?.[col + dx!] === ".");
          return coast ? "c" : "l";
        }
        return (col + row) % 7 === 0 ? "w" : "s";
      })
      .join(""),
  );
  return {
    grid,
    palette: {
      s: "var(--color-surface-2)",
      w: "var(--color-surface-3)",
      l: "var(--color-gain-soft)",
      c: "var(--color-line-2)",
      h: "var(--color-accent-soft)",
    },
  };
}
