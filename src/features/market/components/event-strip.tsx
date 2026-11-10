"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Countdown } from "@/components/ui/countdown";
import { fadeUp, staggerContainer } from "@/lib/motion";
import { useMountTime } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const TONES = { info: "bg-info", warn: "bg-warn", accent: "bg-accent", loss: "bg-loss" } as const;

/** Upcoming scheduled events with countdowns. Example offsets until the event system exists (M7). */
const DEMO_EVENTS = [
  { key: "eventBell", inMinutes: 47, tone: "warn" },
  { key: "eventEarnings", inMinutes: 134, tone: "accent", suffix: "VLT" },
  { key: "eventRate", inMinutes: 312, tone: "info" },
  { key: "eventTrial", inMinutes: 505, tone: "loss" },
] as const;

export function EventStrip() {
  const t = useTranslations("home");
  const mountedAt = useMountTime();
  return (
    <section aria-label={t("events")}>
      <h2 className="mb-2.5 label-pixel text-fg-2">{t("events")}</h2>
      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="-mx-4 no-scrollbar flex snap-x gap-2.5 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-4 lg:px-0"
      >
        {DEMO_EVENTS.map((event) => (
          <motion.li
            key={event.key}
            variants={fadeUp}
            className="flex min-w-44 snap-start items-center gap-3 rounded-md border border-line-1 bg-surface-1 px-3.5 py-3"
          >
            <span className={cn("h-8 w-1 shrink-0", TONES[event.tone])} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg-1">
                {t(event.key)}
                {"suffix" in event && ` ${event.suffix}`}
              </span>
              {mountedAt === null ? (
                <span className="nums text-sm text-fg-3">--:--</span>
              ) : (
                <Countdown target={mountedAt + event.inMinutes * 60_000} className="text-sm text-fg-3" />
              )}
            </span>
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
