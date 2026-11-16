"use client";

import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotionConfig,
  useSpring,
  useTransform,
} from "motion/react";
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
import { composePack, PACK_SIZE, packTearRow } from "@/components/pixel/nexamon-pack";
import { burstConfetti } from "@/components/ui/effects";
import { DURATION, EASE, SPRING, STAGGER } from "@/lib/motion";
import { playSound, type SoundName } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { isHit, isTap, pixelScale, swipeOutcome, tearProgress } from "../lib";
import { RarityBadge } from "./badges";
import { NexamonCardBack, NexamonCardFace } from "./card-face";
import { PackFoil, PackSheen } from "./pack";
import { PixelCanvas } from "./pixel-canvas";
import { TiltFlip } from "./tilt-flip";
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
  /** Plays the built-in sounds (foil, tear, every card leaving and showing, bigger ones for better pulls). */
  sound?: boolean;
  /** Shown under the summary: buttons of the page that uses the opening. */
  children?: ReactNode;
  className?: string;
}

/** The better the pull, the bigger its sound; a common only ticks. */
const REVEAL_SOUND: Record<NexamonRarity, SoundName> = {
  common: "cardShow",
  rare: "pullRare",
  ultra: "pullUltra",
  prisma: "pullPrisma",
  legendary: "pullLegendary",
};
/** Upper part of the pack (share of its height) where a tear can start. */
const TEAR_ZONE = 0.45;
/** Crackles of the foil over a whole tear. */
const TEAR_TICKS = 9;
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
  /** The top card hands out its "flip" (front to back and back again) so the keyboard can use it. */
  flipRef: RefObject<(() => void) | null>;
  /** The card turned around (for the sound). */
  onTurn: () => void;
  /** The card starts to leave (thrown, flicked or pulled with the keyboard). */
  onFly: () => void;
  onGone: () => void;
}

const HOVER_SPRING = { stiffness: 260, damping: 22, mass: 0.6 } as const;
/** Degrees the top card leans towards the pointer. */
const HOVER_TILT = 12;

