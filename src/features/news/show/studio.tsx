"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { useTranslations } from "next-intl";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from "react";
import { NEWSPAPER } from "@/components/pixel/art";
import {
  ANCHOR_DESK_ROW,
  ANCHOR_SIZE,
  ANTENNA,
  BACKDROP,
  BUBBLE_TAIL,
  DESK_SIGN,
  DESK_SIGN_ROW,
  DESK_SIGN_SHORT,
  HANDS,
  KNOB,
  LIGHT_RIG,
  MOOD_FX,
  MUG,
  NEWS_KIND_ICONS,
  SCENE_DESK_ROW,
  SCENE_HEIGHT,
  SCENE_MAX_WIDTH,
  SNOW,
  TOPIC_SCREEN,
  TOPIC_SCREEN_INSET,
  TV,
  anchorArt,
  cropCenter,
  deskArt,
  type AnchorArm,
  type AnchorBrows,
  type AnchorEyes,
  type AnchorMood,
  type AnchorMouth,
  type NewsKind,
} from "@/components/pixel/news-art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { PlayerFigure } from "@/components/ui/player-figure";
import { BALANCE } from "@/config/balance";
import { formatCountdown, localizeMoneyDeep } from "@/lib/format";
import { DURATION, EASE, SPRING, STAGGER } from "@/lib/motion";
import { NEWS_INTRO_MS, playSound, stopSound, type SoundName } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { introShot } from "./intro";
import { IntroMontage } from "./intro-montage";
import { MOOD_REACTION, segmentMood, speechDelayMs } from "./mood";

export { ANCHOR_MOODS, type AnchorMood } from "@/components/pixel/news-art";
export { INTRO_SHOTS, introShot, type IntroFrame, type IntroShotId } from "./intro";
export { MOOD_REACTION, defaultMood, isAnchorMood, segmentMood, speechDelayMs } from "./mood";

export interface StudioEffect {
  label: string;
  tone: "gain" | "loss" | "neutral";
}

/** The player a story is about, in their current look (ADR-157). */
export interface StudioFigure {
  nickname: string;
  avatarKey: string | null;
  accessories: readonly string[];
}

export interface StudioSegment {
  kind: string;
  headline: string;
  text: string;
  effects: StudioEffect[];
  /** Shown on the topic screen instead of the icon, like a news photo with a caption ("Gesucht", …). */
  figure?: StudioFigure | null;
  /**
   * The face he reads this story with. Left out, it follows from the kind and the effects (`defaultMood`). Every
   * mood but "neutral" begins with a short reaction (`MOOD_REACTION`), and the typewriter waits for it.
   */
  mood?: AnchorMood;
}

export interface NewsStudioProps {
  /**
   * standby: before the show (dimmed studio, "Gleich live" and the countdown); intro: the jingle and a montage about
   * the anchor that ends on the title card; live: the anchor reads `segment`; outro: he waves goodbye; off: no show
   * data yet (TV snow).
   */
  mode: "off" | "standby" | "intro" | "live" | "outro";
  /** standby: when the show starts (ms epoch), for the big countdown on the TV. */
  startsAt?: number | null;
  segment?: StudioSegment | null;
  /** 0-based. */
  segmentIndex?: number;
  segmentCount?: number;
  /**
   * ms since the current segment (or intro/outro) started. Drives the typewriter, the reaction of a mood and the
   * shots of the intro, so late joiners are in sync: shown characters = floor((elapsedMs - speechDelayMs(mood)) /
   * 1000 * charsPerSecond). Left out, everything is shown complete.
   */
  elapsedMs?: number;
  /** Length of the intro in ms; the montage and its jingle stretch to it. Default: `BALANCE.newsShow.introSeconds`. */
  introMs?: number;
  /** Default 28. */
  charsPerSecond?: number;
  /** "x schauen zu". */
  viewers?: number;
  /** Replay of an old show: a "Wiederholung" badge instead of LIVE. */
  replay?: boolean;
  className?: string;
}

// ---------------------------------------------------------------- geometry (in art pixels)

const RIG_ROWS = 8;
const ANCHOR_TOP = SCENE_DESK_ROW - ANCHOR_DESK_ROW;
/** Row of his mouth, counted from the top of the scene. */
const MOUTH_ROW = ANCHOR_TOP + 18;
const TOPIC_TOP = 5;
const TOPIC_WIDTH = 22;
/** The inside of the topic screen (art pixels), where a player's figure stands. */
const TOPIC_INNER = { x: 2, y: 4, width: 18, height: 16 } as const;
/** Row (from the top of the topic screen) where the caption under a player's photo begins. */
const CAPTION_ROW = 20;
/** From this picture width on, the speech bubble stands beside the anchor instead of above him. */
const WIDE_FROM = 720;
/** Width the picture has until it has been measured: a 390 px phone. */
const DEFAULT_WIDTH = 334;

interface Layout {
  wide: boolean;
  /** CSS pixels per art pixel, always a whole number. */
  scale: number;
  /** Width of the picture in art pixels. */
  cols: number;
  anchorX: number;
  topicX: number;
  /** Pixel size of the bubble's border and tail. */
  bubblePixel: number;
}

function studioLayout(available: number): Layout {
  const wide = available >= WIDE_FROM;
  // On a phone the anchor is as big as the width allows; on a wide picture there is room for more of the studio.
  const scale = wide
    ? Math.max(5, Math.min(8, Math.floor(available / 128)))
    : Math.max(2, Math.min(5, Math.floor(available / 80)));
  const cols = Math.max(72, Math.min(SCENE_MAX_WIDTH, Math.floor(available / scale)));
  const anchorX = wide ? 30 : Math.floor((cols - ANCHOR_SIZE.width - 3 - TOPIC_WIDTH) / 2);
  return {
    wide,
    scale,
    cols,
    anchorX,
    topicX: wide ? 4 : anchorX + ANCHOR_SIZE.width + 3,
    bubblePixel: Math.min(scale, 4),
  };
}

/** Width of an element's content box; null until it is mounted. */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number | null] {
  const [node, setNode] = useState<T | null>(null);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!node) return () => {};
      const observer = new ResizeObserver(notify);
      observer.observe(node);
      return () => observer.disconnect();
    },
    [node],
  );
  const width = useSyncExternalStore(
    subscribe,
    () => (node ? node.clientWidth : null),
    () => null,
  );
  return [setNode, width];
}

