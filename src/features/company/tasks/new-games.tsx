"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { GameProps } from "./games";
import { useTaskText } from "./task-text";

/*
 * Five more task games (ADR-180): restock, receipts, offer, pattern and shelf. Phone first: every target is a big
 * button, nothing needs dragging. Like the other games they only collect the answer; the server grades it.
 */

const tile =
  "flex min-h-12 items-center justify-center rounded-md border-2 px-1.5 py-2 text-center text-sm font-semibold focus-ring transition-colors duration-fast";

/** Restock: order up to the target for each item with − and +. */
export function RestockGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const stock = useMemo(() => (puzzle.stock as number[]) ?? [], [puzzle.stock]);
  const target = useMemo(() => (puzzle.target as number[]) ?? [], [puzzle.target]);
  const [values, setValues] = useState<number[]>(() => stock.map(() => 0));
  const step = (i: number, d: number) =>
    setValues((v) => v.map((x, k) => (k === i ? Math.max(0, Math.min(99, x + d)) : x)));
  return (
    <div className="space-y-3" data-testid="game-restock">
      <p className="text-xs text-pretty text-fg-3">{t("restockHint")}</p>
      <ul className="space-y-2">
        {stock.map((s, i) => (
          <li key={i} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2" data-testid="restock-item">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-fg-1">{labels[i] ?? "?"}</span>
              <span className="block nums text-2xs text-fg-3">
                {t("restockStock", { stock: s, target: target[i] ?? 0 })}
              </span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => step(i, -1)}
              aria-label={t("less")}
            >
              −
            </Button>
            <span className="w-8 text-center nums text-base font-semibold text-fg-1" data-testid="restock-value">
              {values[i]}
            </span>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => step(i, 1)} aria-label={t("more")}>
              +
            </Button>
          </li>
        ))}
      </ul>
      <Button block disabled={disabled} onClick={() => onAnswer({ values })}>
        {t("done")}
      </Button>
    </div>
  );
}

/** Receipts: tap the receipts that add up to the total. */
export function ReceiptsGame({ puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const amounts = useMemo(() => (puzzle.amounts as number[]) ?? [], [puzzle.amounts]);
  const target = Number(puzzle.target ?? 0);
  const [picked, setPicked] = useState<number[]>([]);
  const sum = picked.reduce((s, i) => s + (amounts[i] ?? 0), 0);
  const eur = (v: number) => formatMoney(v * 100, { whole: true });
  return (
    <div className="space-y-3" data-testid="game-receipts">
      <p className="text-xs text-pretty text-fg-3">{t("receiptsHint", { total: eur(target) })}</p>
      <p
        className={cn(
          "nums text-sm font-semibold",
          sum === target ? "text-gain" : sum > target ? "text-loss" : "text-fg-2",
        )}
      >
        {t("receiptsSum", { sum: eur(sum), total: eur(target) })}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {amounts.map((a, i) => {
          const on = picked.includes(i);
          return (
            <motion.button
              key={i}
              type="button"
              whileTap={{ scale: 0.94 }}
              transition={SPRING.snappy}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))}
              data-testid="receipt"
              className={cn(
                "nums",
                tile,
                on ? "border-accent bg-accent-soft text-fg-1" : "border-line-1 bg-surface-2 text-fg-2",
              )}
            >
              {eur(a)}
            </motion.button>
          );
        })}
      </div>
      <Button block disabled={disabled || picked.length === 0} onClick={() => onAnswer({ picked })}>
        {t("done")}
      </Button>
    </div>
  );
}

/** One choice per round, shown one round at a time (offer, pattern). */
function useRounds(count: number, onAnswer: (answer: Record<string, unknown>) => void) {
  const [choices, setChoices] = useState<number[]>([]);
  const choose = (c: number) => {
    const next = [...choices, c];
    setChoices(next);
    if (next.length >= count) onAnswer({ choices: next });
  };
  return { round: choices.length, choose };
}

