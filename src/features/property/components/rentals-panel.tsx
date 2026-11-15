"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { PlayerFigure } from "@/components/ui/player-figure";
import { Segmented } from "@/components/ui/segmented";
import { Field } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { TILE } from "@/config/furniture";
import { useGameErrorText } from "@/features/game/errors";
import { parseEuroCents } from "@/features/market/order-schema";
import { engine } from "@/features/game/store";
import type { OwnTenancy, RentalsState, RentPeriodKey } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { aiTenantChanceBps, demandLevel, hourlyPrice } from "@/lib/sim/rentals";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { useFitScale, usePropertyRefresh, useRentals } from "../hooks";
import { tenantLook } from "../tenants";
import { RoomView } from "./room-view";
import { WohnwertMeter } from "./wohnwert-meter";

const REASONS = ["notice_tenant", "notice_owner", "unpaid", "ai_left", "ai_unhappy", "account_reset"] as const;
type Reason = (typeof REASONS)[number];

/** Quick picks as a share of the fair rent (bps); the owner may type any price (ADR-161). */
const QUICK = [
  { key: "half", bps: 5_000 },
  { key: "fair", bps: 10_000 },
  { key: "more", bps: 15_000 },
  { key: "double", bps: 20_000 },
] as const;

/** Cents as an editable euro amount ("41,40"). */
const euros = (cents: number) =>
  (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/** A quick pick: a share of the fair rent, inside the allowed range. */
function quickPrice(fairCents: number, bps: number, min: number, max: number): number {
  const raw = Math.round((fairCents * bps) / 10_000);
  return Math.min(max, Math.max(min, raw));
}

/**
 * Renting out places in the own home (ADR-158): the Wohnwert, the offer (per hour or per day, the price set freely by
 * the owner, ADR-161), the AI demand it creates, the tenants with notice, and what came in.
 */
export function RentalsPanel() {
  const t = useTranslations("rentals");
  const state = useRentals();
  if (!state.data) return <Skeleton className="h-72 w-full rounded-lg" />;
  const r = state.data;
  return (
    <div className="space-y-5" data-testid="rentals-panel">
      {r.home && <OfferCard rentals={r} />}
      {r.renting && <RentingCard rentals={r} />}
      {!r.renting && (
        <Card padding="md" className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-fg-1">{t("marketTitle")}</p>
            <p className="text-sm text-pretty text-fg-2">{t(r.home ? "marketTeaser" : "marketTeaserNoHome")}</p>
          </div>
          <Link
            href="/property/rentals"
            className={buttonVariants({ variant: "secondary" })}
            data-testid="open-rental-market"
          >
            {t("openMarket")}
          </Link>
        </Card>
      )}
    </div>
  );
}

function OfferCard({ rentals }: { rentals: RentalsState }) {
  const t = useTranslations("rentals");
  const errorText = useGameErrorText();
  const refresh = usePropertyRefresh();
  const home = rentals.home!;
  const offer = rentals.offer;
  const [period, setPeriod] = useState<RentPeriodKey>(offer?.period ?? "hour");
  const limits = home.limits[period];
  const initialText = (p: RentPeriodKey) => {
    const l = home.limits[p];
    return euros(offer && offer.period === p ? offer.priceCents : Math.max(l.minCents, l.fairCents));
  };
  const [text, setText] = useState(() => initialText(period));
  const [state, setState] = useState<ButtonState>("idle");
  const parsed = parseEuroCents(text);
  const valid = parsed !== null && parsed >= limits.minCents && parsed <= limits.maxCents;
  const price = valid ? parsed : limits.minCents;
  const chance = valid ? aiTenantChanceBps(home.tier, home.wohnwert.total, hourlyPrice(price, period)) : 0;
  const demand = demandLevel(chance);
  const open = offer?.isOpen ?? false;
  const changed = !offer || offer.period !== period || offer.priceCents !== price;

  const submit = async (nextOpen: boolean) => {
    setState("loading");
    try {
      await engine.setRentalOffer(crypto.randomUUID(), period, price, nextOpen);
      setState("success");
      haptic("success");
      void playSound(nextOpen ? "coin" : "tap");
      toast.success(nextOpen ? t("offered") : t("closed"), undefined, { silent: true });
      await refresh();
      window.setTimeout(() => setState("idle"), 600);
    } catch (error) {
      setState("idle");
      toast.error(t("offerTitle"), errorText(error));
    }
  };

  return (
    <Card padding="lg" className="space-y-5" data-testid="rental-offer">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-pixel text-sm text-fg-1 uppercase">{t("offerTitle")}</h2>
        <Badge tone={open ? "gain" : "neutral"} data-testid="offer-status">
          {open ? t("statusOpen") : offer ? t("statusClosed") : t("statusNone")}
        </Badge>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <WohnwertMeter wohnwert={home.wohnwert} />
        <div className="space-y-4">
          <p className="text-sm text-pretty text-fg-2">{t("offerIntro", { places: home.places })}</p>
          <Segmented
            value={period}
            onValueChange={(p) => {
              setPeriod(p);
              setText(initialText(p));
            }}
            options={BALANCE.rentals.periods.map((p) => ({ value: p, label: t(`periods.${p}`) }))}
            label={t("periodLabel")}
            size="sm"
            block
          />
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-40 flex-1">
                <Field
                  label={t("priceInput")}
                  inputMode="decimal"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  error={
                    valid
                      ? undefined
                      : t("priceInvalid", { min: formatMoney(limits.minCents), max: formatMoney(limits.maxCents) })
                  }
                  data-testid="offer-price-input"
                />
              </div>
              <span className="pb-3 nums text-lg font-semibold text-fg-1" data-testid="offer-price">
                {formatMoney(price)} <span className="text-sm font-normal text-fg-3">{t(`per.${period}`)}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("quickLabel")}>
              {QUICK.map((q) => {
                const cents = quickPrice(limits.fairCents, q.bps, limits.minCents, limits.maxCents);
                return (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => setText(euros(cents))}
                    aria-pressed={valid && price === cents}
                    className={cn(
                      "rounded-pill px-3 py-1.5 nums text-xs focus-ring transition duration-fast active:scale-95",
                      valid && price === cents ? "bg-accent text-on-accent" : "bg-surface-2 text-fg-2 hover:text-fg-1",
                    )}
                    data-testid={`offer-quick-${q.key}`}
                  >
                    {q.key === "fair" ? t("fair", { amount: formatMoney(cents) }) : t(`quick.${q.key}`)}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-pretty text-fg-3">{t("priceFree", { min: formatMoney(limits.minCents) })}</p>
          </div>
          <p className="text-sm text-fg-2" data-testid="ai-demand" data-demand={demand}>
            {t("demandLabel")}{" "}
            <span
              className={cn(
                "font-semibold",
                demand === "high" ? "text-gain" : demand === "none" ? "text-loss" : "text-fg-1",
              )}
            >
              {t(`demand.${demand}`)}
            </span>
            {demand === "none" && ` · ${t("demandNone", { min: BALANCE.rentals.ai.minWohnwert })}`}
          </p>
          <div className="flex flex-wrap gap-2">
            {(!open || changed) && (
              <Button state={state} disabled={!valid} onClick={() => void submit(true)} data-testid="offer-submit">
                {open ? t("savePrice") : t("offer")}
              </Button>
            )}
            {open && (
              <Button variant="ghost" onClick={() => void submit(false)} data-testid="offer-close">
                {t("close")}
              </Button>
            )}
          </div>
        </div>
      </div>
      <Tenants rentals={rentals} />
    </Card>
  );
}

function Tenants({ rentals }: { rentals: RentalsState }) {
  const t = useTranslations("rentals");
  const home = rentals.home!;
  return (
    <div className="space-y-3 border-t-2 border-line-1 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-pixel text-fg-2">
          {t("tenantsTitle", { count: rentals.tenants.length, places: home.places })}
        </p>
        <p className="nums text-xs text-fg-3" data-testid="rent-earned">
          {t("earned", {
            week: formatMoney(rentals.earned7dCents, { whole: true }),
            total: formatMoney(rentals.earnedTotalCents, { whole: true }),
          })}
        </p>
      </div>
      {rentals.tenants.length === 0 ? (
        <p className="text-sm text-pretty text-fg-3">{t(rentals.offer?.isOpen ? "waiting" : "noTenants")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="tenant-list">
          {rentals.tenants.map((x) => (
            <TenantRow key={x.id} tenancy={x} />
          ))}
        </ul>
      )}
      {rentals.past.length > 0 && (
        <details className="text-xs text-fg-3">
          <summary className="cursor-pointer rounded-xs focus-ring">{t("pastTitle")}</summary>
          <ul className="mt-2 space-y-1">
            {rentals.past.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {p.name} ·{" "}
                  {t(`reasons.${(REASONS.includes(p.endReason as Reason) ? p.endReason : "ai_left") as Reason}`)}
                </span>
                <span className="shrink-0 nums">{formatMoney(p.paidCents, { whole: true })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TenantRow({ tenancy }: { tenancy: OwnTenancy }) {
  const t = useTranslations("rentals");
  const errorText = useGameErrorText();
  const refresh = usePropertyRefresh();
  const [busy, setBusy] = useState(false);
  const look = tenantLook(tenancy);
  const notice = async () => {
    setBusy(true);
    try {
      await engine.endTenancy(crypto.randomUUID(), tenancy.id);
      toast.success(t("noticeGiven", { name: tenancy.name }), undefined, { silent: true });
      await refresh();
    } catch (error) {
      toast.error(t("notice"), errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li
      className="flex items-center gap-3 rounded-md bg-surface-2 p-2"
      data-testid="tenant-row"
      data-ai={tenancy.isAi ? "true" : "false"}
    >
      <span className="grid h-16 w-12 shrink-0 place-items-end justify-center overflow-hidden rounded-sm bg-surface-3">
        <PlayerFigure avatarKey={look.avatarKey} accessories={look.accessories} scale={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-fg-1">
          {tenancy.isAi ? (
            tenancy.name
          ) : (
            <Link
              href={`/players/${encodeURIComponent(tenancy.name)}`}
              className="rounded-xs focus-ring hover:underline"
            >
              {tenancy.name}
            </Link>
          )}
        </p>
        <p className="text-xs text-fg-3">
          <Badge tone={tenancy.isAi ? "neutral" : "accent"} className="mr-1">
            {tenancy.isAi ? t("ai") : t("player")}
          </Badge>
          <span className="nums">
            {formatMoney(tenancy.priceCents)} {t(`per.${tenancy.period}`)}
          </span>
        </p>
        {tenancy.endsAt && (
          <p className="text-2xs text-fg-3">
            {t("endsIn")} <Countdown target={Date.parse(tenancy.endsAt)} />
          </p>
        )}
      </div>
      {!tenancy.noticeBy && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void notice()}>
          {t("notice")}
        </Button>
      )}
    </li>
  );
}

/** Where the player lives as a tenant: the room with everyone in it, the rent, notice. */
function RentingCard({ rentals }: { rentals: RentalsState }) {
  const t = useTranslations("rentals");
  const te = useTranslations("estate");
  const errorText = useGameErrorText();
  const refresh = usePropertyRefresh();
  const r = rentals.renting!;
  const [busy, setBusy] = useState(false);
  const { ref, scale } = useFitScale(r.property.width * TILE, 3);
  const notice = async () => {
    setBusy(true);
    try {
      await engine.endTenancy(crypto.randomUUID(), r.id);
      toast.success(t("noticeOwn"), undefined, { silent: true });
      await refresh();
    } catch (error) {
      toast.error(t("notice"), errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card padding="lg" className="space-y-4" data-testid="renting-card">
      <div className="flex flex-wrap items-center gap-3">
        <PlayerFigure avatarKey={r.ownerAvatarKey} accessories={r.ownerAccessories} scale={2} />
        <div className="min-w-0 flex-1">
          <p className="label-pixel text-fg-3">{t("rentingKicker")}</p>
          <p className="text-lg font-semibold text-fg-1">
            {t("rentingTitle", { tier: r.tier ? te(`tierNames.${r.tier}`) : "", owner: r.owner })}
          </p>
          <p className="nums text-xs text-fg-3">
            {formatMoney(r.priceCents)} {t(`per.${r.period}`)} · {t("wohnwertShort", { value: r.wohnwert })} ·{" "}
            {t("xpSoFar", { xp: r.xpTotal })}
          </p>
        </div>
        {r.noticeBy ? (
          r.endsAt && (
            <p className="text-xs text-fg-3">
              {t("endsIn")} <Countdown target={Date.parse(r.endsAt)} />
            </p>
          )
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void notice()} data-testid="renting-notice">
            {t("notice")}
          </Button>
        )}
      </div>
      <div ref={ref} className="w-full">
        <RoomView property={r.property} scale={scale} tenants={r.tenants} />
      </div>
      <p className="text-xs text-pretty text-fg-3">{t("rentingHint")}</p>
    </Card>
  );
}
