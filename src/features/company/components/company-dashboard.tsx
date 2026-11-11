"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SECTOR_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { Field } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { demoCloseQuarter } from "@/features/game/demo-engine";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { CompanyQuarter, MyCompany } from "@/features/game/types";
import { parseEuroCents } from "@/features/market/order-schema";
import { formatBps, formatMoney } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import { isDemoMode } from "@/lib/supabase/env";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";
import { Applications, Postings, Team } from "./employer";

type Tab = "overview" | "postings" | "applications" | "team";
const factor = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const money = (cents: number) => formatMoney(cents, { whole: true });
/** Profit after the player wages, which are paid continuously during the quarter. */
const netProfit = (q: CompanyQuarter) => q.operatingProfitCents - q.wagesCents;

/** The founder's view of the own company (ADR-057). */
export function CompanyDashboard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const ts = useTranslations("sectors");
  const refresh = useCompanyRefresh();
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-5">
      <Card padding="lg" className="space-y-4" data-testid="company-header">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            style={{ backgroundColor: company.color }}
            className="grid size-14 shrink-0 place-items-center font-pixel text-base text-on-accent"
          >
            {company.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-fg-1">{company.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-3">
              <Badge tone="accent">{t(`tiers.${company.tier}`)}</Badge>
              <span className="inline-flex items-center gap-1.5">
                <PixelIcon {...SECTOR_ICONS[company.sector]} scale={1} /> {ts(company.sector)}
              </span>
            </div>
          </div>
        </div>
        <p className="text-sm text-pretty text-fg-2">{company.idea}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
          <span className="text-sm text-fg-2">
            {t("nextQuarter")}{" "}
            <Countdown target={Date.parse(company.nextQuarterAt)} className="nums font-semibold text-fg-1" />
          </span>
          {isDemoMode && (
            <button
              type="button"
              onClick={() => {
                demoCloseQuarter();
                void playSound("coin");
                void refresh();
              }}
              className="text-xs text-accent underline-offset-2 focus-ring hover:underline"
            >
              {t("demoClose")}
            </button>
          )}
        </div>
      </Card>

      {company.distress && (
        <p className="rounded-md bg-loss-soft px-4 py-3 text-sm text-loss">
          {t("distress", { amount: money(company.unpaidCents) })}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("cash")} value={money(company.cashCents)} />
        <Kpi label={t("value")} value={money(company.valueCents)} />
        <Kpi label={t("revenue")} value={company.lastQuarter ? money(company.lastQuarter.revenueCents) : "–"} />
        <Kpi
          label={t("profit")}
          value={company.lastQuarter ? money(netProfit(company.lastQuarter)) : "–"}
          tone={company.lastQuarter ? (netProfit(company.lastQuarter) >= 0 ? "gain" : "loss") : undefined}
        />
      </dl>

      <Segmented<Tab>
        value={tab}
        onValueChange={setTab}
        label={t("title")}
        options={[
          { value: "overview", label: t("tabOverview") },
          { value: "postings", label: t("tabPostings") },
          {
            value: "applications",
            label: t("tabApplications"),
            adornment:
              company.pendingApplications > 0 ? (
                <span className="rounded-pill bg-accent px-1.5 nums text-2xs text-on-accent">
                  {company.pendingApplications}
                </span>
              ) : undefined,
          },
          { value: "team", label: t("tabTeam") },
        ]}
      />

      {tab === "overview" && <Overview company={company} />}
      {tab === "postings" && <Postings company={company} />}
      {tab === "applications" && <Applications company={company} />}
      {tab === "team" && <Team company={company} />}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <Card padding="md">
      <dt className="label-pixel text-fg-3">{label}</dt>
      <dd
        className={cn(
          "mt-1 nums text-lg font-semibold",
          tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : "text-fg-1",
        )}
      >
        {value}
      </dd>
    </Card>
  );
}

function Overview({ company }: { company: MyCompany }) {
  return (
    <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
      <div className="space-y-5">
        <QuarterCard company={company} />
        <HistoryCard company={company} />
      </div>
      <div className="space-y-5">
        <MarketCard company={company} />
        <Controls company={company} />
      </div>
    </div>
  );
}

function QuarterCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const q = company.lastQuarter;
  if (!q) {
    return (
      <Card padding="lg">
        <p className="label-pixel text-fg-2">{t("lastQuarter")}</p>
        <p className="mt-2 text-sm text-fg-3">{t("noQuarter")}</p>
      </Card>
    );
  }
  const scale = Math.max(q.demandCents, q.capacityCents, 1);
  const costs: [string, number][] = [
    [t("cogs"), q.cogsCents],
    [t("fixedCosts"), q.fixedCents],
    [t("aiCosts"), q.aiWorkerCents],
    [t("marketing"), q.marketingCents],
    [t("wages"), q.wagesCents],
  ];
  return (
    <Card padding="lg" className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="label-pixel text-fg-2">
          {t("lastQuarter")} · {q.label}
        </p>
        <span className="nums text-sm text-fg-3">
          {t("utilization", { percent: formatBps(q.utilizationBps).replace("+", "") })}
        </span>
      </div>
      {(
        [
          [t("demand"), q.demandCents, "bg-info"],
          [t("capacity"), q.capacityCents, "bg-accent"],
          [t("revenue"), q.revenueCents, "bg-gain"],
        ] as const
      ).map(([label, value, color]) => (
        <div key={label}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-fg-2">{label}</span>
            <span className="nums text-fg-1">{money(value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-pill bg-surface-3">
            <motion.div
              className={cn("h-full origin-left rounded-pill", color)}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: value / scale }}
              transition={SPRING.smooth}
            />
          </div>
        </div>
      ))}
      <p className="text-sm text-pretty text-fg-3">{q.utilizationBps >= 9_900 ? t("soldOut") : t("idle")}</p>
      <dl className="divide-y divide-line-1 rounded-md border border-line-1 text-sm">
        {costs.map(([label, value]) => (
          <div key={label} className="flex justify-between px-3 py-2">
            <dt className="text-fg-3">{label}</dt>
            <dd className="nums text-fg-1">−{money(value)}</dd>
          </div>
        ))}
        <div className="flex justify-between px-3 py-2 font-semibold">
          <dt className="text-fg-1">{t("profit")}</dt>
          <dd className={cn("nums", netProfit(q) >= 0 ? "text-gain" : "text-loss")}>{money(netProfit(q))}</dd>
        </div>
      </dl>
    </Card>
  );
}

function HistoryCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const max = Math.max(1, ...company.history.map((h) => Math.max(h.revenueCents, Math.abs(h.profitCents))));
  return (
    <Card padding="lg">
      <p className="label-pixel text-fg-2">{t("historyTitle")}</p>
      {company.history.length === 0 ? (
        <p className="mt-2 text-sm text-fg-3">{t("historyEmpty")}</p>
      ) : (
        <div className="mt-4 flex h-36 items-end gap-1.5" role="img" aria-label={t("historyTitle")}>
          {company.history.map((h) => (
            <div
              key={h.label}
              className="flex h-full min-w-0 flex-1 flex-col justify-end gap-0.5"
              title={`${h.label}: ${money(h.revenueCents)} / ${money(h.profitCents)}`}
            >
              <motion.div
                className="w-full origin-bottom rounded-t-xs bg-accent/70"
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={SPRING.smooth}
                style={{ height: `${(h.revenueCents / max) * 100}%` }}
              />
              <div
                className={cn("w-full rounded-xs", h.profitCents >= 0 ? "bg-gain" : "bg-loss")}
                style={{ height: `${Math.max(2, (Math.abs(h.profitCents) / max) * 30)}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MarketCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  return (
    <Card padding="lg" className="space-y-4">
      <p className="label-pixel text-fg-2">{t("marketTitle")}</p>
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-fg-2">{t("awareness")}</span>
          <span className="nums text-fg-1">{formatBps(company.awarenessBps).replace("+", "")}</span>
        </div>
        <Progress value={company.awarenessBps / 10_000} label={t("awareness")} />
      </div>
      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-fg-2">{t("quality")}</span>
          <span className="nums text-fg-1">{formatBps(company.qualityBps).replace("+", "")}</span>
        </div>
        <Progress value={company.qualityBps / 10_000} label={t("quality")} tone="gain" />
      </div>
      <div className="rounded-md bg-surface-2 px-3 py-2.5">
        <p className="text-sm text-fg-2">{t("estimate")}</p>
        <p className="nums font-semibold text-fg-1">
          {t("estimateValue", {
            low: formatMoney(company.estimateLowCents, { whole: true }),
            high: formatMoney(company.estimateHighCents, { whole: true }),
          })}
        </p>
        <p className="text-xs text-fg-3">{t("estimateHint")}</p>
      </div>
    </Card>
  );
}

function Controls({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const maxMarketing = Math.max(100_000, Math.round(company.estimateHighCents / 4 / 5 / 1_000) * 1_000);
  const [marketing, setMarketing] = useState(company.marketingCentsPerQuarter);
  const [marketingState, setMarketingState] = useState<ButtonState>("idle");
  const [aiBusy, setAiBusy] = useState(false);
  const [money, setMoney] = useState<"deposit" | "withdraw" | null>(null);
  const [upgradeState, setUpgradeState] = useState<ButtonState>("idle");
  const staff = company.employees + company.aiWorkers;

  const run = async (action: () => Promise<unknown>, done: string) => {
    await action();
    toast.success(done, undefined, { silent: true });
    void playSound("success");
    await refresh();
  };

  const saveMarketing = async () => {
    setMarketingState("loading");
    try {
      await run(() => engine.setCompanyMarketing(crypto.randomUUID(), marketing), t("marketingSaved"));
      setMarketingState("success");
      window.setTimeout(() => setMarketingState("idle"), 800);
    } catch (error) {
      setMarketingState("idle");
      toast.error(t("marketing"), errorText(error));
    }
  };

  const setAi = async (count: number) => {
    setAiBusy(true);
    try {
      await run(() => engine.setAiWorkers(crypto.randomUUID(), count), t("aiWorkersSaved"));
    } catch (error) {
      toast.error(t("aiWorkers"), errorText(error));
    } finally {
      setAiBusy(false);
    }
  };

  const upgrade = async () => {
    setUpgradeState("loading");
    try {
      await run(() => engine.upgradeCompany(crypto.randomUUID()), t("upgraded"));
      setUpgradeState("success");
    } catch (error) {
      setUpgradeState("idle");
      toast.error(t("upgradeTitle"), errorText(error));
    }
  };

  return (
    <Card padding="lg" className="space-y-5">
      <p className="label-pixel text-fg-2">{t("controlsTitle")}</p>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-fg-2">{t("marketingBudget")}</span>
          <span className="nums font-semibold text-fg-1">{formatMoney(marketing, { whole: true })}</span>
        </div>
        <Slider
          value={marketing / maxMarketing}
          onValueChange={(v) => setMarketing(Math.round((v * maxMarketing) / 1_000) * 1_000)}
          label={t("marketingBudget")}
          marks={[0.25, 0.5, 0.75]}
        />
        <Button
          size="sm"
          variant="secondary"
          state={marketingState}
          disabled={marketing === company.marketingCentsPerQuarter}
          onClick={() => void saveMarketing()}
        >
          {t("marketingSave")}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-fg-2">{t("aiWorkers")}</p>
            <p className="text-xs text-fg-3">{t("staffCount", { used: staff, max: company.maxEmployees })}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="secondary"
              aria-label="−"
              disabled={aiBusy || company.aiWorkers === 0}
              onClick={() => void setAi(company.aiWorkers - 1)}
            >
              −
            </Button>
            <span className="w-6 text-center nums text-lg font-semibold text-fg-1" data-testid="ai-workers">
              {company.aiWorkers}
            </span>
            <Button
              size="icon"
              variant="secondary"
              aria-label="+"
              disabled={aiBusy || staff >= company.maxEmployees}
              onClick={() => void setAi(company.aiWorkers + 1)}
            >
              +
            </Button>
          </div>
        </div>
        <p className="text-xs text-pretty text-fg-3">
          {t("aiWorkersHint", { amount: formatMoney(company.aiWorkerCostCents, { whole: true }) })}
        </p>
        <p className="text-sm text-fg-2">
          {t("productivity")}:{" "}
          <span className="nums text-gain">
            {t("productivityValue", { value: factor.format(company.teamProductivityBps / 10_000) })}
          </span>{" "}
          <span className="text-xs text-fg-3">
            ({t("founderProductivity", { value: factor.format(company.founderProductivityBps / 10_000) })} ·{" "}
            {t("capacity")} {formatMoney(company.capacityCents, { whole: true })})
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-fg-2">{t("money")}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMoney("deposit")}>
            {t("deposit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMoney("withdraw")}>
            {t("withdraw")}
          </Button>
        </div>
      </div>

      {company.tier === "garage" && company.upgradeCostCents !== null && (
        <div className="rounded-md border border-line-1 px-3 py-3">
          <p className="text-sm font-medium text-fg-1">{t("upgradeTitle")}</p>
          <p className="mt-0.5 text-xs text-fg-3">
            {t("upgradeText", { amount: formatMoney(company.upgradeCostCents, { whole: true }) })}
          </p>
          <Button
            size="sm"
            className="mt-2"
            state={upgradeState}
            disabled={!company.canUpgrade}
            onClick={() => void upgrade()}
          >
            {company.canUpgrade ? t("upgrade") : t("upgradeLocked")}
          </Button>
        </div>
      )}
      <MoneySheet mode={money} company={company} onClose={() => setMoney(null)} />
    </Card>
  );
}

function MoneySheet({
  mode,
  company,
  onClose,
}: {
  mode: "deposit" | "withdraw" | null;
  company: MyCompany;
  onClose: () => void;
}) {
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [text, setText] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const [shown, setShown] = useState(mode);
  if (mode !== null && mode !== shown) {
    setShown(mode);
    setText("");
    setState("idle");
  }
  const cents = parseEuroCents(text);
  const submit = async () => {
    if (!cents || !shown) return;
    setState("loading");
    try {
      if (shown === "deposit") await engine.companyDeposit(crypto.randomUUID(), cents);
      else await engine.companyWithdraw(crypto.randomUUID(), cents);
      toast.success(shown === "deposit" ? t("depositDone") : t("withdrawDone"), formatMoney(cents), { silent: true });
      void playSound("coin");
      await refresh();
      onClose();
    } catch (error) {
      setState("idle");
      toast.error(t("money"), errorText(error));
    }
  };
  return (
    <Sheet
      open={mode !== null}
      onOpenChange={(open) => !open && onClose()}
      title={shown === "withdraw" ? t("withdraw") : t("deposit")}
      description={`${t("cash")}: ${formatMoney(company.cashCents)}`}
      footer={
        <Button block size="lg" state={state} disabled={!cents} onClick={() => void submit()}>
          {shown === "withdraw" ? t("withdraw") : t("deposit")}
        </Button>
      }
    >
      <Field label={t("amount")} inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} />
    </Sheet>
  );
}
