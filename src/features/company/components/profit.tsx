"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { COMPANY_BUILDINGS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { ShortMoney } from "@/components/ui/live-money";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { MyCompany, PriceLevel } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { coachAdvice, hourBreakdown, type CoachAction } from "../coach";
import { useCompanyRefresh } from "../hooks";

const cfg = BALANCE.startups;
const PRICE_LEVELS: readonly PriceLevel[] = ["budget", "normal", "premium"];

function useCompanyAction() {
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  return async (action: () => Promise<unknown>, done: string, failTitle: string) => {
    try {
      await action();
      haptic("success");
      void playSound("success");
      toast.success(done, undefined, { silent: true });
      await refresh();
      return true;
    } catch (error) {
      toast.error(failTitle, errorText(error));
      return false;
    }
  };
}

/**
 * The profit coach (ADR-083): where the money of the last hour came from and went to, and what to do next.
 * `onNavigate` takes actions the card cannot do itself (team tab, marketing slider).
 */
export function ProfitCoach({
  company,
  onNavigate,
}: {
  company: MyCompany;
  onNavigate: (to: "team" | "controls") => void;
}) {
  const t = useTranslations("firm.coach");
  const tf = useTranslations("firm");
  const act = useCompanyAction();
  const [busy, setBusy] = useState<CoachAction | null>(null);
  const advice = coachAdvice(company);
  const live = company.live;

  const run = async (action: CoachAction) => {
    if (action === "dismissAi" || action === "hire") return onNavigate("team");
    if (action === "marketing" || action === "upgrade") return onNavigate("controls");
    setBusy(action);
    if (action === "expand") {
      await act(() => engine.expandCompany(crypto.randomUUID()), t("expanded"), t("expandTitle"));
    } else {
      const price: PriceLevel = action === "contractOn" ? company.priceLevel : action;
      await act(
        () =>
          engine.setCompanyStrategy(crypto.randomUUID(), price, action === "contractOn" ? true : company.contractWork),
        t("strategySaved"),
        t("strategyTitle"),
      );
    }
    setBusy(null);
  };

  return (
    <Card padding="lg" className="space-y-4" data-testid="profit-coach">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        {live && (
          <span className={cn("nums text-sm font-semibold", live.profitPerHourCents >= 0 ? "text-gain" : "text-loss")}>
            {t("perHour", { amount: formatMoney(live.profitPerHourCents, { whole: true, sign: true }) })}
          </span>
        )}
      </div>
      {live && <HourFlow live={live} />}
      <ul className="space-y-2">
        {advice.map((a, i) => (
          <motion.li
            key={a.tip}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={cn(
              "flex flex-wrap items-start gap-3 rounded-md border px-3 py-2.5",
              a.tone === "warn" && "border-warn/40 bg-warn-soft",
              a.tone === "tip" && "border-line-1 bg-surface-2",
              a.tone === "good" && "border-gain/40 bg-gain-soft",
            )}
            data-tip={a.tip}
          >
            <div className="min-w-56 flex-1">
              <p className="text-sm font-medium text-fg-1">{t(`tips.${a.tip}.title`)}</p>
              <p className="text-xs text-pretty text-fg-2">{t(`tips.${a.tip}.text`)}</p>
            </div>
            {a.action && (
              <Button
                size="sm"
                variant={a.tone === "warn" ? "primary" : "secondary"}
                state={busy === a.action ? "loading" : "idle"}
                onClick={() => void run(a.action!)}
              >
                {t(`actions.${a.action}`)}
              </Button>
            )}
          </motion.li>
        ))}
      </ul>
      <p className="text-xs text-pretty text-fg-3">{tf("coach.footer")}</p>
    </Card>
  );
}

/** One hour as two bars: money in (own sales, contract work) and money out (goods and wages, AI, fixed, ads). */
function HourFlow({ live }: { live: NonNullable<MyCompany["live"]> }) {
  const t = useTranslations("firm.coach");
  const h = hourBreakdown(live);
  const income: FlowPart[] = [
    { key: "own", cents: h.ownRevenueCents, className: "bg-gain" },
    { key: "contract", cents: h.contractRevenueCents, className: "bg-accent" },
  ];
  const costs: FlowPart[] = [
    { key: "goods", cents: h.goodsAndWagesCents, className: "bg-fg-3" },
    { key: "ai", cents: h.aiWagesCents, className: "bg-warn" },
    { key: "fixed", cents: h.fixedCents, className: "bg-loss" },
    { key: "marketing", cents: h.marketingCents, className: "bg-accent-strong" },
  ];
  const total = Math.max(
    1,
    income.reduce((s, x) => s + x.cents, 0),
    costs.reduce((s, x) => s + x.cents, 0),
  );
  return (
    <div className="space-y-3 rounded-md bg-surface-2 p-3" data-testid="hour-flow">
      <FlowRow label={t("flowIn")} parts={income} total={total} />
      <FlowRow label={t("flowOut")} parts={costs} total={total} />
    </div>
  );
}

type FlowPart = { key: "own" | "contract" | "goods" | "ai" | "fixed" | "marketing"; cents: number; className: string };

