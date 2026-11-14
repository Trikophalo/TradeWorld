"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { memo, useMemo, type JSX, type ReactNode } from "react";
import { COIN, NEWSPAPER } from "@/components/pixel/art";
import {
  ANCHOR_DESK_ROW,
  ANCHOR_SIZE,
  BACKDROP,
  DESK_HEIGHT,
  DESK_SIGN,
  DESK_SIGN_SHORT,
  INTRO_ART,
  MOOD_FX,
  MUG,
  SHOW_NAME,
  anchorArt,
  cropArt,
  cropCenter,
  deskArt,
} from "@/components/pixel/news-art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { DURATION, EASE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { IntroFrame } from "./intro";

/*
 * The opener of NEXA Nachrichten: five quick shots about Mr. Doodle Dangle and the title card with his name on it.
 * Everything on screen follows from the frame (`introShot(elapsedMs, introMs)`), so all viewers see the same picture;
 * only the flash on a cut and the springs of the title card run on their own. Positions are whole art pixels and
 * move by `transform`, close-ups are the same sprites at two or three times the scale.
 */

/** Height of the stage every shot is composed on, in art pixels; it is as wide as the picture. */
const STAGE_ROWS = 56;
/** Row of the stage where his bust stands in the shots that show him whole. */
const BUST_TOP = STAGE_ROWS - ANCHOR_SIZE.height;
/** How long a cut counts as fresh: a viewer who joins later in the shot gets no flash. */
const CUT_MS = 250;

interface ShotProps {
  frame: IntroFrame;
  scale: number;
  cols: number;
}

interface PieceProps {
  art: PixelArt;
  /** Position on the stage in art pixels. */
  x: number;
  y: number;
  scale: number;
  /** Close-ups: this many times the scale of the studio. */
  zoom?: number;
  flip?: boolean;
  /** Tween to the next position instead of jumping (for things that fly). */
  glide?: boolean;
}

/** A piece of pixel art on the stage. Memoised, so only what moves is drawn again. */
const Piece = memo(function Piece({ art, x, y, scale, zoom = 1, flip = false, glide = false }: PieceProps) {
  return (
    <div
      className={cn("absolute top-0 left-0", glide && "transition-transform duration-instant ease-linear")}
      style={{ transform: `translate(${x * scale}px, ${y * scale}px)` }}
    >
      <PixelIcon {...art} scale={scale * zoom} className={cn("block", flip && "-scale-x-100")} />
    </div>
  );
});

/** The stage: 56 rows in the middle of the picture, as wide as the picture. `shake` moves it down by art pixels. */
function Stage({ scale, shake = 0, children }: { scale: number; shake?: number; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 top-1/2"
      style={{
        height: STAGE_ROWS * scale,
        marginTop: (-STAGE_ROWS / 2) * scale,
        transform: shake === 0 ? undefined : `translateY(${shake * scale}px)`,
      }}
    >
      {children}
    </div>
  );
}

/** Everything below `row` of the stage down to the edge of the picture, for ground that must not end in mid-air. */
function Ground({ row, scale, className }: { row: number; scale: number; className: string }) {
  return (
    <div
      aria-hidden
      className={cn("absolute inset-x-0 bottom-0", className)}
      style={{ top: `calc(50% + ${(row - STAGE_ROWS / 2) * scale}px)` }}
    />
  );
}

/** His desk under a bust that stands at `top`, across the picture, and darkness below it. Goes inside a stage. */
function Podium({ top, scale, cols }: { top: number; scale: number; cols: number }) {
  const desk = useMemo(() => deskArt(cols), [cols]);
  const deskTop = top + ANCHOR_DESK_ROW;
  return (
    <>
      <div
        className="absolute inset-x-0 bg-(--tv-ink)"
        style={{ top: (deskTop + DESK_HEIGHT - 1) * scale, height: STAGE_ROWS * scale }}
      />
      <Piece art={desk} x={0} y={deskTop} scale={scale} />
    </>
  );
}

