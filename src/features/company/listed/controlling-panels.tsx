"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { BALANCE } from "@/config/balance";
import { LEDGER_CATEGORIES } from "@/config/listed";
import type { ListedCompany, ListedRestrictions } from "@/features/game/listed-types";
import { useServerClock } from "@/features/game/server-clock";
import { engine } from "@/features/game/store";
import { parseEuroCents } from "@/features/market/order-schema";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Line, money, Panel, ServerCountdown, Stat, useListedAction } from "./shared";
import { upkeepShareBps } from "./view";

const day = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Running costs of everything the company has bought, against the revenue the prices follow. */
export function UpkeepSummary({ listed }: { listed: ListedCompany }) {
  const t = useTranslations("hq.controlling");
  const tc = useTranslations("listed.categories");
  const share = upkeepShareBps(listed.upkeepPerHourCents, listed.refRevenueCents);
  const rows = LEDGER_CATEGORIES.filter((c) => (listed.upkeep[c] ?? 0) !== 0);
  const active = listed.items.filter((i) => i.status === "active" && i.kind !== "action").length;
  const running = listed.items.filter((i) => i.status === "running").length;
  const paused = listed.items.filter((i) => i.status === "paused").length;
  return (
    <Panel title={t("upkeepTitle")} testId="upkeep-summary">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("upkeepHour")} tone={share > 2_500 ? "warn" : undefined} testId="upkeep-total">
          {money(listed.upkeepPerHourCents)}
        </Stat>
        <Stat label={t("refRevenue")} hint={t("refRevenueHint")}>
          {money(listed.refRevenueCents)}
        </Stat>
        <Stat label={t("upkeepShare")} tone={share > 2_500 ? "warn" : undefined}>
          {formatBps(share).replace("+", "")}
        </Stat>
        <Stat
          label={t("itemsActive")}
          hint={t("itemsDetail", { running, paused })}
          tone={paused > 0 ? "warn" : undefined}
        >
          {active}
        </Stat>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-pill bg-surface-3"
        role="meter"
        aria-label={t("upkeepShare")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(share / 100))}
      >
        <span
          className={cn("block h-full origin-left", share > 2_500 ? "bg-warn" : "bg-accent")}
          style={{ transform: `scaleX(${Math.min(1, share / 10_000)})` }}
        />
      </div>
      {rows.length > 0 ? (
        <dl className="space-y-1">
          {rows.map((c) => (
            <Line
              key={c}
              label={tc(c)}
              value={t("perHour", { amount: formatMoney(Math.abs(listed.upkeep[c] ?? 0)) })}
            />
          ))}
        </dl>
      ) : (
        <p className="text-sm text-pretty text-fg-3">{t("upkeepNone")}</p>
      )}
      <p className="text-xs text-pretty text-fg-3">{t("upkeepHint")}</p>
    </Panel>
  );
}

