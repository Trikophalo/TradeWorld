"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { burstConfetti } from "@/components/ui/effects";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { WorkTask } from "@/features/game/types";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCareerRefresh } from "../hooks";

const money = (cents: number) => formatMoney(cents, { whole: true });

export function useWorkTask(enabled: boolean) {
  return useQuery({ queryKey: ["career", "work-task"], queryFn: () => engine.workTask(), enabled, staleTime: 15_000 });
}

/** The current work task of the job (ADR-059): a short question with clear numbers. */
export function WorkTaskCard() {
  const t = useTranslations("workTask");
  const errorText = useGameErrorText();
  const refresh = useCareerRefresh();
  const query = useWorkTask(true);
  const [choice, setChoice] = useState<number | null>(null);
  const [result, setResult] = useState<{ taskId: string; correctIndex: number; correct: boolean } | null>(null);
  const [state, setState] = useState<ButtonState>("idle");
  const anchor = useRef<HTMLDivElement>(null);
  const task = query.data?.task ?? null;

  // A new task starts with a fresh choice (state adjusted during render).
  const [shownId, setShownId] = useState<string | null>(null);
  if ((task?.id ?? null) !== shownId) {
    setShownId(task?.id ?? null);
    setChoice(null);
    if (task) setResult(null);
  }

  if (!query.data) return null;

  if (!task) {
    return (
      <Card padding="md" data-testid="work-task">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <p className="mt-1 text-sm text-fg-3">
          {query.data.nextTaskAt ? (
            <>
              {t("next", { time: "" })}
              <Countdown target={Date.parse(query.data.nextTaskAt)} className="nums text-fg-1" />
            </>
          ) : (
            t("none")
          )}
        </p>
      </Card>
    );
  }

  const answered = result?.taskId === task.id ? result : null;
  const submit = async () => {
    if (choice === null) return;
    setState("loading");
    try {
      const r = await engine.submitWorkTask(crypto.randomUUID(), task.id, choice);
      setResult({ taskId: task.id, correctIndex: r.correctIndex, correct: r.correct });
      setState(r.correct ? "success" : "idle");
      if (r.correct) {
        void playSound("win");
        haptic("success");
        if (anchor.current) burstConfetti(anchor.current, 18);
        toast.success(t("correct"), t("correctText", { xp: r.xpAwarded, bonus: money(r.bonusCents) }), {
          silent: true,
        });
      } else {
        void playSound("error");
        toast.info(t("wrong"), t("wrongText", { xp: r.xpAwarded }));
      }
      window.setTimeout(() => void refresh(), 2_500);
    } catch (error) {
      setState("idle");
      toast.error(t("title"), errorText(error));
    }
  };

  return (
    <Card padding="lg" className="space-y-4 ring-1 ring-accent/50" data-testid="work-task">
      <div ref={anchor} className="flex items-baseline justify-between gap-3">
        <p className="label-pixel text-accent">{t("title")}</p>
        <span className="text-xs text-fg-3">
          {t("expires", { time: "" })}
          <Countdown target={Date.parse(task.expiresAt)} className="nums" />
        </span>
      </div>
      <Question task={task} />
      <div role="radiogroup" aria-label={t("title")} className="grid gap-2">
        {options(task, t).map((option, i) => {
          const isRight = answered?.correctIndex === i;
          const isWrong = answered && choice === i && !answered.correct;
          return (
            <motion.button
              key={i}
              type="button"
              role="radio"
              aria-checked={choice === i}
              disabled={Boolean(answered)}
              onClick={() => {
                setChoice(i);
                void playSound("tap");
              }}
              animate={{ scale: isRight ? 1.02 : 1 }}
              transition={SPRING.bouncy}
              className={cn(
                "rounded-md border px-3 py-2.5 text-left text-sm focus-ring transition-colors duration-fast",
                isRight
                  ? "border-gain bg-gain-soft text-fg-1"
                  : isWrong
                    ? "border-loss bg-loss-soft text-fg-1"
                    : choice === i
                      ? "border-accent bg-accent-soft text-fg-1"
                      : "border-line-1 text-fg-2 hover:bg-surface-2",
              )}
            >
              {option}
            </motion.button>
          );
        })}
      </div>
      {!answered && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-pretty text-fg-3">{t("reward")}</p>
          <Button state={state} disabled={choice === null} onClick={() => void submit()}>
            {t("submit")}
          </Button>
        </div>
      )}
    </Card>
  );
}

type T = ReturnType<typeof useTranslations<"workTask">>;

function Question({ task }: { task: WorkTask }) {
  const t = useTranslations("workTask");
  if (task.kind === "finance_choice") {
    return (
      <p className="text-pretty text-fg-1">
        {t("finance.question", { amount: money(task.params.amountCents), years: task.params.years })}
      </p>
    );
  }
  if (task.kind === "sales_pick") return <p className="text-pretty text-fg-1">{t("sales.question")}</p>;
  const p = task.params;
  return (
    <div className="space-y-1">
      <p className="text-pretty text-fg-1">{t("analyst.question")}</p>
      <ul className="nums text-sm text-fg-2">
        <li>{t("analyst.revenue", { amount: money(p.revenueCents) })}</li>
        <li>{t("analyst.cogs", { percent: formatBps(p.cogsBps).replace("+", "") })}</li>
        <li>{t("analyst.fixed", { amount: money(p.fixedCents) })}</li>
        <li>{t("analyst.marketing", { amount: money(p.marketingCents) })}</li>
      </ul>
    </div>
  );
}

function options(task: WorkTask, t: T): string[] {
  if (task.kind === "finance_choice") {
    return task.params.offers.map(
      (o, i) =>
        `${t("finance.offer", { n: i + 1 })}: ${t("finance.rate", { rate: formatBps(o.rateBps).replace("+", "") })}, ${t(
          "finance.fee",
          { fee: money(o.feeCents) },
        )}`,
    );
  }
  if (task.kind === "sales_pick") {
    return task.params.customers.map(
      (c, i) =>
        `${t("sales.customer", { n: i + 1 })}: ${t("sales.units", { units: c.units, price: formatMoney(c.priceCents) })}, ${t(
          "sales.cost",
          { cost: formatMoney(c.unitCostCents) },
        )}, ${t("sales.service", { service: money(c.serviceCents) })}`,
    );
  }
  return task.params.options.map((cents) => money(cents));
}
