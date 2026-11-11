"use client";

import { useTranslations } from "next-intl";
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
    <div className={cn("flex flex-col items-end leading-none", className)} data-fly-target="cash">
      <span className="label-pixel text-fg-3">{t("cash")}</span>
      <NumberTicker value={cash} format={format} className="mt-0.5 text-base font-semibold text-fg-1" />
    </div>
  );
}
