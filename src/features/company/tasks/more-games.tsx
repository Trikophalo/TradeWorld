"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { GameProps } from "./games";
import { useTaskText } from "./task-text";

/*
 * Eight more task games (ADR-173): memory, timing, spot the difference, quick maths, route planning, negotiation,
 * packing and a reaction game. Like the others they only collect the answer; the server grades it. Every game works
 * with one thumb and with the keyboard (all targets are buttons); movement uses transform and opacity only and
 * calms down with reduced motion.
 */

const tile =
  "flex min-h-12 items-center justify-center rounded-md border-2 px-1.5 py-2 text-center text-xs font-semibold text-pretty focus-ring transition-colors duration-fast";

function useReduced() {
  return Boolean(useReducedMotionConfig());
}

/** Turn pairs of face-down cards; equal ones stay open. */
export function MemoryGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const cards = useMemo(() => (puzzle.cards as number[]) ?? [], [puzzle.cards]);
  const [open, setOpen] = useState<number[]>([]);
  const [pairs, setPairs] = useState<[number, number][]>([]);
  const [misses, setMisses] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const matched = new Set(pairs.flat());
  const flip = (i: number) => {
    if (disabled || open.length >= 2 || open.includes(i) || matched.has(i)) return;
    const next = [...open, i];
    setOpen(next);
    if (next.length < 2) return;
    const [a, b] = next as [number, number];
    if (cards[a] === cards[b]) {
      const done = [...pairs, [a, b] as [number, number]];
      setPairs(done);
      setOpen([]);
      if (done.length * 2 === cards.length) onAnswer({ pairs: done, misses });
    } else {
      setMisses((m) => m + 1);
      timer.current = setTimeout(() => setOpen([]), 700);
    }
  };
  return (
    <div className="space-y-3" data-testid="game-memory">
      <p className="text-xs text-pretty text-fg-3">{t("memoryHint")}</p>
      <div className="grid grid-cols-4 gap-2">
        {cards.map((label, i) => {
          const shown = open.includes(i) || matched.has(i);
          return (
            <motion.button
              key={i}
              type="button"
              disabled={disabled || matched.has(i)}
              whileTap={{ scale: 0.94 }}
              transition={SPRING.snappy}
              onClick={() => flip(i)}
              aria-label={`${t("memoryCard", { index: i + 1 })}: ${shown ? (labels[label] ?? "?") : t("memoryHidden")}`}
              data-testid="memory-card"
              className={cn(
                tile,
                "min-h-16",
                matched.has(i)
                  ? "border-gain bg-gain-soft text-fg-1"
                  : shown
                    ? "border-accent bg-accent-soft text-fg-1"
                    : "border-line-1 bg-surface-3 text-fg-3 hover:bg-surface-2",
              )}
            >
              {shown ? (labels[label] ?? "?") : "?"}
            </motion.button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="nums text-xs text-fg-3">{t("memoryMisses", { count: misses })}</span>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onAnswer({ pairs, misses })}>
          {t("done")}
        </Button>
      </div>
    </div>
  );
}

/** Position of the sweeping marker (0..100) after `ms`: there and back in 2 × sweep. */
export function sweepPosition(ms: number, sweepMs: number): number {
  const phase = (ms % (2 * sweepMs)) / sweepMs;
  return Math.round((phase <= 1 ? phase : 2 - phase) * 100);
}

/** A marker sweeps over the bar; stop it in the zone, round after round. */
export function TimingGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const targets = useMemo(() => (puzzle.targets as number[]) ?? [], [puzzle.targets]);
  const reduced = useReduced();
  // with reduced motion the marker moves half as fast and in coarse steps
  const sweep = Number(puzzle.sweep_ms ?? 1600) * (reduced ? 2 : 1);
  const [stops, setStops] = useState<number[]>([]);
  const [ms, setMs] = useState(0);
  const started = useRef<number | null>(null);
  const round = stops.length;
  useEffect(() => {
    if (disabled || round >= targets.length) return;
    let raf = 0;
    let id: ReturnType<typeof setInterval> | null = null;
    const step = () => {
      const now = performance.now();
      started.current ??= now;
      setMs(now - started.current);
    };
    if (reduced) id = setInterval(step, 120);
    else {
      const loop = () => {
        step();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (id) clearInterval(id);
    };
  }, [disabled, reduced, round, targets.length]);
  const pos = sweepPosition(ms, sweep);
  const target = targets[round] ?? targets[targets.length - 1] ?? 50;
  const stop = () => {
    if (disabled || round >= targets.length) return;
    const next = [...stops, pos];
    setStops(next);
    started.current = null;
    setMs(0);
    if (next.length === targets.length) onAnswer({ stops: next });
  };
  return (
    <div className="space-y-4" data-testid="game-timing">
      <p className="text-xs text-pretty text-fg-3">{t("timingHint")}</p>
      <div className="flex items-center justify-between label-pixel text-fg-2">
        <span>{labels[round] ?? labels[labels.length - 1]}</span>
        <span className="nums">
          {t("timingRound", { round: Math.min(round + 1, targets.length), total: targets.length })}
        </span>
      </div>
      <div className="relative h-12 overflow-hidden rounded-md border-2 border-line-2 bg-surface-2" aria-hidden>
        <div
          className="absolute inset-y-0 bg-accent-soft"
          style={{ left: `${Math.max(0, target - 5)}%`, width: "10%" }}
        />
        <div className="absolute inset-y-0 w-px bg-accent" style={{ left: `${target}%` }} />
        <div className="absolute inset-0" style={{ transform: `translateX(${pos}%)` }}>
          <div className="absolute inset-y-1 -left-1 w-2 rounded-xs bg-fg-1" />
        </div>
      </div>
      <Button block size="lg" disabled={disabled || round >= targets.length} onClick={stop} data-testid="timing-stop">
        {t("timingStop")}
      </Button>
    </div>
  );
}

/** Two grids side by side; tap every field of the copy that differs. */
export function DiffGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const left = (puzzle.left as number[]) ?? [];
  const right = (puzzle.right as number[]) ?? [];
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  return (
    <div className="space-y-3" data-testid="game-diff">
      <p className="text-xs text-pretty text-fg-3">{t("diffHint")}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="label-pixel text-fg-3">{t("diffLeft")}</p>
          <div className="grid grid-cols-3 gap-1">
            {left.map((label, i) => (
              <div key={i} className={cn(tile, "min-h-10 border-line-1 bg-surface-2 px-0.5 text-2xs text-fg-2")}>
                {labels[label] ?? "?"}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="label-pixel text-fg-3">{t("diffRight")}</p>
          <div className="grid grid-cols-3 gap-1">
            {right.map((label, i) => {
              const on = picked.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggle(i)}
                  data-testid="diff-cell"
                  className={cn(
                    tile,
                    "min-h-10 px-0.5 text-2xs",
                    on
                      ? "border-loss bg-loss-soft text-fg-1"
                      : "border-line-1 bg-surface-2 text-fg-2 hover:bg-surface-3",
                  )}
                >
                  {labels[label] ?? "?"}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ picked })}>
        {t("done")}
      </Button>
    </div>
  );
}

const OP_SIGN = { add: "+", sub: "−", mul: "×" } as const;

/** Five quick sums, one after another; tap the right result. */
export function QuickGame({ puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const problems =
    (puzzle.problems as { a: number; b: number; op: "add" | "sub" | "mul" | "pct"; options: number[] }[]) ?? [];
  const reduced = useReduced();
  const [choices, setChoices] = useState<number[]>([]);
  const k = choices.length;
  const p = problems[k];
  const choose = (i: number) => {
    const next = [...choices, i];
    setChoices(next);
    if (next.length === problems.length) onAnswer({ choices: next });
  };
  const fmt = (n: number) => n.toLocaleString("de-DE");
  return (
    <div className="space-y-3" data-testid="game-quick">
      <p className="text-xs text-pretty text-fg-3">{t("quickHint")}</p>
      <p className="label-pixel nums text-fg-2">
        {t("quickProblem", { index: Math.min(k + 1, problems.length), total: problems.length })}
      </p>
      <AnimatePresence mode="wait" initial={false}>
        {p && (
          <motion.div
            key={k}
            initial={reduced ? false : { opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0, x: -16 }}
            transition={{ duration: DURATION.fast, ease: EASE.out }}
            className="space-y-3"
          >
            <p className="rounded-md bg-surface-2 px-4 py-4 text-center nums text-2xl font-semibold text-fg-1">
              {p.op === "pct" ? `${fmt(p.b)} % × ${fmt(p.a)}` : `${fmt(p.a)} ${OP_SIGN[p.op]} ${fmt(p.b)}`}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {p.options.map((option, i) => (
                <Button
                  key={i}
                  variant="secondary"
                  size="lg"
                  className="nums"
                  disabled={disabled}
                  onClick={() => choose(i)}
                  data-testid="quick-option"
                >
                  {fmt(option)}
                </Button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A map with a depot and stops: tap the stops in the order you drive them. */
export function RouteGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const start = text.string(taskKey, "start");
  const stops = text.list(taskKey, "stops");
  const points = useMemo(() => (puzzle.points as [number, number][]) ?? [], [puzzle.points]);
  const grid = Math.max(1, ...points.flat().map((v) => v + 1));
  const size = Math.max(grid, 6);
  const [order, setOrder] = useState<number[]>([]);
  const length = useMemo(() => {
    let at = points[0];
    let sum = 0;
    for (const i of order) {
      const q = points[i];
      if (!at || !q) continue;
      sum += Math.abs(at[0] - q[0]) + Math.abs(at[1] - q[1]);
      at = q;
    }
    const home = points[0];
    if (at && home && order.length === points.length - 1) sum += Math.abs(at[0] - home[0]) + Math.abs(at[1] - home[1]);
    return sum;
  }, [order, points]);
  const byCell = new Map(points.map(([x, y], i) => [y * size + x, i]));
  const tap = (i: number) => {
    if (i === 0 || order.includes(i)) return;
    setOrder([...order, i]);
  };
  const complete = order.length === points.length - 1;
  return (
    <div className="space-y-3" data-testid="game-route">
      <p className="text-xs text-pretty text-fg-3">{t("routeHint")}</p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
        {Array.from({ length: size * size }, (_, cell) => {
          const i = byCell.get(cell);
          if (i === undefined) return <div key={cell} className="aspect-square rounded-xs bg-surface-2" aria-hidden />;
          const pos = order.indexOf(i);
          const label = i === 0 ? start : (stops[i - 1] ?? `${i}`);
          return (
            <button
              key={cell}
              type="button"
              disabled={disabled || i === 0 || pos >= 0}
              onClick={() => tap(i)}
              aria-label={pos >= 0 ? `${label} (${pos + 1})` : label}
              data-testid={i === 0 ? "route-depot" : "route-stop"}
              className={cn(
                "relative grid aspect-square place-items-center rounded-xs border-2 px-0.5 text-center text-2xs leading-tight font-semibold focus-ring transition-colors duration-fast",
                i === 0
                  ? "border-info bg-info text-on-semantic"
                  : pos >= 0
                    ? "border-accent bg-accent-soft text-fg-1"
                    : "border-line-2 bg-surface-1 text-fg-1 hover:bg-surface-3",
              )}
            >
              <span className="line-clamp-2">{pos >= 0 ? pos + 1 : label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="nums text-xs text-fg-2">{t("routeLength", { count: length })}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || order.length === 0}
          onClick={() => setOrder(order.slice(0, -1))}
        >
          {t("routeUndo")}
        </Button>
      </div>
      <Button block disabled={disabled || !complete} onClick={() => onAnswer({ order })}>
        {t("done")}
      </Button>
    </div>
  );
}

/** A negotiation in rounds: the other side speaks, pick one of three replies. */
export function HaggleGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const script = (text.raw(taskKey, "rounds") as { line: string; replies: string[] }[] | undefined) ?? [];
  const rounds = (puzzle.rounds as number[][]) ?? [];
  const reduced = useReduced();
  const [choices, setChoices] = useState<number[]>([]);
  const r = choices.length;
  const choose = (pos: number) => {
    const next = [...choices, pos];
    setChoices(next);
    if (next.length === rounds.length) onAnswer({ choices: next });
  };
  return (
    <div className="space-y-3" data-testid="game-haggle">
      <p className="text-xs text-pretty text-fg-3">{t("haggleHint")}</p>
      <ol className="space-y-2">
        {choices.map((pos, i) => (
          <li key={i} className="space-y-1 text-xs">
            <p className="rounded-md bg-surface-2 px-3 py-2 text-fg-2">{script[i]?.line}</p>
            <p className="ml-6 rounded-md bg-accent-soft px-3 py-2 text-fg-1">
              {script[i]?.replies[rounds[i]?.[pos] ?? 0]}
            </p>
          </li>
        ))}
      </ol>
      {rounds[r] && (
        <motion.div
          key={r}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.base, ease: EASE.out }}
          className="space-y-2"
        >
          <p className="label-pixel text-fg-3">{t("haggleRound", { round: r + 1, total: rounds.length })}</p>
          <p className="rounded-md bg-surface-2 px-3 py-3 text-sm text-pretty text-fg-1">{script[r]?.line}</p>
          <div className="space-y-2">
            {rounds[r]!.map((rank, pos) => (
              <Button
                key={pos}
                block
                variant="secondary"
                className="h-auto min-h-11 justify-start py-2 text-left text-sm whitespace-normal"
                disabled={disabled}
                onClick={() => choose(pos)}
                data-testid="haggle-reply"
              >
                {script[r]?.replies[rank] ?? "…"}
              </Button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** Load the most value without going over the limit. */
export function PackGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const unit = text.string(taskKey, "unit");
  const weights = (puzzle.weights as number[]) ?? [];
  const values = (puzzle.values as number[]) ?? [];
  const cap = Number(puzzle.cap ?? 1);
  const [picked, setPicked] = useState<number[]>([]);
  const weight = picked.reduce((s, i) => s + (weights[i] ?? 0), 0);
  const value = picked.reduce((s, i) => s + (values[i] ?? 0), 0);
  const over = weight > cap;
  const toggle = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  return (
    <div className="space-y-3" data-testid="game-pack">
      <p className="text-xs text-pretty text-fg-3">{t("packHint")}</p>
      <div className="space-y-1">
        <div className="flex justify-between nums text-xs">
          <span className={over ? "font-semibold text-loss" : "text-fg-2"}>
            {over ? t("packOver") : t("packLoad", { weight, cap, unit })}
          </span>
          <span className="font-semibold text-fg-1">{t("packValue", { value })}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-xs bg-surface-3" aria-hidden>
          <div
            className={cn("h-full origin-left transition-transform duration-base", over ? "bg-loss" : "bg-accent")}
            style={{ transform: `scaleX(${Math.min(1, weight / Math.max(cap, 1))})` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {weights.map((w, i) => {
          const on = picked.includes(i);
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(i)}
              data-testid="pack-item"
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-md border-2 px-3 py-2 text-left focus-ring transition-colors duration-fast",
                on ? "border-accent bg-accent-soft" : "border-line-1 bg-surface-2 hover:bg-surface-3",
              )}
            >
              <span className="text-sm font-semibold text-fg-1">{labels[i] ?? "?"}</span>
              <span className="nums text-2xs text-fg-3">
                {w} {unit} · {t("packValue", { value: values[i] ?? 0 })}
              </span>
            </button>
          );
        })}
      </div>
      <Button block disabled={disabled || over} onClick={() => onAnswer({ picked })}>
        {t("done")}
      </Button>
    </div>
  );
}

const CATCH_LEAD_MS = 800;

/** Tiles pop up one after another; tap the good ones while they are there. */
export function CatchGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const events = useMemo(() => (puzzle.events as { cell: number; good: boolean }[]) ?? [], [puzzle.events]);
  const every = Number(puzzle.every_ms ?? 1100);
  const show = Number(puzzle.show_ms ?? 900);
  const reduced = useReduced();
  const [elapsed, setElapsed] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  const pickedRef = useRef<number[]>([]);
  const sent = useRef(false);
  // the parent may re-render with a new callback; the clock must not restart for that
  const answer = useRef(onAnswer);
  useEffect(() => {
    answer.current = onAnswer;
  }, [onAnswer]);
  const cells = Math.max(9, ...events.map((e) => e.cell + 1));
  const end = CATCH_LEAD_MS + events.length * every;
  useEffect(() => {
    if (disabled) return;
    const t0 = performance.now();
    const id = setInterval(() => {
      const ms = performance.now() - t0;
      setElapsed(ms);
      if (ms >= end && !sent.current) {
        sent.current = true;
        answer.current({ picked: pickedRef.current });
      }
    }, 50);
    return () => clearInterval(id);
  }, [disabled, end]);
  const k = Math.floor((elapsed - CATCH_LEAD_MS) / every);
  const live = k >= 0 && k < events.length && elapsed - CATCH_LEAD_MS - k * every < show ? k : -1;
  const ev = live >= 0 ? events[live] : undefined;
  const bad = labels.slice(1);
  const tap = (cell: number) => {
    if (disabled || !ev || ev.cell !== cell || pickedRef.current.includes(live)) return;
    pickedRef.current = [...pickedRef.current, live];
    setPicked(pickedRef.current);
  };
  return (
    <div className="space-y-3" data-testid="game-catch">
      <p className="text-xs text-pretty text-fg-3">{t("catchHint")}</p>
      <div className="flex justify-between label-pixel">
        <span className="text-gain">{t("catchGood", { label: labels[0] ?? "" })}</span>
        <span className="nums text-fg-2">{t("catchCaught", { count: picked.length })}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: cells }, (_, cell) => {
          const here = ev && ev.cell === cell ? ev : undefined;
          const caught = here && picked.includes(live);
          return (
            <button
              key={cell}
              type="button"
              disabled={disabled}
              onClick={() => tap(cell)}
              data-testid="catch-cell"
              data-good={here ? String(here.good) : undefined}
              aria-label={here ? (here.good ? labels[0] : (bad[live % Math.max(bad.length, 1)] ?? "")) : "–"}
              className="relative grid aspect-square place-items-center rounded-md border-2 border-line-1 bg-surface-2 focus-ring"
            >
              <AnimatePresence>
                {here && (
                  <motion.span
                    key={live}
                    initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: caught ? 0.9 : 1 }}
                    exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.6 }}
                    transition={reduced ? { duration: 0 } : SPRING.snappy}
                    className={cn(
                      "absolute inset-1 grid place-items-center rounded-xs px-1 text-center text-xs font-semibold",
                      caught
                        ? "bg-gain text-on-semantic"
                        : here.good
                          ? "bg-accent-soft text-fg-1"
                          : "bg-surface-3 text-fg-2",
                    )}
                  >
                    {here.good ? labels[0] : bad[live % Math.max(bad.length, 1)]}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </div>
    </div>
  );
}
