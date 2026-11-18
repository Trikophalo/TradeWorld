"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { CompanyRisks } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

export const COMPANY_RISKS_KEY = ["company", "risks"] as const;

const pct = (bps: number) => (bps / 100).toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** One figure of the card: label, value, short note. */
function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "loss" | "gain" }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-2 p-3">
      <dt className="text-2xs text-fg-3">{label}</dt>
      <dd className={cn("mt-0.5 nums text-base font-semibold", tone === "loss" ? "text-loss" : "text-fg-1")}>
        {value}
      </dd>
      {note && <p className="mt-0.5 text-2xs text-pretty text-fg-3">{note}</p>}
    </div>
  );
}

/**
 * Risiken (ADR-209): what the size and the world outside do to the company. Value and friction, the daily chance of an
 * event, the most likely external events, the insurance (a choice) and the lobby level. Numbers from get_company_risks.
 */
export function RisksCard({ preview }: { preview?: CompanyRisks } = {}) {
  const t = useTranslations("risks");
  const live = useQuery({
    queryKey: COMPANY_RISKS_KEY,
    queryFn: () => engine.companyRisks(),
    refetchInterval: 60_000,
    enabled: !preview,
  });
  const data = preview ?? live.data;

  return (
    <Card padding="lg" className="space-y-4" id="company-risks" data-testid="company-risks">
      <div>
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("intro")}</p>
      </div>
      {!data ? (
        live.isError ? (
          <EmptyState art={<PixelIcon {...UI_ICONS.lock} scale={4} />} title={t("title")} description={t("empty")} />
        ) : (
          <div className="space-y-3" aria-busy>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-24 w-full rounded-md" />
            <Skeleton className="h-32 w-full rounded-md" />
          </div>
        )
      ) : (
        <RisksBody risks={data} preview={!!preview} />
      )}
    </Card>
  );
}

function RisksBody({ risks, preview }: { risks: CompanyRisks; preview: boolean }) {
  const t = useTranslations("risks");
  const te = useTranslations("companyEvents.archetypes");
  const name = (key: string) => te(`${key}.name` as Parameters<typeof te>[0]);
  const small = risks.decades <= 0 && risks.overheadBps <= 0;
  const top = risks.exposure.slice(0, 6);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Figure label={t("worth")} value={formatMoney(risks.worthCents, { whole: true })} />
        <Figure
          label={t("chance")}
          value={`${pct(risks.chancePerDayBps)} %`}
          note={t("crisisShare", { pct: pct(risks.crisisShareBps) })}
        />
        <Figure
          label={t("saturation")}
          value={risks.saturationBps >= 10_000 ? "–" : `−${pct(10_000 - risks.saturationBps)} %`}
          note={t("saturationNote")}
          tone={risks.saturationBps < 10_000 ? "loss" : undefined}
        />
        <Figure
          label={t("overhead")}
          value={risks.overheadBps > 0 ? `${pct(risks.overheadBps)} %` : "–"}
          note={t("overheadNote")}
          tone={risks.overheadBps > 0 ? "loss" : undefined}
        />
      </dl>
      <p className="text-xs text-pretty text-fg-3" data-testid="risks-size">
        {small
          ? t("smallHint", { from: formatMoney(risks.frictionPivotCents, { whole: true }) })
          : t("bigHint", { unit: formatMoney(risks.unitCents, { whole: true }) })}
      </p>

      <InsurancePanel risks={risks} preview={preview} />

      <section className="space-y-2 rounded-md border border-line-1 p-3" data-testid="risks-lobby">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-fg-1">{t("lobbyTitle")}</p>
          {risks.lobby.leader && <Badge tone="gain">{t("leader")}</Badge>}
          <span className="ml-auto nums text-2xs text-fg-3">
            {t("lobbyLevel", { level: risks.lobby.level, max: risks.lobby.max })}
          </span>
        </div>
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: risks.lobby.max }, (_, i) => (
            <span
              key={i}
              className={cn("h-2 flex-1 rounded-xs", i < risks.lobby.level ? "bg-accent" : "bg-surface-3")}
            />
          ))}
        </div>
        <p className="text-xs text-pretty text-fg-3">
          {risks.lobby.level > 0
            ? t("lobbyEffect", { bonus: pct(risks.lobby.bonusBps), cut: pct(risks.lobby.politicalCutBps) })
            : t("lobbyNone")}
        </p>
      </section>

      <section className="space-y-2" data-testid="risks-exposure">
        <p className="text-sm font-semibold text-fg-1">{t("exposureTitle")}</p>
        {top.length === 0 ? (
          <p className="text-xs text-pretty text-fg-3">
            {t("exposureNone", { from: formatMoney(risks.eventPivotCents, { whole: true }) })}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {top.map((e) => (
              <li key={e.archetype} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-fg-2">{name(e.archetype)}</span>
                {e.insurable && <Badge tone="info">{t("insurable")}</Badge>}
                <span className="w-20 shrink-0 text-right nums text-fg-1">{t("perDay", { pct: pct(e.bps) })}</span>
              </li>
            ))}
          </ul>
        )}
        {risks.upcoming.length > 0 && (
          <p className="text-2xs text-pretty text-fg-3">
            {t("upcoming", {
              list: risks.upcoming
                .slice(0, 3)
                .map((u) => `${name(u.archetype)} (${formatMoney(u.fromCents, { whole: true })})`)
                .join(", "),
            })}
          </p>
        )}
        <p className="text-2xs text-pretty text-fg-3">
          {risks.country ? t("country", { name: risks.country.name ?? risks.country.key }) : t("noCountry")}
        </p>
      </section>
    </div>
  );
}

