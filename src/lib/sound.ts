import type { Howl } from "howler";
import { useSettings } from "@/stores/settings";

interface SoundSpec {
  /** One or more files. With several, each play picks a different one at random. */
  readonly src: readonly string[];
  /**
   * Mix level (0–1). The files are all normalised to the same peak; these levels
   * even out how loud they feel (A-weighted, measured by `scripts/gen-sounds.ts`).
   * Ticks and blips sit far below the rest on purpose.
   */
  readonly volume: number;
  /** Plays closer together than this are dropped, so rapid triggers never pile up into noise. */
  readonly minIntervalMs: number;
  /** Random playback-rate spread (±, e.g. 0.05 = ±5 %) so repeated plays sound alive. */
  readonly rateJitter?: number;
}

/**
 * The UI sound set, rendered by `scripts/gen-sounds.ts` (`pnpm sounds`) into
 * public/sounds: soft, warm chiptune in C major pentatonic.
 */
export const SOUNDS = {
  /** Very subtle tick: tabs, segmented controls, toggles off. */
  tap: { src: ["/sounds/tap.wav"], volume: 0.21, minIntervalMs: 50, rateJitter: 0.03 },
  /** Switch turned on. */
  toggle: { src: ["/sounds/toggle.wav"], volume: 0.21, minIntervalMs: 80 },
  /** Generic confirmation. */
  success: { src: ["/sounds/success.wav"], volume: 0.35, minIntervalMs: 120 },
  /** Emptying the vault: a short shower of coins. */
  coin: { src: ["/sounds/coin.wav"], volume: 0.28, minIntervalMs: 150 },
  /** Buy order filled: bright and rising. */
  buy: { src: ["/sounds/buy.wav"], volume: 0.35, minIntervalMs: 100 },
  /** Sell order filled: pleasant, descending. */
  sell: { src: ["/sounds/sell.wav"], volume: 0.4, minIntervalMs: 100 },
  /** Soft, low "uh-oh". */
  error: { src: ["/sounds/error.wav"], volume: 0.6, minIntervalMs: 200 },
  /** Margin call: attention without alarm. */
  warning: { src: ["/sounds/warning.wav"], volume: 0.5, minIntervalMs: 400 },
  /** Short fanfare (~1.1 s). */
  levelUp: { src: ["/sounds/level-up.wav"], volume: 0.46, minIntervalMs: 800 },
  /** Incoming notification ping. */
  notify: { src: ["/sounds/notify.wav"], volume: 0.23, minIntervalMs: 250 },
  /** Mascot speech-bubble typing: one tiny syllable (< 40 ms), call it per character. */
  blip: {
    src: ["/sounds/blip-1.wav", "/sounds/blip-2.wav", "/sounds/blip-3.wav"],
    volume: 0.15,
    minIntervalMs: 55,
    rateJitter: 0.05,
  },
  /** Big profit / confetti sparkle (~0.75 s). */
  win: { src: ["/sounds/win.wav"], volume: 0.26, minIntervalMs: 500 },
  /**
   * NEXA Nachrichten: the jingle of the opening montage, seven bars with a hit on every cut (NEWS_INTRO_MS long).
   * The studio plays it faster or slower, so it always fills the intro and the cuts stay on the beat.
   */
  newsIntro: { src: ["/sounds/news-intro.wav"], volume: 0.55, minIntervalMs: 3000 },
  /**
   * The anchor talking: one low, mumbly syllable (~70 ms), far below the mascot's blip. Call it while his text is
   * typed; the interval keeps it at a natural pace.
   */
  anchorTalk: {
    src: [
      "/sounds/anchor-talk-1.wav",
      "/sounds/anchor-talk-2.wav",
      "/sounds/anchor-talk-3.wav",
      "/sounds/anchor-talk-4.wav",
    ],
    volume: 0.3,
    minIntervalMs: 85,
    rateJitter: 0.08,
  },
  /** A new story starts. */
  newsSting: { src: ["/sounds/news-sting.wav"], volume: 0.5, minIntervalMs: 400 },
  /** Bad news for somebody: a soft "womp-womp". */
  newsBad: { src: ["/sounds/news-bad.wav"], volume: 0.5, minIntervalMs: 400 },
  /** Good news for somebody: a tiny cash register. */
  newsGood: { src: ["/sounds/news-good.wav"], volume: 0.25, minIntervalMs: 400 },
  /** One pip of the studio clock, for the last ten seconds before the show. */
  newsTick: { src: ["/sounds/news-tick.wav"], volume: 0.3, minIntervalMs: 500 },
  /** The anchor is shocked: a sharp breath in. */
  anchorGasp: { src: ["/sounds/anchor-gasp.wav"], volume: 0.32, minIntervalMs: 800 },
  /** The anchor cries: three sobs that sink and wobble. */
  anchorCry: { src: ["/sounds/anchor-cry.wav"], volume: 0.4, minIntervalMs: 800 },
  /** The anchor laughs: a staccato "ha-ha-ha-ha". */
  anchorLaugh: { src: ["/sounds/anchor-laugh.wav"], volume: 0.5, minIntervalMs: 800 },
  /** The anchor is angry: a low growl and his fist on the desk. */
  anchorGrumble: { src: ["/sounds/anchor-grumble.wav"], volume: 0.8, minIntervalMs: 800 },
  /** The anchor is smug: a little "heh-heh". */
  anchorSmug: { src: ["/sounds/anchor-smug.wav"], volume: 0.4, minIntervalMs: 800 },
  /** The anchor is confused: a rising "huh?". */
  anchorHuh: { src: ["/sounds/anchor-huh.wav"], volume: 0.55, minIntervalMs: 800 },
  /** Poking a friend (ADR-155): a short rubbery "boing". */
  poke: { src: ["/sounds/poke.wav"], volume: 0.4, minIntervalMs: 300 },
  /** The anchor is proud: a tiny "ta-daa". */
  anchorTada: { src: ["/sounds/anchor-tada.wav"], volume: 0.45, minIntervalMs: 800 },
  /** News battles (ADR-160): countdown pip, the start, and the events of the mini-games. */
  battleCountdown: { src: ["/sounds/battle-countdown.wav"], volume: 0.35, minIntervalMs: 300 },
  battleGo: { src: ["/sounds/battle-go.wav"], volume: 0.45, minIntervalMs: 800 },
  battleCrack: { src: ["/sounds/battle-crack.wav"], volume: 0.25, minIntervalMs: 120, rateJitter: 0.1 },
  battleFall: { src: ["/sounds/battle-fall.wav"], volume: 0.4, minIntervalMs: 250 },
  battleHit: { src: ["/sounds/battle-hit.wav"], volume: 0.5, minIntervalMs: 120, rateJitter: 0.08 },
  battleCoin: { src: ["/sounds/battle-coin.wav"], volume: 0.3, minIntervalMs: 60, rateJitter: 0.05 },
  battleGold: { src: ["/sounds/battle-gold.wav"], volume: 0.35, minIntervalMs: 200 },
  battlePush: { src: ["/sounds/battle-push.wav"], volume: 0.4, minIntervalMs: 100, rateJitter: 0.1 },
  battlePass: { src: ["/sounds/battle-pass.wav"], volume: 0.4, minIntervalMs: 150 },
  battleFuse: { src: ["/sounds/battle-fuse.wav"], volume: 0.3, minIntervalMs: 400 },
  battleBang: { src: ["/sounds/battle-bang.wav"], volume: 0.6, minIntervalMs: 400 },
  battleBell: { src: ["/sounds/battle-bell.wav"], volume: 0.55, minIntervalMs: 600 },
  battlePump: { src: ["/sounds/battle-pump.wav"], volume: 0.18, minIntervalMs: 45, rateJitter: 0.12 },
  battleBust: { src: ["/sounds/battle-bust.wav"], volume: 0.45, minIntervalMs: 400 },
  battleFanfare: { src: ["/sounds/battle-fanfare.wav"], volume: 0.45, minIntervalMs: 2000 },
  battleJoin: { src: ["/sounds/battle-join.wav"], volume: 0.35, minIntervalMs: 300 },
  /** The games of the addendum to ADR-160. */
  battleRoar: { src: ["/sounds/battle-roar.wav"], volume: 0.5, minIntervalMs: 600 },
  battleChomp: { src: ["/sounds/battle-chomp.wav"], volume: 0.5, minIntervalMs: 250 },
  battleGong: { src: ["/sounds/battle-gong.wav"], volume: 0.55, minIntervalMs: 600 },
  battleZap: { src: ["/sounds/battle-zap.wav"], volume: 0.45, minIntervalMs: 120, rateJitter: 0.08 },
  battleJump: { src: ["/sounds/battle-jump.wav"], volume: 0.3, minIntervalMs: 80, rateJitter: 0.1 },
  battleLaser: { src: ["/sounds/battle-laser.wav"], volume: 0.25, minIntervalMs: 200, rateJitter: 0.06 },
  battleWhoosh: { src: ["/sounds/battle-whoosh.wav"], volume: 0.3, minIntervalMs: 150, rateJitter: 0.1 },
  battleBuck: { src: ["/sounds/battle-buck.wav"], volume: 0.4, minIntervalMs: 200, rateJitter: 0.08 },
  battleClick: { src: ["/sounds/battle-click.wav"], volume: 0.3, minIntervalMs: 40, rateJitter: 0.1 },
  battleUnlock: { src: ["/sounds/battle-unlock.wav"], volume: 0.5, minIntervalMs: 500 },
  battleGavel: { src: ["/sounds/battle-gavel.wav"], volume: 0.55, minIntervalMs: 500 },
  /** The games of ADR-177. */
  battleSplat: { src: ["/sounds/battle-splat.wav"], volume: 0.4, minIntervalMs: 80, rateJitter: 0.1 },
  battleTag: { src: ["/sounds/battle-tag.wav"], volume: 0.45, minIntervalMs: 200 },
  battleImpact: { src: ["/sounds/battle-impact.wav"], volume: 0.4, minIntervalMs: 120, rateJitter: 0.08 },
  battleShrink: { src: ["/sounds/battle-shrink.wav"], volume: 0.45, minIntervalMs: 500 },
  /** Nexamon packs (ADR-165): foil under the finger, the tear, cards leaving and showing, and the hits by rarity. */
  packCrinkle: { src: ["/sounds/pack-crinkle.wav"], volume: 0.22, minIntervalMs: 45, rateJitter: 0.18 },
  packTear: { src: ["/sounds/pack-tear.wav"], volume: 0.45, minIntervalMs: 400, rateJitter: 0.04 },
  cardFlick: { src: ["/sounds/card-flick.wav"], volume: 0.35, minIntervalMs: 90, rateJitter: 0.1 },
  cardShow: { src: ["/sounds/card-show.wav"], volume: 0.22, minIntervalMs: 90, rateJitter: 0.05 },
  pullRare: { src: ["/sounds/pull-rare.wav"], volume: 0.38, minIntervalMs: 200 },
  pullUltra: { src: ["/sounds/pull-ultra.wav"], volume: 0.42, minIntervalMs: 300 },
  pullPrisma: { src: ["/sounds/pull-prisma.wav"], volume: 0.45, minIntervalMs: 500 },
  pullLegendary: { src: ["/sounds/pull-legendary.wav"], volume: 0.5, minIntervalMs: 800 },
  /** A One of One (ADR-174): the biggest reveal of the game. */
  pullOneOfOne: { src: ["/sounds/pull-one-of-one.wav"], volume: 0.6, minIntervalMs: 3000 },
  /** A uranium card of Titans Revenge (ADR-182): Geiger clicks, then a glowing power chord. */
  pullUranium: { src: ["/sounds/pull-uranium.wav"], volume: 0.6, minIntervalMs: 3000 },
  /** ADR-204: the charge-up before a big pull in the last two slots; its rate follows the length of the charge. */
  revealCharge: { src: ["/sounds/reveal-charge.wav"], volume: 0.42, minIntervalMs: 600 },
  /** The ASP package (ADR-165): the drum roll while the slab rises, the grade counting up, and the result by tier. */
  gradeDrum: { src: ["/sounds/grade-drum.wav"], volume: 0.34, minIntervalMs: 800 },
  gradeTick: { src: ["/sounds/grade-tick.wav"], volume: 0.3, minIntervalMs: 60 },
  gradeLow: { src: ["/sounds/grade-low.wav"], volume: 0.32, minIntervalMs: 400 },
  gradeGood: { src: ["/sounds/grade-good.wav"], volume: 0.42, minIntervalMs: 400 },
  gradeTen: { src: ["/sounds/grade-ten.wav"], volume: 0.5, minIntervalMs: 800 },
  blackLabel: { src: ["/sounds/black-label.wav"], volume: 0.55, minIntervalMs: 1200 },
} as const satisfies Record<string, SoundSpec>;

