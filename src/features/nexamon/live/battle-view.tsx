"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useRef } from "react";
import { BALANCE } from "@/config/balance";
import { nexamonCard, type NexamonRarity } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { burstConfetti } from "@/components/ui/effects";
import { PlayerFigure } from "@/components/ui/player-figure";
import { Skeleton } from "@/components/ui/skeleton";
import type { NexamonBattle, NexamonFigure, NexamonShownPull } from "@/features/game/pack-battle-types";
import { formatMoney } from "@/lib/format";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { battleShownSlots, rarityRank, type BattleSide } from "@/lib/sim/nexamon-battle";
import { playSound, type SoundName } from "@/lib/sound";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { RarityBadge } from "../components/badges";
import { CardThumb, NexamonCardBack, NexamonCardFace } from "../components/card-face";
import { NexamonPack } from "../components/pack";
import { useNexamonBattle, useServerClock } from "./hooks";
import { Reactions } from "./reactions";

const cfg = BALANCE.nexamon;
const REVEAL_SOUND: Record<NexamonRarity, SoundName> = {
  common: "cardShow",
  rare: "pullRare",
  ultra: "pullUltra",
  prisma: "pullPrisma",
  legendary: "pullLegendary",
  one_of_one: "pullOneOfOne",
  iron: "cardShow",
  titanium: "pullUltra",
  diamond: "pullLegendary",
  uranium: "pullUranium",
};

/** Where the shared clock stands: before the start, tearing, revealing slot n, decided. */
export function battlePhase(b: NexamonBattle, now: number | null) {
  if (!b.startsAt || now === null) return { phase: "waiting" as const, shown: 0, countdown: 0 };
  const startsAt = Date.parse(b.startsAt);
  if (now < startsAt) return { phase: "countdown" as const, shown: 0, countdown: Math.ceil((startsAt - now) / 1000) };
  const shown = Math.min(battleShownSlots(startsAt, now), b.challengerCards.length, b.opponentCards.length);
  if (shown === 0) return { phase: "tearing" as const, shown, countdown: 0 };
  const decided = b.winner !== null && b.decideAt !== null && now >= Date.parse(b.decideAt) && shown >= cfg.packSize;
  return { phase: decided ? ("decided" as const) : ("revealing" as const), shown, countdown: 0 };
}

export interface BattleViewProps {
  battleId: string | null;
  onClose: () => void;
}

/**
 * The Pack Battle (ADR-172), full screen: both packs side by side (on phones one above the other), both tear on the
 * shared clock, one slot per step on both sides at once with running totals, then the winner takes all ten cards.
 * Everyone (both players and any spectator) animates from the server's start time, so all see the same moment.
 */