const lerp = (from: number, to: number, share: number) => from + (to - from) * Math.min(1, Math.max(0, share));
/** A frame counter from the time inside a shot; 0 once the intro is over. */
const tick = (sinceMs: number, ms: number) => (Number.isFinite(sinceMs) ? Math.floor(sinceMs / ms) : 0);

// ---------------------------------------------------------------- shot 1: the moustache

const FACE_ZOOM = 3;
const FACE_WIDTH = (INTRO_ART.face[0].grid[0]?.length ?? 0) * FACE_ZOOM;

function CombShot({ frame, scale, cols }: ShotProps) {
  const { beat, sinceMs } = frame;
  const faceX = Math.floor((cols - FACE_WIDTH) / 2);
  // Two strokes through the moustache, then the comb leaves and he is pleased with himself.
  const first = beat >= 0.5 && beat < 1.75;
  const second = beat >= 2 && beat < 3.25;
  const done = beat >= 3.25;
  const share = first ? (beat - 0.5) / 1.25 : second ? (beat - 2) / 1.25 : 0;
  const combX = done ? faceX + 48 : faceX + FACE_ZOOM * Math.round(lerp(-4, 13, share));
  const combY = done ? 2 : first || second ? 25 : 14;
  const twinkle = tick(sinceMs, 220) % 2;
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_55%,var(--tv-dim)_0,var(--tv-wall)_55%,var(--tv-ink)_125%)]" />
      <Stage scale={scale}>
        <Piece art={INTRO_ART.face[done ? 1 : 0]} x={faceX} y={4} scale={scale} zoom={FACE_ZOOM} />
        <Piece art={INTRO_ART.comb} x={combX} y={combY} scale={scale} zoom={FACE_ZOOM} glide={first || second} />
        {done && (
          <>
            <Piece
              art={twinkle === 0 ? MOOD_FX.sparkle : MOOD_FX.sparkleSmall}
              x={faceX - 2}
              y={24}
              scale={scale}
              zoom={2}
            />
            <Piece
              art={twinkle === 0 ? MOOD_FX.sparkleSmall : MOOD_FX.sparkle}
              x={faceX + FACE_WIDTH - 12}
              y={30}
              scale={scale}
              zoom={2}
            />
          </>
        )}
      </Stage>
    </>
  );
}

// ---------------------------------------------------------------- shot 2: he points at the camera

const POINT_WIDTH = INTRO_ART.point.grid[0]?.length ?? 0;
/** Middle of the fingertip inside the hand, in its own pixels. */
const FINGERTIP = { x: 6.5, y: 9.5 } as const;

/** Where the hand stands on each beat: it starts at his chest and ends in front of everything but his eyes. */
const POINT_TOP = [0, 31, 23, 17] as const;
const POINT_BUST_TOP = 4;

function PointShot({ frame, scale, cols }: ShotProps) {
  const { beat } = frame;
  const cx = Math.floor(cols / 2);
  // One beat of looking, then the hand comes closer on every beat.
  const reach = Math.min(3, Math.floor(beat)) as 0 | 1 | 2 | 3;
  const hit = reach === 3;
  const handX = cx - Math.floor((POINT_WIDTH * reach) / 2);
  const handY = POINT_TOP[reach];
  return (
    <>
      <div
        className={cn(
          "absolute inset-0",
          hit
            ? "bg-[repeating-conic-gradient(from_0deg_at_50%_45%,var(--tv-red)_0deg_12deg,var(--tv-gold)_12deg_24deg)]"
            : "bg-[repeating-conic-gradient(from_0deg_at_50%_45%,var(--tv-bar)_0deg_12deg,var(--tv-wall)_12deg_24deg)]",
        )}
      />
      <Stage scale={scale}>
        <Piece
          art={anchorArt({ mood: "smug", mouth: reach === 0 ? "closed" : "open" })}
          x={cx - ANCHOR_SIZE.width / 2}
          y={POINT_BUST_TOP}
          scale={scale}
        />
        <Podium top={POINT_BUST_TOP} scale={scale} cols={cols} />
        {reach > 0 && (
          <div key={reach} className="absolute inset-0 animate-pop">
            <Piece art={INTRO_ART.point} x={handX} y={handY} scale={scale} zoom={reach} />
            {hit && (
              <Piece
                art={MOOD_FX.sparkle}
                x={handX + Math.round(FINGERTIP.x * reach) - 7}
                y={handY + Math.round(FINGERTIP.y * reach) - 7}
                scale={scale}
                zoom={2}
              />
            )}
          </div>
        )}
      </Stage>
    </>
  );
}

