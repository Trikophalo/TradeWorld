"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CitySkyline } from "@/components/layout/title-scene";
import { QUEST_BOARD, TROPHIES, UI_ICONS } from "@/components/pixel/art";
import { Mascot } from "@/components/pixel/mascot";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { flyCoins } from "@/components/ui/effects";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useMyJob, useSkills } from "@/features/career/hooks";
import { useCompanyEvent, useMyCompany } from "@/features/company/hooks";
import { bottleneck } from "@/features/company/routes";
import { useDeals } from "@/features/deals/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { useGame, usePlayerLevel } from "@/features/game/store";
import { useDailyRewardSheet } from "@/features/progression/components/daily-reward";
import { useRichList } from "@/features/rich-list/hooks";
import { formatInteger, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING, STAGGER } from "@/lib/motion";
import { unlockLevel, xpForNextLevel } from "@/lib/sim/progression";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useSeenFeatures } from "../seen";
import { dayPart, finnLineKey, NEW_FEATURES, todayTasks, type TodayTask } from "../today";

/*
 * The start page (ADR-109): calm on purpose. One scene with Finn and the player's wealth, one thing to do next,
 * the vault, and three small tiles. Everything else lives on its own page.
 */

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
/** One thing to do now, two more for afterwards. */
const TASKS = 3;
const format = (value: number) => formatMoney(Math.round(value));

/** What is due today and what Finn says about it. */
function useToday() {
  const now = useClock();
  const level = usePlayerLevel();
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
  const missionsClaimable = missions?.flatMap((g) => g.missions).filter((m) => m.status === "completed").length ?? 0;
  const tasks = todayTasks(
    {
      level,
      dailyClaimable,
      vaultFill,
      missionsClaimable,
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
    },
    TASKS,
  );
  const hour = now === null ? 12 : new Date(now).getHours();
  const part = dayPart(hour);
  const daySeed = now === null ? 0 : Math.floor(now / 86_400_000);
  return {
    now,
    part,
    tasks,
    missionsClaimable,
    vaultCents: vault?.accruedCents ?? 0,
    lineKey: finnLineKey(tasks, part, daySeed, DAY_LINES),
    done: tasks.length === 1 && tasks[0]!.key === "markets",
  };
}

const HERO_STARS = [
  { x: 8, y: 14, d: 0.2 },
  { x: 27, y: 9, d: 1.4 },
  { x: 46, y: 20, d: 0.7 },
  { x: 63, y: 8, d: 1.9 },
  { x: 81, y: 17, d: 0.5 },
  { x: 94, y: 30, d: 1.1 },
] as const;

