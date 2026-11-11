"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { COMPANY_BUILDINGS, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { ShortMoney } from "@/components/ui/live-money";
import { Sheet } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { parseEuroCents } from "@/features/market/order-schema";
import { useVisitTour } from "@/features/tutorial/use-visit-tour";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useCompanyRefresh } from "../hooks";
import { CompanyChat } from "./company-chat";
import { HireSheet, TeamView, type HireRequest } from "./employer";
import { GrowthPath } from "./growth-path";
import { HeadquartersHero, netProfit } from "./headquarters";
import { ListingCard, SideJobNotice } from "./listing";
import { LogoEditor } from "./logo-editor";

type Tab = "overview" | "team" | "chat";
const factor = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const money = (cents: number) => formatMoney(cents, { whole: true });
const NEXT_TIER = { garage: "small_business", small_business: "gmbh", gmbh: "ag", ag: null } as const;

/** The founder's view of the own company (ADR-057, redesigned in ADR-071). */
export function CompanyDashboard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const tl = useTranslations("logo");
  const [tab, setTab] = useState<Tab>("overview");
  const [hire, setHire] = useState<HireRequest | null>(null);
  const [drawing, setDrawing] = useState(false);
  useVisitTour("visit_company");
  const trainingOpen = company.employees + company.aiWorkers >= company.trainingFrom;

  const goTraining = () => {
    setTab("team");
    window.setTimeout(() => document.getElementById("training")?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  return (
    <div className="space-y-5">
      <HeadquartersHero company={company} onDrawLogo={() => setDrawing(true)} />

      <LogoEditor company={company} open={drawing} onClose={() => setDrawing(false)} />
      {company.logoHidden && <p className="rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">{tl("hidden")}</p>}
      {company.logo === null && (
        <Card
          padding="md"
          className="flex flex-wrap items-center gap-4 border-accent/40 bg-accent-soft"
          data-testid="logo-prompt"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-fg-1">{tl("promptTitle")}</p>
            <p className="text-sm text-pretty text-fg-2">{tl("promptText")}</p>
          </div>
          <Button onClick={() => setDrawing(true)}>{tl("promptButton")}</Button>
        </Card>
      )}
      <SideJobNotice company={company} />
      <ListingCard company={company} />
      {company.distress && (
        <p className="rounded-md bg-loss-soft px-4 py-3 text-sm text-pretty text-loss" data-testid="distress">
          {t("distressCountdown", {
            amount: money(company.unpaidCents),
            count: Math.max(1, company.graceQuarters - company.distressQuarters),
          })}
        </p>
      )}

      <DepartmentTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: t("tabOverview"), icon: "home" },
          { value: "team", label: t("tabTeam"), icon: "profile", badge: company.pendingApplications },
          { value: "chat", label: t("tabChat"), icon: "bell" },
        ]}
      />

      {tab === "overview" && (
        <div className="grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
          <div className="space-y-5">
            <GrowthPath
              company={company}
              onFill={(skills) => setHire({ skills })}
              onTrain={trainingOpen ? goTraining : undefined}
            />
            <QuarterReceipt company={company} />
            <HistoryCard company={company} />
          </div>
          <div className="space-y-5">
            <MarketCard company={company} />
            <BossOffice company={company} onTeam={() => setTab("team")} />
          </div>
        </div>
      )}
      {tab === "team" && <TeamView company={company} onHire={setHire} />}
      {tab === "chat" && <CompanyChat />}

      <HireSheet company={company} request={hire} onClose={() => setHire(null)} />
    </div>
  );
}

