"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { GameProps } from "./games";
import { useTaskText } from "./task-text";
import { useDragCard } from "./use-drag";

/*
 * The hands-on task games (ADR-144): drag, turn and draw like a captcha, solved by looking and thinking. Mouse, touch
 * and keyboard all work; the cards follow the pointer through transforms only. The server grades the answer.
 */

/** Keyboard activation only: pointer presses are handled by the drag code (a click after a drag would count twice). */
const keyboardOnly = (event: { detail: number }) => event.detail === 0;

const cardBase =
  "touch-none rounded-md border-2 px-2.5 py-2 text-center text-xs font-semibold text-pretty focus-ring select-none";

/** A card that follows the pointer while dragged and springs back on release. */
function DragCard({
  children,
  disabled,
  selected,
  onDrop,
  onTap,
  className,
  testId,
}: {
  children: React.ReactNode;
  disabled: boolean;
  selected?: boolean;
  onDrop: (zone: string | null, dx: number) => void;
  onTap?: () => void;
  className?: string;
  testId?: string;
}) {
  const { offset, dragging, handlers } = useDragCard({
    disabled,
    onDrop: (end) => onDrop(end.zone, end.dx),
    onTap,
  });
  return (
    <motion.button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      disabled={disabled}
      {...handlers}
      onClick={(event) => keyboardOnly(event) && onTap?.()}
      animate={{ x: offset.x, y: offset.y, scale: dragging ? 1.06 : 1 }}
      transition={dragging ? { duration: 0 } : SPRING.snappy}
      className={cn(
        cardBase,
        "relative cursor-grab active:cursor-grabbing",
        dragging ? "z-10 shadow-2" : "shadow-1",
        selected ? "border-accent bg-accent-soft text-fg-1" : "border-line-2 bg-surface-2 text-fg-1",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

/** Sort (ADR-129, drag since ADR-144): drag the card onto its stack, or swipe it left or right; tap still works. */
export function DragSortGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const left = text.string(taskKey, "left");
  const right = text.string(taskKey, "right");
  const names = [...text.list(taskKey, "leftItems"), ...text.list(taskKey, "rightItems")];
  const items = (puzzle.items as number[]) ?? [];
  const [sides, setSides] = useState<number[]>([]);
  const current = items[sides.length];
  const put = (side: number) => {
    if (current === undefined) return;
    const next = [...sides, side];
    setSides(next);
    if (next.length === items.length) onAnswer({ sides: next });
  };
  const counts = [sides.filter((s) => s === 0).length, sides.filter((s) => s === 1).length];
  return (
    <div className="space-y-4" data-testid="game-sort">
      <p className="text-center text-2xs text-pretty text-fg-3">
        {t("sortHint")} · {t("itemsLeft", { count: items.length - sides.length })}
      </p>
      <div className="grid h-24 place-items-center">
        {current !== undefined && (
          <motion.div
            key={sides.length}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING.snappy}
          >
            <DragCard
              testId="sort-card"
              disabled={disabled}
              className="px-6 py-4 text-base"
              onDrop={(zone, dx) => {
                if (zone === "0" || zone === "1") put(Number(zone));
                else if (Math.abs(dx) > 72) put(dx < 0 ? 0 : 1);
              }}
            >
              {names[current] ?? "?"}
            </DragCard>
          </motion.div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[left, right].map((label, side) => (
          <div key={side} data-drop={String(side)} className="rounded-md border-2 border-dashed border-line-2 p-1">
            <Button
              variant="secondary"
              size="lg"
              block
              disabled={disabled || current === undefined}
              onClick={() => put(side)}
            >
              {side === 0 ? `← ${label}` : `${label} →`}
            </Button>
            <p className="pt-1 text-center nums text-2xs text-fg-3">{counts[side]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Slider (ADR-144): drag each piece into its gap, captcha style. */
export function SliderGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const targets = (puzzle.targets as number[]) ?? [];
  const [positions, setPositions] = useState<number[]>(() => targets.map(() => 0));
  const set = (i: number, v: number) =>
    setPositions((p) => p.map((x, k) => (k === i ? Math.max(0, Math.min(100, Math.round(v))) : x)));
  return (
    <div className="space-y-4" data-testid="game-slider">
      <p className="text-xs text-pretty text-fg-3">{t("sliderHint")}</p>
      <div className="space-y-3">
        {targets.map((target, i) => (
          <SliderRow
            key={i}
            index={i}
            label={labels[i] ?? String(i + 1)}
            target={target}
            value={positions[i] ?? 0}
            disabled={disabled}
            onChange={(v) => set(i, v)}
          />
        ))}
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ positions })}>
        {t("done")}
      </Button>
    </div>
  );
}

function SliderRow({
  index,
  label,
  target,
  value,
  disabled,
  onChange,
}: {
  index: number;
  label: string;
  target: number;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; v: number; id: number } | null>(null);
  const [active, setActive] = useState(false);
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    const width = rail.current?.getBoundingClientRect().width ?? 0;
    if (!d || d.id !== event.pointerId || width <= 0) return;
    onChange(d.v + ((event.clientX - d.x) / width) * 100);
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.id === event.pointerId) {
      drag.current = null;
      setActive(false);
    }
  };
  const key = (event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? value + step
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? value - step
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? 100
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };
  return (
    <div className="space-y-1">
      <p className="label-pixel text-fg-2">{label}</p>
      <div className="relative h-12 overflow-hidden rounded-md bg-surface-3">
        <div ref={rail} className="pointer-events-none absolute inset-y-0 right-12 left-0">
          {/* the gap: same width as the piece, at the target */}
          <div className="absolute inset-0" style={{ transform: `translateX(${target}%)` }}>
            <div className="h-full w-12 rounded-md border-2 border-dashed border-fg-3 bg-surface-1" />
          </div>
          <div
            className="absolute inset-0"
            style={{ transform: `translateX(${value}%)` }}
            data-testid={`slider-${index}`}
            data-value={value}
          >
            <div
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={value}
              aria-disabled={disabled}
              onKeyDown={disabled ? undefined : key}
              onPointerDown={(event) => {
                if (disabled) return;
                drag.current = { x: event.clientX, v: value, id: event.pointerId };
                event.currentTarget.setPointerCapture(event.pointerId);
                setActive(true);
              }}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className={cn(
                "pointer-events-auto grid h-full w-12 cursor-grab touch-none place-items-center rounded-md border-2 font-pixel text-sm text-on-accent focus-ring transition-transform duration-fast select-none active:cursor-grabbing",
                active ? "scale-105 border-accent-strong bg-accent-strong" : "border-accent bg-accent",
              )}
            >
              ⇆
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Rotate (ADR-144): turn each dial until its arrow points at its mark. */
export function RotateGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const start = (puzzle.start as number[]) ?? [];
  const target = (puzzle.target as number[]) ?? [];
  const steps = Number(puzzle.steps ?? 8);
  // turns are counted on (not modulo) so the arrow never spins the long way round
  const [turns, setTurns] = useState<number[]>(() => [...start]);
  const set = (i: number, v: number) => setTurns((p) => p.map((x, k) => (k === i ? v : x)));
  const dials = turns.map((v) => ((v % steps) + steps) % steps);
  return (
    <div className="space-y-4" data-testid="game-rotate">
      <p className="text-xs text-pretty text-fg-3">{t("rotateHint")}</p>
      <div className="grid grid-cols-3 gap-2">
        {start.map((_, i) => (
          <Dial
            key={i}
            index={i}
            label={labels[i] ?? String(i + 1)}
            steps={steps}
            turn={turns[i] ?? 0}
            target={target[i] ?? 0}
            disabled={disabled}
            onTurn={(v) => set(i, v)}
          />
        ))}
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ dials })}>
        {t("done")}
      </Button>
    </div>
  );
}

function Dial({
  index,
  label,
  steps,
  turn,
  target,
  disabled,
  onTurn,
}: {
  index: number;
  label: string;
  steps: number;
  turn: number;
  target: number;
  disabled: boolean;
  onTurn: (v: number) => void;
}) {
  const t = useTranslations("companyTasks.play");
  const active = useRef<number | null>(null);
  const deg = 360 / steps;
  const point = (event: ReactPointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const angle =
      (Math.atan2(event.clientX - (box.left + box.width / 2), box.top + box.height / 2 - event.clientY) * 180) /
      Math.PI;
    const step = ((Math.round(angle / deg) % steps) + steps) % steps;
    const now = ((turn % steps) + steps) % steps;
    let diff = step - now;
    if (diff > steps / 2) diff -= steps;
    if (diff < -steps / 2) diff += steps;
    if (diff !== 0) onTurn(turn + diff);
  };
  const shown = ((turn % steps) + steps) % steps;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        role="img"
        aria-label={label}
        data-testid={`dial-${index}`}
        data-value={shown}
        data-target={target}
        onPointerDown={(event) => {
          if (disabled) return;
          active.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          point(event);
        }}
        onPointerMove={(event) => active.current === event.pointerId && point(event)}
        onPointerUp={() => (active.current = null)}
        onPointerCancel={() => (active.current = null)}
        className="relative size-24 cursor-grab touch-none rounded-full border-2 border-line-2 bg-surface-2 select-none active:cursor-grabbing"
      >
        {/* the mark on the rim */}
        <div className="pointer-events-none absolute inset-0" style={{ transform: `rotate(${target * deg}deg)` }}>
          <span className="absolute top-0.5 left-1/2 size-3 -translate-x-1/2 rounded-full bg-gain" />
        </div>
        <motion.div
          className="pointer-events-none absolute inset-2"
          animate={{ rotate: turn * deg }}
          transition={SPRING.snappy}
        >
          <span className="absolute top-0 left-1/2 -translate-x-1/2 font-pixel text-sm leading-none text-accent">
            ▲
          </span>
          <span className="absolute top-3 bottom-1/2 left-1/2 w-1 -translate-x-1/2 rounded-pill bg-accent" />
          <span className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-2" />
        </motion.div>
      </div>
      <p className="w-full truncate text-center label-pixel text-fg-2">{label}</p>
      <div className="flex gap-1">
        <Button
          size="icon"
          variant="secondary"
          className="size-9"
          disabled={disabled}
          aria-label={t("rotateLeft", { label })}
          onClick={() => onTurn(turn - 1)}
        >
          ↺
        </Button>
        <Button
          size="icon"
          variant="secondary"
          className="size-9"
          disabled={disabled}
          aria-label={t("rotateRight", { label })}
          onClick={() => onTurn(turn + 1)}
        >
          ↻
        </Button>
      </div>
    </div>
  );
}