/** The scene on top: Finn greets, the wealth stands big above the city. */
export function HomeHero() {
  const t = useTranslations("today");
  const th = useTranslations("home");
  const nickname = useGame((s) => s.portfolio?.nickname ?? "");
  // Wealth includes the own company (ADR-057), like on the rich list.
  const total = useGame((s) =>
    s.portfolio ? s.portfolio.totalCents + s.portfolio.companyValueCents - s.portfolio.debtCents : undefined,
  );
  const { now, part, lineKey, done } = useToday();
  const start = BALANCE.economy.startingCapitalCents;

  return (
    <section
      className="relative isolate overflow-hidden rounded-xl border-2 border-line-1 bg-surface-1 shadow-1"
      data-testid="home-hero"
    >
      <span aria-hidden className="absolute inset-0 -z-10 bg-hero" />
      {HERO_STARS.map((star) => (
        <span
          key={star.x}
          aria-hidden
          className="absolute -z-10 size-[3px] animate-twinkle bg-gold"
          style={{ left: `${star.x}%`, top: `${star.y}%`, animationDelay: `${star.d}s` }}
        />
      ))}
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 flex justify-center opacity-70">
        <CitySkyline className="h-16 w-auto shrink-0 sm:h-24" />
        <CitySkyline className="h-16 w-auto shrink-0 -scale-x-100 sm:h-24" />
      </div>

      <div className="grid gap-5 px-4 pt-5 pb-20 sm:px-6 sm:pt-6 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10">
        <div className="flex items-end gap-3">
          <Mascot mood={done ? "happy" : "talk"} scale={4} className="shrink-0" />
          <div className="relative min-w-0 rounded-lg border-2 border-line-2 bg-surface-2 px-3.5 py-2.5 text-sm shadow-1 sm:max-w-md">
            <span
              aria-hidden
              className="absolute bottom-3 -left-[7px] size-3 rotate-45 border-b-2 border-l-2 border-line-2 bg-surface-2"
            />
            <p className="relative font-medium text-fg-1">
              {now === null ? t("hello", { name: nickname }) : t(`greeting.${part}`, { name: nickname })}
            </p>
            <p className="relative text-pretty text-fg-2" data-testid="finn-line">
              {t(`lines.${lineKey}` as "lines.about.vault")}
            </p>
          </div>
        </div>

        <div data-tour="wealth" aria-label={th("portfolioValue")} className="w-fit lg:text-right">
          <p className="label-pixel text-fg-3">{th("portfolioValue")}</p>
          {total === undefined ? (
            <Skeleton className="mt-2 h-11 w-60" />
          ) : (
            <NumberTicker
              value={total}
              format={format}
              className="mt-1 block text-4xl font-semibold tracking-tight text-fg-1 lg:text-5xl"
            />
          )}
          <p className="mt-2 flex items-center gap-2 text-sm text-fg-3 lg:justify-end">
            <Delta bps={total === undefined ? 0 : Math.round((total / start - 1) * 10_000)} pill />
            {th("sinceStart")}
          </p>
        </div>
      </div>
    </section>
  );
}