// ---------------------------------------------------------------- shot 3: the mug comes down

const MUG_ZOOM = 4;
const MUG_HEIGHT = INTRO_ART.mug.grid.length * MUG_ZOOM;
const DESK_TOP = 44;
const STEAM: readonly [PixelArt, PixelArt] = [cropArt(MUG[0], 0, 0, 9, 4), cropArt(MUG[1], 0, 0, 9, 4)];

function MugShot({ frame, scale, cols }: ShotProps) {
  const { beat, sinceMs, beatMs } = frame;
  const cx = Math.floor(cols / 2);
  const desk = useMemo(() => deskArt(Math.ceil(cols / 2) + 1), [cols]);
  // Held up, a little wind-up, then down on the third beat.
  const down = beat >= 2;
  const impact = down ? tick(sinceMs - 2 * beatMs, 90) : -1;
  const mugX = cx - 24;
  const mugY = down ? DESK_TOP + 1 - MUG_HEIGHT : beat >= 1.5 ? -6 : -2;
  const shake = impact === 0 ? 2 : impact === 1 ? -1 : impact === 2 ? 1 : 0;
  // After the slam he lets go and the coffee steams again.
  const letGo = beat >= 3 ? Math.round((beat - 3) * 30) : 0;
  return (
    <>
      <div className="absolute inset-0 bg-(--tv-wall)" />
      <Ground row={DESK_TOP + 34} scale={scale} className="bg-(--tv-ink)" />
      <Stage scale={scale} shake={shake}>
        <Piece art={desk} x={0} y={DESK_TOP} scale={scale} zoom={2} />
        <Piece art={INTRO_ART.mug} x={mugX} y={mugY} scale={scale} zoom={MUG_ZOOM} />
        <Piece
          art={INTRO_ART.grip}
          x={mugX + 8 * MUG_ZOOM + letGo}
          y={mugY}
          scale={scale}
          zoom={MUG_ZOOM}
          glide={letGo > 0}
        />
        {impact >= 0 && impact < 6 && (
          <Piece
            art={INTRO_ART.splash[Math.floor(impact / 2) as 0 | 1 | 2]}
            x={mugX + 16 - 40}
            y={mugY - 30}
            scale={scale}
            zoom={3}
          />
        )}
        {beat >= 3 && (
          <Piece
            art={STEAM[tick(sinceMs, 220) % 2 === 0 ? 0 : 1]}
            x={mugX}
            y={mugY - 4 * MUG_ZOOM}
            scale={scale}
            zoom={MUG_ZOOM}
          />
        )}
      </Stage>
    </>
  );
}

// ---------------------------------------------------------------- shot 4: money and newspapers

interface Flyer {
  art: PixelArt;
  /** Where it falls, as a share of the width of the picture from the middle (-0.5 … 0.5). */
  lane: number;
  /** Rows per beat. */
  speed: number;
  /** Where in its fall it starts (0 … 1). */
  start: number;
  /** In front of him or behind him. */
  front: boolean;
}

const FLYERS: readonly Flyer[] = [
  { art: COIN, lane: -0.42, speed: 22, start: 0.1, front: false },
  { art: INTRO_ART.banknote, lane: -0.3, speed: 15, start: 0.55, front: true },
  { art: NEWSPAPER, lane: -0.2, speed: 18, start: 0.8, front: false },
  { art: INTRO_ART.banknote, lane: -0.08, speed: 13, start: 0.3, front: false },
  { art: COIN, lane: 0.05, speed: 24, start: 0.65, front: false },
  { art: INTRO_ART.banknote, lane: 0.16, speed: 16, start: 0, front: true },
  { art: NEWSPAPER, lane: 0.27, speed: 19, start: 0.45, front: false },
  { art: COIN, lane: 0.36, speed: 21, start: 0.9, front: true },
  { art: INTRO_ART.banknote, lane: 0.45, speed: 14, start: 0.2, front: false },
  { art: INTRO_ART.banknote, lane: -0.47, speed: 17, start: 0.75, front: true },
];
/** Rows a flyer falls before it comes round again: the stage and some air above and below it. */
const FALL_ROWS = STAGE_ROWS + 56;

