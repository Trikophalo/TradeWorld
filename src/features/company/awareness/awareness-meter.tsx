"use client";

import { useTranslations } from "next-intl";
import { Progress } from "@/components/ui/progress";
import type { MyCompany } from "@/features/game/types";
import { awarenessView } from "./awareness-view";

/** Awareness against its cap as a bar (ADR-188); the same numbers as the status bar via awarenessView. */
export function AwarenessMeter({
  company,
}: {
  company: Pick<MyCompany, "awarenessBps" | "tier" | "stage" | "expansionLevel">;
}) {
  const t = useTranslations("awareness");
  const v = awarenessView(company);
  return (
    <div data-testid="awareness-meter">
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-fg-2">{t("title")}</span>
        <span className="nums text-fg-1">{t("valueOfCap", { value: v.pct, cap: v.capPct })}</span>
      </div>
      <Progress value={v.ofCap} label={t("title")} tone={v.atCap ? "gold" : "accent"} />
    </div>
  );
}
