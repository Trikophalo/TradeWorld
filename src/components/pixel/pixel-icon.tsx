import { cn } from "@/lib/utils";

/** One row per string, one character per pixel. "." is transparent. */
export type PixelGrid = readonly string[];
/** Maps a grid character to any CSS colour, including `var(--token)` and `currentColor`. */
export type PixelPalette = Readonly<Record<string, string>>;

export interface PixelArt {
  grid: PixelGrid;
  palette: PixelPalette;
}

export interface PixelIconProps extends PixelArt {
  /**
   * Edge length of one art pixel in CSS pixels. Must be a whole number:
   * pixel art is only ever scaled by integer factors.
   */
  scale?: number;
  /** Accessible name. Omit for decorative icons. */
  title?: string;
  className?: string;
}

/**
 * Builds one SVG path per colour, merging horizontal runs, so even a 24×24
 * icon renders as a handful of DOM nodes.
 */
export function buildPixelPaths(grid: PixelGrid, palette: PixelPalette): { color: string; d: string }[] {
  const segments = new Map<string, string[]>();
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const char = row[x]!;
      const color = palette[char];
      let end = x + 1;
      while (end < row.length && row[end] === char) end++;
      if (color) {
        const list = segments.get(color) ?? [];
        list.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
        segments.set(color, list);
      }
      x = end;
    }
  });
  return [...segments].map(([color, parts]) => ({ color, d: parts.join("") }));
}

export function PixelIcon({ grid, palette, scale = 2, title, className }: PixelIconProps) {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const pixel = Math.max(1, Math.round(scale));

  return (
    <svg
      width={width * pixel}
      height={height * pixel}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn("shrink-0 pixelated", className)}
    >
      {buildPixelPaths(grid, palette).map(({ color, d }) => (
        <path key={color} d={d} fill={color} />
      ))}
    </svg>
  );
}