function MoneyShot({ frame, scale, cols }: ShotProps) {
  const { beat } = frame;
  const cx = Math.floor(cols / 2);
  const step = Math.floor(beat * 4);
  const flyer = (item: Flyer, index: number) => {
    const width = item.art.grid[0]?.length ?? 0;
    const fall = (beat * item.speed + item.start * FALL_ROWS) % FALL_ROWS;
    return (
      <Piece
        key={index}
        art={item.art}
        x={cx + Math.round(item.lane * cols) - Math.floor(width / 2) + Math.round(Math.sin(beat * 2 + index) * 2)}
        y={Math.round(fall) - 28}
        scale={scale}
        flip={(step + index) % 4 >= 2}
        // Not on the frame where it comes round again.
        glide={fall > item.speed / 3}
      />
    );
  };
  return (
    <>
      <div className="absolute inset-0 bg-(--tv-bar) bg-[repeating-linear-gradient(135deg,transparent_0_14px,var(--tv-wall)_14px_28px)]" />
      <Stage scale={scale}>
        {FLYERS.map((item, index) => (item.front ? null : flyer(item, index)))}
        <Podium top={BUST_TOP - 12} scale={scale} cols={cols} />
        <Piece
          art={anchorArt({
            mood: "laughing",
            mouth: step % 2 === 0 ? "open" : "half",
            arm: step % 4 < 2 ? "waveLeft" : "waveRight",
          })}
          x={cx - ANCHOR_SIZE.width / 2}
          y={BUST_TOP - 12 - (step % 2)}
          scale={scale}
        />
        {FLYERS.map((item, index) => (item.front ? flyer(item, index) : null))}
      </Stage>
    </>
  );
}

// ---------------------------------------------------------------- shot 5: the hero

/** Sky and city of the studio's backdrop, without the window frame around them. */
const SKYLINE_ROWS = { from: 3, to: 36 } as const;
const SKYLINE_ZOOM = 2;
const PARAPET_ROW = 50;

function HeroShot({ frame, scale, cols }: ShotProps) {
  const { beat, sinceMs } = frame;
  const cx = Math.floor(cols / 2);
  const skyline = useMemo<PixelArt>(
    () => ({
      palette: BACKDROP[0].palette,
      grid: cropCenter(BACKDROP[0].grid.slice(SKYLINE_ROWS.from, SKYLINE_ROWS.to), Math.ceil(cols / SKYLINE_ZOOM) + 1),
    }),
    [cols],
  );
  // He rises behind the parapet in two steps, then stands there with his cape in the wind.
  const rise = beat < 0.25 ? 14 : beat < 0.5 ? 5 : 0;
  const wind = tick(sinceMs, 160) % 2 === 0 ? 0 : 1;
  const twinkle = tick(sinceMs, 220) % 2;
  const anchorX = cx - ANCHOR_SIZE.width / 2;
  const anchorY = BUST_TOP - 2 + rise;
  const sign = (DESK_SIGN.grid[0]?.length ?? 0) + 4 <= cols ? DESK_SIGN : DESK_SIGN_SHORT;
  const signWidth = sign.grid[0]?.length ?? 0;
  return (
    <>
      <div className="absolute inset-0 bg-(--tv-sky)" />
      <Stage scale={scale}>
        <Piece
          art={skyline}
          x={0}
          y={PARAPET_ROW - (SKYLINE_ROWS.to - SKYLINE_ROWS.from) * SKYLINE_ZOOM}
          scale={scale}
          zoom={SKYLINE_ZOOM}
        />
        <Piece art={INTRO_ART.cape[wind]} x={anchorX + 27} y={anchorY + 16} scale={scale} />
        <Piece art={anchorArt({ mood: "proud" })} x={anchorX} y={anchorY} scale={scale} />
        {rise === 0 && (
          <>
            <Piece
              art={twinkle === 0 ? MOOD_FX.sparkle : MOOD_FX.sparkleSmall}
              x={anchorX - 9}
              y={anchorY + 2}
              scale={scale}
            />
            <Piece
              art={twinkle === 0 ? MOOD_FX.sparkleSmall : MOOD_FX.sparkle}
              x={anchorX + 26}
              y={anchorY + 27}
              scale={scale}
            />
          </>
        )}
      </Stage>
      <Ground row={PARAPET_ROW} scale={scale} className="border-t-2 border-(color:--tv-dim) bg-(--tv-ink)" />
      {/* He stands on the roof of his own station. */}
      <Stage scale={scale}>
        <Piece art={sign} x={cx - Math.floor(signWidth / 2)} y={PARAPET_ROW + 1} scale={scale} />
      </Stage>
    </>
  );
}

