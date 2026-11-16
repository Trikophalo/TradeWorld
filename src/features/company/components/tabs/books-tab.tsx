"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HoldButton } from "@/components/ui/hold-button";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { LEDGER_CATEGORIES, OPERATING_CATEGORIES, type LedgerCategory } from "@/config/listed";
import { useGameErrorText } from "@/features/game/errors";
import type { AccountingDay, ListedCompany, TaxPeriod } from "@/features/game/listed-types";
import { useServerClock } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { Line, money, Panel, ServerCountdown, signed, Stat, useItemText, useListedAction } from "../../listed/shared";
import { nextTaxDue, taxPeriodState } from "../../listed/view";

const dayTime = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const dayOnly = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const clock = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const percent = (bps: number) => formatBps(bps).replace("+", "");
const cfg = BALANCE.listed.taxes;

/**
 * Buchhaltung of a listed company (ADR-167): the daily books (three receipts to sort, about 20 seconds), the taxes
 * that are due with their deadline, the tax advisor, closed periods and the full account statement.
 */
export function BooksTab({ listed }: { listed: ListedCompany }) {
  return (
    <div className="space-y-4" data-testid="company-books">
      <div className="grid items-start gap-4 *:min-w-0 lg:grid-cols-2 lg:gap-5">
        <div className="space-y-4">
          <BooksDuty listed={listed} />
          <AdvisorCard listed={listed} />
        </div>
        <div className="space-y-4">
          <TaxCard listed={listed} />
          <PeriodsCard listed={listed} />
        </div>
      </div>
      <AccountingCard />
    </div>
  );
}

// ------------------------------------------------------------------ the daily books

const STAGE_TONE = {
  none: "bg-surface-2 text-fg-2",
  open: "bg-info-soft text-info",
  reminder: "bg-warn-soft text-warn",
  late: "bg-loss-soft text-loss",
  estimate: "bg-loss-soft text-loss",
} as const;

function BooksDuty({ listed }: { listed: ListedCompany }) {
  const t = useTranslations("hq.books");
  const ts = useTranslations("listed.booksStages");
  const b = listed.books;
  const [open, setOpen] = useState(false);
  const advisor = listed.taxes.advisor;
  // What comes next if nothing happens.
  const next =
    b.stage === "open"
      ? ({ key: "nextReminder", at: b.reminderAt } as const)
      : b.stage === "reminder"
        ? ({ key: "nextLateFee", at: b.lateFeeAt } as const)
        : b.stage === "late"
          ? ({ key: "nextEstimate", at: b.estimateAt } as const)
          : null;
  return (
    <Panel
      title={t("dutyTitle")}
      id="books-duty"
      testId="books-duty"
      aside={
        <Badge tone={b.streak > 0 ? "gain" : "neutral"} data-testid="books-streak">
          {t("streak", { count: b.streak })}
        </Badge>
      }
    >
      <p className={cn("rounded-md px-3 py-2 text-sm text-pretty", STAGE_TONE[b.doneToday ? "none" : b.stage])}>
        <span className="font-semibold">{b.doneToday ? t("doneToday") : ts(b.stage)}</span>
        {!b.doneToday && next && (
          <>
            {" · "}
            {t(next.key)} <ServerCountdown at={next.at} className="font-semibold" />
          </>
        )}
        {!b.doneToday && b.stage === "estimate" && <> · {t("estimateNow")}</>}
      </p>
      <dl className="space-y-1.5 rounded-md bg-surface-2 px-3 py-3" data-testid="books-period">
        <Line
          label={t("period")}
          value={t("periodValue", { start: dayTime.format(new Date(b.periodStart)), hours: b.hoursOpen })}
          tone="muted"
        />
        <Line label={t("revenue")} value={money(b.revenueCents)} />
        <Line label={t("costs")} value={`−${money(b.costsCents)}`} />
        <Line label={t("profit")} value={money(b.profitCents)} tone={b.profitCents >= 0 ? "gain" : "loss"} strong />
        {b.lossCarryCents > 0 && <Line label={t("lossCarry")} value={`−${money(b.lossCarryCents)}`} tone="muted" />}
        <Line
          label={t("estimatedTax", { rate: percent(b.rateBps) })}
          value={money(b.estimatedTaxCents)}
          tone={b.estimatedTaxCents > 0 ? "warn" : undefined}
          strong
        />
      </dl>
      {advisor ? (
        <p className="rounded-md bg-gain-soft px-3 py-2 text-sm text-pretty text-gain" data-testid="books-advisor">
          {t("advisorDoes")}
        </p>
      ) : b.canClose ? (
        <Button block size="lg" onClick={() => setOpen(true)} data-testid="books-open">
          {t("start")}
        </Button>
      ) : (
        <p className="text-sm text-pretty text-fg-3" data-testid="books-nothing">
          {b.doneToday ? t("doneHint") : t("nothing")}
        </p>
      )}
      <p className="text-xs text-pretty text-fg-3">
        {t("dutyHint", { discount: percent(cfg.check.discountBps), receipts: cfg.check.receipts })}
      </p>
      <BooksSheet listed={listed} open={open} onClose={() => setOpen(false)} />
    </Panel>
  );
}

