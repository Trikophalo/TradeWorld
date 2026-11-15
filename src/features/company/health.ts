"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { BALANCE } from "@/config/balance";
import type { CompanyEvent, MyCompany } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { archetypeOf, eventModifiers, eventPhase, type Severity } from "@/lib/sim/company-events";
import {
  companyHealth,
  type CompanyHealth,
  type HealthExtras,
  type HealthFactor,
  type HealthFactorKey,
} from "@/lib/sim/company-health";
import { useClock } from "@/lib/use-now";
import { useCompanyEvent } from "./hooks";
import { useCompanyTasks } from "./tasks/task-board";

/*
 * Company health (ADR-162) on the client: the company page has every input already (the company, the task momentum
 * and the current event), so the eight factors are computed here with the same formulas as the hourly close.
 */

const money = (cents: number) => formatMoney(cents, { whole: true });

/** Effect of the company's event now and once it is fully in force (crisis) or won (chance). */
export function eventForHealth(event: CompanyEvent | null | undefined, now: number): HealthExtras["event"] {
  if (!event || event.status === "expired" || event.status === "over") return null;
  const archetype = archetypeOf(event.archetype);
  if (!archetype) return null;
  const severity = event.severity as Severity;
  const phase = eventPhase(
    archetype,
    {
      startedAt: Date.parse(event.startedAt),
      deadlineAt: Date.parse(event.deadlineAt),
      resolvedAt: event.resolvedAt ? Date.parse(event.resolvedAt) : null,
    },
    now,
  );
  if (phase === "over") return null;
  const current = eventModifiers(archetype, severity, phase, event.mitigation);
  // A crisis bites in full after its deadline (less what the response achieved); a chance pays only when won.
  const full = eventModifiers(
    archetype,
    severity,
    "in_force",
    archetype.polarity === "crisis" ? event.mitigation : phase === "in_force" ? event.mitigation : 1,
  );
  return { polarity: archetype.polarity, severity: event.severity, now: current, full };
}

/** Names and reasons of the factors as German sentences; …Cents values become money, the rest stays numbers. */
export function useHealthText() {
  const t = useTranslations("companyHealth");
  return useMemo(() => {
    const factor = (key: HealthFactorKey) => t(`factors.${key}`);
    const reason = (f: HealthFactor) => {
      const values = Object.fromEntries(
        Object.entries(f.reason.values).map(([k, v]) => [k, k.endsWith("Cents") ? money(v) : v]),
      );
      const path = `reasons.${f.reason.key}` as Parameters<typeof t>[0];
      return t.has(path) ? t(path, values) : "";
    };
    return { factor, reason };
  }, [t]);
}

export function useCompanyHealth(company: MyCompany): CompanyHealth {
  const tasks = useCompanyTasks();
  const event = useCompanyEvent();
  const now = useClock();
  const minute = now === null ? null : Math.floor(now / 60_000);
  const momentum = tasks.data?.momentum;
  const openTasks = tasks.data?.tasks.filter((t) => t.status === "open").length;
  const ev = event.data?.event;
  return useMemo(
    () =>
      companyHealth(company, BALANCE, {
        momentum: momentum ?? 1,
        openTasks: openTasks ?? 0,
        event: minute === null ? null : eventForHealth(ev, minute * 60_000),
      }),
    [company, momentum, openTasks, ev, minute],
  );
}
