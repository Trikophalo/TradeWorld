"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { nexamonCard } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useGameErrorText } from "@/features/game/errors";
import type { NexamonListing } from "@/features/game/nexamon-types";
import { engine, useGame } from "@/features/game/store";
import { GameError } from "@/features/game/types";
import { formatMoney } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { formatSetNumber } from "../lib";
import { useNexamonAction, useNexamonBonuses } from "../hooks";
import { dealBps, dealTone, formatChance } from "../view";
import { RarityBadge, SetIcon } from "./badges";
import { CopyQuality, CopyVisual, FactRow } from "./parts";

const DEAL_CLASS = { good: "text-gain", fair: "text-fg-3", high: "text-warn" } as const;

/** Price against value in words: "12 % unter Wert", "zum Wert", "10 % über Wert". */
export function DealNote({
  priceCents,
  valueCents,
  className,
}: {
  priceCents: number;
  valueCents: number;
  className?: string;
}) {
  const t = useTranslations("nexamon");
  const bps = dealBps(priceCents, valueCents);
  return (
    <span className={cn("nums text-xs", DEAL_CLASS[dealTone(bps)], className)} data-testid="deal-note">
      {bps === 0
        ? t("deal.at")
        : bps < 0
          ? t("deal.below", { percent: formatChance(-bps) })
          : t("deal.above", { percent: formatChance(bps) })}
    </span>
  );
}

/** Who sells: a player by name, an AI seller with its mark, or the player themselves. */
export function SellerName({ listing }: { listing: Pick<NexamonListing, "seller" | "sellerAi" | "mine"> }) {
  const t = useTranslations("nexamon");
  if (listing.mine) return <span className="text-accent">{t("market.you")}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-ai={listing.sellerAi}>
      <span className="truncate">{listing.seller}</span>
      {listing.sellerAi && <Badge tone="info">{t("market.ai")}</Badge>}
    </span>
  );
}

/**
 * One offer of the card market: the copy as a picture, what it is, its price against its value, the seller and
 * the way to buy it. `compact` drops the picture and the card's name (on the card's own page).
 */
