"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { useGame } from "@/features/game/store";
import { formatBps, formatMoney } from "@/lib/format";

/** Open forced loan after an insolvency (ADR-058): shown until repaid. */
export function DebtCard() {
  const t = useTranslations("debt");
  const debt = useGame((state) => state.portfolio?.debtCents ?? 0);
  const bps = useGame((state) => state.portfolio?.debtWithholdingBps ?? 0);
  if (debt <= 0) return null;
  return (
    <Card padding="md" className="border-loss/40" data-testid="debt-card">
      <p className="label-pixel text-loss">{t("title")}</p>
      <p className="mt-1 text-sm text-pretty text-fg-1">
        {t("text", { amount: formatMoney(debt), percent: formatBps(bps).replace("+", "") })}
      </p>
      <p className="mt-1 text-xs text-fg-3">{t("hint")}</p>
    </Card>
  );
}
