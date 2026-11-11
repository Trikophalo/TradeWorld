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
} as const satisfies Record<string, SoundSpec>;

export type SoundName = keyof typeof SOUNDS;

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

let howlClass: Promise<typeof Howl> | undefined;
const howls = new Map<string, Howl>();
const lastPlayed = new Map<SoundName, number>();
const lastVariant = new Map<SoundName, number>();

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

/**
 * Play an effect. Resolves when playback has been started (or skipped); it never
 * throws, because audio is decoration. Respects the `sound` setting and drops
 * triggers that come faster than the sound's `minIntervalMs`.
 *
 * @param gain Optional extra gain (0–1) on top of the mix level, default 1.
 */
export async function playSound(name: SoundName, gain = 1): Promise<void> {
  if (typeof window === "undefined" || !useSettings.getState().sound) return;
  const spec: SoundSpec = SOUNDS[name];
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < spec.minIntervalMs) return;
  lastPlayed.set(name, now);

  try {
    const HowlCtor = await loadHowler();
    const src = spec.src[pickVariant(name, spec.src.length)] ?? spec.src[0];
    if (!src) return;
    const howl = getHowl(HowlCtor, src, spec.volume);
    const id = howl.play();
    if (gain !== 1) howl.volume(spec.volume * Math.min(1, Math.max(0, gain)), id);
    if (spec.rateJitter) howl.rate(1 + (Math.random() * 2 - 1) * spec.rateJitter, id);
  } catch {
    // Audio is decoration; a failure must never break an interaction.
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
