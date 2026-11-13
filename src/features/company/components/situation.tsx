"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import type { CompanyEventStep } from "@/config/company-events";
import { demoFinishEventStep, demoTriggerCompanyEvent } from "@/features/game/demo-engine";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { CompanyEvent, CompanyEventState } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { archetypeOf } from "@/lib/sim/company-events";
import { playSound } from "@/lib/sound";
import { isDemoMode } from "@/lib/supabase/env";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useCompanyEvent, useCompanyNews } from "../hooks";
import { useCompanyStory } from "../story";
import { useCompanyWriter } from "../use-company-writer";

const cfg = BALANCE.companyEvents;
const pct = (bps: number) => `${Math.round(bps / 100)} %`;
const PIXEL = "rounded-xs border-2 [box-shadow:0_4px_0_0_var(--line-2)]";

/** Effect of the event at its severity, as short chips ("Nachfrage −20 %"). */
function useEffectChips(e: CompanyEvent) {
  const t = useTranslations("companyEvents.effects");
  const a = archetypeOf(e.archetype);
  if (!a) return [];
  const scale = cfg.severityScale[e.severity - 1]!;
  const chips: { label: string; good: boolean }[] = [];
  const add = (key: "demand" | "capacity" | "cost", v: number | undefined) => {
    if (!v) return;
    const value = Math.round(v * scale * 100);
    const good = key === "cost" ? value < 0 : value > 0;
    chips.push({ label: t(key, { value: `${value > 0 ? "+" : "−"}${Math.abs(value)} %` }), good });
  };
  add("demand", a.effect.demand);
  add("capacity", a.effect.capacity);
  add("cost", a.effect.cost);
  return chips;
}

/**
 * The company's current crisis or chance (ADR-091): headline, deadline, effect, the strategies and the steps on the
 * way. The founder acts; employees watch (`companyId` set).
 */
export function SituationCard({ companyId }: { companyId?: string | null }) {
  const t = useTranslations("companyEvents");
  const state = useCompanyEvent(companyId);
  const data = state.data;
  useCompanyWriter(data);

  if (state.isPending) return <Skeleton className="h-40 w-full rounded-xs" />;
  if (!data) return null;
  if (!data.event) {
    return (
      <Card padding="md" className="flex flex-wrap items-center gap-3" data-testid="situation-calm">
        <span className="grid size-10 place-items-center rounded-xs bg-surface-2 text-gain">
          <PixelIcon {...UI_ICONS.star} scale={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-fg-1">{t("noEvent")}</span>
          <span className="block text-xs text-pretty text-fg-3">{t("noEventText")}</span>
        </span>
        {isDemoMode && data.canAct && <DemoTrigger />}
      </Card>
    );
  }
  return <ActiveSituation state={data} event={data.event} />;
}

function DemoTrigger() {
  const t = useTranslations("companyEvents");
  const client = useQueryClient();
  return (
    <button
      type="button"
      className="text-xs text-accent underline-offset-2 focus-ring hover:underline"
      onClick={() => {
        demoTriggerCompanyEvent();
        void client.invalidateQueries({ queryKey: ["company"] });
      }}
      data-testid="demo-trigger-event"
    >
      {t("demoTrigger")}
    </button>
  );
}

function ActiveSituation({ state, event }: { state: CompanyEventState; event: CompanyEvent }) {
  const t = useTranslations("companyEvents");
  const story = useCompanyStory(state.company, state.profileWords);
  const chips = useEffectChips(event);
  const a = archetypeOf(event.archetype);
  const crisis = event.polarity === "crisis";
  const lastsUntil = Date.parse(event.resolvedAt ?? event.deadlineAt) + (a?.lastsHours ?? 0) * 3_600_000;
  const open = event.status === "open";
  const acting = state.canAct && (event.status === "open" || event.status === "in_force");

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING.smooth}
      className={cn(
        PIXEL,
        "space-y-4 bg-surface-1 p-4 sm:p-5",
        crisis
          ? "border-loss/60 [box-shadow:0_4px_0_0_var(--loss)]"
          : "border-gain/60 [box-shadow:0_4px_0_0_var(--gain)]",
      )}
      aria-label={t("title")}
      data-testid="situation"
      data-status={event.status}
      data-archetype={event.archetype}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={crisis ? "loss" : "gain"}>{crisis ? t("crisis") : t("chance")}</Badge>
        <span className="font-pixel text-2xs text-fg-2 uppercase">{story.archetypeName(event.archetype)}</span>
        <span
          className="flex gap-0.5"
          aria-label={t(`severity.${event.severity}`)}
          title={t(`severity.${event.severity}`)}
        >
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "size-2 border border-bg",
                i <= event.severity ? (crisis ? "bg-loss" : "bg-gain") : "bg-surface-3",
              )}
            />
          ))}
        </span>
        <Badge className="ml-auto">{t(`status.${event.status}`)}</Badge>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-balance text-fg-1" data-testid="situation-headline">
          {story.eventHeadline(event)}
        </h2>
        <p className="text-sm text-pretty text-fg-2">{story.eventBody(event)}</p>
        <div className="flex flex-wrap items-center gap-2">
          {event.aiCause && <Badge tone="accent">{event.aiCause}</Badge>}
          {chips.map((c) => (
            <span
              key={c.label}
              className={cn(
                "rounded-xs border px-1.5 py-0.5 text-xs font-semibold",
                c.good ? "border-gain/40 bg-gain-soft text-gain" : "border-loss/40 bg-loss-soft text-loss",
              )}
            >
              {c.label}
            </span>
          ))}
          {event.aiHeadline && <span className="font-pixel text-2xs text-fg-3 uppercase">{t("aiBadge")}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xs bg-surface-2 px-3 py-2">
          <p className="text-2xs text-fg-3">{open ? t("deadline") : t("lasts")}</p>
          <Countdown target={open ? Date.parse(event.deadlineAt) : lastsUntil} className="font-semibold text-fg-1" />
        </div>
        <div className="rounded-xs bg-surface-2 px-3 py-2">
          <p className="text-2xs text-fg-3">{t("progress")}</p>
          <p className="font-semibold text-fg-1">{pct(Math.round(event.mitigation * 10_000))}</p>
        </div>
      </div>

      {event.status === "solved" && (
        <p className="rounded-xs bg-gain-soft px-3 py-2 text-sm text-gain" data-testid="situation-solved">
          {crisis ? t("solvedText") : t("solvedChance")}
        </p>
      )}
      {!state.canAct && <p className="text-xs text-pretty text-fg-3">{t("employeeHint")}</p>}

      {acting && !event.strategy && <StrategyPicker state={state} event={event} />}
      {event.strategy && <StepPath state={state} event={event} acting={acting} />}
    </motion.section>
  );
}

