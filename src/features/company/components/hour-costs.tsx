"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { engine } from "@/features/game/store";
import type { CompanyHourCosts, HourCostPart } from "@/features/game/types";
import { money } from "../listed/shared";

/*
 * Fixed and variable costs of the last closed hour (ADR-208, Nachtrag): the two dashboard tiles read this query, the
 * sheet shows where the money went. All numbers come from the server (get_company_hour_costs).
 */

/** Under ["company"], so useCompanyRefresh reloads it after every closed hour. */
export const HOUR_COSTS_KEY = ["company", "hour-costs"] as const;

export function useHourCosts() {
  return useQuery({ queryKey: HOUR_COSTS_KEY, queryFn: () => engine.companyHourCosts(), refetchInterval: 60_000 });
}

export type CostKind = "fixed" | "variable";

const KNOWN = [
  "wages_players",
  "wages_ai",
  "talents",
  "rent",
  "marketing",
  "upkeep",
  "advisor",
  "subsidiaries",
  "insurance",
  "overhead",
  "goods",
  "profit_share",
  "location_fee",
  "supply_fees",
] as const;
type PartKey = (typeof KNOWN)[number];
const isKnown = (key: string): key is PartKey => (KNOWN as readonly string[]).includes(key);

/** The parts of one kind, the biggest first. */
export function costParts(data: CompanyHourCosts, kind: CostKind): HourCostPart[] {
  return [...(kind === "fixed" ? data.fixed : data.variable)].sort((a, b) => b.cents - a.cents);
}

/** The breakdown of fixed or variable costs in a sheet: every part with its amount and share of the total. */
export function HourCostsSheet({ kind, onClose }: { kind: CostKind | null; onClose: () => void }) {
  const t = useTranslations("hq.dashNew.costs");
  const q = useHourCosts();
  const data = q.data;
  const shown = kind ?? "fixed";
  const parts = data ? costParts(data, shown) : [];
  const total = data ? (shown === "fixed" ? data.fixedCents : data.variableCents) : 0;
  const paid = parts.filter((p) => p.cents > 0);
  const zero = parts.filter((p) => p.cents <= 0);
  const label = (key: string) => t(`parts.${isKnown(key) ? key : "other"}`);
  const time = data?.hourStart
    ? new Date(data.hourStart).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : null;
  return (
    <Sheet
      open={kind !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t(shown === "fixed" ? "fixedTitle" : "variableTitle")}
      description={t(shown === "fixed" ? "fixedText" : "variableText")}
    >
      <div className="space-y-4" data-testid="hour-costs-sheet" data-kind={shown}>
        {q.isError ? (
          <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm text-loss">{t("error")}</p>
        ) : !data ? (
          <div className="space-y-2" aria-hidden data-testid="hour-costs-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : data.hourStart === null ? (
          <EmptyState
            art={<PixelIcon {...UI_ICONS.briefcase} scale={4} />}
            title={t("empty")}
            description={t("emptyText")}
          />
        ) : (
          <>
            {time && <p className="text-xs text-fg-3">{t("hour", { time })}</p>}
            <ul className="space-y-2">
              {paid.map((p) => (
                <li key={p.key} className="rounded-md bg-surface-2 px-3 py-2" data-testid={`cost-part-${p.key}`}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-fg-2">{label(p.key)}</span>
                    <span className="shrink-0 nums font-semibold text-fg-1">
                      {t("perHour", { amount: money(p.cents) })}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-surface-3" aria-hidden>
                    <div
                      className="h-full origin-left rounded-pill bg-accent"
                      style={{ transform: `scaleX(${total > 0 ? Math.min(1, p.cents / total) : 0})` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-3 border-t border-line-1 pt-3 text-sm">
              <span className="font-medium text-fg-1">{t("total")}</span>
              <span className="nums font-semibold text-fg-1" data-testid="hour-costs-total">
                {t("perHour", { amount: money(total) })}
              </span>
            </div>
            {zero.length > 0 && (
              <p className="text-xs text-pretty text-fg-3">
                {t("zero")}: {zero.map((p) => label(p.key)).join(", ")}
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
