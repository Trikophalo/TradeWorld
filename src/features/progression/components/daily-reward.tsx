"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useCareerRefresh, useDailyReward } from "@/features/career/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { DailyRewardDay } from "@/features/game/types";
import { useTutorial } from "@/features/tutorial/store";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-fg-1">
              <PixelIcon {...UI_ICONS.flame} scale={2} className={data.streakDays > 0 ? "text-warn" : "text-fg-3"} />
              {t("streak", { days: data.streakDays })}
            </span>
            <span className="text-xs text-fg-3" title={t("freezeHint")}>
              {t("freeze", { count: data.freezesLeft })}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {data.cycle.map((day) => {
              const claimed = day.day < current || (claimedDay !== null && day.day === claimedDay);
              const today = day.day === current && canClaim;
              return (
                <div
                  key={day.day}
                  ref={today || day.day === claimedDay ? dayRef : undefined}
                  className={day.day === 7 ? "col-span-2" : undefined}
                >
                  <DayTile day={day} claimed={claimed} today={today} big={day.day === 7} />
                </div>
              );
            })}
          </div>
          {!canClaim && claimedDay === null && (
            <p className="text-center text-sm text-fg-3">{t("next", { day: data.day })}</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2" aria-hidden>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className={cn("h-24 animate-pulse rounded-md bg-surface-2", i === 6 && "col-span-2")} />
          ))}
        </div>
      )}
    </Sheet>
  );
}

function DayTile({
  day,
  claimed,
  today,
  big,
}: {
  day: DailyRewardDay;
  claimed: boolean;
  today: boolean;
  big: boolean;
}) {
  const t = useTranslations("dailyReward");
  return (
    <motion.div
      layout
      animate={{ scale: today ? 1.03 : 1 }}
      transition={SPRING.bouncy}
      className={cn(
        "relative flex h-24 flex-col items-center justify-between rounded-md border p-2 text-center",
        today
          ? "border-accent bg-accent-soft shadow-2"
          : claimed
            ? "border-line-1 bg-surface-2"
            : big
              ? "border-gold/60 bg-surface-2"
              : "border-line-1 bg-surface-1",
      )}
    >
      <span className={cn("label-pixel", today ? "text-accent" : "text-fg-3")}>
        {today ? t("today") : t("day", { day: day.day })}
      </span>
      <span className="flex flex-col items-center gap-0.5">
        <span className={cn("nums text-sm font-semibold", claimed ? "text-fg-3" : "text-fg-1")}>
          +{scaledXp(day.xp)} XP
        </span>
        {day.cashCents > 0 && (
          <span className={cn("nums text-xs", claimed ? "text-fg-3" : "text-gain")}>
            {formatMoney(day.cashCents, { whole: true })}
          </span>
        )}
        {day.skillPoints > 0 && (
          <span className={cn("text-xs", claimed ? "text-fg-3" : "text-gold")}>
            {t("skillPoint", { count: day.skillPoints })}
          </span>
        )}
      </span>
      {claimed && (
        <motion.span
          initial={{ scale: 1.8, opacity: 0, rotate: -18 }}
          animate={{ scale: 1, opacity: 1, rotate: -8 }}
          transition={SPRING.bouncy}
          className="absolute inset-0 grid place-items-center rounded-md bg-surface-1/60"
        >
          <span className="rounded-xs border-2 border-gain px-1.5 py-0.5 label-pixel text-gain">{t("claimed")}</span>
        </motion.span>
      )}
    </motion.div>
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
