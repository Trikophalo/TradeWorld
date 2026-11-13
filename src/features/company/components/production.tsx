"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BALANCE } from "@/config/balance";
import type { MyCompany } from "@/features/game/types";
import { formatBps, formatCountdown, formatMoney } from "@/lib/format";
import { SPRING, STAGGER } from "@/lib/motion";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { bottleneck } from "../routes";

const money = (cents: number) => formatMoney(Math.round(cents), { whole: true });

/**
 * "So verdient deine Firma Geld" (ADR-102): the company works by itself every hour. Four boxes show the chain
 * team → production → customers → profit with this company's numbers, then one sentence names the bottleneck and one
 * button leads to the step that helps most.
 */
export function ProductionCard({
  company,
  onTeam,
  onCampaign,
}: {
  company: MyCompany;
  onTeam: () => void;
  onCampaign: () => void;
}) {
  const t = useTranslations("production");
  const reduced = useReducedMotion();
  const now = useClock();
  const live = company.live;
  const neck = bottleneck(company);
  const capacity = live ? live.capacityPerHourCents : company.capacityCents / BALANCE.time.quarterHours;
  const sold = live ? Math.min(live.demandPerHourCents, live.capacityPerHourCents) : null;
  const nextHour = now === null ? null : Math.ceil(now / 3_600_000) * 3_600_000;
  // The founder works too.
  const people = 1 + company.employees + company.aiWorkers;

  const steps: { art: PixelArt; label: string; value: string; hint: string; tone?: string }[] = [
    {
      art: UI_ICONS.profile,
      label: t("team"),
      value: t("teamValue", { count: people }),
      hint: t("teamHint"),
    },
    {
      art: UI_ICONS.company,
      label: t("make"),
      value: t("perHour", { amount: money(capacity) }),
      hint: t("makeHint"),
      tone: neck.kind === "staff" ? "text-warn" : undefined,
    },
    {
      art: UI_ICONS.heart,
      label: t("customers"),
      value: live ? t("perHour", { amount: money(live.demandPerHourCents) }) : t("unknown"),
      hint: t("customersHint", { awareness: formatBps(company.awarenessBps).replace("+", "") }),
      tone: neck.kind === "customers" ? "text-warn" : undefined,
    },
    {
      art: UI_ICONS.upgrade,
      label: t("profit"),
      value: live ? t("perHour", { amount: formatMoney(live.profitPerHourCents, { whole: true, sign: true }) }) : "—",
      hint:
        live && sold !== null
          ? t("profitHint", { sold: money(sold), contract: money(live.contractRevenuePerHourCents) })
          : t("profitHintWaiting"),
      tone: live ? (live.profitPerHourCents >= 0 ? "text-gain" : "text-loss") : undefined,
    },
  ];

  return (
    <Card padding="lg" className="space-y-4 overflow-hidden" data-testid="production" data-bottleneck={neck.kind}>
      <div>
        <h2 className="label-pixel text-fg-2">{t("title")}</h2>
        <p className="mt-1 text-sm text-pretty text-fg-2">{t("intro")}</p>
      </div>

      <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <motion.li
            key={step.label}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING.smooth, delay: reduced ? 0 : i * STAGGER * 2 }}
            className="relative rounded-md border border-line-1 bg-surface-2 p-3"
          >
            <div className="flex items-center gap-2 text-accent">
              <PixelIcon {...step.art} scale={2} />
              <span className="label-pixel text-fg-3">
                {i + 1}. {step.label}
              </span>
            </div>
            <p className={cn("mt-1.5 nums text-base font-semibold text-fg-1", step.tone)}>{step.value}</p>
            <p className="mt-0.5 text-xs text-pretty text-fg-3">{step.hint}</p>
            {i < steps.length - 1 && (
              <span aria-hidden className="absolute top-1/2 -right-2 z-10 hidden -translate-y-1/2 text-fg-3 lg:block">
                ▸
              </span>
            )}
          </motion.li>
        ))}
      </ol>

      <Advice
        tone={neck.kind === "waiting" ? "info" : neck.kind === "balanced" ? "good" : "warn"}
        title={t(`neck.${neck.kind}.title`)}
        text={
          neck.kind === "waiting"
            ? t("neck.waiting.text", {
                time: nextHour === null ? "--:--" : formatCountdown(Math.max(0, (nextHour - (now ?? 0)) / 1000)),
              })
            : neck.kind === "customers"
              ? t("neck.customers.text", { free: money(neck.cents) })
              : neck.kind === "staff"
                ? t("neck.staff.text", { missing: money(neck.cents) })
                : t("neck.balanced.text")
        }
        action={
          neck.kind === "customers" ? (
            <Button size="sm" onClick={onCampaign} data-testid="production-action">
              {t("neck.customers.action")}
            </Button>
          ) : neck.kind === "staff" ? (
            <Button size="sm" onClick={onTeam} data-testid="production-action">
              {t("neck.staff.action")}
            </Button>
          ) : null
        }
      />

      <details className="group rounded-md border border-line-1 px-3 py-2 text-sm">
        <summary className="cursor-pointer list-none font-medium text-fg-1 focus-ring">
          <span className="mr-1 inline-block transition-transform duration-fast group-open:rotate-90">▸</span>
          {t("faq.title")}
        </summary>
        <ul className="mt-2 space-y-2 text-pretty text-fg-2">
          {(t.raw("faq.items") as { q: string; a: string }[]).map((item) => (
            <li key={item.q}>
              <p className="font-medium text-fg-1">{item.q}</p>
              <p className="text-fg-2">{item.a}</p>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function Advice({
  tone,
  title,
  text,
  action,
}: {
  tone: "info" | "good" | "warn";
  title: string;
  text: string;
  action: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border px-3 py-3",
        tone === "info" && "border-info/40 bg-info-soft",
        tone === "good" && "border-gain/40 bg-gain-soft",
        tone === "warn" && "border-warn/40 bg-warn-soft",
      )}
      data-testid="production-advice"
    >
      <div className="min-w-56 flex-1">
        <p className="text-sm font-semibold text-fg-1">{title}</p>
        <p className="text-sm text-pretty text-fg-2">{text}</p>
      </div>
      {action}
    </div>
  );
}
