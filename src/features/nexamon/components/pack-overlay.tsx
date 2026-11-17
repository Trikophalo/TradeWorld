"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BALANCE } from "@/config/balance";
import { nexamonCard, type NexamonCard, type NexamonSetKey } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import type {
  NexamonCollection,
  NexamonOneOfOneStatus,
  NexamonPackResult,
  NexamonPull,
  NexamonSetSummary,
} from "@/features/game/nexamon-types";
import { formatInteger, formatMoney } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { isHit } from "../lib";
import { chanceBps, formatChance, formatDecimal, setContents } from "../view";
import { nexamonCardBonusDef } from "@/lib/sim/nexamon-bonuses";
import { BonusTag } from "./bonuses";
import { ConditionBadge, RarityBadge } from "./badges";
import { CardThumb } from "./card-face";
import { TiltPack } from "./pack";
import { PackOpening } from "./pack-opening";
import { BuySealedButton } from "./sealed-packs";
import { LiveWatchers } from "../live/live-watchers";
import { useSetRelease } from "./release";

export interface PackOverlayProps {
  /** The set whose pack is on the table; null closes the popup. */
  set: NexamonSetSummary | null;
  /** A bought pack of this set that waits to be torn open; null while the player only looks. */
  pack: NexamonPackResult | null;
  /** For the list of all cards of the set and which of them the player owns. */
  collection: NexamonCollection | undefined;
  cashCents: number;
  /** Buys `count` packs of the set (the only step that costs money; ADR-182: 1 to packs.maxPerBuy at once). */
  onBuy: (count: number) => void;
  /** ADR-182: the pack on the table is pack `index` (1-based) of `total` bought at once. */
  series?: { index: number; total: number } | null;
  /** Tears the next pack of the series open. */
  onNext?: () => void;
  /** Skips the rest of the series: one summary of every pack left. */
  onSkipAll?: () => void;
  /** The pack is that summary of several packs: shown as a summary only. */
  summaryOnly?: boolean;
  buyState: ButtonState;
  onClose: () => void;
  /** The summary is showing (all cards pulled away or skipped). */
  onFinished: () => void;
  /** ADR-174: who pulled which One of One (from the overview). */
  oneOfOnes?: readonly NexamonOneOfOneStatus[];
}

/**
 * The popup of a booster pack (ADR-165). First the pack with its price, the player's balance and, further down,
 * every card of the set by rarity with the pull rates and what is already owned. "Kaufen" is the one step that
 * costs money; after it the pack is torn open by hand. The server has paid by then and the cards are in the
 * collection, so closing or skipping loses nothing. The summary lists every card with value, condition and "Neu".
 */