const subscribeNever = () => () => {};

/** False on the server and while hydrating, so both render the same markup; true from the first client render on. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

// ---------------------------------------------------------------- small hooks for idle life

/** A counter that goes up every `ms` while `active`. */
function useBeat(ms: number, active: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setCount((value) => value + 1), ms);
    return () => window.clearInterval(timer);
  }, [ms, active]);
  return count;
}

/** True for a moment every few seconds. */
function useBlink(active: boolean): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!active) return;
    let timeout: number;
    const schedule = () => {
      timeout = window.setTimeout(
        () => {
          setClosed(true);
          timeout = window.setTimeout(() => {
            setClosed(false);
            schedule();
          }, 140);
        },
        2200 + Math.random() * 3200,
      );
    };
    schedule();
    return () => window.clearTimeout(timeout);
  }, [active]);
  return active && closed;
}

const TALK_TICK_MS = 90;
/** Without a new character for this long, he stops moving his mouth (a paused replay, a stalled clock). */
const STALL_MS = 700;
const PAUSE_CHARS = /[\s.,;:!?…–—-]/;
const VOWELS = /[aeiouyäöü]/i;

/**
 * His mouth while he talks. Whether he talks at all comes from the props (`typing`); the flapping itself is an
 * idle loop like blinking, so it stays lively however often the parent ticks. It follows the character that was
 * typed last: wide on vowels, shut on spaces and punctuation, and it mumbles one syllable per open frame.
 */
function useMouth(typing: boolean, shown: number, char: string): AnchorMouth {
  const [mouth, setMouth] = useState<AnchorMouth>("closed");
  const live = useRef({ shown, char, advancedAt: Number.NEGATIVE_INFINITY, tick: 0 });

  useEffect(() => {
    const state = live.current;
    if (shown > state.shown) state.advancedAt = performance.now();
    state.shown = shown;
    state.char = char;
  }, [shown, char]);

  useEffect(() => {
    if (!typing) return;
    const timer = window.setInterval(() => {
      const state = live.current;
      const moving = performance.now() - state.advancedAt < STALL_MS;
      state.tick++;
      let next: AnchorMouth = "closed";
      if (moving && !PAUSE_CHARS.test(state.char)) {
        if (state.tick % 2 === 0) next = VOWELS.test(state.char) ? "open" : "half";
        else if (state.tick % 4 === 1) next = "half";
      }
      setMouth(next);
      if (next !== "closed" && !document.hidden) void playSound("anchorTalk");
    }, TALK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [typing]);

  return typing ? mouth : "closed";
}

const MOOD_SOUNDS: Record<Exclude<AnchorMood, "neutral">, SoundName> = {
  shocked: "anchorGasp",
  crying: "anchorCry",
  laughing: "anchorLaugh",
  angry: "anchorGrumble",
  smug: "anchorSmug",
  confused: "anchorHuh",
  proud: "anchorTada",
};

/** How much faster or slower than rendered the jingle may be played to fit the intro. */
const JINGLE_RATE = { min: 0.6, max: 1.8 } as const;
/** Arriving with less than this left of the intro, the jingle is not worth starting. */
const JINGLE_MIN_LEFT_MS = 1500;

interface SoundCues {
  mode: NewsStudioProps["mode"];
  segmentKey: string | null;
  /** The effect chips are on screen. */
  chipsShown: boolean;
  /** What the chips mean for the people in the story. */
  verdict: "gain" | "loss" | null;
  mood: AnchorMood;
  /** The reaction of the mood is under way. */
  moodCue: boolean;
  /** ms into the intro (or the segment), for joining the jingle where the picture is. */
  elapsed: number;
  introMs: number;
  replay: boolean;
}

/**
 * Jingle, stings, the voices of his moods and the verdict sounds. Everything here reacts to a change while the TV
 * is on screen; arriving in the middle of a show (or opening a replay) stays silent, except for the jingle of a live
 * intro, which joins where the picture is.
 */
function useShowSounds({
  mode,
  segmentKey,
  chipsShown,
  verdict,
  mood,
  moodCue,
  elapsed,
  introMs,
  replay,
}: SoundCues): void {
  const previous = useRef<Pick<SoundCues, "mode" | "segmentKey" | "chipsShown" | "moodCue"> | null>(null);
  const clock = useRef({ elapsed, introMs });
  useEffect(() => {
    clock.current = { elapsed, introMs };
  });

  useEffect(() => {
    const before = previous.current;
    previous.current = { mode, segmentKey, chipsShown, moodCue };
    const left = clock.current.introMs - clock.current.elapsed;
    const jingle = () => {
      // The jingle has a hit on every cut: played as fast as the intro is long, it stays on the picture.
      const rate = Math.min(JINGLE_RATE.max, Math.max(JINGLE_RATE.min, NEWS_INTRO_MS / clock.current.introMs));
      void playSound("newsIntro", 1, { rate, seekMs: Math.max(0, clock.current.elapsed) * rate });
    };

    if (!before) {
      if (mode === "intro" && !replay && left > JINGLE_MIN_LEFT_MS) jingle();
      return;
    }
    if (before.mode !== mode) {
      if (before.mode === "intro") stopSound("newsIntro");
      if (mode === "intro" && left > JINGLE_MIN_LEFT_MS) jingle();
      else if (mode === "outro") void playSound("newsSting");
    } else if (mode === "live" && before.segmentKey !== segmentKey) {
      void playSound("newsSting");
    }
    if (mode !== "live") return;
    const sameStory = before.mode === mode && before.segmentKey === segmentKey;
    if (moodCue && !(sameStory && before.moodCue)) {
      if (mood !== "neutral") void playSound(MOOD_SOUNDS[mood]);
    } else if (sameStory && chipsShown && !before.chipsShown && verdict) {
      void playSound(verdict === "loss" ? "newsBad" : "newsGood");
    }
  }, [mode, segmentKey, chipsShown, verdict, mood, moodCue, replay]);

  // Leaving the page cuts the jingle off.
  useEffect(() => () => stopSound("newsIntro"), []);
}

/** One pip per second for the last ten seconds before the show. */
function useCountdownPips(secondsLeft: number | null): void {
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = secondsLeft;
    if (secondsLeft === null || before === null) return;
    if (secondsLeft >= 1 && secondsLeft <= 10 && before === secondsLeft + 1) void playSound("newsTick");
  }, [secondsLeft]);
}

