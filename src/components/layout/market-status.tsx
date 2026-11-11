"use client";

import { useTranslations } from "next-intl";
import { useGame } from "@/features/game/store";
import { cn } from "@/lib/utils";

/** Display only. Whether an order is accepted is decided by the server. */
export function MarketStatus({ className }: { className?: string }) {
  const t = useTranslations("topbar");
  const session = useGame((state) => state.snapshot?.session ?? null);
  const paused = useGame((state) => state.snapshot?.paused ?? false);
  const open = session === null ? null : session === "regular";

  return (
    <span
      title={open === false ? t("afterHoursHint") : undefined}
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-sm bg-surface-2 px-2.5 label-pixel text-fg-2 transition-opacity duration-base",
        open === null && "opacity-0",
        className,
      )}
    >
      <span className="relative grid size-2 place-items-center">
        {open && !paused && <span className="absolute size-2 animate-ping bg-gain opacity-60" />}
        <span className={cn("relative size-2", paused ? "bg-loss" : open ? "bg-gain" : "bg-warn")} />
      </span>
      {paused ? t("marketPaused") : open ? t("marketOpen") : t("marketClosed")}
    </span>
  );
}
