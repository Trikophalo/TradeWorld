"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { QUEST_BOARD, UI_ICONS } from "@/components/pixel/art";
import { Mascot } from "@/components/pixel/mascot";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { flyCoins } from "@/components/ui/effects";
import { toast } from "@/components/ui/toast";
import { useMyJob, useSkills } from "@/features/career/hooks";
import { useCompanyEvent, useMyCompany } from "@/features/company/hooks";
import { bottleneck } from "@/features/company/routes";
import { useDeals } from "@/features/deals/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { useGame } from "@/features/game/store";
import { useDailyRewardSheet } from "@/features/progression/components/daily-reward";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING, STAGGER } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { unlockLevel } from "@/lib/sim/progression";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useSeenFeatures } from "../seen";
import { dayPart, finnLineKey, NEW_FEATURES, todayTasks, type TodayTask } from "../today";

const ICON: Record<TodayTask["key"], PixelArt> = {
  daily: UI_ICONS.gift,
  vault: UI_ICONS.lock,
  missions: QUEST_BOARD,
  companyEvent: UI_ICONS.bell,
  promotion: UI_ICONS.upgrade,
  workTask: UI_ICONS.briefcase,
  dealOffers: UI_ICONS.deal,
  newFeature: UI_ICONS.star,
  findJob: UI_ICONS.briefcase,
  foundCompany: UI_ICONS.company,
  skills: UI_ICONS.star,
  companyCustomers: UI_ICONS.company,
  companyStaff: UI_ICONS.company,
  markets: UI_ICONS.markets,
};

const DAY_LINES = 4;

/**
 * "Heute dran" (ADR-102): Finn greets the player by the time of day and names the most important things to do now,
 * each one tap away. The first thing a player sees after logging in.
 */