export function PackOverlay({
  set,
  pack,
  collection,
  cashCents,
  onBuy,
  buyState,
  onClose,
  onFinished,
  oneOfOnes = [],
  series = null,
  onNext,
  onSkipAll,
  summaryOnly = false,
}: PackOverlayProps) {
  const t = useTranslations("nexamon");
  const tc = useTranslations("nexamonCards");
  const desktop = useMediaQuery("(min-width: 1024px) and (min-height: 800px)");
  // Which pack reached its summary, and which one was skipped: both reset by themselves with the next pack.
  const [doneId, setDoneId] = useState<string | null>(null);
  const [skippedId, setSkippedId] = useState<string | null>(null);
  const cards = useMemo(
    () => (pack?.cards ?? []).map((pull) => nexamonCard(pull.cardKey)).filter((c): c is NexamonCard => Boolean(c)),
    [pack],
  );
  const done = pack !== null && doneId === pack.packId;
  const skipped = pack !== null && skippedId === pack.packId;
  // how many cards of this pack showed: spectators follow it (ADR-172)
  const [revealed, setRevealed] = useState<{ id: string; n: number } | null>(null);
  const shownCount = !pack ? 0 : done || skipped ? cards.length : revealed?.id === pack.packId ? revealed.n : 0;
  const finish = () => {
    if (!pack || done) return;
    setDoneId(pack.packId);
    onFinished();
  };
  const price = set?.packPriceCents ?? 0;
  const [count, setCount] = useState(1);
  const total = price * count;
  const short = Math.max(0, total - cashCents);
  // ADR-182: a set before its release can be looked at, not bought
  const release = useSetRelease(set?.key ?? null);
  const hasNext = series !== null && series.index < series.total;
  // ADR-182: after a pack of a series the next one tears open by itself
  const nextRef = useRef(onNext);
  useEffect(() => {
    nextRef.current = onNext;
  });
  const canAutoNext = Boolean(onNext);
  useEffect(() => {
    if (!done || !hasNext || !canAutoNext) return;
    const id = window.setTimeout(() => nextRef.current?.(), NEXT_PACK_MS);
    return () => window.clearTimeout(id);
  }, [done, hasNext, canAutoNext, pack?.packId]);
  const stage = !pack ? "preview" : done ? "summary" : "opening";
  const buyButton = (label: string, testId: string) => (
    <div className="flex w-full flex-col items-center gap-1.5 sm:w-auto">
      <Button
        size="lg"
        state={buyState}
        disabled={short > 0 || release.locked}
        onClick={() => onBuy(count)}
        data-testid={testId}
        className="w-full sm:w-auto"
      >
        {label}
      </Button>
      {release.locked && release.time ? (
        <p className="text-xs text-fg-2" data-testid="pack-release">
          {t("shop.releaseLocked", { time: release.time })}
        </p>
      ) : (
        short > 0 && <p className="text-xs text-warn">{t("shop.short", { amount: formatMoney(short) })}</p>
      )}
    </div>
  );
  const again =
    hasNext && onNext ? (
      <div className="flex w-full flex-col items-center gap-1.5 sm:w-auto">
        <Button size="lg" onClick={onNext} data-testid="pack-next" className="w-full sm:w-auto">
          {t("opening.next", { n: series!.index + 1, total: series!.total })}
        </Button>
        <p className="text-xs text-fg-3">{t("opening.nextSoon")}</p>
      </div>
    ) : count > 1 ? (
      buyButton(t("shop.buyMany", { count, price: formatMoney(total, { whole: true }) }), "pack-again")
    ) : (
      buyButton(t("opening.again", { price: formatMoney(price, { whole: true }) }), "pack-again")
    );

  return (
    <Dialog.Root open={set !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-overlay bg-scrim backdrop-blur-sm data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-out)]" />
        <Dialog.Content
          data-testid="pack-overlay"
          data-stage={stage}
          aria-describedby={undefined}
          className={cn(
            "fixed inset-0 z-sheet flex flex-col bg-bg pt-safe pb-safe outline-none",
            "lg:m-auto lg:h-[min(94dvh,900px)] lg:w-[min(94vw,880px)] lg:rounded-xl lg:border-2 lg:border-line-2 lg:shadow-3",
            "data-[state=open]:animate-[modal-in_var(--duration-slow)_var(--ease-out)]",
          )}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-line-1 px-4 py-3 lg:px-6">
            <div className="min-w-0">
              <Dialog.Title className="truncate font-pixel text-sm text-fg-1 uppercase">
                {set ? t("opening.title", { set: tc(`sets.${set.key}`) }) : t("title")}
              </Dialog.Title>
              <p className="mt-0.5 nums text-xs text-fg-3" data-testid="pack-balance">
                {t("opening.balance", { cash: formatMoney(cashCents) })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <LiveWatchers packId={summaryOnly ? null : (pack?.packId ?? null)} revealed={shownCount} />
              {stage === "opening" && pack && !summaryOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="pack-skip"
                  onClick={() => {
                    setSkippedId(pack.packId);
                    finish();
                  }}
                >
                  {t("opening.skip")}
                </Button>
              )}
              <Dialog.Close asChild>
                <Button variant="secondary" size="sm" data-testid="pack-close">
                  {t("opening.close")}
                </Button>
              </Dialog.Close>
            </div>
          </header>
          {series && series.total > 1 && !summaryOnly && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-line-1 px-4 py-2 lg:px-6">
              <Badge tone="accent" data-testid="pack-series">
                {t("opening.series", { n: series.index, total: series.total })}
              </Badge>
              {hasNext && onSkipAll && (
                <Button variant="ghost" size="sm" data-testid="pack-skip-all" onClick={onSkipAll}>
                  {t("opening.skipAll")}
                </Button>
              )}
            </div>
          )}
          {set && (
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
              {stage === "preview" && (
                <div className="flex flex-col items-center gap-6 px-4 py-6 lg:px-6" data-testid="pack-preview">
                  <TiltPack set={set.key} scale={desktop ? 4 : 3} />
                  <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
                    <p className="nums text-2xl font-semibold text-fg-1" data-testid="pack-price">
                      {formatMoney(price, { whole: true })}
                    </p>
                    <CountPicker count={count} onChange={setCount} />
                    {buyButton(
                      count > 1
                        ? t("shop.buyMany", { count, price: formatMoney(total, { whole: true }) })
                        : t("shop.buy", { price: formatMoney(price, { whole: true }) }),
                      "confirm-buy",
                    )}
                    {release.locked && release.time ? (
                      <p className="text-sm text-pretty text-fg-2" data-testid="pack-preview-note">
                        {t("shop.releasePreview", { time: release.time })}
                      </p>
                    ) : (
                      <BuySealedButton set={set.key} priceCents={price} cashCents={cashCents} />
                    )}
                    <p className="text-sm text-pretty text-fg-2">{t("opening.howTo")}</p>
                    <p className="text-xs text-fg-3">{t("opening.scrollHint")}</p>
                  </div>
                  <SetContents set={set.key} collection={collection} oneOfOnes={oneOfOnes} />
                </div>
              )}
              {pack && stage !== "preview" && (
                <div className="flex min-h-full flex-col items-center justify-center px-4 py-6">
                  {summaryOnly ? (
                    <div className="flex w-full flex-col items-center gap-3">
                      <p className="font-pixel text-sm text-fg-1 uppercase" data-testid="pack-all-title">
                        {t("opening.allTitle", { count: series?.total ?? 1 })}
                      </p>
                      <Summary pack={pack} thumbs>
                        <Actions>{again}</Actions>
                      </Summary>
                    </div>
                  ) : skipped ? (
                    <Summary pack={pack} thumbs>
                      <Actions>{again}</Actions>
                    </Summary>
                  ) : (
                    <PackOpening
                      key={pack.packId}
                      set={pack.set}
                      cards={cards}
                      scale={desktop ? 4 : 3}
                      onComplete={finish}
                      onReveal={(_, index) => setRevealed({ id: pack.packId, n: index + 1 })}
                      className="max-w-3xl"
                    >
                      <Summary pack={pack}>
                        <Actions>{again}</Actions>
                      </Summary>
                    </PackOpening>
                  )}
                  {!done && (
                    <p className="mt-4 max-w-sm text-center text-xs text-pretty text-fg-3">{t("opening.safe")}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** After a pack of a series, the next one opens by itself after this long (ADR-182). */
const NEXT_PACK_MS = 4_000;

/** How many packs to buy at once: 1 to packs.maxPerBuy (ADR-182). */
function CountPicker({ count, onChange }: { count: number; onChange: (count: number) => void }) {
  const t = useTranslations("nexamon");
  const max = BALANCE.nexamon.packs.maxPerBuy;
  return (
    <div className="flex items-center gap-2" role="group" aria-label={t("shop.count")} data-testid="pack-count">
      <Button
        variant="secondary"
        size="sm"
        aria-label={t("shop.countLess")}
        disabled={count <= 1}
        onClick={() => onChange(Math.max(1, count - 1))}
        data-testid="pack-count-less"
      >
        −
      </Button>
      <span className="w-8 text-center nums text-lg font-semibold text-fg-1" data-testid="pack-count-value">
        {count}
      </span>
      <Button
        variant="secondary"
        size="sm"
        aria-label={t("shop.countMore")}
        disabled={count >= max}
        onClick={() => onChange(Math.min(max, count + 1))}
        data-testid="pack-count-more"
      >
        +
      </Button>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  const t = useTranslations("nexamon");
  return (
    <div className="flex w-full flex-col items-center gap-2 sm:flex-row sm:items-start sm:justify-center">
      {children}
      <Dialog.Close asChild>
        <Link
          href="/nexamon?tab=collection"
          data-testid="pack-to-collection"
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "w-full sm:w-auto")}
        >
          {t("opening.toCollection")}
        </Link>
      </Dialog.Close>
    </div>
  );
}

/**
 * Everything that can be in a pack of the set: the cards by rarity, best first, with the pull rate of the rarity
 * (the two rolling slots and the average per pack) and the cards the player owns in colour, the others grey.
 */
function SetContents({
  set,
  collection,
  oneOfOnes,
}: {
  set: NexamonSetKey;
  collection: NexamonCollection | undefined;
  oneOfOnes: readonly NexamonOneOfOneStatus[];
}) {
  const status = new Map(oneOfOnes.map((x) => [x.cardKey, x]));
  const t = useTranslations("nexamon");
  const groups = useMemo(() => setContents(set, collection?.copies ?? []), [set, collection]);
  // What every card is worth right now: the collection read the page already has.
  const values = useMemo(
    () => new Map((collection?.cards ?? []).map((stats) => [stats.cardKey, stats.valueCents])),
    [collection],
  );
  return (
    <section className="w-full space-y-5 border-t-2 border-line-1 pt-5" data-testid="set-contents">
      <div>
        <h3 className="font-pixel text-sm text-fg-1 uppercase">{t("contents.title")}</h3>
        <p className="mt-1 text-sm text-pretty text-fg-2">{t("contents.intro")}</p>
      </div>
      {groups.map((group) => (
        <div key={group.rarity} className="space-y-2" data-testid="contents-group" data-rarity={group.rarity}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <RarityBadge rarity={group.rarity} />
            <span className="nums text-sm font-medium text-fg-1" data-testid="contents-rate">
              {group.odds.kind === "one_of_one"
                ? t("contents.oneOfOne", { count: formatInteger(group.odds.denominator) })
                : group.odds.kind === "tier"
                  ? t("odds.oneIn", { count: formatInteger(group.odds.oneInPacks ?? 0) })
                  : group.odds.kind === "base"
                    ? t("contents.base", { count: formatDecimal(group.odds.perPack) })
                    : group.odds.oneInPacks !== null
                      ? t("odds.oneIn", { count: formatInteger(group.odds.oneInPacks) })
                      : t("odds.perPack", { count: formatDecimal(group.odds.perPack) })}
            </span>
            <span className="nums text-xs text-fg-3">
              {group.odds.kind === "one_of_one"
                ? t("contents.oneOfOneLeft", {
                    count: group.cards.filter(({ card }) => !status.get(card.key)?.pulled).length,
                  })
                : group.odds.kind === "tier"
                  ? group.odds.max === 1
                    ? t("contents.tierOne")
                    : t("contents.tierRange", { min: group.odds.min ?? 1, max: group.odds.max ?? 1 })
                  : group.odds.kind !== "slots"
                    ? null
                    : group.odds.slot4 > 0
                      ? t("contents.slots", {
                          slot4: formatChance(chanceBps(group.odds.slot4, group.odds.denominator)),
                          slot5: formatChance(chanceBps(group.odds.slot5, group.odds.denominator)),
                        })
                      : t("contents.lastSlot", {
                          slot5: formatChance(chanceBps(group.odds.slot5, group.odds.denominator)),
                        })}
            </span>
            <span className="ml-auto nums text-xs text-fg-2" data-testid="contents-owned">
              {collection ? (
                t("contents.owned", { owned: group.owned, total: group.cards.length })
              ) : (
                <Skeleton className="h-3 w-16 rounded-xs" />
              )}
            </span>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,72px)] justify-between gap-1.5">
            {group.cards.map(({ card, owned }) => {
              const value = values.get(card.key);
              return (
                <li key={card.key} data-card={card.key} data-owned={owned > 0}>
                  <Tooltip
                    testId="contents-tip"
                    content={
                      <span className="flex flex-col items-start gap-1">
                        <span className="font-semibold text-fg-1">{card.name}</span>
                        <RarityBadge rarity={card.rarity} short />
                        {nexamonCardBonusDef(card) && (
                          <BonusTag
                            bonus={{ ...nexamonCardBonusDef(card)!, boostedBps: 0, active: false }}
                            showState={false}
                          />
                        )}
                        <span className="nums text-fg-2">
                          {t("contents.value")}{" "}
                          {value !== undefined ? (
                            <span className="font-semibold text-fg-1" data-testid="contents-tip-value">
                              {formatMoney(value)}
                            </span>
                          ) : (
                            t("contents.valueLoading")
                          )}
                        </span>
                      </span>
                    }
                  >
                    <button
                      type="button"
                      aria-label={
                        value !== undefined
                          ? t("contents.cardLabel", { name: card.name, value: formatMoney(value) })
                          : card.name
                      }
                      className="block rounded-xs focus-ring"
                      data-testid="contents-card"
                    >
                      <CardThumb card={card} scale={1} dimmed={collection !== undefined && owned === 0} />
                    </button>
                  </Tooltip>
                  {card.rarity === "one_of_one" && (
                    <span
                      className="mt-1 block w-[72px] text-center text-2xs leading-tight text-pretty text-fg-2"
                      data-testid="one-of-one-status"
                      data-pulled={Boolean(status.get(card.key)?.pulled)}
                    >
                      {!status.get(card.key)?.pulled
                        ? t("contents.oneOfOneOpen")
                        : status.get(card.key)?.pulledBy
                          ? t("contents.oneOfOneTaken", { name: status.get(card.key)!.pulledBy! })
                          : t("contents.oneOfOneTakenAnon")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** What was in the pack: every card with rarity, condition, value and a "Neu" marker, and the sum against the price. */
function Summary({
  pack,
  thumbs = false,
  children,
}: {
  pack: NexamonPackResult;
  thumbs?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("nexamon");
  const total = pack.cards.reduce((sum, c) => sum + c.valueCents, 0);
  const fresh = pack.cards.filter((c) => c.isNew).length;
  return (
    <div className="flex w-full max-w-xl flex-col gap-4" data-testid="pack-result">
      {thumbs && (
        <ul className="flex flex-wrap justify-center gap-1.5" aria-hidden>
          {pack.cards.map((pull) => {
            const card = nexamonCard(pull.cardKey);
            return card ? (
              <li key={pull.copyId}>
                <CardThumb card={card} scale={1} />
              </li>
            ) : null;
          })}
        </ul>
      )}
      <ul className="divide-y-2 divide-line-1 rounded-lg border-2 border-line-1 bg-surface-1">
        {pack.cards.map((pull) => (
          <PullRow key={pull.copyId} pull={pull} />
        ))}
      </ul>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-surface-2 px-2 py-2">
          <dt className="label-pixel text-fg-3">{t("opening.worth")}</dt>
          <dd className="nums font-semibold text-fg-1" data-testid="pack-worth">
            {formatMoney(total)}
          </dd>
        </div>
        <div className="rounded-md bg-surface-2 px-2 py-2">
          <dt className="label-pixel text-fg-3">{t("opening.paid")}</dt>
          <dd className="nums font-semibold text-fg-1">{formatMoney(pack.priceCents, { whole: true })}</dd>
        </div>
        <div className="rounded-md bg-surface-2 px-2 py-2">
          <dt className="label-pixel text-fg-3">{t("opening.newCards")}</dt>
          <dd className="nums font-semibold text-fg-1">{fresh}</dd>
        </div>
      </dl>
      {children}
    </div>
  );
}

function PullRow({ pull }: { pull: NexamonPull }) {
  const t = useTranslations("nexamon");
  const card = nexamonCard(pull.cardKey);
  if (!card) return null;
  const bonus = nexamonCardBonusDef(card);
  return (
    <li data-testid="pull-row" data-card={pull.cardKey} data-new={pull.isNew}>
      <Dialog.Close asChild>
        <Link
          href={`/nexamon/${pull.cardKey}`}
          className="flex items-center gap-3 px-3 py-2.5 focus-ring transition-colors duration-fast hover:bg-surface-2"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className={cn("truncate font-medium text-fg-1", isHit(pull.rarity) && "text-accent")}>
                {card.name}
              </span>
              {pull.isNew && <Badge tone="gain">{t("new")}</Badge>}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <RarityBadge rarity={pull.rarity} short />
              <ConditionBadge condition={pull.condition} />
              <span className="nums text-xs text-fg-3">{t("serial", { serial: pull.serial })}</span>
            </span>
            {bonus && <BonusTag bonus={{ ...bonus, boostedBps: bonus.bps, active: true }} className="mt-1" />}
          </span>
          <span className="shrink-0 nums font-semibold text-fg-1">{formatMoney(pull.valueCents)}</span>
        </Link>
      </Dialog.Close>
    </li>
  );
}