/** Length of the news jingle as rendered by `scripts/gen-sounds.ts` (seven bars of four at 140 BPM). */
export const NEWS_INTRO_MS = 12_000;

export type SoundName = keyof typeof SOUNDS;

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

let howlClass: Promise<typeof Howl> | undefined;
const howls = new Map<string, Howl>();
const lastPlayed = new Map<SoundName, number>();
const lastVariant = new Map<SoundName, number>();
/** The latest play of each sound, so a long one (the news jingle) can be stopped. */
const lastVoice = new Map<SoundName, { howl: Howl; id: number }>();
/** Counts the stops per sound: a play that was still loading when its sound was stopped never starts. */
const stops = new Map<SoundName, number>();

/** Howler is loaded on demand, so players who keep sound off never download it. */
function loadHowler(): Promise<typeof Howl> {
  howlClass ??= import("howler").then(
    (mod) => mod.Howl,
    (error: unknown) => {
      howlClass = undefined; // allow a retry on the next play
      throw error;
    },
  );
  return howlClass;
}

function getHowl(HowlCtor: typeof Howl, src: string, volume: number): Howl {
  let howl = howls.get(src);
  if (!howl) {
    howl = new HowlCtor({ src: [src], volume, preload: true });
    howls.set(src, howl);
  }
  return howl;
}

