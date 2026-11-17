"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { nexamonCard, NEXAMON_CARDS, type NexamonCard as CardData } from "@/config/nexamon";
import { NEXAMON_CONDITIONS } from "@/config/nexamon-rules";
import { BALANCE } from "@/config/balance";
import { DISCLOSURE } from "@/config/disclosure";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { NexamonCardDetails, NexamonCopy, NexamonListing, NexamonSale } from "@/features/game/nexamon-types";
import { useGame } from "@/features/game/store";
import { PriceChart } from "@/features/market/components/price-chart";
import { LockedFeature } from "@/features/progression/components/locked-feature";
import { useDisclosed } from "@/features/progression/components/reveal";
import { formatBps, formatInteger, formatMoney } from "@/lib/format";
import { NEXAMON_BLACK_LABEL_GRADE, nexamonGradeChanceBps } from "@/lib/sim/nexamon";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { formatSetNumber } from "../lib";
import { useNexamonCard } from "../hooks";
import {
  buyableListings,
  conditionFactorBps,
  copyStatus,
  formatChance,
  formatFactor,
  historyCandles,
  sortCopiesBestFirst,
} from "../view";
import { ConditionBadge, RarityBadge, SetIcon, TypeIcon } from "./badges";
import { NexamonCard } from "./card";
import { CopyActions } from "./copy-actions";
import { BonusTag } from "./bonuses";
import { BuySheet, ListingRow, SellerName } from "./listing-row";
import { CopyQuality, GradeChip, LoadError, Stat } from "./parts";
import { NexamonSlab } from "./slab";

const dateTime = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * One card up close (ADR-165): the card itself to tilt and turn, its value with history, how many exist, the own
 * copies with everything that can be done with them, the offers on the market and the latest sales.
 */
export function CardInspect({ cardKey }: { cardKey: string }) {
  const t = useTranslations("nexamon");
  const card = nexamonCard(cardKey);
  const ready = useGame((state) => state.portfolio !== null);
  const unlocked = useDisclosed("nexamon");
  const details = useNexamonCard(cardKey, Boolean(card) && ready && unlocked);

  const back = (
    <Link
      href="/nexamon?tab=collection"
      transitionTypes={["nav-back"]}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent focus-ring hover:underline"
      data-testid="inspect-back"
    >
      <span aria-hidden>←</span> {t("inspect.back")}
    </Link>
  );

  if (!card) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          art={<PixelIcon {...UI_ICONS.search} scale={4} />}
          title={t("inspect.unknownTitle")}
          description={t("inspect.unknownText")}
        />
      </div>
    );
  }
  if (!ready) return <Skeleton className="h-112 w-full rounded-lg" />;
  if (!unlocked) {
    return (
      <LockedFeature
        level={DISCLOSURE.nexamon}
        title={t("locked.title")}
        description={t("locked.text", { level: DISCLOSURE.nexamon })}
        art={<PixelIcon {...UI_ICONS.nexamon} scale={3} />}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="nexamon-inspect" data-card={card.key}>
      <div className="flex items-center justify-between gap-3">
        {back}
        <Neighbours card={card} />
      </div>
      {!details.data && details.error ? (
        <LoadError error={details.error} onRetry={() => void details.refetch()} />
      ) : (
        <Inspect card={card} details={details.data} />
      )}
    </div>
  );
}

/** Previous and next card of the same set. */
function Neighbours({ card }: { card: CardData }) {
  const t = useTranslations("nexamon");
  const set = NEXAMON_CARDS.filter((c) => c.set === card.set);
  const index = set.findIndex((c) => c.key === card.key);
  const prev = set[index - 1];
  const next = set[index + 1];
  const link =
    "grid size-9 place-items-center rounded-sm border-2 border-line-1 bg-surface-1 text-fg-2 focus-ring transition duration-fast hover:border-line-2 hover:text-fg-1 active:scale-95";
  return (
    <nav className="flex items-center gap-2" aria-label={t("inspect.neighbours")}>
      {prev ? (
        <Link href={`/nexamon/${prev.key}`} className={link} aria-label={t("inspect.prev", { name: prev.name })}>
          <span aria-hidden>‹</span>
        </Link>
      ) : (
        <span className={cn(link, "pointer-events-none opacity-40")} aria-hidden>
          ‹
        </span>
      )}
      <span className="nums text-xs text-fg-3">{formatSetNumber(card)}</span>
      {next ? (
        <Link href={`/nexamon/${next.key}`} className={link} aria-label={t("inspect.next", { name: next.name })}>
          <span aria-hidden>›</span>
        </Link>
      ) : (
        <span className={cn(link, "pointer-events-none opacity-40")} aria-hidden>
          ›
        </span>
      )}
    </nav>
  );
}

