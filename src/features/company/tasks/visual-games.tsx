"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "@/components/ui/button";
import {
  crossings,
  pipesConnected,
  pipesFlow,
  segmentsMeet,
  slideTiles,
  tilesInPlace,
  type Point,
} from "@/lib/sim/company-tasks-visual";
import { DURATION, SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { DragCard, keyboardOnly } from "./drag-games";
import type { GameProps } from "./games";
import { useTaskText } from "./task-text";
import { useDragCard } from "./use-drag";

/*
 * Nine drag and see task games (ADR-186): push, slide, turn and spot instead of calculating. Phone first: every
 * target is at least 44 px, every drag also works as tap-then-tap and with the keyboard. Movement uses transform and
 * opacity only and calms down with reduced motion. Like the other games they only collect the answer; the server
 * grades it.
 */

function useReduced() {
  return Boolean(useReducedMotionConfig());
}

const click = () => void playSound("tap");
const snap = () => void playSound("blip");

/** Token colours of the three kinds (bins, conveyor) and the four goods (rebuild). */
const KIND_FILL = ["fill-loss", "fill-info", "fill-gain"] as const;
const KIND_TILE = [
  "border-loss bg-loss-soft text-fg-1",
  "border-info bg-info-soft text-fg-1",
  "border-gain bg-gain-soft text-fg-1",
  "border-warn bg-warn-soft text-fg-1",
] as const;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Square, circle or triangle in a 24 x 24 box. */
function KindShape({ shape, fill, className }: { shape: number; fill: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-7", className)}>
      {shape === 0 && <rect x="4" y="4" width="16" height="16" rx="2" className={fill} />}
      {shape === 1 && <circle cx="12" cy="12" r="8.5" className={fill} />}
      {shape === 2 && <polygon points="12,3 21.5,20 2.5,20" className={fill} />}
    </svg>
  );
}

/** Six machine parts (align): gear, screw, plate, chip, spring, nut; filled or as a dashed outline. */
function PartShape({ kind, outline }: { kind: number; outline?: boolean }) {
  const paint = outline
    ? "fill-transparent stroke-fg-3 [stroke-dasharray:2_1.5] [stroke-width:1.2]"
    : "fill-accent stroke-accent-strong [stroke-width:1]";
  const hole = outline ? "fill-transparent stroke-fg-3 [stroke-width:1]" : "fill-surface-1";
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-9">
      {kind === 0 && (
        <>
          <polygon
            points="12,2 14,5 17.5,3.5 17.5,7 21,7.5 19.5,11 22,13 19,15 20,18.5 16.5,18.5 15,22 12,19.5 9,22 7.5,18.5 4,18.5 5,15 2,13 4.5,11 3,7.5 6.5,7 6.5,3.5 10,5"
            className={paint}
          />
          <circle cx="12" cy="12" r="3" className={hole} />
        </>
      )}
      {kind === 1 && (
        <>
          <rect x="6" y="2" width="12" height="6" rx="1" className={paint} />
          <rect x="10" y="8" width="4" height="14" className={paint} />
        </>
      )}
      {kind === 2 && (
        <>
          <rect x="3" y="6" width="18" height="12" rx="1" className={paint} />
          <circle cx="7" cy="12" r="1.8" className={hole} />
          <circle cx="17" cy="12" r="1.8" className={hole} />
        </>
      )}
      {kind === 3 && (
        <>
          <rect x="6" y="6" width="12" height="12" rx="1" className={paint} />
          {[8, 12, 16].map((v) => (
            <g key={v}>
              <rect x={v - 0.75} y="2" width="1.5" height="4" className={paint} />
              <rect x={v - 0.75} y="18" width="1.5" height="4" className={paint} />
            </g>
          ))}
        </>
      )}
      {kind === 4 && (
        <polygon
          points="4,3 20,3 20,5 7,8 20,11 20,13 7,16 20,19 20,21 4,21 4,19 17,16 4,13 4,11 17,8 4,5"
          className={paint}
        />
      )}
      {kind === 5 && (
        <>
          <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" className={paint} />
          <circle cx="12" cy="12" r="4" className={hole} />
        </>
      )}
    </svg>
  );
}

/**
 * A good of the odd-one-out game: kind 0 box, 1 bottle, 2 can, 3 jar; flaw 0 none, 1..3 a small fault (missing,
 * damaged or shifted part).
 */