/** One card per strategy: what it does, how many steps, the first price and chance, how much it helps. */
function StrategyPicker({ state, event }: { state: CompanyEventState; event: CompanyEvent }) {
  const t = useTranslations("companyEvents");
  const story = useCompanyStory(state.company, state.profileWords);
  const errorText = useGameErrorText();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const a = archetypeOf(event.archetype);
  if (!a) return null;

  const choose = async (strategy: string) => {
    setBusy(strategy);
    try {
      const next = await engine.chooseEventStrategy(crypto.randomUUID(), event.id, strategy);
      client.setQueryData(["company", "event", "mine"], next);
      haptic("success");
      void playSound("tap");
      toast.success(t("chosen"), story.strategyName(event.archetype, strategy), { silent: true });
      void client.invalidateQueries({ queryKey: ["company"] });
    } catch (error) {
      toast.error(t("chooseTitle"), errorText(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3" data-testid="strategy-picker">
      <div>
        <p className="font-pixel text-sm text-fg-1 uppercase">{t("chooseTitle")}</p>
        <p className="text-xs text-pretty text-fg-3">{t("chooseHint")}</p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {a.strategies.map((s, i) => {
          const option = event.options.find((o) => o.strategy === s.key);
          return (
            <motion.li
              key={s.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING.smooth, delay: i * 0.05 }}
              className={cn(PIXEL, "flex flex-col gap-2 border-line-2 bg-surface-2 p-3")}
              data-strategy={s.key}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-fg-1">{story.strategyName(event.archetype, s.key)}</p>
                <span className="text-xs text-fg-3">
                  {s.steps.length > 0 ? t("steps", { count: s.steps.length }) : t("noSteps")}
                </span>
              </div>
              <p className="text-xs text-pretty text-fg-2">
                {story.strategyText(event.archetype, s.key, `${event.id}:${s.key}`)}
              </p>
              {s.steps.length > 0 && (
                <ol className="flex flex-wrap gap-1">
                  {s.steps.map((step) => (
                    <li key={step.key} className="rounded-xs bg-surface-3 px-1.5 py-0.5 text-2xs text-fg-2">
                      {story.stepName(event.archetype, step.key)}
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
                {s.steps.length > 0 && option && (
                  <>
                    <span className="nums">{formatMoney(option.firstStepCostCents, { whole: true })}</span>
                    <span className="nums">
                      {t("chance")} {pct(option.firstStepSuccessBps)}
                    </span>
                  </>
                )}
                {s.mitigation > 0 && (
                  <span className="text-gain">{t("mitigation", { percent: Math.round(s.mitigation * 100) })}</span>
                )}
              </div>
              <Button
                size="sm"
                variant={s.steps.length > 0 ? "primary" : "secondary"}
                state={busy === s.key ? "loading" : "idle"}
                disabled={busy !== null}
                onClick={() => void choose(s.key)}
              >
                {t("choose")}
              </Button>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

/** The chosen strategy as a path of steps: done, failed, running, next, later. */
function StepPath({ state, event, acting }: { state: CompanyEventState; event: CompanyEvent; acting: boolean }) {
  const t = useTranslations("companyEvents");
  const tb = useTranslations("skills.branches");
  const story = useCompanyStory(state.company, state.profileWords);
  const errorText = useGameErrorText();
  const client = useQueryClient();
  const [startState, setStartState] = useState<ButtonState>("idle");
  const a = archetypeOf(event.archetype);
  const strategy = a?.strategies.find((s) => s.key === event.strategy);
  if (!a || !strategy) return null;
  const mine = event.steps.filter((s) => s.strategy === strategy.key);
  const running = mine.find((s) => s.status === "running");
  const doneCount = mine.filter((s) => s.status === "succeeded").length;

  const start = async () => {
    setStartState("loading");
    try {
      const next = await engine.startEventStep(crypto.randomUUID(), event.id);
      client.setQueryData(["company", "event", "mine"], next);
      haptic("success");
      void playSound("coin");
      setStartState("success");
      toast.success(t("started"), undefined, { silent: true });
      void client.invalidateQueries({ queryKey: ["company"] });
      window.setTimeout(() => setStartState("idle"), 800);
    } catch (error) {
      setStartState("idle");
      toast.error(t("failedStart"), errorText(error));
    }
  };

  const switchStrategy = async () => {
    // Choosing again resets the path on the server; here we only re-open the picker.
    client.setQueryData<CompanyEventState>(["company", "event", "mine"], (d) =>
      d?.event ? { ...d, event: { ...d.event, strategy: null } } : d,
    );
  };

  return (
    <div className="space-y-3" data-testid="step-path">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-pixel text-sm text-fg-1 uppercase">{story.strategyName(event.archetype, strategy.key)}</p>
        {acting && strategy.steps.length > 0 && !running && event.status !== "solved" && (
          <button
            type="button"
            onClick={() => void switchStrategy()}
            className="text-xs text-fg-3 focus-ring hover:text-fg-1 hover:underline"
            title={t("switchHint")}
          >
            {t("switch")}
          </button>
        )}
      </div>
      <ol className="relative space-y-2 border-l-2 border-dashed border-line-2 pl-4">
        {strategy.steps.map((step, idx) => {
          const tries = mine.filter((s) => s.key === step.key);
          const last = tries.at(-1);
          const status =
            last?.status === "succeeded"
              ? "done"
              : last?.status === "running"
                ? "running"
                : idx === doneCount
                  ? last?.status === "failed"
                    ? "failed"
                    : "next"
                  : "later";
          return (
            <motion.li
              key={step.key}
              layout
              className={cn(
                "relative rounded-xs border-2 p-3",
                status === "done" && "border-gain/40 bg-gain-soft",
                status === "running" && "border-accent bg-accent-soft",
                status === "failed" && "border-loss/50 bg-loss-soft",
                status === "next" && "border-line-2 bg-surface-2",
                status === "later" && "border-line-1 bg-surface-1 opacity-60",
              )}
              data-step={step.key}
              data-step-status={status}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-4 -left-[23px] size-3 border-2 border-bg",
                  status === "done"
                    ? "bg-gain"
                    : status === "running"
                      ? "bg-accent"
                      : status === "failed"
                        ? "bg-loss"
                        : "bg-surface-3",
                )}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-fg-1">{story.stepName(event.archetype, step.key)}</p>
                <span className="text-2xs text-fg-3">
                  {status === "done" ? t("stepOk") : status === "failed" ? t("stepFailed") : `${step.hours} h`}
                </span>
              </div>
              <StepNeeds step={step} branchLabel={step.branch ? tb(`${step.branch}.name`) : null} />
              {status === "running" && last && (
                <RunningBar
                  startedAt={Date.parse(last.startedAt)}
                  endsAt={Date.parse(last.endsAt)}
                  chanceBps={last.successBps}
                />
              )}
              {(status === "next" || status === "failed") && acting && event.next && event.next.key === step.key && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    state={startState}
                    disabled={!event.next.staffOk}
                    onClick={() => void start()}
                    data-testid="start-step"
                  >
                    {status === "failed"
                      ? t("retry", { cost: formatMoney(event.next.costCents, { whole: true }) })
                      : t("start", { cost: formatMoney(event.next.costCents, { whole: true }) })}
                  </Button>
                  <span className="nums text-xs text-fg-2">
                    {t("chance")} <strong className="text-fg-1">{pct(event.next.successBps)}</strong>
                  </span>
                  {!event.next.staffOk && (
                    <span className="text-xs text-loss">{t("staff", { count: step.staff ?? 0 })}</span>
                  )}
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
      {isDemoMode && running && acting && <DemoFinish />}
    </div>
  );
}

function StepNeeds({ step, branchLabel }: { step: CompanyEventStep; branchLabel: string | null }) {
  const t = useTranslations("companyEvents");
  const needs = [
    branchLabel ? t("knowHow", { branch: branchLabel }) : null,
    step.staff ? t("staff", { count: step.staff }) : null,
    step.capacityHit ? t("capacity", { percent: Math.round(step.capacityHit * 100) }) : null,
  ].filter(Boolean);
  if (needs.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {needs.map((n) => (
        <li key={n} className="rounded-xs bg-surface-3 px-1.5 py-0.5 text-2xs text-fg-2">
          {n}
        </li>
      ))}
    </ul>
  );
}

/** A running step: how much is done, the time left and the chance it works. */
function RunningBar({ startedAt, endsAt, chanceBps }: { startedAt: number; endsAt: number; chanceBps: number }) {
  const t = useTranslations("companyEvents");
  const now = useClock();
  const progress = now === null ? 0 : Math.min(1, Math.max(0, (now - startedAt) / Math.max(1, endsAt - startedAt)));
  return (
    <div className="mt-2 space-y-1">
      <div className="relative h-2 overflow-hidden rounded-xs bg-surface-3">
        <span
          className="absolute inset-y-0 left-0 w-full origin-left bg-accent transition-transform duration-slow ease-linear"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
      <p className="flex justify-between text-2xs text-fg-3">
        <span>
          {t("chance")} {pct(chanceBps)}
        </span>
        <Countdown target={endsAt} className="text-fg-2" />
      </p>
    </div>
  );
}

function DemoFinish() {
  const t = useTranslations("companyEvents");
  const client = useQueryClient();
  return (
    <button
      type="button"
      className="text-xs text-accent underline-offset-2 focus-ring hover:underline"
      onClick={() => {
        demoFinishEventStep();
        void client.invalidateQueries({ queryKey: ["company"] });
      }}
      data-testid="demo-finish-step"
    >
      {t("demoFinish")}
    </button>
  );
}

/** The company's news (ADR-091): for the founder on the company page, for the staff in the job tab. */
export function CompanyNewsCard({ companyId, title }: { companyId?: string | null; title?: string }) {
  const t = useTranslations("companyNews");
  const news = useCompanyNews(companyId);
  const story = useCompanyStory(news.data?.company, news.data?.profileWords ?? null);
  const [all, setAll] = useState(false);
  const items = news.data?.items ?? [];
  const shown = all ? items : items.slice(0, 5);
  return (
    <Card padding="lg" className="space-y-3" data-testid="company-news">
      <p className="label-pixel text-fg-2">{title ?? t("title")}</p>
      {news.isPending ? (
        <Skeleton className="h-24 w-full rounded-xs" />
      ) : items.length === 0 ? (
        <p className="text-sm text-fg-3">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {shown.map((item) => {
              const text = story.newsText(item);
              if (!text) return null;
              return (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3 border-l-2 border-line-2 pl-3"
                  data-kind={item.kind}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-pretty text-fg-1">{text}</span>
                    <span className="block text-2xs text-fg-3">
                      {new Date(item.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      {items.length > 5 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="text-sm text-accent focus-ring hover:underline"
        >
          {all ? t("less") : t("more")}
        </button>
      )}
    </Card>
  );
}
