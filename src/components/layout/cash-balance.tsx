"use client";

import { useTranslations } from "next-intl";
import { COIN } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useGame } from "@/features/game/store";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const format = (value: number) => formatMoney(Math.round(value));

/** Cash in the top bar. `data-fly-target` is where vault coins fly to. */
export function CashBalance({ className }: { className?: string }) {
  const t = useTranslations("topbar");
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  return (
    <div className={cn("flex items-center gap-2", className)} data-fly-target="cash">
      {/* The coin hops whenever the balance changes (ADR-108). */}
      <span key={cash} aria-hidden className="hidden animate-hop sm:block">
        <PixelIcon {...COIN} scale={1} />
      </span>
      <div className="flex flex-col items-end leading-none">
        <span className="label-pixel text-fg-3">{t("cash")}</span>
        <NumberTicker value={cash} format={format} className="mt-0.5 text-base font-semibold text-fg-1" />
      </div>
    </div>
  );
}
