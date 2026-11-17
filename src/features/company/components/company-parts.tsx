"use client";

import { AwarenessMeter } from "@/features/company/awareness/awareness-meter";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { COMPANY_BUILDINGS, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { LiveMoney, ShortMoney } from "@/components/ui/live-money";
import { Sheet } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import type { ListedRestrictions } from "@/features/game/listed-types";
import { useServerClock } from "@/features/game/server-clock";
import { engine, useGame } from "@/features/game/store";
import type { MyCompany } from "@/features/game/types";
import { parseEuroCents } from "@/features/market/order-schema";
import { formatBps, formatCountdown, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { InfoTip } from "./firm-layout";
import { useCompanyRefresh } from "../hooks";
import { netProfit } from "./headquarters";

/*
 * Cards of the own company page that are older than the tabs (ADR-057, ADR-071, ADR-133): the quarter receipt, the
 * history, the market meters, the till with deposit and withdrawal, the marketing budget, the next legal form and
 * closing the company. The tabs (ADR-167) arrange them.
 */

const factor = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const money = (cents: number) => formatMoney(cents, { whole: true });
const NEXT_TIER = { garage: "small_business", small_business: "gmbh", gmbh: "ag", ag: null } as const;

function Panel({
  title,
  aside,
  description,
  info,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  /** One line under the title (ADR-183). */
  description?: ReactNode;
  /** An "i" with a longer explanation (ADR-183). */
  info?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card padding="lg" className={cn("space-y-4", className)}>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 label-pixel text-fg-2">
            {title}
            {info && <InfoTip text={info} label={title} />}
          </p>
          {aside}
        </div>
        {description && <p className="text-xs text-pretty text-fg-3">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

/** The last quarter as a receipt: what came in, what went out, what stayed. */
export function QuarterReceipt({ company }: { company: MyCompany }) {
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
export function HistoryCard({ company }: { company: MyCompany }) {
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
export function MarketCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  return (
    <Panel title={t("marketTitle")}>
      {/* ADR-188: the same value and cap as the dashboard's status bar (awarenessView) */}
      <AwarenessMeter company={company} />
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

function useRun() {
  const refresh = useCompanyRefresh();
  return async (action: () => Promise<unknown>, done: string) => {
    await action();
    toast.success(done, undefined, { silent: true });
    void playSound("success");
    haptic("success");
    await refresh();
  };
}

/** The standing marketing budget per quarter. */
export function MarketingBudgetCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const run = useRun();
  const maxMarketing = Math.max(100_000, Math.round(company.estimateHighCents / 4 / 5 / 1_000) * 1_000);
  const [marketing, setMarketing] = useState(company.marketingCentsPerQuarter);
  const [state, setState] = useState<ButtonState>("idle");

  const save = async () => {
    setState("loading");
    try {
      await run(() => engine.setCompanyMarketing(crypto.randomUUID(), marketing), t("marketingSaved"));
      setState("success");
      window.setTimeout(() => setState("idle"), 800);
    } catch (error) {
      setState("idle");
      toast.error(t("marketing"), errorText(error));
    }
  };

  return (
    <Panel
      title={t("controlsTitle")}
      info={t("marketingInfo")}
      description={t("marketingHint", {
        hours: BALANCE.time.quarterHours,
        perHour: formatMoney(Math.round(marketing / BALANCE.time.quarterHours), { whole: true }),
      })}
    >
      <div className="space-y-2" id="company-controls">
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
          state={state}
          disabled={marketing === company.marketingCentsPerQuarter}
          onClick={() => void save()}
        >
          {t("marketingSave")}
        </Button>
      </div>
    </Panel>
  );
}

/** Team size, productivity and capacity in one line; leads to the staff tab. */
export function StaffLink({ company, onTeam }: { company: MyCompany; onTeam: () => void }) {
  const t = useTranslations("firm");
  const staff = company.employees + company.aiWorkers;
  return (
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
  );
}

/** The next legal form (garage → small business → GmbH); nothing once the company is a GmbH or AG. */
export function UpgradeCard({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const run = useRun();
  const [state, setState] = useState<ButtonState>("idle");
  const next = NEXT_TIER[company.tier];
  if (!next || company.upgradeCostCents === null) return null;
  if (company.tier !== "garage" && company.tier !== "small_business") return null;

  const upgrade = async () => {
    setState("loading");
    try {
      await run(() => engine.upgradeCompany(crypto.randomUUID()), t("upgraded"));
      setState("success");
    } catch (error) {
      setState("idle");
      toast.error(t("upgradeTitle"), errorText(error));
    }
  };

  return (
    <Card padding="md" className="flex gap-3" data-testid="upgrade">
      <PixelIcon {...COMPANY_BUILDINGS[next]} scale={3} className={cn(!company.canUpgrade && "opacity-50 grayscale")} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg-1">
          {company.tier === "garage" ? t("upgradeTitle") : t("upgradeGmbhTitle")}
        </p>
        <p className="mt-0.5 text-xs text-pretty text-fg-3">
          {company.tier === "garage"
            ? t("upgradeText", { amount: formatMoney(company.upgradeCostCents, { whole: true }) })
            : t("upgradeGmbhText", { amount: formatMoney(company.upgradeCostCents, { whole: true }) })}
        </p>
        <Button size="sm" className="mt-2" state={state} disabled={!company.canUpgrade} onClick={() => void upgrade()}>
          {company.canUpgrade
            ? t("upgrade")
            : t("upgradeLockedAt", {
                level: company.tier === "garage" ? BALANCE.company.tiers[0]!.minLevel : BALANCE.startups.gmbh.minLevel,
              })}
        </Button>
      </div>
    </Card>
  );
}

/** How wages are paid when the till is short. */
export function PayFactorNote({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  return (
    <details className="group rounded-md border border-line-1 px-3 py-2 text-sm">
      <summary className="cursor-pointer list-none text-fg-3 focus-ring hover:text-fg-1">{t("payFactorTitle")}</summary>
      <div className="mt-3 space-y-2">
        <p className="text-fg-2">{t("payFactor", { value: formatBps(company.payFactorBps).replace("+", "") })}</p>
        <p className="text-xs text-pretty text-fg-3">{t("payFactorHint")}</p>
      </div>
    </details>
  );
}

/** The dissolve action stays plainly visible, not hidden away (ADR-147). */
export function DangerZone({ company }: { company: MyCompany }) {
  const t = useTranslations("firm");
  const [closing, setClosing] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-loss/40 bg-loss-soft px-3 py-3" data-testid="danger-zone">
      <p className="label-pixel text-loss">{t("dangerZone")}</p>
      <p className="text-xs text-pretty text-fg-3">{t("closeHint")}</p>
      <Button size="sm" variant="danger" onClick={() => setClosing(true)} data-testid="close-company">
        {t("closeTitle")}
      </Button>
      <CloseSheet company={company} open={closing} onClose={() => setClosing(false)} />
    </div>
  );
}

function MoneySheet({
  mode,
  company,
  freeCashCents,
  onClose,
}: {
  mode: "deposit" | "withdraw" | null;
  company: MyCompany;
  /** Listed companies (ADR-167): money the board has earmarked cannot be withdrawn. */
  freeCashCents?: number;
  onClose: () => void;
}) {
  const t = useTranslations("firm");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const privateCents = useGame((state) => state.portfolio?.cashCents ?? 0);
  const [text, setText] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  const [shown, setShown] = useState(mode);
  if (mode !== null && mode !== shown) {
    setShown(mode);
    setText("");
    setState("idle");
  }
  const deposit = shown !== "withdraw";
  const available = deposit
    ? privateCents
    : Math.max(0, Math.min(company.cashCents - company.unpaidCents, freeCashCents ?? Number.MAX_SAFE_INTEGER));
  const cents = parseEuroCents(text) ?? 0;
  const tooMuch = cents > available;
  const after = {
    private: privateCents + (deposit ? -cents : cents),
    company: company.cashCents + (deposit ? cents : -cents),
  };
  const submit = async () => {
    if (!cents || tooMuch || !shown) return;
    setState("loading");
    try {
      if (deposit) await engine.companyDeposit(crypto.randomUUID(), cents);
      else await engine.companyWithdraw(crypto.randomUUID(), cents);
      toast.success(deposit ? t("depositDone") : t("withdrawDone"), formatMoney(cents), { silent: true });
      void playSound("coin");
      haptic("success");
      await refresh();
      onClose();
    } catch (error) {
      setState("idle");
      toast.error(t("money"), errorText(error));
    }
  };
  const pocket = (label: string, now: number, next: number, highlight: boolean) => (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-md px-3 py-2.5",
        highlight ? "bg-accent-soft ring-1 ring-accent" : "bg-surface-2",
      )}
    >
      <p className="label-pixel text-fg-3">{label}</p>
      <p className="truncate nums font-semibold text-fg-1">{formatMoney(now, { whole: true })}</p>
      {cents > 0 && !tooMuch && (
        <p className="truncate nums text-xs text-fg-2">→ {formatMoney(next, { whole: true })}</p>
      )}
    </div>
  );
  return (
    <Sheet
      open={mode !== null}
      onOpenChange={(open) => !open && onClose()}
      title={deposit ? t("deposit") : t("withdraw")}
      description={deposit ? t("depositHint") : t("withdrawHint")}
      footer={
        <Button block size="lg" state={state} disabled={!cents || tooMuch} onClick={() => void submit()}>
          {cents > 0
            ? t(deposit ? "depositAmount" : "withdrawAmount", { amount: formatMoney(cents, { whole: true }) })
            : deposit
              ? t("deposit")
              : t("withdraw")}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2" data-testid="money-flow">
          {pocket(t("private"), privateCents, after.private, !deposit)}
          <motion.span
            aria-hidden
            className="font-pixel text-lg text-accent"
            animate={{ x: deposit ? [0, 4, 0] : [0, -4, 0] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          >
            {deposit ? "→" : "←"}
          </motion.span>
          {pocket(t("companyCash"), company.cashCents, after.company, deposit)}
        </div>
        <Field
          label={t("amount")}
          inputMode="decimal"
          value={text}
          error={tooMuch ? t("tooMuch", { amount: formatMoney(available, { whole: true }) }) : undefined}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {[0.1, 0.25, 0.5, 1].map((share) => {
            const value = Math.floor((available * share) / 100) * 100;
            return (
              <button
                key={share}
                type="button"
                disabled={value <= 0}
                onClick={() => {
                  haptic("tap");
                  setText(String(value / 100).replace(".", ","));
                }}
                className="rounded-pill border border-line-1 px-3 py-1.5 text-xs text-fg-2 focus-ring transition duration-fast hover:border-accent hover:text-fg-1 active:scale-95 disabled:opacity-40"
              >
                {share === 1 ? t("all") : `${share * 100} %`}
              </button>
            );
          })}
        </div>
        {!deposit && company.unpaidCents > 0 && (
          <p className="text-xs text-warn">{t("withdrawUnpaid", { amount: money(company.unpaidCents) })}</p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The company's till: balance (live), the founder's own money, deposit and withdraw as big buttons. For listed
 * companies (ADR-167) it also shows what the board has earmarked and whether withdrawals are blocked.
 */
export function TreasuryCard({
  company,
  freeCashCents,
  reservedCents = 0,
  restrictions,
}: {
  company: MyCompany;
  freeCashCents?: number;
  reservedCents?: number;
  restrictions?: ListedRestrictions;
}) {
  const t = useTranslations("firm");
  const th = useTranslations("hq.money");
  const privateCents = useGame((state) => state.portfolio?.cashCents ?? 0);
  const now = useServerClock();
  const [mode, setMode] = useState<"deposit" | "withdraw" | null>(null);
  const live = company.live;
  const blockedUntil = restrictions?.withdrawBlockUntil ?? null;
  const blocked = blockedUntil !== null && now !== null && Date.parse(blockedUntil) > now;
  return (
    <Panel title={t("treasuryTitle")}>
      <div data-testid="treasury">
        <p className="text-3xl font-semibold text-fg-1">
          {live ? (
            <LiveMoney cents={company.cashCents} perHourCents={live.profitPerHourCents} asOf={live.lastHourAt} />
          ) : (
            <ShortMoney cents={company.cashCents} />
          )}
        </p>
        <p className="mt-1 text-xs text-fg-3">
          {t("privateLine")} <ShortMoney cents={privateCents} className="text-fg-2" />
          {company.unpaidCents > 0 && (
            <span className="text-warn"> · {t("unpaidLine", { amount: money(company.unpaidCents) })}</span>
          )}
        </p>
      </div>
      {freeCashCents !== undefined && reservedCents > 0 && (
        <p className="rounded-md bg-info-soft px-3 py-2 nums text-sm text-pretty text-info" data-testid="treasury-free">
          {th("freeLine", { free: money(freeCashCents), reserved: money(reservedCents) })}
        </p>
      )}
      {blocked && blockedUntil && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-pretty text-warn" data-testid="withdraw-blocked">
          {th("withdrawBlocked", { time: formatCountdown((Date.parse(blockedUntil) - (now ?? 0)) / 1000) })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <MoneyButton
          icon="↓"
          label={t("deposit")}
          hint={t("depositShort")}
          onClick={() => setMode("deposit")}
          primary
        />
        <MoneyButton
          icon="↑"
          label={t("withdraw")}
          hint={t("withdrawShort")}
          onClick={() => setMode("withdraw")}
          disabled={blocked}
        />
      </div>
      <MoneySheet mode={mode} company={company} freeCashCents={freeCashCents} onClose={() => setMode(null)} />
    </Panel>
  );
}

function MoneyButton({
  icon,
  label,
  hint,
  onClick,
  primary,
  disabled,
}: {
  icon: string;
  label: string;
  hint: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        haptic("tap");
        onClick();
      }}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-3 text-left focus-ring transition duration-fast hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        primary ? "bg-accent text-on-accent shadow-1" : "bg-surface-2 text-fg-1 ring-1 ring-line-2 hover:bg-surface-3",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-sm font-pixel text-base",
          primary ? "bg-on-accent/15" : "bg-surface-3",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className={cn("block truncate text-2xs", primary ? "opacity-80" : "text-fg-3")}>{hint}</span>
      </span>
    </button>
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
      <p className="mt-3 text-sm text-pretty text-fg-2">{t("closeNext")}</p>
    </Sheet>
  );
}
