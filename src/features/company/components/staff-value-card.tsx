"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import { useGame } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCompanyTeam } from "../hooks";
import { Panel } from "../listed/shared";
import { MONTH_DAYS, staffValue } from "../staff-value";

const money = (cents: number) => formatMoney(cents, { whole: true });

/**
 * Every person of the company with what they cost and bring per month (30 days), sorted by what is left, with a
 * mini bar, totals and a plain "lohnt sich" hint. On the dashboard and in the staff tab.
 */
export function StaffValueCard({ company, id }: { company: MyCompany; id?: string }) {
  const t = useTranslations("hq.staffValue");
  const team = useCompanyTeam(company.id);
  const nickname = useGame((state) => state.portfolio?.nickname ?? "");
  const value = useMemo(
    () =>
      team.data
        ? staffValue({
            founder: { nickname, productivityBps: company.founderProductivityBps },
            members: team.data.map((m) => ({
              id: m.playerJobId,
              nickname: m.nickname,
              salaryCentsPerHour: m.salaryCentsPerHour,
              productivityBps: m.productivityBps,
            })),
            aiWorkers: company.aiWorkers,
            aiWageCentsPerHour: company.aiWageCentsPerHour,
            aiProductivityBps: 10_000,
            hours: company.hours,
            paidHoursPerDay: BALANCE.careers.paidHoursPerDayCap,
          })
        : null,
    [team.data, nickname, company],
  );

  if (!value) {
    return (
      <Panel title={t("title")} id={id} testId="staff-value">
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </Panel>
    );
  }
  const max = Math.max(1, ...value.rows.map((r) => Math.max(r.costCents, r.contributionCents)));
  const net = value.contributionCents - value.costCents;
  return (
    <Panel
      title={t("title")}
      id={id}
      testId="staff-value"
      aside={
        <span className="text-xs text-fg-3">
          {t("perMonth", { days: MONTH_DAYS })}
          {value.hours > 0 && ` · ${t("basis", { count: value.hours })}`}
        </span>
      }
    >
      {value.aiUtilizationBps !== null && (
        <p className="text-xs text-fg-3" data-testid="staff-value-ai-use">
          {t("aiUse", { percent: Math.round(value.aiUtilizationBps / 100) })}
        </p>
      )}
      {value.noRevenue && <p className="text-sm text-pretty text-fg-3">{t("noRevenue")}</p>}
      <ul className="space-y-2">
        {value.rows.map((r) => (
          <li key={r.id} className="rounded-md bg-surface-2 px-3 py-2" data-testid="staff-value-row" data-kind={r.kind}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 truncate text-sm font-medium text-fg-1">
                {r.kind === "ai" ? t("ai", { n: r.name }) : r.name}
                {r.kind === "founder" && <span className="ml-1.5 label-pixel text-gold">{t("founder")}</span>}
              </span>
              {r.worth && (
                <Badge tone={r.worth === "yes" ? "gain" : "loss"} data-testid="staff-value-worth">
                  {t(r.worth === "yes" ? "worth" : "notWorth")}
                </Badge>
              )}
            </div>
            <div className="mt-1.5 space-y-1" aria-hidden>
              <span className="block h-1.5 rounded-pill bg-surface-3">
                <span
                  className="block h-full origin-left rounded-pill bg-gain"
                  style={{ transform: `scaleX(${r.contributionCents / max})` }}
                />
              </span>
              <span className="block h-1.5 rounded-pill bg-surface-3">
                <span
                  className="block h-full origin-left rounded-pill bg-loss"
                  style={{ transform: `scaleX(${r.costCents / max})` }}
                />
              </span>
            </div>
            <p className="mt-1 flex flex-wrap justify-between gap-x-3 nums text-xs text-fg-3">
              <span className="text-gain">{t("brings", { amount: money(r.contributionCents) })}</span>
              <span className="text-loss">{t("costs", { amount: money(r.costCents) })}</span>
              <span className={cn("font-semibold", r.netCents >= 0 ? "text-gain" : "text-loss")}>
                {formatMoney(r.netCents, { whole: true, sign: true })}
              </span>
            </p>
          </li>
        ))}
      </ul>
      <dl className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line-1 pt-3 nums text-sm">
        <div>
          <dt className="text-xs text-fg-3">{t("totalBrings")}</dt>
          <dd className="font-semibold text-gain">{money(value.contributionCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">{t("totalCosts")}</dt>
          <dd className="font-semibold text-loss">{money(value.costCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">{t("totalNet")}</dt>
          <dd className={cn("font-semibold", net >= 0 ? "text-gain" : "text-loss")} data-testid="staff-value-net">
            {formatMoney(net, { whole: true, sign: true })}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-pretty text-fg-3">
        {t("hint", { days: MONTH_DAYS, hours: BALANCE.careers.paidHoursPerDayCap })}
      </p>
    </Panel>
  );
}