// ---------------------------------------------------------------- building blocks

interface SpriteProps {
  art: PixelArt;
  /** Position in art pixels. */
  x: number;
  y: number;
  scale: number;
  className?: string;
}

/** A piece of pixel art at a fixed place in the picture. Memoised: the paths are only rebuilt when the art changes. */
const Sprite = memo(function Sprite({ art, x, y, scale, className }: SpriteProps) {
  return (
    <div className={cn("absolute", className)} style={{ left: x * scale, top: y * scale }}>
      <PixelIcon {...art} scale={scale} className="block" />
    </div>
  );
});

type KindTone = "accent" | "gain" | "loss" | "warn" | "info";

const KIND_TONES: Record<NewsKind, KindTone> = {
  intro: "accent",
  loser: "loss",
  winner: "gain",
  scandal: "loss",
  hype: "gain",
  stock: "info",
  sector: "info",
  world: "accent",
  tasks: "warn",
  crypto: "warn",
  nft: "info",
  gossip: "accent",
  ramble: "warn",
  cards: "info",
  tax: "loss",
  corp: "info",
  outro: "accent",
};

const TONE_CLASS: Record<KindTone, string> = {
  accent: "bg-accent text-on-accent",
  gain: "bg-gain text-on-semantic",
  loss: "bg-loss text-on-semantic",
  warn: "bg-warn text-on-semantic",
  info: "bg-info text-on-semantic",
};

/** The caption over a player's photo on the topic screen: what they are in this story. */
const FRAME_KINDS = ["loser", "winner", "scandal", "hype", "gossip", "nft", "cards", "tax", "corp"] as const;
type FrameKind = (typeof FRAME_KINDS)[number] | "other";
const FRAME_CLASS: Record<FrameKind, string> = {
  loser: "bg-loss text-on-semantic",
  scandal: "bg-loss text-on-semantic",
  winner: "bg-gain text-on-semantic",
  hype: "bg-gain text-on-semantic",
  gossip: "bg-accent text-on-accent",
  nft: "bg-info text-on-semantic",
  cards: "bg-info text-on-semantic",
  tax: "bg-loss text-on-semantic",
  corp: "bg-info text-on-semantic",
  other: "bg-accent text-on-accent",
};
/** Wanted posters have paper behind the figure. */
const POSTER_KINDS = new Set<FrameKind>(["loser", "scandal", "tax"]);

function frameKind(kind: string | undefined): FrameKind {
  return (FRAME_KINDS as readonly string[]).includes(kind ?? "") ? (kind as FrameKind) : "other";
}

const EFFECT_CLASS: Record<StudioEffect["tone"], string> = {
  gain: "bg-gain text-on-semantic",
  loss: "bg-loss text-on-semantic",
  neutral: "bg-(--tv-dim) text-(color:--tv-paper)",
};

function isNewsKind(kind: string): kind is NewsKind {
  return Object.hasOwn(NEWS_KIND_ICONS, kind);
}

function Chip({ tone, icon, children }: { tone: KindTone; icon?: PixelArt; children: ReactNode }) {
  return (
    <span
      className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-xs px-1.5 label-pixel", TONE_CLASS[tone])}
      data-testid="news-kind"
    >
      {icon && (
        <span className="-ml-0.5 grid size-4 place-items-center rounded-xs bg-(--tv-bar)">
          <PixelIcon {...icon} scale={1} className="size-3.5" />
        </span>
      )}
      {children}
    </span>
  );
}

const TICKER_SEPARATOR = "+++";

/** The crawl at the bottom of the picture: running gags, purely decorative. */
const Crawl = memo(function Crawl({ items, moving }: { items: readonly string[]; moving: boolean }) {
  const line = items.map((item) => (
    <span key={item} className="flex items-center gap-3">
      <span>{item}</span>
      <span className="text-(color:--tv-red)">{TICKER_SEPARATOR}</span>
    </span>
  ));
  return (
    <div
      aria-hidden
      className="relative z-10 flex h-6 items-center overflow-hidden border-t border-(color:--tv-dim)/40 bg-(--tv-ink) label-pixel text-(color:--tv-mist)"
    >
      <motion.div
        className="flex w-max shrink-0 gap-3 pl-3 whitespace-nowrap"
        animate={moving ? { x: ["0%", "-50%"] } : { x: "0%" }}
        transition={moving ? { duration: 44, ease: "linear", repeat: Infinity } : { duration: 0 }}
      >
        <span className="flex gap-3">{line}</span>
        <span className="flex gap-3">{line}</span>
      </motion.div>
    </div>
  );
});

/** Scan lines, a vignette, the glare of the glass and a faint flicker: what makes it a tube. Opacity and transform only. */
const TubeGlass = memo(function TubeGlass({ alive }: { alive: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div className="absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent_0_2px,var(--tv-ink)_2px_3px)] opacity-10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,var(--tv-ink)_135%)] opacity-80" />
      <div className="absolute inset-x-0 top-0 h-1/4 bg-linear-to-b from-shine to-transparent opacity-15" />
      {alive && (
        <>
          <motion.div
            className="absolute inset-0 bg-(--tv-paper)"
            animate={{ opacity: [0.01, 0.035, 0.015, 0.03, 0.01] }}
            transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
          />
          <motion.div
            className="absolute inset-x-0 top-0 h-[12%] bg-linear-to-b from-transparent via-(--tv-paper) to-transparent opacity-[0.04]"
            animate={{ y: ["-100%", "840%"] }}
            transition={{ duration: 7, ease: "linear", repeat: Infinity }}
          />
        </>
      )}
    </div>
  );
});

// ---------------------------------------------------------------- moods

/** A comic mark beside his head; the position is in art pixels from the corner of his sprite. */
interface MoodMark {
  key: string;
  art: PixelArt;
  x: number;
  y: number;
  /** Pops in when it appears. */
  pop?: boolean;
  dim?: boolean;
}

/** What a mood does to the picture besides his face. */
interface MoodStage {
  /** His mouth at the peak of the reaction; null while he talks. */
  mouth: AnchorMouth | null;
  arm: AnchorArm;
  hands: keyof typeof HANDS;
  /** How far he moves, in art pixels. */
  dx: number;
  dy: number;
  /** The mug jumps when his fist lands. */
  mugHop: number;
  marks: MoodMark[];
}

