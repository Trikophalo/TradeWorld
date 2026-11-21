"use client";

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useRef } from "react";
import { BALANCE } from "@/config/balance";
import { nexamonCard, type NexamonRarity } from "@/config/nexamon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { burstConfetti } from "@/components/ui/effects";
import { PlayerFigure } from "@/components/ui/player-figure";
import { Skeleton } from "@/components/ui/skeleton";
import type { NexamonBattle, NexamonBattleSeat, NexamonShownPull } from "@/features/game/pack-battle-types";
import { formatMoney } from "@/lib/format";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { rarityRank, twistCycles, twistScores } from "@/lib/sim/nexamon-battle";
import { playSound, type SoundName } from "@/lib/sound";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { RarityBadge } from "../components/badges";
import { InstantSell } from "../components/instant-sell";
import { useNexamonCollection } from "../hooks";
import { CardThumb, NexamonCardBack, NexamonCardFace } from "../components/card-face";
import { NexamonPack } from "../components/pack";
import { useNexamonBattle, useServerClock } from "./hooks";
import { BattleLobby, BattleModeBadges } from "./battle-lobby";
import { battlePhase, type BattlePhase } from "./battle-phase";
import { battleRevealTier } from "./battle-reveal";
import { BattleRevealFx } from "./battle-reveal-fx";
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

export { battlePhase, type BattlePhase } from "./battle-phase";

export interface BattleViewProps {
  battleId: string | null;
  onClose: () => void;
}

