"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TaskGame } from "@/features/game/types";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useTaskText } from "./task-text";

/*
 * The six task games (ADR-129). Small and quick: a phone, one thumb, under a minute. Each game only collects the
 * answer; the server grades it. Labels come from messages (companyTasks.items.<key>), the puzzle only holds indices.
 */
export interface GameProps {
  taskKey: string;
  puzzle: Record<string, unknown>;
  disabled: boolean;
  onAnswer: (answer: Record<string, unknown>) => void;
}

const tileBase =
  "flex min-h-14 items-center justify-center rounded-md border-2 px-1.5 py-2 text-center text-xs font-semibold text-pretty focus-ring transition-colors duration-fast";

/** Tap every tile that shows the target. */
function PickGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const tiles = (puzzle.tiles as number[]) ?? [];
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  return (
    <div className="space-y-4" data-testid="game-pick">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {tiles.map((label, i) => {
          const on = picked.includes(i);
          return (
            <motion.button
              key={i}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              whileTap={{ scale: 0.94 }}
              transition={SPRING.snappy}
              onClick={() => toggle(i)}
              className={cn(
                tileBase,
                on
                  ? "border-accent bg-accent-soft text-fg-1"
                  : "border-line-1 bg-surface-2 text-fg-2 hover:bg-surface-3",
              )}
            >
              {labels[label] ?? "?"}
            </motion.button>
          );
        })}
      </div>
      <Button block disabled={disabled} onClick={() => onAnswer({ picked })}>
        {t("done")}
      </Button>
    </div>
  );
}

/** Count the target tiles and enter the number. */
function CountGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const tiles = (puzzle.tiles as number[]) ?? [];
  const [count, setCount] = useState(0);
  return (
    <div className="space-y-4" data-testid="game-count">
      <div className="grid grid-cols-4 gap-1.5">
        {tiles.map((label, i) => (
          <div key={i} className={cn(tileBase, "min-h-11 border-line-1 bg-surface-2 text-fg-2")}>
            {labels[label] ?? "?"}
          </div>
        ))}
      </div>
      <Stepper label={t("countLabel")} value={count} onChange={setCount} disabled={disabled} />
      <Button block disabled={disabled} onClick={() => onAnswer({ count })}>
        {t("done")}
      </Button>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 p-2">
      <span className="pl-2 label-pixel text-fg-3">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="secondary"
          disabled={disabled || value <= 0}
          onClick={() => onChange(value - 1)}
          aria-label="−1"
        >
          −
        </Button>
        <span className="w-10 text-center nums text-lg font-semibold text-fg-1" aria-live="polite">
          {value}
        </span>
        <Button size="icon" variant="secondary" disabled={disabled} onClick={() => onChange(value + 1)} aria-label="+1">
          +
        </Button>
      </div>
    </div>
  );
}