function Inspect({ card, details }: { card: CardData; details: NexamonCardDetails | undefined }) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const wide = useMediaQuery("(min-width: 1024px)");
  const [picked, setPicked] = useState<string | null>(null);
  const [buying, setBuying] = useState<NexamonListing | null>(null);
  const copies = details ? sortCopiesBestFirst(details.copies) : [];
  const shown = copies.find((c) => c.id === picked) ?? copies[0] ?? null;
  const slab = shown !== null && shown.state === "graded" && shown.grade !== null;
  const offers = details ? buyableListings(details.listings) : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="flex flex-col items-center gap-3 lg:sticky lg:top-24">
        <div className="grid place-items-center" data-testid="inspect-visual" data-slab={slab}>
          {slab && shown ? (
            <NexamonSlab
              key={shown.id}
              card={card}
              grade={shown.grade ?? 1}
              serial={shown.serial}
              scale={wide ? 4 : 3}
            />
          ) : (
            <NexamonCard key={card.key} card={card} scale={wide ? 5 : 4} />
          )}
        </div>
        <p className="text-center text-xs text-pretty text-fg-3">{t("inspect.flipHint")}</p>
      </div>

      <div className="min-w-0 space-y-4">
        <header className="space-y-2">
          <h1 className="font-pixel text-xl text-fg-1 uppercase lg:text-2xl" data-testid="inspect-name">
            {card.name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <RarityBadge rarity={card.rarity} />
            <SetIcon set={card.set} label />
            <span className="nums text-sm text-fg-2">{formatSetNumber(card)}</span>
            <TypeIcon type={card.type} label />
          </p>
          {details?.card.bonus && (
            <div className="space-y-0.5 rounded-sm bg-gain-soft px-2.5 py-1.5" data-testid="inspect-bonus">
              <p className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="label-pixel text-fg-2">{t("bonuses.cardTitle")}</span>
                <BonusTag bonus={details.card.bonus} />
              </p>
              <p className="text-xs text-pretty text-fg-2">{t("bonuses.cardHint")}</p>
            </div>
          )}
        </header>

        {!details ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-56 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : (
          <>
            <Card padding="lg" data-testid="inspect-value">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="label-pixel text-fg-3">{t("inspect.value")}</p>
                  <p className="nums text-3xl font-semibold text-fg-1" data-testid="card-value">
                    {formatMoney(details.card.valueCents)}
                  </p>
                </div>
                <p className="flex items-center gap-2 text-sm text-fg-3">
                  <Delta bps={details.card.changeBps} pill />
                  {t("inspect.today")}
                </p>
              </div>
              <ValueChart details={details} name={card.name} />
              <p className="mt-2 nums text-xs text-pretty text-fg-3">
                {t("inspect.range", {
                  start: formatMoney(details.card.startCents),
                  floor: formatMoney(details.card.floorCents),
                  cap: formatMoney(details.card.capCents),
                })}
              </p>
            </Card>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t("inspect.population")} hint={t("inspect.populationHint")} testId="card-population">
                {formatInteger(details.card.population)}
              </Stat>
              <Stat label={t("inspect.listed")} hint={t("inspect.listedHint")}>
                {formatInteger(details.card.listed)}
              </Stat>
              <Stat label={t("inspect.owned")} hint={t("inspect.ownedHint")} testId="card-owned">
                {formatInteger(details.card.owned)}
              </Stat>
              <Stat label={t("inspect.popularity")} hint={t("inspect.popularityHint")}>
                {formatChance(details.card.popularityBps)}
              </Stat>
            </div>

            <Card padding="lg" data-testid="inspect-copies">
              <CardHeader>
                <CardTitle>{t("inspect.copies", { count: copies.length })}</CardTitle>
              </CardHeader>
              {copies.length === 0 ? (
                <p className="text-sm text-pretty text-fg-3">{t("inspect.noCopies")}</p>
              ) : (
                <ul className="divide-y-2 divide-line-1">
                  {copies.map((copy) => (
                    <CopyRow
                      key={copy.id}
                      copy={copy}
                      card={card}
                      population={details.card.population}
                      shown={shown?.id === copy.id}
                      canPick={copies.length > 1}
                      onPick={() => setPicked(copy.id)}
                    />
                  ))}
                </ul>
              )}
              <ConditionNote />
            </Card>

            <Card padding="lg" data-testid="inspect-listings">
              <CardHeader>
                <CardTitle>{t("inspect.listings", { count: offers.length })}</CardTitle>
                <Link
                  href={`/nexamon?tab=market&card=${card.key}`}
                  className="text-sm font-medium text-accent focus-ring hover:underline"
                >
                  {t("inspect.allListings")}
                </Link>
              </CardHeader>
              {offers.length === 0 ? (
                <p className="text-sm text-pretty text-fg-3">{t("inspect.noListings")}</p>
              ) : (
                <ul className="-mx-3 divide-y divide-line-1">
                  {offers.slice(0, 8).map((listing) => (
                    <ListingRow key={listing.id} listing={listing} onBuy={setBuying} compact />
                  ))}
                </ul>
              )}
            </Card>

            <Card padding="lg" data-testid="inspect-graded">
              <CardHeader>
                <CardTitle>{t("inspect.graded")}</CardTitle>
              </CardHeader>
              <GradedPopulation graded={details.graded} blackLabels={details.blackLabels} />
            </Card>

            <HypeCard details={details} />

            <Card padding="lg" data-testid="inspect-sales">
              <CardHeader>
                <CardTitle>{t("inspect.sales")}</CardTitle>
              </CardHeader>
              {details.sales.length === 0 ? (
                <p className="text-sm text-pretty text-fg-3">{t("inspect.noSales")}</p>
              ) : (
                <ul className="divide-y divide-line-1">
                  {details.sales.slice(0, 10).map((sale, i) => (
                    <SaleRow key={`${sale.at}-${i}`} sale={sale} />
                  ))}
                </ul>
              )}
            </Card>

            <p className="text-xs text-pretty text-fg-3">
              {t("inspect.cardLine", { type: tc(`types.${card.type}`), hp: card.hp, attack: card.attack.name })}
            </p>
          </>
        )}
      </div>
      <BuySheet listing={buying} onClose={() => setBuying(null)} />
    </div>
  );
}