/** One thing to do now, big; up to two more for afterwards, small. */
export function NextSteps() {
  const t = useTranslations("home.next");
  const reduced = useReducedMotion();
  const { tasks, vaultCents } = useToday();
  const [first, ...rest] = tasks;
  if (!first) return null;

  return (
    <Card padding="lg" className="space-y-4" data-testid="today">
      <h2 className="label-pixel text-fg-2">{t("title")}</h2>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={first.key}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={SPRING.smooth}
        >
          <PrimaryTask task={first} vaultCents={vaultCents} />
        </motion.div>
      </AnimatePresence>
      {rest.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-fg-3">{t("then")}</p>
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {rest.map((task, i) => (
                <motion.li
                  key={task.key}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER * 2 }}
                >
                  <SmallTask task={task} vaultCents={vaultCents} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Texts and the action of a task; the daily reward and the vault are done right here. */
function useTask(task: TodayTask, vaultCents: number) {
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
  const act = (target: HTMLElement) => (task.key === "daily" ? openDaily(true) : void onVault(target));
  const actionLabel = t(task.key === "daily" ? "daily.action" : "vault.action");
  return { title, text, state, act, actionLabel };
}

function PrimaryTask({ task, vaultCents }: { task: TodayTask; vaultCents: number }) {
  const t = useTranslations("home.next");
  const { title, text, state, act, actionLabel } = useTask(task, vaultCents);
  return (
    <div
      className="flex flex-col gap-4 rounded-lg border-2 border-accent/50 bg-surface-2 p-4 shadow-1 sm:flex-row sm:items-center"
      data-task={task.key}
      data-primary
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-md border-2 border-accent/60 bg-accent-soft text-accent"
        >
          <PixelIcon {...ICON[task.key]} scale={3} className="animate-float" />
        </span>
        <span className="min-w-0">
          <span className="block text-lg font-semibold text-pretty text-fg-1">{title}</span>
          <span className="mt-0.5 block text-sm text-pretty text-fg-2">{text}</span>
        </span>
      </div>
      {task.href ? (
        <Link href={task.href} className={buttonVariants({ size: "lg", className: "w-full sm:w-auto" })}>
          {t("go")}
        </Link>
      ) : (
        <Button size="lg" state={state} className="w-full sm:w-auto" onClick={(e) => act(e.currentTarget)}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function SmallTask({ task, vaultCents }: { task: TodayTask; vaultCents: number }) {
  const { title, state, act, actionLabel } = useTask(task, vaultCents);
  const rowClass =
    "group flex w-full items-center gap-3 rounded-md border-2 border-line-1 bg-surface-1 px-3 py-2 text-left transition duration-fast";
  const body = (
    <>
      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-xs bg-surface-2 text-fg-2">
        <PixelIcon {...ICON[task.key]} scale={1} className="group-hover:animate-hop" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-1">{title}</span>
    </>
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
      <Button size="sm" variant="secondary" state={state} onClick={(e) => act(e.currentTarget)}>
        {actionLabel}
      </Button>
    </div>
  );
}

/** Three small tiles: level and the next unlock, the own rank, the missions. */
export function QuickStats() {
  const t = useTranslations("home.stats");
  const tu = useTranslations("unlocks");
  const level = usePlayerLevel();
  const xp = useGame((s) => s.portfolio?.xpIntoLevel ?? 0);
  const needed = xpForNextLevel(level);
  const next = BALANCE.progression.unlocks.find((u) => u.level > level);
  const rank = useRichList("all", 3).data;
  const { missionsClaimable } = useToday();

  return (
    <div className="grid gap-4 sm:grid-cols-3" data-testid="home-stats">
      <Tile href="/profile" art={UI_ICONS.star} title={t("level", { level })} testId="tile-level">
        <Progress value={needed > 0 ? xp / needed : 0} label={t("level", { level })} size="sm" className="mt-2" />
        <p className="mt-1.5 truncate text-xs text-fg-3">
          {next
            ? t("nextUnlock", { name: tu(next.key as "bonds"), level: next.level })
            : t("xp", { xp: formatInteger(Math.max(0, needed - xp)) })}
        </p>
      </Tile>
      <Tile
        href="/rich-list"
        art={TROPHIES.gold}
        title={rank?.me ? t("rank", { rank: rank.me.rank }) : t("rankNone")}
        testId="tile-rank"
      >
        <p className="mt-1 truncate text-xs text-fg-3">
          {rank?.me?.next
            ? t("rankGap", { amount: formatMoney(rank.me.next.gapCents, { whole: true }), rank: rank.me.next.rank })
            : rank
              ? t("rankOf", { total: rank.total })
              : " "}
        </p>
      </Tile>
      <Tile href="/missions" art={QUEST_BOARD} title={t("missions")} testId="tile-missions" dot={missionsClaimable > 0}>
        <p className={cn("mt-1 truncate text-xs", missionsClaimable > 0 ? "font-medium text-gain" : "text-fg-3")}>
          {missionsClaimable > 0 ? t("missionsReady", { count: missionsClaimable }) : t("missionsHint")}
        </p>
      </Tile>
    </div>
  );
}

function Tile({
  href,
  art,
  title,
  children,
  testId,
  dot,
}: {
  href: string;
  art: PixelArt;
  title: string;
  children: React.ReactNode;
  testId: string;
  dot?: boolean;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group relative flex items-center gap-3 rounded-lg border-2 border-line-1 bg-surface-1 p-3.5 shadow-1 focus-ring transition duration-fast hover:-translate-y-1 hover:border-line-2 hover:bg-surface-2 hover:shadow-2 active:translate-y-0.5 active:shadow-none"
    >
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-md bg-surface-2 text-accent">
        <PixelIcon {...art} scale={2} className="group-hover:animate-hop" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-pixel text-sm text-fg-1 uppercase">{title}</span>
        {children}
      </span>
      {dot && <span aria-hidden className="absolute top-2 right-2 size-2 animate-twinkle bg-gain" />}
    </Link>
  );
}