/** Departments as chunky, pressable tabs. */
function DepartmentTabs({
  value,
  onChange,
  tabs,
}: {
  value: Tab;
  onChange: (tab: Tab) => void;
  tabs: { value: Tab; label: string; icon: keyof typeof UI_ICONS; badge?: number }[];
}) {
  const t = useTranslations("firm");
  return (
    <div role="tablist" aria-label={t("title")} className="grid grid-cols-3 gap-2 rounded-lg bg-surface-2 p-1.5">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (active) return;
              haptic("tap");
              void playSound("tap");
              onChange(tab.value);
            }}
            className={cn(
              "relative flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium focus-ring transition duration-fast active:scale-[0.97]",
              active ? "text-fg-1" : "text-fg-3 hover:text-fg-1",
            )}
          >
            {active && (
              <motion.span
                layoutId="company-tab"
                transition={SPRING.snappy}
                className="absolute inset-0 rounded-md bg-surface-1 shadow-1 ring-1 ring-line-2"
              />
            )}
            <PixelIcon {...UI_ICONS[tab.icon]} scale={1} className="relative" />
            <span className="relative">{tab.label}</span>
            {tab.badge ? (
              <span className="relative rounded-pill bg-accent px-1.5 nums text-2xs text-on-accent">{tab.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Panel({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card padding="lg" className={cn("space-y-4", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-pixel text-fg-2">{title}</p>
        {aside}
      </div>
      {children}
    </Card>
  );
}

/** The last quarter as a receipt: what came in, what went out, what stayed. */
function QuarterReceipt({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const q = company.lastQuarter;
  if (!q) {
    return (
      <Panel title={t("lastQuarter")}>
        <p className="text-sm text-fg-3">{t("noQuarter")}</p>
      </Panel>
    );
  }
  const profit = netProfit(q);
  const scale = Math.max(q.demandCents, q.capacityCents, 1);
  const costs: [string, number][] = (
    [
      [t("cogs"), q.cogsCents],
      [t("fixedCosts"), q.fixedCents],
      [t("aiCosts"), q.aiWorkerCents],
      [t("marketing"), q.marketingCents],
      [t("wages"), q.wagesCents],
      [t("bonus"), q.bonusCents ?? 0],
    ] as [string, number][]
  ).filter(([, value]) => value > 0);
  return (
    <Panel
      title={`${t("lastQuarter")} · ${q.label}`}
      aside={
        <span className="nums text-xs text-fg-3">
          {t("utilization", { percent: formatBps(q.utilizationBps).replace("+", "") })}
        </span>
      }
    >
      <div className="space-y-3">
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
            <div className="h-2.5 overflow-hidden rounded-pill bg-surface-3">
              <motion.div
                className={cn("h-full origin-left rounded-pill", color)}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: value / scale }}
                transition={SPRING.smooth}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-pretty text-fg-3">{q.utilizationBps >= 9_900 ? t("soldOut") : t("idle")}</p>

      <div className="rounded-md bg-surface-2 px-4 pt-3 pb-4 font-mono text-sm">
        <dl className="space-y-1.5">
          <div className="flex justify-between">
            <dt className="text-fg-2">{t("revenue")}</dt>
            <dd className="nums text-fg-1">{money(q.revenueCents)}</dd>
          </div>
          {costs.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <dt className="text-fg-3">{label}</dt>
              <dd className="nums text-fg-2">−{money(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="my-2.5 border-t border-dashed border-line-2" />
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-fg-1">{t("profit")}</span>
          <span
            aria-hidden
            className={cn(
              "ml-auto -rotate-6 rounded-xs border-2 px-1.5 py-0.5 label-pixel",
              profit >= 0 ? "border-gain text-gain" : "border-loss text-loss",
            )}
          >
            {profit >= 0 ? t("stampProfit") : t("stampLoss")}
          </span>
          <span className={cn("nums text-lg font-semibold", profit >= 0 ? "text-gain" : "text-loss")}>
            {money(profit)}
          </span>
        </div>
      </div>
    </Panel>
  );
}

/** Revenue (bars up) and profit (green up, red down) around a zero line. */
function HistoryCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const history = company.history;
  const max = Math.max(1, ...history.map((h) => Math.max(h.revenueCents, Math.abs(h.profitCents))));
  const hasLoss = history.some((h) => h.profitCents < 0);
  return (
    <Panel title={t("historyTitle")}>
      {history.length === 0 ? (
        <p className="text-sm text-fg-3">{t("historyEmpty")}</p>
      ) : (
        <>
          <div className="flex h-40 flex-col" role="img" aria-label={t("historyTitle")}>
            <div className="flex flex-1 items-end gap-1.5 border-b border-line-2">
              {history.map((h) => (
                <div
                  key={h.label}
                  className="flex h-full min-w-0 flex-1 items-end gap-0.5"
                  title={`${h.label}: ${money(h.revenueCents)} / ${money(h.profitCents)}`}
                >
                  <Bar className="bg-accent/70" share={h.revenueCents / max} from="bottom" />
                  <Bar className="bg-gain" share={Math.max(0, h.profitCents) / max} from="bottom" />
                </div>
              ))}
            </div>
            {hasLoss && (
              <div className="flex h-1/3 gap-1.5">
                {history.map((h) => (
                  <div key={h.label} className="flex h-full min-w-0 flex-1 items-start gap-0.5">
                    <span className="flex-1" />
                    <Bar className="bg-loss" share={Math.max(0, -h.profitCents) / max} from="top" />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-4 text-xs text-fg-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-xs bg-accent/70" /> {t("revenue")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-xs bg-gain" /> {t("profit")}
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}

function Bar({ share, className, from }: { share: number; className: string; from: "top" | "bottom" }) {
  return (
    <motion.div
      className={cn(
        "w-full flex-1",
        from === "bottom" ? "origin-bottom rounded-t-xs" : "origin-top rounded-b-xs",
        className,
      )}
      initial={{ scaleY: 0 }}
      animate={{ scaleY: 1 }}
      transition={SPRING.smooth}
      style={{ height: `${Math.max(share > 0 ? 3 : 0, share * 100)}%` }}
    />
  );
}

/** Awareness and quality as chunky ten-block meters. */
function MarketCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  return (
    <Panel title={t("marketTitle")}>
      <Meter label={t("awareness")} bps={company.awarenessBps} tone="accent" />
      <Meter label={t("quality")} bps={company.qualityBps} tone="gain" />
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
    </Panel>
  );
}

function Meter({ label, bps, tone }: { label: string; bps: number; tone: "accent" | "gain" }) {
  const filled = bps / 1_000;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-fg-2">{label}</span>
        <span className="nums text-fg-1">{formatBps(bps).replace("+", "")}</span>
      </div>
      <div
        className="grid grid-cols-10 gap-1"
        role="meter"
        aria-label={label}
        aria-valuenow={bps / 100}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {Array.from({ length: 10 }, (_, i) => {
          const part = Math.min(1, Math.max(0, filled - i));
          return (
            <span key={i} className="h-3 overflow-hidden rounded-xs bg-surface-3">
              <span
                className={cn("block h-full origin-left", tone === "gain" ? "bg-gain" : "bg-accent")}
                style={{ transform: `scaleX(${part})` }}
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** The boss's office: marketing, team, money, the next building and, far down, closing the company. */
function BossOffice({ company, onTeam }: { company: MyCompany; onTeam: () => void }) {
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const maxMarketing = Math.max(100_000, Math.round(company.estimateHighCents / 4 / 5 / 1_000) * 1_000);
  const [marketing, setMarketing] = useState(company.marketingCentsPerQuarter);
  const [marketingState, setMarketingState] = useState<ButtonState>("idle");
  const [money, setMoney] = useState<"deposit" | "withdraw" | null>(null);
  const [upgradeState, setUpgradeState] = useState<ButtonState>("idle");
  const [closing, setClosing] = useState(false);
  const staff = company.employees + company.aiWorkers;
  const next = NEXT_TIER[company.tier];

  const run = async (action: () => Promise<unknown>, done: string) => {
    await action();
    toast.success(done, undefined, { silent: true });
    void playSound("success");
    haptic("success");
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
    <Panel title={t("controlsTitle")}>
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

      <button
        type="button"
        onClick={() => {
          haptic("tap");
          onTeam();
        }}
        className="flex w-full items-center gap-3 rounded-md bg-surface-2 px-3 py-3 text-left focus-ring transition duration-fast hover:-translate-y-0.5 hover:bg-surface-3 active:translate-y-0 active:scale-[0.98]"
      >
        <PixelIcon {...UI_ICONS.profile} scale={2} className="text-fg-2" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-fg-1">{t("staffCount", { used: staff, max: company.maxEmployees })}</span>
          <span className="block text-xs text-fg-3">
            {t("teamLine", { ai: company.aiWorkers })} ·{" "}
            <span className="nums text-gain">
              {t("productivityValue", { value: factor.format(company.teamProductivityBps / 10_000) })}
            </span>{" "}
            · {t("capacity")} <ShortMoney cents={company.capacityCents} />
          </span>
        </span>
        <span className="nums text-lg font-semibold text-fg-1" data-testid="ai-workers" title={t("aiWorkers")}>
          {company.aiWorkers}
        </span>
      </button>

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
      <MoneySheet mode={money} company={company} onClose={() => setMoney(null)} />

      {next &&
        company.upgradeCostCents !== null &&
        (company.tier === "garage" || company.tier === "small_business") && (
          <div className="flex gap-3 rounded-md border border-line-1 bg-surface-1 px-3 py-3">
            <PixelIcon
              {...COMPANY_BUILDINGS[next]}
              scale={3}
              className={cn(!company.canUpgrade && "opacity-50 grayscale")}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg-1">
                {company.tier === "garage" ? t("upgradeTitle") : t("upgradeGmbhTitle")}
              </p>
              <p className="mt-0.5 text-xs text-pretty text-fg-3">
                {company.tier === "garage"
                  ? t("upgradeText", { amount: formatMoney(company.upgradeCostCents, { whole: true }) })
                  : t("upgradeGmbhText", { amount: formatMoney(company.upgradeCostCents, { whole: true }) })}
              </p>
              <Button
                size="sm"
                className="mt-2"
                state={upgradeState}
                disabled={!company.canUpgrade}
                onClick={() => void upgrade()}
              >
                {company.canUpgrade
                  ? t("upgrade")
                  : t("upgradeLockedAt", {
                      level:
                        company.tier === "garage" ? BALANCE.company.tiers[0]!.minLevel : BALANCE.startups.gmbh.minLevel,
                    })}
              </Button>
            </div>
          </div>
        )}

      <details className="group rounded-md border border-line-1 px-3 py-2 text-sm">
        <summary className="cursor-pointer list-none text-fg-3 focus-ring hover:text-fg-1">{t("moreSettings")}</summary>
        <div className="mt-3 space-y-2">
          <p className="text-fg-2">{t("payFactor", { value: formatBps(company.payFactorBps).replace("+", "") })}</p>
          <p className="text-xs text-pretty text-fg-3">{t("payFactorHint")}</p>
          <Button size="sm" variant="danger" onClick={() => setClosing(true)}>
            {t("closeTitle")}
          </Button>
        </div>
      </details>
      <CloseSheet company={company} open={closing} onClose={() => setClosing(false)} />
    </Panel>
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

function CloseSheet({ company, open, onClose }: { company: MyCompany; open: boolean; onClose: () => void }) {
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [busy, setBusy] = useState(false);
  const close = async () => {
    setBusy(true);
    try {
      const r = await engine.closeCompany(crypto.randomUUID());
      toast.success(
        t("closed"),
        `${t("closedText", { debt: money(r.totalDebtCents), back: money(r.toFounderCents) })}${
          r.loanCents > 0 ? ` ${t("closedLoan", { loan: money(r.loanCents) })}` : ""
        }`,
      );
      onClose();
      await refresh();
    } catch (error) {
      toast.error(t("closeTitle"), errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("closeTitle")}
      footer={
        <HoldButton tone="loss" onConfirm={() => void close()} disabled={busy} className="w-full">
          {t("closeConfirm")}
        </HoldButton>
      }
    >
      <p className="text-pretty text-fg-2">{t("closeText")}</p>
      <p className="mt-3 nums text-sm text-fg-3">
        {t("closeEstimate", { cash: money(company.cashCents), unpaid: money(company.unpaidCents) })}
      </p>
    </Sheet>
  );
}
