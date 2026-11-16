"use client";

import { animate, AnimatePresence, motion, useMotionValue, useReducedMotionConfig, useTransform } from "motion/react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  NEXAMON_CARD_SIZE,
  type NexamonArt,
  type NexamonCard,
  type NexamonRarity,
  type NexamonSetKey,
} from "@/config/nexamon";
import { composePack, PACK_SIZE } from "@/components/pixel/nexamon-pack";
import { burstConfetti } from "@/components/ui/effects";
import { DURATION, EASE, SPRING, STAGGER } from "@/lib/motion";
import { playSound, type SoundName } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { isHit, pixelScale, swipeOutcome } from "../lib";
import { NexamonCardFace } from "./card-face";
import { PackSheen } from "./pack";
import { PixelCanvas } from "./pixel-canvas";
import "./nexamon.css";

export type PackPhase = "sealed" | "shaking" | "tearing" | "stack" | "summary";

export interface PackOpeningProps {
  set: NexamonSetKey;
  /** The cards of the pack in slot order: the first lies on top of the stack, the last is revealed last. */
  cards: readonly NexamonCard[];
  /** Artwork of a card; without it the catalogue's artwork (or the placeholder) is used. */
  artOf?: (card: NexamonCard) => NexamonArt | undefined;
  /** Name of the card a card evolves from; without it the catalogue is asked. */
  evolvesFromNameOf?: (card: NexamonCard) => string | undefined;
  /** CSS pixels per art pixel of pack and stack (3 fits a phone). */
  scale?: number;
  /** The pack was torn open. */
  onOpen?: () => void;
  /** A card came to the top of the stack and is fully visible: index 0 right after opening, then one per pull. */
  onReveal?: (card: NexamonCard, index: number) => void;
  /** The last card was pulled away; the summary is showing. */
  onComplete?: (cards: readonly NexamonCard[]) => void;
  /** Plays the built-in sounds (tear, whoosh, chimes for hits). */
  sound?: boolean;
  /** Shown under the summary: buttons of the page that uses the opening. */
  children?: ReactNode;
  className?: string;
}

const HIT_SOUND: Partial<Record<NexamonRarity, SoundName>> = {
  rare: "success",
  ultra: "win",
  prisma: "levelUp",
  legendary: "levelUp",
};
const SHAKE_MS = 620;
const TEAR_MS = 560;

interface StackCardProps {
  card: NexamonCard;
  art: NexamonArt | undefined;
  evolvesFromName: string | undefined;
  u: number;
  top: boolean;
  reduced: boolean;
  /** The top card hands out its "throw" so the keyboard can use it. */
  throwRef: RefObject<((dirX: number, dirY: number) => void) | null>;
  onGone: () => void;
}