export function BattleView({ battleId, onClose }: BattleViewProps) {
  const t = useTranslations("nexamonLive");
  const query = useNexamonBattle(battleId);
  const b = query.data;
  const now = useServerClock(b?.serverTime);
  const state = b ? battlePhase(b, now) : null;

  return (
    <Dialog.Root open={battleId !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-overlay bg-scrim backdrop-blur-sm" />
        <Dialog.Content
          data-testid="battle-view"
          data-phase={state?.phase ?? "loading"}
          aria-describedby={undefined}
          className="fixed inset-0 z-sheet flex flex-col bg-bg pt-safe pb-safe outline-none data-[state=open]:animate-[modal-in_var(--duration-slow)_var(--ease-out)]"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-line-1 px-4 py-3 lg:px-6">
            <div className="min-w-0">
              <Dialog.Title className="truncate font-pixel text-sm text-fg-1 uppercase">
                {t("battle.title")}
              </Dialog.Title>
              {b && (
                <p className="mt-0.5 nums text-xs text-fg-3">
                  {t("battle.stakes", { set: t(`sets.${b.set}`), price: formatMoney(b.priceCents, { whole: true }) })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {b && b.viewers > 0 && (
                <Badge tone="info" data-testid="battle-viewers">
                  {t("viewers", { count: b.viewers })}
                </Badge>
              )}
              <Dialog.Close asChild>
                <Button variant="secondary" size="sm" data-testid="battle-close">
                  {t("close")}
                </Button>
              </Dialog.Close>
            </div>
          </header>
          <div className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
            {!b || !state ? (
              <div className="grid gap-4 p-4 lg:grid-cols-2 lg:p-6">
                <Skeleton className="h-72 w-full rounded-lg" />
                <Skeleton className="h-72 w-full rounded-lg" />
              </div>
            ) : b.status === "pending" ||
              b.status === "declined" ||
              b.status === "expired" ||
              b.status === "cancelled" ||
              b.status === "aborted" ? (
              <div className="grid min-h-full place-items-center p-6 text-center" data-testid="battle-closed">
                <div className="max-w-sm space-y-3">
                  <p className="font-pixel text-sm text-fg-1 uppercase">{t(`battle.status.${b.status}`)}</p>
                  <Button variant="secondary" onClick={onClose}>
                    {t("close")}
                  </Button>
                </div>
              </div>
            ) : (
              <Arena
                battle={b}
                now={now}
                phase={state.phase}
                shown={state.shown}
                countdown={state.countdown}
                onClose={onClose}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Arena({
  battle: b,
  now,
  phase,
  shown,
  countdown,
  onClose,
}: {
  battle: NexamonBattle;
  now: number | null;
  phase: ReturnType<typeof battlePhase>["phase"];
  shown: number;
  countdown: number;
  onClose: () => void;
}) {
  const t = useTranslations("nexamonLive");
  const reduced = useReducedMotionConfig();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const winnerRef = useRef<HTMLDivElement | null>(null);
  const decided = phase === "decided";
  const winner: BattleSide | null = decided ? b.winner : null;

  // sounds, once per step of the shared clock
  const played = useRef<string>("");
  useEffect(() => {
    const key = `${phase}:${shown}:${countdown}`;
    if (played.current === key) return;
    played.current = key;
    if (phase === "countdown" && countdown > 0) void playSound("battleCountdown");
    if (phase === "tearing") void playSound("packTear");
    if (phase === "revealing" && shown > 0) {
      const best = [b.challengerCards[shown - 1], b.opponentCards[shown - 1]]
        .filter((p): p is NexamonShownPull => Boolean(p))
        .reduce<NexamonRarity>((r, p) => (rarityRank(p.rarity) > rarityRank(r) ? p.rarity : r), "common");
      // the last slot is louder: the decision is near
      void playSound(REVEAL_SOUND[best], shown === cfg.packSize ? 1.2 : 1);
      if (shown === cfg.packSize) void playSound("battleFuse");
    }
    if (phase === "decided") {
      void playSound(b.me === null ? "battleGong" : b.me === b.winner ? "battleFanfare" : "battleBust");
      if (winnerRef.current && (b.me === null || b.me === b.winner)) burstConfetti(winnerRef.current, 40);
    }
  }, [phase, shown, countdown, b]);

  const sides: BattleSide[] = ["challenger", "opponent"];
  const total = b.challengerCents + b.opponentCents;
  return (
    <div className="flex min-h-full flex-col">
      <div className="relative grid flex-1 grid-rows-2 gap-2 p-3 lg:grid-cols-[1fr_auto_1fr] lg:grid-rows-1 lg:gap-4 lg:p-6">
        {sides.map((side, i) => (
          <div key={side} className={cn("contents", i === 1 && "lg:[&>*]:order-3")}>
            <BattleSidePanel
              side={side}
              battle={b}
              figure={side === "challenger" ? b.challenger : b.opponent}
              cards={(side === "challenger" ? b.challengerCards : b.opponentCards).slice(0, shown)}
              shown={shown}
              phase={phase}
              winner={winner}
              reduced={Boolean(reduced)}
              desktop={desktop}
              innerRef={winner === side ? winnerRef : undefined}
            />
          </div>
        ))}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center lg:static lg:order-2 lg:translate-y-0 lg:items-center">
          <motion.span
            className="rounded-pill border-2 border-line-2 bg-surface-1 px-3 py-1 font-pixel text-sm text-fg-1 shadow-2"
            animate={phase === "countdown" && !reduced ? { scale: [1, 1.25, 1] } : undefined}
            transition={{ duration: DURATION.slower, repeat: phase === "countdown" ? Infinity : 0 }}
            data-testid="battle-center"
          >
            {phase === "countdown" ? countdown : t("battle.vs")}
          </motion.span>
        </div>
      </div>
      <AnimatePresence>
        {decided && b.winner && (
          <motion.section
            key="summary"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.slower, ease: EASE.out, delay: reduced ? 0 : 0.9 }}
            className="sticky bottom-0 border-t-2 border-line-1 bg-surface-1 px-4 py-4 text-center lg:px-6"
            data-testid="battle-summary"
            data-winner={b.winner}
          >
            <p className="font-pixel text-sm text-fg-1 uppercase">
              {b.me === null
                ? t("battle.winnerIs", { name: (b.winner === "challenger" ? b.challenger : b.opponent).nickname })
                : b.me === b.winner
                  ? t("battle.youWin")
                  : t("battle.youLose")}
            </p>
            <p className="mt-1 nums text-sm text-fg-2">
              {t("battle.takes", { count: cfg.packSize * 2, value: formatMoney(total) })}
            </p>
            {b.tieBreak && b.tieBreak !== "value" && (
              <p className="mt-1 text-xs text-fg-3" data-testid="battle-tiebreak">
                {t(`battle.tieBreak.${b.tieBreak}`)}
              </p>
            )}
            <div className="mt-3 flex justify-center">
              <Button onClick={onClose} data-testid="battle-done">
                {t("battle.done")}
              </Button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      {b.liveId && now !== null && <Reactions liveId={b.liveId} reactions={b.reactions} canReact={b.me === null} />}
    </div>
  );
}

function BattleSidePanel({
  side,
  battle: b,
  figure,
  cards,
  shown,
  phase,
  winner,
  reduced,
  desktop,
  innerRef,
}: {
  side: BattleSide;
  battle: NexamonBattle;
  figure: NexamonFigure;
  cards: NexamonShownPull[];
  shown: number;
  phase: ReturnType<typeof battlePhase>["phase"];
  winner: BattleSide | null;
  reduced: boolean;
  desktop: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  const t = useTranslations("nexamonLive");
  const sum = cards.reduce((s, p) => s + p.valueCents, 0);
  const last = cards[cards.length - 1];
  const lastCard = last ? nexamonCard(last.cardKey) : undefined;
  const lost = winner !== null && winner !== side;
  const won = winner === side;
  const scale = desktop ? 3 : 2;
  // cards fly to the winner's side: down or right for the challenger's, up or left for the opponent's
  const fly = side === "challenger" ? (desktop ? { x: 260 } : { y: 220 }) : desktop ? { x: -260 } : { y: -220 };
  const flash = last && last.rarity !== "common" && phase === "revealing";

  return (
    <motion.div
      ref={innerRef}
      className={cn(
        "relative flex min-w-0 flex-col items-center gap-2 overflow-hidden rounded-lg border-2 bg-surface-1 p-3 lg:gap-4 lg:p-5",
        won ? "border-gold" : "border-line-1",
      )}
      animate={{ opacity: lost ? 0.4 : 1, scale: won && !reduced ? 1.02 : 1 }}
      transition={{ duration: DURATION.slower, ease: EASE.out }}
      data-testid={`battle-side-${side}`}
      data-shown={cards.length}
      data-total={sum}
    >
      <div className="flex w-full items-center gap-2">
        <PlayerFigure avatarKey={figure.avatarKey} accessories={figure.accessories} scale={2} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg-1">
            {figure.nickname}
            {b.me === side && <span className="ml-1 text-xs text-fg-3">{t("you")}</span>}
          </p>
          <p className="text-xs text-fg-3">{t("level", { level: figure.level })}</p>
        </div>
        <div className="text-right">
          <motion.p
            key={sum}
            className="nums text-lg font-semibold text-fg-1"
            initial={reduced ? false : { scale: 1.25, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={SPRING.bouncy}
            data-testid={`battle-total-${side}`}
          >
            {formatMoney(sum)}
          </motion.p>
          {won && (
            <Badge tone="warn" data-testid="battle-winner-badge">
              {t("battle.winner")}
            </Badge>
          )}
        </div>
      </div>

      <div className="relative grid min-h-0 flex-1 place-items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {phase === "countdown" || phase === "tearing" || phase === "waiting" ? (
            <motion.div
              key="pack"
              initial={false}
              animate={
                phase === "tearing" && !reduced
                  ? { rotate: [0, -4, 4, -3, 0], y: [0, -6, 0] }
                  : phase === "countdown" && !reduced
                    ? { y: [0, -4, 0] }
                    : undefined
              }
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: DURATION.fast } }
                  : { opacity: 0, scale: 1.3, y: -30, transition: { duration: DURATION.slow, ease: EASE.out } }
              }
              transition={{ duration: phase === "tearing" ? 0.5 : 1.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <NexamonPack set={b.set} scale={desktop ? 3 : 2} />
            </motion.div>
          ) : lastCard ? (
            <motion.div
              key={`card-${shown}`}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: side === "challenger" ? -8 : 8 }}
              animate={
                lost && !reduced ? { opacity: 0, ...fly, scale: 0.5 } : { opacity: 1, scale: 1, rotate: 0, x: 0, y: 0 }
              }
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              transition={lost ? { duration: 0.9, ease: EASE.in, delay: 0.3 } : SPRING.bouncy}
              className="relative"
              data-testid={`battle-spotlight-${side}`}
            >
              <NexamonCardFace card={lastCard} scale={scale} foil={reduced ? "still" : "live"} />
              <span className="absolute -top-2 left-1/2 -translate-x-1/2">
                <RarityBadge rarity={last!.rarity} />
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence>
          {flash && (
            <motion.span
              key={`flash-${shown}`}
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-lg bg-gold"
              initial={{ opacity: 0 }}
              animate={{ opacity: reduced ? [0, 0.15, 0] : [0, 0.45, 0] }}
              transition={{ duration: 0.6, ease: EASE.out }}
            />
          )}
        </AnimatePresence>
      </div>

      <ol className="flex w-full justify-center" aria-label={t("battle.slots")}>
        {Array.from({ length: cfg.packSize }, (_, i) => {
          const pull = cards[i];
          const card = pull ? nexamonCard(pull.cardKey) : undefined;
          return (
            <li key={i} className={cn("relative", i > 0 && "-ml-4 sm:ml-1")} style={{ zIndex: i }}>
              {card ? (
                <motion.div
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
                  animate={lost && !reduced ? { opacity: 0, ...fly } : { opacity: 1, y: 0, x: 0 }}
                  transition={
                    lost
                      ? { duration: 0.8, ease: EASE.in, delay: 0.4 + i * 0.06 }
                      : { duration: DURATION.slow, ease: EASE.out }
                  }
                >
                  <CardThumb card={card} scale={1} />
                </motion.div>
              ) : (
                <NexamonCardBack scale={1} className="opacity-60" />
              )}
            </li>
          );
        })}
      </ol>
    </motion.div>
  );
}
