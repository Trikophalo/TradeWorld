"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { Field } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Sheet } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useMyJob } from "@/features/career/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { MyCompany, Offer } from "@/features/game/types";
import { CompanyLogo } from "@/features/market/components/company-logo";
import { parseEuroCents } from "@/features/market/order-schema";
import { formatMoney, formatPrice, formatShares } from "@/lib/format";
import { issuePriceCents } from "@/lib/sim/startup";
import { playSound } from "@/lib/sound";
import { useCompanyRefresh } from "../hooks";
import { useVisitTour } from "@/features/tutorial/use-visit-tour";
import { useProductText } from "../product-name";

const ipo = BALANCE.startups.ipo;
const money = (cents: number) => formatMoney(cents, { whole: true });

/** Founder with a job elsewhere (ADR-066): half productivity, full time from 5 employees. */
export function SideJobNotice({ company }: { company: MyCompany }) {
  const t = useTranslations("listing");
  const job = useMyJob();
  if (!company.founderHasJob || !job.data) return null;
  const left = Math.max(0, company.fullTimeFrom - company.headcount);
  return (
    <p className="rounded-md bg-info-soft px-4 py-3 text-sm text-pretty text-info" data-testid="side-job">
      {left > 0
        ? t("sideJob", { company: job.data.company.name, left, from: company.fullTimeFrom })
        : t("fullTime", { company: job.data.company.name })}
    </p>
  );
}

