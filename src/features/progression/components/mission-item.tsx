"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { PixelCheck } from "@/components/ui/button";
import { Button, type ButtonState } from "@/components/ui/button";
import { burstConfetti } from "@/components/ui/effects";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { useGame } from "@/features/game/store";
import type { Mission } from "@/features/game/types";
import { formatInteger } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

/** Counts are shown as "2 / 3"; large targets (amounts in cents) as a percentage. */
function progressLabel(mission: Mission): string {
  if (mission.target > 100) return `${Math.floor((mission.progress / mission.target) * 100)} %`;
  return `${formatInteger(mission.progress)} / ${formatInteger(mission.target)}`;
}

/** One mission with progress, XP reward and a claim button once it is done. */
export function MissionItem({ mission, compact = false }: { mission: Mission; compact?: boolean }) {
  const t = useTranslations("missions");
  const errorText = useGameErrorText();
  const claim = useGame((state) => state.claimMission);
  const [state, setState] = useState<ButtonState>("idle");
  const anchor = useRef<HTMLDivElement>(null);
  const done = mission.status === "completed";
  const claimed = mission.status === "claimed";

  const onClaim = async () => {
    setState("loading");
    try {
      const result = await claim(mission.id);
      setState("success");
      haptic("success");
      void playSound("coin");
      if (anchor.current) burstConfetti(anchor.current, 18);
      toast.success(t("claimedTitle"), t("claimedText", { xp: result.xpAwarded }), { silent: true });
    } catch (error) {
      setState("idle");
      toast.error(t("claimFailed"), errorText(error));
    }
  };

  return (
    <motion.div
      layout
      transition={SPRING.smooth}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors duration-base",
        done ? "bg-accent-soft" : "bg-surface-2",
        claimed && "opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-xs border-2",
          claimed ? "border-gain bg-gain text-on-semantic" : done ? "border-accent text-accent" : "border-line-2",
        )}
      >
        {(done || claimed) && <PixelCheck className="scale-[0.6]" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-fg-1", compact && "truncate text-sm")}>{mission.title}</p>
        {!claimed && !compact && (
          <div className="mt-1.5 flex items-center gap-2">
            <Progress value={mission.progress / mission.target} label={mission.title} size="sm" className="flex-1" />
            <span className="nums text-xs text-fg-3">{progressLabel(mission)}</span>
          </div>
        )}
      </div>
      <div ref={anchor} className="shrink-0">
        {done ? (
          <Button size="sm" state={state} onClick={() => void onClaim()}>
            +{mission.xp} XP
          </Button>
        ) : (
          <span className={cn("label-pixel", claimed ? "text-gain" : "text-accent")}>
            {claimed ? t("done") : `+${mission.xp} XP`}
          </span>
        )}
      </div>
    </motion.div>
  );
}