// ---------------------------------------------------------------- shot 6: the title card

/** Beats into the title card at which its parts arrive. */
const TITLE_STEPS = { show: 0, rule: 0.5, mister: 1, first: 1.5, last: 2.5, anchor: 3.5, tagline: 4.5 } as const;

interface TitleCardProps {
  /** Beats since the card came up. */
  beat: number;
  scale: number;
  wide: boolean;
  reduced: boolean;
  /** Which way he waves right now. */
  wave: 0 | 1;
}

function TitleCard({ beat, scale, wide, reduced, wave }: TitleCardProps) {
  const t = useTranslations("newsStudio");
  const on = (step: keyof typeof TITLE_STEPS) => reduced || beat >= TITLE_STEPS[step];
  const gap = 2 * scale;
  // On a phone he looks up over the lower edge of the picture; there is no room for his suit.
  const anchorScale = wide ? scale : Math.max(2, scale - 1);
  return (
    <div
      className={cn(
        "absolute inset-0 flex justify-center overflow-hidden bg-(--tv-bar) bg-[repeating-linear-gradient(135deg,transparent_0_14px,var(--tv-wall)_14px_28px)]",
        wide ? "items-center" : "items-start pt-9",
      )}
    >
      <motion.div
        aria-hidden
        className="absolute inset-x-0 top-0 h-2 origin-left bg-(--tv-red)"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: on("show") ? 1 : 0 }}
        transition={{ duration: DURATION.slower, ease: EASE.out }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-x-0 bottom-0 z-10 h-2 origin-right bg-(--tv-gold)"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: on("show") ? 1 : 0 }}
        transition={{ duration: DURATION.slower, ease: EASE.out }}
      />
      <div className={cn("flex items-center", wide && "relative gap-8")}>
        <div className="flex flex-col items-center text-center">
          <motion.div
            aria-hidden
            initial={{ opacity: 0, y: -24 }}
            animate={on("show") ? { opacity: 1, y: 0 } : { opacity: 0, y: -24 }}
            transition={SPRING.bouncy}
          >
            <PixelIcon {...SHOW_NAME.show} scale={scale} className="block" />
          </motion.div>
          <motion.div
            aria-hidden
            className="w-full origin-left bg-(--tv-red)"
            style={{ height: scale, marginTop: gap }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: on("rule") ? 1 : 0 }}
            transition={{ duration: DURATION.slow, ease: EASE.out }}
          />
          <motion.div
            aria-hidden
            style={{ marginTop: gap }}
            initial={{ opacity: 0, y: 8 }}
            animate={on("mister") ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: DURATION.slow, ease: EASE.out }}
          >
            <PixelIcon {...SHOW_NAME.mister} scale={scale} className="block" />
          </motion.div>
          <motion.div
            aria-hidden
            style={{ marginTop: gap }}
            initial={{ opacity: 0, x: -48, scale: 1.3 }}
            animate={on("first") ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: -48, scale: 1.3 }}
            transition={SPRING.bouncy}
          >
            <PixelIcon {...SHOW_NAME.first} scale={scale} className="block" />
          </motion.div>
          <motion.div
            aria-hidden
            style={{ marginTop: gap }}
            initial={{ opacity: 0, x: 48, scale: 1.3 }}
            animate={on("last") ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 48, scale: 1.3 }}
            transition={SPRING.bouncy}
          >
            <PixelIcon {...SHOW_NAME.last} scale={scale} className="block" />
          </motion.div>
          <motion.p
            className={cn("label-pixel text-(color:--tv-mist)", wide ? "mt-3 origin-top scale-150" : "mt-2")}
            initial={{ opacity: 0 }}
            animate={{ opacity: on("tagline") ? 1 : 0 }}
            transition={{ duration: DURATION.slow }}
          >
            {t("introTagline")}
          </motion.p>
        </div>
        <motion.div
          aria-hidden
          className={cn("shrink-0", !wide && "absolute bottom-0 left-1/2")}
          style={wide ? undefined : { marginLeft: (-ANCHOR_SIZE.width / 2) * anchorScale, bottom: -10 * anchorScale }}
          initial={{ opacity: 0, y: 60 }}
          animate={on("anchor") ? { opacity: 1, y: 0 } : { opacity: 0, y: 60 }}
          transition={SPRING.bouncy}
        >
          <PixelIcon
            {...anchorArt({ eyes: "happy", arm: wave === 0 ? "waveLeft" : "waveRight" })}
            scale={anchorScale}
            className="block"
          />
        </motion.div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the montage