export function ListingRow({
  listing,
  onBuy,
  compact = false,
  className,
}: {
  listing: NexamonListing;
  onBuy: (listing: NexamonListing) => void;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("nexamon");
  const card = nexamonCard(listing.cardKey);
  // ADR-171: a card that gives a bonus the player does not have yet
  const bonuses = useNexamonBonuses();
  const bonusMissing =
    !listing.mine && bonuses.data?.cards.some((c) => c.cardKey === listing.cardKey && !c.active) === true;
  if (!card) return null;
  return (
    <li
      className={cn("flex items-center gap-3 px-3 py-2.5", className)}
      data-testid="listing-row"
      data-listing={listing.id}
      data-card={listing.cardKey}
      data-mine={listing.mine}
    >
      {!compact && (
        <Link
          href={`/nexamon/${listing.cardKey}`}
          aria-label={card.name}
          className="shrink-0 self-end rounded-sm focus-ring transition-transform duration-fast hover:-translate-y-0.5"
        >
          <CopyVisual card={card} grade={listing.grade} serial={listing.serial} scale={1} />
        </Link>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {!compact && (
          <p className="flex items-center gap-1.5">
            <Link
              href={`/nexamon/${listing.cardKey}`}
              className="truncate font-medium text-fg-1 focus-ring hover:underline"
            >
              {card.name}
            </Link>
          </p>
        )}
        <p className="flex flex-wrap items-center gap-1.5">
          <CopyQuality copy={listing} short={!compact} />
          {!compact && <RarityBadge rarity={listing.rarity} short />}
          <span className="nums text-xs text-fg-3">{t("serial", { serial: listing.serial })}</span>
          {bonusMissing && (
            <Badge tone="gain" data-testid="listing-bonus-missing">
              {t("bonuses.missingTag")}
            </Badge>
          )}
        </p>
        {!compact && (
          <p className="flex items-center gap-1.5 text-xs text-fg-3">
            <SetIcon set={listing.set} scale={1} />
            <span className="nums">{formatSetNumber(card)}</span>
          </p>
        )}
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-fg-2">
          <SellerName listing={listing} />
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="nums font-semibold text-fg-1" data-testid="listing-price">
          {formatMoney(listing.priceCents)}
        </span>
        <DealNote priceCents={listing.priceCents} valueCents={listing.valueCents} />
        {listing.mine ? (
          <Link
            href={`/nexamon/${listing.cardKey}`}
            className="text-xs font-medium text-accent focus-ring hover:underline"
          >
            {t("market.manage")}
          </Link>
        ) : (
          <Button size="sm" onClick={() => onBuy(listing)} data-testid="listing-buy">
            {t("market.buy")}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The confirmation before a purchase. The price the player sees goes to the server; if it changed meanwhile, or
 * the offer is gone, the window closes with a note and the list is read again.
 */
export function BuySheet({ listing, onClose }: { listing: NexamonListing | null; onClose: () => void }) {
  const t = useTranslations("nexamon");
  const errorText = useGameErrorText();
  const cash = useGame((state) => state.portfolio?.cashCents ?? 0);
  const action = useNexamonAction();
  const card = listing ? nexamonCard(listing.cardKey) : undefined;
  const short = listing ? Math.max(0, listing.priceCents - cash) : 0;
  return (
    <Sheet
      open={listing !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("buy.title")}
      footer={
        listing && (
          <div className="space-y-2">
            <Button
              block
              size="lg"
              state={action.state}
              disabled={short > 0}
              data-testid="buy-confirm"
              onClick={() =>
                void action.run((requestId) => engine.buyNexamonListing(requestId, listing.id, listing.priceCents), {
                  errorTitle: t("buy.failed"),
                  onDone: (result) => {
                    void playSound("buy");
                    toast.success(t("buy.done"), formatMoney(result.priceCents), { silent: true });
                    onClose();
                  },
                  onError: (error) => {
                    const key = error instanceof GameError ? error.key : "";
                    if (key !== "nexamon_price_changed" && key !== "nexamon_not_listed") return false;
                    toast.warn(t(key === "nexamon_price_changed" ? "buy.changed" : "buy.gone"), errorText(error));
                    onClose();
                    return true;
                  },
                })
              }
            >
              {t("buy.confirm", { price: formatMoney(listing.priceCents) })}
            </Button>
            {short > 0 && (
              <p className="text-center text-sm text-warn">{t("shop.short", { amount: formatMoney(short) })}</p>
            )}
          </div>
        )
      }
    >
      {listing && card && (
        <div className="space-y-4" data-testid="buy-sheet">
          <div className="flex items-end gap-4">
            <CopyVisual card={card} grade={listing.grade} serial={listing.serial} scale={1} />
            <div className="min-w-0 space-y-1.5">
              <p className="font-medium text-fg-1">{card.name}</p>
              <p className="flex flex-wrap items-center gap-1.5">
                <CopyQuality copy={listing} />
                <span className="nums text-xs text-fg-3">{t("serial", { serial: listing.serial })}</span>
              </p>
              <p className="flex items-center gap-1.5 text-sm text-fg-2">
                {t("buy.from")} <SellerName listing={listing} />
              </p>
            </div>
          </div>
          <dl className="divide-y divide-line-1 rounded-md bg-surface-2 px-3">
            <FactRow label={t("buy.price")} strong>
              {formatMoney(listing.priceCents)}
            </FactRow>
            <FactRow label={t("sell.value")}>
              {formatMoney(listing.valueCents)}{" "}
              <DealNote priceCents={listing.priceCents} valueCents={listing.valueCents} className="ml-1" />
            </FactRow>
            <FactRow label={t("buy.cash")}>{formatMoney(cash)}</FactRow>
          </dl>
          <p className="text-xs text-pretty text-fg-3">{t("buy.note")}</p>
        </div>
      )}
    </Sheet>
  );
}