/** Going public, subscription status, listed stock and capital increases (ADR-067). */
export function ListingCard({ company }: { company: MyCompany }) {
  const t = useTranslations("listing");
  const [sheet, setSheet] = useState<"ipo" | "increase" | null>(null);
  const listing = company.listing;
  useVisitTour("visit_listing", Boolean(listing) || company.canGoPublic);
  if (!listing && !company.canGoPublic) {
    if (!(ipo.fromTiers as readonly string[]).includes(company.tier)) return null;
    return (
      <Card padding="md">
        <p className="label-pixel text-fg-2">{t("title")}</p>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("lockedHint", { level: ipo.minLevel })}</p>
      </Card>
    );
  }
  return (
    <Card padding="lg" className="space-y-3" data-testid="listing" data-tour="listing">
      <p className="label-pixel text-fg-2">{t("title")}</p>
      {!listing && (
        <>
          <p className="text-sm text-pretty text-fg-2">{t("intro")}</p>
          <Button onClick={() => setSheet("ipo")}>{t("goPublic")}</Button>
        </>
      )}
      {listing?.offer && <OfferProgress offer={listing.offer} />}
      {listing?.status === "listed" && (
        <div className="space-y-2">
          <p className="text-sm text-fg-1">
            {t("listed", { ticker: listing.ticker ?? "" })}
            {listing.lastPriceE4 !== null && <span className="ml-2 nums">{formatPrice(listing.lastPriceE4)}</span>}
          </p>
          <p className="nums text-xs text-fg-3">
            {t("founderShares", {
              shares: formatShares(listing.founderSharesE6),
              percent: Math.round((100 * listing.founderSharesE6) / Math.max(1, listing.sharesTotalE6)),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            {listing.ticker && (
              <Link
                href={`/markets/${listing.ticker}`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {t("toStock")}
              </Link>
            )}
            {company.canCapitalIncrease && (
              <Button size="sm" onClick={() => setSheet("increase")}>
                {t("capitalIncrease")}
              </Button>
            )}
          </div>
        </div>
      )}
      <IssueSheet company={company} kind={sheet} onClose={() => setSheet(null)} />
    </Card>
  );
}

function OfferProgress({ offer }: { offer: Offer }) {
  const t = useTranslations("listing");
  const share = offer.sharesSubscribedE6 / Math.max(1, offer.sharesOfferedE6);
  return (
    <div className="space-y-2 rounded-md bg-surface-2 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-fg-1">{offer.kind === "ipo" ? t("subscriptionIpo") : t("subscriptionIncrease")}</span>
        <span className="text-fg-3">
          {t("endsIn")} <Countdown target={Date.parse(offer.endsAt)} className="nums text-fg-1" />
        </span>
      </div>
      <Progress value={share} label={t("subscribed")} tone="gain" />
      <p className="nums text-xs text-fg-3">
        {t("subscribedValue", {
          subscribed: formatShares(offer.sharesSubscribedE6),
          offered: formatShares(offer.sharesOfferedE6),
          price: formatMoney(offer.priceCents),
        })}
      </p>
    </div>
  );
}

function IssueSheet({
  company,
  kind,
  onClose,
}: {
  company: MyCompany;
  kind: "ipo" | "increase" | null;
  onClose: () => void;
}) {
  const t = useTranslations("listing");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [shown, setShown] = useState(kind);
  const [percent, setPercent] = useState(25);
  const [state, setState] = useState<ButtonState>("idle");
  if (kind !== null && kind !== shown) {
    setShown(kind);
    setPercent(kind === "ipo" ? 25 : 10);
    setState("idle");
  }
  const isIpo = shown !== "increase";
  const min = isIpo ? ipo.minSharePercent : 1;
  const max = isIpo ? ipo.maxSharePercent : ipo.capitalIncreaseMaxPercent;
  const price = isIpo
    ? issuePriceCents(BigInt(company.valueCents))
    : Math.round(((company.listing?.lastPriceE4 ?? 0) / 100) * ipo.capitalIncreaseDiscount);
  const total = isIpo ? ipo.sharesTotal : (company.listing?.sharesTotalE6 ?? 0) / 1_000_000;
  const shares = Math.floor((total * percent) / 100);

  const start = async () => {
    setState("loading");
    try {
      if (isIpo) await engine.goPublic(crypto.randomUUID(), percent);
      else await engine.capitalIncrease(crypto.randomUUID(), percent);
      setState("success");
      void playSound("levelUp");
      toast.success(isIpo ? t("ipoStarted") : t("increaseStarted"), t("startedText", { hours: ipo.subscriptionHours }));
      await refresh();
      window.setTimeout(onClose, 400);
    } catch (error) {
      setState("idle");
      toast.error(t("title"), errorText(error));
    }
  };

  return (
    <Sheet
      open={kind !== null}
      onOpenChange={(o) => !o && onClose()}
      title={isIpo ? t("goPublic") : t("capitalIncrease")}
      description={isIpo ? t("ipoIntro") : t("increaseIntro")}
      footer={
        <Button block size="lg" state={state} onClick={() => void start()}>
          {t("start")}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <span className="label-pixel text-fg-2">{t("share")}</span>
          <span className="nums text-lg font-semibold text-fg-1">{percent} %</span>
        </div>
        <Slider
          value={(percent - min) / (max - min)}
          onValueChange={(v) => setPercent(Math.round(min + v * (max - min)))}
          label={t("share")}
          marks={[0.5]}
        />
        <dl className="divide-y divide-line-1 rounded-md border border-line-1 text-sm">
          <Row label={t("price")} value={formatMoney(price)} />
          <Row label={t("shares")} value={shares.toLocaleString("de-DE")} />
          <Row label={t("maxProceeds")} value={money(shares * price)} />
          {isIpo && <Row label={t("youKeep")} value={`${100 - percent} %`} />}
        </dl>
        <p className="text-xs text-pretty text-fg-3">{t("aiHint")}</p>
      </div>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-3 py-2">
      <dt className="text-fg-3">{label}</dt>
      <dd className="nums text-fg-1">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ offers for investors (markets page)

export function useOffers() {
  return useQuery({ queryKey: ["company", "offers"], queryFn: () => engine.offers(), refetchInterval: 30_000 });
}

/** New issues players can subscribe to (ADR-067), shown on the markets page. */
export function OffersCard() {
  const t = useTranslations("listing");
  const offers = useOffers();
  const product = useProductText();
  const [open, setOpen] = useState<Offer | null>(null);
  const list = offers.data?.filter((o) => o.status === "open") ?? [];
  if (list.length === 0) return null;
  return (
    <Card padding="lg" className="space-y-3" data-testid="offers">
      <p className="label-pixel text-fg-2">{t("offersTitle")}</p>
      <ul className="space-y-3">
        {list.map((o) => (
          <li key={o.id} className="flex items-center gap-3">
            <CompanyLogo ticker={o.company.name} color={o.company.color} logo={o.company.logo} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-fg-1">{o.company.name}</p>
              <p className="truncate text-xs text-fg-3">
                {o.company.productKey ? product.name(o.company.productKey) : ""} · {formatMoney(o.priceCents)}{" "}
                {t("perShare")}
              </p>
            </div>
            <Button size="sm" onClick={() => setOpen(o)}>
              {t("subscribe")}
            </Button>
          </li>
        ))}
      </ul>
      <SubscribeSheet offer={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

function SubscribeSheet({ offer, onClose }: { offer: Offer | null; onClose: () => void }) {
  const t = useTranslations("listing");
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const [shown, setShown] = useState(offer);
  const [text, setText] = useState("");
  const [state, setState] = useState<ButtonState>("idle");
  if (offer && offer !== shown) {
    setShown(offer);
    setText("");
    setState("idle");
  }
  if (!shown) return null;
  const cents = parseEuroCents(text);
  const subscribe = async () => {
    if (!cents) return;
    setState("loading");
    try {
      const r = await engine.subscribeOffer(crypto.randomUUID(), shown.id, cents);
      setState("success");
      void playSound("buy");
      toast.success(
        t("subscribedDone"),
        t("subscribedDoneText", { shares: formatShares(r.sharesE6), amount: formatMoney(r.amountCents) }),
      );
      await refresh();
      window.setTimeout(onClose, 400);
    } catch (error) {
      setState("idle");
      toast.error(t("subscribe"), errorText(error));
    }
  };
  return (
    <Sheet
      open={offer !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("subscribeTitle", { name: shown.company.name })}
      description={t("subscribeIntro")}
      footer={
        <Button block size="lg" state={state} disabled={!cents} onClick={() => void subscribe()}>
          {t("subscribe")}
        </Button>
      }
    >
      <div className="space-y-4">
        <OfferProgress offer={shown} />
        {shown.lastQuarter && (
          <p className="nums text-sm text-fg-2">
            {shown.lastQuarter.label}: {t("revenue")} {money(shown.lastQuarter.revenueCents)} · {t("profit")}{" "}
            {money(shown.lastQuarter.profitCents)}
          </p>
        )}
        <Badge>{t("valueBadge", { value: money(shown.valueCents) })}</Badge>
        <Field label={t("amount")} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
        {cents ? (
          <p className="nums text-sm text-fg-2">
            {t("youGet", { shares: Math.floor(cents / shown.priceCents).toLocaleString("de-DE") })}
          </p>
        ) : null}
        <p className="text-xs text-pretty text-fg-3">{t("risk")}</p>
      </div>
    </Sheet>
  );
}
