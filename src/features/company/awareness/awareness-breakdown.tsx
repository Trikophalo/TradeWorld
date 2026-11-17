"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { engine } from "@/features/game/store";
import type { CompanyAwareness } from "@/features/game/types";
import { formatPoints } from "@/lib/format";
import { cn } from "@/lib/utils";

export const COMPANY_AWARENESS_KEY = ["company", "awareness"] as const;

/** Awareness, its cap and what moved it (ADR-188). */
export function useCompanyAwareness(enabled = true) {
  return useQuery({
    queryKey: COMPANY_AWARENESS_KEY,
    queryFn: () => engine.companyAwareness(),
    refetchInterval: 60_000,
    enabled,
  });
}

/** Order of the sources in the list; unknown ones follow. */
const ORDER = [
  "marketing",
  "word_of_mouth",
  "tasks",
  "campaign",
  "moves",
  "interview",
  "news",
  "pitch",
  "event",
  "protest",
  "rescale",
  "decay",
];
const KNOWN = new Set(ORDER);
type SourceKey =
  | "marketing"
  | "word_of_mouth"
  | "tasks"
  | "campaign"
  | "moves"
  | "interview"
  | "news"
  | "pitch"
  | "event"
  | "protest"
  | "rescale"
  | "decay";
type TierKey = "garage" | "small_business" | "gmbh" | "ag";
const TIERS = new Set<string>(["garage", "small_business", "gmbh", "ag"]);

/** Parts above 0,05 points, largest first within the fixed order. */
function lines(parts: Record<string, number>) {
  return Object.entries(parts)
    .filter(([, v]) => Math.abs(v) >= 0.0005)
    .sort(([a], [b]) => ORDER.indexOf(a) + 99 * +!KNOWN.has(a) - (ORDER.indexOf(b) + 99 * +!KNOWN.has(b)));
}

/**
 * The awareness in one card (ADR-188): value against its cap and why the cap is where it is, the strength
 * "Bekanntheit", and the last hour by source ("+1,2 Marketing, +0,4 Aufgaben, −0,3 Vergessen"). Mountable anywhere
 * on the company page; `preview` shows fixed data (/dev/ui).
 */
export function AwarenessBreakdown({ preview, className }: { preview?: CompanyAwareness; className?: string } = {}) {
  const t = useTranslations("awareness");
  const live = useCompanyAwareness(!preview);
  const data = preview ?? live.data;

  if (!data) {
    return (
      <Card padding="lg" className={cn("space-y-3", className)} aria-hidden>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-full rounded-xs" />
        <Skeleton className="h-10 w-full rounded-md" />
      </Card>
    );
  }
  const pct = (share: number) => Math.round(share * 100);
  const source = (key: string) => (KNOWN.has(key) ? t(`source.${key as SourceKey}`) : key);
  const last = data.lastHour ? lines(data.lastHour.parts) : [];
  const since = lines(data.since);
  const atCap = data.awareness >= data.cap - 0.005;

  return (
    <Card padding="lg" className={cn("space-y-3", className)} data-testid="awareness-breakdown">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg-1">{t("title")}</h3>
        <p className="nums text-sm text-fg-2">{t("valueOfCap", { value: pct(data.awareness), cap: pct(data.cap) })}</p>
      </div>
      <Progress value={data.awareness / Math.max(0.01, data.cap)} label={t("title")} tone={atCap ? "gold" : "accent"} />
      <p className="text-xs text-fg-3">
        {t("capWhy", {
          tierCap: pct(data.tierCap),
          tier: TIERS.has(data.tier) ? t(`tier.${data.tier as TierKey}`) : data.tier,
          stage: data.stage,
          stagePts: pct(data.stage * data.perStage),
          level: data.expansionLevel,
          levelPts: pct(data.expansionLevel * data.perExpansionLevel),
        })}
      </p>
      <p className="nums text-xs text-fg-2">{t("strength", { score: Math.round(data.strength) })}</p>
      <div className="space-y-1">
        <p className="text-xs font-medium text-fg-2">{t("lastHour")}</p>
        {last.length === 0 ? (
          <p className="text-xs text-fg-3">{t("nothing")}</p>
        ) : (
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {last.map(([k, v]) => (
              <li key={k} className={cn("nums text-xs", v >= 0 ? "text-gain" : "text-loss")}>
                {formatPoints(v)} {source(k)}
              </li>
            ))}
          </ul>
        )}
        {since.length > 0 && (
          <p className="nums text-xs text-fg-2">
            {t("since")} {since.map(([k, v]) => `${formatPoints(v)} ${source(k)}`).join(", ")}
          </p>
        )}
      </div>
    </Card>
  );
}