function Product({ kind, flaw }: { kind: number; flaw: number }) {
  const body = "fill-surface-3 stroke-fg-2 [stroke-width:1]";
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-9">
      {kind === 0 && (
        <>
          <polygon points={flaw === 2 ? "4,6 16,6 20,10 20,20 4,20" : "4,6 20,6 20,20 4,20"} className={body} />
          {flaw !== 1 && <rect x={flaw === 3 ? 6 : 11} y="6" width="2" height="14" className="fill-warn" />}
        </>
      )}
      {kind === 1 && (
        <>
          <rect x="8" y="9" width="8" height="12" rx="2" className={body} />
          <rect x="10" y="5" width="4" height="4" className={body} />
          {flaw !== 2 && <rect x="9.5" y="3" width="5" height="2.5" rx="0.5" className="fill-loss" />}
          {flaw !== 1 && <rect x="8" y={flaw === 3 ? 16.5 : 12.5} width="8" height="3.5" className="fill-accent" />}
        </>
      )}
      {kind === 2 && (
        <>
          <rect x="6" y="5" width="12" height="15" rx="3" className={body} />
          {flaw !== 1 && <rect x="6" y={flaw === 3 ? 6.5 : 10} width="12" height="4.5" className="fill-info" />}
          {flaw === 2 && <circle cx="18" cy="16" r="2.4" className="fill-surface-1" />}
        </>
      )}
      {kind === 3 && (
        <>
          <rect x="6" y="8" width="12" height="13" rx="2" className={body} />
          {flaw !== 1 && (
            <rect
              x="5"
              y="5"
              width="14"
              height="3"
              rx="1"
              className="fill-gold"
              transform={flaw === 2 ? "rotate(-14 12 6.5)" : undefined}
            />
          )}
          {flaw === 3 && (
            <polyline points="10,10 12,13 10,15 13,19" className="fill-transparent stroke-loss [stroke-width:1]" />
          )}
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// tiles: sliding puzzle
// ---------------------------------------------------------------------------

/** Tiles (ADR-186): slide the pieces into the gap until 1..8 are in order; tap or drag toward the gap. */
export function TilesGame({ puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const size = Number(puzzle.size ?? 3);
  const start = useMemo(() => (puzzle.board as number[]) ?? [], [puzzle.board]);
  const [board, setBoard] = useState<number[]>(() => [...start]);
  const [moves, setMoves] = useState<number[]>([]);
  const sent = useRef(false);
  const gap = board.indexOf(-1);
  const slide = (cell: number) => {
    if (disabled || sent.current) return;
    const next = slideTiles(size, board, [cell]);
    if (!next) return;
    const done = [...moves, cell];
    setBoard(next);
    setMoves(done);
    click();
    if (tilesInPlace(next) === next.length - 1) {
      sent.current = true;
      onAnswer({ moves: done });
    }
  };
  return (
    <div className="space-y-3" data-testid="game-tiles">
      <p className="text-xs text-pretty text-fg-3">{t("tilesHint")}</p>
      <div className="relative mx-auto aspect-square w-full max-w-72 rounded-md bg-surface-1 p-1">
        <div className="relative size-full">
          {board.map((tile, cell) =>
            tile < 0 ? null : (
              <SlideTile
                key={tile}
                tile={tile}
                cell={cell}
                gap={gap}
                size={size}
                disabled={disabled}
                label={t("tilesTile", { n: tile + 1 })}
                onSlide={() => slide(cell)}
              />
            ),
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="nums text-xs text-fg-2" aria-live="polite" data-testid="tiles-moves">
          {t("tilesMoves", { count: moves.length })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || moves.length === 0}
          onClick={() => {
            setBoard([...start]);
            setMoves([]);
          }}
        >
          {t("reset")}
        </Button>
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ moves })}>
        {t("done")}
      </Button>
    </div>
  );
}

function SlideTile({
  tile,
  cell,
  gap,
  size,
  disabled,
  label,
  onSlide,
}: {
  tile: number;
  cell: number;
  gap: number;
  size: number;
  disabled: boolean;
  label: string;
  onSlide: () => void;
}) {
  const row = Math.floor(cell / size);
  const col = cell % size;
  // the direction toward the gap, if the gap is next to this tile
  const dx = gap === cell + 1 && col < size - 1 ? 1 : gap === cell - 1 && col > 0 ? -1 : 0;
  const dy = gap === cell + size ? 1 : gap === cell - size ? -1 : 0;
  const movable = dx !== 0 || dy !== 0;
  const { offset, dragging, handlers } = useDragCard({
    disabled: disabled || !movable,
    onTap: onSlide,
    onDrop: (end) => {
      if (end.dx * dx + end.dy * dy > 14) onSlide();
    },
  });
  // the tile only follows the pointer toward the gap, at most one tile far
  const along = Math.max(0, Math.min(72, offset.x * dx + offset.y * dy));
  const inPlace = tile === cell;
  return (
    <motion.div
      className="absolute top-0 left-0 p-0.5"
      style={{ width: `${100 / size}%`, height: `${100 / size}%` }}
      initial={false}
      animate={{ x: `${col * 100}%`, y: `${row * 100}%` }}
      transition={SPRING.snappy}
    >
      <motion.button
        type="button"
        data-testid={`tile-${tile}`}
        data-cell={cell}
        aria-label={label}
        disabled={disabled}
        {...handlers}
        onClick={(event) => keyboardOnly(event) && onSlide()}
        animate={{ x: along * dx, y: along * dy, scale: dragging ? 1.04 : 1 }}
        transition={dragging ? { duration: 0 } : SPRING.snappy}
        className={cn(
          "grid size-full touch-none place-items-center rounded-md border-2 font-pixel text-xl shadow-1 focus-ring select-none",
          movable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          inPlace ? "border-gain bg-gain-soft text-fg-1" : "border-line-2 bg-surface-2 text-fg-1",
        )}
      >
        {tile + 1}
      </motion.button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// bins: crates onto shelves by colour or shape
// ---------------------------------------------------------------------------

/** Bins (ADR-186): drag every crate onto the shelf of its colour (or shape); tap crate, then shelf, works too. */
export function BinsGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const itemName = text.string(taskKey, "item") || "?";
  const items = useMemo(() => (puzzle.items as Point[]) ?? [], [puzzle.items]);
  const by = Number(puzzle.by ?? 0);
  const kinds = Number(puzzle.kinds ?? 3);
  const colors = t.raw("binsColors") as string[];
  const shapes = t.raw("binsShapes") as string[];
  const [placed, setPlaced] = useState<number[]>(() => items.map(() => -1));
  const [selected, setSelected] = useState<number | null>(null);
  const place = (k: number, bin: number) => {
    setPlaced((p) => p.map((x, i) => (i === k ? bin : x)));
    setSelected(null);
    snap();
  };
  const drop = (k: number) => (zone: string | null) => {
    if (zone === "pool") place(k, -1);
    else if (zone?.startsWith("bin-")) place(k, Number(zone.slice(4)));
  };
  const open = placed.filter((b) => b < 0).length;
  const crate = (k: number) => {
    const [color, shape] = items[k]!;
    return (
      <DragCard
        key={k}
        testId={`bins-item-${k}`}
        disabled={disabled}
        selected={selected === k}
        label={t("binsItem", { item: itemName, n: k + 1, color: colors[color] ?? "?", shape: shapes[shape] ?? "?" })}
        onTap={() => setSelected((s) => (s === k ? null : k))}
        onDrop={drop(k)}
        className="grid size-12 place-items-center p-0"
      >
        <KindShape shape={shape} fill={KIND_FILL[color] ?? "fill-fg-3"} />
      </DragCard>
    );
  };
  return (
    <div className="space-y-3" data-testid="game-bins">
      <p className="text-xs text-pretty text-fg-3">{by === 0 ? t("binsHintColor") : t("binsHintShape")}</p>
      <div
        data-drop="pool"
        className="flex min-h-16 flex-wrap justify-center gap-1.5 rounded-md bg-surface-1 p-2"
        aria-label={t("binsOpen", { count: open })}
      >
        {items.map((_, k) => (placed[k]! < 0 ? crate(k) : null))}
        {open === 0 && <span className="self-center text-2xs text-fg-3">{t("binsOpen", { count: 0 })}</span>}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: kinds }, (_, b) => {
          const name = by === 0 ? (colors[b] ?? "?") : (shapes[b] ?? "?");
          return (
            <div
              key={b}
              data-drop={`bin-${b}`}
              data-testid={`bins-shelf-${b}`}
              className="flex min-h-40 flex-col items-center gap-1.5 rounded-md border-2 border-dashed border-line-2 bg-surface-2 p-1.5"
            >
              <button
                type="button"
                disabled={disabled || selected === null}
                onClick={() => selected !== null && place(selected, b)}
                aria-label={t("binsShelf", { name })}
                className={cn(
                  "flex min-h-11 w-full items-center justify-center gap-1 rounded-sm px-1 label-pixel focus-ring transition-colors duration-fast",
                  selected !== null ? "bg-accent-soft text-fg-1" : "text-fg-2",
                )}
              >
                {by === 0 ? (
                  <KindShape shape={1} fill={KIND_FILL[b] ?? "fill-fg-3"} className="size-4" />
                ) : (
                  <KindShape shape={b} fill="fill-fg-2" className="size-4" />
                )}
                {name}
              </button>
              <div className="flex flex-wrap justify-center gap-1">
                {items.map((_, k) => (placed[k] === b ? crate(k) : null))}
              </div>
            </div>
          );
        })}
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ bins: placed })}>
        {t("done")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// untangle: drag nodes until no cables cross
// ---------------------------------------------------------------------------

/** Untangle (ADR-186): drag the nodes onto grid points so that no two cables cross; arrow keys move a node. */
export function UntangleGame({ puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const grid = Number(puzzle.grid ?? 6);
  const edges = useMemo(() => (puzzle.edges as Point[]) ?? [], [puzzle.edges]);
  const [points, setPoints] = useState<Point[]>(() => ((puzzle.points as Point[]) ?? []).map((p) => [p[0], p[1]]));
  // while dragging: the node, its pointer offset in px and its position in grid units
  const [live, setLive] = useState<{ i: number; dx: number; dy: number; x: number; y: number } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; id: number; x: number; y: number; moved: boolean } | null>(null);
  const shown = points.map((p, i): Point => (live && live.i === i ? [live.x, live.y] : p));
  const bad = new Set<number>();
  edges.forEach(([a, b], i) =>
    edges.forEach(([c, d], j) => {
      if (j <= i || a === c || a === d || b === c || b === d) return;
      if (segmentsMeet(shown[a]!, shown[b]!, shown[c]!, shown[d]!)) {
        bad.add(i);
        bad.add(j);
      }
    }),
  );
  const count = crossings(edges, points);
  const free = (x: number, y: number, self: number) => !points.some((p, k) => k !== self && p[0] === x && p[1] === y);
  const toGrid = (clientX: number, clientY: number): [number, number] => {
    const box = board.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return [0, 0];
    const clamp = (v: number) => Math.max(0, Math.min(grid - 1, v));
    return [
      clamp(((clientX - box.left) / box.width) * grid - 0.5),
      clamp(((clientY - box.top) / box.height) * grid - 0.5),
    ];
  };
  const moveTo = (i: number, x: number, y: number) => {
    // the nearest free grid point
    let best: Point | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        if (!free(gx, gy, i)) continue;
        const d = (gx - x) ** 2 + (gy - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [gx, gy];
        }
      }
    }
    if (best) setPoints((p) => p.map((q, k) => (k === i ? best! : q)));
    click();
  };
  const key = (i: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const s = step[event.key];
    if (!s) return;
    event.preventDefault();
    const [x, y] = points[i]!;
    const nx = x + s[0];
    const ny = y + s[1];
    if (nx < 0 || ny < 0 || nx >= grid || ny >= grid || !free(nx, ny, i)) return;
    setPoints((p) => p.map((q, k) => (k === i ? [nx, ny] : q)));
    click();
  };
  const at = (v: number) => `${((v + 0.5) / grid) * 100}%`;
  return (
    <div className="space-y-3" data-testid="game-untangle">
      <p className="text-xs text-pretty text-fg-3">{t("untangleHint")}</p>
      <div
        ref={board}
        className="relative mx-auto aspect-square w-full max-w-80 touch-none rounded-md bg-surface-1 select-none"
        data-testid="untangle-board"
      >
        <svg viewBox={`0 0 ${grid} ${grid}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {Array.from({ length: grid * grid }, (_, c) => (
            <circle key={c} cx={(c % grid) + 0.5} cy={Math.floor(c / grid) + 0.5} r={0.05} className="fill-fg-3" />
          ))}
          {edges.map(([a, b], i) => (
            <line
              key={i}
              x1={shown[a]![0] + 0.5}
              y1={shown[a]![1] + 0.5}
              x2={shown[b]![0] + 0.5}
              y2={shown[b]![1] + 0.5}
              vectorEffect="non-scaling-stroke"
              strokeWidth={3}
              strokeLinecap="round"
              className={bad.has(i) ? "stroke-loss" : "stroke-gain"}
            />
          ))}
        </svg>
        {points.map(([x, y], i) => (
          <button
            key={i}
            type="button"
            data-testid={`untangle-node-${i}`}
            data-x={x}
            data-y={y}
            disabled={disabled}
            aria-label={t("untangleNode", { n: i + 1, x: x + 1, y: y + 1 })}
            onKeyDown={key(i)}
            onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
              if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
              drag.current = { i, id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const d = drag.current;
              if (!d || d.id !== event.pointerId) return;
              const dx = event.clientX - d.x;
              const dy = event.clientY - d.y;
              if (!d.moved && Math.hypot(dx, dy) < 6) return;
              d.moved = true;
              const [gx, gy] = toGrid(event.clientX, event.clientY);
              setLive({ i, dx, dy, x: gx, y: gy });
            }}
            onPointerUp={(event) => {
              const d = drag.current;
              if (!d || d.id !== event.pointerId) return;
              drag.current = null;
              setLive(null);
              if (d.moved) {
                const [gx, gy] = toGrid(event.clientX, event.clientY);
                moveTo(i, gx, gy);
              }
            }}
            onPointerCancel={() => {
              drag.current = null;
              setLive(null);
            }}
            className={cn(
              "absolute grid size-11 cursor-grab touch-none place-items-center rounded-full border-2 font-pixel text-xs focus-ring active:cursor-grabbing",
              live?.i === i
                ? "z-10 border-accent-strong bg-accent text-on-accent"
                : "border-accent bg-surface-2 text-fg-1",
            )}
            style={{
              left: at(x),
              top: at(y),
              transform: `translate(-50%, -50%) translate(${live?.i === i ? live.dx : 0}px, ${live?.i === i ? live.dy : 0}px)`,
            }}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <p
        className={cn("text-center nums text-sm font-semibold", count === 0 ? "text-gain" : "text-loss")}
        aria-live="polite"
        data-testid="untangle-count"
      >
        {t("untangleCrossings", { count })}
      </p>
      <Button block disabled={disabled} onClick={() => onAnswer({ points })}>
        {t("done")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// odd: spot the faulty good
// ---------------------------------------------------------------------------

/** Odd one out (ADR-186): per round one faulty good among many; tap it. */
export function OddGame({ puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const reduced = useReduced();
  const rounds = useMemo(() => (puzzle.rounds as number[][]) ?? [], [puzzle.rounds]);
  const [choices, setChoices] = useState<number[]>([]);
  const round = choices.length;
  const cells = rounds[Math.min(round, rounds.length - 1)] ?? [];
  const choose = (i: number) => {
    if (disabled || round >= rounds.length) return;
    const next = [...choices, i];
    setChoices(next);
    click();
    if (next.length >= rounds.length) onAnswer({ choices: next });
  };
  return (
    <div className="space-y-3" data-testid="game-odd">
      <p className="text-xs text-pretty text-fg-3">{t("oddHint")}</p>
      <p className="nums text-xs text-fg-3">
        {t("haggleRound", { round: Math.min(round + 1, rounds.length), total: rounds.length })}
      </p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={round}
          className="grid grid-cols-4 gap-1.5"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: reduced ? 0 : DURATION.fast }}
        >
          {cells.map((v, i) => (
            <motion.button
              key={i}
              type="button"
              whileTap={{ scale: 0.94 }}
              transition={SPRING.snappy}
              disabled={disabled || round >= rounds.length}
              onClick={() => choose(i)}
              data-testid="odd-cell"
              aria-label={t("oddCell", { index: i + 1 })}
              className="grid min-h-14 place-items-center rounded-md border-2 border-line-1 bg-surface-2 focus-ring transition-colors duration-fast hover:bg-surface-3"
            >
              <Product kind={Math.floor(v / 4)} flaw={v % 4} />
            </motion.button>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// rebuild: remember a layout, then put the goods back
// ---------------------------------------------------------------------------

/** Rebuild (ADR-186): remember where the goods stand, then drag them back onto their cells. */
export function RebuildGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const reduced = useReduced();
  const size = Number(puzzle.size ?? 3);
  const target = useMemo(() => (puzzle.layout as number[]) ?? [], [puzzle.layout]);
  const items = target.filter((v) => v >= 0).length;
  const showSeconds = Number(puzzle.show_seconds ?? 5);
  const [showing, setShowing] = useState(true);
  const [layout, setLayout] = useState<number[]>(() => target.map(() => -1));
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setShowing(false), showSeconds * 1000);
    return () => clearTimeout(id);
  }, [showSeconds]);
  const put = (item: number, cell: number | null) => {
    setLayout((l) => {
      const out = l.map((v) => (v === item ? -1 : v));
      if (cell !== null) {
        // a good already there goes back to the tray
        out[cell] = item;
      }
      return out;
    });
    setSelected(null);
    snap();
  };
  const drop = (item: number) => (zone: string | null) => {
    if (zone === "tray") put(item, null);
    else if (zone?.startsWith("cell-")) put(item, Number(zone.slice(5)));
  };
  const goods = (item: number, inCell: boolean) => (
    <DragCard
      key={item}
      testId={`rebuild-item-${item}`}
      disabled={disabled || showing}
      selected={selected === item}
      onTap={() => setSelected((s) => (s === item ? null : item))}
      onDrop={drop(item)}
      className={cn(
        "min-h-11 px-1.5 text-2xs",
        inCell ? "w-full" : "min-w-18",
        selected === item ? "" : KIND_TILE[item % KIND_TILE.length],
      )}
    >
      {labels[item] ?? "?"}
    </DragCard>
  );
  const left = Array.from({ length: items }, (_, k) => k).filter((k) => !layout.includes(k));
  return (
    <div className="space-y-3" data-testid="game-rebuild">
      <p className="text-center label-pixel text-fg-2" aria-live="polite">
        {showing ? t("rebuildShow") : t("rebuildHint")}
      </p>
      <div
        className="mx-auto grid w-full max-w-72 gap-1.5"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      >
        {target.map((want, cell) => {
          const r = Math.floor(cell / size);
          const c = cell % size;
          const have = layout[cell]!;
          return (
            <div
              key={cell}
              data-drop={`cell-${cell}`}
              data-testid={`rebuild-cell-${cell}`}
              className="grid aspect-square min-w-0 place-items-center rounded-md border-2 border-dashed border-line-2 bg-surface-2 p-1"
            >
              {showing ? (
                want >= 0 ? (
                  <motion.span
                    initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={SPRING.snappy}
                    className={cn(
                      "grid min-h-11 w-full place-items-center rounded-md border-2 px-1 text-center text-2xs font-semibold",
                      KIND_TILE[want % KIND_TILE.length],
                    )}
                  >
                    {labels[want] ?? "?"}
                  </motion.span>
                ) : null
              ) : have >= 0 ? (
                goods(have, true)
              ) : (
                <button
                  type="button"
                  disabled={disabled || selected === null}
                  onClick={() => selected !== null && put(selected, cell)}
                  aria-label={t("rebuildCell", { row: r + 1, col: c + 1, item: t("rebuildEmpty") })}
                  className={cn(
                    "size-full rounded-sm focus-ring transition-colors duration-fast",
                    selected !== null ? "bg-accent-soft" : "",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      {!showing && (
        <div
          data-drop="tray"
          className="flex min-h-14 flex-wrap justify-center gap-1.5 rounded-md bg-surface-1 p-2"
          aria-label={t("rebuildTray", { count: left.length })}
        >
          {left.map((k) => goods(k, false))}
          {left.length === 0 && (
            <span className="self-center text-2xs text-fg-3">{t("rebuildTray", { count: 0 })}</span>
          )}
        </div>
      )}
      <Button block disabled={disabled || showing} onClick={() => onAnswer({ layout })}>
        {t("done")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// align: parts onto matching outlines
// ---------------------------------------------------------------------------

/** Align (ADR-186): drag every part onto the station whose outline it fits. */
export function AlignGame({ puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const names = t.raw("alignShapes") as string[];
  const slots = useMemo(() => (puzzle.slots as number[]) ?? [], [puzzle.slots]);
  const parts = useMemo(() => (puzzle.parts as number[]) ?? [], [puzzle.parts]);
  const [at, setAt] = useState<number[]>(() => parts.map(() => -1));
  const [selected, setSelected] = useState<number | null>(null);
  const place = (part: number, slot: number) => {
    // one part per station: a part already there goes back
    setAt((a) => a.map((s, k) => (k === part ? slot : s === slot && slot >= 0 ? -1 : s)));
    setSelected(null);
    snap();
  };
  const drop = (part: number) => (zone: string | null) => {
    if (zone === "tray") place(part, -1);
    else if (zone?.startsWith("slot-")) place(part, Number(zone.slice(5)));
  };
  const card = (part: number) => (
    <DragCard
      key={part}
      testId={`align-part-${part}`}
      disabled={disabled}
      selected={selected === part}
      label={t("alignPart", { shape: names[parts[part]!] ?? "?" })}
      onTap={() => setSelected((s) => (s === part ? null : part))}
      onDrop={drop(part)}
      className="grid size-13 place-items-center p-0"
    >
      <PartShape kind={parts[part]!} />
    </DragCard>
  );
  const open = at.filter((s) => s < 0).length;
  return (
    <div className="space-y-3" data-testid="game-align">
      <p className="text-xs text-pretty text-fg-3">{t("alignHint")}</p>
      <div className="grid grid-cols-3 gap-1.5 rounded-md bg-surface-3 p-1.5 sm:grid-cols-6">
        {slots.map((kind, s) => {
          const part = at.indexOf(s);
          return (
            <div
              key={s}
              data-drop={`slot-${s}`}
              data-testid={`align-slot-${s}`}
              className="relative grid min-h-18 place-items-center rounded-md border-2 border-line-2 bg-surface-1"
            >
              {part >= 0 ? (
                card(part)
              ) : (
                <button
                  type="button"
                  disabled={disabled || selected === null}
                  onClick={() => selected !== null && place(selected, s)}
                  aria-label={t("alignSlot", { n: s + 1, shape: names[kind] ?? "?" })}
                  className={cn(
                    "grid size-full place-items-center rounded-sm focus-ring transition-colors duration-fast",
                    selected !== null ? "bg-accent-soft" : "",
                  )}
                >
                  <PartShape kind={kind} outline />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div
        data-drop="tray"
        className="flex min-h-16 flex-wrap justify-center gap-2 rounded-md bg-surface-1 p-2"
        aria-label={t("alignOpen", { count: open })}
      >
        {parts.map((_, k) => (at[k]! < 0 ? card(k) : null))}
        {open === 0 && <span className="self-center text-2xs text-fg-3">{t("alignOpen", { count: 0 })}</span>}
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ at })}>
        {t("done")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// pipes: turn the pipes until the line is closed
// ---------------------------------------------------------------------------

/** Pipes (ADR-186): tap a pipe to turn it a quarter; the water shows how far it gets. */
export function PipesGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const size = Number(puzzle.size ?? 4);
  const tiles = useMemo(() => (puzzle.tiles as number[]) ?? [], [puzzle.tiles]);
  const from = Number(puzzle.from ?? 0);
  const to = Number(puzzle.to ?? 0);
  // turns count on (not modulo), so a pipe never spins back the long way
  const [turns, setTurns] = useState<number[]>(() => [...((puzzle.turns as number[]) ?? [])]);
  const mod = turns.map((v) => ((v % 4) + 4) % 4);
  const wet = new Set(pipesFlow(size, tiles, mod, from));
  const closed = pipesConnected(size, tiles, mod, from, to);
  const turn = (i: number) => {
    if (disabled) return;
    setTurns((p) => p.map((v, k) => (k === i ? v + 1 : v)));
    void playSound("toggle");
  };
  const marker = (row: number, label: string, side: "start" | "goal") => (
    <div
      className="flex items-center justify-center"
      style={{ gridRow: row + 1, gridColumn: side === "start" ? 1 : size + 2 }}
    >
      <span
        className={cn(
          "rounded-xs px-1 py-0.5 text-[0.625rem] leading-tight font-semibold [writing-mode:vertical-rl]",
          side === "start" ? "bg-info-soft text-info" : closed ? "bg-gain-soft text-gain" : "bg-surface-3 text-fg-3",
        )}
      >
        {label}
      </span>
    </div>
  );
  return (
    <div className="space-y-3" data-testid="game-pipes">
      <p className="text-xs text-pretty text-fg-3">{t("pipesHint")}</p>
      <div
        className="mx-auto grid w-full max-w-80 gap-1"
        style={{ gridTemplateColumns: `1.25rem repeat(${size}, minmax(0, 1fr)) 1.25rem` }}
      >
        {marker(from, text.string(taskKey, "start"), "start")}
        {marker(to, text.string(taskKey, "goal"), "goal")}
        {tiles.map((kind, i) => {
          const r = Math.floor(i / size);
          const c = i % size;
          return (
            <button
              key={i}
              type="button"
              data-testid={`pipe-${i}`}
              data-turn={mod[i]}
              disabled={disabled}
              onClick={() => turn(i)}
              aria-label={t("pipesCell", { row: r + 1, col: c + 1 })}
              style={{ gridRow: r + 1, gridColumn: c + 2 }}
              className="relative aspect-square min-w-0 overflow-hidden rounded-sm border-2 border-line-1 bg-surface-2 focus-ring transition-colors duration-fast hover:bg-surface-3"
            >
              <motion.svg
                viewBox="0 0 24 24"
                aria-hidden
                className="absolute inset-0 size-full"
                initial={false}
                animate={{ rotate: turns[i]! * 90 }}
                transition={SPRING.snappy}
              >
                {kind === 0 ? (
                  <rect x="9" y="0" width="6" height="24" className={wet.has(i) ? "fill-info" : "fill-fg-3"} />
                ) : (
                  <path d="M9 0 H15 V9 H24 V15 H9 Z" className={wet.has(i) ? "fill-info" : "fill-fg-3"} />
                )}
              </motion.svg>
            </button>
          );
        })}
      </div>
      <p
        className={cn("text-center text-sm font-semibold", closed ? "text-gain" : "text-fg-3")}
        aria-live="polite"
        data-testid="pipes-status"
      >
        {closed ? t("pipesClosed") : t("pipesOpen")}
      </p>
      <Button block disabled={disabled} onClick={() => onAnswer({ turns: mod })}>
        {t("done")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// sizes: parcels from small to big
// ---------------------------------------------------------------------------

/** Sizes (ADR-186): drag the parcels into a row from small to big; tap two to swap them. */
export function SizesGame({ puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const reduced = useReduced();
  const sizes = useMemo(() => (puzzle.sizes as number[]) ?? [], [puzzle.sizes]);
  // the parcel at each place, left to right
  const [order, setOrder] = useState<number[]>(() => sizes.map((_, i) => i));
  const [selected, setSelected] = useState<number | null>(null);
  const swap = (a: number, b: number) => {
    if (a !== b) {
      setOrder((o) => {
        const out = [...o];
        [out[a], out[b]] = [out[b]!, out[a]!];
        return out;
      });
      click();
    }
    setSelected(null);
  };
  return (
    <div className="space-y-3" data-testid="game-sizes">
      <p className="text-xs text-pretty text-fg-3">{t("sizesHint")}</p>
      <div className="flex justify-between px-1 label-pixel text-fg-3">
        <span>← {t("sizesSmall")}</span>
        <span>{t("sizesBig")} →</span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${sizes.length}, minmax(0, 1fr))` }}>
        {order.map((parcel, pos) => (
          <div
            key={pos}
            data-drop={`pos-${pos}`}
            data-testid={`sizes-pos-${pos}`}
            className="flex aspect-[3/4] min-w-0 items-end justify-center rounded-md border-b-4 border-line-2 bg-surface-1"
          >
            <Parcel
              key={parcel}
              index={parcel}
              size={sizes[parcel] ?? 50}
              selected={selected === pos}
              disabled={disabled}
              reduced={reduced}
              label={t("sizesParcel", { n: parcel + 1, pos: pos + 1 })}
              onTap={() => (selected === null ? setSelected(pos) : swap(selected, pos))}
              onDrop={(zone) => zone?.startsWith("pos-") && swap(pos, Number(zone.slice(4)))}
            />
          </div>
        ))}
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ order })}>
        {t("done")}
      </Button>
    </div>
  );
}

