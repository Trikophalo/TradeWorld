"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { nexamonCard, type NexamonCard } from "@/config/nexamon";
import { BALANCE } from "@/config/balance";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { NexamonCollection, NexamonCopy, NexamonOverview } from "@/features/game/nexamon-types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { nexamonCopyFactorBps } from "@/lib/sim/nexamon";
import { playSound, type SoundName } from "@/lib/sound";
import { useMediaQuery } from "@/lib/use-media-query";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useNexamonCollection, useNexamonRefresh, useRevealedSlabs } from "../hooks";
import { formatChance, formatFactor, gradingQueue, revealKey, splitGraded } from "../view";
import { ConditionBadge } from "./badges";
import { GradeReveal, GradingPack, gradeTier } from "./grading-reveal";
import { CopyVisual, GradeChip, Stat } from "./parts";
import { NexamonSlab } from "./slab";

const dateTime = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const cfg = BALANCE.nexamon.grading;

/** The sound of a grade opened without the show: the result sound of its tier. */
const QUICK_SOUND: Record<ReturnType<typeof gradeTier>, SoundName> = {
  low: "gradeLow",
  good: "gradeGood",
  ten: "gradeTen",
  black: "blackLabel",
};

/**
 * The ASP desk (ADR-165): copies that are being graded with their countdown, slabs that came back in a sealed
 * package and wait to be opened (the grade reveal), and every slab the player holds as the history.
 */
