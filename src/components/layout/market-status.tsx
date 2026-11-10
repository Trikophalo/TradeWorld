"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { TIME_ZONE } from "@/config/app";
import { cn } from "@/lib/utils";

const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;

function berlinHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE }).format(date),
  );
}

/** Display only. Whether an order is accepted is decided by the server. */
export function MarketStatus({ className }: { className?: string }) {
  const t = useTranslations("topbar");
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const update = () => {
      const hour = berlinHour(new Date());
      setOpen(hour >= OPEN_HOUR && hour < CLOSE_HOUR);
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-sm bg-surface-2 px-2.5 label-pixel text-fg-2 transition-opacity duration-base",
        open === null && "opacity-0",
        className,
      )}
    >
      <span className="relative grid size-2 place-items-center">
        {open && <span className="absolute size-2 animate-ping bg-gain opacity-60" />}
        <span className={cn("relative size-2", open ? "bg-gain" : "bg-warn")} />
      </span>
      {open ? t("marketOpen") : t("marketClosed")}
    </span>
  );
}