/** One card of the stack. Only the top one listens: it follows the pointer and flies away or falls back. */
function StackCard({ card, art, evolvesFromName, u, top, reduced, throwRef, onGone }: StackCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(1);
  const rotate = useTransform(x, (value) => value / 16);
  const drag = useRef<{ id: number; x: number; y: number; trail: { t: number; x: number; y: number }[] } | null>(null);
  const leaving = useRef(false);
  const width = NEXAMON_CARD_SIZE.width * u;

  const fly = useCallback(
    (dirX: number, dirY: number) => {
      if (leaving.current) return;
      leaving.current = true;
      if (reduced) {
        onGone();
        return;
      }
      const reach = width * 2.2;
      const options = { duration: DURATION.slower, ease: EASE.out } as const;
      void animate(x, x.get() + dirX * reach, options);
      void animate(y, y.get() + dirY * reach, options);
      void animate(opacity, 0, { duration: DURATION.slow, ease: EASE.in, delay: DURATION.instant }).then(onGone);
    },
    [onGone, opacity, reduced, width, x, y],
  );

  useEffect(() => {
    if (!top) return;
    throwRef.current = fly;
    return () => {
      if (throwRef.current === fly) throwRef.current = null;
    };
  }, [fly, throwRef, top]);

  const back = () => {
    void animate(x, 0, SPRING.bouncy);
    void animate(y, 0, SPRING.bouncy);
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!top || leaving.current || drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    x.stop();
    y.stop();
    drag.current = {
      id: event.pointerId,
      x: event.clientX - x.get(),
      y: event.clientY - y.get(),
      trail: [{ t: event.timeStamp, x: event.clientX, y: event.clientY }],
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    x.set(event.clientX - state.x);
    y.set(event.clientY - state.y);
    state.trail.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
    if (state.trail.length > 6) state.trail.shift();
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    // Speed over the last moments of the drag: a flick counts even when it was short.
    const recent = state.trail.filter((p) => event.timeStamp - p.t <= 120);
    const first = recent[0] ?? state.trail[state.trail.length - 1]!;
    const seconds = Math.max(0.016, (event.timeStamp - first.t) / 1000);
    const outcome = swipeOutcome({
      dx: x.get(),
      dy: y.get(),
      vx: (event.clientX - first.x) / seconds,
      vy: (event.clientY - first.y) / seconds,
      width,
    });
    if (outcome.away) fly(outcome.dirX, outcome.dirY);
    else back();
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    back();
  };

  return (
    <motion.div
      data-vaul-no-drag=""
      data-testid={top ? "pack-top-card" : undefined}
      data-card={card.key}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onDragStart={(event) => event.preventDefault()}
      style={{ x, y, rotate, opacity, touchAction: top ? "none" : undefined }}
      className={cn("absolute inset-0 select-none", top ? "cursor-grab active:cursor-grabbing" : "pointer-events-none")}
    >
      <NexamonCardFace
        card={card}
        art={art}
        scale={u}
        evolvesFromName={evolvesFromName}
        foil={top ? "live" : "still"}
      />
    </motion.div>
  );
}

/**
 * Opening a booster pack: tap the pack, it shakes, the top tears off, light bursts out and the five cards lie
 * there as a stack, face up. The player pulls every card away by hand: pulled slowly, the edge of the next card
 * shows first (peeking), a quick flick throws the card off. Arrow keys, Space and Enter do the same.
 * The component owns no game state: it gets the cards, reports through the callbacks and ends on a summary.
 */
export function PackOpening({
  set,
  cards,
  artOf,
  evolvesFromNameOf,
  scale = 3,
  onOpen,
  onReveal,
  onComplete,
  sound = true,
  children,
  className,
}: PackOpeningProps) {
  const t = useTranslations("nexamonCards");
  const reduced = useReducedMotionConfig() ?? false;
  const u = pixelScale(scale);
  const [phase, setPhase] = useState<PackPhase>("sealed");
  const [index, setIndex] = useState(0);
  const timers = useRef<number[]>([]);
  const throwRef = useRef<((dirX: number, dirY: number) => void) | null>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const rasters = composePack(set);
  const setName = t(`sets.${set}`);
  const current = cards[index];

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const reveal = useCallback(
    (at: number) => {
      const card = cards[at];
      if (!card) return;
      onReveal?.(card, at);
      if (!isHit(card.rarity)) return;
      const chime = HIT_SOUND[card.rarity];
      if (sound && chime) playSound(chime);
      if ((card.rarity === "prisma" || card.rarity === "legendary") && stackRef.current)
        burstConfetti(stackRef.current, card.rarity === "legendary" ? 36 : 22);
    },
    [cards, onReveal, sound],
  );

  const open = () => {
    if (phase !== "sealed") return;
    const later = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
    const showStack = () => {
      setPhase("stack");
      reveal(0);
    };
    onOpen?.();
    if (reduced) {
      if (sound) playSound("battleCrack");
      showStack();
      return;
    }
    setPhase("shaking");
    later(SHAKE_MS, () => {
      setPhase("tearing");
      if (sound) playSound("battleCrack");
    });
    later(SHAKE_MS + TEAR_MS, showStack);
  };

  const gone = useCallback(() => {
    const next = index + 1;
    if (next >= cards.length) {
      setIndex(next);
      setPhase("summary");
      onComplete?.(cards);
      return;
    }
    setIndex(next);
    reveal(next);
  }, [cards, index, onComplete, reveal]);

  const pull = (dirX: number, dirY: number) => {
    if (!throwRef.current) return;
    if (sound) playSound("battleWhoosh");
    throwRef.current(dirX, dirY);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      " ": [1, 0],
      Enter: [1, 0],
    };
    const dir = direction[event.key];
    if (!dir) return;
    event.preventDefault();
    pull(dir[0], dir[1]);
  };
  // A click without a pointer (screen readers, switch control) pulls the card too.
  const click = (event: MouseEvent<HTMLDivElement>) => {
    if (event.detail === 0) pull(1, 0);
  };

  const cardW = NEXAMON_CARD_SIZE.width * u;
  const cardH = NEXAMON_CARD_SIZE.height * u;
  const packW = PACK_SIZE.width * u;
  const packH = PACK_SIZE.height * u;
  const glow = phase === "stack" && current && isHit(current.rarity) ? current.rarity : null;

  if (phase === "summary") {
    return (
      <div
        data-testid="pack-opening"
        data-phase={phase}
        className={cn("flex w-full flex-col items-center gap-4", className)}
      >
        <p className="label-pixel text-fg-3">{t("pack.summary")}</p>
        {([1, 2] as const).map((size) => (
          <ul
            key={size}
            data-testid={size === 1 ? "pack-summary" : undefined}
            aria-hidden={size === 2 ? true : undefined}
            className={cn(
              "items-end justify-center",
              size === 1 ? "flex sm:hidden [&>li+li]:-ml-3" : "hidden flex-wrap gap-3 sm:flex",
            )}
          >
            {cards.map((card, i) => (
              <motion.li
                key={`${card.key}-${i}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.slow, ease: EASE.out, delay: i * STAGGER * 2 }}
                className="relative"
              >
                {isHit(card.rarity) && (
                  <div aria-hidden className={cn("absolute -inset-3 opacity-80", `nexamon-glow-${card.rarity}`)} />
                )}
                <NexamonCardFace
                  card={card}
                  art={artOf?.(card)}
                  scale={size}
                  evolvesFromName={evolvesFromNameOf?.(card)}
                  foil="still"
                  className="relative"
                />
              </motion.li>
            ))}
          </ul>
        ))}
        {children}
      </div>
    );
  }

  return (
    <div
      data-testid="pack-opening"
      data-phase={phase}
      data-index={index}
      className={cn("flex w-full flex-col items-center gap-3", className)}
    >
      <div
        className="relative flex w-full items-center justify-center overflow-hidden"
        style={{ height: Math.max(packH, cardH) + 30 * u }}
      >
        <AnimatePresence>
          {phase !== "stack" && (
            <motion.div
              key="pack"
              exit={{ opacity: 0, y: packH * 0.4, transition: { duration: DURATION.slow, ease: EASE.in } }}
              className="absolute"
              style={{ width: packW, height: packH }}
            >
              {/* Light behind the pack once the top is off. */}
              {phase === "tearing" && (
                <motion.div
                  aria-hidden
                  initial={{ opacity: 0, scale: 0.3 }}
                  animate={{ opacity: [0, 1, 0.9], scale: [0.3, 1.5, 1.9] }}
                  transition={{ duration: TEAR_MS / 1000, ease: EASE.out }}
                  className="pointer-events-none absolute"
                  style={{ left: -packW * 0.6, right: -packW * 0.6, top: -packW * 0.9, height: packW * 2.2 }}
                >
                  <div className="nexamon-burst absolute inset-0" />
                  <div className="nexamon-rays nexamon-spin absolute inset-0" />
                </motion.div>
              )}
              <button
                type="button"
                onClick={open}
                disabled={phase !== "sealed"}
                aria-label={t("pack.open", { set: setName })}
                data-testid="pack-open"
                className={cn(
                  "group relative block size-full rounded-sm focus-ring transition-transform duration-fast ease-out",
                  phase === "sealed" && "cursor-pointer hover:-translate-y-1 active:translate-y-0 active:scale-[0.98]",
                  phase === "shaking" && "nexamon-pack-shake",
                )}
              >
                <PixelCanvas
                  raster={phase === "tearing" ? rasters.body : rasters.full}
                  scale={u}
                  className="absolute inset-0"
                />
                <motion.div
                  className="absolute inset-0"
                  initial={false}
                  animate={
                    phase === "tearing"
                      ? { x: packW * 0.55, y: -packH * 0.3, rotate: 38, opacity: 0 }
                      : { x: 0, y: 0, rotate: 0, opacity: 1 }
                  }
                  transition={{ duration: TEAR_MS / 1000, ease: EASE.out }}
                  style={{ transformOrigin: "100% 0%" }}
                >
                  {phase === "tearing" && <PixelCanvas raster={rasters.top} scale={u} />}
                </motion.div>
                {phase === "sealed" && <PackSheen scale={u} />}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {phase === "stack" && (
          <motion.div
            ref={stackRef}
            role="button"
            tabIndex={0}
            aria-label={
              current ? t("pack.stackLabel", { n: index + 1, total: cards.length, name: current.name }) : undefined
            }
            data-testid="pack-stack"
            onKeyDown={key}
            onClick={click}
            initial={reduced ? false : { opacity: 0, y: 32, scale: 0.88 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={SPRING.bouncy}
            className="relative rounded-sm focus-ring"
            style={{ width: cardW, height: cardH }}
          >
            <AnimatePresence>
              {glow && (
                <motion.div
                  key={`${glow}-${index}`}
                  aria-hidden
                  data-testid="pack-glow"
                  data-rarity={glow}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
                  transition={{ duration: DURATION.slower, ease: EASE.out }}
                  className="pointer-events-none absolute"
                  style={{ inset: -cardW * 0.42 }}
                >
                  <div
                    className={cn(
                      "nexamon-glow-pulse absolute inset-0",
                      `nexamon-glow-${glow}`,
                      glow === "prisma" && "nexamon-spin",
                    )}
                  />
                  {(glow === "legendary" || glow === "ultra") && (
                    <div className="nexamon-rays nexamon-spin absolute inset-0 opacity-70" />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            {cards
              .map((card, i) => ({ card, i }))
              .filter(({ i }) => i >= index)
              .reverse()
              .map(({ card, i }) => (
                <StackCard
                  key={`${card.key}-${i}`}
                  card={card}
                  art={artOf?.(card)}
                  evolvesFromName={evolvesFromNameOf?.(card)}
                  u={u}
                  top={i === index}
                  reduced={reduced}
                  throwRef={throwRef}
                  onGone={gone}
                />
              ))}
          </motion.div>
        )}
      </div>

      <div className="min-h-10 text-center" aria-live="polite">
        {phase === "stack" && current ? (
          <>
            <p className="label-pixel text-fg-2" data-testid="pack-counter">
              {t("pack.counter", { n: index + 1, total: cards.length })}
            </p>
            <p className="mt-1 text-xs text-pretty text-fg-3">{t("pack.dragHint")}</p>
            <p className="mt-0.5 hidden text-xs text-fg-3 lg:block">{t("pack.keyHint")}</p>
          </>
        ) : (
          phase === "sealed" && <p className="text-sm text-pretty text-fg-2">{t("pack.tapHint")}</p>
        )}
      </div>
    </div>
  );
}
