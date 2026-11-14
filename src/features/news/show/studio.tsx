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
import { COIN, NEWSPAPER } from "@/components/pixel/art";
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
  MUG,
  NEWS_KIND_ICONS,
  SCENE_DESK_ROW,
  SCENE_HEIGHT,
  SCENE_MAX_WIDTH,
  SHOW_TITLE,
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
  type AnchorMouth,
  type NewsKind,
} from "@/components/pixel/news-art";
import { PixelIcon, type PixelArt } from "@/components/pixel/pixel-icon";
import { formatCountdown, localizeMoneyDeep } from "@/lib/format";
import { DURATION, EASE, SPRING, STAGGER } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";

export interface StudioEffect {
  label: string;
  tone: "gain" | "loss" | "neutral";
}

export interface StudioSegment {
  kind: string;
  headline: string;
  text: string;
  effects: StudioEffect[];
}

export interface NewsStudioProps {
  /**
   * standby: before the show (dimmed studio, "Gleich live" and the countdown); intro: opening jingle and title card;
   * live: the anchor reads `segment`; outro: he waves goodbye; off: no show data yet (TV snow).
   */
  mode: "off" | "standby" | "intro" | "live" | "outro";
  /** standby: when the show starts (ms epoch), for the big countdown on the TV. */
  startsAt?: number | null;
  segment?: StudioSegment | null;
  /** 0-based. */
  segmentIndex?: number;
  segmentCount?: number;
  /**
   * ms since the current segment (or intro/outro) started. Drives the typewriter, so late joiners are in sync:
   * shown characters = floor(elapsedMs / 1000 * charsPerSecond). Left out, everything is shown complete.
   */
  elapsedMs?: number;
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
function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number | null] {
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

interface SoundCues {
  mode: NewsStudioProps["mode"];
  segmentKey: string | null;
  segmentIndex: number;
  /** The effect chips are on screen. */
  chipsShown: boolean;
  /** What the chips mean for the people in the story. */
  verdict: "gain" | "loss" | null;
  /** The intro or the first story has only just begun. */
  early: boolean;
  replay: boolean;
}

/**
 * Jingle, stings and the verdict sounds. Everything here reacts to a change while the TV is on screen; arriving in
 * the middle of a show (or opening a replay) stays silent, except for the jingle at the very top of a live show.
 */
function useShowSounds({ mode, segmentKey, segmentIndex, chipsShown, verdict, early, replay }: SoundCues): void {
  const previous = useRef<{ mode: SoundCues["mode"]; segmentKey: string | null; chipsShown: boolean } | null>(null);
  const jinglePlayed = useRef(false);

  useEffect(() => {
    const before = previous.current;
    previous.current = { mode, segmentKey, chipsShown };
    if (mode === "standby" || mode === "off") jinglePlayed.current = false;
    const jingle = () => {
      jinglePlayed.current = true;
      void playSound("newsIntro");
    };

    if (!before) {
      if (!replay && early && (mode === "intro" || (mode === "live" && segmentIndex === 0))) jingle();
      return;
    }
    if (before.mode !== mode) {
      if (mode === "intro") jingle();
      else if (mode === "live" && segmentIndex === 0 && early && !jinglePlayed.current) jingle();
      else if (mode === "outro") void playSound("newsSting");
      return;
    }
    if (mode !== "live") return;
    if (before.segmentKey !== segmentKey) void playSound("newsSting");
    else if (chipsShown && !before.chipsShown && verdict) void playSound(verdict === "loss" ? "newsBad" : "newsGood");
  }, [mode, segmentKey, segmentIndex, chipsShown, verdict, early, replay]);
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
  outro: "accent",
};

const TONE_CLASS: Record<KindTone, string> = {
  accent: "bg-accent text-on-accent",
  gain: "bg-gain text-on-semantic",
  loss: "bg-loss text-on-semantic",
  warn: "bg-warn text-on-semantic",
  info: "bg-info text-on-semantic",
};

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
} as CSSProperties;

const INTRO_STEPS = { coin: 0, name: 250, word: 550, rule: 850, anchor: 1100, tagline: 1700 } as const;
/** Share of the text after which the effect chips pop in. */
const CHIPS_AT = 0.6;
const TAP_MS = 640;

/**
 * The hourly news show on a retro TV: Mr. Doodle Dangle in his studio, a speech bubble with his text and the
 * captions around it. Presentational and pure with respect to the show clock: what is typed, which chips are out and
 * where the title card stands all follow from `elapsedMs`; only idle life (blinking, the flapping mouth, steam, the
 * city, the tube) runs on its own. Static with reduced motion: the whole text at once, no frames, no flicker.
 */
