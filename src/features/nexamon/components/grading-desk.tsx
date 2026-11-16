"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { nexamonCard, type NexamonCard } from "@/config/nexamon";
import { BALANCE } from "@/config/balance";
import { UI_ICONS } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { burstConfetti } from "@/components/ui/effects";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { NexamonCollection, NexamonCopy, NexamonOverview } from "@/features/game/nexamon-types";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { playSound, type SoundName } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useNexamonRefresh, useRevealedSlabs } from "../hooks";
import { formatChance, formatFactor, gradingQueue, revealKey, splitGraded } from "../view";
import { ConditionBadge } from "./badges";
import { CopyVisual, GradeChip, Stat } from "./parts";
import { NexamonSlab } from "./slab";

const dateTime = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const cfg = BALANCE.nexamon.grading;

/** The sound of a grade: a fanfare for a 10, a chime from 8, a plain blip below. */
function gradeSound(grade: number): SoundName {
  if (grade >= 10) return "levelUp";
  if (grade >= 8) return "win";
  return "blip";
}

/**
 * The ASP desk (ADR-165): copies that are being graded with their countdown, slabs that came back and wait to be
 * revealed, and every slab the player holds as the history.
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
  const reveal = (copies: readonly NexamonCopy[]) => {
    const keys = copies.map(revealKey);
    setSession((current) => [...new Set([...current, ...keys])]);
    markRevealed(keys);
    const best = Math.max(...copies.map((c) => c.grade ?? 1));
    void playSound(gradeSound(best));
    haptic(best >= 8 ? "success" : "tap");
  };
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
            best: formatFactor(cfg.valueBps[9]),
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
                  onReveal={() => reveal([copy])}
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
    </div>
  );
}

/**
 * A slab that came back from ASP: it lies face down until the player turns it over. Then it flips, pops a little,
 * the grade's sound plays and a 10 gets confetti. With reduced motion the sides only cross-fade.
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
  const reduced = useReducedMotionConfig() ?? false;
  const anchor = useRef<HTMLDivElement>(null);
  const grade = copy.grade ?? 1;
  const factor = cfg.valueBps[grade - 1] ?? 10_000;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current && grade === 10 && anchor.current) burstConfetti(anchor.current, 32);
    wasOpen.current = open;
  }, [open, grade]);
  return (
    <li
      className="flex w-[172px] flex-col items-center gap-2"
      data-testid="slab-reveal"
      data-open={open}
      data-card={copy.cardKey}
    >
      <motion.div
        ref={anchor}
        initial={false}
        animate={open && !reduced ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={open ? { duration: DURATION.slower, ease: EASE.out } : SPRING.smooth}
        className="relative"
      >
        {open && grade >= 9 && (
          <div
            aria-hidden
            className={cn(
              "absolute -inset-3 opacity-80",
              grade === 10 ? "nexamon-glow-legendary" : "nexamon-glow-ultra",
            )}
          />
        )}
        <NexamonSlab
          card={card}
          grade={grade}
          serial={copy.serial}
          scale={2}
          side={open ? "front" : "back"}
          tilt={false}
          flippable={false}
          className="relative"
        />
      </motion.div>
      {open ? (
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
      ) : (
        <>
          <p className="max-w-full truncate text-sm text-fg-1">{card.name}</p>
          <Button size="sm" onClick={onReveal} data-testid="reveal-button">
            {t("grading.reveal")}
          </Button>
        </>
      )}
    </li>
  );
}
