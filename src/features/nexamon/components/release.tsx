"use client";

import { useTranslations } from "next-intl";
import type { NexamonSetKey } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { useServerClock } from "@/features/game/server-clock";
import { formatCountdown } from "@/lib/format";
import { nexamonReleaseAt } from "@/lib/sim/nexamon";
import { cn } from "@/lib/utils";

const berlinTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

/**
 * A set before its release (ADR-182): whether it is still locked, the release time in Berlin and the seconds left.
 * Before the clock is known a set with a release time counts as locked, so nothing can be bought too early.
 */
export function useSetRelease(set: NexamonSetKey | null) {
  const now = useServerClock();
  const at = set ? nexamonReleaseAt(set) : null;
  const locked = at !== null && (now === null || now < at);
  return {
    locked,
    time: at !== null ? berlinTime.format(at) : null,
    secondsLeft: at !== null && now !== null ? Math.max(0, Math.ceil((at - now) / 1000)) : null,
  };
}

/** "Neu ab 17:30" with a countdown, on a pack that cannot be bought yet. */
export function ReleaseBadge({ set, className }: { set: NexamonSetKey; className?: string }) {
  const t = useTranslations("nexamon");
  const r = useSetRelease(set);
  if (!r.locked || !r.time) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)} data-testid={`release-${set}`}>
      <Badge tone="accent">{t("shop.releaseAt", { time: r.time })}</Badge>
      {r.secondsLeft !== null && (
        <span className="nums text-xs text-fg-2">
          {t("shop.releaseIn", { countdown: formatCountdown(r.secondsLeft) })}
        </span>
      )}
    </span>
  );
}
