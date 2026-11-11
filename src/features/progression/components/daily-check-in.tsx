"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { useGame } from "@/features/game/store";
import { useTutorial } from "@/features/tutorial/store";
import { playSound } from "@/lib/sound";

/**
 * Daily bonus: the first visit of a day pays login XP plus a streak bonus.
 * Waits until the first-session tutorial is done, so the two never overlap.
 */
export function DailyCheckIn() {
  const t = useTranslations("missions");
  const loaded = useGame((state) => state.portfolio !== null);
  const tutorial = useTutorial((state) => state.status);
  const done = useRef(false);

  useEffect(() => {
    if (!loaded || tutorial !== "done" || done.current) return;
    done.current = true;
    void useGame
      .getState()
      .checkIn()
      .then((result) => {
        if (result.alreadyCheckedIn || result.xpAwarded <= 0) return;
        void playSound("notify");
        toast.success(t("checkInTitle"), t("checkInText", { xp: result.xpAwarded, days: result.streakDays }), {
          silent: true,
        });
      })
      .catch(() => undefined);
  }, [loaded, tutorial, t]);

  return null;
}