function FlowRow({ label, parts, total }: { label: string; parts: FlowPart[]; total: number }) {
  const t = useTranslations("firm.coach");
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-fg-3">{label}</p>
      <div className="flex h-3 overflow-hidden rounded-xs bg-surface-3">
        {parts.map((p) => (
          <motion.span
            key={p.key}
            className={cn("h-full origin-left", p.className)}
            style={{ width: `${(p.cents / total) * 100}%` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            title={`${t(`flow.${p.key}`)}: ${formatMoney(p.cents)}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-2">
        {parts
          .filter((p) => p.cents > 0)
          .map((p) => (
            <li key={p.key} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-xs", p.className)} />
              {t(`flow.${p.key}`)} <ShortMoney cents={p.cents} className="nums text-fg-1" />
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Price strategy and contract work (ADR-083). */
export function StrategyCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm.strategy");
  const act = useCompanyAction();
  const [saving, setSaving] = useState(false);

  const save = async (priceLevel: PriceLevel, contractWork: boolean) => {
    setSaving(true);
    await act(() => engine.setCompanyStrategy(crypto.randomUUID(), priceLevel, contractWork), t("saved"), t("title"));
    setSaving(false);
  };
  const p = cfg.pricing[company.priceLevel];
  const lowQuality = company.priceLevel === "premium" && company.qualityBps / 10_000 < cfg.pricing.premiumMinQuality;

  return (
    <Card padding="lg" className="space-y-4" data-testid="strategy">
      <p className="label-pixel text-fg-2">{t("title")}</p>
      <div className="space-y-2">
        <p className="text-sm text-fg-2">{t("price")}</p>
        <Segmented
          value={company.priceLevel}
          onValueChange={(v) => !saving && void save(v, company.contractWork)}
          options={PRICE_LEVELS.map((level) => ({ value: level, label: t(`levels.${level}`) }))}
          label={t("price")}
          block
        />
        <p className="text-xs text-pretty text-fg-3">{t(`hints.${company.priceLevel}`)}</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          {(["price", "demand", "awareness"] as const).map((k) => (
            <div key={k} className="rounded-md bg-surface-2 px-2 py-1.5">
              <p className="text-2xs text-fg-3">{t(`effects.${k}`)}</p>
              <p
                className={cn(
                  "nums text-sm font-semibold",
                  p[k] > 1 ? "text-gain" : p[k] < 1 ? "text-loss" : "text-fg-1",
                )}
              >
                × {p[k].toLocaleString("de-DE")}
              </p>
            </div>
          ))}
        </div>
        {lowQuality && <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">{t("lowQuality")}</p>}
      </div>
      <label className="flex items-start gap-3 rounded-md border border-line-1 px-3 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-fg-1">{t("contract")}</span>
          <span className="block text-xs text-pretty text-fg-3">
            {t("contractHint", {
              share: Math.round(cfg.contractWork.shareOfFreeCapacity * 100),
              margin: Math.round(cfg.contractWork.grossMargin * 100),
            })}
          </span>
          {company.live && company.live.contractRevenuePerHourCents > 0 && (
            <span className="mt-1 block nums text-xs text-gain">
              {t("contractNow", { amount: formatMoney(company.live.contractRevenuePerHourCents, { whole: true }) })}
            </span>
          )}
        </span>
        <Switch
          checked={company.contractWork}
          onCheckedChange={(on) => void save(company.priceLevel, on)}
          label={t("contract")}
          disabled={saving}
        />
      </label>
    </Card>
  );
}

/** Endless growth (ADR-083): the expansion ladder from the GmbH on. */
export function ExpansionCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm.expansion");
  const act = useCompanyAction();
  const [state, setState] = useState<ButtonState>("idle");
  const e = cfg.expansion;

  if (!company.canExpand || company.expansionCostCents === null) {
    return (
      <Card padding="md" className="flex items-center gap-3 text-sm" data-testid="expansion-locked">
        <PixelIcon {...COMPANY_BUILDINGS.ag} scale={2} className="opacity-50 grayscale" />
        <p className="min-w-0 flex-1 text-pretty text-fg-3">{t("locked")}</p>
      </Card>
    );
  }
  const cost = company.expansionCostCents;
  const affordable = company.cashCents >= cost;

  const expand = async () => {
    setState("loading");
    const ok = await act(() => engine.expandCompany(crypto.randomUUID()), t("done"), t("title"));
    setState(ok ? "success" : "idle");
    if (ok) window.setTimeout(() => setState("idle"), 800);
  };

  return (
    <Card padding="lg" className="space-y-4" data-testid="expansion">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <Badge tone="accent">{t("level", { level: company.expansionLevel })}</Badge>
      </div>
      <p className="text-sm text-pretty text-fg-2">{t("intro")}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            { k: "market", v: `+${Math.round(e.marketBonusPerLevel * 100)} %` },
            { k: "capacity", v: `+${Math.round(e.capacityBonusPerLevel * 100)} %` },
            { k: "places", v: `+${e.employeesPerLevel}` },
            { k: "fixed", v: `+${Math.round(e.fixedCostPerLevel * 100)} %` },
          ] as const
        ).map((x) => (
          <div key={x.k} className="rounded-md bg-surface-2 px-2 py-2 text-center">
            <p className="text-2xs text-fg-3">{t(`effects.${x.k}`)}</p>
            <p className={cn("nums text-sm font-semibold", x.k === "fixed" ? "text-loss" : "text-gain")}>{x.v}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-3">
        {t("market", { factor: company.marketFactor.toLocaleString("de-DE", { maximumFractionDigits: 1 }) })}
      </p>
      <div data-testid="expand">
        <HoldButton
          tone="accent"
          onConfirm={() => void expand()}
          disabled={!affordable || state === "loading"}
          className="w-full"
        >
          {t("button", { level: company.expansionLevel + 1, amount: formatMoney(cost, { whole: true }) })}
        </HoldButton>
      </div>
      {!affordable && (
        <p className="text-xs text-fg-3">
          {t("needCash", { amount: formatMoney(cost - company.cashCents, { whole: true }) })}
        </p>
      )}
    </Card>
  );
}