function InsurancePanel({ risks, preview }: { risks: CompanyRisks; preview: boolean }) {
  const t = useTranslations("risks");
  const client = useQueryClient();
  const errorText = useGameErrorText();
  const [choice, setChoice] = useState(String(risks.insurance.level));
  const [state, setState] = useState<ButtonState>("idle");
  const chosen = risks.insurance.levels.find((l) => String(l.level) === choice) ?? risks.insurance.levels[0]!;
  const unchanged = chosen.level === risks.insurance.level;

  const save = async () => {
    setState("loading");
    try {
      const next = await engine.setCompanyInsurance(crypto.randomUUID(), chosen.level);
      client.setQueryData(COMPANY_RISKS_KEY, next);
      haptic("success");
      void playSound("success");
      toast.success(t("saved"), t(`levels.${chosen.key}` as Parameters<typeof t>[0]), { silent: true });
      setState("success");
    } catch (error) {
      toast.error(t("insuranceTitle"), errorText(error));
      setState("idle");
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-line-1 p-3" data-testid="risks-insurance">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-fg-1">{t("insuranceTitle")}</p>
        <Badge tone={risks.insurance.coverageBps > 0 ? "gain" : "neutral"} className="ml-auto">
          {t("coverageNow", { pct: pct(risks.insurance.coverageBps) })}
        </Badge>
      </div>
      <p className="text-xs text-pretty text-fg-3">{t("insuranceText")}</p>
      <Segmented
        value={choice}
        onValueChange={(v) => {
          setChoice(v);
          setState("idle");
        }}
        label={t("insuranceTitle")}
        block
        options={risks.insurance.levels.map((l) => ({
          value: String(l.level),
          label: t(`levels.${l.key}` as Parameters<typeof t>[0]),
        }))}
      />
      <dl className="grid grid-cols-2 gap-2">
        <Figure label={t("coverage")} value={`${pct(chosen.coverageBps)} %`} />
        <Figure
          label={t("premium")}
          value={formatMoney(chosen.premiumCentsPerHour, { whole: true })}
          note={t("premiumNote", { pct: pct(chosen.premiumBps) })}
        />
      </dl>
      {risks.insurance.fullFrom && (
        <p className="text-2xs text-fg-3">
          {t("waiting")} <Countdown target={Date.parse(risks.insurance.fullFrom)} />
        </p>
      )}
      <Button
        size="sm"
        className="w-full sm:w-auto"
        state={state}
        disabled={unchanged || preview}
        onClick={save}
        data-testid="risks-insurance-save"
      >
        {unchanged ? t("current") : t("apply")}
      </Button>
    </section>
  );
}
