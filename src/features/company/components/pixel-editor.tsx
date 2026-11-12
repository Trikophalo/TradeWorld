"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { haptic } from "@/lib/haptics";
import { floodFill, logoArt, type CompanyLogoData } from "@/lib/sim/logo";
import { cn } from "@/lib/utils";

/** Palette index as one character: 0-9, then a-f for artworks with up to 16 colours. */
const IDX = "0123456789abcdef";
/** Colours to start from (data, like the company colours). */
const SWATCHES = [
  "#111318",
  "#ffffff",
  "#ffd15c",
  "#ff9a52",
  "#ff6170",
  "#c03fb8",
  "#8f7bff",
  "#4f8cff",
  "#62e0ff",
  "#2fd98c",
  "#9a6b3c",
  "#8f9bb3",
];
export type PixelTool = "pen" | "eraser" | "fill" | "line";
type Cell = { x: number; y: number };

/** Every cell on the straight line between two cells (Bresenham), so fast strokes leave no gaps. */
export function cellsBetween(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  let { x, y } = a;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * The pixel editor for logo and banner (ADR-079): a big board in the middle, tools on the side.
 * Hold the left button and move to paint, the right button erases; Ctrl+Z undoes.
 */
export function PixelEditor({
  width,
  height,
  maxColors,
  value,
  onChange,
  mirror: allowMirror,
  startMirrored = true,
  testId,
  aside,
}: {
  width: number;
  height: number;
  maxColors: number;
  value: CompanyLogoData;
  onChange: (next: CompanyLogoData) => void;
  /** Offer mirror drawing (logos). */
  mirror?: boolean;
  /** Mirror drawing on from the start (logos yes, artworks no). */
  startMirrored?: boolean;
  testId: string;
  /** Notices under the tools (forbidden symbol, drawn once, …). */
  aside?: ReactNode;
}) {
  const t = useTranslations("pixelEditor");
  const [color, setColor] = useState(0);
  const [tool, setTool] = useState<PixelTool>("pen");
  const [mirror, setMirror] = useState(Boolean(allowMirror) && startMirrored);
  const [hover, setHover] = useState<Cell | null>(null);
  const history = useRef<CompanyLogoData[]>([]);
  const stroke = useRef<{ last: Cell; erase: boolean; start: Cell } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  // The newest drawing, also between renders of a fast stroke.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  const commit = (next: CompanyLogoData) => onChange(next);
  const remember = () => {
    history.current = [...history.current.slice(-49), latest.current];
  };
  const undo = () => {
    const prev = history.current.pop();
    if (prev) commit(prev);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        const prev = history.current.pop();
        if (prev) onChange(prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChange]);

  const paintCells = (cells: Cell[], char: string) => {
    const rows = latest.current.grid.map((r) => r.split(""));
    for (const { x, y } of cells) {
      if (rows[y]?.[x] === undefined) continue;
      rows[y]![x] = char;
      if (mirror) rows[y]![width - 1 - x] = char;
    }
    const next = { ...latest.current, grid: rows.map((r) => r.join("")) };
    latest.current = next;
    commit(next);
  };

  const cellAt = (event: PointerEvent) => {
    const rect = board.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * height);
    return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const cell = cellAt(event);
    if (!cell) return;
    const erase = event.button === 2 || tool === "eraser";
    remember();
    if (tool === "fill" && !erase) {
      const next = { ...latest.current, grid: floodFill(latest.current.grid, cell.x, cell.y, IDX[color]!) };
      latest.current = next;
      commit(next);
      haptic("tap");
      return;
    }
    stroke.current = { last: cell, erase, start: cell };
    if (tool !== "line" || erase) paintCells([cell], erase ? "." : IDX[color]!);
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const cell = cellAt(event);
    setHover(cell);
    const s = stroke.current;
    if (!s || !cell || (tool === "line" && !s.erase)) return;
    if (cell.x === s.last.x && cell.y === s.last.y) return;
    paintCells(cellsBetween(s.last, cell), s.erase ? "." : IDX[color]!);
    s.last = cell;
  };

  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    const s = stroke.current;
    stroke.current = null;
    if (!s || tool !== "line" || s.erase) return;
    const cell = cellAt(event);
    if (cell) paintCells(cellsBetween(s.start, cell), IDX[color]!);
  };

  const addColor = (c: string) => {
    if (value.palette.length >= maxColors) return;
    remember();
    commit({ ...value, palette: [...value.palette, c] });
    setColor(value.palette.length);
    if (tool === "eraser") setTool("pen");
  };

  const tools: { value: PixelTool; label: string; icon: string }[] = [
    { value: "pen", label: t("pen"), icon: "✎" },
    { value: "line", label: t("line"), icon: "╱" },
    { value: "fill", label: t("fill"), icon: "▧" },
    { value: "eraser", label: t("eraser"), icon: "⌫" },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-6">
      {/* The board */}
      <div className="flex min-w-0 flex-col items-center justify-center gap-3 rounded-lg bg-surface-2 p-3 sm:p-5">
        <div
          ref={board}
          data-testid={testId}
          data-vaul-no-drag=""
          role="application"
          aria-label={t("board")}
          className={cn(
            "relative grid w-full touch-none overflow-hidden rounded-md shadow-2 ring-1 ring-line-2 select-none",
            tool === "fill" ? "cursor-cell" : "cursor-crosshair",
          )}
          style={{
            gridTemplateColumns: `repeat(${width}, 1fr)`,
            aspectRatio: `${width} / ${height}`,
            maxWidth: width === height ? "min(100%, 62dvh)" : undefined,
            backgroundImage:
              "linear-gradient(45deg, var(--bg-3) 25%, transparent 25%, transparent 75%, var(--bg-3) 75%), linear-gradient(45deg, var(--bg-3) 25%, transparent 25%, transparent 75%, var(--bg-3) 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 8px 8px",
          }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => (stroke.current = null)}
          onPointerLeave={() => setHover(null)}
          onContextMenu={(event) => event.preventDefault()}
        >
          {value.grid.flatMap((row, y) =>
            row.split("").map((c, x) => {
              const hovered = hover && hover.x === x && hover.y === y;
              const mirrored = mirror && hover && hover.y === y && width - 1 - hover.x === x;
              return (
                <span
                  key={`${x}-${y}`}
                  className={cn(
                    "border-[0.5px] border-line-1/30",
                    (hovered || mirrored) && "outline-2 -outline-offset-2 outline-fg-1/70",
                  )}
                  style={{ backgroundColor: c === "." ? undefined : value.palette[IDX.indexOf(c)] }}
                />
              );
            }),
          )}
          {mirror && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent/50"
            />
          )}
        </div>
        <p className="text-center text-xs text-fg-3">{t("hint")}</p>
      </div>

      {/* Tools */}
      <div className="space-y-5">
        <div>
          <p className="mb-2 label-pixel text-fg-2">{t("tool")}</p>
          <div role="radiogroup" aria-label={t("tool")} className="grid grid-cols-4 gap-1.5">
            {tools.map((x) => (
              <button
                key={x.value}
                type="button"
                role="radio"
                aria-checked={tool === x.value}
                aria-label={x.label}
                title={x.label}
                onClick={() => {
                  haptic("tap");
                  setTool(x.value);
                }}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-md py-2 text-lg focus-ring transition duration-fast active:scale-95",
                  tool === x.value
                    ? "bg-accent text-on-accent shadow-1"
                    : "bg-surface-2 text-fg-2 hover:bg-surface-3 hover:text-fg-1",
                )}
              >
                <span aria-hidden>{x.icon}</span>
                <span className="text-2xs">{x.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 label-pixel text-fg-2">{t("colors", { count: value.palette.length, max: maxColors })}</p>
          <div role="radiogroup" aria-label={t("colorsLabel")} className="flex flex-wrap gap-2">
            {value.palette.map((c, i) => (
              <button
                key={`${c}-${i}`}
                type="button"
                role="radio"
                aria-checked={color === i}
                aria-label={c}
                onClick={() => {
                  setColor(i);
                  if (tool === "eraser") setTool("pen");
                }}
                style={{ backgroundColor: c }}
                className={cn(
                  "size-10 rounded-md border border-line-2 focus-ring transition duration-fast hover:scale-105 active:scale-95",
                  color === i && "ring-2 ring-fg-1 ring-offset-2 ring-offset-surface-1",
                )}
              />
            ))}
          </div>
          {value.palette.length < maxColors && (
            <>
              <p className="mt-3 mb-1.5 text-xs text-fg-3">{t("addColorHint")}</p>
              <div className="grid grid-cols-6 gap-1.5">
                {SWATCHES.filter((c) => !value.palette.includes(c)).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={t("addColor", { color: c })}
                    onClick={() => addColor(c)}
                    style={{ backgroundColor: c }}
                    className="aspect-square rounded-sm border border-line-2 opacity-85 focus-ring transition duration-fast hover:scale-110 hover:opacity-100"
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {allowMirror && (
            <button
              type="button"
              aria-pressed={mirror}
              onClick={() => setMirror((m) => !m)}
              className={cn(
                "rounded-md px-3 py-2 text-sm focus-ring transition duration-fast active:scale-95",
                mirror ? "bg-accent-soft text-accent ring-1 ring-accent" : "bg-surface-2 text-fg-2 hover:text-fg-1",
              )}
            >
              ⇋ {t("mirror")}
            </button>
          )}
          <button
            type="button"
            onClick={undo}
            className="rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-2 focus-ring transition duration-fast hover:text-fg-1 active:scale-95"
          >
            ↶ {t("undo")}
          </button>
          <button
            type="button"
            onClick={() => {
              remember();
              commit({ ...value, grid: value.grid.map((r) => ".".repeat(r.length)) });
            }}
            className="rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-2 focus-ring transition duration-fast hover:text-fg-1 active:scale-95"
          >
            {t("clear")}
          </button>
        </div>

        <div>
          <p className="mb-2 label-pixel text-fg-2">{t("preview")}</p>
          <div className="flex items-end gap-3 rounded-md bg-surface-2 p-3">
            <PixelIcon {...logoArt(value)} scale={width > 16 ? 2 : 4} />
            {width <= 16 && <PixelIcon {...logoArt(value)} scale={2} />}
          </div>
        </div>
        {aside}
      </div>
    </div>
  );
}