/** The 20-second job: sort the receipts, look at the tax, close, pay now or later. */
function BooksSheet({ listed, open, onClose }: { listed: ListedCompany; open: boolean; onClose: () => void }) {
  const t = useTranslations("hq.books");
  const tr = useTranslations("listed.receipts");
  const tc = useTranslations("listed.categories");
  const action = useListedAction();
  const b = listed.books;
  const [receipts, setReceipts] = useState(b.receipts);
  const [answers, setAnswers] = useState<Record<number, LedgerCategory>>({});
  const [result, setResult] = useState<{ period: TaxPeriod; paidCents: number } | null>(null);
  // A fresh sheet for every opening; the receipts stay as they were while the result is shown.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReceipts(b.receipts);
      setAnswers({});
      setResult(null);
    }
  }
  const sorted = receipts.every((r) => answers[r.id] !== undefined);
  const canPay = listed.cashCents >= b.estimatedTaxCents + listed.taxes.dueCents;

  const close = async (pay: boolean) => {
    const list = receipts.map((r) => answers[r.id] ?? "");
    let outcome: { period: TaxPeriod; paidCents: number } | null = null;
    await action.run(
      pay ? "pay" : "later",
      async () => {
        const r = await engine.closeCompanyBooks(crypto.randomUUID(), list, pay);
        outcome = { period: r.period, paidCents: r.paidCents };
        return r;
      },
      { title: t("dutyTitle"), done: t("closed") },
    );
    if (outcome) setResult(outcome);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("sheetTitle")}
      description={result ? undefined : t("sheetIntro")}
      footer={
        result ? (
          <Button block size="lg" onClick={onClose} data-testid="books-done">
            {t("finish")}
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              block
              size="lg"
              state={action.state("pay")}
              disabled={!sorted || !canPay || action.busy !== null}
              onClick={() => void close(true)}
              data-testid="books-close-pay"
            >
              {t("closeAndPay")}
            </Button>
            <Button
              block
              variant="secondary"
              state={action.state("later")}
              disabled={!sorted || action.busy !== null}
              onClick={() => void close(false)}
              data-testid="books-close-later"
            >
              {t("closeLater", { hours: cfg.payWithinHours })}
            </Button>
          </div>
        )
      }
    >
      {result ? (
        <BooksResult period={result.period} paidCents={result.paidCents} total={receipts.length} />
      ) : (
        <div className="space-y-4" data-testid="books-sheet">
          <ol className="space-y-3">
            {receipts.map((r, index) => (
              <li
                key={r.id}
                className="rounded-md border border-dashed border-line-2 bg-surface-2 px-3 py-3"
                data-testid={`receipt-${r.id}`}
                data-sorted={answers[r.id] !== undefined}
              >
                <div className="flex items-baseline justify-between gap-3 font-mono text-sm">
                  <span className="min-w-0 text-fg-1">
                    <span className="text-fg-3">{index + 1}.</span>{" "}
                    {tr.has(r.key as Parameters<typeof tr>[0]) ? tr(r.key as Parameters<typeof tr>[0]) : r.key}
                  </span>
                  <span className="shrink-0 nums text-fg-2">{formatMoney(r.amountCents)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("receiptWhere")}>
                  {b.receiptCategories.map((c) => {
                    const chosen = answers[r.id] === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={chosen}
                        onClick={() => {
                          haptic("tap");
                          void playSound("tap");
                          setAnswers((a) => ({ ...a, [r.id]: c }));
                        }}
                        data-testid={`receipt-${r.id}-${c}`}
                        className={cn(
                          "rounded-pill border px-2.5 py-1 text-xs focus-ring transition duration-fast active:scale-95",
                          chosen
                            ? "border-accent bg-accent text-on-accent"
                            : "border-line-2 bg-surface-1 text-fg-2 hover:border-accent hover:text-fg-1",
                        )}
                      >
                        {tc(c)}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
          <dl className="space-y-1.5 rounded-md bg-surface-2 px-3 py-3">
            <Line label={t("profit")} value={money(b.profitCents)} tone={b.profitCents >= 0 ? "gain" : "loss"} />
            <Line label={t("estimatedTax", { rate: percent(b.rateBps) })} value={money(b.estimatedTaxCents)} strong />
            <Line
              label={t("cleanDiscount", { discount: percent(cfg.check.discountBps) })}
              value={`−${money(Math.round((b.estimatedTaxCents * cfg.check.discountBps) / 10_000))}`}
              tone="gain"
            />
          </dl>
          {!canPay && <p className="text-sm text-pretty text-warn">{t("cannotPayNow")}</p>}
          {!sorted && <p className="text-xs text-fg-3">{t("sortFirst")}</p>}
        </div>
      )}
    </Sheet>
  );
}

function BooksResult({ period, paidCents, total }: { period: TaxPeriod; paidCents: number; total: number }) {
  const t = useTranslations("hq.books");
  const clean = period.checkCorrect !== null && period.checkCorrect >= total;
  const open = period.taxCents + period.penaltyCents - period.paidCents;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE.out }}
      className="space-y-4"
      data-testid="books-result"
    >
      <p
        className={cn(
          "rounded-md px-3 py-2.5 text-sm text-pretty",
          clean ? "bg-gain-soft text-gain" : "bg-warn-soft text-warn",
        )}
        data-testid="books-check"
      >
        {t(clean ? "resultClean" : "resultSloppy", { correct: period.checkCorrect ?? 0, total })}
      </p>
      <dl className="space-y-1.5 rounded-md bg-surface-2 px-3 py-3">
        <Line label={t("revenue")} value={money(period.revenueCents)} />
        <Line label={t("costs")} value={`−${money(period.costsCents)}`} />
        <Line label={t("profit")} value={money(period.profitCents)} tone={period.profitCents >= 0 ? "gain" : "loss"} />
        {period.lossUsedCents > 0 && (
          <Line label={t("lossUsed")} value={`−${money(period.lossUsedCents)}`} tone="muted" />
        )}
        <Line label={t("taxable")} value={money(period.taxableCents)} />
        {period.discountCents > 0 && (
          <Line label={t("discount")} value={`−${money(period.discountCents)}`} tone="gain" />
        )}
        <Line label={t("tax", { rate: percent(period.rateBps) })} value={money(period.taxCents)} strong />
      </dl>
      <p className="nums text-sm text-pretty text-fg-2" data-testid="books-result-pay">
        {paidCents > 0
          ? t("resultPaid", { amount: money(paidCents) })
          : open > 0
            ? t("resultDue", { amount: money(open), time: clock.format(new Date(period.dueAt)) })
            : t("resultNoTax")}
      </p>
    </motion.div>
  );
}

// ------------------------------------------------------------------ taxes

function TaxCard({ listed }: { listed: ListedCompany }) {
  const t = useTranslations("hq.tax");
  const now = useServerClock() ?? 0;
  const action = useListedAction();
  const x = listed.taxes;
  const due = x.periods.filter((p) => p.status === "due");
  const next = nextTaxDue(x.periods);
  const state = next ? taxPeriodState(next, now) : null;
  const canPay = listed.cashCents >= x.dueCents;
  const stage = listed.books.stage;
  const ladder = [
    { key: "reminder", hours: cfg.reminderAfterHours, active: stage === "reminder" },
    { key: "lateFee", hours: cfg.lateFeeAfterHours, active: stage === "late" },
    { key: "estimate", hours: cfg.estimateAfterHours, active: stage === "estimate" },
  ] as const;
  const pay = () =>
    action.run("pay", () => engine.payCompanyTax(crypto.randomUUID()), {
      title: t("title"),
      done: t("paid"),
      detail: formatMoney(x.dueCents, { whole: true }),
    });
  return (
    <Panel
      title={t("title")}
      id="taxes"
      testId="taxes"
      className={cn(
        state === "overdue" || state === "enforced" ? "border-loss/60" : x.dueCents > 0 && "border-warn/60",
      )}
      aside={<span className="label-pixel text-fg-3">{t("office")}</span>}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-fg-3">{t("due")}</p>
          <p
            className={cn(
              "nums text-3xl font-semibold",
              x.dueCents === 0 ? "text-fg-1" : state === "due" ? "text-warn" : "text-loss",
            )}
            data-testid="tax-due"
          >
            {money(x.dueCents)}
          </p>
        </div>
        {next && state === "due" && (
          <div className="text-right">
            <p className="text-xs text-fg-3">{t("deadline")}</p>
            <ServerCountdown at={next.dueAt} className="text-xl font-semibold text-warn" />
          </div>
        )}
        {next && state !== "due" && (
          <Badge tone="loss" data-testid="tax-overdue">
            {t(state === "enforced" ? "enforced" : "overdue")}
          </Badge>
        )}
      </div>
      {x.dueCents > 0 ? (
        <>
          <p className="text-sm text-pretty text-fg-2">
            {t(state === "due" ? "dueText" : "overdueText", {
              late: percent(cfg.latePaymentBps),
              force: percent(cfg.enforcementBps),
              hours: cfg.enforceAfterHours - cfg.payWithinHours,
            })}
          </p>
          {due.length > 1 && (
            <ul className="space-y-1">
              {due.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="nums text-fg-3">{t("until", { time: clock.format(new Date(p.dueAt)) })}</span>
                  <span className="nums text-fg-1">{money(p.taxCents + p.penaltyCents - p.paidCents)}</span>
                </li>
              ))}
            </ul>
          )}
          <Button
            block
            size="lg"
            state={action.state("pay")}
            disabled={!canPay}
            onClick={() => void pay()}
            data-testid="tax-pay"
          >
            {t("pay", { amount: money(x.dueCents) })}
          </Button>
          {!canPay && <p className="text-sm text-pretty text-loss">{t("short", { cash: money(listed.cashCents) })}</p>}
        </>
      ) : (
        <p className="rounded-md bg-gain-soft px-3 py-2 text-sm text-pretty text-gain" data-testid="tax-none">
          {t("none")}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t("rate")} hint={x.rateBps < cfg.rateBps ? t("rateResearch") : undefined}>
          {percent(x.rateBps)}
        </Stat>
        <Stat label={t("lossCarry")} hint={t("lossCarryHint")}>
          {money(x.lossCarryCents)}
        </Stat>
      </div>
      <div>
        <p className="mb-2 label-pixel text-fg-3">{t("ladderTitle")}</p>
        <ol className="space-y-1.5" data-testid="tax-ladder">
          {ladder.map((step) => (
            <li
              key={step.key}
              data-active={step.active}
              className={cn(
                "flex items-baseline gap-3 rounded-md px-3 py-2 text-sm",
                step.active ? "bg-loss-soft text-loss" : "bg-surface-2 text-fg-2",
              )}
            >
              <span className="w-12 shrink-0 nums font-semibold">{t("afterHours", { hours: step.hours })}</span>
              <span className="min-w-0 text-pretty">
                {t(`ladder.${step.key}`, {
                  fee: percent(cfg.lateFee.revenueBps),
                  min: money(cfg.lateFee.minCents),
                  margin: percent(cfg.estimate.marginBps),
                  surcharge: percent(cfg.estimate.surchargeBps),
                })}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-pretty text-fg-3">{t("ladderHint")}</p>
      </div>
    </Panel>
  );
}

function AdvisorCard({ listed }: { listed: ListedCompany }) {
  const t = useTranslations("hq.advisor");
  const action = useListedAction();
  const x = listed.taxes;
  const set = (hire: boolean) =>
    action.run("advisor", () => engine.setTaxAdvisor(crypto.randomUUID(), hire), {
      title: t("title"),
      done: t(hire ? "hired" : "fired"),
    });
  return (
    <Panel
      title={t("title")}
      id="advisor"
      testId="advisor"
      aside={<Badge tone={x.advisor ? "gain" : "neutral"}>{t(x.advisor ? "active" : "inactive")}</Badge>}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2">
          <PixelIcon {...UI_ICONS.briefcase} scale={2} />
        </span>
        <p className="text-sm text-pretty text-fg-2">{t("text", { discount: percent(x.advisorDiscountBps) })}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label={t("wage")}>{t("perHour", { amount: formatMoney(x.advisorWageCents) })}</Stat>
        <Stat label={t("discount")} tone="gain">
          {percent(x.advisorDiscountBps)}
        </Stat>
      </div>
      {x.advisor ? (
        <HoldButton tone="loss" onConfirm={() => void set(false)} disabled={action.busy !== null} className="w-full">
          <span data-testid="advisor-fire">{t("fire")}</span>
        </HoldButton>
      ) : (
        <Button
          variant="secondary"
          state={action.state("advisor")}
          onClick={() => void set(true)}
          data-testid="advisor-hire"
        >
          {t("hire", { amount: formatMoney(x.advisorWageCents) })}
        </Button>
      )}
    </Panel>
  );
}

function PeriodsCard({ listed }: { listed: ListedCompany }) {
  const t = useTranslations("hq.periods");
  const tb = useTranslations("listed.closedBy");
  const now = useServerClock() ?? 0;
  const [all, setAll] = useState(false);
  const periods = listed.taxes.periods;
  const shown = all ? periods : periods.slice(0, 5);
  return (
    <Panel title={t("title")} testId="tax-periods">
      {periods.length === 0 ? (
        <p className="text-sm text-pretty text-fg-3">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-line-1">
          {shown.map((p) => {
            const state = taxPeriodState(p, now);
            return (
              <li
                key={p.id}
                className="space-y-1 py-2.5 first:pt-0 last:pb-0"
                data-testid="tax-period"
                data-state={state}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="nums text-sm text-fg-1">
                    {p.kind === "late_fee" ? t("lateFee") : dayOnly.format(new Date(p.periodEnd))}
                  </span>
                  <Badge tone={state === "paid" ? "gain" : state === "due" ? "warn" : "loss"}>
                    {t(`state.${state}`)}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 nums text-xs text-fg-3">
                  <span>
                    {p.kind === "books"
                      ? t("line", { profit: money(p.profitCents), by: tb(p.closedBy) })
                      : t("lateFeeLine")}
                    {p.kind === "books" && p.checkCorrect !== null && p.closedBy === "founder"
                      ? ` · ${t("check", { correct: p.checkCorrect, total: cfg.check.receipts })}`
                      : ""}
                  </span>
                  <span className="text-sm font-medium text-fg-1">
                    {money(p.taxCents + p.penaltyCents)}
                    {p.penaltyCents > 0 && (
                      <span className="text-xs font-normal text-loss">
                        {" "}
                        {t("penalty", { amount: money(p.penaltyCents) })}
                      </span>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {periods.length > 5 && (
        <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
          {t(all ? "less" : "more", { count: periods.length })}
        </Button>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ the account statement

const RANGES = ["1", "7", "30"] as const;

function AccountingCard() {
  const t = useTranslations("hq.accounting");
  const tc = useTranslations("listed.categories");
  const item = useItemText();
  const errorText = useGameErrorText();
  const [range, setRange] = useState<(typeof RANGES)[number]>("7");
  const [openDay, setOpenDay] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["company", "accounting", range],
    queryFn: ({ pageParam }) => engine.companyAccounting(Number(range), pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    staleTime: 20_000,
  });
  const first = query.data?.pages[0];
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];
  const totals = first?.totals ?? {};
  const inflow = LEDGER_CATEGORIES.filter((c) => (totals[c] ?? 0) > 0);
  const outflow = LEDGER_CATEGORIES.filter((c) => (totals[c] ?? 0) < 0);
  const sum = (list: readonly LedgerCategory[]) => list.reduce((s, c) => s + (totals[c] ?? 0), 0);
  const operating = OPERATING_CATEGORIES.reduce((s, c) => s + (totals[c] ?? 0), 0);

  const more = async () => {
    const r = await query.fetchNextPage();
    if (r.isError) toast.error(t("title"), errorText(r.error));
  };

  return (
    <Panel
      title={t("title")}
      id="accounting"
      testId="accounting"
      aside={
        <Segmented
          size="sm"
          value={range}
          onValueChange={setRange}
          label={t("range")}
          options={RANGES.map((value) => ({ value, label: t("days", { count: Number(value) }) }))}
        />
      }
    >
      {query.isPending ? (
        <div className="space-y-3" aria-hidden>
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
          </div>
          <Skeleton className="h-40 w-full rounded-md" />
        </div>
      ) : !first || (first.days.length === 0 && entries.length === 0) ? (
        <EmptyState
          art={<PixelIcon {...UI_ICONS.portfolio} scale={4} />}
          title={t("emptyTitle")}
          description={t("emptyText")}
          className="py-6"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("in")} tone="gain" testId="accounting-in">
              {money(sum(inflow))}
            </Stat>
            <Stat label={t("out")} tone="loss" testId="accounting-out">
              {money(Math.abs(sum(outflow)))}
            </Stat>
            <Stat label={t("operating")} tone={operating >= 0 ? "gain" : "loss"} hint={t("operatingHint")}>
              {signed(operating)}
            </Stat>
            <Stat label={t("cash")}>{money(first.cashCents)}</Stat>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <CategoryList title={t("inflows")} categories={inflow} totals={totals} empty={t("noneIn")} />
            <CategoryList title={t("outflows")} categories={outflow} totals={totals} empty={t("noneOut")} />
          </div>

          <div>
            <p className="mb-2 label-pixel text-fg-3">{t("byDay")}</p>
            <ul className="space-y-1.5" data-testid="accounting-days">
              {first.days.map((d) => (
                <DayRow
                  key={d.day}
                  day={d}
                  open={openDay === d.day}
                  onToggle={() => setOpenDay((x) => (x === d.day ? null : d.day))}
                />
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 label-pixel text-fg-3">{t("entries")}</p>
            <ul className="divide-y divide-line-1" data-testid="accounting-entries">
              {entries.map((e) => (
                <li key={e.id} className="flex items-baseline gap-3 py-2 text-sm">
                  <span className="w-[5.5rem] shrink-0 nums text-xs text-fg-3">{dayTime.format(new Date(e.at))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-fg-1">
                      {e.item ? item.name(e.item) : (e.description ?? tc(e.category))}
                    </span>
                    <span className="block truncate text-xs text-fg-3">{tc(e.category)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn("block nums font-medium", e.amountCents >= 0 ? "text-gain" : "text-loss")}>
                      {formatMoney(e.amountCents, { sign: true })}
                    </span>
                    <span className="block nums text-xs text-fg-3">{money(e.balanceAfterCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {query.hasNextPage && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                state={query.isFetchingNextPage ? "loading" : "idle"}
                onClick={() => void more()}
                data-testid="accounting-more"
              >
                {t("more")}
              </Button>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function CategoryList({
  title,
  categories,
  totals,
  empty,
}: {
  title: string;
  categories: readonly LedgerCategory[];
  totals: Partial<Record<LedgerCategory, number>>;
  empty: string;
}) {
  const tc = useTranslations("listed.categories");
  const max = Math.max(1, ...categories.map((c) => Math.abs(totals[c] ?? 0)));
  return (
    <div>
      <p className="mb-2 label-pixel text-fg-3">{title}</p>
      {categories.length === 0 ? (
        <p className="text-sm text-fg-3">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {categories.map((c) => {
            const value = totals[c] ?? 0;
            return (
              <li key={c} data-category={c}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-fg-2">{tc(c)}</span>
                  <span className={cn("shrink-0 nums", value >= 0 ? "text-gain" : "text-loss")}>
                    {formatMoney(value, { whole: true, sign: true })}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-pill bg-surface-3" aria-hidden>
                  <span
                    className={cn("block h-full origin-left", value >= 0 ? "bg-gain" : "bg-loss")}
                    style={{ transform: `scaleX(${Math.abs(value) / max})` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DayRow({ day, open, onToggle }: { day: AccountingDay; open: boolean; onToggle: () => void }) {
  const t = useTranslations("hq.accounting");
  const tc = useTranslations("listed.categories");
  const net = day.inCents - day.outCents;
  const categories = LEDGER_CATEGORIES.filter((c) => (day.byCategory[c] ?? 0) !== 0);
  return (
    <li className="rounded-md bg-surface-2" data-testid="accounting-day">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          haptic("tap");
          onToggle();
        }}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-3 py-2 text-left text-sm focus-ring transition duration-fast hover:bg-surface-3 active:scale-[0.99]"
      >
        <span className="w-20 shrink-0 nums text-fg-1">{dayOnly.format(new Date(`${day.day}T12:00:00`))}</span>
        <span className="nums text-gain">{formatMoney(day.inCents, { whole: true, sign: true })}</span>
        <span className="nums text-loss">−{money(day.outCents)}</span>
        <span className={cn("ml-auto nums font-semibold", net >= 0 ? "text-gain" : "text-loss")}>
          {formatMoney(net, { whole: true, sign: true })}
        </span>
      </button>
      {open && (
        <dl className="space-y-1 border-t border-line-1 px-3 py-2">
          {categories.map((c) => (
            <Line
              key={c}
              label={tc(c)}
              value={formatMoney(day.byCategory[c] ?? 0, { whole: true, sign: true })}
              tone={(day.byCategory[c] ?? 0) >= 0 ? "gain" : "loss"}
            />
          ))}
          <Line label={t("operatingDay")} value={signed(day.operatingCents)} strong />
        </dl>
      )}
    </li>
  );
}
