"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { burstConfetti } from "@/components/ui/effects";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { UI_ICONS } from "@/components/pixel/art";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { CompanyTask, CompanyTaskPlay, CompanyTaskResult, CompanyTasks } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";
import { TaskGameView } from "./games";
import { useTaskText } from "./task-text";

const cfg = BALANCE.companyTasks;
export const COMPANY_TASKS_KEY = ["company", "tasks"] as const;

export function useCompanyTasks(enabled = true) {
  return useQuery({
    queryKey: COMPANY_TASKS_KEY,
    queryFn: () => engine.companyTasks(),
    refetchInterval: 15_000,
    enabled,
  });
}

/**
 * The task board of a player company (ADR-129): what has to be done, who does it, what it is worth. The founder
 * hands out anything and sets the hierarchy; employees do their own tasks and pass work to their reports.
 */
export function TaskBoard({ preview }: { preview?: CompanyTasks } = {}) {
  const t = useTranslations("companyTasks");
  const live = useCompanyTasks(!preview);
  const data = preview ?? live.data;
  const [delegating, setDelegating] = useState<CompanyTask | null>(null);
  const [playing, setPlaying] = useState<CompanyTask | null>(null);

  if (!data) {
    return (
      <Card padding="lg" className="space-y-3" aria-hidden>
        <Skeleton className="h-5 w-32" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-md" />
        ))}
      </Card>
    );
  }

  return (
    <div className="space-y-5" data-testid="task-board">
      <Card padding="lg" className="space-y-4">
        <div>
          <p className="label-pixel text-fg-2">{t("title")}</p>
          <p className="mt-1 text-sm text-pretty text-fg-3">
            {data.role === "founder" ? t("intro") : t("employeeIntro")}
          </p>
        </div>
        {data.tasks.length === 0 ? (
          <EmptyState
            art={<PixelIcon {...UI_ICONS.briefcase} scale={4} />}
            title={t("empty")}
            description={t("emptyText")}
            className="py-6"
          />
        ) : (
          <ul className="space-y-2.5">
            <AnimatePresence initial={false}>
              {data.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  data={data}
                  onDelegate={() => setDelegating(task)}
                  onPlay={() => setPlaying(task)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
        {data.role === "founder" && <AutoAiRow data={data} />}
      </Card>

      {data.role === "founder" ? <HierarchyCard data={data} /> : <MyTeamCard data={data} />}
      {data.history.length > 0 && <HistoryCard data={data} />}

      <DelegateSheet data={data} task={delegating} onClose={() => setDelegating(null)} onPlay={setPlaying} />
      <PlaySheet task={playing} onClose={() => setPlaying(null)} />
    </div>
  );
}

function statusLine(t: ReturnType<typeof useTranslations<"companyTasks">>, task: CompanyTask) {
  if (task.status === "open") return t("status.open");
  if (task.mine) return t("status.mine");
  if (task.status === "playing") return t("status.playing", { name: task.assignee ?? "?" });
  if (task.assignedBy && task.assignedBy !== task.assignee)
    return t("status.assignedBy", { name: task.assignee ?? "?", by: task.assignedBy });
  return t("status.assigned", { name: task.assignee ?? "?" });
}

function TaskRow({
  task,
  data,
  onDelegate,
  onPlay,
}: {
  task: CompanyTask;
  data: CompanyTasks;
  onDelegate: () => void;
  onPlay: () => void;
}) {
  const t = useTranslations("companyTasks");
  const tb = useTranslations("skills.branches");
  const text = useTaskText();
  const now = useClock();
  const due = Date.parse(task.dueAt);
  const urgent = now !== null && due - now < 10 * 60_000;
  const canPlay = task.status === "open" || ((task.status === "assigned" || task.status === "playing") && task.mine);
  const penalty = Math.trunc((task.valueCents * cfg.penaltyBps) / 10_000);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={SPRING.smooth}
      className={cn(
        "rounded-md border bg-surface-1 p-3",
        task.mine ? "border-accent" : urgent ? "border-warn" : "border-line-1",
      )}
      data-testid={`task-${task.key}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="info">{t(`games.${task.game}`)}</Badge>
        <Badge>{tb(`${task.branch}.name` as Parameters<typeof tb>[0])}</Badge>
        <span className={cn("ml-auto flex items-center gap-1 text-2xs", urgent ? "text-warn" : "text-fg-3")}>
          {t("due")} <Countdown target={due} />
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-fg-1">{text.name(task.key)}</p>
      <p className="mt-0.5 text-xs text-pretty text-fg-3">{text.how(task.key)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
        <span className="nums font-semibold text-gain">
          {t("value", { amount: formatMoney(task.valueCents, { whole: true }) })}
        </span>
        <span className="nums text-loss">{t("penalty", { amount: formatMoney(penalty, { whole: true }) })}</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="min-w-0 text-2xs text-pretty text-fg-2">
          {task.status === "ai" && task.aiDoneAt ? (
            <>
              {t("status.ai")} <Countdown target={Date.parse(task.aiDoneAt)} />
            </>
          ) : (
            statusLine(t, task)
          )}
        </p>
        <div className="flex shrink-0 gap-2">
          {task.canDelegate && (data.role === "founder" || task.mine || task.status === "open") && (
            <Button size="sm" variant="secondary" onClick={onDelegate}>
              {t("delegate")}
            </Button>
          )}
          {canPlay && (
            <Button size="sm" onClick={onPlay}>
              {task.status === "open" ? t("take") : t("doIt")}
            </Button>
          )}
        </div>
      </div>
    </motion.li>
  );
}

function useTaskAction() {
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  return async (run: () => Promise<CompanyTasks>, done: string, doneText?: string) => {
    try {
      const next = await run();
      client.setQueryData(COMPANY_TASKS_KEY, next);
      haptic("success");
      toast.success(done, doneText, { silent: true });
      void refresh();
      return true;
    } catch (error) {
      toast.error(done, errorText(error));
      return false;
    }
  };
}

function DelegateSheet({
  data,
  task,
  onClose,
  onPlay,
}: {
  data: CompanyTasks;
  task: CompanyTask | null;
  onClose: () => void;
  onPlay: (task: CompanyTask) => void;
}) {
  const t = useTranslations("companyTasks");
  const tt = useTranslations("careerTiers");
  const text = useTaskText();
  const act = useTaskAction();
  const now = useClock();
  const [busy, setBusy] = useState<string | null>(null);
  if (!task) return null;

  const targets = data.people.filter((p) => !p.isMe && (data.role === "founder" || p.reportsToMe));
  const aiLate = now !== null && now + data.aiMinutes * 60_000 > Date.parse(task.dueAt);
  const give = async (to: string, name: string) => {
    setBusy(to);
    const ok = await act(
      () => engine.delegateCompanyTask(crypto.randomUUID(), task.id, to),
      t("delegated"),
      t("delegatedText", { name }),
    );
    setBusy(null);
    if (ok) onClose();
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("delegateTitle")}
      description={t("delegateIntro", { name: text.name(task.key) })}
    >
      <div className="space-y-2 px-5 pb-5" data-testid="delegate-sheet">
        <ChoiceRow
          title={t("delegateMe")}
          hint={t("delegateMeHint")}
          onClick={() => {
            onClose();
            onPlay(task);
          }}
        />
        {targets.map((p) => (
          <ChoiceRow
            key={p.nickname}
            title={p.nickname}
            hint={t("delegatePersonHint", {
              tier: tt(p.tier as Parameters<typeof tt>[0]),
              open: p.openTasks,
            })}
            busy={busy === p.nickname}
            onClick={() => void give(p.nickname, p.nickname)}
          />
        ))}
        {data.canUseAi && (
          <ChoiceRow
            title={t("delegateAi")}
            hint={
              aiLate
                ? t("delegateAiLate")
                : t("delegateAiHint", {
                    minutes: data.aiMinutes,
                    chance: Math.round(cfg.ai.chanceBps / 100),
                    share: Math.round(cfg.ai.valueBps / 100),
                  })
            }
            warn={aiLate}
            busy={busy === "ai"}
            onClick={() => void give("ai", t("delegateAi"))}
          />
        )}
        {targets.length === 0 && !data.canUseAi && (
          <p className="pt-2 text-xs text-pretty text-fg-3">{t("delegateNobody")}</p>
        )}
      </div>
    </Sheet>
  );
}

function ChoiceRow({
  title,
  hint,
  onClick,
  busy,
  warn,
}: {
  title: string;
  hint: string;
  onClick: () => void;
  busy?: boolean;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex w-full items-center gap-3 rounded-md border border-line-1 px-3 py-3 text-left focus-ring transition-colors duration-fast hover:bg-surface-2 disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fg-1">{title}</span>
        <span className={cn("block text-xs text-pretty", warn ? "text-warn" : "text-fg-3")}>{hint}</span>
      </span>
      <span aria-hidden className="text-fg-3">
        →
      </span>
    </button>
  );
}

/** Intro, the game with the clock, then the result. */
function PlaySheet({ task, onClose }: { task: CompanyTask | null; onClose: () => void }) {
  const t = useTranslations("companyTasks.play");
  const text = useTaskText();
  const client = useQueryClient();
  const refresh = useCompanyRefresh();
  const errorText = useGameErrorText();
  const [play, setPlay] = useState<CompanyTaskPlay | null>(null);
  const [result, setResult] = useState<CompanyTaskResult | null>(null);
  const [state, setState] = useState<ButtonState>("idle");
  const [sending, setSending] = useState(false);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

  const close = () => {
    setPlay(null);
    setResult(null);
    setState("idle");
    void client.invalidateQueries({ queryKey: COMPANY_TASKS_KEY });
    onClose();
  };
  if (!task) return null;
  const g = cfg.games[task.game];

  const start = async () => {
    setState("loading");
    try {
      setPlay(await engine.startCompanyTask(crypto.randomUUID(), task.id));
      setState("idle");
    } catch (error) {
      toast.error(text.name(task.key), errorText(error));
      setState("idle");
    }
  };
  const answer = async (a: Record<string, unknown>) => {
    if (!play || sending) return;
    setSending(true);
    try {
      const r = await engine.submitCompanyTask(crypto.randomUUID(), play.id, a);
      setResult(r);
      if (r.status === "success") {
        haptic("success");
        void playSound("success");
        if (anchor) burstConfetti(anchor, 24);
      } else {
        haptic("error");
        void playSound("error");
      }
      void refresh();
      void useGame.getState().refreshPortfolio();
    } catch (error) {
      toast.error(text.name(task.key), errorText(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && close()} title={text.name(task.key)} description={text.how(task.key)}>
      <div ref={setAnchor} className="space-y-4 px-5 pb-6" data-testid="play-sheet">
        {result ? (
          <ResultView result={result} onClose={close} />
        ) : play ? (
          <>
            <Timer openedAt={Date.parse(play.openedAt)} seconds={play.seconds} />
            <TaskGameView
              game={play.game}
              taskKey={play.key}
              puzzle={play.puzzle}
              disabled={sending}
              onAnswer={(a) => void answer(a)}
            />
          </>
        ) : (
          <div className="space-y-4">
            <p className="rounded-md bg-surface-2 px-4 py-3 text-sm text-pretty text-fg-2">
              {t("ready", { seconds: g.seconds })}
            </p>
            <Button block size="lg" state={state} onClick={() => void start()}>
              {t("start")}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Timer({ openedAt, seconds }: { openedAt: number; seconds: number }) {
  const t = useTranslations("companyTasks.play");
  const now = useClock();
  const left = now === null ? seconds : Math.max(0, seconds - (now - openedAt) / 1000);
  const share = left / seconds;
  return (
    <div className="space-y-1" aria-label={t("time")}>
      <div className="flex justify-between text-2xs">
        <span className="label-pixel text-fg-3">{t("time")}</span>
        <span className={cn("nums font-semibold", share < 0.25 ? "text-loss" : "text-fg-2")}>{Math.ceil(left)} s</span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-surface-3">
        <div
          className={cn(
            "h-full origin-left rounded-pill transition-transform duration-slow ease-linear",
            share < 0.25 ? "bg-loss" : "bg-accent",
          )}
          style={{ transform: `scaleX(${share})` }}
        />
      </div>
    </div>
  );
}

function ResultView({ result, onClose }: { result: CompanyTaskResult; onClose: () => void }) {
  const t = useTranslations("companyTasks.play");
  const won = result.status === "success";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={SPRING.bouncy}
      className="space-y-4 text-center"
      data-testid="task-result"
      data-status={result.status}
    >
      <p className={cn("font-pixel text-lg uppercase", won ? "text-gain" : "text-loss")}>
        {won ? t("success") : t("failure")}
      </p>
      <p className="text-sm text-fg-2">
        {won
          ? t("successText", { amount: formatMoney(result.resultCents, { whole: true }), xp: result.xp })
          : t("failureText", { amount: formatMoney(-result.resultCents, { whole: true }) })}
      </p>
      {result.late ? (
        <p className="text-xs text-warn">{t("late")}</p>
      ) : (
        result.scoreBps !== null && (
          <p className="nums text-xs text-fg-3">{t("score", { percent: Math.round(result.scoreBps / 100) })}</p>
        )
      )}
      <Button block variant="secondary" onClick={onClose}>
        {t("close")}
      </Button>
    </motion.div>
  );
}

function AutoAiRow({ data }: { data: CompanyTasks }) {
  const t = useTranslations("companyTasks");
  const act = useTaskAction();
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex items-start gap-3 rounded-md border border-line-1 px-3 py-3" data-testid="tasks-auto-ai">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg-1">{t("autoAi")}</span>
        <span className="block text-xs text-pretty text-fg-3">
          {data.aiWorkers > 0 ? t("autoAiHint", { minutes: cfg.board.autoAiBeforeDueMinutes }) : t("autoAiNone")}
        </span>
      </span>
      <Switch
        checked={data.autoAi}
        disabled={busy}
        label={t("autoAi")}
        onCheckedChange={async (on) => {
          setBusy(true);
          await act(() => engine.setCompanyTasksAutoAi(crypto.randomUUID(), on), t("autoAi"));
          setBusy(false);
        }}
      />
    </label>
  );
}

/** Founder: who reports to whom. A supervisor needs a higher rank. */
function HierarchyCard({ data }: { data: CompanyTasks }) {
  const t = useTranslations("companyTasks");
  const tt = useTranslations("careerTiers");
  const act = useTaskAction();
  const rank = (tier: string) => ["intern", "junior", "senior", "team_lead", "c_level"].indexOf(tier);
  return (
    <Card padding="lg" className="space-y-3" data-testid="task-hierarchy">
      <div>
        <p className="label-pixel text-fg-2">{t("hierarchy")}</p>
        <p className="mt-1 text-xs text-pretty text-fg-3">{t("hierarchyIntro")}</p>
      </div>
      {data.people.length === 0 ? (
        <p className="text-sm text-pretty text-fg-3">{t("noStaff")}</p>
      ) : (
        <ul className="space-y-2">
          {data.people.map((p) => {
            const options = data.people.filter((s) => s.nickname !== p.nickname && rank(s.tier) > rank(p.tier));
            return (
              <li key={p.nickname} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg-1">{p.nickname}</span>
                  <span className="block text-2xs text-fg-3">{tt(p.tier as Parameters<typeof tt>[0])}</span>
                </span>
                <label className="flex items-center gap-2 text-2xs text-fg-3">
                  {t("reportsTo")}
                  <select
                    value={p.supervisor ?? ""}
                    onChange={(e) =>
                      void act(
                        () => engine.setJobSupervisor(crypto.randomUUID(), p.nickname, e.target.value || null),
                        t("supervisorSet"),
                      )
                    }
                    className="h-9 rounded-sm border border-line-2 bg-surface-1 px-2 text-xs text-fg-1 focus-ring"
                  >
                    <option value="">{t("reportsToYou")}</option>
                    {options.map((s) => (
                      <option key={s.nickname} value={s.nickname}>
                        {s.nickname}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Employee: the own reports. */
function MyTeamCard({ data }: { data: CompanyTasks }) {
  const t = useTranslations("companyTasks");
  const tt = useTranslations("careerTiers");
  const team = data.people.filter((p) => p.reportsToMe && !p.isMe);
  return (
    <Card padding="lg" className="space-y-3">
      <p className="label-pixel text-fg-2">{t("yourTeam")}</p>
      {team.length === 0 ? (
        <p className="text-xs text-pretty text-fg-3">{t("yourTeamEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {team.map((p) => (
            <li key={p.nickname} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-medium text-fg-1">{p.nickname}</span>
              <span className="text-2xs text-fg-3">{tt(p.tier as Parameters<typeof tt>[0])}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HistoryCard({ data }: { data: CompanyTasks }) {
  const t = useTranslations("companyTasks");
  const text = useTaskText();
  return (
    <Card padding="lg" className="space-y-2" data-testid="task-history">
      <p className="label-pixel text-fg-3">{t("history")}</p>
      <ul className="space-y-1.5">
        {data.history.slice(0, 8).map((h) => {
          const won = h.status === "success";
          return (
            <li key={h.id} className="flex items-center gap-2 text-xs">
              <Badge tone={won ? "gain" : "loss"}>{t(`result.${h.status}`)}</Badge>
              <span className="min-w-0 flex-1 truncate text-fg-2">
                {text.name(h.key)}
                <span className="text-fg-3"> · {h.ai ? t("byAi") : (h.doneBy ?? "—")}</span>
              </span>
              <span className={cn("shrink-0 nums", h.resultCents >= 0 ? "text-gain" : "text-loss")}>
                {h.resultCents >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(h.resultCents), { whole: true })}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
