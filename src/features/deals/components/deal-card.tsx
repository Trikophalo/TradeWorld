"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { COIN, CONTRACT, UI_ICONS } from "@/components/pixel/art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HoldButton } from "@/components/ui/hold-button";
import { Field } from "@/components/ui/input";
import { PlayerTag } from "@/components/ui/player-tag";
import { Progress } from "@/components/ui/progress";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { Deal, DealKind, DealParty, DealRole, DealStatus } from "@/features/game/types";
import { formatBps, formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import { loanDueCents } from "@/lib/sim/deals";
import { useDealsRefresh } from "../hooks";
import { TrustBadge } from "./trust-badge";

export const OTHER_ROLE: Record<DealRole, DealRole> = {
  lender: "borrower",
  borrower: "lender",
  supplier: "buyer",
  buyer: "supplier",
  investor: "company",
  company: "investor",
};

const KIND_ART: Record<DealKind, PixelArt> = { loan: COIN, supply: CONTRACT, stake: UI_ICONS.company };

const STATUS_TONE: Record<DealStatus, "neutral" | "accent" | "gain" | "loss" | "warn" | "info"> = {
  open: "info",
  active: "accent",
  overdue: "warn",
  defaulted: "loss",
  completed: "gain",
  forgiven: "gain",
  broken: "loss",
  cancelled: "neutral",
  declined: "neutral",
  expired: "neutral",
};

const when = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const money = (cents: number | undefined) => formatMoney(cents ?? 0, { whole: true });
const pct = (bps: number | undefined) => formatBps(bps ?? 0).replace("+", "");

/** One-line terms, e.g. "20.000 € für 3 Tage, 6 % Zinsen". */
export function useTermsText() {
  const t = useTranslations("deals");
  return (deal: Pick<Deal, "kind" | "terms">) => {
    const days = t("days", { count: Math.max(1, Math.round(deal.terms.hours / 24)) });
    if (deal.kind === "loan") {
      return t("terms.loan", { amount: money(deal.terms.principalCents), days, interest: pct(deal.terms.interestBps) });
    }
    if (deal.kind === "supply") {
      return t("terms.supply", { volume: money(deal.terms.volumeCentsPerHour), fee: pct(deal.terms.feeBps), days });
    }
    return t("terms.stake", { amount: money(deal.terms.amountCents), share: pct(deal.terms.shareBps), days });
  };
}

/** What the deal means for one side, in one sentence. */
export function useYouGetText() {
  const t = useTranslations("deals.youGet");
  return (deal: Deal, role: DealRole) => {
    const due = Number(loanDueCents(BigInt(deal.terms.principalCents ?? 0), deal.terms.interestBps ?? 0));
    const known = (role === "supplier" ? deal.buyerCompany : deal.supplierCompany)?.name;
    const company = known ?? (role === "supplier" ? t("anyoneFor") : t("anyoneWho"));
    switch (role) {
      case "lender":
      case "borrower":
        return t(role, { amount: money(deal.terms.principalCents), due: money(due) });
      case "supplier":
      case "buyer":
        return t(role, { company, fee: pct(deal.terms.feeBps) });
      case "investor":
      case "company":
        return t(role, { amount: money(deal.terms.amountCents), share: pct(deal.terms.shareBps) });
    }
  };
}

function PartyRow({ party, label }: { party: DealParty; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar avatarKey={party.avatarKey} size="xs" />
      <div className="min-w-0">
        <p className="label-pixel text-fg-3">{label}</p>
        <p className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Link
            href={`/players/${encodeURIComponent(party.nickname)}`}
            className="truncate text-sm font-medium text-fg-1 focus-ring hover:underline"
          >
            {party.nickname}
          </Link>
          <PlayerTag tag={party.tag} />
          <TrustBadge trust={party.trust} />
        </p>
      </div>
    </div>
  );
}

/**
 * One deal (ADR-098): kind, the other side with their trust, the terms in plain words, progress, and the actions
 * the viewer has in this state.
 */
export function DealCard({ deal }: { deal: Deal }) {
  const t = useTranslations("deals");
  const terms = useTermsText();
  const youGet = useYouGetText();
  const other = deal.isProposer ? deal.counterparty : deal.proposer;
  const role = deal.myRole ?? OTHER_ROLE[deal.proposerRole];
  const open = deal.status === "open";
  const running = deal.status === "active" || deal.status === "overdue" || deal.status === "defaulted";

  return (
    <Card padding="md" className="space-y-3" data-testid="deal" data-kind={deal.kind} data-status={deal.status}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xs border-2 border-line-2 bg-surface-2 text-accent"
        >
          <PixelIcon
            {...KIND_ART[deal.kind]}
            scale={Math.max(1, Math.floor(24 / KIND_ART[deal.kind].grid[0]!.length))}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-fg-1">{t(`kinds.${deal.kind}`)}</h3>
            <Badge tone={STATUS_TONE[deal.status]}>{t(`status.${deal.status}`)}</Badge>
          </div>
          <p className="mt-0.5 nums text-sm text-fg-2" data-testid="deal-terms">
            {terms(deal)}
            {deal.kind === "supply" &&
              (deal.terms.prepayBps ?? 0) > 0 &&
              ` · ${t("prepay", { amount: pct(deal.terms.prepayBps) })}`}
          </p>
        </div>
      </div>

      {other ? (
        <PartyRow party={other} label={deal.isProposer ? t("partyTo") : t("partyFrom")} />
      ) : (
        <p className="text-sm text-fg-3">{t("openOffer")}</p>
      )}

      <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-pretty text-fg-2" data-testid="deal-you-get">
        {youGet(deal, role)}
      </p>
      {deal.message && <p className="text-sm text-pretty text-fg-3 italic">„{deal.message}“</p>}

      {(running || deal.status === "completed") && <DealProgress deal={deal} />}

      <p className="nums text-xs text-fg-3">
        {open && deal.expiresAt
          ? t("validUntil", { date: when.format(new Date(deal.expiresAt)) })
          : deal.endsAt && running
            ? t("until", { date: when.format(new Date(deal.endsAt)) })
            : null}
      </p>

      <DealActions deal={deal} role={role} />
    </Card>
  );
}

function DealProgress({ deal }: { deal: Deal }) {
  const t = useTranslations("deals.progress");
  const p = deal.progress;
  if (deal.kind === "loan") {
    const due = p.dueCents ?? 0;
    return (
      <div>
        <Progress
          value={due > 0 ? (p.repaidCents ?? 0) / due : 0}
          label={t("loan", { repaid: money(p.repaidCents), due: money(due) })}
          size="sm"
          tone="gain"
        />
        <p className="mt-1 nums text-xs text-fg-3">{t("loan", { repaid: money(p.repaidCents), due: money(due) })}</p>
      </div>
    );
  }
  if (deal.kind === "supply") {
    return (
      <div className="space-y-0.5 nums text-xs text-fg-3">
        <p>
          {t("supply", {
            delivered: money(p.deliveredCents),
            needed: money(p.neededCents),
            fees: money(p.feesPaidCents),
          })}
        </p>
        {(p.prepayLeftCents ?? 0) > 0 && <p>{t("prepayLeft", { amount: money(p.prepayLeftCents) })}</p>}
      </div>
    );
  }
  return <p className="nums text-xs text-gain">{t("stake", { payouts: money(p.payoutsCents) })}</p>;
}

function DealActions({ deal, role }: { deal: Deal; role: DealRole }) {
  const t = useTranslations("deals");
  const errorText = useGameErrorText();
  const refresh = useDealsRefresh();
  const [busy, setBusy] = useState(false);
  const [breaking, setBreaking] = useState(false);
  const [repaying, setRepaying] = useState(false);
  const running = deal.status === "active" || deal.status === "overdue" || deal.status === "defaulted";

  const act = async (run: () => Promise<Deal>, done: string, sound: "coin" | "tap" | "warning" = "tap") => {
    setBusy(true);
    try {
      await run();
      void playSound(sound);
      haptic(sound === "warning" ? "warning" : "success");
      toast.success(done);
      await refresh();
    } catch (error) {
      toast.error(t("toasts.failed"), errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const id = () => crypto.randomUUID();

  if (deal.status === "open") {
    if (deal.isProposer) {
      return (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void act(() => engine.cancelDeal(id(), deal.id), t("toasts.cancelled"))}
          >
            {t("actions.cancel")}
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <HoldButton
          tone="gain"
          disabled={busy}
          className="w-full"
          onConfirm={() => void act(() => engine.respondDeal(id(), deal.id, true), t("toasts.accepted"), "coin")}
        >
          <span data-testid="deal-accept">{t("actions.accept")}</span>
        </HoldButton>
        {deal.counterparty !== null && (
          <Button
            size="sm"
            variant="ghost"
            block
            disabled={busy}
            onClick={() => void act(() => engine.respondDeal(id(), deal.id, false), t("toasts.declined"))}
          >
            {t("actions.decline")}
          </Button>
        )}
      </div>
    );
  }

  if (!running) return null;

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {deal.kind === "loan" && role === "borrower" && (
        <Button size="sm" disabled={busy} onClick={() => setRepaying(true)} data-testid="deal-repay">
          {t("actions.repay")}
        </Button>
      )}
      {deal.kind === "loan" && role === "lender" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void act(() => engine.forgiveLoan(id(), deal.id), t("toasts.forgiven"))}
        >
          {t("actions.forgive")}
        </Button>
      )}
      {(deal.kind === "supply" || (deal.kind === "stake" && role === "company")) && deal.status === "active" && (
        <Button size="sm" variant="danger" disabled={busy} onClick={() => setBreaking(true)} data-testid="deal-break">
          {t("actions.break")}
        </Button>
      )}
      <Sheet open={breaking} onOpenChange={setBreaking} title={t("breakTitle")}>
        <div className="space-y-4">
          <p className="text-sm text-pretty text-fg-2">
            {t("breakText", { points: Math.abs(BALANCE.trust.deltas.dealBroken) })}{" "}
            {deal.kind === "supply" ? t("breakSupply") : t("breakStake")}
          </p>
          <HoldButton
            tone="loss"
            className="w-full"
            onConfirm={() => {
              setBreaking(false);
              void act(() => engine.breakDeal(id(), deal.id), t("toasts.broken"), "warning");
            }}
          >
            {t("breakConfirm")}
          </HoldButton>
        </div>
      </Sheet>
      {deal.kind === "loan" && role === "borrower" && (
        <RepaySheet
          deal={deal}
          open={repaying}
          onOpenChange={setRepaying}
          onRepay={(cents) => {
            setRepaying(false);
            void act(() => engine.repayLoan(id(), deal.id, cents), t("toasts.repaid"), "coin");
          }}
        />
      )}
    </div>
  );
}

function RepaySheet({
  deal,
  open,
  onOpenChange,
  onRepay,
}: {
  deal: Deal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRepay: (cents: number) => void;
}) {
  const t = useTranslations("deals");
  const left = deal.progress.leftCents ?? 0;
  const [euros, setEuros] = useState("");
  const cents = Math.round(Number(euros.replace(",", ".")) * 100);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("repayTitle")}>
      <div className="space-y-4">
        <Button block onClick={() => onRepay(left)} disabled={left <= 0} data-testid="deal-repay-all">
          {t("actions.repayAll", { amount: formatMoney(left) })}
        </Button>
        <Field label={t("repayAmount")} inputMode="decimal" value={euros} onChange={(e) => setEuros(e.target.value)} />
        <Button block variant="secondary" disabled={!(cents > 0)} onClick={() => onRepay(Math.min(cents, left))}>
          {t("actions.repay")}
        </Button>
      </div>
    </Sheet>
  );
}