/** What the board has decided and how long it binds the founder. */
export function RestrictionNotes({
  restrictions,
  only,
}: {
  restrictions: ListedRestrictions;
  only?: ("payout" | "withdraw" | "price")[];
}) {
  const t = useTranslations("hq.restrictions");
  const tp = useTranslations("firm");
  const now = useServerClock();
  const live = (until: string | null): until is string => until !== null && (now === null || Date.parse(until) > now);
  const show = (kind: "payout" | "withdraw" | "price") => !only || only.includes(kind);
  const notes: { key: string; text: string; until: string }[] = [];
  if (show("payout") && restrictions.payoutCapBps !== null && live(restrictions.payoutCapUntil)) {
    notes.push({
      key: "payout",
      text: t("payoutCap", { percent: Math.round(restrictions.payoutCapBps / 100) }),
      until: restrictions.payoutCapUntil,
    });
  }
  if (show("withdraw") && live(restrictions.withdrawBlockUntil)) {
    notes.push({ key: "withdraw", text: t("withdrawBan"), until: restrictions.withdrawBlockUntil });
  }
  if (show("price") && restrictions.priceLock !== null && live(restrictions.priceLockUntil)) {
    notes.push({
      key: "price",
      text: t("priceLock", { level: tp(`strategy.levels.${restrictions.priceLock}`) }),
      until: restrictions.priceLockUntil,
    });
  }
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1.5" data-testid="restrictions">
      {notes.map((n) => (
        <li
          key={n.key}
          data-restriction={n.key}
          className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          <span className="min-w-0 text-pretty">{n.text}</span>
          <span className="nums text-xs">
            {t("left")} <ServerCountdown at={n.until} className="font-semibold" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Dividends: the founder shares the free cash with all shareholders, at most once a day. */
export function DividendCard({ listed }: { listed: ListedCompany }) {
  const t = useTranslations("hq.dividends");
  const d = listed.dividends;
  const action = useListedAction();
  const [text, setText] = useState("");
  const cents = parseEuroCents(text) ?? 0;
  const tooLow = cents > 0 && cents < d.minCents;
  const tooHigh = cents > d.maxCents;
  const founderCut = Math.floor((cents * d.founderShareBps) / 10_000);
  const rules = BALANCE.listed.reputation.dividend;

  const declare = async () => {
    if (!cents || tooLow || tooHigh) return;
    const ok = await action.run("dividend", () => engine.declareDividend(crypto.randomUUID(), cents), {
      title: t("title"),
      done: t("declared"),
      detail: formatMoney(cents, { whole: true }),
    });
    if (ok) setText("");
  };

  return (
    <Panel
      title={t("title")}
      testId="dividends"
      aside={
        d.streak > 0 ? (
          <Badge tone="gain" data-testid="dividend-streak">
            {t("streak", { count: d.streak })}
          </Badge>
        ) : undefined
      }
    >
      <p className="text-sm text-pretty text-fg-2">
        {t("intro", { percent: Math.round(rules.fullRatioBps / 100), gain: rules.maxGain })}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={t("max")} testId="dividend-max">
          {money(d.maxCents)}
        </Stat>
        <Stat label={t("min")}>{money(d.minCents)}</Stat>
        <Stat label={t("founderShare")} className="col-span-2 sm:col-span-1">
          {formatBps(d.founderShareBps).replace("+", "")}
        </Stat>
      </div>
      {d.canDeclare ? (
        <div className="space-y-3">
          <Field
            label={t("amount")}
            inputMode="decimal"
            value={text}
            onChange={(event) => setText(event.target.value)}
            error={
              tooHigh
                ? t("tooHigh", { amount: money(d.maxCents) })
                : tooLow
                  ? t("tooLow", { amount: money(d.minCents) })
                  : undefined
            }
            hint={cents > 0 && !tooHigh && !tooLow ? t("yourCut", { amount: money(founderCut) }) : undefined}
          />
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["min", d.minCents],
                ["quarter", Math.floor(d.maxCents / 4 / 100) * 100],
                ["half", Math.floor(d.maxCents / 2 / 100) * 100],
                ["max", Math.floor(d.maxCents / 100) * 100],
              ] as const
            ).map(([key, value]) => (
              <button
                key={key}
                type="button"
                disabled={value < d.minCents || value > d.maxCents}
                onClick={() => {
                  haptic("tap");
                  setText(String(value / 100).replace(".", ","));
                }}
                className="rounded-pill border border-line-1 px-3 py-1.5 text-xs text-fg-2 focus-ring transition duration-fast hover:border-accent hover:text-fg-1 active:scale-95 disabled:opacity-40"
              >
                {t(`quick.${key}`)}
              </button>
            ))}
          </div>
          <Button
            state={action.state("dividend")}
            disabled={!cents || tooLow || tooHigh}
            onClick={() => void declare()}
            data-testid="dividend-declare"
          >
            {cents > 0 && !tooLow && !tooHigh ? t("declareAmount", { amount: money(cents) }) : t("declare")}
          </Button>
        </div>
      ) : (
        <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm text-pretty text-fg-3" data-testid="dividend-locked">
          {t(d.maxCents < d.minCents ? "lockedCash" : "lockedToday")}
        </p>
      )}
      <div>
        <p className="mb-1.5 label-pixel text-fg-3">{t("history")}</p>
        {d.last.length === 0 ? (
          <p className="text-sm text-fg-3">{t("historyEmpty")}</p>
        ) : (
          <ul className="space-y-1" data-testid="dividend-history">
            {d.last.slice(0, 8).map((x) => (
              <li key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="nums text-fg-3">{day.format(new Date(x.paidAt))}</span>
                <span className="text-xs text-fg-3">
                  {t(x.source === "board" ? "byBoard" : "byFounder")} · {t("holders", { count: x.holders })}
                </span>
                <span className="ml-auto nums font-medium text-fg-1">{money(x.totalCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