const REACT_FRAME_MS = 110;
const CALM: MoodStage = { mouth: null, arm: "down", hands: "rest", dx: 0, dy: 0, mugHop: 0, marks: [] };

/**
 * The pose of a mood. `frame` counts the frames of the reaction and is null once it is over; `beat` is the idle beat
 * for what keeps looping while he reads; `still` (reduced motion) freezes everything in one readable pose.
 */
function moodStage(mood: AnchorMood, frame: number | null, beat: number, still: boolean): MoodStage {
  const reacting = frame !== null;
  const f = frame ?? 0;
  switch (mood) {
    case "shocked":
      // He jumps, an exclamation mark pops up, and the sweat stays while he reads.
      return {
        ...CALM,
        mouth: reacting ? "open" : null,
        dy: reacting ? Math.min(0, f - 3) : 0,
        marks: [
          ...(reacting || still ? [{ key: "exclaim", art: MOOD_FX.exclaim, x: 33, y: 0, pop: true }] : []),
          { key: "sweat", art: MOOD_FX.sweat, x: 4, y: reacting || still ? 2 : 3 + (beat % 2) },
        ],
      };
    case "crying":
      // Sobs into his handkerchief, then reads on with a sniff now and then.
      return reacting
        ? { ...CALM, mouth: f % 2 === 0 ? "open" : "half", arm: "hanky", hands: "one", dy: f % 2 }
        : { ...CALM, dy: !still && beat % 6 === 0 ? 1 : 0 };
    case "laughing": {
      // "Ha" left, "ha" right, shoulders shaking; while he reads, a chuckle every few beats.
      const chuckle = !reacting && !still && beat % 8 < 2;
      const ha = reacting ? f % 4 : chuckle ? (beat % 2) * 2 : still ? 0 : -1;
      return {
        ...CALM,
        mouth: reacting ? (f % 2 === 0 ? "open" : "half") : null,
        dy: reacting ? (f % 2) - 1 : chuckle ? -(beat % 2) : 0,
        marks:
          ha < 0
            ? []
            : ha < 2
              ? [{ key: "ha-left", art: MOOD_FX.ha, x: -1, y: 3, pop: true }]
              : [{ key: "ha-right", art: MOOD_FX.ha, x: 31, y: 7, pop: true }],
      };
    }
    case "angry":
      // The fist goes up and comes down, the desk shakes and the mug jumps; the vein keeps throbbing.
      return {
        ...CALM,
        mouth: reacting ? (f < 5 ? "open" : "half") : null,
        hands: reacting && f === 0 ? "fistUp" : "fistDown",
        dx: reacting && f >= 1 && f <= 4 ? (f % 2 === 0 ? -1 : 1) : 0,
        mugHop: reacting ? (f === 1 ? -2 : f === 2 ? -1 : 0) : 0,
        marks:
          reacting && f === 0
            ? []
            : [
                {
                  key: "anger",
                  art: MOOD_FX.anger,
                  x: 31,
                  y: 0,
                  pop: true,
                  dim: !reacting && !still && beat % 2 === 1,
                },
              ],
      };
    case "smug":
      // A twirl of the moustache and a little "ting".
      return reacting
        ? {
            ...CALM,
            mouth: "closed",
            arm: Math.floor(f / 2) % 2 === 0 ? "twirl" : "twirlUp",
            hands: "one",
            marks:
              f >= 3 ? [{ key: "ting", art: f % 2 === 1 ? MOOD_FX.sparkle : MOOD_FX.sparkleSmall, x: 33, y: 5 }] : [],
          }
        : CALM;
    case "confused":
      return {
        ...CALM,
        mouth: reacting ? "half" : null,
        marks: [{ key: "question", art: MOOD_FX.question, x: 32, y: reacting || still ? 0 : beat % 2, pop: true }],
      };
    case "proud": {
      // Chest out, a little taller, and he sparkles.
      const twinkle = still ? 0 : reacting ? f % 2 : beat % 2;
      return {
        ...CALM,
        mouth: reacting ? "closed" : null,
        dy: reacting && f < 2 ? -2 : -1,
        marks: [
          { key: "sparkle-left", art: twinkle === 0 ? MOOD_FX.sparkle : MOOD_FX.sparkleSmall, x: 1, y: 2 },
          { key: "sparkle-right", art: twinkle === 0 ? MOOD_FX.sparkleSmall : MOOD_FX.sparkle, x: 33, y: 6 },
        ],
      };
    }
    default:
      return CALM;
  }
}

// ---------------------------------------------------------------- the TV

const TV_VARS = {
  "--tv-ink": TV.ink,
  "--tv-wall": TV.wall,
  "--tv-bar": TV.bar,
  "--tv-dim": TV.dim,
  "--tv-paper": TV.paper,
  "--tv-mist": TV.mist,
  "--tv-red": TV.red,
  "--tv-gold": TV.gold,
  "--tv-sky": TV.sky,
} as CSSProperties;

/** Share of the text after which the effect chips pop in. */
const CHIPS_AT = 0.6;
const TAP_MS = 640;

/**
 * The hourly news show on a retro TV: Mr. Doodle Dangle in his studio, a speech bubble with his text and the
 * captions around it. Presentational and pure with respect to the show clock: what is typed, which chips are out,
 * how far the reaction of his mood is and which shot of the intro is on all follow from `elapsedMs`; only idle life
 * (blinking, the flapping mouth, tears, steam, the city, the tube) runs on its own. Static with reduced motion: the
 * whole text at once, the mood as one still pose, the title card instead of the montage, no frames, no flicker.
 */
