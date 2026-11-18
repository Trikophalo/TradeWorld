"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { flagArt } from "@/components/pixel/hq";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { WORLD_RULES, type CountryConfig } from "@/config/countries";
import type { WorldPlace } from "@/features/game/world-types";
import { formatBps, formatMoney, formatPercentBps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { placeArt } from "./world-map";

type Tone = "gain" | "loss" | "neutral";
const toneClass: Record<Tone, string> = { gain: "text-gain", loss: "text-loss", neutral: "text-fg-2" };

/** A trait in basis points against 10 000; `lowerIsBetter` for costs. */
function traitTone(bps: number, lowerIsBetter: boolean): Tone {
  if (Math.abs(bps - 10_000) < 200) return "neutral";
  return bps < 10_000 === lowerIsBetter ? "gain" : "loss";
}

/** The traits of a country as rows: costs, demand, image, tax and risks. */
export function CountryTraits({ country }: { country: CountryConfig }) {
  const t = useTranslations("world.traits");
  const td = useTranslations("world.disasters");
  const risk = (v: number) => (v < 25 ? t("riskLow") : v < 50 ? t("riskMid") : t("riskHigh"));
  const riskTone = (v: number): Tone => (v < 25 ? "gain" : v < 50 ? "neutral" : "loss");
  const tax = country.taxRateBps;
  const base = WORLD_RULES.balance.taxBaselineBps;
  const rows: { key: string; label: string; value: string; tone: Tone }[] = [
    {
      key: "production",
      label: t("production"),
      value: formatBps(country.productionCostBps - 10_000),
      tone: traitTone(country.productionCostBps, true),
    },
    {
      key: "labour",
      label: t("labour"),
      value: formatBps(country.labourCostBps - 10_000),
      tone: traitTone(country.labourCostBps, true),
    },
    {
      key: "demand",
      label: t("demand"),
      value: formatBps(country.demandPotentialBps - 10_000),
      tone: traitTone(country.demandPotentialBps, false),
    },
    {
      key: "image",
      label: t("image"),
      value: formatBps(country.imageBps - 10_000),
      tone: traitTone(country.imageBps, false),
    },
    {
      key: "tax",
      label: t("tax"),
      value: formatPercentBps(tax),
      tone: Math.abs(tax - base) < 300 ? "neutral" : tax < base ? "gain" : "loss",
    },
    {
      key: "political",
      label: t("political"),
      value: risk(country.politicalRisk),
      tone: riskTone(country.politicalRisk),
    },
    { key: "tariff", label: t("tariff"), value: risk(country.tariffExposure), tone: riskTone(country.tariffExposure) },
    { key: "war", label: t("war"), value: risk(country.warRisk), tone: riskTone(country.warRisk) },
    {
      key: "disaster",
      label: t("disaster"),
      value: country.disasterRisk.length ? country.disasterRisk.map((d) => td(d)).join(", ") : t("none"),
      tone: country.disasterRisk.length === 0 ? "gain" : country.disasterRisk.length > 1 ? "loss" : "neutral",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-1.5 text-xs" data-testid={`country-traits-${country.key}`}>
      {rows.map((r) => (
        <div
          key={r.key}
          className="flex min-w-0 items-center justify-between gap-2 rounded-sm bg-surface-2 px-2.5 py-1.5"
        >
          <dt className="truncate text-fg-3">{r.label}</dt>
          <dd className={cn("text-right nums font-semibold", toneClass[r.tone])}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CountryTitle({ country }: { country: CountryConfig }) {
  return (
    <span className="flex items-center gap-2">
      <PixelIcon {...flagArt(country.flag, country.flagVertical)} scale={3} className="ring-1 ring-line-2" />
      <span className="truncate">{country.name}</span>
    </span>
  );
}

/**
 * Detail sheet of a country (ADR-208): traits, the market leader and its fee, every company there (link to the
 * profile), and what the own company can do there (passed in as `actions`).
 */
export function CountrySheet({
  country,
  places,
  leaderName,
  feeBps,
  status,
  actions,
  onClose,
}: {
  country: CountryConfig | null;
  places: readonly WorldPlace[];
  leaderName: string | null;
  feeBps: number;
  status?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  const t = useTranslations("world.country");
  const tl = useTranslations("world.lobby");
  const tt = useTranslations("world.tiers");
  const tr = useTranslations("world.traits");
  const tierName = (p: WorldPlace) =>
    p.kind === "subsidiary"
      ? tt("subsidiary")
      : p.kind === "ai"
        ? t("ai")
        : tt(WORLD_RULES.hqTiers[p.hqTier - 1]?.key ?? "office");
  return (
    <Sheet open={country !== null} onOpenChange={(open) => !open && onClose()} title={country?.name ?? ""}>
      {country && (
        <div className="space-y-4" data-testid="country-sheet" data-country={country.key}>
          <div className="flex items-center justify-between gap-3">
            <CountryTitle country={country} />
            {status}
          </div>
          <section className="space-y-2">
            <p className="label-pixel text-fg-2">{tr("title")}</p>
            <CountryTraits country={country} />
          </section>
          <p className="rounded-sm bg-surface-2 px-3 py-2 text-xs text-fg-2" data-testid="country-leader">
            {leaderName ? tl("leaderIs", { name: leaderName }) : tl("noLeader")}
            {leaderName && feeBps > 0 ? ` · ${tl("fee")} ${formatPercentBps(feeBps)}` : ""}
          </p>
          {actions}
          <section className="space-y-2">
            <p className="label-pixel text-fg-2">{t("companies")}</p>
            {places.length === 0 ? (
              <p className="text-sm text-fg-3">{t("noCompanies")}</p>
            ) : (
              <ul className="space-y-1.5">
                {places.map((p) => (
                  <li key={`${p.companyId}:${p.kind}`}>
                    <Link
                      href={`/companies/${encodeURIComponent(p.companyId)}`}
                      className="flex items-center gap-3 rounded-md bg-surface-1 px-2.5 py-2 ring-1 ring-line-1 focus-ring transition duration-fast hover:bg-surface-2 active:scale-[0.99]"
                      data-testid="country-company"
                    >
                      <PixelIcon {...placeArt(p)} scale={1} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-fg-1">{p.name}</span>
                        <span className="block truncate text-2xs text-fg-3">
                          {tierName(p)}
                          {p.owner ? ` · ${t("by", { owner: p.owner })}` : ""}
                        </span>
                      </span>
                      {p.mine && <Badge tone="accent">{t("mine")}</Badge>}
                      {p.leader && <Badge tone="gain">{tl("leader")}</Badge>}
                      {p.worthCents !== null && (
                        <span className="nums text-2xs text-fg-3">{formatMoney(p.worthCents, { compact: true })}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