function Parcel({
  index,
  size,
  selected,
  disabled,
  reduced,
  label,
  onTap,
  onDrop,
}: {
  index: number;
  size: number;
  selected: boolean;
  disabled: boolean;
  reduced: boolean;
  label: string;
  onTap: () => void;
  onDrop: (zone: string | null) => void;
}) {
  const { offset, dragging, handlers } = useDragCard({ disabled, onTap, onDrop: (end) => onDrop(end.zone) });
  return (
    <motion.button
      type="button"
      layout={!reduced}
      data-testid={`parcel-${index}`}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      {...handlers}
      onClick={(event) => keyboardOnly(event) && onTap()}
      animate={{ x: offset.x, y: offset.y }}
      transition={dragging ? { duration: 0 } : SPRING.snappy}
      className={cn(
        "relative grid size-full min-h-11 cursor-grab touch-none place-items-end justify-center pb-1 focus-ring select-none active:cursor-grabbing",
        dragging && "z-10",
      )}
    >
      {/* the parcel itself, scaled to its size (no number: judge by eye) */}
      <span
        className={cn(
          "block aspect-square w-full origin-bottom rounded-sm border-2 shadow-1",
          selected ? "border-accent-strong bg-accent" : "border-warn bg-warn-soft",
        )}
        style={{ transform: `scale(${size / 100})` }}
      >
        <span className="mx-auto block h-full w-1/5 bg-warn/50" />
      </span>
    </motion.button>
  );
}