/** Offer: per round the customer who brings the most revenue (price x quantity). */
export function OfferGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const offers = useMemo(() => (puzzle.offers as [number, number][][]) ?? [], [puzzle.offers]);
  const { round, choose } = useRounds(offers.length, onAnswer);
  const current = offers[Math.min(round, offers.length - 1)] ?? [];
  return (
    <div className="space-y-3" data-testid="game-offer">
      <p className="text-xs text-pretty text-fg-3">{t("offerHint")}</p>
      <p className="nums text-xs text-fg-3">
        {t("haggleRound", { round: Math.min(round + 1, offers.length), total: offers.length })}
      </p>
      <div className="grid gap-2">
        {current.map(([price, qty], i) => (
          <motion.button
            key={`${round}-${i}`}
            type="button"
            whileTap={{ scale: 0.97 }}
            transition={SPRING.snappy}
            disabled={disabled || round >= offers.length}
            onClick={() => choose(i)}
            data-testid="offer-option"
            className={cn(
              tile,
              "justify-between border-line-1 bg-surface-2 px-3 text-left text-fg-1 hover:bg-surface-3",
            )}
          >
            <span className="min-w-0 truncate">{labels[(round * 3 + i) % Math.max(labels.length, 1)] ?? "?"}</span>
            <span className="nums text-xs font-normal text-fg-3">
              {t("offerLine", { qty, price: formatMoney(price * 100, { whole: true }) })}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/** Pattern: per round the next number of the row. */
export function PatternGame({ puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const rows = useMemo(() => (puzzle.rows as { seq: number[]; options: number[] }[]) ?? [], [puzzle.rows]);
  const { round, choose } = useRounds(rows.length, onAnswer);
  const current = rows[Math.min(round, rows.length - 1)];
  return (
    <div className="space-y-3" data-testid="game-pattern">
      <p className="text-xs text-pretty text-fg-3">{t("patternHint")}</p>
      <p className="nums text-xs text-fg-3">
        {t("haggleRound", { round: Math.min(round + 1, rows.length), total: rows.length })}
      </p>
      <p
        className="rounded-md bg-surface-2 px-3 py-3 text-center nums text-lg font-semibold text-fg-1"
        data-testid="pattern-row"
      >
        {current?.seq.map((v) => v.toLocaleString("de-DE")).join(" · ")} · ?
      </p>
      <div className="grid grid-cols-3 gap-2">
        {current?.options.map((o, i) => (
          <motion.button
            key={`${round}-${i}`}
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={SPRING.snappy}
            disabled={disabled || round >= rows.length}
            onClick={() => choose(i)}
            data-testid="pattern-option"
            className={cn("nums", tile, "border-line-1 bg-surface-2 text-fg-1 hover:bg-surface-3")}
          >
            {o.toLocaleString("de-DE")}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/** Shelf: a 4 x 4 shelf; tap a gap to cycle through the four goods until no row, column or box has one twice. */
export function ShelfGame({ taskKey, puzzle, disabled, onAnswer }: GameProps) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const labels = text.list(taskKey, "labels");
  const given = useMemo(() => (puzzle.grid as number[]) ?? [], [puzzle.grid]);
  const [grid, setGrid] = useState<number[]>(() => given.map((v) => v));
  const cycle = (i: number) => setGrid((g) => g.map((v, k) => (k === i ? (v + 1) % 4 : v)));
  const filled = grid.every((v) => v >= 0);
  return (
    <div className="space-y-3" data-testid="game-shelf">
      <p className="text-xs text-pretty text-fg-3">{t("shelfHint")}</p>
      <div className="mx-auto grid max-w-72 grid-cols-4 gap-1.5">
        {grid.map((v, i) => {
          const fixed = given[i] !== undefined && given[i]! >= 0;
          const r = Math.floor(i / 4);
          const c = i % 4;
          return (
            <button
              key={i}
              type="button"
              disabled={disabled || fixed}
              onClick={() => cycle(i)}
              data-testid={fixed ? "shelf-given" : "shelf-gap"}
              aria-label={t("shelfCell", {
                row: r + 1,
                col: c + 1,
                item: v >= 0 ? (labels[v] ?? "?") : t("shelfEmpty"),
              })}
              className={cn(
                tile,
                "aspect-square min-h-0 text-xs",
                c === 1 && "mr-1",
                r === 1 && "mb-1",
                fixed
                  ? "border-line-1 bg-surface-3 text-fg-2"
                  : v >= 0
                    ? "border-accent bg-accent-soft text-fg-1"
                    : "border-dashed border-line-2 bg-surface-1 text-fg-3",
              )}
            >
              {v >= 0 ? (labels[v] ?? "?") : "+"}
            </button>
          );
        })}
      </div>
      <Button block disabled={disabled || !filled} onClick={() => onAnswer({ grid })}>
        {t("done")}
      </Button>
    </div>
  );
}