/** One item at a time into the left or the right box. */
function SortGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const left = text.string(taskKey, "left");
  const right = text.string(taskKey, "right");
  const names = [...text.list(taskKey, "leftItems"), ...text.list(taskKey, "rightItems")];
  const items = (puzzle.items as number[]) ?? [];
  const [sides, setSides] = useState<number[]>([]);
  const current = items[sides.length];
  const put = (side: number) => {
    const next = [...sides, side];
    setSides(next);
    if (next.length === items.length) onAnswer({ sides: next });
  };
  return (
    <div className="space-y-4" data-testid="game-sort">
      <p className="text-center text-2xs text-fg-3">{t("itemsLeft", { count: items.length - sides.length })}</p>
      <div className="grid h-24 place-items-center">
        {current !== undefined && (
          <motion.div
            key={sides.length}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={SPRING.snappy}
            className="rounded-lg border-2 border-line-2 bg-surface-2 px-6 py-4 text-base font-semibold text-fg-1 shadow-1"
          >
            {names[current] ?? "?"}
          </motion.div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" disabled={disabled || current === undefined} onClick={() => put(0)}>
          ← {left}
        </Button>
        <Button variant="secondary" size="lg" disabled={disabled || current === undefined} onClick={() => put(1)}>
          {right} →
        </Button>
      </div>
    </div>
  );
}

/** Tap the entries in order of their numbers. */
function OrderGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const names = text.list(taskKey, "items");
  const unit = text.string(taskKey, "unit");
  const values = (puzzle.values as number[]) ?? [];
  const [order, setOrder] = useState<number[]>([]);
  const tap = (i: number) => {
    if (order.includes(i)) return;
    const next = [...order, i];
    setOrder(next);
    if (next.length === values.length) onAnswer({ order: next });
  };
  return (
    <div className="space-y-3" data-testid="game-order">
      <p className="text-xs text-pretty text-fg-3">{t("orderHint")}</p>
      <ul className="space-y-2">
        {values.map((v, i) => {
          const pos = order.indexOf(i);
          return (
            <li key={i}>
              <button
                type="button"
                disabled={disabled || pos >= 0}
                onClick={() => tap(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border-2 px-3 py-2.5 text-left text-sm focus-ring transition-colors duration-fast",
                  pos >= 0 ? "border-accent bg-accent-soft" : "border-line-1 bg-surface-2 hover:bg-surface-3",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-xs nums text-2xs font-bold",
                    pos >= 0 ? "bg-accent text-on-accent" : "bg-surface-3 text-fg-3",
                  )}
                >
                  {pos >= 0 ? pos + 1 : "·"}
                </span>
                <span className="min-w-0 flex-1 font-medium text-fg-1">{names[i] ?? "?"}</span>
                <span className="shrink-0 nums text-fg-2">
                  {v} {unit}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="sm" disabled={disabled || order.length === 0} onClick={() => setOrder([])}>
        {t("reset")}
      </Button>
    </div>
  );
}

/** Remember a sequence of symbols, then repeat it. */
function SeqGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const symbols = text.list(taskKey, "symbols");
  const sequence = (puzzle.sequence as number[]) ?? [];
  const showSeconds = Number(puzzle.show_seconds ?? 4);
  const [showing, setShowing] = useState(true);
  const [input, setInput] = useState<number[]>([]);
  useEffect(() => {
    const id = setTimeout(() => setShowing(false), showSeconds * 1000);
    return () => clearTimeout(id);
  }, [showSeconds]);
  const press = (s: number) => {
    const next = [...input, s];
    setInput(next);
    if (next.length === sequence.length) onAnswer({ sequence: next });
  };
  return (
    <div className="space-y-4" data-testid="game-seq">
      <p className="text-center label-pixel text-fg-2">{showing ? t("remember") : t("repeat")}</p>
      <div className="flex justify-center gap-1.5">
        {sequence.map((s, i) => (
          <span
            key={i}
            className={cn(
              "grid h-12 min-w-12 place-items-center rounded-md border-2 px-1.5 text-xs font-semibold",
              showing
                ? "border-accent bg-accent-soft text-fg-1"
                : input[i] !== undefined
                  ? "border-line-2 bg-surface-2 text-fg-1"
                  : "border-dashed border-line-1 text-fg-3",
            )}
          >
            {showing ? symbols[s] : input[i] !== undefined ? symbols[input[i]!] : i + 1}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {symbols.map((label, s) => (
          <Button key={s} variant="secondary" disabled={disabled || showing} onClick={() => press(s)}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** A short business sum. */
function MathGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const a = Number(puzzle.a ?? 0);
  const b = Number(puzzle.b ?? 0);
  const [value, setValue] = useState("");
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return (
    <form
      className="space-y-4"
      data-testid="game-math"
      onSubmit={(e) => {
        e.preventDefault();
        if (Number.isFinite(parsed) && value !== "") onAnswer({ value: parsed });
      }}
    >
      <p className="rounded-md bg-surface-2 px-4 py-3 text-base text-pretty text-fg-1">
        {text.question(taskKey, a, b)}
      </p>
      <label className="block space-y-1.5">
        <span className="block label-pixel text-fg-2">{t("mathLabel")}</span>
        <input
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9.,-]/g, ""))}
          className="h-12 w-full rounded-md border-2 border-line-2 bg-surface-1 px-3 nums text-lg text-fg-1 focus-ring"
          disabled={disabled}
          aria-label={t("mathLabel")}
        />
      </label>
      <Button type="submit" block disabled={disabled || value === ""}>
        {t("done")}
      </Button>
    </form>
  );
}

export function TaskGameView(props: GameProps & { game: TaskGame }) {
  switch (props.game) {
    case "pick":
      return <PickGame {...props} />;
    case "count":
      return <CountGame {...props} />;
    case "sort":
      return <SortGame {...props} />;
    case "order":
      return <OrderGame {...props} />;
    case "seq":
      return <SeqGame {...props} />;
    case "math":
      return <MathGame {...props} />;
  }
}