/** Match (ADR-144): drag every card into the box its rule names; tap card, then box, works too. */
export function MatchGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const boxes = text.list(taskKey, "boxes");
  const groups = (() => {
    const v = text.raw(taskKey, "groups");
    return Array.isArray(v) ? (v as string[][]) : [];
  })();
  const names = groups.flat();
  const items = (puzzle.items as number[]) ?? [];
  const boxCount = Number(puzzle.boxes ?? boxes.length);
  // where each card is: -1 = still in the pool
  const [placed, setPlaced] = useState<number[]>(() => items.map(() => -1));
  const [selected, setSelected] = useState<number | null>(null);
  const place = (card: number, box: number) => {
    setPlaced((p) => p.map((x, k) => (k === card ? box : x)));
    setSelected(null);
  };
  const drop = (card: number) => (zone: string | null) => {
    if (zone === "pool") place(card, -1);
    else if (zone?.startsWith("box-")) place(card, Number(zone.slice(4)));
  };
  const tap = (card: number) => setSelected((s) => (s === card ? null : card));
  const open = placed.filter((b) => b < 0).length;
  const card = (k: number) => (
    <DragCard
      key={k}
      testId={`match-card-${k}`}
      disabled={disabled}
      selected={selected === k}
      onTap={() => tap(k)}
      onDrop={drop(k)}
      className="text-2xs"
    >
      {names[items[k]!] ?? "?"}
    </DragCard>
  );
  return (
    <div className="space-y-3" data-testid="game-match">
      <p className="text-xs text-pretty text-fg-3">{t("matchHint")}</p>
      <div
        data-drop="pool"
        className="flex min-h-14 flex-wrap justify-center gap-1.5 rounded-md bg-surface-1 p-2"
        aria-label={t("matchOpen", { count: open })}
      >
        {items.map((_, k) => (placed[k]! < 0 ? card(k) : null))}
        {open === 0 && <span className="self-center text-2xs text-fg-3">{t("matchOpen", { count: 0 })}</span>}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: boxCount }, (_, b) => (
          <div
            key={b}
            data-drop={`box-${b}`}
            data-testid={`match-box-${b}`}
            className="flex min-h-36 flex-col gap-1.5 rounded-md border-2 border-dashed border-line-2 bg-surface-2 p-1.5"
          >
            <button
              type="button"
              disabled={disabled || selected === null}
              onClick={() => selected !== null && place(selected, b)}
              className={cn(
                "rounded-sm px-1 py-1.5 text-center label-pixel text-pretty focus-ring transition-colors duration-fast",
                selected !== null ? "bg-accent-soft text-fg-1" : "text-fg-2",
              )}
            >
              {boxes[b] ?? b + 1}
            </button>
            {items.map((_, k) => (placed[k] === b ? card(k) : null))}
          </div>
        ))}
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ boxes: placed })}>
        {t("done")}
      </Button>
    </div>
  );
}