export function GradingDesk({
  overview,
  collection,
}: {
  overview: NexamonOverview | undefined;
  collection: NexamonCollection | undefined;
}) {
  const t = useTranslations("nexamon");
  const refresh = useNexamonRefresh();
  const now = useClock();
  const [revealed, markRevealed] = useRevealedSlabs();
  // Slabs revealed while this desk is open stay in the reveal row instead of jumping to the history.
  const [session, setSession] = useState<readonly string[]>([]);
  // The package on the table: its reveal key, or null while the overlay is closed.
  const [opening, setOpening] = useState<string | null>(null);
  const queue = collection ? gradingQueue(collection.copies) : [];
  const nextDue = queue[0]?.gradingUntil ? Date.parse(queue[0].gradingUntil) : null;
  const due = nextDue !== null && now !== null && now >= nextDue;
  // A countdown that ran out: read again, the server hands the slab over on reading.
  useEffect(() => {
    if (!due) return;
    const timer = window.setTimeout(() => void refresh(), 1_200);
    return () => window.clearTimeout(timer);
  }, [due, refresh]);

  if (!collection) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  const { fresh, seen } = splitGraded(
    collection.copies,
    revealed.filter((key) => !session.includes(key)),
  );
  const history = seen;
  const waiting = fresh.filter((copy) => !session.includes(revealKey(copy)));
  /** The grade of these slabs is on the table: they stay in the row for now and join the history next time. */
  const mark = (copies: readonly NexamonCopy[]) => {
    const keys = copies.map(revealKey);
    setSession((current) => [...new Set([...current, ...keys])]);
    markRevealed(keys);
  };
  /** Opens packages without the show. */
  const reveal = (copies: readonly NexamonCopy[]) => {
    mark(copies);
    const best = Math.max(...copies.map((c) => c.grade ?? 1));
    void playSound(QUICK_SOUND[gradeTier(best)]);
    haptic(best >= 8 ? "success" : "tap");
  };
  const onTable = opening === null ? null : (fresh.find((copy) => revealKey(copy) === opening) ?? null);
  const max = overview?.limits.maxGrading ?? cfg.maxOpen;

  return (
    <div className="space-y-4" data-testid="nexamon-grading">
      <Card padding="lg">
        <CardHeader>
          <CardTitle>{t("grading.title")}</CardTitle>
        </CardHeader>
        <p className="text-sm text-pretty text-fg-2">
          {t("grading.intro", {
            rate: formatChance(cfg.feeBps),
            minutes: cfg.minutes,
            best: formatFactor(cfg.valueBps.at(-1)!),
            black: formatFactor(cfg.blackLabel.valueBps),
          })}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label={t("grading.running")} testId="grading-running">
            {t("grading.slots", { count: queue.length, max })}
          </Stat>
          <Stat label={t("grading.waiting")} testId="grading-waiting">
            {waiting.length}
          </Stat>
          <Stat label={t("grading.slabs")} testId="grading-slabs">
            {fresh.length + history.length}
          </Stat>
        </div>
      </Card>

      {fresh.length > 0 && (
        <Card padding="lg" className="border-accent" data-testid="grading-reveals">
          <CardHeader>
            <CardTitle>{t("grading.backTitle")}</CardTitle>
            {waiting.length > 1 && (
              <Button size="sm" variant="secondary" onClick={() => reveal(waiting)} data-testid="reveal-all">
                {t("grading.revealAll")}
              </Button>
            )}
          </CardHeader>
          <ul className="flex flex-wrap justify-center gap-x-4 gap-y-5 sm:justify-start">
            {fresh.map((copy) => {
              const card = nexamonCard(copy.cardKey);
              if (!card) return null;
              return (
                <SlabReveal
                  key={revealKey(copy)}
                  copy={copy}
                  card={card}
                  open={session.includes(revealKey(copy))}
                  onReveal={() => setOpening(revealKey(copy))}
                />
              );
            })}
          </ul>
        </Card>
      )}

      <Card padding="lg" data-testid="grading-queue">
        <CardHeader>
          <CardTitle>{t("grading.queueTitle")}</CardTitle>
        </CardHeader>
        {queue.length === 0 ? (
          <EmptyState
            art={<PixelIcon {...UI_ICONS.star} scale={4} />}
            title={t("grading.emptyTitle")}
            description={t("grading.emptyText")}
            action={
              <Link
                href="/nexamon?tab=collection"
                className="text-sm font-medium text-accent focus-ring hover:underline"
              >
                {t("grading.toCollection")}
              </Link>
            }
            className="py-6"
          />
        ) : (
          <ul className="divide-y-2 divide-line-1">
            {queue.map((copy) => {
              const card = nexamonCard(copy.cardKey);
              if (!card) return null;
              return (
                <li
                  key={copy.id}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  data-testid="grading-row"
                  data-card={copy.cardKey}
                >
                  <Link href={`/nexamon/${card.key}`} aria-label={card.name} className="shrink-0 rounded-sm focus-ring">
                    <CopyVisual card={card} scale={1} />
                  </Link>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium text-fg-1">{card.name}</p>
                    <p className="flex flex-wrap items-center gap-1.5">
                      <ConditionBadge condition={copy.condition} />
                      <span className="nums text-xs text-fg-3">{t("serial", { serial: copy.serial })}</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="label-pixel text-fg-3">{t("grading.backIn")}</p>
                    {copy.gradingUntil && (
                      <Countdown target={Date.parse(copy.gradingUntil)} className="text-lg font-semibold text-fg-1" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card padding="lg" data-testid="grading-history">
        <CardHeader>
          <CardTitle>{t("grading.historyTitle")}</CardTitle>
        </CardHeader>
        {history.length === 0 ? (
          <p className="text-sm text-pretty text-fg-3">{t("grading.historyEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line-1">
            {history.map((copy) => {
              const card = nexamonCard(copy.cardKey);
              if (!card || copy.grade === null) return null;
              return (
                <li key={copy.id} data-testid="history-row" data-grade={copy.grade}>
                  <Link
                    href={`/nexamon/${card.key}`}
                    className="flex items-center gap-3 py-2 focus-ring transition-colors duration-fast hover:bg-surface-2"
                  >
                    <GradeChip grade={copy.grade} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-fg-1">{card.name}</span>
                      <span className="block nums text-xs text-fg-3">
                        {t("serial", { serial: copy.serial })}
                        {copy.gradedAt && ` · ${dateTime.format(new Date(copy.gradedAt))}`}
                      </span>
                    </span>
                    <span className="shrink-0 nums font-semibold text-fg-1">{formatMoney(copy.valueCents)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-pretty text-fg-3">{t("grading.historyNote")}</p>
      </Card>

      <GradingOverlay
        copy={onTable}
        waiting={waiting.filter((copy) => !onTable || copy.id !== onTable.id)}
        onResult={(copy) => mark([copy])}
        onNext={(copy) => setOpening(revealKey(copy))}
        onClose={() => setOpening(null)}
      />
    </div>
  );
}

/**
 * The popup of a package from ASP: the sealed package, torn open by hand, then the slow reveal of the grade
 * (GradeReveal). The slab is in the collection long before; closing before the result leaves the package sealed
 * for later, exactly like an unopened booster.
 */
function GradingOverlay({
  copy,
  waiting,
  onResult,
  onNext,
  onClose,
}: {
  copy: NexamonCopy | null;
  waiting: readonly NexamonCopy[];
  onResult: (copy: NexamonCopy) => void;
  onNext: (copy: NexamonCopy) => void;
  onClose: () => void;
}) {
  const t = useTranslations("nexamon");
  const desktop = useMediaQuery("(min-width: 1024px) and (min-height: 800px)");
  const card = copy ? nexamonCard(copy.cardKey) : undefined;
  const next = waiting[0];
  return (
    <Dialog.Root open={copy !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-overlay bg-scrim backdrop-blur-sm data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-out)]" />
        <Dialog.Content
          data-testid="grading-overlay"
          aria-describedby={undefined}
          className={cn(
            "fixed inset-0 z-sheet flex flex-col bg-bg pt-safe pb-safe outline-none",
            "lg:m-auto lg:h-[min(94dvh,900px)] lg:w-[min(94vw,720px)] lg:rounded-xl lg:border-2 lg:border-line-2 lg:shadow-3",
            "data-[state=open]:animate-[modal-in_var(--duration-slow)_var(--ease-out)]",
          )}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-line-1 px-4 py-3 lg:px-6">
            <div className="min-w-0">
              <Dialog.Title className="truncate font-pixel text-sm text-fg-1 uppercase">
                {t("reveal.title")}
              </Dialog.Title>
              {card && copy && (
                <p className="mt-0.5 truncate text-xs text-fg-3">
                  {card.name} · {t("serial", { serial: copy.serial })}
                </p>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm" data-testid="grading-close">
                {t("reveal.close")}
              </Button>
            </Dialog.Close>
          </header>
          {copy && card && copy.grade !== null && (
            <div className="flex min-h-0 flex-1 flex-col items-center overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-6">
              <div className="my-auto flex w-full flex-col items-center">
                <GradeReveal
                  key={revealKey(copy)}
                  card={card}
                  grade={copy.grade}
                  serial={copy.serial}
                  valueCents={copy.valueCents}
                  scale={desktop ? 3 : 2}
                  onResult={() => onResult(copy)}
                >
                  <div className="mt-2 flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-center">
                    {next && (
                      <Button onClick={() => onNext(next)} data-testid="grading-next">
                        {t("reveal.next", { count: waiting.length })}
                      </Button>
                    )}
                    <Dialog.Close asChild>
                      <Link
                        href={`/nexamon/${card.key}`}
                        className="text-sm font-medium text-accent focus-ring hover:underline"
                        data-testid="grading-to-card"
                      >
                        {t("grading.toCard")}
                      </Link>
                    </Dialog.Close>
                  </div>
                </GradeReveal>
                <p className="mt-4 max-w-sm text-center text-xs text-pretty text-fg-3">{t("reveal.safe")}</p>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * A slab that came back from ASP. Until the player has opened it, it is a sealed package (the grade stays secret);
 * afterwards the slab stands there with its grade, its value and the factor against the market value.
 */
function SlabReveal({
  copy,
  card,
  open,
  onReveal,
}: {
  copy: NexamonCopy;
  card: NexamonCard;
  open: boolean;
  onReveal: () => void;
}) {
  const t = useTranslations("nexamon");
  const grade = copy.grade ?? 1;
  const tier = gradeTier(grade);
  const popularity = useNexamonCollection().data?.cards.find((c) => c.cardKey === copy.cardKey)?.popularityBps ?? null;
  const factor = nexamonCopyFactorBps(copy.condition, grade, undefined, popularity);
  return (
    <li
      className="flex w-[172px] flex-col items-center gap-2"
      data-testid="slab-reveal"
      data-open={open}
      data-card={copy.cardKey}
    >
      {open ? (
        <>
          <div className="relative">
            {tier !== "low" && (
              <div
                aria-hidden
                className={cn(
                  "absolute -inset-3 opacity-80",
                  tier === "black"
                    ? "nexamon-glow-black"
                    : tier === "ten"
                      ? "nexamon-glow-legendary"
                      : "nexamon-glow-ultra",
                )}
              />
            )}
            <NexamonSlab
              card={card}
              grade={grade}
              serial={copy.serial}
              scale={2}
              tilt={false}
              flippable={false}
              className="relative"
            />
          </div>
          <div className="flex flex-col items-center gap-1 text-center" aria-live="polite">
            <GradeChip grade={grade} />
            <span className="nums text-sm font-semibold text-fg-1" data-testid="reveal-value">
              {formatMoney(copy.valueCents)}
            </span>
            <span className={cn("nums text-xs", factor > 10_000 ? "text-gain" : "text-loss")}>
              {t("grading.factor", { factor: formatFactor(factor) })}
            </span>
            <Link href={`/nexamon/${card.key}`} className="text-xs font-medium text-accent focus-ring hover:underline">
              {t("grading.toCard")}
            </Link>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onReveal}
            aria-label={`${t("grading.reveal")}: ${card.name}`}
            className="rounded-sm focus-ring transition-transform duration-fast hover:scale-[1.03] active:scale-[0.98]"
            data-testid="reveal-pack"
          >
            <GradingPack scale={2} />
          </button>
          <p className="max-w-full truncate text-sm text-fg-1">{card.name}</p>
          <p className="label-pixel text-fg-3">{t("grading.sealed")}</p>
          <Button size="sm" onClick={onReveal} data-testid="reveal-button">
            {t("grading.reveal")}
          </Button>
        </>
      )}
    </li>
  );
}