// ---------------------------------------------------------------------------
// conveyor: goods run along a belt; drag each into the right bin in time
// ---------------------------------------------------------------------------

interface BeltItem {
  /** When it entered the belt (ms since the start), shifted while held. */
  start: number;
  /** Progress while held by the pointer, else null. */
  held: number | null;
}

/** Conveyor (ADR-186): goods run along the belt; drag each into its bin before it falls off. */
export function ConveyorGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const reduced = useReduced();
  const items = useMemo(() => (puzzle.items as number[]) ?? [], [puzzle.items]);
  // with reduced motion the belt runs slower and in coarse steps
  const slow = reduced ? 1.4 : 1;
  const every = Number(puzzle.every_ms ?? 2400) * slow;
  const travel = Number(puzzle.travel_ms ?? 5600) * slow;
  const kinds = Math.max(3, labels.length);
  const [now, setNow] = useState(0);
  const [bins, setBins] = useState<number[]>(() => items.map(() => -2));
  const [belt, setBelt] = useState<BeltItem[]>(() => items.map((_, k) => ({ start: k * every, held: null })));
  const [drag, setDrag] = useState<{ k: number; dx: number; dy: number } | null>(null);
  const grab = useRef<{ k: number; id: number; x: number; y: number } | null>(null);
  const sent = useRef(false);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (disabled) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      setNow(performance.now() - t0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [disabled]);

  const progress = (k: number) => {
    const b = belt[k]!;
    if (b.held !== null) return b.held;
    const p = (now - b.start) / travel;
    return reduced ? Math.floor(p * 8) / 8 : p;
  };
  // goods that ran off the belt are missed (-1)
  const state = bins.map((v, k) => (v === -2 && belt[k]!.held === null && progress(k) >= 1 ? -1 : v));
  const finished = state.every((v) => v !== -2);
  useEffect(() => {
    if (!finished || sent.current) return;
    sent.current = true;
    onAnswer({ bins: state });
  });
  const onBelt = items.map((_, k) => k).filter((k) => state[k] === -2 && progress(k) >= 0);
  const sort = (k: number, bin: number) => {
    setBins((b) => b.map((v, i) => (i === k ? bin : v)));
    setSelected(null);
    snap();
  };
  const tapBin = (bin: number) => {
    // the selected good, else the one furthest along
    const k =
      selected !== null && state[selected] === -2 ? selected : [...onBelt].sort((a, b) => progress(b) - progress(a))[0];
    if (k !== undefined) sort(k, bin);
  };
  const done = state.filter((v) => v >= 0).length;
  return (
    <div className="space-y-3" data-testid="game-conveyor">
      <p className="text-xs text-pretty text-fg-3">{t("conveyorHint")}</p>
      <div
        className="relative h-20 overflow-hidden rounded-md border-y-4 border-line-2 bg-surface-3"
        data-testid="conveyor-belt"
      >
        {onBelt.map((k) => {
          const p = Math.min(1, progress(k));
          const held = drag?.k === k;
          return (
            <div
              key={k}
              className="absolute top-1/2 left-0 w-full"
              style={{ transform: `translateX(calc(${p} * (100% - 5rem))) translateY(-50%)` }}
            >
              <button
                type="button"
                data-testid={`conveyor-item-${k}`}
                data-kind={items[k]}
                aria-pressed={selected === k}
                aria-label={t("conveyorItem", { label: labels[items[k]!] ?? "?" })}
                disabled={disabled}
                onClick={(event) => keyboardOnly(event) && setSelected(k)}
                onPointerDown={(event) => {
                  if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
                  grab.current = { k, id: event.pointerId, x: event.clientX, y: event.clientY };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setBelt((b) => b.map((it, i) => (i === k ? { ...it, held: progress(k) } : it)));
                  setDrag({ k, dx: 0, dy: 0 });
                }}
                onPointerMove={(event) => {
                  const g = grab.current;
                  if (!g || g.id !== event.pointerId) return;
                  setDrag({ k, dx: event.clientX - g.x, dy: event.clientY - g.y });
                }}
                onPointerUp={(event) => {
                  const g = grab.current;
                  if (!g || g.id !== event.pointerId) return;
                  grab.current = null;
                  setDrag(null);
                  const moved = Math.hypot(event.clientX - g.x, event.clientY - g.y) >= 6;
                  const self = event.currentTarget;
                  const zone = moved
                    ? document
                        .elementsFromPoint(event.clientX, event.clientY)
                        .find((el) => !self.contains(el) && el.closest("[data-drop]"))
                        ?.closest("[data-drop]")
                        ?.getAttribute("data-drop")
                    : null;
                  const held = belt[k]!.held ?? 0;
                  // back on the belt where it was taken off
                  setBelt((b) => b.map((it, i) => (i === k ? { start: now - held * travel, held: null } : it)));
                  if (zone?.startsWith("bin-")) sort(k, Number(zone.slice(4)));
                  else if (!moved) setSelected((s) => (s === k ? null : k));
                }}
                onPointerCancel={() => {
                  grab.current = null;
                  setDrag(null);
                  const held = belt[k]!.held ?? 0;
                  setBelt((b) => b.map((it, i) => (i === k ? { start: now - held * travel, held: null } : it)));
                }}
                style={{ transform: held ? `translate(${drag.dx}px, ${drag.dy}px) scale(1.06)` : undefined }}
                className={cn(
                  "relative grid h-14 w-20 cursor-grab touch-none place-items-center rounded-md border-2 px-1 text-center text-2xs font-semibold shadow-1 focus-ring select-none active:cursor-grabbing",
                  held && "z-10 shadow-2",
                  selected === k ? "border-accent bg-accent-soft text-fg-1" : KIND_TILE[items[k]! % KIND_TILE.length],
                )}
              >
                {labels[items[k]!] ?? "?"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${kinds}, minmax(0, 1fr))` }}>
        {Array.from({ length: kinds }, (_, b) => (
          <div key={b} data-drop={`bin-${b}`} data-testid={`conveyor-bin-${b}`} className="rounded-md p-0.5">
            <button
              type="button"
              disabled={disabled || onBelt.length === 0}
              onClick={() => tapBin(b)}
              className={cn(
                "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-1 text-2xs font-semibold focus-ring transition-colors duration-fast",
                KIND_TILE[b % KIND_TILE.length],
              )}
            >
              <span aria-hidden className="font-pixel text-xs">
                ▼
              </span>
              {labels[b] ?? "?"}
            </button>
          </div>
        ))}
      </div>
      <p className="text-center nums text-xs text-fg-3" aria-live="polite" data-testid="conveyor-count">
        {t("conveyorDone", { count: done, total: items.length })}
      </p>
    </div>
  );
}