export function NewsStudio({
  mode,
  startsAt,
  segment,
  segmentIndex = 0,
  segmentCount = 0,
  elapsedMs,
  charsPerSecond = 28,
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
  const shown = reduced ? total : Math.min(total, Math.floor((elapsed / 1000) * charsPerSecond));
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
    segmentIndex,
    chipsShown: chipsShown && effects.length > 0,
    verdict,
    early: elapsed < (mode === "intro" ? 2500 : 1500),
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
  const waving = mode === "outro" || story?.kind === "outro";
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
  const anchor = anchorArt({ mouth, eyes, brows, arm });
  const tapping = !reduced && ((mode === "live" && elapsed < TAP_MS) || (mode === "standby" && finalCountdown));
  const tapFrame = mode === "live" ? Math.floor(elapsed / 160) % 2 : beat % 2;
  const hands = waving ? HANDS.one : tapping ? (tapFrame === 0 ? HANDS.tapUp : HANDS.tapDown) : HANDS.rest;
  const lift = brows === "raised" ? -1 : 0;

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

  const introAt = (step: keyof typeof INTRO_STEPS) => reduced || elapsed >= INTRO_STEPS[step];
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
                      {inStudio && (
                        <motion.div
                          className="absolute top-0 left-0"
                          initial={mode === "standby" && !reduced ? { y: ANCHOR_SIZE.height * scale } : false}
                          animate={{ y: lift * scale }}
                          transition={lift === 0 && mode === "standby" ? SPRING.bouncy : { duration: 0 }}
                        >
                          <Sprite art={anchor} x={anchorX} y={ANCHOR_TOP} scale={scale} />
                        </motion.div>
                      )}
                      <Sprite art={desk} x={0} y={SCENE_DESK_ROW} scale={scale} />
                      <Sprite
                        art={sign}
                        x={Math.floor((cols - signWidth) / 2)}
                        y={SCENE_DESK_ROW + DESK_SIGN_ROW}
                        scale={scale}
                      />
                      <Sprite
                        art={MUG[reduced ? 0 : Math.floor(beat / 2) % 2 === 0 ? 0 : 1]}
                        x={Math.max(0, anchorX - 11)}
                        y={SCENE_DESK_ROW - 10}
                        scale={scale}
                      />
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

                    {mode === "intro" && (
                      <div
                        className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-(--tv-bar) bg-[repeating-linear-gradient(135deg,transparent_0_14px,var(--tv-wall)_14px_28px)]"
                        data-testid="news-intro"
                      >
                        <motion.div
                          aria-hidden
                          className="absolute inset-x-0 top-0 h-2 origin-left bg-(--tv-red)"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: introAt("coin") ? 1 : 0 }}
                          transition={{ duration: DURATION.slower, ease: EASE.out }}
                        />
                        <motion.div
                          aria-hidden
                          className="absolute inset-x-0 bottom-0 h-2 origin-right bg-(--tv-gold)"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: introAt("coin") ? 1 : 0 }}
                          transition={{ duration: DURATION.slower, ease: EASE.out }}
                        />
                        <div className={cn("relative flex items-center", wide ? "gap-10" : "flex-col")}>
                          <div className="flex flex-col items-center text-center">
                            <motion.div
                              aria-hidden
                              initial={{ scale: 0, opacity: 0 }}
                              animate={introAt("coin") ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
                              transition={SPRING.bouncy}
                            >
                              <PixelIcon {...COIN} scale={Math.max(3, scale)} />
                            </motion.div>
                            <h3 className="sr-only">{t("introTitle")}</h3>
                            <motion.div
                              aria-hidden
                              className="mt-3"
                              initial={{ opacity: 0, y: -24 }}
                              animate={introAt("name") ? { opacity: 1, y: 0 } : { opacity: 0, y: -24 }}
                              transition={SPRING.bouncy}
                            >
                              <PixelIcon {...SHOW_TITLE.name} scale={scale} className="block" />
                            </motion.div>
                            <motion.div
                              aria-hidden
                              className="mt-2"
                              initial={{ opacity: 0, x: 40 }}
                              animate={introAt("word") ? { opacity: 1, x: 0 } : { opacity: 0, x: 40 }}
                              transition={SPRING.smooth}
                            >
                              <PixelIcon {...SHOW_TITLE.word} scale={scale} className="block" />
                            </motion.div>
                            <motion.div
                              aria-hidden
                              className="mt-2 h-1 w-full origin-left bg-(--tv-red)"
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: introAt("rule") ? 1 : 0 }}
                              transition={{ duration: DURATION.slow, ease: EASE.out }}
                            />
                            <motion.p
                              className={cn(
                                "mt-2 font-semibold text-(color:--tv-paper)",
                                wide ? "text-xl" : "text-base",
                              )}
                              initial={{ opacity: 0, y: 8 }}
                              animate={introAt("anchor") ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
                              transition={{ duration: DURATION.slow, ease: EASE.out }}
                            >
                              {t("introBy")}
                            </motion.p>
                            <motion.p
                              className="mt-1 label-pixel text-(color:--tv-mist)"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: introAt("tagline") ? 1 : 0 }}
                              transition={{ duration: DURATION.slow }}
                            >
                              {t("introTagline")}
                            </motion.p>
                          </div>
                          <motion.div
                            aria-hidden
                            className={cn("shrink-0", !wide && "mt-3 -mb-6")}
                            initial={{ opacity: 0, y: 60 }}
                            animate={introAt("anchor") ? { opacity: 1, y: 0 } : { opacity: 0, y: 60 }}
                            transition={SPRING.bouncy}
                          >
                            <PixelIcon
                              {...anchorArt({
                                eyes: "happy",
                                arm: reduced || beat % 2 === 0 ? "waveLeft" : "waveRight",
                              })}
                              scale={wide ? scale : Math.max(2, scale - 1)}
                              className="block"
                            />
                          </motion.div>
                        </div>
                      </div>
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