/** Path (ADR-144): draw the shortest route from start to goal around the walls; tapping neighbours works too. */
export function PathGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const size = Number(puzzle.size ?? 5);
  const start = Number(puzzle.start ?? 0);
  const goal = Number(puzzle.goal ?? size * size - 1);
  const walls = (puzzle.walls as number[]) ?? [];
  const [path, setPath] = useState<number[]>([start]);
  const drawing = useRef<number | null>(null);
  const adjacent = (a: number, b: number) =>
    Math.abs(Math.floor(a / size) - Math.floor(b / size)) + Math.abs((a % size) - (b % size)) === 1;

  /** Extend to a neighbour, step back onto the previous cell, or cut the route at a cell already on it. */
  const visit = (cell: number, cut: boolean) =>
    setPath((p) => {
      const last = p[p.length - 1]!;
      if (cell === last) return p;
      const at = p.indexOf(cell);
      if (at >= 0) return cut || at === p.length - 2 ? p.slice(0, at + 1) : p;
      if (last === goal || walls.includes(cell) || !adjacent(last, cell)) return p;
      return [...p, cell];
    });
  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest("[data-cell]");
    return el ? Number(el.getAttribute("data-cell")) : null;
  };
  const steps = path.length - 1;
  return (
    <div className="space-y-3" data-testid="game-path">
      <p className="text-xs text-pretty text-fg-3">{t("pathHint")}</p>
      <div
        className="mx-auto grid w-full max-w-sm touch-none gap-1 select-none"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        onPointerDown={(event) => {
          if (disabled) return;
          const cell = cellAt(event.clientX, event.clientY);
          if (cell === null) return;
          drawing.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          visit(cell, true);
        }}
        onPointerMove={(event) => {
          if (drawing.current !== event.pointerId) return;
          const cell = cellAt(event.clientX, event.clientY);
          if (cell !== null) visit(cell, false);
        }}
        onPointerUp={() => (drawing.current = null)}
        onPointerCancel={() => (drawing.current = null)}
      >
        {Array.from({ length: size * size }, (_, cell) => {
          const wall = walls.includes(cell);
          const step = path.indexOf(cell);
          const label =
            cell === start ? text.string(taskKey, "start") : cell === goal ? text.string(taskKey, "goal") : null;
          return (
            <button
              key={cell}
              type="button"
              data-cell={cell}
              data-testid={`path-cell-${cell}`}
              disabled={disabled || wall}
              aria-pressed={step >= 0}
              aria-label={
                wall
                  ? text.string(taskKey, "wall")
                  : (label ?? t("pathCell", { row: Math.floor(cell / size) + 1, col: (cell % size) + 1 }))
              }
              onClick={(event) => keyboardOnly(event) && visit(cell, true)}
              className={cn(
                "grid aspect-square min-w-0 place-items-center overflow-hidden rounded-sm border-2 p-0.5 text-center text-[0.625rem] leading-tight font-semibold break-words focus-ring transition-colors duration-fast",
                wall
                  ? "border-line-1 bg-surface-3 text-fg-3"
                  : cell === goal
                    ? step >= 0
                      ? "border-gain bg-gain-soft text-fg-1"
                      : "border-dashed border-gain bg-surface-1 text-fg-1"
                    : step >= 0
                      ? "border-accent bg-accent-soft text-fg-1"
                      : "border-line-1 bg-surface-1 text-fg-3 hover:bg-surface-2",
              )}
            >
              {wall ? (
                <span aria-hidden className="font-pixel text-xs text-fg-3">
                  ▦
                </span>
              ) : (
                (label ?? (step > 0 ? <span className="nums text-fg-2">{step}</span> : null))
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="nums text-xs text-fg-2" aria-live="polite">
          {t("pathSteps", { count: steps })}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || steps === 0}
            onClick={() => setPath((p) => p.slice(0, -1))}
          >
            {t("back")}
          </Button>
          <Button variant="ghost" size="sm" disabled={disabled || steps === 0} onClick={() => setPath([start])}>
            {t("reset")}
          </Button>
        </div>
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ path })}>
        {t("done")}
      </Button>
    </div>
  );
}
