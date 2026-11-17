"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useServerClock } from "@/features/game/server-clock";
import type { MyCompany } from "@/features/game/types";
import { cn } from "@/lib/utils";
import { hourlyCloseOverdue } from "../routes";
import { InfoTip } from "./firm-layout";

/*
 * The status line under the company header (ADR-183): one word on how the company does, and the four slow values
 * that decide the demand (awareness, quality, reputation, strengths), each with an "i" that says what it means.
 * Visible on every tab.
 */

type Tone = "gain" | "info" | "warn" | "loss";
const TEXT: Record<Tone, string> = { gain: "text-gain", info: "text-info", warn: "text-warn", loss: "text-loss" };
const DOT: Record<Tone, string> = { gain: "bg-gain", info: "bg-info", warn: "bg-warn", loss: "bg-loss" };

export type CompanyStatus = "closeError" | "distress" | "late" | "first" | "loss" | "profit";

/** How the company does right now, most urgent first. */
export function companyStatus(company: MyCompany, late: boolean): CompanyStatus {
  if (company.strengths?.closeError) return "closeError";
  if (company.distress || company.unpaidCents > 0) return "distress";
  const last = company.hours.at(-1);
  if (!last) return late ? "late" : "first";
  return last.profitCents >= 0 ? "profit" : "loss";
}

const STATUS_TONE: Record<CompanyStatus, Tone> = {
  closeError: "loss",
  distress: "loss",
  late: "warn",
  first: "info",
  loss: "warn",
  profit: "gain",
};

export function CompanyStatusBar({ company }: { company: MyCompany }) {
  const t = useTranslations("hq.status");
  const late = hourlyCloseOverdue(company, useServerClock());
  const status = companyStatus(company, late);
  const awareness = company.awarenessBps / 100;
  const quality = company.qualityBps / 100;
  const reputation = company.reputation;
  const strengths = company.strengths;
  const items: { key: string; label: string; value: ReactNode; tone: Tone; info: string }[] = [
    {
      key: "awareness",
      label: t("awareness"),
      value: `${awareness.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`,
      tone: awareness >= 30 ? "gain" : awareness >= 10 ? "info" : "warn",
      info: t("awarenessInfo"),
    },
    {
      key: "quality",
      label: t("quality"),
      value: `${Math.round(quality)} %`,
      tone: quality >= 70 ? "gain" : quality >= 50 ? "info" : "warn",
      info: t("qualityInfo"),
    },
  ];
  if (reputation) {
    const heading =
      reputation.target > reputation.value + 0.5 ? "↗" : reputation.target < reputation.value - 0.5 ? "↘" : "";
    items.push({
      key: "reputation",
      label: t("reputation"),
      value: `${Math.round(reputation.value)}${heading ? ` ${heading}` : ""}`,
      tone:
        reputation.value >= 60 ? "gain" : reputation.value >= 40 ? "info" : reputation.value >= 25 ? "warn" : "loss",
      info: t("reputationInfo"),
    });
  }
  if (strengths) {
    items.push({
      key: "strengths",
      label: t("strengths"),
      value: `${Math.floor(strengths.overall)} / 100`,
      tone: strengths.overall >= 75 ? "gain" : strengths.overall >= 50 ? "info" : "warn",
      info: t("strengthsInfo"),
    });
  }
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-1 px-5 py-2.5 lg:px-7"
      data-testid="company-status"
      data-status={status}
    >
      <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", TEXT[STATUS_TONE[status]])}>
        <span aria-hidden className={cn("size-2 rounded-pill", DOT[STATUS_TONE[status]])} />
        {t(`status.${status}`)}
      </span>
      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {items.map((x) => (
          <div key={x.key} className="flex items-center gap-1.5 text-sm" data-testid={`status-${x.key}`}>
            <dt className="text-fg-3">{x.label}</dt>
            <dd className={cn("nums font-semibold", TEXT[x.tone])}>{x.value}</dd>
            <InfoTip text={x.info} label={x.label} className="size-4" />
          </div>
        ))}
      </dl>
    </div>
  );
}
