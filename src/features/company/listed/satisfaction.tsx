"use client";

import { useTranslations } from "next-intl";
import { BALANCE } from "@/config/balance";
import type { ListedCompany } from "@/features/game/listed-types";
import { formatBps, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemList } from "./catalogue";
import { ZoneGauge, ZoneHistoryChart } from "./charts";
import { Panel, Stat } from "./shared";
import { sortedDrivers } from "./view";

const oneDecimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const points = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${oneDecimal.format(Math.abs(value))}`;

/** What pushes a value up and what pulls it down, as bars around a zero line. */
export function DriverBars({
  drivers,
  label,
  max,
}: {
  drivers: Record<string, number>;
  label: (key: string) => string;
  max: number;
}) {
  const t = useTranslations("hq.staff");
  const rows = sortedDrivers(drivers);
  if (rows.length === 0) return <p className="text-sm text-fg-3">{t("driversNone")}</p>;
  return (
    <ul className="space-y-1.5" data-testid="drivers">
      {rows.map((d) => {
        const share = Math.min(1, Math.abs(d.value) / max);
        return (
          <li key={d.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_3rem] items-center gap-2 text-sm">
            <span className="truncate text-fg-2">{label(d.key)}</span>
            <span className="relative block h-2.5 rounded-pill bg-surface-3" aria-hidden>
              <span className="absolute inset-y-0 left-1/2 w-px bg-fg-3" />
              <span
                className={cn(
                  "absolute inset-y-0 w-1/2 rounded-pill",
                  d.value > 0 ? "left-1/2 origin-left bg-gain" : "right-1/2 origin-right bg-loss",
                )}
                style={{ transform: `scaleX(${share})` }}
              />
            </span>
            <span className={cn("text-right nums font-medium", d.value > 0 ? "text-gain" : "text-loss")}>
              {points(d.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Employee satisfaction of a listed company (ADR-167): the gauge with its three zones, the last 72 hours, what
 * drives it, and the two ways to lift it: benefits (running cost per head) and one-off team actions (cooldown).
 */
export function SatisfactionPanel({ listed }: { listed: ListedCompany }) {
  const t = useTranslations("hq.staff");
  const tz = useTranslations("listed.zones");
  const td = useTranslations("listed.satisfactionDrivers");
  const s = listed.satisfaction;
  const rules = BALANCE.listed.satisfaction;
  const benefits = listed.items.filter((i) => i.kind === "benefit" && (i.status === "active" || i.status === "paused"));
  const benefitCost = benefits.reduce((sum, i) => sum + i.upkeepCents, 0);
  const heading = s.target > s.value + 0.5 ? "rising" : s.target < s.value - 0.5 ? "falling" : "steady";
  return (
    <div className="space-y-4" id="satisfaction" data-testid="satisfaction">
      <Panel
        title={t("satisfactionTitle")}
        aside={<span className="nums text-xs text-fg-3">{t("headcount", { count: listed.headcount })}</span>}
      >
        <div className="grid items-center gap-5 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <ZoneGauge
            value={s.value}
            target={s.target}
            green={s.green}
            red={s.red}
            label={t("satisfactionTitle")}
            zoneLabel={tz(s.zone)}
          />
          <div className="space-y-3">
            <p
              className={cn(
                "rounded-md px-3 py-2 text-sm text-pretty",
                s.zone === "green"
                  ? "bg-gain-soft text-gain"
                  : s.zone === "red"
                    ? "bg-loss-soft text-loss"
                    : "bg-warn-soft text-warn",
              )}
              data-testid="satisfaction-zone"
            >
              {t(`zoneText.${s.zone}`, {
                green: s.green,
                red: s.red,
                hours: rules.quits.everyRedHours,
              })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label={t("target")} hint={t(`heading.${heading}`)} testId="satisfaction-target">
                {Math.round(s.target)}
              </Stat>
              <Stat
                label={t("capacityEffect")}
                tone={s.capacityFactor < 1 ? "loss" : s.capacityFactor > 1 ? "gain" : undefined}
                hint={s.qualityAddBps !== 0 ? t("qualityEffect", { percent: formatBps(s.qualityAddBps) }) : undefined}
              >
                {formatBps(Math.round((s.capacityFactor - 1) * 10_000))}
              </Stat>
            </div>
            {s.zone === "red" && s.redHours > 0 && (
              <p className="nums text-xs text-loss">{t("redHours", { hours: s.redHours })}</p>
            )}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-fg-1">
            {t("historyTitle", { hours: BALANCE.listed.historyHours })}
          </p>
          <ZoneHistoryChart
            history={listed.history}
            green={s.green}
            red={s.red}
            label={t("satisfactionTitle")}
            series={[
              { key: "satisfaction", label: t("satisfactionTitle"), pick: (p) => p.satisfaction, tone: "accent" },
            ]}
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-fg-1">
            {t("driversTitle", { base: Math.round(s.drivers.base ?? rules.base) })}
          </p>
          <DriverBars
            drivers={s.drivers}
            max={rules.benefitsMax}
            label={(key) => (td.has(key as Parameters<typeof td>[0]) ? td(key as Parameters<typeof td>[0]) : key)}
          />
        </div>
      </Panel>

      <Panel
        title={t("benefitsTitle")}
        id="benefits"
        testId="benefits"
        aside={
          <span className="nums text-xs text-fg-3">
            {t("benefitsCost", { count: benefits.length, amount: formatMoney(benefitCost) })}
          </span>
        }
      >
        <p className="text-sm text-pretty text-fg-3">{t("benefitsIntro", { max: rules.benefitsMax })}</p>
        <ItemList listed={listed} kinds={["benefit"]} />
      </Panel>

      <Panel title={t("actionsTitle")} id="team-actions" testId="team-actions">
        <p className="text-sm text-pretty text-fg-3">{t("actionsIntro")}</p>
        <ItemList listed={listed} kinds={["action"]} />
      </Panel>
    </div>
  );
}