function pickVariant(name: SoundName, count: number): number {
  if (count <= 1) return 0;
  const previous = lastVariant.get(name) ?? -1;
  // Never the same variant twice in a row.
  let index = Math.floor(Math.random() * (count - 1));
  if (index >= previous && previous >= 0) index++;
  lastVariant.set(name, index);
  return index;
}

export interface PlayOptions {
  /** Playback rate (1 = as rendered); replaces the random jitter of the sound. */
  rate?: number;
  /** Start this far into the file, to join a long sound that is already under way. */
  seekMs?: number;
}

/**
 * Play an effect. Resolves when playback has been started (or skipped); it never
 * throws, because audio is decoration. Respects the `sound` setting and drops
 * triggers that come faster than the sound's `minIntervalMs`.
 *
 * @param gain Optional extra gain (0–1) on top of the mix level, default 1.
 */
export async function playSound(name: SoundName, gain = 1, options: PlayOptions = {}): Promise<void> {
  if (typeof window === "undefined" || !useSettings.getState().sound) return;
  const spec: SoundSpec = SOUNDS[name];
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < spec.minIntervalMs) return;
  lastPlayed.set(name, now);
  const stopped = stops.get(name) ?? 0;

  try {
    const HowlCtor = await loadHowler();
    if ((stops.get(name) ?? 0) !== stopped) return;
    const src = spec.src[pickVariant(name, spec.src.length)] ?? spec.src[0];
    if (!src) return;
    const howl = getHowl(HowlCtor, src, spec.volume);
    const id = howl.play();
    lastVoice.set(name, { howl, id });
    if (gain !== 1) howl.volume(spec.volume * Math.min(1, Math.max(0, gain)), id);
    if (options.rate !== undefined) howl.rate(Math.min(4, Math.max(0.5, options.rate)), id);
    else if (spec.rateJitter) howl.rate(1 + (Math.random() * 2 - 1) * spec.rateJitter, id);
    if (options.seekMs !== undefined && options.seekMs > 0) howl.seek(options.seekMs / 1000, id);
  } catch {
    // Audio is decoration; a failure must never break an interaction.
  }
}

