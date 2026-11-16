"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";
import { nexamonCard, type NexamonCard } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import type { NexamonPackResult, NexamonPull } from "@/features/game/nexamon-types";
import { formatMoney } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { isHit } from "../lib";
import { ConditionBadge, RarityBadge } from "./badges";
import { CardThumb } from "./card-face";
import { PackOpening } from "./pack-opening";

export interface PackOverlayProps {
  /** The bought pack; null closes the overlay. */
  pack: NexamonPackResult | null;
  /** The player closed the overlay; `finished` says whether every card was seen. */
  onClose: (finished: boolean) => void;
  /** The summary is showing (all cards pulled away or skipped). */
  onFinished: () => void;
  /** "Open another": buys the next pack of the same set. */
  onAgain: () => void;
  againState: ButtonState;
  againLabel: string;
  canAfford: boolean;
}

/**
 * Opening a bought pack on the whole screen. The server has already paid and the cards are in the collection,
 * so closing or skipping loses nothing; the summary lists every card with value, condition and what is new.
 */
export function PackOverlay({
  pack,
  onClose,
  onFinished,
  onAgain,
  againState,
  againLabel,
  canAfford,
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

  return (
    <Dialog.Root open={pack !== null} onOpenChange={(open) => !open && onClose(done)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-overlay bg-scrim data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-out)]" />
        <Dialog.Content
          data-testid="pack-overlay"
          aria-describedby={undefined}
          className="fixed inset-0 z-sheet flex flex-col overflow-x-hidden overflow-y-auto bg-bg pt-safe pb-safe outline-none data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-out)]"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 lg:px-6">
            <Dialog.Title className="min-w-0 truncate font-pixel text-sm text-fg-1 uppercase">
              {pack ? t("opening.title", { set: tc(`sets.${pack.set}`) }) : t("title")}
            </Dialog.Title>
            <div className="flex shrink-0 items-center gap-2">
              {pack && !done && (
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
          {pack && (
            <div className="flex flex-1 flex-col items-center justify-center px-4 pb-8">
              {skipped ? (
                <Summary pack={pack} thumbs>
                  <Actions onAgain={onAgain} againState={againState} againLabel={againLabel} canAfford={canAfford} />
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
                    <Actions onAgain={onAgain} againState={againState} againLabel={againLabel} canAfford={canAfford} />
                  </Summary>
                </PackOpening>
              )}
              {!done && <p className="mt-4 max-w-sm text-center text-xs text-pretty text-fg-3">{t("opening.safe")}</p>}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Actions({
  onAgain,
  againState,
  againLabel,
  canAfford,
}: Pick<PackOverlayProps, "onAgain" | "againState" | "againLabel" | "canAfford">) {
  const t = useTranslations("nexamon");
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
      <Button size="lg" state={againState} disabled={!canAfford} onClick={onAgain} data-testid="pack-again">
        {againLabel}
      </Button>
      <Dialog.Close asChild>
        <Link
          href="/nexamon?tab=collection"
          data-testid="pack-to-collection"
          className={buttonVariants({ variant: "secondary", size: "lg" })}
        >
          {t("opening.toCollection")}
        </Link>
      </Dialog.Close>
    </div>
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