/**
 * The Pack Battle (ADR-172/192), full screen: up to four players open the same lineup pack by pack on the shared
 * clock, one card per step on every seat at once with running totals; then the winner takes every card. On phones
 * two players stand one above the other, three or four in a 2×2 grid; from `lg` side by side. A lobby that waits
 * for players shows its seats (BattleLobby).
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
          data-phase={b?.status === "pending" ? "lobby" : (state?.phase ?? "loading")}
          data-players={b?.size}
          aria-describedby={undefined}
          className="fixed inset-0 z-sheet flex flex-col bg-bg pt-safe pb-safe outline-none data-[state=open]:animate-[modal-in_var(--duration-slow)_var(--ease-out)]"
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-line-1 px-4 py-3 lg:px-6">
            <div className="min-w-0">
              <Dialog.Title className="truncate font-pixel text-sm text-fg-1 uppercase">
                {t("battle.title")}
              </Dialog.Title>
              {b && (
                <p className="mt-0.5 truncate nums text-xs text-fg-3">
                  {b.packs.length === 1
                    ? t("battle.stakes", { set: t(`sets.${b.set}`), price: formatMoney(b.priceCents, { whole: true }) })
                    : t("battle.stakesMulti", {
                        packs: b.packs.length,
                        price: formatMoney(b.priceCents, { whole: true }),
                      })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {b && <BattleModeBadges reverse={b.reverse} twist={b.twist} />}
              {b && state && b.packs.length > 1 && (b.status === "running" || b.status === "done") && (
                <Badge tone="neutral" data-testid="battle-pack-no">
                  {t("battle.packNo", { n: state.pack, count: b.packs.length })}
                </Badge>
              )}
              {b && b.viewers > 0 && (
                <Badge tone="info" className="hidden sm:inline-flex" data-testid="battle-viewers">
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
              <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4 lg:p-6">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-64 w-full rounded-lg" />
                ))}
              </div>
            ) : b.status === "pending" && b.mode === "multi" ? (
              <BattleLobby battle={b} onClose={onClose} />
            ) : b.status === "pending" ||
              b.status === "declined" ||
              b.status === "expired" ||
              b.status === "cancelled" ||
              b.status === "aborted" ? (
              <div className="grid min-h-full place-items-center p-6 text-center" data-testid="battle-closed">
                <div className="max-w-sm space-y-3">
                  <p className="font-pixel text-sm text-fg-1 uppercase">
                    {b.mode === "multi" && b.status !== "pending"
                      ? t(`battle.statusMulti.${b.status}`)
                      : t(`battle.status.${b.status}`)}
                  </p>
                  <Button variant="secondary" onClick={onClose}>
                    {t("close")}
                  </Button>
                </div>
              </div>
            ) : (
              <Arena battle={b} now={now} state={state} onClose={onClose} />
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
  state,
  onClose,
}: {
  battle: NexamonBattle;
  now: number | null;
  state: ReturnType<typeof battlePhase>;
  onClose: () => void;
}) {
  const t = useTranslations("nexamonLive");
  const reduced = useReducedMotionConfig();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const winnerRef = useRef<HTMLDivElement | null>(null);
  const { phase, shown, countdown, pack, twists } = state;
  const decided = phase === "decided";
  const winner = decided ? b.winnerSeat : null;
  const many = b.seats.length > 2;
  // ADR-205: what every seat holds so far (its pile after the twists shown); without Twist its own pulls
  const applied = b.twists.slice(0, twists);
  const scores = twistScores(
    b.seats.map((s) => s.cards.slice(0, shown)),
    applied,
    b.packs.length,
  );
  const lastTwist = applied[applied.length - 1];
  // right after a twist (while it plays and the next pack tears) a seat shows whose pile it took
  const fresh = lastTwist !== undefined && shown === twists * cfg.packSize && !decided;

  // sounds, once per step of the shared clock
  const played = useRef<string>("");
  useEffect(() => {
    const key = `${phase}:${shown}:${countdown}`;
    if (played.current === key) return;
    played.current = key;
    if (phase === "countdown" && countdown > 0) void playSound("battleCountdown");
    if (phase === "tearing") void playSound("packTear");
    if (phase === "twisting") {
      void playSound("battleWhoosh");
      void playSound("battleZap");
    }
    if (phase === "revealing" && shown > 0) {
      const best = b.seats
        .map((s) => s.cards[shown - 1])
        .filter((p): p is NexamonShownPull => Boolean(p))
        .reduce<NexamonRarity>((r, p) => (rarityRank(p.rarity) > rarityRank(r) ? p.rarity : r), "common");
      const last = shown === b.packs.length * cfg.packSize;
      // the last card of the lineup is louder: the decision is near
      void playSound(REVEAL_SOUND[best], last ? 1.2 : 1);
      if (last) void playSound("battleFuse");
      // ADR-205: the last two cards of a pack hit harder
      const slot = ((shown - 1) % cfg.packSize) + 1;
      if (battleRevealTier(best, slot, cfg.packSize) >= 3) void playSound("battleImpact");
    }
    if (phase === "decided") {
      void playSound(b.mySeat === null ? "battleGong" : b.mySeat === b.winnerSeat ? "battleFanfare" : "battleBust");
      if (winnerRef.current && (b.mySeat === null || b.mySeat === b.winnerSeat)) burstConfetti(winnerRef.current, 40);
    }
  }, [phase, shown, countdown, b]);

  const total = b.seats.reduce((s, x) => s + x.cents, 0);
  const cards = b.seats.reduce((s, x) => s + x.cards.length, 0);
  const winnerSeat = b.seats.find((s) => s.seat === b.winnerSeat);
  const scoreOf = (seat: number) => scores[b.seats.findIndex((s) => s.seat === seat)] ?? 0;
  // ADR-205 "Umgekehrt": the lowest score ranks first
  const ranking = [...b.seats].sort(
    (x, y) => (b.reverse ? scoreOf(x.seat) - scoreOf(y.seat) : scoreOf(y.seat) - scoreOf(x.seat)) || x.seat - y.seat,
  );
  return (
    <div className="flex min-h-full flex-col">
      <div
        className={cn(
          "relative grid flex-1 gap-2 p-3 lg:gap-4 lg:p-6",
          many
            ? cn("auto-rows-fr grid-cols-2", b.seats.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4")
            : "grid-rows-2 lg:grid-cols-2 lg:grid-rows-1",
        )}
        data-testid="battle-arena"
      >
        {b.seats.map((seat, i) => (
          <SeatPanel
            key={seat.seat}
            seat={seat}
            battle={b}
            score={scores[i] ?? 0}
            from={fresh && lastTwist && lastTwist[i] !== i ? (b.seats[lastTwist[i]!]?.player.nickname ?? null) : null}
            shown={shown}
            pack={pack}
            phase={phase}
            winner={winner}
            reduced={Boolean(reduced)}
            compact={many && !desktop}
            desktop={desktop}
            innerRef={winner === seat.seat ? winnerRef : undefined}
          />
        ))}
        <AnimatePresence>
          {phase === "twisting" && (
            <TwistOverlay
              key={`twist-${pack}`}
              names={b.seats.map((s) => s.player.nickname)}
              round={pack}
              perm={b.twists[pack - 1] ?? null}
              reduced={Boolean(reduced)}
            />
          )}
        </AnimatePresence>
        {/* With 3 or 4 seats the badge sits on the cards: only the countdown, no "VS" */}
        {phase !== "twisting" && (!many || phase === "countdown") && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
            <motion.span
              className="rounded-pill border-2 border-line-2 bg-surface-1 px-3 py-1 font-pixel text-sm text-fg-1 shadow-2"
              animate={phase === "countdown" && !reduced ? { scale: [1, 1.25, 1] } : undefined}
              transition={{ duration: DURATION.slower, repeat: phase === "countdown" ? Infinity : 0 }}
              data-testid="battle-center"
            >
              {phase === "countdown" ? countdown : t("battle.vs")}
            </motion.span>
          </div>
        )}
      </div>
      <AnimatePresence>
        {decided && winnerSeat && (
          <motion.section
            key="summary"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.slower, ease: EASE.out, delay: reduced ? 0 : 0.9 }}
            className="sticky bottom-0 border-t-2 border-line-1 bg-surface-1 px-4 py-4 text-center lg:px-6"
            data-testid="battle-summary"
            data-winner={b.winner ?? `seat-${winnerSeat.seat}`}
            data-winner-seat={winnerSeat.seat}
          >
            <p className="font-pixel text-sm text-fg-1 uppercase">
              {b.mySeat === null
                ? t("battle.winnerIs", { name: winnerSeat.player.nickname })
                : b.mySeat === winnerSeat.seat
                  ? t("battle.youWin")
                  : t("battle.youLose")}
            </p>
            <p className="mt-1 nums text-sm text-fg-2">
              {t("battle.takes", { count: cards, value: formatMoney(total) })}
            </p>
            {b.reverse && (
              <p className="mt-1 text-xs text-fg-2" data-testid="battle-reverse-hint">
                {t("battle.reverseHint")}
              </p>
            )}
            {b.tieBreak && b.tieBreak !== "value" && (
              <p className="mt-1 text-xs text-fg-3" data-testid="battle-tiebreak">
                {b.reverse && b.tieBreak === "rarest"
                  ? t("battle.tieBreak.rarestReverse")
                  : t(`battle.tieBreak.${b.tieBreak}`)}
              </p>
            )}
            {many && (
              <ol className="mx-auto mt-3 max-w-sm space-y-1 text-left" data-testid="battle-ranking">
                {ranking.map((s, i) => (
                  <li key={s.seat} className="flex items-center gap-2 text-sm">
                    <span className="w-5 nums text-fg-3">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate text-fg-1">
                      {s.player.nickname}
                      {s.isMe && <span className="ml-1 text-xs text-fg-3">{t("you")}</span>}
                    </span>
                    <span className="nums text-fg-2">{formatMoney(scoreOf(s.seat))}</span>
                  </li>
                ))}
              </ol>
            )}
            {b.mySeat !== null && b.mySeat === winnerSeat.seat && (
              <BattleInstantSell battle={b} className="mx-auto mt-3 max-w-sm" />
            )}
            <div className="mt-3 flex justify-center">
              <Button onClick={onClose} data-testid="battle-done">
                {t("battle.done")}
              </Button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      {b.liveId && now !== null && <Reactions liveId={b.liveId} reactions={b.reactions} canReact={b.mySeat === null} />}
    </div>
  );
}