export function NewsStudio({
  mode,
  startsAt,
  segment,
  segmentIndex = 0,
  segmentCount = 0,
  elapsedMs,
  charsPerSecond = 28,
  introMs = BALANCE.newsShow.introSeconds * 1000,
  viewers,
  replay = false,
  className,
}: NewsStudioProps): JSX.Element {
  const t = useTranslations("newsStudio");
  // The motion preference is only known in the browser: read it after hydration.
  const prefersReduced = Boolean(useReducedMotionConfig());
  const reduced = useHydrated() && prefersReduced;
  const [measure, measured] = useElementWidth<HTMLDivElement>();
  const layout = useMemo(() => studioLayout(measured ?? DEFAULT_WIDTH), [measured]);
  const { wide, scale, cols, anchorX, topicX, bubblePixel } = layout;
  const now = useClock();

  const elapsed = elapsedMs === undefined ? Number.POSITIVE_INFINITY : Math.max(0, elapsedMs);
  const onAir = mode === "intro" || mode === "live" || mode === "outro";

  // ---- what he says
  // Server texts name amounts in euros; the player may have chosen another sign (ADR-113).
  const script = useMemo(() => (segment ? localizeMoneyDeep(segment) : null), [segment]);
  const story = mode === "live" ? script : null;
  const speech = mode === "live" ? (story?.text ?? "") : mode === "outro" ? (script?.text ?? t("outro")) : "";
  const chars = useMemo(() => Array.from(speech), [speech]);
  const total = chars.length;
  // ---- how he takes it: a short reaction first, then he reads
  const waving = mode === "outro" || story?.kind === "outro";
  const mood: AnchorMood = story && !waving ? segmentMood(story) : "neutral";
  const moody = mood !== "neutral";
  const reactionOn = moody && elapsed >= MOOD_REACTION.startMs;
  const moodCue = reactionOn && elapsed < MOOD_REACTION.endMs;
  const spoken = Math.max(0, elapsed - (reduced ? 0 : speechDelayMs(mood)));
  const shown = reduced ? total : Math.min(total, Math.floor((spoken / 1000) * charsPerSecond));
  const typing = shown < total;
  const segmentKey = story ? `${segmentIndex}:${story.headline}` : null;
  const effects = story?.effects ?? [];
  const chipsShown = story !== null && shown >= Math.ceil(total * CHIPS_AT);
  const verdict = effects.some((effect) => effect.tone === "loss")
    ? "loss"
    : effects.some((effect) => effect.tone === "gain")
      ? "gain"
      : null;
  const kind = story && isNewsKind(story.kind) ? story.kind : null;

  // ---- the countdown before the show
  const secondsLeft =
    mode === "standby" && startsAt != null && now !== null ? Math.max(0, Math.ceil((startsAt - now) / 1000)) : null;
  const finalCountdown = secondsLeft !== null && secondsLeft <= 10;

  useShowSounds({
    mode,
    segmentKey,
    chipsShown: chipsShown && effects.length > 0,
    verdict,
    mood,
    moodCue,
    elapsed,
    introMs,
    replay,
  });
  useCountdownPips(secondsLeft);

  // ---- idle life
  const beat = useBeat(300, !reduced && mode !== "off");
  const snow = useBeat(110, !reduced && mode === "off");
  const blink = useBlink(!reduced && mode !== "off");
  const mouth = useMouth(!reduced && typing, shown, chars[shown - 1] ?? " ");

  // ---- his pose, from the props
  const inStudio = mode === "live" || mode === "outro" || (mode === "standby" && finalCountdown);
  const recent = chars.slice(Math.max(0, shown - 5), shown).join("");
  const emphasis = typing && /[!?]/.test(recent);
  const chipMoment = chipsShown && effects.length > 0 && shown < Math.ceil(total * (CHIPS_AT + 0.12));
  const roast = story?.kind === "loser" || story?.kind === "scandal";
  let brows: AnchorBrows = "rest";
  if (!reduced && mode === "live") {
    if (emphasis || chipMoment) brows = roast ? "cocked" : "raised";
    else if (roast && elapsed < 1200) brows = "cocked";
  }
  const pleased = !reduced && chipMoment && verdict === "gain";
  const eyes: AnchorEyes = waving || pleased ? "happy" : blink ? "blink" : "open";
  const arm: AnchorArm = !waving ? "down" : reduced || beat % 2 === 0 ? "waveLeft" : "waveRight";
  // The mood shows from the moment the reaction hits; with reduced motion it is there from the start.
  const felt = moody && (reduced || reactionOn);
  const reactFrame = moodCue && !reduced ? Math.floor((elapsed - MOOD_REACTION.startMs) / REACT_FRAME_MS) : null;
  const stage = felt ? moodStage(mood, reactFrame, beat, reduced) : CALM;
  const anchor = felt
    ? anchorArt({
        mood,
        mouth: stage.mouth ?? mouth,
        eyes: blink ? "blink" : "open",
        arm: stage.arm,
        frame: reduced || beat % 2 === 0 ? 0 : 1,
        react: reactFrame !== null,
      })
    : anchorArt({ mouth, eyes, brows, arm });
  const tapping =
    !reduced &&
    ((mode === "live" && elapsed < (moody ? MOOD_REACTION.startMs : TAP_MS)) || (mode === "standby" && finalCountdown));
  const tapFrame = mode === "live" ? Math.floor(elapsed / 160) % 2 : beat % 2;
  const hands = waving
    ? HANDS.one
    : stage.hands !== "rest"
      ? HANDS[stage.hands]
      : tapping
        ? tapFrame === 0
          ? HANDS.tapUp
          : HANDS.tapDown
        : HANDS.rest;
  const lift = felt ? stage.dy : brows === "raised" ? -1 : 0;

  // ---- the set, cut to the width of the picture
  const cityFrame = Math.floor(beat / 6) % 2;
  const lightsOn = onAir || finalCountdown;
  const backdrop = useMemo<PixelArt>(
    () => ({
      palette: BACKDROP[cityFrame as 0 | 1].palette,
      grid: cropCenter(BACKDROP[cityFrame as 0 | 1].grid, cols),
    }),
    [cityFrame, cols],
  );
  const rig = useMemo<PixelArt>(() => {
    const source = lightsOn ? LIGHT_RIG.on : LIGHT_RIG.off;
    return { palette: source.palette, grid: cropCenter(source.grid, cols) };
  }, [lightsOn, cols]);
  const desk = useMemo(() => deskArt(cols), [cols]);
  const sign = (DESK_SIGN.grid[0]?.length ?? 0) + 4 <= cols ? DESK_SIGN : DESK_SIGN_SHORT;
  const signWidth = sign.grid[0]?.length ?? 0;
  // A story about a player shows them on the topic screen (half the scale, so the whole figure fits inside).
  const figure = mode === "live" ? (story?.figure ?? null) : null;
  const figureScale = Math.max(1, Math.floor(scale / 2));
  const frame = frameKind(story?.kind);
  const topicIcon = kind
    ? NEWS_KIND_ICONS[kind]
    : mode === "live" && story
      ? NEWSPAPER
      : NEWS_KIND_ICONS[mode === "outro" ? "outro" : "intro"];

  // ---- sizes in CSS pixels
  const rigHeight = RIG_ROWS * scale;
  const sceneHeight = SCENE_HEIGHT * scale;
  const pictureWidth = cols * scale;
  const pad = 2 * scale;
  const zone: CSSProperties = wide
    ? {
        minHeight: rigHeight + sceneHeight,
        paddingTop: rigHeight + pad,
        paddingLeft: (anchorX + ANCHOR_SIZE.width + 3) * scale,
        paddingRight: pad + scale,
        paddingBottom: (SCENE_HEIGHT - SCENE_DESK_ROW + 3) * scale,
      }
    : {
        minHeight: rigHeight + sceneHeight + 112,
        paddingTop: rigHeight + 6,
        paddingLeft: pad,
        paddingRight: pad,
        paddingBottom: sceneHeight - (ANCHOR_TOP + 1) * scale + 6 * bubblePixel,
      };
  const tailStyle: CSSProperties = wide
    ? {
        left: -6 * bubblePixel,
        bottom: (SCENE_DESK_ROW - 3 - MOUTH_ROW) * scale - 3 * bubblePixel,
      }
    : {
        left: (anchorX + ANCHOR_SIZE.width / 2) * scale - pad - 3 * bubblePixel,
        bottom: -6 * bubblePixel,
      };
  const long = total > (wide ? 220 : 150);
  const speechSize = wide && scale >= 7 ? (long ? "text-lg" : "text-xl") : long ? "text-sm" : "text-base";

  const introFrame = mode === "intro" ? introShot(elapsed, introMs) : null;
  const tickerItems = t.raw("ticker") as string[];

  const liveBadge = replay ? (
    <span
      className="inline-flex h-5 items-center rounded-xs bg-(--tv-paper) px-1.5 label-pixel text-(color:--tv-ink)"
      data-testid="news-replay"
    >
      {t("replay")}
    </span>
  ) : onAir ? (
    <span
      className="inline-flex h-5 items-center gap-1.5 rounded-xs bg-loss px-1.5 label-pixel text-on-semantic"
      data-testid="news-live"
    >
      <span className="size-1.5 animate-pulse-danger rounded-xs bg-on-semantic" />
      {t("live")}
    </span>
  ) : null;

  let bannerChip: ReactNode;
  let bannerLine: string;
  if (mode === "live" && story) {
    bannerChip = (
      <Chip tone={kind ? KIND_TONES[kind] : "accent"} icon={kind ? NEWS_KIND_ICONS[kind] : NEWSPAPER}>
        {t(`kinds.${kind ?? "other"}`)}
      </Chip>
    );
    bannerLine = story.headline;
  } else if (mode === "standby") {
    bannerChip = <Chip tone="warn">{t("standbyTitle")}</Chip>;
    bannerLine = finalCountdown ? t("standbyFinal") : t("standbyHint");
  } else if (mode === "outro") {
    bannerChip = (
      <Chip tone="accent" icon={NEWS_KIND_ICONS.outro}>
        {t("kinds.outro")}
      </Chip>
    );
    bannerLine = script?.headline ?? t("outroHeadline");
  } else if (mode === "off") {
    bannerChip = <Chip tone="info">{t("noSignal")}</Chip>;
    bannerLine = t("show");
  } else {
    bannerChip = (
      <Chip tone="loss" icon={NEWS_KIND_ICONS.intro}>
        {t("introChip")}
      </Chip>
    );
    bannerLine = `${t("show")} ${t("introBy")}`;
  }

  return (
    <section
      aria-label={t("tvLabel")}
      data-testid="news-studio"
      data-mode={mode}
      data-mood={mood}
      data-reacting={reactFrame !== null ? "true" : undefined}
      data-intro-shot={introFrame ? (reduced ? "title" : introFrame.id) : undefined}
      data-layout={wide ? "wide" : "compact"}
      className={cn("mx-auto w-full max-w-(--content-max)", className)}
      style={TV_VARS}
    >
      <div aria-hidden className="relative z-0 -mb-0.5 flex justify-center text-fg-3">
        <PixelIcon {...ANTENNA} scale={wide ? 4 : 3} />
      </div>
      <div className="relative z-10 rounded-xl border border-line-2 bg-surface-3 p-2 shadow-2 sm:p-3">
        <div className="rounded-lg bg-(--tv-ink) p-1">
          <div ref={measure} className="w-full">
            <div
              className="relative mx-auto overflow-hidden rounded-md bg-(--tv-ink)"
              style={{ width: pictureWidth }}
              data-testid="news-screen"
            >
              {/* Screen readers get each story once and complete, not letter by letter. */}
              <p className="sr-only" aria-live="polite" data-testid="news-spoken">
                {speech === "" ? "" : `${story ? `${story.headline}. ` : ""}${speech}`}
              </p>
              {/* ---------------- picture ---------------- */}
              <div className="relative overflow-hidden bg-(--tv-wall)">
                {mode === "off" ? (
                  <div
                    className="relative grid place-items-center overflow-hidden bg-(--tv-ink)"
                    style={{ minHeight: zone.minHeight }}
                  >
                    <div
                      aria-hidden
                      className={cn("absolute top-0 left-0", snow % 4 >= 2 && "-scale-x-100")}
                      style={{ width: pictureWidth, height: "100%" }}
                    >
                      <PixelIcon {...SNOW[snow % 2 === 0 ? 0 : 1]} scale={scale * 2} className="block" />
                    </div>
                    <div className="relative z-10 rounded-sm border-2 border-(color:--tv-paper) bg-(--tv-ink) px-4 py-3 text-center">
                      <p className="font-pixel text-lg text-(color:--tv-paper) uppercase">{t("noSignal")}</p>
                      <p className="mt-1 text-xs text-(color:--tv-mist)">{t("noSignalHint")}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Sprite art={rig} x={0} y={0} scale={scale} />
                    <div
                      aria-hidden
                      className="absolute bottom-0 left-0 overflow-hidden"
                      style={{ height: sceneHeight, width: pictureWidth }}
                    >
                      <Sprite art={backdrop} x={0} y={0} scale={scale} />
                      <Sprite art={TOPIC_SCREEN} x={topicX} y={TOPIC_TOP} scale={scale} />
                      {figure ? (
                        <div
                          key={segmentKey ?? mode}
                          className={cn(
                            "absolute flex items-end justify-center overflow-hidden",
                            POSTER_KINDS.has(frame) && "bg-(--tv-paper)",
                            !reduced && "animate-pop",
                          )}
                          style={{
                            left: (topicX + TOPIC_INNER.x) * scale,
                            top: (TOPIC_TOP + TOPIC_INNER.y) * scale,
                            width: TOPIC_INNER.width * scale,
                            height: TOPIC_INNER.height * scale,
                          }}
                        >
                          <PlayerFigure
                            avatarKey={figure.avatarKey}
                            accessories={figure.accessories}
                            scale={figureScale}
                            className="block"
                          />
                        </div>
                      ) : (
                        <div
                          key={segmentKey ?? mode}
                          className={cn("absolute", !reduced && "animate-pop")}
                          style={{
                            left: (topicX + TOPIC_SCREEN_INSET.x) * scale,
                            top: (TOPIC_TOP + TOPIC_SCREEN_INSET.y) * scale,
                          }}
                        >
                          <PixelIcon {...topicIcon} scale={scale} className="block" />
                        </div>
                      )}
                      {figure && (
                        <div
                          key={`${segmentKey}:caption`}
                          className={cn(
                            "absolute flex flex-col items-center gap-px text-center",
                            !reduced && "animate-pop",
                          )}
                          style={{
                            left: (topicX - 1) * scale,
                            top: (TOPIC_TOP + CAPTION_ROW) * scale,
                            width: (TOPIC_WIDTH + 2) * scale,
                          }}
                          data-testid="news-figure"
                          data-nickname={figure.nickname}
                          data-frame={frame}
                        >
                          <span
                            className={cn(
                              "max-w-full rounded-xs px-1 label-pixel text-balance shadow-[2px_2px_0_0_var(--tv-ink)]",
                              FRAME_CLASS[frame],
                            )}
                          >
                            {t(`frames.${frame}`)}
                          </span>
                          <span className="max-w-full truncate rounded-xs bg-(--tv-ink) px-1 text-2xs leading-4 font-semibold text-(color:--tv-paper)">
                            {figure.nickname}
                          </span>
                        </div>
                      )}
                      {inStudio && (
                        <motion.div
                          className="absolute top-0 left-0"
                          initial={mode === "standby" && !reduced ? { y: ANCHOR_SIZE.height * scale } : false}
                          animate={{ x: stage.dx * scale, y: lift * scale }}
                          transition={lift === 0 && mode === "standby" ? SPRING.bouncy : { duration: 0 }}
                        >
                          <Sprite art={anchor} x={anchorX} y={ANCHOR_TOP} scale={scale} />
                        </motion.div>
                      )}
                      {inStudio &&
                        stage.marks.map((mark) => (
                          <div
                            key={`${segmentKey}:${mark.key}`}
                            className={cn("absolute top-0 left-0", mark.dim && "opacity-50")}
                            style={{
                              transform: `translate(${(anchorX + mark.x) * scale}px, ${(ANCHOR_TOP + mark.y) * scale}px)`,
                            }}
                            data-testid="news-mood-mark"
                          >
                            <PixelIcon
                              {...mark.art}
                              scale={scale}
                              className={cn("block", mark.pop && !reduced && "animate-pop")}
                            />
                          </div>
                        ))}
                      <Sprite art={desk} x={0} y={SCENE_DESK_ROW} scale={scale} />
                      <Sprite
                        art={sign}
                        x={Math.floor((cols - signWidth) / 2)}
                        y={SCENE_DESK_ROW + DESK_SIGN_ROW}
                        scale={scale}
                      />
                      <div
                        className="absolute top-0 left-0"
                        style={stage.mugHop === 0 ? undefined : { transform: `translateY(${stage.mugHop * scale}px)` }}
                      >
                        <Sprite
                          art={MUG[reduced ? 0 : Math.floor(beat / 2) % 2 === 0 ? 0 : 1]}
                          x={Math.max(0, anchorX - 11)}
                          y={SCENE_DESK_ROW - 10}
                          scale={scale}
                        />
                      </div>
                      {inStudio && <Sprite art={hands} x={anchorX + 3} y={SCENE_DESK_ROW - 8} scale={scale} />}
                    </div>
                    {mode === "standby" && (
                      <div
                        aria-hidden
                        className={cn(
                          "absolute inset-0 bg-(--tv-ink) transition-opacity duration-slower ease-out",
                          finalCountdown ? "opacity-25" : "opacity-65",
                        )}
                      />
                    )}

                    {/* What stands on the wall: the speech bubble, or the countdown. */}
                    <div className="relative z-10 flex flex-col justify-end" style={zone}>
                      {mode === "standby" && (
                        <div
                          className={cn(
                            "flex flex-col items-center text-center",
                            // On the big picture the whole panel is doubled, like a caption burnt into the image.
                            wide ? (scale >= 7 ? "my-auto scale-200" : "my-auto scale-150") : "mt-auto mb-2",
                          )}
                          data-testid="news-standby"
                        >
                          <p className="label-pixel text-(color:--tv-gold)">{t("standbyTitle")}</p>
                          {secondsLeft === null ? (
                            <p className="mt-1 font-pixel text-2xl text-(color:--tv-paper)">
                              {startsAt == null ? t("startsNow") : "--:--"}
                            </p>
                          ) : secondsLeft === 0 ? (
                            <p className="mt-1 font-pixel text-2xl text-(color:--tv-paper)">{t("startsNow")}</p>
                          ) : finalCountdown ? (
                            <p
                              className="mt-3 mb-4 scale-200 font-pixel nums text-4xl text-(color:--tv-paper)"
                              aria-live="off"
                              data-testid="news-countdown"
                            >
                              <span key={secondsLeft} className="inline-block animate-pop">
                                {secondsLeft}
                              </span>
                            </p>
                          ) : (
                            <>
                              <p className="mt-1 text-xs text-(color:--tv-mist)">{t("startsIn")}</p>
                              <p
                                className="font-pixel nums text-4xl text-(color:--tv-paper)"
                                data-testid="news-countdown"
                              >
                                {formatCountdown(secondsLeft)}
                              </p>
                            </>
                          )}
                        </div>
                      )}
                      {speech !== "" && (
                        <div
                          key={segmentKey ?? mode}
                          className={cn(
                            "relative rounded-md border-(color:--tv-ink) bg-(--tv-paper) text-(color:--tv-ink) shadow-[3px_3px_0_0_var(--tv-ink)]",
                            wide ? "origin-left" : "origin-bottom-left",
                            !reduced && "animate-pop",
                          )}
                          style={{
                            borderWidth: bubblePixel,
                            minHeight: wide ? (SCENE_DESK_ROW - MOUTH_ROW) * scale : undefined,
                            padding: `${Math.max(6, 2 * bubblePixel)}px ${Math.max(8, 3 * bubblePixel)}px`,
                          }}
                          data-testid="news-bubble"
                        >
                          <span aria-hidden className="absolute" style={tailStyle}>
                            <PixelIcon
                              {...(wide ? BUBBLE_TAIL.left : BUBBLE_TAIL.down)}
                              scale={bubblePixel}
                              className="block"
                            />
                          </span>
                          <p className="label-pixel text-(color:--tv-red)">{t("anchor")}</p>
                          <p
                            aria-hidden
                            className={cn("mt-0.5 font-medium text-pretty", speechSize)}
                            data-testid="news-speech"
                            data-typing={typing}
                          >
                            <span data-testid="news-typed">{chars.slice(0, shown).join("")}</span>
                            {/* The rest is there but invisible, so the bubble has its final size from the first letter. */}
                            <span className="invisible">{chars.slice(shown).join("")}</span>
                          </p>
                        </div>
                      )}
                    </div>

                    {introFrame && (
                      <IntroMontage
                        frame={introFrame}
                        scale={scale}
                        cols={cols}
                        wide={wide}
                        reduced={reduced}
                        wave={reduced || beat % 2 === 0 ? 0 : 1}
                      />
                    )}
                  </>
                )}

                <div className="absolute inset-x-1.5 top-1.5 z-20 flex items-start justify-between gap-2">
                  <span className="flex min-h-5 items-center">{liveBadge}</span>
                  {viewers !== undefined && mode !== "off" && (
                    <span
                      className="inline-flex h-5 items-center rounded-xs bg-(--tv-ink)/70 px-1.5 label-pixel nums text-(color:--tv-paper)"
                      data-testid="news-viewers"
                    >
                      {t("viewers", { count: viewers })}
                    </span>
                  )}
                </div>
              </div>

              {/* ---------------- captions ---------------- */}
              <div
                className={cn(
                  "relative z-10 border-t-2 border-(color:--tv-red) bg-(--tv-bar)",
                  wide ? "px-4 pt-3 pb-3.5" : "px-2.5 pt-2 pb-2.5",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  {bannerChip}
                  {mode === "live" && segmentCount > 1 && (
                    <span
                      role="img"
                      aria-label={t("segmentOf", { index: segmentIndex + 1, count: segmentCount })}
                      className="flex items-center gap-1"
                      data-testid="news-progress"
                    >
                      {segmentCount > 14 ? (
                        <span className="label-pixel nums text-(color:--tv-mist)">
                          {segmentIndex + 1}/{segmentCount}
                        </span>
                      ) : (
                        Array.from({ length: segmentCount }, (_, index) => (
                          <span
                            key={index}
                            className={cn(
                              "size-1.5 rounded-xs",
                              index < segmentIndex
                                ? "bg-(--tv-paper)"
                                : index === segmentIndex
                                  ? "animate-pulse-danger bg-(--tv-gold)"
                                  : "bg-(--tv-dim)",
                            )}
                          />
                        ))
                      )}
                    </span>
                  )}
                </div>
                <motion.p
                  key={segmentKey ?? mode}
                  initial={reduced ? false : { opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: DURATION.slow, ease: EASE.out }}
                  className={cn(
                    "mt-1.5 line-clamp-2 font-semibold text-pretty text-(color:--tv-paper)",
                    wide ? "min-h-7 text-xl" : "min-h-9 text-sm",
                  )}
                  data-testid="news-headline"
                >
                  {bannerLine}
                </motion.p>
                <ul className="mt-1.5 flex min-h-6 flex-wrap gap-1.5" aria-hidden={!chipsShown}>
                  {effects.map((effect, index) => (
                    <motion.li
                      key={`${segmentKey}:${index}`}
                      initial={chipsShown ? false : { opacity: 0, scale: 0.5, y: 6 }}
                      animate={chipsShown ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.5, y: 6 }}
                      transition={{ ...SPRING.bouncy, delay: chipsShown ? index * STAGGER * 2 : 0 }}
                      className={cn(
                        "inline-flex items-center rounded-xs px-2 nums font-bold",
                        wide ? "h-7 text-sm" : "h-6 text-xs",
                        EFFECT_CLASS[effect.tone],
                      )}
                      data-testid="news-effect"
                      data-tone={effect.tone}
                      data-shown={chipsShown}
                    >
                      {effect.label}
                    </motion.li>
                  ))}
                </ul>
              </div>
              <Crawl items={tickerItems} moving={!reduced && mode !== "off"} />
              <TubeGlass alive={!reduced} />
            </div>
          </div>
        </div>

        {/* ---------------- the set's own controls ---------------- */}
        <div aria-hidden className="mt-2 flex items-center gap-2.5 px-1 sm:mt-3">
          <span className="label-pixel text-fg-3">{t("brand")}</span>
          <span className="h-3 min-w-0 flex-1 bg-[repeating-linear-gradient(90deg,var(--line-2)_0_2px,transparent_2px_5px)]" />
          <PixelIcon {...KNOB[onAir ? 1 : 0]} scale={2} />
          <PixelIcon {...KNOB[mode === "off" ? 0 : 1]} scale={2} />
          <span
            data-testid="news-led"
            className={cn(
              "size-2.5 rounded-xs border border-line-2",
              replay
                ? "bg-info"
                : onAir
                  ? "animate-pulse-danger bg-loss"
                  : mode === "standby"
                    ? cn("bg-warn", finalCountdown && "animate-pulse-danger")
                    : "bg-surface-1",
            )}
          />
        </div>
      </div>
    </section>
  );
}
