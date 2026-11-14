"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useShowWindow } from "./use-show-window";

/** Marks the News tab while the hourly show is on ("LIVE") or about to start ("Gleich") (ADR-150). */
export function ShowBadge({ className, dotOnly }: { className?: string; dotOnly?: boolean }) {
  const t = useTranslations("newsShow");
  const state = useShowWindow();
  if (!state) return null;
  const live = state === "live";
  if (dotOnly) {
    return (
      <span
        className={cn("size-2 rounded-pill", live ? "animate-pulse-danger bg-loss" : "bg-accent", className)}
        aria-label={live ? t("badgeLive") : t("badgeSoon")}
        data-testid="news-show-dot"
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 label-pixel text-[0.5625rem] leading-none",
        live ? "bg-loss-soft text-loss" : "bg-accent-soft text-accent",
        className,
      )}
      data-testid="news-show-badge"
    >
      <span className={cn("size-1.5 rounded-pill", live ? "animate-pulse-danger bg-loss" : "bg-accent")} aria-hidden />
      {live ? t("badgeLive") : t("badgeSoon")}
    </span>
  );
}