export function TodayPanel() {
  const t = useTranslations("today");
  const reduced = useReducedMotion();
  const now = useClock();
  const nickname = useGame((s) => s.portfolio?.nickname ?? "");
  const level = useGame((s) => s.portfolio?.level ?? 1);
  const vault = useGame((s) => s.portfolio?.vault);
  const dailyClaimable = useGame((s) => s.portfolio?.dailyRewardClaimable ?? false);
  const missions = useGame((s) => s.missions);
  const job = useMyJob().data ?? null;
  const skills = useSkills().data;
  const company = useMyCompany().data?.company ?? null;
  const event = useCompanyEvent().data;
  const dealsUnlocked = level >= (unlockLevel("deals") ?? 99);
  const deals = useDeals();
  const seen = useSeenFeatures();
  useEffect(() => seen.load(), [seen]);

  const vaultFill = vault && vault.capCents > 0 ? Math.min(1, vault.accruedCents / vault.capCents) : 0;
  const newFeature = seen.ready
    ? (NEW_FEATURES.find((f) => level >= (unlockLevel(f.unlock) ?? 999) && !seen.seen.includes(f.key)) ?? null)
    : null;
  const tasks = todayTasks({
    level,
    dailyClaimable,
    vaultFill,
    missionsClaimable: missions?.flatMap((g) => g.missions).filter((m) => m.status === "completed").length ?? 0,
    job: job
      ? { promotionReady: Boolean(job.promotion?.ready && !job.promotion.retryAt), workTaskOpen: job.workTaskOpen }
      : null,
    firstJobLevel: unlockLevel("first_job") ?? 2,
    freeSkillPoints: skills?.freePoints ?? 0,
    newFeature: newFeature ? { key: newFeature.key, href: newFeature.href } : null,
    company: company
      ? { neck: bottleneck(company).kind, eventOpen: Boolean(event?.canAct && event.event?.status === "open") }
      : null,
    canFoundCompany: level >= (unlockLevel("found_garage") ?? 99),
    dealOffers: dealsUnlocked ? (deals.data?.incoming.length ?? 0) : 0,
  });

  const hour = now === null ? 12 : new Date(now).getHours();
  const part = dayPart(hour);
  const daySeed = now === null ? 0 : Math.floor(now / 86_400_000);
  const lineKey = finnLineKey(tasks, part, daySeed, DAY_LINES);
  const done = tasks.length === 1 && tasks[0]!.key === "markets";

  return (
    <section
      className="relative overflow-hidden rounded-xl border-2 border-line-1 bg-surface-1 shadow-1"
      aria-labelledby="today-title"
      data-testid="today"
    >
      <Skyline reduced={Boolean(reduced)} />
      <div className="relative grid gap-4 p-4 sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-6">
        <div className="flex items-end gap-3 lg:flex-col lg:items-center lg:self-start">
          <Mascot mood={done ? "happy" : "talk"} scale={4} className="shrink-0" />
          <div className="relative min-w-0 flex-1 rounded-lg border border-line-2 bg-surface-2 px-3 py-2 text-sm text-fg-1 lg:max-w-56 lg:flex-none">
            <span
              aria-hidden
              className="absolute bottom-3 -left-1.5 size-3 rotate-45 border-b border-l border-line-2 bg-surface-2 lg:-top-1.5 lg:bottom-auto lg:left-1/2 lg:-translate-x-1/2 lg:border-t lg:border-b-0"
            />
            <p className="relative font-medium">
              {now === null ? t("hello", { name: nickname }) : t(`greeting.${part}`, { name: nickname })}
            </p>
            <p className="relative text-pretty text-fg-2" data-testid="finn-line">
              {t(`lines.${lineKey}` as "lines.about.vault")}
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 id="today-title" className="font-pixel text-base text-fg-1 uppercase">
              {t("title")}
            </h2>
            <span className="label-pixel text-fg-3">{t("count", { count: done ? 0 : tasks.length })}</span>
          </div>
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {tasks.map((task, i) => (
                <motion.li
                  key={task.key}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER * 2 }}
                >
                  <TaskRow task={task} primary={i === 0} vaultCents={vault?.accruedCents ?? 0} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </div>
    </section>
  );
}

function TaskRow({ task, primary, vaultCents }: { task: TodayTask; primary: boolean; vaultCents: number }) {
  const t = useTranslations("today.tasks");
  const tf = useTranslations("today.features");
  const tv = useTranslations("vault");
  const errorText = useGameErrorText();
  const claim = useGame((s) => s.claimVault);
  const openDaily = useDailyRewardSheet((s) => s.setOpen);
  const [state, setState] = useState<ButtonState>("idle");
  const title =
    task.key === "newFeature"
      ? t("newFeature.title", { feature: tf(task.feature as "artworks") })
      : t(`${task.key}.title`, { count: task.count ?? 0, amount: formatMoney(vaultCents, { whole: true }) });
  const text = t(`${task.key}.text`, { count: task.count ?? 0 });

  const onVault = async (target: HTMLElement) => {
    setState("loading");
    try {
      const claimed = await claim();
      flyCoins(target, document.querySelector('[data-fly-target="cash"]'));
      void playSound("coin");
      haptic("success");
      setState("success");
      toast.success(tv("claimed"), tv("claimedText", { amount: formatMoney(claimed) }), { silent: true });
    } catch (error) {
      setState("idle");
      toast.error(tv("claimFailed"), errorText(error));
    }
  };

  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xs border-2",
          task.tone === "urgent"
            ? "border-accent/60 bg-accent-soft text-accent"
            : "border-line-2 bg-surface-2 text-fg-2",
        )}
      >
        <PixelIcon {...ICON[task.key]} scale={2} className="group-hover:animate-hop" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg-1">{title}</span>
        <span className="block text-xs text-pretty text-fg-3">{text}</span>
      </span>
    </>
  );

  const rowClass = cn(
    "group flex w-full items-center gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition duration-fast",
    task.tone === "urgent" ? "border-accent/50 bg-surface-2 shadow-1" : "border-line-1 bg-surface-1 shadow-1",
  );

  if (task.href) {
    return (
      <Link
        href={task.href}
        className={cn(
          rowClass,
          "focus-ring hover:-translate-y-0.5 hover:border-line-2 hover:bg-surface-2 active:translate-y-0.5",
        )}
        data-task={task.key}
      >
        {body}
        <span
          aria-hidden
          className="text-fg-3 transition-transform duration-fast ease-out group-hover:translate-x-1 group-hover:text-accent"
        >
          ›
        </span>
      </Link>
    );
  }
  return (
    <div className={rowClass} data-task={task.key}>
      {body}
      <Button
        size="sm"
        variant={primary ? "primary" : "secondary"}
        state={state}
        onClick={(e) => (task.key === "daily" ? openDaily(true) : void onVault(e.currentTarget))}
      >
        {t(task.key === "daily" ? "daily.action" : "vault.action")}
      </Button>
    </div>
  );
}

/** A small pixel city at the bottom edge; some windows light up slowly. Decoration only. */
function Skyline({ reduced }: { reduced: boolean }) {
  const buildings = [
    { x: 0, w: 14, h: 22 },
    { x: 15, w: 10, h: 34 },
    { x: 26, w: 16, h: 18 },
    { x: 43, w: 9, h: 40 },
    { x: 53, w: 18, h: 26 },
    { x: 72, w: 12, h: 30 },
    { x: 85, w: 15, h: 20 },
  ];
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 44"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-20 w-full opacity-50 [shape-rendering:crispEdges]"
    >
      {buildings.map((b, i) => (
        <g key={b.x}>
          <rect x={b.x} y={44 - b.h} width={b.w} height={b.h} fill="var(--bg-3)" />
          {Array.from({ length: Math.floor(b.h / 6) }, (_, row) =>
            Array.from({ length: Math.floor(b.w / 4) }, (_, col) => (
              <motion.rect
                key={`${row}-${col}`}
                x={b.x + 1.5 + col * 4}
                y={44 - b.h + 2 + row * 6}
                width={1.6}
                height={2}
                fill="var(--gold)"
                initial={{ opacity: (row + col + i) % 3 === 0 ? 0.7 : 0.08 }}
                animate={
                  reduced || (row * 7 + col * 3 + i) % 5 !== 0 ? undefined : { opacity: [0.08, 0.75, 0.75, 0.08] }
                }
                transition={{ duration: 9, repeat: Infinity, delay: (row + col + i) % 7, ease: "easeInOut" }}
              />
            )),
          )}
        </g>
      ))}
    </svg>
  );
}
