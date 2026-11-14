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
import { Progress } from "@/components/ui/progress";
import { Sheet } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { BALANCE } from "@/config/balance";
import { useMyJob } from "@/features/career/hooks";
import { useGameErrorText } from "@/features/game/errors";
import { engine, useGame } from "@/features/game/store";
import type { MyCompany, Offer } from "@/features/game/types";
import { CompanyLogo } from "@/features/market/components/company-logo";
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

/** Subscribed shares (players and AI investors) and the time left of the 10-minute window (ADR-146). */
function OfferProgress({ offer }: { offer: Offer }) {
  const t = useTranslations("listing");
  const taken = offer.sharesSubscribedE6 + offer.sharesAiE6;
  const share = taken / Math.max(1, offer.sharesOfferedE6);
  return (
    <div className="space-y-2 rounded-md bg-surface-2 px-3 py-3" data-testid="offer-progress">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-fg-1">{offer.kind === "ipo" ? t("subscriptionIpo") : t("subscriptionIncrease")}</span>
        <span className="text-fg-3">
          {t("endsIn")} <Countdown target={Date.parse(offer.endsAt)} className="nums text-fg-1" />
        </span>
      </div>
      <Progress value={share} label={t("subscribed")} tone="gain" />
      <p className="nums text-xs text-fg-3">
        {t("subscribedValue", {
          subscribed: formatShares(taken),
          offered: formatShares(offer.sharesOfferedE6),
          percent: Math.floor(share * 100),
          price: formatMoney(offer.priceCents),
        })}
      </p>
      <p className="text-xs text-pretty text-fg-3">{t("fullHint")}</p>
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
      toast.success(
        isIpo ? t("ipoStarted") : t("increaseStarted"),
        t("startedText", { minutes: ipo.subscriptionMinutes }),
      );
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
      description={
        isIpo
          ? t("ipoIntro", { minutes: ipo.subscriptionMinutes })
          : t("increaseIntro", { minutes: ipo.subscriptionMinutes })
      }
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
        <p className="text-xs text-pretty text-fg-3">{t("aiHint", { minutes: ipo.subscriptionMinutes })}</p>
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

/** New issues players can subscribe to (ADR-067, ADR-146), shown on the markets page: one tap per amount. */
export function OffersCard() {
  const t = useTranslations("listing");
  const offers = useOffers();
  const list = offers.data?.filter((o) => o.status === "open") ?? [];
  if (list.length === 0) return null;
  return (
    <Card padding="lg" className="space-y-4" data-testid="offers">
      <div>
        <p className="label-pixel text-fg-2">{t("offersTitle")}</p>
        <p className="mt-1 text-sm text-pretty text-fg-3">{t("offersIntro", { minutes: ipo.subscriptionMinutes })}</p>
      </div>
      <ul className="space-y-5">
        {list.map((o) => (
          <OfferItem key={o.id} offer={o} />
        ))}
      </ul>
    </Card>
  );
}

function OfferItem({ offer }: { offer: Offer }) {
  const t = useTranslations("listing");
  const product = useProductText();
  const errorText = useGameErrorText();
  const refresh = useCompanyRefresh();
  const offers = useOffers();
  const cashCents = useGame((state) => state.portfolio?.cashCents ?? null);
  const refreshPortfolio = useGame((state) => state.refreshPortfolio);
  const [busy, setBusy] = useState<{ amount: number; state: ButtonState } | null>(null);
  const freeE6 = Math.max(0, offer.sharesOfferedE6 - offer.sharesSubscribedE6 - offer.sharesAiE6);
  const restCents = Math.ceil((freeE6 * offer.priceCents) / 1_000_000);
  const amounts = [...ipo.quickAmountsCents.filter((a) => a < restCents), restCents].filter((a) => a > 0);

  const subscribe = async (amountCents: number) => {
    setBusy({ amount: amountCents, state: "loading" });
    try {
      const r = await engine.subscribeOffer(crypto.randomUUID(), offer.id, amountCents);
      setBusy({ amount: amountCents, state: "success" });
      void playSound("buy");
      toast.success(
        r.completed ? t("listedNow", { name: offer.company.name }) : t("subscribedDone"),
        t("subscribedDoneText", { shares: formatShares(r.sharesE6), amount: formatMoney(r.amountCents) }),
      );
      await Promise.all([refresh(), offers.refetch(), refreshPortfolio()]);
    } catch (error) {
      toast.error(t("subscribe"), errorText(error));
    } finally {
      window.setTimeout(() => setBusy(null), 600);
    }
  };

  return (
    <li className="space-y-3" data-testid="offer">
      <div className="flex items-center gap-3">
        <CompanyLogo ticker={offer.company.name} color={offer.company.color} logo={offer.company.logo} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg-1">{offer.company.name}</p>
          <p className="truncate text-xs text-fg-3">
            {offer.company.productKey ? `${product.name(offer.company.productKey)} · ` : ""}
            {formatMoney(offer.priceCents)} {t("perShare")}
          </p>
        </div>
        <Badge>{t("valueBadge", { value: money(offer.valueCents) })}</Badge>
      </div>
      <OfferProgress offer={offer} />
      {offer.mine ? (
        <p className="text-xs text-pretty text-fg-3">{t("ownOffer")}</p>
      ) : (
        <>
          <div role="group" aria-label={t("amount")} className="flex flex-wrap gap-2">
            {amounts.map((amount) => {
              const isRest = amount === restCents;
              return (
                <Button
                  key={amount}
                  size="sm"
                  variant={isRest ? "primary" : "secondary"}
                  state={busy?.amount === amount ? busy.state : "idle"}
                  disabled={(busy !== null && busy.amount !== amount) || (cashCents !== null && cashCents < amount)}
                  onClick={() => void subscribe(amount)}
                >
                  {isRest ? t("subscribeRest", { amount: money(amount) }) : money(amount)}
                </Button>
              );
            })}
          </div>
          {offer.mySharesE6 > 0 && (
            <p className="nums text-xs text-fg-2">{t("yourShares", { shares: formatShares(offer.mySharesE6) })}</p>
          )}
          <p className="text-xs text-pretty text-fg-3">{t("risk")}</p>
        </>
      )}
    </li>
  );
}
