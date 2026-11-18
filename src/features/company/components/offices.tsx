"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { COMPANY_BUILDINGS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { engine } from "@/features/game/store";
import type { CompanyOffices } from "@/features/game/types";
import { formatInteger, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCompanyOffices } from "../hooks";
import { useCompanyAction } from "./profit";

const SOURCES = ["tier", "expansion", "headquarters", "offices"] as const;

/**
 * Büroflächen (ADR-218): the seats of the company by source on one bar up to 1.000, the rent of the bought offices
 * and the next step with its price, legal form and company value. Lives inside "Wachstum & Ausbau".
 */
export function OfficesCard() {
  const t = useTranslations("firm.offices");
  const offices = useCompanyOffices();
  if (offices.isPending) return <Skeleton className="h-56 w-full rounded-lg" />;
  if (!offices.data) {
    return (
      <Card padding="md" className="flex items-center justify-between gap-3 text-sm" data-testid="offices-error">
        <p className="text-pretty text-fg-3">{t("loadError")}</p>
        <Button size="sm" variant="secondary" onClick={() => void offices.refetch()}>
          {t("retry")}
        </Button>
      </Card>
    );
  }
  return <OfficesView offices={offices.data} />;
}

export function OfficesView({ offices, onBuy }: { offices: CompanyOffices; onBuy?: () => Promise<boolean> }) {
  const t = useTranslations("firm.offices");
  const act = useCompanyAction();
  const [state, setState] = useState<ButtonState>("idle");
  const { seats, next } = offices;
  const locked = next !== null && offices.level === 0 && offices.block === "legal_form";

  const buy = async () => {
    setState("loading");
    const ok = onBuy
      ? await onBuy()
      : await act(() => engine.buyCompanyOffice(crypto.randomUUID()), t("done"), t("title"));
    setState(ok ? "success" : "idle");
    if (ok) window.setTimeout(() => setState("idle"), 800);
  };

  return (
    <Card padding="lg" className="space-y-4" data-testid="offices">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <Badge tone={offices.level > 0 ? "accent" : "neutral"}>
          {t("level", { level: offices.level, steps: offices.steps })}
        </Badge>
      </div>
      <p className="text-sm text-pretty text-fg-2">{t("intro", { max: formatInteger(seats.max) })}</p>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="nums text-sm font-semibold text-fg-1" data-testid="offices-seats">
            {t("seats", { total: formatInteger(seats.total), max: formatInteger(seats.max) })}
          </span>
          <span className="nums text-xs text-fg-3">{t("used", { used: formatInteger(seats.used) })}</span>
        </div>
        <Progress value={seats.total / Math.max(1, seats.max)} label={t("seatsLabel")} size="sm" />
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SOURCES.map((k) => (
            <div key={k} className="rounded-md bg-surface-2 px-2 py-2 text-center">
              <dt className="text-2xs text-fg-3">{t(`sources.${k}`)}</dt>
              <dd className={cn("nums text-sm font-semibold", seats[k] > 0 ? "text-fg-1" : "text-fg-3")}>
                {formatInteger(seats[k])}
              </dd>
            </div>
          ))}
        </dl>
        {offices.rentCentsPerHour > 0 && (
          <p className="nums text-xs text-fg-3">
            {t("rent", { amount: formatMoney(offices.rentCentsPerHour, { whole: true }) })}
          </p>
        )}
      </div>

      {locked ? (
        <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2" data-testid="offices-locked">
          <PixelIcon {...COMPANY_BUILDINGS.gmbh} scale={2} className="opacity-50 grayscale" />
          <p className="min-w-0 flex-1 text-xs text-pretty text-fg-3">{t("locked")}</p>
        </div>
      ) : next ? (
        <div className="space-y-2">
          <p className="text-sm text-fg-1">{t("next", { seats: next.seats })}</p>
          <div data-testid="buy-office">
            <HoldButton
              tone="accent"
              onConfirm={() => void buy()}
              disabled={offices.block !== null || state === "loading"}
              className="w-full"
            >
              {t("button", { n: next.n, amount: formatMoney(next.costCents, { whole: true }) })}
            </HoldButton>
          </div>
          <BlockHint offices={offices} />
        </div>
      ) : (
        <p className="text-xs text-pretty text-fg-3">{t("maxLevel")}</p>
      )}
    </Card>
  );
}

function BlockHint({ offices }: { offices: CompanyOffices }) {
  const t = useTranslations("firm.offices");
  const next = offices.next;
  if (!next || offices.block === null) return null;
  const text =
    offices.block === "cash"
      ? t("needCash", { amount: formatMoney(next.costCents - offices.freeCashCents, { whole: true }) })
      : offices.block === "worth"
        ? t("needWorth", {
            amount: formatMoney(next.minWorthCents, { whole: true }),
            now: formatMoney(offices.worthCents, { whole: true }),
          })
        : offices.block === "legal_form"
          ? t("needForm", {
              forms: next.tiers.map((f) => (f === "gmbh" || f === "ag" ? t(`forms.${f}`) : f)).join(" / "),
            })
          : offices.block === "seats_max"
            ? t("seatsMax", { max: formatInteger(offices.seats.max) })
            : t("maxLevel");
  return (
    <p className="text-xs text-pretty text-fg-3" data-testid="offices-block" data-block={offices.block}>
      {text}
    </p>
  );
}