function SeatPanel({
  seat,
  battle: b,
  score,
  from,
  shown,
  pack,
  phase,
  winner,
  reduced,
  compact,
  desktop,
  innerRef,
}: {
  seat: NexamonBattleSeat;
  battle: NexamonBattle;
  /** ADR-205: what the seat holds for the decision (its pile); its own pulls without Twist. */
  score: number;
  /** ADR-205: right after a twist, whose pile the seat took (null: kept its own). */
  from: string | null;
  shown: number;
  pack: number;
  phase: BattlePhase;
  winner: number | null;
  reduced: boolean;
  compact: boolean;
  desktop: boolean;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  const t = useTranslations("nexamonLive");
  const visible = seat.cards.slice(0, shown);
  const sum = visible.reduce((s, p) => s + p.valueCents, 0);
  const last = visible[visible.length - 1];
  const lastCard = last ? nexamonCard(last.cardKey) : undefined;
  const lost = winner !== null && winner !== seat.seat;
  const won = winner === seat.seat;
  const scale = compact ? 1 : desktop ? (b.seats.length > 2 ? 2 : 3) : 2;
  const packCards = visible.filter((p) => p.pack === pack);
  const flash = last && rarityRank(last.rarity) >= 1 && phase === "revealing";
  const set = b.packs[pack - 1]?.set ?? b.set;
  const tearing = phase === "countdown" || phase === "tearing" || phase === "waiting";
  // the cards of the losers fade towards the middle
  const fly = reduced ? {} : { scale: 0.5, y: seat.seat < 2 && b.seats.length > 2 ? 60 : 0 };
  const legacy = b.seats.length === 2 ? (seat.seat === 0 ? "challenger" : "opponent") : null;
  const twisting = phase === "twisting";
  const tier = last ? battleRevealTier(last.rarity, last.slot, cfg.packSize) : 0;

  return (
    <motion.div
      ref={innerRef}
      className={cn(
        "relative flex min-w-0 flex-col items-center gap-2 overflow-hidden rounded-lg border-2 bg-surface-1 p-2 lg:gap-4 lg:p-5",
        !compact && "p-3",
        won ? "border-gold" : seat.isMe ? "border-accent" : "border-line-1",
      )}
      animate={{
        opacity: lost ? 0.4 : 1,
        scale: won && !reduced ? 1.02 : 1,
        x: twisting && !reduced ? [0, -7, 7, -5, 5, -2, 0] : 0,
      }}
      transition={{ duration: DURATION.slower, ease: EASE.out, x: { duration: 0.7, ease: EASE.out } }}
      data-testid={legacy ? `battle-side-${legacy}` : "battle-seat"}
      data-seat={seat.seat}
      data-shown={visible.length}
      data-total={sum}
      data-score={score}
    >
      <div className={cn("flex w-full items-center gap-2", compact && "flex-col gap-1")}>
        <PlayerFigure
          avatarKey={seat.player.avatarKey}
          accessories={seat.player.accessories}
          scale={compact ? 1 : 2}
          className="shrink-0"
        />
        <div className={cn("min-w-0 flex-1", compact && "w-full text-center")}>
          <p className="truncate text-sm font-semibold text-fg-1">
            {seat.player.nickname}
            {seat.isMe && <span className="ml-1 text-xs text-fg-3">{t("you")}</span>}
          </p>
          {!compact && <p className="text-xs text-fg-3">{t("level", { level: seat.player.level })}</p>}
        </div>
        <div className={cn("text-right", compact && "text-center")}>
          <motion.p
            key={score}
            className={cn("nums font-semibold", compact ? "text-sm" : "text-lg", from ? "text-accent" : "text-fg-1")}
            initial={
              reduced ? false : twisting ? { rotateX: 90, scale: 1.4, opacity: 0 } : { scale: 1.25, opacity: 0.6 }
            }
            animate={{ rotateX: 0, scale: 1, opacity: 1 }}
            transition={SPRING.bouncy}
            data-testid={legacy ? `battle-total-${legacy}` : "battle-seat-total"}
          >
            {formatMoney(score)}
          </motion.p>
          {from && (
            <motion.p
              className="truncate text-2xs text-accent"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.slow, ease: EASE.out }}
              data-testid="battle-seat-from"
            >
              {t("battle.twist.from", { name: from })}
            </motion.p>
          )}
          {b.twist && !from && !compact && (
            <p className="nums text-2xs text-fg-3" data-testid="battle-seat-pulled">
              {t("battle.twist.pulled", { value: formatMoney(sum) })}
            </p>
          )}
          {won && (
            <Badge tone="warn" data-testid="battle-winner-badge">
              {t("battle.winner")}
            </Badge>
          )}
        </div>
      </div>

      <div className="relative grid min-h-0 flex-1 place-items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {tearing ? (
            <motion.div
              key={`pack-${pack}`}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
              animate={
                phase === "tearing" && !reduced
                  ? { opacity: 1, rotate: [0, -4, 4, -3, 0], y: [0, -6, 0] }
                  : phase === "countdown" && !reduced
                    ? { opacity: 1, y: [0, -4, 0] }
                    : { opacity: 1, y: 0 }
              }
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: DURATION.fast } }
                  : { opacity: 0, scale: 1.3, y: -30, transition: { duration: DURATION.slow, ease: EASE.out } }
              }
              transition={{ duration: phase === "tearing" ? 0.5 : 1.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <NexamonPack set={set} scale={compact ? 1 : desktop ? 3 : 2} />
            </motion.div>
          ) : lastCard ? (
            <motion.div
              key={`card-${shown}`}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: seat.seat % 2 === 0 ? -8 : 8 }}
              animate={lost && !reduced ? { opacity: 0, ...fly } : { opacity: 1, scale: 1, rotate: 0, x: 0, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              transition={lost ? { duration: 0.9, ease: EASE.in, delay: 0.3 } : SPRING.bouncy}
              className="relative"
              data-testid={legacy ? `battle-spotlight-${legacy}` : "battle-seat-spotlight"}
            >
              {/* ADR-205: the last two cards of a pack reveal louder, by rarity */}
              <BattleRevealFx tier={tier} rarity={last!.rarity} valueCents={last!.valueCents} reduced={reduced}>
                <NexamonCardFace card={lastCard} scale={scale} foil={reduced ? "still" : "live"} />
              </BattleRevealFx>
              <span className="absolute -top-2 left-1/2 z-10 -translate-x-1/2">
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
          const pull = packCards[i];
          const card = pull ? nexamonCard(pull.cardKey) : undefined;
          return (
            <li
              key={i}
              className={cn("relative", i > 0 && (compact ? "-ml-9" : "-ml-4 sm:ml-1"))}
              style={{ zIndex: i }}
            >
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

/**
 * ADR-205: the twist after a pack, over the arena: "TWIST!" and who takes whose pile ("Lena ↔ Max",
 * "Lena → Max → Ida → Lena"); nothing moved: "Kein Tausch". Before the server's twist arrives only the title shows.
 */
export function TwistOverlay({
  names,
  round,
  perm,
  reduced,
}: {
  /** Nicknames in seat order. */
  names: string[];
  round: number;
  perm: number[] | null;
  reduced: boolean;
}) {
  const t = useTranslations("nexamonLive");
  const name = (i: number) => names[i] ?? "";
  const cycles = perm ? twistCycles(perm) : [];
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.slow } }}
      data-testid="battle-twist"
      data-round={round}
      data-moves={perm ? cycles.length : -1}
      aria-live="polite"
    >
      <motion.div
        className="max-w-full rounded-lg border-2 border-accent bg-surface-1 px-5 py-4 text-center shadow-3"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3, rotate: -14 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.3, rotate: 6 }}
        transition={reduced ? { duration: DURATION.fast } : SPRING.bouncy}
      >
        <motion.p
          className="font-pixel text-2xl text-accent uppercase"
          animate={reduced ? undefined : { scale: [1, 1.12, 1], rotate: [0, -3, 3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
        >
          {t("battle.twist.title")}
        </motion.p>
        <p className="mt-0.5 text-2xs text-fg-3">{t("battle.twist.label", { n: round })}</p>
        {perm && (
          <ul className="mt-2 space-y-1">
            {cycles.length === 0 ? (
              <li className="text-sm text-fg-2" data-testid="battle-twist-none">
                {t("battle.twist.none")}
              </li>
            ) : (
              cycles.map((cycle, k) => (
                <motion.li
                  key={cycle.join("-")}
                  className="text-sm font-semibold break-words text-fg-1"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: k % 2 === 0 ? -24 : 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: DURATION.slower, ease: EASE.out, delay: reduced ? 0 : 0.25 + k * 0.15 }}
                  data-testid="battle-twist-move"
                >
                  {cycle.length === 2
                    ? `${name(cycle[0]!)} ↔ ${name(cycle[1]!)}`
                    : [...cycle, cycle[0]!].map(name).join(" → ")}
                </motion.li>
              ))
            )}
          </ul>
        )}
      </motion.div>
    </motion.div>
  );
}

/**
 * ADR-196: the winner of a Pack Battle may sell the cards just won to the game at once. The battle shows pulls
 * by card and serial; the own collection (read again now) knows the copies behind them.
 */
function BattleInstantSell({ battle, className }: { battle: NexamonBattle; className?: string }) {
  const collection = useNexamonCollection();
  const { refetch } = collection;
  useEffect(() => {
    void refetch();
  }, [refetch, battle.id]);
  const items = useMemo(() => {
    const copies = new Map((collection.data?.copies ?? []).map((c) => [`${c.cardKey}#${c.serial}`, c]));
    return battle.seats.flatMap((seat) =>
      seat.cards.flatMap((pull) => {
        const copy = copies.get(`${pull.cardKey}#${pull.serial}`);
        return copy && copy.grade === null && !copy.listing
          ? [{ copyId: copy.id, cardKey: pull.cardKey, rarity: pull.rarity, valueCents: pull.valueCents }]
          : [];
      }),
    );
  }, [collection.data, battle.seats]);
  if (!collection.data) return <Skeleton className={cn("h-20 w-full rounded-lg", className)} />;
  return <InstantSell key={battle.id} items={items} className={className} />;
}
