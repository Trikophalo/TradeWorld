"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";
import { nexamonCard, type NexamonCard, type NexamonSetKey } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import type {
  NexamonCollection,
  NexamonPackResult,
  NexamonPull,
  NexamonSetSummary,
} from "@/features/game/nexamon-types";
import { formatInteger, formatMoney } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { isHit } from "../lib";
import { chanceBps, formatChance, formatDecimal, setContents } from "../view";
import { ConditionBadge, RarityBadge } from "./badges";
import { CardThumb } from "./card-face";
import { TiltPack } from "./pack";
import { PackOpening } from "./pack-opening";

export interface PackOverlayProps {
  /** The set whose pack is on the table; null closes the popup. */
  set: NexamonSetSummary | null;
  /** A bought pack of this set that waits to be torn open; null while the player only looks. */
  pack: NexamonPackResult | null;
  /** For the list of all cards of the set and which of them the player owns. */
  collection: NexamonCollection | undefined;
  cashCents: number;
  /** Buys one pack of the set (the only step that costs money). */
  onBuy: () => void;
  buyState: ButtonState;
  onClose: () => void;
  /** The summary is showing (all cards pulled away or skipped). */
  onFinished: () => void;
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
  const finish = () => {
    if (!pack || done) return;
    setDoneId(pack.packId);
    onFinished();
  };
  const price = set?.packPriceCents ?? 0;
  const short = Math.max(0, price - cashCents);
  const stage = !pack ? "preview" : done ? "summary" : "opening";
  const buyButton = (label: string, testId: string) => (
    <div className="flex w-full flex-col items-center gap-1.5 sm:w-auto">
      <Button
        size="lg"
        state={buyState}
        disabled={short > 0}
        onClick={onBuy}
        data-testid={testId}
        className="w-full sm:w-auto"
      >
        {label}
      </Button>
      {short > 0 && <p className="text-xs text-warn">{t("shop.short", { amount: formatMoney(short) })}</p>}
    </div>
  );
  const again = buyButton(t("opening.again", { price: formatMoney(price, { whole: true }) }), "pack-again");

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
              {stage === "opening" && pack && (
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
          {set && (
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
              {stage === "preview" && (
                <div className="flex flex-col items-center gap-6 px-4 py-6 lg:px-6" data-testid="pack-preview">
                  <TiltPack set={set.key} scale={desktop ? 4 : 3} />
                  <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
                    <p className="nums text-2xl font-semibold text-fg-1" data-testid="pack-price">
                      {formatMoney(price, { whole: true })}
                    </p>
                    {buyButton(t("shop.buy", { price: formatMoney(price, { whole: true }) }), "confirm-buy")}
                    <p className="text-sm text-pretty text-fg-2">{t("opening.howTo")}</p>
                    <p className="text-xs text-fg-3">{t("opening.scrollHint")}</p>
                  </div>
                  <SetContents set={set.key} collection={collection} />
                </div>
              )}
              {pack && stage !== "preview" && (
                <div className="flex min-h-full flex-col items-center justify-center px-4 py-6">
                  {skipped ? (
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
function SetContents({ set, collection }: { set: NexamonSetKey; collection: NexamonCollection | undefined }) {
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
              {group.odds.oneInPacks !== null
                ? t("odds.oneIn", { count: formatInteger(group.odds.oneInPacks) })
                : t("odds.perPack", { count: formatDecimal(group.odds.perPack) })}
            </span>
            <span className="nums text-xs text-fg-3">
              {group.odds.slot4 > 0
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
          </span>
          <span className="shrink-0 nums font-semibold text-fg-1">{formatMoney(pull.valueCents)}</span>
        </Link>
      </Dialog.Close>
    </li>
  );
}
