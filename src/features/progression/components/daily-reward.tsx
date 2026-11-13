"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { CHESTS, COIN, GEM, SHIELD, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useCareerRefresh, useDailyReward } from "@/features/career/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { DailyRewardDay } from "@/features/game/types";
import { useTutorial } from "@/features/tutorial/store";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { scaledXp } from "@/lib/sim/progression";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

const SEEN_KEY = "nexa-daily-reward-seen";

/** Open state, shared by the automatic popup and the reminder card on the start page. */
export const useDailyRewardSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/**
 * Daily reward (ADR-053): a 7-day calendar that opens on the first visit of the
 * day, after the tutorial. Claiming also counts as the daily check-in.
 */
export function DailyReward() {
  const t = useTranslations("dailyReward");
  const errorText = useGameErrorText();
  const claimable = useGame((state) => state.portfolio?.dailyRewardClaimable ?? false);
  const tutorialDone = useTutorial((state) => state.status === "done" && state.tour === null);
  const { open, setOpen } = useDailyRewardSheet();
  const reward = useDailyReward(open || claimable);
  const refresh = useCareerRefresh();
  const [state, setState] = useState<ButtonState>("idle");
  const [claimedDay, setClaimedDay] = useState<number | null>(null);
  const shownToday = useRef(false);
  const dayRef = useRef<HTMLDivElement>(null);

  // Open by itself once per day and tab when today's reward is waiting; the card on the start page stays.
  useEffect(() => {
    if (!claimable || !tutorialDone || shownToday.current) return;
    shownToday.current = true;
    const today = new Date().toDateString();
    try {
      if (window.sessionStorage.getItem(SEEN_KEY) === today) return;
      window.sessionStorage.setItem(SEEN_KEY, today);
    } catch {
      // Without storage it simply opens once per page load.
    }
    const timer = window.setTimeout(() => useDailyRewardSheet.getState().setOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [claimable, tutorialDone]);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setState("idle");
      setClaimedDay(null);
    }
  }

  const data = reward.data;
  const current = claimedDay ?? data?.day ?? 1;
  const canClaim = Boolean(data?.claimable) && claimedDay === null;

  const claim = async () => {
    setState("loading");
    try {
      const result = await engine.claimDailyReward(crypto.randomUUID());
      setClaimedDay(result.day);
      setState("success");
      void playSound(result.day === 7 ? "win" : "coin");
      haptic("success");
      if (dayRef.current && result.day === 7) burstConfetti(dayRef.current);
      const parts = [`+${result.xpAwarded} XP`];
      if (result.cashCents > 0) parts.push(formatMoney(result.cashCents, { whole: true }));
      if (result.skillPoints > 0) parts.push(t("skillPoint", { count: result.skillPoints }));
      toast.success(t("claimedTitle", { day: result.day }), parts.join(" · "), { silent: true });
      await refresh();
    } catch (error) {
      setState("idle");
      toast.error(t("title"), errorText(error));
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={t("title")}
      description={t("intro")}
      footer={
        canClaim ? (
          <Button block size="lg" state={state} onClick={() => void claim()}>
            {t("claim")}
          </Button>
        ) : (
          <Button block size="lg" variant="secondary" onClick={() => setOpen(false)}>
            {t("close")}
          </Button>
        )
      }
    >
      {data ? (
        <div className="space-y-5">
          <StreakBar streakDays={data.streakDays} freezesLeft={data.freezesLeft} current={current} done={!canClaim} />
          <div className="grid grid-cols-3 gap-2.5">
            {data.cycle.map((day) => {
              const claimed = day.day < current || (claimedDay !== null && day.day === claimedDay);
              const today = day.day === current && canClaim;
              return (
                <div
                  key={day.day}
                  ref={today || day.day === claimedDay ? dayRef : undefined}
                  className={day.day === 7 ? "col-span-3" : undefined}
                >
                  <DayTile
                    day={day}
                    claimed={claimed}
                    justClaimed={day.day === claimedDay}
                    today={today}
                    big={day.day === 7}
                  />
                </div>
              );
            })}
          </div>
          {!canClaim && claimedDay === null && (
            <p className="text-center label-pixel text-fg-3">{t("next", { day: data.day })}</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className={cn("h-32 rounded-xs", i === 6 && "col-span-3")} />
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** Hard pixel frame: square corners, 2 px border and a stepped shadow, like a button in an old console game. */
const PIXEL_FRAME = "rounded-xs border-2 [box-shadow:0_4px_0_0_var(--line-2)]";

/** The streak as seven pixel blocks with a flame; the shield shows the weekly freeze. */
function StreakBar({
  streakDays,
  freezesLeft,
  current,
  done,
}: {
  streakDays: number;
  freezesLeft: number;
  current: number;
  done: boolean;
}) {
  const t = useTranslations("dailyReward");
  const reduced = useReducedMotion();
  // Blocks filled for the days of this week already collected.
  const filled = done ? current : current - 1;
  return (
    <div className={cn(PIXEL_FRAME, "flex items-center gap-3 border-line-2 bg-surface-2 p-3")} data-testid="streak">
      <motion.span
        animate={streakDays > 0 && !reduced ? { y: [0, -2, 0], scale: [1, 1.08, 1] } : undefined}
        transition={{ duration: DURATION.slower * 3, repeat: Infinity, ease: EASE.inOut }}
        className={cn("grid size-11 shrink-0 place-items-center", streakDays > 0 ? "text-warn" : "text-fg-3")}
      >
        <PixelIcon {...UI_ICONS.flame} scale={3} />
      </motion.span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-pixel text-sm text-fg-1 uppercase">{t("streak", { days: streakDays })}</p>
        <div className="flex gap-1" role="img" aria-label={t("weekProgress", { done: filled })}>
          {Array.from({ length: 7 }, (_, i) => (
            <motion.span
              key={i}
              initial={false}
              animate={{ scale: i < filled ? 1 : 0.85, opacity: i < filled ? 1 : 0.5 }}
              transition={SPRING.bouncy}
              className={cn(
                "h-3 flex-1 border-2 border-bg",
                i < filled ? (i === 6 ? "bg-gold" : "bg-warn") : "bg-surface-3",
              )}
            />
          ))}
        </div>
      </div>
      <span
        className={cn("flex shrink-0 flex-col items-center gap-0.5", freezesLeft > 0 ? "" : "opacity-40 grayscale")}
        title={t("freezeHint")}
      >
        <PixelIcon {...SHIELD} scale={3} />
        <span className="font-pixel text-2xs text-fg-2">×{freezesLeft}</span>
      </span>
    </div>
  );
}

function DayTile({
  day,
  claimed,
  justClaimed,
  today,
  big,
}: {
  day: DailyRewardDay;
  claimed: boolean;
  justClaimed: boolean;
  today: boolean;
  big: boolean;
}) {
  const t = useTranslations("dailyReward");
  const reduced = useReducedMotion();
  const chest = CHESTS[big ? "gold" : "wood"][claimed ? (justClaimed ? "open" : "empty") : "closed"];
  return (
    <motion.div
      animate={{ y: today ? -2 : 0 }}
      transition={SPRING.bouncy}
      className={cn(
        PIXEL_FRAME,
        "relative flex h-full flex-col items-center gap-2 px-2 pt-2 pb-3 text-center",
        big && "grid grid-cols-[auto_1fr] items-center gap-x-4 px-4 text-left",
        today
          ? "border-accent bg-accent-soft [box-shadow:0_4px_0_0_var(--accent-strong)]"
          : claimed
            ? "border-line-1 bg-surface-1 opacity-70"
            : big
              ? "border-gold bg-surface-2 [box-shadow:0_4px_0_0_var(--gold)]"
              : "border-line-2 bg-surface-2",
      )}
      data-day={day.day}
      data-state={today ? "today" : claimed ? "claimed" : "locked"}
    >
      <span
        className={cn(
          "font-pixel text-2xs uppercase",
          big && "col-start-1",
          today ? "text-accent" : big && !claimed ? "text-gold" : "text-fg-3",
        )}
      >
        {today ? t("today") : big ? t("bigDay") : t("day", { day: day.day })}
      </span>

      <span className={cn("relative grid place-items-center", big ? "col-start-1 h-16" : "h-12")}>
        {/* Today's chest hops and sparkles; the claimed one pops its coins */}
        <motion.span
          animate={today && !reduced ? { y: [0, -4, 0], rotate: [0, -3, 3, 0] } : { y: 0, rotate: 0 }}
          transition={today ? { duration: DURATION.slower * 3, repeat: Infinity, ease: EASE.inOut } : SPRING.snappy}
        >
          <PixelIcon {...chest} scale={big ? 4 : 3} title={t("day", { day: day.day })} />
        </motion.span>
        {today && !reduced && <Sparkles />}
        {justClaimed && !reduced && <CoinPop />}
      </span>

      <span className={cn("flex flex-col items-center gap-1", big && "col-start-2 row-span-2 row-start-1 items-start")}>
        <Reward art={UI_ICONS.star} tone="text-accent" muted={claimed}>
          +{scaledXp(day.xp)} XP
        </Reward>
        {day.cashCents > 0 && (
          <Reward art={COIN} tone="text-gain" muted={claimed} small>
            {formatMoney(day.cashCents, { whole: true })}
          </Reward>
        )}
        {day.skillPoints > 0 && (
          <Reward art={GEM} tone="text-accent" muted={claimed} scale={2}>
            {t("skillPointShort", { count: day.skillPoints })}
          </Reward>
        )}
      </span>
    </motion.div>
  );
}

function Reward({
  art,
  tone,
  muted,
  small,
  scale = 1,
  children,
}: {
  art: PixelArt;
  tone: string;
  muted: boolean;
  small?: boolean;
  scale?: 1 | 2;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 nums text-xs font-semibold", muted ? "text-fg-3" : tone)}>
      <PixelIcon {...art} scale={scale} className={cn(small && "scale-75", muted && "grayscale")} />
      <span className={cn("whitespace-nowrap", !muted && "text-fg-1")}>{children}</span>
    </span>
  );
}

/** Four pixel sparkles blinking around today's chest. */
function Sparkles() {
  const spots = [
    { x: "-18%", y: "8%", d: 0 },
    { x: "92%", y: "0%", d: 0.4 },
    { x: "100%", y: "70%", d: 0.8 },
    { x: "-10%", y: "78%", d: 1.2 },
  ];
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {spots.map((s, i) => (
        <motion.span
          key={i}
          className="absolute size-1.5 bg-gold"
          style={{ left: s.x, top: s.y }}
          animate={{ opacity: [0, 1, 0], scale: [0.4, 1, 0.4] }}
          transition={{ duration: DURATION.slower * 3, delay: s.d, repeat: Infinity, ease: EASE.inOut }}
        />
      ))}
    </span>
  );
}

/** The lid flies open: coins jump out of the chest. */
function CoinPop() {
  const coins = [-26, -10, 8, 24];
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10">
      {coins.map((x, i) => (
        <motion.span
          key={i}
          className="absolute top-1/3 left-1/2 -ml-2"
          initial={{ x: 0, y: 0, opacity: 0 }}
          animate={{ x, y: [0, -34 - (i % 2) * 10, -10], opacity: [0, 1, 0] }}
          transition={{ duration: DURATION.slower * 2.5, delay: i * 0.06, ease: EASE.out }}
        >
          <PixelIcon {...COIN} scale={1} />
        </motion.span>
      ))}
    </span>
  );
}

/** Reminder on the start page when today's reward is still waiting. */
export function DailyRewardCard() {
  const t = useTranslations("dailyReward");
  const claimable = useGame((state) => state.portfolio?.dailyRewardClaimable ?? false);
  const setOpen = useDailyRewardSheet((state) => state.setOpen);
  if (!claimable) return null;
  return (
    <Card padding="md" interactive className="cursor-pointer" onClick={() => setOpen(true)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PixelIcon {...UI_ICONS.gift} scale={2} />
          <span className="font-medium text-fg-1">{t("title")}</span>
        </div>
        <span className="label-pixel text-accent">{t("claim")}</span>
      </div>
    </Card>
  );
}