export interface IntroMontageProps {
  /** Where the intro is: `introShot(elapsedMs, introMs)`. */
  frame: IntroFrame;
  /** CSS pixels per art pixel of the studio. */
  scale: number;
  /** Width of the picture in art pixels. */
  cols: number;
  wide: boolean;
  /** Reduced motion: only the finished title card. */
  reduced: boolean;
  /** Which way he waves on the title card (idle life of the studio). */
  wave: 0 | 1;
}

/** The opening montage; fills the picture of the TV. */
export function IntroMontage({ frame, scale, cols, wide, reduced, wave }: IntroMontageProps): JSX.Element {
  const t = useTranslations("newsStudio");
  const id = reduced ? "title" : frame.id;
  const shot: ShotProps = { frame, scale, cols };
  return (
    <div className="absolute inset-0 z-20 overflow-hidden bg-(--tv-bar)" data-testid="news-intro" data-intro-shot={id}>
      <h3 className="sr-only">
        {t("introTitle")} {t("introBy")}
      </h3>
      {id === "comb" && <CombShot {...shot} />}
      {id === "point" && <PointShot {...shot} />}
      {id === "mug" && <MugShot {...shot} />}
      {id === "money" && <MoneyShot {...shot} />}
      {id === "hero" && <HeroShot {...shot} />}
      {id === "title" && (
        <TitleCard
          beat={frame.id === "title" ? frame.beat : 0}
          scale={scale}
          wide={wide}
          reduced={reduced}
          wave={wave}
        />
      )}
      {id !== "title" && (
        <p
          key={id}
          className={cn(
            "absolute bottom-2 left-2 z-10 origin-bottom-left animate-pop rounded-xs bg-(--tv-ink) px-1.5 py-0.5 label-pixel text-(color:--tv-gold)",
            wide && "scale-150",
          )}
          data-testid="news-intro-caption"
        >
          {t(`introShots.${id}`)}
        </p>
      )}
      {!reduced && (
        <div key={frame.index} aria-hidden className="pointer-events-none absolute inset-0 z-20">
          {/* The cut: a flash and a red band that wipes across. */}
          <motion.div
            className="absolute inset-0 bg-(--tv-paper)"
            initial={{ opacity: frame.sinceMs < CUT_MS ? 0.85 : 0 }}
            animate={{ opacity: 0 }}
            transition={{ duration: DURATION.slow, ease: EASE.out }}
          />
          <motion.div
            className="absolute inset-y-0 left-0 w-1/3 bg-(--tv-red)"
            style={{ skewX: -12 }}
            initial={{ x: frame.sinceMs < CUT_MS ? "-140%" : "440%" }}
            animate={{ x: "440%" }}
            transition={{ duration: DURATION.slower, ease: EASE.inOut }}
          />
        </div>
      )}
    </div>
  );
}