/** Fades out the latest play of a sound and stops it. Does nothing when it is not playing; never throws. */
export function stopSound(name: SoundName, fadeMs = 200): void {
  stops.set(name, (stops.get(name) ?? 0) + 1);
  const voice = lastVoice.get(name);
  if (!voice) return;
  lastVoice.delete(name);
  try {
    const { howl, id } = voice;
    if (!howl.playing(id)) return;
    const from = howl.volume(id);
    howl.once("fade", () => howl.stop(id), id);
    howl.fade(typeof from === "number" ? from : SOUNDS[name].volume, 0, fadeMs, id);
  } catch {
    // Audio is decoration.
  }
}

let preloadArmed = false;

/**
 * Load Howler and every sound file right after the first user interaction
 * (pointerdown or keydown), so the first real play has no latency. Safe to call
 * repeatedly and on the server. While sound is switched off it keeps waiting
 * and preloads on the first interaction after it has been switched on.
 */
export function preloadSounds(): void {
  if (preloadArmed || typeof window === "undefined") return;
  preloadArmed = true;
  const events = ["pointerdown", "keydown"] as const;
  const options = { capture: true, passive: true };

  const onInteraction = () => {
    if (!useSettings.getState().sound) return;
    for (const event of events) window.removeEventListener(event, onInteraction, options);
    loadHowler()
      .then((HowlCtor) => {
        for (const spec of Object.values(SOUNDS) as SoundSpec[]) {
          for (const src of spec.src) getHowl(HowlCtor, src, spec.volume);
        }
      })
      .catch(() => {
        // Preloading is an optimisation; playSound loads lazily anyway.
      });
  };

  for (const event of events) window.addEventListener(event, onInteraction, options);
}
