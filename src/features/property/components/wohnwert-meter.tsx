"use client";

import { useTranslations } from "next-intl";
import { Progress } from "@/components/ui/progress";
import { BALANCE } from "@/config/balance";
import type { WohnwertState } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { wohnwertTips } from "@/lib/sim/rentals";
import { cn } from "@/lib/utils";

const PARTS = ["value", "variety", "fill", "layers", "style", "floor"] as const;
const MAX = BALANCE.rentals.wohnwert.points;
const MIN_AI = BALANCE.rentals.ai.minWohnwert;

/** Tone of a Wohnwert: below the AI minimum warn, from 60 good, from 85 gold. */
export function wohnwertTone(total: number): "warn" | "accent" | "gain" | "gold" {
  return total < MIN_AI ? "warn" : total < 60 ? "accent" : total < 85 ? "gain" : "gold";
}

/**
 * The Wohnwert of a home (ADR-158): the score out of 100, the six parts and, in full size, the three tips that raise
 * it most. The room editor feeds it the layout being edited, so it changes with every piece.
 */
export function WohnwertMeter({
  wohnwert,
  compact = false,
  className,
}: {
  wohnwert: WohnwertState;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("rentals.wohnwert");
  const tips = compact ? [] : wohnwertTips(wohnwert);
  const tone = wohnwertTone(wohnwert.total);
  return (
    <section className={cn("space-y-3", className)} data-testid="wohnwert" data-total={wohnwert.total}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <p className="nums text-fg-1">
          <span
            className={cn(
              "text-2xl font-semibold",
              tone === "warn"
                ? "text-warn"
                : tone === "gold"
                  ? "text-gold"
                  : tone === "gain"
                    ? "text-gain"
                    : "text-fg-1",
            )}
            data-testid="wohnwert-total"
          >
            {wohnwert.total}
          </span>
          <span className="text-sm text-fg-3"> / 100</span>
        </p>
      </div>
      <Progress value={wohnwert.total / 100} label={t("title")} tone={tone} />
      {wohnwert.total < MIN_AI && <p className="text-xs text-pretty text-warn">{t("belowAi", { min: MIN_AI })}</p>}
      {!compact && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2" aria-label={t("partsLabel")}>
          {PARTS.map((key) => (
            <li key={key} className="min-w-0 space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-fg-2">{t(`parts.${key}`)}</span>
                <span className="nums text-fg-3">
                  {wohnwert.parts[key]}/{MAX[key]}
                </span>
              </div>
              <Progress value={wohnwert.parts[key] / MAX[key]} label={t(`parts.${key}`)} size="sm" tone="accent" />
            </li>
          ))}
        </ul>
      )}
      {tips.length > 0 && (
        <div className="space-y-1.5 rounded-md bg-surface-2 p-3" data-testid="wohnwert-tips">
          <p className="text-xs font-semibold text-fg-1">{t("tipsTitle")}</p>
          <ul className="space-y-1 text-xs text-pretty text-fg-2">
            {tips.map((tip) => (
              <li key={tip.tip} className="flex gap-2">
                <span className="shrink-0 nums font-semibold text-gain">+{tip.points}</span>
                <span>
                  {t(`tips.${tip.tip}`, {
                    target: formatMoney(wohnwert.targetCents, { whole: true }),
                    categories: wohnwert.categories,
                    goal: BALANCE.rentals.wohnwert.varietyTarget,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
