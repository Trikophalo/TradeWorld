"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useMyCompany } from "@/features/company/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { Deal, DealKind, DealRole, DealTerms } from "@/features/game/types";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { loanTermsError, maxLoanPrincipalCents, stakeTermsError, supplyTermsError } from "@/lib/sim/deals";
import { priceEffect } from "@/lib/sim/startup";
import { useDealsRefresh } from "../hooks";
import { useYouGetText } from "./deal-card";

const ROLES: Record<DealKind, readonly [DealRole, DealRole]> = {
  loan: ["lender", "borrower"],
  supply: ["buyer", "supplier"],
  stake: ["investor", "company"],
};
const DAYS = ["1", "3", "7", "14", "30"] as const;
const COMPANY_ROLES: readonly DealRole[] = ["supplier", "buyer", "company"];

const toCents = (euros: string) => Math.round(Number(euros.replace(/\./g, "").replace(",", ".")) * 100);
const toBps = (percent: string) => Math.round(Number(percent.replace(",", ".")) * 100);

/**
 * A new deal (ADR-098): kind, side, partner (or the open board), terms with their limits, and a live sentence of
 * what the deal means. Sending needs a short hold.
 */
export function DealForm({ onSent }: { onSent: () => void }) {
  const t = useTranslations("deals");
  const errorText = useGameErrorText();
  const refresh = useDealsRefresh();
  const youGet = useYouGetText();
  const level = useGame((s) => s.portfolio?.level ?? 1);
  const company = useMyCompany().data?.company ?? null;
  const [kind, setKind] = useState<DealKind>("loan");
  const [role, setRole] = useState<DealRole>("lender");
  const [partner, setPartner] = useState("");
  const [amount, setAmount] = useState("5000");
  const [percent, setPercent] = useState("5");
  const [prepay, setPrepay] = useState("0");
  const [days, setDays] = useState<(typeof DAYS)[number]>("3");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const hours = Number(days) * 24;
  const terms: DealTerms =
    kind === "loan"
      ? { principalCents: toCents(amount), interestBps: toBps(percent), hours }
      : kind === "supply"
        ? { volumeCentsPerHour: toCents(amount), feeBps: toBps(percent), prepayBps: toBps(prepay), hours }
        : { amountCents: toCents(amount), shareBps: toBps(percent), hours };
  const termsError =
    kind === "loan"
      ? loanTermsError(
          { principalCents: terms.principalCents!, interestBps: terms.interestBps!, hours },
          role === "lender" ? level : 9_999,
        )
      : kind === "supply"
        ? supplyTermsError({
            volumeCentsPerHour: terms.volumeCentsPerHour!,
            feeBps: terms.feeBps!,
            prepayBps: terms.prepayBps!,
            hours,
          })
        : stakeTermsError({ amountCents: terms.amountCents!, shareBps: terms.shareBps!, hours });
  const needsCompany = COMPANY_ROLES.includes(role) && !company;
  const locked = level < BALANCE.deals.minLevel;

  const preview: Deal = {
    id: "preview",
    kind,
    status: "open",
    myRole: role,
    proposerRole: role,
    isProposer: true,
    proposer: { nickname: "", tag: null, avatarKey: "rookie", level, trust: { score: 50, band: "blank" } },
    counterparty: null,
    // The partner's company is unknown before the deal: the sentence names "another player".
    supplierCompany: role === "supplier" && company ? { id: company.id, name: company.name } : null,
    buyerCompany: role === "buyer" && company ? { id: company.id, name: company.name } : null,
    company: null,
    terms,
    message: null,
    createdAt: "",
    expiresAt: null,
    acceptedAt: null,
    endsAt: null,
    closedAt: null,
    progress: {},
    brokenByMe: false,
  };

  // Supply: my margin per unit as a share of the price.
  const margin =
    kind === "supply" && company
      ? role === "supplier"
        ? (terms.feeBps ?? 0) / 10_000 - (1 - BALANCE.startups.grossMargin[company.sector])
        : priceEffect(company.priceLevel, company.qualityBps / 10_000).price - (terms.feeBps ?? 0) / 10_000
      : null;

  const changeKind = (next: DealKind) => {
    setKind(next);
    setRole(ROLES[next][0]);
    if (next === "loan") {
      setAmount("5000");
      setPercent("5");
    } else if (next === "supply") {
      setAmount("500");
      setPercent("60");
      setPrepay("0");
    } else {
      setAmount("10000");
      setPercent("10");
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      const deal = await engine.proposeDeal({
        requestId: crypto.randomUUID(),
        kind,
        role,
        counterparty: partner.trim() || null,
        terms,
        message,
      });
      if (deal.status === "declined") {
        toast.info(t("toasts.declined"), t("toasts.theyDeclined", { name: deal.counterparty?.nickname ?? partner }));
      } else if (deal.status === "active") {
        void playSound("coin");
        haptic("success");
        toast.success(t("toasts.accepted"));
      } else {
        void playSound("success");
        toast.success(t("toasts.proposed"), partner.trim() ? undefined : t("toasts.proposedOpen"));
      }
      await refresh();
      onSent();
    } catch (error) {
      toast.error(t("toasts.failed"), errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="lg" className="space-y-5" data-testid="deal-form">
      <div className="space-y-2">
        <p className="label-pixel text-fg-2">{t("form.kind")}</p>
        <Segmented
          value={kind}
          onValueChange={changeKind}
          options={(["loan", "supply", "stake"] as const).map((value) => ({ value, label: t(`kinds.${value}`) }))}
          label={t("form.kind")}
          block
        />
        <p className="text-sm text-pretty text-fg-3">{t(`kindText.${kind}`)}</p>
      </div>
      <div className="space-y-2">
        <p className="label-pixel text-fg-2">{t("form.role")}</p>
        <Segmented
          value={role}
          onValueChange={setRole}
          options={ROLES[kind].map((value) => ({ value, label: t(`roles.${value}`) }))}
          label={t("form.role")}
          block
        />
        {needsCompany && <p className="text-sm text-warn">{t("form.needsCompany")}</p>}
      </div>

      <Field
        label={t("form.counterparty")}
        hint={t("form.counterpartyHint")}
        value={partner}
        onChange={(e) => setPartner(e.target.value)}
        maxLength={24}
        autoComplete="off"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={kind === "supply" ? t("form.volume") : t("form.amount")}
          hint={kind === "supply" ? t("form.volumeHint") : undefined}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Field
          label={kind === "loan" ? t("form.interest") : kind === "supply" ? t("form.fee") : t("form.share")}
          inputMode="decimal"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
        />
        {kind === "supply" && (
          <Field
            label={t("form.prepay")}
            inputMode="decimal"
            value={prepay}
            onChange={(e) => setPrepay(e.target.value)}
          />
        )}
      </div>
      <div className="space-y-2">
        <p className="label-pixel text-fg-2">{t("form.daysLabel")}</p>
        <Segmented
          value={days}
          onValueChange={setDays}
          options={DAYS.filter((d) => kind !== "supply" || d !== "30").map((value) => ({ value, label: value }))}
          label={t("form.daysLabel")}
          size="sm"
          block
        />
      </div>
      {kind === "loan" && (
        <p className="nums text-xs text-fg-3">
          {t("form.limits", { max: formatMoney(maxLoanPrincipalCents(level), { whole: true }) })}
        </p>
      )}

      <Field label={t("form.message")} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={140} />

      <section className="space-y-2 rounded-md bg-surface-2 px-3 py-3" data-testid="deal-preview">
        <p className="label-pixel text-fg-3">{t("form.summary")}</p>
        <p className="text-sm text-pretty text-fg-1">{youGet(preview, role)}</p>
        {margin !== null && (
          <p className={margin >= 0 ? "nums text-xs text-gain" : "nums text-xs text-loss"}>
            {margin >= 0
              ? t("form.myMargin", { margin: formatBps(Math.round(margin * 10_000)).replace("+", "") })
              : t("form.myMarginLoss", { margin: formatBps(Math.round(-margin * 10_000)).replace("+", "") })}
          </p>
        )}
        {kind === "supply" && <p className="text-xs text-pretty text-fg-3">{t("form.marginsHint")}</p>}
        {termsError && <p className="text-xs text-warn">{t("form.invalid")}</p>}
      </section>

      <HoldButton
        tone="accent"
        className="w-full"
        disabled={busy || locked || needsCompany || termsError !== null}
        onConfirm={() => void send()}
      >
        <span data-testid="deal-submit">{t("form.submit")}</span>
      </HoldButton>
    </Card>
  );
}
