"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { SECTOR_ICONS, UI_ICONS, type SectorKey } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { burstConfetti } from "@/components/ui/effects";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { LockBadge } from "@/components/ui/lock-badge";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useMyJob } from "@/features/career/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { engine, usePlayerLevel } from "@/features/game/store";
import type { CompanyTier, GameErrorKey } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { COMPANY_COLORS, useCompanyRefresh } from "../hooks";

const SECTORS = Object.keys(SECTOR_ICONS) as SectorKey[];
const small = BALANCE.company.tiers.find((t) => t.id === "small_business")!;

export const TIER_INFO: Record<CompanyTier, { level: number; cost: number; fixed: number; staff: number }> = {
  garage: {
    level: BALANCE.startups.garage.minLevel,
    cost: BALANCE.startups.garage.foundingCostCents,
    fixed: BALANCE.startups.garage.fixedCostCentsPerQuarter,
    staff: BALANCE.startups.garage.maxEmployees,
  },
  small_business: {
    level: small.minLevel,
    cost: small.foundingCostCents,
    fixed: small.fixedCostCentsPerQuarter,
    staff: small.maxEmployees,
  },
};

/** Before the first company: the two forms, how it works, and the founding sheet (ADR-057). */
export function Founding() {
  const t = useTranslations("firm");
  const level = usePlayerLevel();
  const [tier, setTier] = useState<CompanyTier | null>(null);

  return (
    <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
      <div className="space-y-5">
        <p className="text-pretty text-fg-2">{t("intro")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["garage", "small_business"] as const).map((key) => {
            const info = TIER_INFO[key];
            const locked = level < info.level;
            return (
              <Card key={key} padding="lg" className="flex flex-col gap-3" data-tier={key}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-pixel text-sm text-fg-1 uppercase">
                    {key === "garage" ? t("garageTitle") : t("smallTitle")}
                  </h2>
                  {locked && <LockBadge level={info.level} />}
                </div>
                <p className="text-sm text-pretty text-fg-2">{key === "garage" ? t("garageText") : t("smallText")}</p>
                <ul className="space-y-1 text-sm text-fg-3">
                  <li className="nums">{t("cost", { amount: formatMoney(info.cost, { whole: true }) })}</li>
                  <li className="nums">{t("fixed", { amount: formatMoney(info.fixed, { whole: true }) })}</li>
                  <li>{t("staff", { count: info.staff })}</li>
                </ul>
                <Button className="mt-auto" block disabled={locked} onClick={() => setTier(key)}>
                  {t("found")}
                </Button>
              </Card>
            );
          })}
        </div>
      </div>
      <Card padding="lg">
        <p className="label-pixel text-fg-2">{t("howTitle")}</p>
        <ol className="mt-3 space-y-3 text-sm text-pretty text-fg-2">
          {(["how1", "how2", "how3", "how4"] as const).map((key, i) => (
            <li key={key} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-xs bg-surface-3 font-pixel text-2xs text-fg-1">
                {i + 1}
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ol>
      </Card>
      <FoundingSheet tier={tier} onClose={() => setTier(null)} />
    </div>
  );
}

function FoundingSheet({ tier, onClose }: { tier: CompanyTier | null; onClose: () => void }) {
  const t = useTranslations("firm");
  const ts = useTranslations("sectors");
  const te = useTranslations("errors");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const job = useMyJob();
  const anchor = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<CompanyTier>("garage");
  const [name, setName] = useState("");
  const [idea, setIdea] = useState("");
  const [sector, setSector] = useState<SectorKey>("tech");
  const [color, setColor] = useState<string>(COMPANY_COLORS[0]);
  const [check, setCheck] = useState<{ name: string; reason: GameErrorKey | null } | null>(null);
  const [busy, setBusy] = useState(false);
  if (tier !== null && tier !== shown) setShown(tier);

  useEffect(() => {
    const value = name.trim();
    if (value.length < 3) return;
    const timer = window.setTimeout(() => {
      void engine
        .checkCompanyName(value)
        .then((r) => setCheck({ name: value, reason: r.allowed ? null : (r.reason ?? "name_profanity") }))
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [name]);

  const value = name.trim();
  const reason = check?.name === value ? check.reason : null;
  const hasJob = Boolean(job.data);
  const ready = !hasJob && check?.name === value && reason === null && idea.trim().length >= 5;
  const info = TIER_INFO[shown];

  const found = async () => {
    setBusy(true);
    try {
      await engine.foundCompany({
        requestId: crypto.randomUUID(),
        name: value,
        idea: idea.trim(),
        sector,
        color,
        tier: shown,
      });
      void playSound("levelUp");
      haptic("success");
      if (anchor.current) burstConfetti(anchor.current, 40);
      toast.success(t("founded"), t("foundedText", { name: value }), { silent: true });
      await refresh();
      onClose();
    } catch (error) {
      toast.error(t("foundTitle"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={tier !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("foundTitle")}
      description={shown === "garage" ? t("garageTitle") : t("smallTitle")}
      footer={
        <HoldButton tone="accent" onConfirm={() => void found()} disabled={!ready || busy} className="w-full">
          {t("foundConfirm")}
        </HoldButton>
      }
    >
      <div ref={anchor} className="space-y-5">
        {hasJob && <p className="rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">{t("hasJob")}</p>}
        <Field
          label={t("name")}
          value={name}
          maxLength={BALANCE.names.maxLength}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          error={reason ? te(reason as Parameters<typeof te>[0]) : undefined}
          hint={check?.name === value && reason === null ? t("nameFree") : t("nameHint")}
        />
        <Field
          label={t("idea")}
          value={idea}
          maxLength={120}
          placeholder={t("ideaPlaceholder")}
          onChange={(event) => setIdea(event.target.value)}
        />
        <fieldset>
          <legend className="mb-2 label-pixel text-fg-2">{t("sector")}</legend>
          <div role="radiogroup" aria-label={t("sector")} className="grid grid-cols-5 gap-2">
            {SECTORS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={sector === key}
                onClick={() => {
                  setSector(key);
                  void playSound("tap");
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border px-1 py-2 focus-ring transition-colors duration-fast",
                  sector === key ? "border-accent bg-accent-soft" : "border-line-1 hover:bg-surface-2",
                )}
              >
                <PixelIcon {...SECTOR_ICONS[key]} scale={2} />
                <span className="w-full truncate text-center text-2xs text-fg-2">{ts(key)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 label-pixel text-fg-2">{t("color")}</legend>
          <div role="radiogroup" aria-label={t("color")} className="flex flex-wrap gap-2">
            {COMPANY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={cn(
                  "size-9 rounded-sm focus-ring transition-transform duration-fast active:scale-95",
                  color === c && "ring-2 ring-fg-1 ring-offset-2 ring-offset-surface-1",
                )}
              />
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-3 rounded-md bg-surface-2 px-4 py-3">
          <span
            aria-hidden
            style={{ backgroundColor: color }}
            className="grid size-10 shrink-0 place-items-center font-pixel text-xs text-on-accent"
          >
            {(value || "?").slice(0, 2).toUpperCase()}
          </span>
          <p className="text-sm text-pretty text-fg-2">
            {t("summary", { amount: formatMoney(info.cost, { whole: true }) })}
          </p>
        </div>
        <Badge>
          <PixelIcon {...UI_ICONS.company} scale={1} /> {t("staff", { count: info.staff })}
        </Badge>
      </div>
    </Sheet>
  );
}