/** One card of the stack. Only the top one listens: it follows the pointer and flies away or falls back. */
function StackCard({
  card,
  art,
  evolvesFromName,
  u,
  top,
  reduced,
  throwRef,
  flipRef,
  onTurn,
  onFly,
  onGone,
}: StackCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(1);
  const rotate = useTransform(x, (value) => value / 16);
  const drag = useRef<{ id: number; x: number; y: number; trail: { t: number; x: number; y: number }[] } | null>(null);
  const leaving = useRef(false);
  const width = NEXAMON_CARD_SIZE.width * u;
  // The top card leans towards the pointer while it hovers, and its foil follows the same light.
  const hoverX = useMotionValue(0.5);
  const hoverY = useMotionValue(0.5);
  const lightX = useSpring(hoverX, HOVER_SPRING);
  const lightY = useSpring(hoverY, HOVER_SPRING);
  const rotateX = useTransform(lightY, [0, 1], [HOVER_TILT, -HOVER_TILT]);
  // A tap turns the card around (the flip technique of TiltFlip): the turn spring adds 180 degrees to the lean.
  const [flipped, setFlipped] = useState(false);
  const turn = useSpring(0, SPRING.smooth);
  const rotateY = useTransform(() => (lightX.get() - 0.5) * 2 * HOVER_TILT + turn.get());
  const flip = useCallback(() => {
    if (leaving.current) return;
    setFlipped((was) => {
      turn.set(was ? 0 : 180);
      return !was;
    });
    onTurn();
  }, [onTurn, turn]);
  const lean = (event: PointerEvent<HTMLDivElement>) => {
    if (!top || reduced || leaving.current || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    hoverX.set(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
    hoverY.set(Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)));
  };
  const level = () => {
    hoverX.set(0.5);
    hoverY.set(0.5);
  };

  const fly = useCallback(
    (dirX: number, dirY: number) => {
      if (leaving.current) return;
      leaving.current = true;
      onFly();
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
    [onFly, onGone, opacity, reduced, width, x, y],
  );

  useEffect(() => {
    if (!top) return;
    throwRef.current = fly;
    flipRef.current = flip;
    return () => {
      if (throwRef.current === fly) throwRef.current = null;
      if (flipRef.current === flip) flipRef.current = null;
    };
  }, [flip, flipRef, fly, throwRef, top]);

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
    if (!state) lean(event);
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
    // A press without movement is a tap: it turns the card around instead of throwing it.
    if (isTap(x.get(), y.get())) {
      back();
      flip();
      return;
    }
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
      onPointerLeave={level}
      onDragStart={(event) => event.preventDefault()}
      style={{ x, y, rotate, opacity, touchAction: top ? "none" : undefined, perspective: width * 4 }}
      className={cn("absolute inset-0 select-none", top ? "cursor-grab active:cursor-grabbing" : "pointer-events-none")}
    >
      <motion.div
        style={top ? { rotateX, rotateY: reduced ? 0 : rotateY, transformStyle: "preserve-3d" } : undefined}
        className="relative"
        data-testid={top ? "pack-top-card-tilt" : undefined}
        data-face={flipped ? "back" : "front"}
      >
        <motion.div
          initial={false}
          animate={{ opacity: reduced && flipped ? 0 : 1 }}
          transition={{ duration: DURATION.base, ease: EASE.standard }}
          className="[backface-visibility:hidden]"
        >
          <NexamonCardFace
            card={card}
            art={art}
            scale={u}
            evolvesFromName={evolvesFromName}
            foil={top ? "live" : "still"}
            light={top ? { x: lightX, y: lightY } : undefined}
          />
        </motion.div>
        <motion.div
          initial={false}
          animate={{ opacity: reduced && !flipped ? 0 : 1 }}
          transition={{ duration: DURATION.base, ease: EASE.standard }}
          style={{ rotateY: reduced ? 0 : 180 }}
          className="absolute inset-0 [backface-visibility:hidden]"
          aria-hidden
        >
          <NexamonCardBack scale={u} />
        </motion.div>
      </motion.div>
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
  const flipRef = useRef<(() => void) | null>(null);
  const turned = useCallback(() => {
    if (sound) playSound("cardFlick", 1, { rate: 1.35 });
  }, [sound]);
  const stackRef = useRef<HTMLDivElement>(null);
  // The tear in progress: how far (0..1) and to which side (1 right, -1 left, 0 not pulling).
  const tear = useMotionValue(0);
  const [rip, setRip] = useState<-1 | 0 | 1>(0);
  const drag = useRef<{ x: number; ticks: number; dir: -1 | 0 | 1 } | null>(null);
  const side = rip === 0 ? 1 : rip;
  const peel = useTransform(tear, (value) => value * 16 * side);
  const lift = useTransform(tear, (value) => -value * 4 * u);
  const rasters = composePack(set);
  const setName = t(`sets.${set}`);
  const current = cards[index];

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  // The pack button is gone once the stack lies there: the keyboard goes on with the cards.
  useEffect(() => {
    if (phase === "stack") stackRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const reveal = useCallback(
    (at: number) => {
      const card = cards[at];
      if (!card) return;
      onReveal?.(card, at);
      if (sound) playSound(REVEAL_SOUND[card.rarity]);
      if (!isHit(card.rarity)) return;
      if ((card.rarity === "prisma" || card.rarity === "legendary") && stackRef.current)
        burstConfetti(stackRef.current, card.rarity === "legendary" ? 36 : 22);
    },
    [cards, onReveal, sound],
  );

  /** Opens the pack. Torn by hand, the strip is already loose and comes off at once; otherwise the pack shakes first. */
  const open = (byHand = false) => {
    if (phase !== "sealed") return;
    const later = (ms: number, run: () => void) => timers.current.push(window.setTimeout(run, ms));
    const showStack = () => {
      setPhase("stack");
      reveal(0);
    };
    onOpen?.();
    if (reduced) {
      if (sound) playSound("packTear");
      showStack();
      return;
    }
    if (byHand) {
      setPhase("tearing");
      if (sound) playSound("packTear");
      later(TEAR_MS, showStack);
      return;
    }
    setPhase("shaking");
    later(SHAKE_MS, () => {
      setPhase("tearing");
      if (sound) playSound("packTear");
    });
    later(SHAKE_MS + TEAR_MS, showStack);
  };

  // Tearing by hand: press on the upper part of the pack and pull sideways along the seal. The strip lifts with
  // the finger and the foil crackles; pulled across most of the pack it comes off. Let go earlier and it falls back.
  const tearStart = (event: PointerEvent<HTMLDivElement>) => {
    if (phase !== "sealed") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientY - rect.top > rect.height * TEAR_ZONE) return;
    drag.current = { x: event.clientX, ticks: 0, dir: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const tearMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || phase !== "sealed") return;
    const dx = event.clientX - d.x;
    if (d.dir === 0) {
      if (Math.abs(dx) < 4) return;
      d.dir = dx > 0 ? 1 : -1;
      setRip(d.dir);
    }
    const progress = tearProgress(dx * d.dir, event.currentTarget.getBoundingClientRect().width);
    tear.set(progress);
    const ticks = Math.floor(progress * TEAR_TICKS);
    if (ticks > d.ticks) {
      d.ticks = ticks;
      if (sound) playSound("packCrinkle");
    }
    if (progress >= 1) {
      drag.current = null;
      open(true);
    }
  };
  const tearEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    animate(tear, 0, { ...SPRING.snappy, onComplete: () => setRip(0) });
  };

  const flick = useCallback(() => {
    if (sound) playSound("cardFlick");
  }, [sound]);

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
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      flipRef.current?.();
      return;
    }
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
                <TiltFlip
                  width={NEXAMON_CARD_SIZE.width * size}
                  height={NEXAMON_CARD_SIZE.height * size}
                  tilt={false}
                  label={t("flipHint", { name: card.name })}
                  testId={size === 1 ? "pack-summary-card" : "pack-summary-card-wide"}
                  className="relative"
                  front={() => (
                    <NexamonCardFace
                      card={card}
                      art={artOf?.(card)}
                      scale={size}
                      evolvesFromName={evolvesFromNameOf?.(card)}
                      foil="still"
                    />
                  )}
                  back={<NexamonCardBack scale={size} />}
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
                  animate={{ opacity: [0, 1, 0.7], scale: [0.3, 1, 1.12] }}
                  transition={{ duration: TEAR_MS / 1000, ease: EASE.out }}
                  className="pointer-events-none absolute"
                  style={{ left: -packW * 0.35, right: -packW * 0.35, top: -packW * 0.6, height: packW * 1.7 }}
                >
                  <div className="nexamon-burst absolute inset-0" />
                  <div className="nexamon-rays nexamon-spin absolute inset-0" />
                </motion.div>
              )}
              <div
                onPointerDown={tearStart}
                onPointerMove={tearMove}
                onPointerUp={tearEnd}
                onPointerCancel={tearEnd}
                data-testid="pack-tear"
                data-ripping={rip !== 0}
                className={cn(
                  "relative block size-full touch-pan-y select-none",
                  phase === "sealed" && "cursor-grab active:cursor-grabbing",
                  phase === "shaking" && "nexamon-pack-shake",
                )}
              >
                <PixelCanvas
                  raster={phase === "tearing" || rip !== 0 ? rasters.body : rasters.full}
                  scale={u}
                  className="absolute inset-0"
                />
                {/* The strip while a finger pulls it: one end lifts, the other still hangs on. */}
                {phase !== "tearing" && rip !== 0 && (
                  <motion.div
                    className="absolute inset-0"
                    style={{ rotate: peel, y: lift, transformOrigin: rip > 0 ? "100% 10%" : "0% 10%" }}
                  >
                    <PixelCanvas raster={rasters.top} scale={u} />
                  </motion.div>
                )}
                {/* The strip once it is off: it flies away to the side it was torn to. */}
                {phase === "tearing" && (
                  <motion.div
                    className="absolute inset-0"
                    initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
                    animate={{ x: packW * 0.55 * side, y: -packH * 0.3, rotate: 38 * side, opacity: 0 }}
                    transition={{ duration: TEAR_MS / 1000, ease: EASE.out }}
                    style={{ transformOrigin: side > 0 ? "100% 0%" : "0% 0%" }}
                  >
                    <PixelCanvas raster={rasters.top} scale={u} />
                  </motion.div>
                )}
                {phase === "sealed" && (
                  <>
                    <PackFoil scale={u} />
                    <PackSheen scale={u} />
                    {rip === 0 && (
                      <div
                        aria-hidden
                        className="nexamon-tear-guide pointer-events-none absolute"
                        style={{ left: 3 * u, right: 3 * u, top: packTearRow(0) * u + u }}
                      />
                    )}
                  </>
                )}
              </div>
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
                  flipRef={flipRef}
                  onTurn={turned}
                  onFly={flick}
                  onGone={gone}
                />
              ))}
          </motion.div>
        )}
      </div>

      <div className="min-h-10 text-center" aria-live="polite">
        {phase === "stack" && current ? (
          <>
            <div className="mb-1 flex justify-center" data-testid="pack-top-rarity" data-rarity={current.rarity}>
              <RarityBadge key={current.key + index} rarity={current.rarity} />
            </div>
            <p className="label-pixel text-fg-2" data-testid="pack-counter">
              {t("pack.counter", { n: index + 1, total: cards.length })}
            </p>
            <p className="mt-1 text-xs text-pretty text-fg-3">{t("pack.dragHint")}</p>
            <p className="mt-0.5 hidden text-xs text-fg-3 lg:block">{t("pack.keyHint")}</p>
          </>
        ) : (
          phase === "sealed" && (
            <>
              <p className="text-sm text-pretty text-fg-2">{t("pack.tapHint")}</p>
              <button
                type="button"
                onClick={() => open()}
                aria-label={t("pack.open", { set: setName })}
                data-testid="pack-open"
                className="mt-2 h-9 rounded-sm px-3 text-xs font-medium text-accent focus-ring transition-colors duration-fast hover:bg-surface-2 active:scale-[0.98]"
              >
                {t("pack.openButton")}
              </button>
            </>
          )
        )}
      </div>
    </div>
  );
}
