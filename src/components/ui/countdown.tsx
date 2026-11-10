"use client";

import { formatCountdown } from "@/lib/format";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * Time left until `target` (epoch milliseconds). Shows a placeholder until
 * the client clock is available, so server and client markup always match.
 */
export function Countdown({ target, className }: { target: number; className?: string }) {
  const now = useClock();
  return (
    <time className={cn("nums", className)}>{now === null ? "--:--" : formatCountdown((target - now) / 1000)}</time>
  );
}