/** ADR-171: the Black Label factor of this card, a "Hype" marker after a jump and the history. */
function HypeCard({ details }: { details: NexamonCardDetails }) {
  const t = useTranslations("nexamon.hype");
  const base = BALANCE.nexamon.grading.blackLabel.valueBps;
  const factor = details.card.blackLabelBps;
  if (details.blackLabels === 0 && factor <= base && details.hype.length === 0) return null;
  return (
    <Card padding="lg" data-testid="inspect-hype" data-factor={factor}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("title")}
          {details.card.hypeAt && (
            <Badge tone="warn" data-testid="hype-marker">
              {t("marker")}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <p className="nums text-sm text-fg-1">{t("factor", { factor: formatFactor(factor) })}</p>
      <p className="mt-1 text-xs text-pretty text-fg-3">{t("base", { factor: formatFactor(base) })}</p>
      {details.hype.length === 0 ? (
        <p className="mt-2 text-sm text-fg-3">{t("empty")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-1 text-xs" aria-label={t("history")}>
          {details.hype
            .slice(-8)
            .reverse()
            .map((h) => (
              <li key={h.at} className="flex justify-between gap-2 py-1">
                <span className="nums text-fg-3">{new Date(h.at).toLocaleString("de-DE")}</span>
                <span className="nums text-fg-1">
                  {formatFactor(h.factorBps)}
                  {h.jumpBps > 0 && (
                    <span className="ml-1.5 text-gain">{t("jump", { bps: formatBps(h.jumpBps) })}</span>
                  )}
                </span>
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}

function ValueChart({ details, name }: { details: NexamonCardDetails; name: string }) {
  const t = useTranslations("nexamon");
  const points = details.history;
  if (points.length < 2) return <p className="mt-3 text-sm text-pretty text-fg-3">{t("inspect.noHistory")}</p>;
  const candles = historyCandles(points);
  const first = points[0]!.valueCents;
  const now = points.at(-1)!.valueCents;
  return (
    <PriceChart
      candles={candles}
      positive={now >= first}
      label={t("inspect.chartLabel", { name, value: formatMoney(now) })}
      className="mt-3 h-44"
    />
  );
}

function CopyRow({
  copy,
  card,
  population,
  shown,
  canPick,
  onPick,
}: {
  copy: NexamonCopy;
  card: CardData;
  population: number;
  shown: boolean;
  canPick: boolean;
  onPick: () => void;
}) {
  const t = useTranslations("nexamon");
  const status = copyStatus(copy);
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0" data-testid="copy-row" data-copy={copy.id} data-status={status}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-pixel nums text-sm text-fg-1">{t("serial", { serial: copy.serial })}</span>
        <CopyQuality copy={copy} />
        {status === "listed" && copy.listing ? (
          <span
            className="rounded-pill bg-info px-2 py-0.5 label-pixel text-on-semantic"
            title={t("binder.listedHint", { count: 1, price: formatMoney(copy.listing.priceCents) })}
            data-testid="copy-status"
          >
            {t("binder.listedTag")} · <span className="nums">{formatMoney(copy.listing.priceCents)}</span>
          </span>
        ) : (
          <span className="label-pixel text-fg-3" data-testid="copy-status">
            {t(`status.${status}`)}
          </span>
        )}
        <span className="ml-auto nums font-semibold text-fg-1" data-testid="copy-value">
          {formatMoney(copy.valueCents)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CopyActions copy={copy} card={card} population={population} />
        {canPick && (
          <button
            type="button"
            onClick={onPick}
            aria-pressed={shown}
            className={cn(
              "h-8 rounded-sm px-2 text-xs font-medium focus-ring transition-colors duration-fast",
              shown ? "bg-accent-soft text-accent" : "text-fg-3 hover:bg-surface-2 hover:text-fg-1",
            )}
          >
            {shown ? t("inspect.showing") : t("inspect.show")}
          </button>
        )}
      </div>
    </li>
  );
}

/** What the condition of a raw copy means for its value. */
function ConditionNote() {
  const t = useTranslations("nexamon");
  return (
    <div className="mt-4 rounded-md bg-surface-2 p-3">
      <p className="text-xs text-pretty text-fg-2">{t("inspect.conditionNote")}</p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {[...NEXAMON_CONDITIONS].reverse().map((condition) => (
          <li key={condition} className="flex items-center gap-1.5 nums text-xs text-fg-1">
            <ConditionBadge condition={condition} />
            {formatChance(conditionFactorBps(condition))}
          </li>
        ))}
      </ul>
      <p
        className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-pretty text-fg-2"
        data-testid="black-label-note"
      >
        <GradeChip grade={NEXAMON_BLACK_LABEL_GRADE} short />
        <span className="min-w-0 flex-1 basis-48">
          {t("blackLabel.note", {
            mint: formatChance(BALANCE.nexamon.grading.blackLabel.chanceBps.mint),
            nearMint: formatChance(BALANCE.nexamon.grading.blackLabel.chanceBps.near_mint),
            factor: formatFactor(BALANCE.nexamon.grading.blackLabel.valueBps),
          })}
        </span>
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5" data-testid="black-label-chances">
        {[...NEXAMON_CONDITIONS].reverse().map((condition) => (
          <li key={condition} className="flex items-center gap-1.5 nums text-xs text-fg-1" data-condition={condition}>
            <ConditionBadge condition={condition} />
            {formatChance(nexamonGradeChanceBps(condition, NEXAMON_BLACK_LABEL_GRADE))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Slabs per grade, 10 on top, as bars against the most common grade. */
function GradedPopulation({ graded, blackLabels }: { graded: readonly number[]; blackLabels: number }) {
  const t = useTranslations("nexamon");
  const total = graded.reduce((sum, n) => sum + n, 0) + blackLabels;
  if (total === 0) return <p className="text-sm text-pretty text-fg-3">{t("inspect.noGraded")}</p>;
  const most = Math.max(...graded, blackLabels, 1);
  return (
    <ul className="space-y-1.5" aria-label={t("inspect.graded")} data-black-labels={blackLabels}>
      {[
        ...graded.map((count, i) => ({ grade: BALANCE.nexamon.grading.grades[i] ?? i + 1, count })),
        { grade: NEXAMON_BLACK_LABEL_GRADE, count: blackLabels },
      ]
        .reverse()
        .map(({ grade, count }) => (
          <li key={grade} className="flex items-center gap-2" data-grade={grade}>
            <span className="w-24 shrink-0">
              <GradeChip grade={grade} short />
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-xs bg-surface-3">
              <span
                className={cn(
                  "block h-full origin-left",
                  grade === 11 ? "bg-black-label-edge" : grade === 10 ? "bg-gold" : "bg-accent",
                )}
                style={{ transform: `scaleX(${count / most})` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right nums text-sm text-fg-1">{count}</span>
          </li>
        ))}
    </ul>
  );
}

function SaleRow({ sale }: { sale: NexamonSale }) {
  const t = useTranslations("nexamon");
  return (
    <li className="flex items-center gap-3 py-2 text-sm" data-testid="sale-row" data-kind={sale.kind}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-1.5">
          <CopyQuality copy={sale} short />
          <span className="text-xs text-fg-3">{t(`saleKind.${sale.kind}`)}</span>
        </p>
        <p className="flex min-w-0 items-center gap-1 text-xs text-fg-3">
          <SellerName listing={{ seller: sale.seller, sellerAi: false, mine: false }} />
          <span aria-hidden>→</span>
          <span className="truncate">{sale.buyer}</span>
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="nums font-semibold text-fg-1">{formatMoney(sale.priceCents)}</p>
        <p className="nums text-xs text-fg-3">{dateTime.format(new Date(sale.at))}</p>
      </div>
    </li>
  );
}
