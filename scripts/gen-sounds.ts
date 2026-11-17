/**
 * NEXA sound effects: a small, dependency-free synthesiser that renders the UI
 * sounds as 44.1 kHz / 16-bit mono WAV files into public/sounds. The sounds are
 * synthesised here, so there is no licence to track.
 *
 *   pnpm sounds                                   render everything, then print the analysis
 *   pnpm tsx scripts/gen-sounds.ts --analyze [dir|file…]   only measure existing WAVs
 *   pnpm tsx scripts/gen-sounds.ts --preview=<file.wav>    also write all sounds back to back
 *
 * Direction: a smooth neo-broker app with a warm chiptune accent. Pulse waves give
 * the 8-bit character, but they are band-limited (PolyBLEP), low-passed and layered
 * over sines so nothing buzzes. Every melodic sound sits in C major pentatonic
 * (C D E G A), so buy, sell, success, coin, level-up and win read as one family.
 * Everything is deterministic (seeded noise), so re-running gives identical files.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const RATE = 44_100;
/** Peak level every sound is normalised to. */
const TARGET_PEAK_DB = -3;
/** Anything quieter than this at the end of a sound is trimmed away. */
const SILENCE_DB = -46;
const OUT_DIR = join(process.cwd(), "public", "sounds");

const dbToGain = (db: number) => 10 ** (db / 20);
const gainToDb = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C5" → 523.25 Hz (equal temperament, A4 = 440 Hz). */
function hz(note: string | number): number {
  if (typeof note === "number") return note;
  const match = /^([A-G])(#|b)?(\d)$/.exec(note);
  const pitch = PITCH_CLASS[match?.[1] ?? ""];
  if (!match || pitch === undefined) throw new Error(`Unknown note ${note}`);
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const midi = 12 * (Number(match[3]) + 1) + pitch + accidental;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Deterministic PRNG (mulberry32), so noise and "random" sparkles never change between runs. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type FilterType = "lp" | "hp" | "bp";

/**
 * Topology-preserving state-variable filter (a biquad that stays stable while the
 * cutoff moves every sample). Band-pass output is normalised to unity peak gain.
 */
class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private readonly type: FilterType;
  private readonly k: number;

  constructor(type: FilterType, q = Math.SQRT1_2) {
    this.type = type;
    this.k = 1 / q;
  }

  process(input: number, cutoff: number): number {
    const g = Math.tan((Math.PI * clamp(cutoff, 10, RATE * 0.45)) / RATE);
    const a1 = 1 / (1 + g * (g + this.k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = input - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    if (this.type === "lp") return v2;
    if (this.type === "bp") return v1 * this.k;
    return input - this.k * v1 - v2;
  }
}

function filterBuffer(x: Float64Array, type: FilterType, cutoff: number, q?: number): Float64Array {
  const svf = new Svf(type, q);
  return x.map((v) => svf.process(v, cutoff));
}

/** One-pole low-pass: the gentlest possible rounding of the top end. */
function onePoleLowpass(x: Float64Array, cutoff: number): Float64Array {
  const a = Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  return x.map((v) => (y = (1 - a) * v + a * y));
}

/** One-pole DC blocker (≈ 20 Hz). */
function dcBlock(x: Float64Array): Float64Array {
  const r = 1 - (2 * Math.PI * 20) / RATE;
  let prevIn = 0;
  let prevOut = 0;
  return x.map((v) => {
    prevOut = v - prevIn + r * prevOut;
    prevIn = v;
    return prevOut;
  });
}

// ---------------------------------------------------------------------------
// Oscillators and envelopes
// ---------------------------------------------------------------------------

type Wave = "sine" | "triangle" | "pulse" | "soft" | "noise";

/** PolyBLEP correction: removes the aliasing of the hard edges of a pulse wave. */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

interface Envelope {
  /** Attack in seconds (sin² ramp, at least 2 ms). */
  a: number;
  /** Decay: seconds until the level is ~-43 dB on its way to the sustain level. */
  d: number;
  /** Sustain level 0–1. */
  s: number;
  /** Exponential release in seconds, ending in an exact zero. */
  r: number;
}

const DEFAULT_ENV: Envelope = { a: 0.004, d: 0.12, s: 0.6, r: 0.12 };
const EXP_K = 5;

function adsrLevel(t: number, env: Envelope): number {
  if (t < env.a) return Math.sin((Math.PI / 2) * (t / env.a)) ** 2;
  return env.s + (1 - env.s) * Math.exp((-EXP_K * (t - env.a)) / Math.max(env.d, 1e-4));
}

function envelopeAt(t: number, gate: number, env: Envelope): number {
  if (t < gate) return adsrLevel(t, env);
  const rt = t - gate;
  if (rt >= env.r) return 0;
  const exp = adsrLevel(gate, env) * Math.exp((-EXP_K * rt) / env.r);
  // The last quarter of the release fades to exactly zero (no click at the end).
  const tail = rt / env.r < 0.75 ? 1 : Math.cos(((rt / env.r - 0.75) / 0.25) * (Math.PI / 2)) ** 2;
  return exp * tail;
}

interface Tone {
  /** Start time in seconds. */
  at: number;
  /** Note name ("E5") or Hz. Ignored for noise. */
  note?: string | number;
  /** Slide to this pitch over `glide` seconds (ease-out, in the log domain). */
  to?: string | number;
  glide?: number;
  /** Time the "key" is held before the release starts. */
  gate: number;
  env?: Partial<Envelope>;
  wave?: Wave;
  /** Pulse duty cycle 0–1. */
  duty?: number;
  /** Saturation for the "soft" square (tanh of a sine). */
  drive?: number;
  /** Linear gain. */
  gain?: number;
  detune?: number;
  vibrato?: { rate: number; cents: number; delay?: number };
  /** Two-operator FM on a sine: a soft glassy bell when the index decays fast. */
  fm?: { ratio: number; index: number; decay: number };
  /** Per-voice filter; `to`/`sweep` move the cutoff exponentially (filter envelope). */
  filter?: { type: FilterType; cutoff: number; to?: number; sweep?: number; q?: number };
}

const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

/** A mono buffer that voices are mixed into. */
class Mix {
  readonly buf: Float64Array;
  private readonly random: () => number;

  constructor(seconds: number, seed = 1) {
    this.buf = new Float64Array(Math.ceil(seconds * RATE));
    this.random = prng(seed);
  }

  tone(tone: Tone): this {
    const env: Envelope = { ...DEFAULT_ENV, ...tone.env };
    env.a = Math.max(env.a, 0.002);
    const wave = tone.wave ?? "sine";
    const duty = tone.duty ?? 0.5;
    const drive = tone.drive ?? 2;
    const gain = tone.gain ?? 1;
    const f0 = wave === "noise" ? 0 : hz(tone.note ?? 440) * 2 ** ((tone.detune ?? 0) / 1200);
    const f1 = tone.to === undefined ? f0 : hz(tone.to) * 2 ** ((tone.detune ?? 0) / 1200);
    const glide = tone.glide ?? tone.gate;
    const filter = tone.filter ? new Svf(tone.filter.type, tone.filter.q) : undefined;
    const start = Math.round(tone.at * RATE);
    const length = Math.ceil((tone.gate + env.r) * RATE);

    let phase = 0;
    let modPhase = 0;
    for (let i = 0; i < length && start + i < this.buf.length; i++) {
      const t = i / RATE;
      let freq = f1 === f0 ? f0 : f0 * (f1 / f0) ** easeOut(Math.min(1, t / glide));
      if (tone.vibrato) {
        const { rate, cents, delay = 0 } = tone.vibrato;
        const depth = t < delay ? 0 : Math.min(1, (t - delay) / 0.08);
        freq *= 2 ** ((cents * depth * Math.sin(2 * Math.PI * rate * t)) / 1200);
      }
      const dt = freq / RATE;

      let v: number;
      switch (wave) {
        case "sine": {
          const pm = tone.fm ? tone.fm.index * Math.exp(-t / tone.fm.decay) * Math.sin(2 * Math.PI * modPhase) : 0;
          v = Math.sin(2 * Math.PI * phase + pm);
          break;
        }
        case "triangle":
          v = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
          break;
        case "pulse":
          v = phase < duty ? 1 : -1;
          v += polyBlep(phase, dt);
          v -= polyBlep((phase - duty + 1) % 1, dt);
          v -= 2 * duty - 1; // remove the DC of an asymmetric pulse
          break;
        case "soft":
          v = Math.tanh(drive * Math.sin(2 * Math.PI * phase)) / Math.tanh(drive);
          break;
        case "noise":
          v = this.random() * 2 - 1;
          break;
      }

      if (filter && tone.filter) {
        const { cutoff, to, sweep } = tone.filter;
        const fc = to === undefined ? cutoff : cutoff * (to / cutoff) ** easeOut(Math.min(1, t / (sweep ?? tone.gate)));
        v = filter.process(v, fc);
      }

      const idx = start + i;
      this.buf[idx] = (this.buf[idx] ?? 0) + v * gain * envelopeAt(t, tone.gate, env);
      phase = (phase + dt) % 1;
      if (tone.fm) modPhase = (modPhase + dt * tone.fm.ratio) % 1;
    }
    return this;
  }

  /** Random helper for sparkles, from the same seeded stream. */
  rand(): number {
    return this.random();
  }
}

/**
 * The house voice: a sine for warmth, a band-limited pulse for the chiptune
 * edge (its brightness closes like a pluck), and an optional sub triangle.
 */
function chip(
  mix: Mix,
  at: number,
  note: string,
  gate: number,
  opts: {
    gain?: number;
    env?: Partial<Envelope>;
    duty?: number;
    bright?: number;
    sub?: number;
    vibrato?: Tone["vibrato"];
    sparkle?: number;
  } = {},
): void {
  const f = hz(note);
  const gain = opts.gain ?? 1;
  const env = { a: 0.004, d: 0.16, s: 0.45, r: 0.16, ...opts.env };
  const bright = opts.bright ?? 1;
  mix.tone({ at, note, gate, env, gain: 0.55 * gain, vibrato: opts.vibrato });
  mix.tone({
    at,
    note,
    gate,
    env,
    wave: "pulse",
    duty: opts.duty ?? 0.25,
    gain: 0.3 * gain,
    vibrato: opts.vibrato,
    filter: { type: "lp", cutoff: Math.min(f * 7 * bright, 9000), to: Math.min(f * 2.5 * bright, 5000), sweep: 0.09 },
  });
  if (opts.sub) mix.tone({ at, note: f / 2, gate, env, wave: "triangle", gain: opts.sub * gain });
  if (opts.sparkle) {
    // A quiet octave sine that dies fast: the "glass" on top of the attack.
    mix.tone({ at, note: f * 2, gate: 0.01, env: { a: 0.003, d: 0.08, s: 0, r: 0.06 }, gain: opts.sparkle * gain });
  }
}

/** A soft FM bell (glassy ping, no harsh edges). */
function bell(
  mix: Mix,
  at: number,
  note: string | number,
  opts: { gain?: number; decay?: number; index?: number } = {},
): void {
  const decay = opts.decay ?? 0.3;
  mix.tone({
    at,
    note,
    gate: 0.02,
    env: { a: 0.003, d: decay, s: 0, r: decay * 0.8 },
    gain: opts.gain ?? 1,
    fm: { ratio: 2, index: opts.index ?? 1.4, decay: 0.05 },
  });
}

/** A short band of filtered noise: transients, swooshes and shimmer. */
function noise(
  mix: Mix,
  at: number,
  gate: number,
  filter: NonNullable<Tone["filter"]>,
  gain: number,
  env: Partial<Envelope> = {},
): void {
  mix.tone({ at, gate, wave: "noise", gain, filter, env: { a: 0.002, d: gate, s: 0, r: 0.02, ...env } });
}

// ---------------------------------------------------------------------------
// Room, mastering, WAV encoding
// ---------------------------------------------------------------------------

interface RoomOptions {
  /** Wet level (0.1 ≈ subtle). */
  mix: number;
  /** Scales the delay lengths; 1 ≈ small room. */
  size?: number;
  feedback?: number;
  /** High-frequency damping inside the feedback loop (0–1). */
  damp?: number;
}

/** A tiny Schroeder room: four damped combs into two allpasses, darkened and mixed in low. */
function room(x: Float64Array, { mix, size = 1, feedback = 0.62, damp = 0.4 }: RoomOptions): Float64Array {
  const combMs = [23.3, 27.7, 31.9, 36.1];
  const wet = new Float64Array(x.length);
  for (const ms of combMs) {
    const line = new Float64Array(Math.max(1, Math.round((ms * size * RATE) / 1000)));
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < x.length; i++) {
      const out = line[idx] ?? 0;
      lp = out * (1 - damp) + lp * damp;
      line[idx] = (x[i] ?? 0) + lp * feedback;
      wet[i] = (wet[i] ?? 0) + out / combMs.length;
      idx = (idx + 1) % line.length;
    }
  }
  for (const ms of [5.1, 1.7]) {
    const line = new Float64Array(Math.max(1, Math.round((ms * RATE) / 1000)));
    let idx = 0;
    for (let i = 0; i < wet.length; i++) {
      const delayed = line[idx] ?? 0;
      const input = wet[i] ?? 0;
      const out = -0.5 * input + delayed;
      line[idx] = input + 0.5 * out;
      wet[i] = out;
      idx = (idx + 1) % line.length;
    }
  }
  const dark = filterBuffer(wet, "lp", 4500);
  return x.map((v, i) => v + (dark[i] ?? 0) * mix);
}

interface MasterOptions {
  room?: RoomOptions;
  /** Final low-pass in Hz (rounds off whatever harmonics are left). */
  lowpass?: number;
  /** Hard maximum length in seconds (fade-out included). */
  maxSeconds?: number;
}

/** DC block → room → low-pass → soft limit + normalise → trim → click-free fades. */
function master(input: Float64Array, opts: MasterOptions = {}): Float64Array {
  let x = dcBlock(input);
  if (opts.room) x = room(x, opts.room);
  x = filterBuffer(x, "lp", opts.lowpass ?? 9000);
  x = onePoleLowpass(x, 14_000);

  // Soft limiting: drive the top ~1 dB into a tanh knee, then normalise to the target peak.
  const target = dbToGain(TARGET_PEAK_DB);
  const knee = 0.8;
  const drive = 1.12 / peakOf(x);
  x = x.map((v) => {
    const a = Math.abs(v * drive);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    return Math.sign(v) * y;
  });
  const limited = target / peakOf(x);
  x = x.map((v) => v * limited);

  // Trim the silent tail (and any leading silence), then fade both ends.
  const threshold = dbToGain(SILENCE_DB);
  let first = x.findIndex((v) => Math.abs(v) > threshold);
  let last = x.length - 1;
  while (last > 0 && Math.abs(x[last] ?? 0) <= threshold) last--;
  first = Math.max(0, first - Math.round(0.001 * RATE));
  let end = Math.min(x.length, last + Math.round(0.004 * RATE));
  if (opts.maxSeconds) end = Math.min(end, first + Math.floor(opts.maxSeconds * RATE));
  x = x.slice(first, end);

  const fadeIn = Math.round(0.003 * RATE);
  const fadeOut = Math.min(Math.round(0.03 * RATE), Math.floor(x.length / 4));
  for (let i = 0; i < fadeIn; i++) x[i] = (x[i] ?? 0) * Math.sin((Math.PI / 2) * (i / fadeIn)) ** 2;
  for (let i = 0; i < fadeOut; i++) {
    const idx = x.length - 1 - i;
    x[idx] = (x[idx] ?? 0) * Math.sin((Math.PI / 2) * (i / fadeOut)) ** 2;
  }
  // The fades may have touched the peak of very short sounds: normalise once more.
  const finalGain = target / peakOf(x);
  return x.map((v) => v * finalGain);
}

function peakOf(x: Float64Array): number {
  let peak = 1e-9;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  return peak;
}

function encodeWav(x: Float64Array, rate = RATE): Buffer {
  const out = Buffer.alloc(44 + x.length * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + x.length * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28); // byte rate
  out.writeUInt16LE(2, 32); // block align
  out.writeUInt16LE(16, 34); // bits per sample
  out.write("data", 36);
  out.writeUInt32LE(x.length * 2, 40);
  x.forEach((v, i) => out.writeInt16LE(clamp(Math.round(v * 32767), -32768, 32767), 44 + i * 2));
  return out;
}

// ---------------------------------------------------------------------------
// The sounds
// ---------------------------------------------------------------------------

/** Very subtle tick for tabs and toggles: a tiny pitched "tock" plus a breath of noise. */
function tap(): Float64Array {
  const m = new Mix(0.08, 11);
  m.tone({ at: 0, note: 1900, to: "C6", glide: 0.01, gate: 0.006, env: { a: 0.003, d: 0.03, s: 0, r: 0.03 } });
  m.tone({ at: 0, note: "C5", gate: 0.006, wave: "triangle", gain: 0.35, env: { a: 0.003, d: 0.02, s: 0, r: 0.025 } });
  noise(m, 0, 0.006, { type: "bp", cutoff: 3500, q: 0.9 }, 0.15, { a: 0.003, r: 0.01 });
  return master(m.buf, { lowpass: 7000, maxSeconds: 0.045 });
}

/** Switch on: two quick rising chip notes (G5 → C6). */
function toggle(): Float64Array {
  const m = new Mix(0.3, 12);
  const env = { a: 0.003, d: 0.06, s: 0, r: 0.05 };
  chip(m, 0, "G5", 0.03, { env, gain: 0.8 });
  chip(m, 0.045, "C6", 0.04, { env });
  noise(m, 0, 0.005, { type: "bp", cutoff: 3000, q: 0.9 }, 0.08);
  return master(m.buf, { room: { mix: 0.08, size: 0.6 }, lowpass: 7500 });
}

/** Generic confirmation: a fourth up (G5 → C6), the top note rings with a little vibrato. */
function success(): Float64Array {
  const m = new Mix(0.7, 13);
  chip(m, 0, "G5", 0.05, { env: { d: 0.08, s: 0.3, r: 0.08 }, gain: 0.75, sub: 0.15 });
  chip(m, 0.075, "C6", 0.12, {
    env: { d: 0.2, s: 0.35, r: 0.22 },
    sub: 0.15,
    sparkle: 0.18,
    vibrato: { rate: 5.5, cents: 10, delay: 0.08 },
  });
  return master(m.buf, { room: { mix: 0.14, size: 0.8 } });
}

/** Vault: a short shower of coins, each a classic "fourth up" ping, in pentatonic pairs. */
function coin(): Float64Array {
  const m = new Mix(0.9, 14);
  const coins: [number, string, string, number][] = [
    [0, "G5", "C6", 1],
    [0.07, "D6", "G6", 0.8],
    [0.125, "A5", "D6", 0.7],
    [0.18, "E6", "A6", 0.55],
    [0.24, "G6", "C7", 0.4],
  ];
  for (const [at, lo, hi, gain] of coins) {
    const tone = { wave: "soft" as const, drive: 1.6, filter: { type: "lp" as const, cutoff: 4500 } };
    m.tone({ ...tone, at, note: lo, gate: 0.03, gain: 0.35 * gain, env: { a: 0.002, d: 0.05, s: 0.6, r: 0.02 } });
    m.tone({
      ...tone,
      at: at + 0.035,
      note: hi,
      gate: 0.04,
      gain: 0.35 * gain,
      env: { a: 0.002, d: 0.2, s: 0.25, r: 0.16 },
    });
    m.tone({ at: at + 0.035, note: hi, gate: 0.04, gain: 0.35 * gain, env: { a: 0.002, d: 0.25, s: 0.2, r: 0.18 } });
  }
  noise(m, 0.03, 0.35, { type: "bp", cutoff: 8000, q: 1.5 }, 0.05, { a: 0.03, d: 0.35, r: 0.1 });
  return master(m.buf, { room: { mix: 0.16, size: 0.8 }, lowpass: 9000 });
}

/** Order filled, buy: a quick bright arpeggio upward (C5 E5 G5 → C6) over a soft swoosh. */
function buy(): Float64Array {
  const m = new Mix(0.75, 15);
  const step = { d: 0.06, s: 0.25, r: 0.06 };
  chip(m, 0, "C5", 0.03, { env: step, gain: 0.7 });
  chip(m, 0.04, "E5", 0.03, { env: step, gain: 0.75 });
  chip(m, 0.08, "G5", 0.03, { env: step, gain: 0.8 });
  chip(m, 0.12, "C6", 0.12, {
    env: { d: 0.2, s: 0.35, r: 0.17 },
    sparkle: 0.2,
    sub: 0.12,
    vibrato: { rate: 6, cents: 8, delay: 0.1 },
  });
  m.tone({ at: 0, note: "C4", gate: 0.12, gain: 0.18, env: { a: 0.006, d: 0.12, s: 0.3, r: 0.1 } });
  noise(m, 0, 0.14, { type: "bp", cutoff: 1500, to: 6000, sweep: 0.14, q: 1.2 }, 0.06, {
    a: 0.03,
    d: 0.2,
    s: 0.4,
    r: 0.06,
  });
  return master(m.buf, { room: { mix: 0.12, size: 0.8 } });
}

/** Order filled, sell: the mirror image, softer and descending, resolving on the tonic (G5 E5 → C5). */
function sell(): Float64Array {
  const m = new Mix(0.75, 16);
  const step = { d: 0.07, s: 0.25, r: 0.07 };
  const soft = { duty: 0.4, bright: 0.85 };
  chip(m, 0, "G5", 0.035, { ...soft, env: step, gain: 0.75 });
  chip(m, 0.05, "E5", 0.035, { ...soft, env: step, gain: 0.8 });
  chip(m, 0.1, "C5", 0.12, {
    ...soft,
    env: { d: 0.22, s: 0.35, r: 0.17 },
    sub: 0.15,
    sparkle: 0.12,
    vibrato: { rate: 5.5, cents: 8, delay: 0.1 },
  });
  return master(m.buf, { room: { mix: 0.12, size: 0.8 }, lowpass: 7000 });
}

/** Error: a soft, low "uh-oh" (G4 → E4, falling minor third) that deflates a little. */
function error(): Float64Array {
  const m = new Mix(0.6, 17);
  const filter = { type: "lp" as const, cutoff: 1800, to: 900, sweep: 0.1 };
  m.tone({
    at: 0,
    note: "G4",
    gate: 0.07,
    wave: "soft",
    drive: 2,
    gain: 0.5,
    filter,
    env: { a: 0.006, d: 0.1, s: 0.5, r: 0.06 },
  });
  m.tone({ at: 0, note: "G3", gate: 0.07, gain: 0.25, env: { a: 0.006, d: 0.1, s: 0.5, r: 0.06 } });
  const fall = { to: hz("E4") * 2 ** (-0.6 / 12), glide: 0.2 };
  m.tone({
    at: 0.1,
    note: "E4",
    ...fall,
    gate: 0.1,
    wave: "soft",
    drive: 2,
    gain: 0.5,
    filter,
    env: { a: 0.006, d: 0.16, s: 0.4, r: 0.12 },
  });
  m.tone({ at: 0.1, note: "E3", gate: 0.1, gain: 0.25, env: { a: 0.006, d: 0.16, s: 0.4, r: 0.12 } });
  return master(m.buf, { room: { mix: 0.1, size: 0.7 }, lowpass: 3000 });
}

/** Margin call: two soft open-fifth hits stepping down (D5+A5, C5+G5) — attention, not alarm. */
function warning(): Float64Array {
  const m = new Mix(0.8, 18);
  const env = { a: 0.004, d: 0.14, s: 0.15, r: 0.14 };
  const hit = (at: number, low: string, high: string) => {
    for (const note of [low, high]) {
      m.tone({ at, note, gate: 0.09, wave: "triangle", gain: 0.45, env });
      m.tone({
        at,
        note,
        gate: 0.09,
        wave: "pulse",
        duty: 0.5,
        gain: 0.18,
        env,
        filter: { type: "lp", cutoff: 2600, to: 1400, sweep: 0.1 },
      });
      m.tone({ at, note, gate: 0.09, gain: 0.3, env });
    }
  };
  hit(0, "D5", "A5");
  hit(0.16, "C5", "G5");
  return master(m.buf, { room: { mix: 0.12, size: 0.8 }, lowpass: 6000 });
}

/** Level-up: a quick chip fanfare (C5 E5 G5 C6 · G5) landing on a ringing C6+E6 with vibrato and shimmer. */
function levelUp(): Float64Array {
  const m = new Mix(1.7, 19);
  const staccato = { d: 0.06, s: 0.3, r: 0.05 };
  const run: [number, string][] = [
    [0, "C5"],
    [0.075, "E5"],
    [0.15, "G5"],
    [0.225, "C6"],
    [0.31, "G5"],
  ];
  for (const [at, note] of run) chip(m, at, note, 0.045, { env: staccato, gain: 0.8 });
  m.tone({ at: 0, note: "C4", gate: 0.3, wave: "triangle", gain: 0.25, env: { a: 0.01, d: 0.2, s: 0.5, r: 0.06 } });

  const hold = 0.45;
  const ring = { d: 0.3, s: 0.55, r: 0.3 };
  const vibrato = { rate: 5.5, cents: 12, delay: 0.15 };
  chip(m, 0.39, "C6", hold, { env: ring, sparkle: 0.2, vibrato, gain: 0.9 });
  chip(m, 0.39, "E6", hold, { env: ring, vibrato, gain: 0.55, bright: 0.7 });
  m.tone({ at: 0.39, note: "G5", gate: hold, wave: "triangle", gain: 0.2, env: ring });
  m.tone({ at: 0.39, note: "C4", gate: hold, wave: "triangle", gain: 0.25, env: ring });
  noise(m, 0.39, 0.5, { type: "hp", cutoff: 7000 }, 0.03, { a: 0.02, d: 0.5, r: 0.15 });
  return master(m.buf, { room: { mix: 0.16, size: 0.9 } });
}

/** Notification: a two-note glass "ding-ding" (A5 → E6), FM bells with a hint of pulse. */
function notify(): Float64Array {
  const m = new Mix(0.8, 20);
  bell(m, 0, "A5", { gain: 0.8, decay: 0.22 });
  bell(m, 0.09, "E6", { decay: 0.3 });
  m.tone({
    at: 0.09,
    note: "E6",
    gate: 0.01,
    wave: "pulse",
    duty: 0.125,
    gain: 0.08,
    env: { a: 0.002, d: 0.05, s: 0, r: 0.04 },
    filter: { type: "lp", cutoff: 3500 },
  });
  return master(m.buf, { room: { mix: 0.15, size: 0.9 }, lowpass: 8000 });
}

/** One mascot "syllable": a warm, nasal pulse that drops a step, < 40 ms. */
function blip(note: string, to: string, duty: number, cutoff: number, seed: number): () => Float64Array {
  return () => {
    const m = new Mix(0.06, seed);
    const env = { a: 0.004, d: 0.025, s: 0.2, r: 0.012 };
    m.tone({
      at: 0,
      note,
      to,
      glide: 0.03,
      gate: 0.018,
      wave: "pulse",
      duty,
      gain: 0.5,
      env,
      filter: { type: "lp", cutoff, q: 0.9 },
    });
    m.tone({ at: 0, note, to, glide: 0.03, gate: 0.018, gain: 0.5, env });
    return master(m.buf, { lowpass: 4000, maxSeconds: 0.036 });
  };
}

/** Big win: a sparkling pentatonic run up, a soft major chord and a scatter of twinkles. */
function win(): Float64Array {
  const m = new Mix(1.3, 21);
  const run = ["C6", "D6", "E6", "G6", "A6", "C7"];
  run.forEach((note, i) => bell(m, i * 0.035, note, { gain: 0.45 + i * 0.06, decay: 0.14, index: 1 }));
  const pad = { a: 0.02, d: 0.25, s: 0.4, r: 0.3 };
  const vibrato = { rate: 5.5, cents: 10, delay: 0.1 };
  for (const note of ["C5", "E5", "G5"]) {
    m.tone({ at: 0.21, note, gate: 0.25, gain: 0.22, env: pad, vibrato });
    m.tone({
      at: 0.21,
      note,
      gate: 0.25,
      wave: "pulse",
      duty: 0.25,
      gain: 0.08,
      env: pad,
      vibrato,
      filter: { type: "lp", cutoff: 2500 },
    });
  }
  const twinkles = ["E6", "A6", "G6", "C7", "D7", "A6", "E7"];
  twinkles.forEach((note, i) => {
    const at = 0.24 + i * 0.06 + m.rand() * 0.03;
    bell(m, at, note, { gain: 0.45 * (1 - i / 9), decay: 0.12, index: 0.8 });
  });
  noise(m, 0.2, 0.5, { type: "bp", cutoff: 7500, q: 1.2 }, 0.04, { a: 0.04, d: 0.5, r: 0.1 });
  return master(m.buf, { room: { mix: 0.18, size: 0.9 } });
}

// --- NEXA Nachrichten (the hourly news show) --------------------------------

/** A soft kettle drum: a sine that drops a fourth, a triangle body and a breath of low noise. */
function timpani(mix: Mix, at: number, note: string, gain: number): void {
  const f = hz(note);
  const env = { a: 0.003, d: 0.22, s: 0, r: 0.2 };
  mix.tone({ at, note: f * 1.35, to: f, glide: 0.05, gate: 0.05, gain: 0.7 * gain, env });
  mix.tone({ at, note: f, gate: 0.05, wave: "triangle", gain: 0.3 * gain, env });
  noise(mix, at, 0.03, { type: "lp", cutoff: 500 }, 0.25 * gain, { a: 0.002, d: 0.05, r: 0.03 });
}

/** Length of the news jingle. Keep in sync with NEWS_INTRO_MS in src/lib/sound.ts. */
const JINGLE_SECONDS = 12;
/** Its 28 beats (seven bars of four, 140 BPM) are the beats of the montage: see src/features/news/show/intro.ts. */
const JINGLE_BEATS = 28;

/**
 * News jingle for the opening montage (12 s): seven bars over a teletype and a marching bass, with a swoosh and a
 * kettle drum on every bar line, because the picture cuts there. Bars 1 to 5 belong to the five shots and carry
 * their noises (the comb, the pointing finger, the mug on the desk, coins, the wind on the roof); bars 6 and 7 are
 * the fanfare for the title card, ending on a held C6 chord. The studio plays the file faster when the intro is
 * shorter, so everything here sits on beats, never on seconds.
 */
function newsIntro(): Float64Array {
  const beat = JINGLE_SECONDS / JINGLE_BEATS;
  const m = new Mix(JINGLE_SECONDS + 0.5, 41);
  const at = (bar: number, b: number) => (bar * 4 + b) * beat;
  const staccato = { d: 0.05, s: 0.3, r: 0.04 };
  const vibrato = { rate: 5.5, cents: 12, delay: 0.18 };

  // Drums and teletype. The last bar is one hit that rings out.
  for (let bar = 0; bar < 7; bar++) {
    const beats = bar === 6 ? 1 : 4;
    for (let b = 0; b < beats; b++) {
      if (b % 2 === 0) timpani(m, at(bar, b), b === 0 ? "C3" : "G2", b === 0 ? 0.7 : 0.4);
      else noise(m, at(bar, b), 0.05, { type: "bp", cutoff: 1900, q: 0.9 }, 0.16, { a: 0.002, d: 0.07, r: 0.04 });
      for (let sixteenth = 0; sixteenth < 4; sixteenth++) {
        m.tone({
          at: at(bar, b + sixteenth / 4),
          note: "G6",
          gate: 0.012,
          wave: "pulse",
          duty: 0.125,
          gain: sixteenth === 0 ? 0.07 : 0.04,
          env: { a: 0.002, d: 0.03, s: 0, r: 0.02 },
          filter: { type: "lp", cutoff: 5000 },
        });
      }
    }
    // The cut: a swoosh into the bar line and a short crash on it.
    if (bar > 0) {
      noise(m, at(bar, 0) - 0.14, 0.14, { type: "bp", cutoff: 900, to: 5200, sweep: 0.14, q: 1.3 }, 0.1, {
        a: 0.08,
        d: 0.2,
        s: 0.6,
        r: 0.03,
      });
    }
    noise(m, at(bar, 0), 0.22, { type: "hp", cutoff: 6500 }, 0.045, { a: 0.003, d: 0.22, r: 0.1 });
  }

  // Bass: marching eighths, one root per bar.
  ["C3", "A2", "C3", "G2", "A2", "C3"].forEach((root, bar) => {
    for (let eighth = 0; eighth < 8; eighth++) {
      const env = { a: 0.004, d: 0.08, s: 0.4, r: 0.04 };
      const voice = { at: at(bar, eighth / 2), note: root, gate: beat * 0.3, env };
      m.tone({ ...voice, wave: "pulse", duty: 0.5, gain: 0.2, filter: { type: "lp", cutoff: 800, q: 1 } });
      m.tone({ ...voice, wave: "triangle", gain: 0.24 });
    }
  });

  // Lead: [bar, beat, note, beats held].
  const lead: [number, number, string, number][] = [
    [0, 0, "G4", 0.3],
    [0, 0.75, "G4", 0.3],
    [0, 1.5, "G4", 0.3],
    [0, 2, "C5", 0.7],
    [0, 3, "E5", 0.3],
    [0, 3.5, "D5", 0.3],
    [1, 0, "C5", 0.7],
    [1, 1, "A4", 0.3],
    [1, 1.5, "G4", 0.7],
    [1, 2.5, "A4", 0.3],
    [1, 3, "C5", 0.7],
    [2, 0, "G4", 0.3],
    [2, 0.75, "G4", 0.3],
    [2, 1.5, "G4", 0.3],
    [2, 2, "D5", 0.7],
    [2, 3, "G5", 0.3],
    [2, 3.5, "E5", 0.3],
    [3, 0, "D5", 0.7],
    [3, 1, "C5", 0.3],
    [3, 1.5, "D5", 0.7],
    [3, 2.5, "E5", 0.3],
    [3, 3, "G5", 0.3],
    [3, 3.5, "A5", 0.3],
    [4, 0, "E6", 1.6],
    [4, 2, "D6", 0.8],
    [4, 3, "C6", 0.3],
    [4, 3.5, "D6", 0.3],
    [5, 0, "C5", 0.3],
    [5, 0.5, "E5", 0.3],
    [5, 1, "G5", 0.3],
    [5, 1.5, "C6", 0.8],
    [5, 2.5, "G5", 0.3],
    [5, 3, "C6", 0.3],
    [5, 3.5, "E6", 0.3],
  ];
  for (const [bar, b, note, held] of lead) {
    const long = held > 0.5;
    chip(m, at(bar, b), note, held * beat * 0.8, {
      env: long ? { d: 0.2, s: 0.5, r: 0.12 } : staccato,
      gain: 0.95,
      sub: note.endsWith("4") ? 0.2 : 0,
      vibrato: held > 1 ? vibrato : undefined,
    });
  }

  // Shot 1, the comb: two zips through the moustache and a gleam at the end.
  for (const b of [0.5, 2]) {
    noise(m, at(0, b), 0.24, { type: "bp", cutoff: 1800, to: 6200, sweep: 0.24, q: 2 }, 0.07, {
      a: 0.03,
      d: 0.3,
      s: 0.5,
    });
  }
  bell(m, at(0, 3.25), "E7", { gain: 0.2, decay: 0.2, index: 0.8 });
  // Shot 2, the finger: it comes closer on beats 2 and 3 and lands on beat 4 with a "ting".
  chip(m, at(1, 1), "C6", 0.03, { env: staccato, gain: 0.3 });
  chip(m, at(1, 2), "E6", 0.03, { env: staccato, gain: 0.35 });
  bell(m, at(1, 3), "A6", { gain: 0.4, decay: 0.3, index: 1.1 });
  bell(m, at(1, 3), "E7", { gain: 0.3, decay: 0.3, index: 0.9 });
  // Shot 3, the mug: it hits the desk on beat 3, the coffee follows.
  timpani(m, at(2, 2), "G2", 0.9);
  bell(m, at(2, 2), "C4", { gain: 0.5, decay: 0.09, index: 2.2 });
  noise(m, at(2, 2), 0.015, { type: "lp", cutoff: 1200 }, 0.35, { a: 0.002, r: 0.02 });
  noise(m, at(2, 2) + 0.03, 0.2, { type: "bp", cutoff: 3200, q: 1 }, 0.06, { a: 0.02, d: 0.2, r: 0.08 });
  // Shot 4, the money: coins on every eighth.
  ["E6", "A6", "G6", "C7", "A6", "D7", "G6", "C7"].forEach((note, eighth) => {
    bell(m, at(3, eighth / 2) + m.rand() * 0.02, note, { gain: 0.14 + m.rand() * 0.06, decay: 0.12, index: 1 });
  });
  // Shot 5, the hero: a chord under the long note and the wind in his cape.
  const pad = { a: 0.03, d: 0.3, s: 0.6, r: 0.2 };
  for (const [b, notes] of [
    [0, ["A4", "C5", "E5"]],
    [2, ["G4", "C5", "E5"]],
  ] as const) {
    for (const note of notes) {
      m.tone({ at: at(4, b), note, gate: beat * 1.8, gain: 0.14, env: pad, vibrato });
      m.tone({
        at: at(4, b),
        note,
        gate: beat * 1.8,
        wave: "pulse",
        duty: 0.25,
        gain: 0.06,
        env: pad,
        vibrato,
        filter: { type: "lp", cutoff: 2600 },
      });
    }
  }
  noise(m, at(4, 0), beat * 3.5, { type: "bp", cutoff: 500, to: 1700, sweep: beat * 3.5, q: 0.9 }, 0.05, {
    a: 0.5,
    d: 2,
    s: 0.7,
    r: 0.3,
  });

  // The title card: the last chord, held over a kettle drum, and two ticks of the teletype as it fades.
  const end = at(6, 0);
  const hold = 0.8;
  const ring = { d: 0.4, s: 0.5, r: 0.6 };
  chip(m, end, "C6", hold, { env: ring, sparkle: 0.2, vibrato, gain: 0.7 });
  chip(m, end, "E6", hold, { env: ring, vibrato, gain: 0.38, bright: 0.7 });
  chip(m, end, "G5", hold, { env: ring, vibrato, gain: 0.38, bright: 0.8 });
  m.tone({ at: end, note: "C4", gate: hold, wave: "triangle", gain: 0.2, env: ring });
  m.tone({ at: end, note: "C3", gate: hold, wave: "triangle", gain: 0.16, env: ring });
  noise(m, end, 0.5, { type: "hp", cutoff: 7000 }, 0.03, { a: 0.02, d: 0.5, r: 0.15 });
  bell(m, end + beat, "G6", { gain: 0.16, decay: 0.12, index: 0.8 });
  bell(m, end + beat * 1.5, "C7", { gain: 0.14, decay: 0.18, index: 0.8 });
  return master(m.buf, { room: { mix: 0.14, size: 0.9 }, lowpass: 8000, maxSeconds: JINGLE_SECONDS });
}

/**
 * One syllable of the anchor: a low, mumbly "mwuh". A pulse far below the mascot's blip, pushed through a vowel
 * formant so that small phone speakers still carry it, with a little scoop in the pitch like an old man talking.
 */
function anchorTalk(note: string, to: string, formant: number, duty: number, seed: number): () => Float64Array {
  return () => {
    const m = new Mix(0.14, seed);
    const env = { a: 0.008, d: 0.05, s: 0.35, r: 0.03 };
    const voice = { at: 0, note, to, glide: 0.06, gate: 0.045, env };
    m.tone({
      ...voice,
      wave: "pulse",
      duty,
      gain: 0.6,
      filter: { type: "bp", cutoff: formant * 1.25, to: formant * 0.85, sweep: 0.06, q: 1.6 },
    });
    // The second formant keeps the voice from sounding like a hum.
    m.tone({ ...voice, wave: "pulse", duty, gain: 0.22, filter: { type: "bp", cutoff: formant * 2.6, q: 2.2 } });
    m.tone({ ...voice, wave: "triangle", gain: 0.35 });
    noise(m, 0, 0.012, { type: "bp", cutoff: 1400, q: 0.8 }, 0.05, { a: 0.003, r: 0.01 });
    return master(m.buf, { lowpass: 3200, maxSeconds: 0.09 });
  };
}

/** New story: a quick swoosh into a two-step stab (C5+G5, then C5+G5+C6) over a kettle drum. */
function newsSting(): Float64Array {
  const m = new Mix(0.9, 46);
  noise(m, 0, 0.13, { type: "bp", cutoff: 900, to: 5200, sweep: 0.13, q: 1.3 }, 0.1, {
    a: 0.05,
    d: 0.2,
    s: 0.5,
    r: 0.04,
  });
  const short = { d: 0.06, s: 0.3, r: 0.05 };
  chip(m, 0.12, "C5", 0.04, { env: short, gain: 0.7 });
  chip(m, 0.12, "G5", 0.04, { env: short, gain: 0.6, bright: 0.8 });
  timpani(m, 0.235, "C3", 0.8);
  const ring = { d: 0.18, s: 0.3, r: 0.18 };
  chip(m, 0.235, "C5", 0.09, { env: ring, gain: 0.7, sub: 0.2 });
  chip(m, 0.235, "G5", 0.09, { env: ring, gain: 0.6, bright: 0.8 });
  chip(m, 0.235, "C6", 0.09, { env: ring, gain: 0.8, sparkle: 0.18 });
  return master(m.buf, { room: { mix: 0.14, size: 0.8 }, maxSeconds: 0.6 });
}

/** Bad news for somebody: a short "womp-womp", two soft notes that sag (D4, then A3 sinking further). */
function newsBad(): Float64Array {
  const m = new Mix(0.9, 47);
  const womp = (at: number, note: string, drop: number, gate: number, gain: number) => {
    const to = hz(note) * 2 ** (-drop / 12);
    const env = { a: 0.012, d: 0.14, s: 0.6, r: 0.1 };
    const voice = { at, note, to, glide: gate + 0.1, gate, env, vibrato: { rate: 6, cents: 18, delay: 0.05 } };
    // A muted trombone: a pulse whose filter closes as the note sags, over a soft square for the body.
    m.tone({
      ...voice,
      wave: "pulse",
      duty: 0.4,
      gain: 0.4 * gain,
      filter: { type: "lp", cutoff: 2600, to: 900, sweep: gate + 0.05, q: 1.2 },
    });
    m.tone({ ...voice, wave: "soft", drive: 2, gain: 0.35 * gain, filter: { type: "lp", cutoff: 1600 } });
    m.tone({ ...voice, note: hz(note) / 2, to: to / 2, gain: 0.15 * gain });
  };
  womp(0, "D4", 0.5, 0.11, 0.9);
  womp(0.2, "A3", 2.2, 0.22, 1);
  return master(m.buf, { room: { mix: 0.1, size: 0.7 }, lowpass: 3600, maxSeconds: 0.62 });
}

/** Good news for somebody: a tiny cash register, a click and two bright bells (G6 → C7) with a shimmer. */
function newsGood(): Float64Array {
  const m = new Mix(0.8, 48);
  noise(m, 0, 0.008, { type: "bp", cutoff: 2600, q: 1 }, 0.25, { a: 0.002, r: 0.012 });
  bell(m, 0.02, "G6", { gain: 0.7, decay: 0.16, index: 1.1 });
  bell(m, 0.085, "C7", { gain: 0.9, decay: 0.3, index: 1.1 });
  m.tone({ at: 0.085, note: "C6", gate: 0.02, gain: 0.25, env: { a: 0.003, d: 0.2, s: 0, r: 0.15 } });
  noise(m, 0.08, 0.25, { type: "bp", cutoff: 8000, q: 1.5 }, 0.035, { a: 0.02, d: 0.25, r: 0.1 });
  return master(m.buf, { room: { mix: 0.16, size: 0.9 }, lowpass: 9500, maxSeconds: 0.6 });
}

/** Countdown to the show: one studio-clock pip (G5) for each of the last ten seconds. */
function newsTick(): Float64Array {
  const m = new Mix(0.3, 49);
  const env = { a: 0.003, d: 0.07, s: 0.25, r: 0.05 };
  m.tone({ at: 0, note: "G5", gate: 0.05, gain: 0.7, env });
  m.tone({
    at: 0,
    note: "G5",
    gate: 0.05,
    wave: "pulse",
    duty: 0.5,
    gain: 0.12,
    env,
    filter: { type: "lp", cutoff: 2400 },
  });
  m.tone({ at: 0, note: "G4", gate: 0.05, wave: "triangle", gain: 0.2, env });
  return master(m.buf, { room: { mix: 0.08, size: 0.6 }, lowpass: 6000, maxSeconds: 0.16 });
}

// --- Mr. Doodle Dangle's moods: one short voice per reaction ------------------

interface VoiceOptions {
  /** Vowel: the centre of the first formant in Hz ("a" ≈ 850, "o" ≈ 550). */
  formant?: number;
  duty?: number;
  gain?: number;
  /** Seconds the pitch takes to slide to `to` (default: the whole note). */
  glide?: number;
  vibrato?: Tone["vibrato"];
  env?: Partial<Envelope>;
}

/** The anchor's voice on a held note: the "mwuh" of anchorTalk, as long as it has to be. */
function voice(
  mix: Mix,
  at: number,
  note: string | number,
  to: string | number,
  gate: number,
  opts: VoiceOptions = {},
): void {
  const formant = opts.formant ?? 700;
  const duty = opts.duty ?? 0.3;
  const gain = opts.gain ?? 1;
  const env = { a: 0.008, d: 0.08, s: 0.5, r: 0.05, ...opts.env };
  const base = { at, note, to, glide: opts.glide ?? gate, gate, env, vibrato: opts.vibrato };
  mix.tone({ ...base, wave: "pulse", duty, gain: 0.6 * gain, filter: { type: "bp", cutoff: formant, q: 1.6 } });
  mix.tone({ ...base, wave: "pulse", duty, gain: 0.22 * gain, filter: { type: "bp", cutoff: formant * 2.6, q: 2.2 } });
  mix.tone({ ...base, wave: "triangle", gain: 0.35 * gain });
}

/** Shocked: a sharp breath in, the voice shooting up an octave and a half, and a tiny "!" on top. */
function anchorGasp(): Float64Array {
  const m = new Mix(0.8, 50);
  noise(m, 0, 0.16, { type: "bp", cutoff: 900, to: 3800, sweep: 0.16, q: 1.2 }, 0.22, {
    a: 0.07,
    d: 0.2,
    s: 0.6,
    r: 0.03,
  });
  voice(m, 0.1, "A3", "E5", 0.16, {
    formant: 1100,
    glide: 0.09,
    gain: 0.9,
    env: { a: 0.01, d: 0.12, s: 0.4, r: 0.06 },
  });
  bell(m, 0.2, "A6", { gain: 0.22, decay: 0.14, index: 0.9 });
  return master(m.buf, { room: { mix: 0.1, size: 0.7 }, lowpass: 5200, maxSeconds: 0.55 });
}

/** Crying: three sobs that sink, each one wobbling, with a sniff between them. */
function anchorCry(): Float64Array {
  const m = new Mix(1.3, 51);
  const sob = (at: number, note: string, drop: number, gate: number, gain: number) => {
    voice(m, at, note, hz(note) * 2 ** (-drop / 12), gate, {
      formant: 620,
      duty: 0.4,
      gain,
      vibrato: { rate: 9, cents: 70, delay: 0.02 },
      env: { a: 0.02, d: 0.12, s: 0.55, r: 0.07 },
    });
  };
  const sniff = (at: number) => noise(m, at, 0.05, { type: "bp", cutoff: 2600, q: 1.4 }, 0.05, { a: 0.02, r: 0.02 });
  sob(0, "E4", 3, 0.16, 0.9);
  sniff(0.2);
  sob(0.27, "D4", 3, 0.16, 0.85);
  sniff(0.47);
  sob(0.54, "C4", 5, 0.28, 0.9);
  return master(m.buf, { room: { mix: 0.1, size: 0.7 }, lowpass: 3600, maxSeconds: 0.98 });
}

/** Laughing: "ha-ha-ha-ha-ha", five staccato syllables down the scale, each with a breath in front. */
function anchorLaugh(): Float64Array {
  const m = new Mix(1, 52);
  ["A3", "G3", "E3", "D3", "C3"].forEach((note, i) => {
    const at = i * 0.115;
    noise(m, at, 0.02, { type: "bp", cutoff: 1800, q: 0.8 }, 0.08, { a: 0.003, r: 0.012 });
    voice(m, at + 0.012, note, hz(note) * 0.94, 0.055, {
      formant: 850,
      duty: 0.32,
      gain: 0.95 - i * 0.07,
      env: { a: 0.006, d: 0.05, s: 0.4, r: 0.035 },
    });
  });
  return master(m.buf, { room: { mix: 0.1, size: 0.7 }, lowpass: 3600, maxSeconds: 0.72 });
}

/** Angry: a growl made of short grains that sinks, and his fist on the desk a moment after it starts. */
function anchorGrumble(): Float64Array {
  const m = new Mix(1, 53);
  for (let i = 0; i < 14; i++) {
    const f = hz("G2") * 2 ** (-i / 40);
    voice(m, i * 0.038, f * 1.06, f, 0.026, {
      formant: 520,
      duty: 0.22,
      gain: i < 3 ? 0.6 + 0.13 * i : 1 - (i - 3) * 0.04,
      env: { a: 0.004, d: 0.03, s: 0.3, r: 0.014 },
    });
  }
  timpani(m, 0.11, "C3", 0.9);
  noise(m, 0.11, 0.02, { type: "lp", cutoff: 900 }, 0.3, { a: 0.002, r: 0.02 });
  return master(m.buf, { room: { mix: 0.08, size: 0.6 }, lowpass: 3000, maxSeconds: 0.7 });
}

/** Smug: a little "heh-heh" and the "ting" of a twirled moustache. */
function anchorSmug(): Float64Array {
  const m = new Mix(0.9, 54);
  const heh = (at: number, note: string, gain: number) => {
    noise(m, at, 0.03, { type: "bp", cutoff: 1500, q: 0.7 }, 0.1, { a: 0.004, r: 0.015 });
    voice(m, at + 0.02, note, hz(note) * 0.9, 0.06, {
      formant: 600,
      duty: 0.28,
      gain,
      env: { a: 0.008, d: 0.06, s: 0.35, r: 0.04 },
    });
  };
  heh(0, "E3", 0.9);
  heh(0.15, "C3", 0.8);
  bell(m, 0.33, "E7", { gain: 0.2, decay: 0.2, index: 0.8 });
  bell(m, 0.33, "A6", { gain: 0.1, decay: 0.16, index: 0.8 });
  return master(m.buf, { room: { mix: 0.12, size: 0.8 }, lowpass: 6000, maxSeconds: 0.65 });
}

/** Confused: "hm?", a closed vowel that starts flat and then goes up like a question. */
function anchorHuh(): Float64Array {
  const m = new Mix(0.8, 55);
  const env = { a: 0.015, d: 0.1, s: 0.6, r: 0.06 };
  voice(m, 0, "G2", "A2", 0.1, { formant: 480, duty: 0.25, gain: 0.85, env });
  voice(m, 0.11, "A2", "F3", 0.2, { formant: 560, duty: 0.3, glide: 0.24, gain: 0.95, env });
  bell(m, 0.3, "D6", { gain: 0.12, decay: 0.12, index: 0.8 });
  return master(m.buf, { room: { mix: 0.1, size: 0.7 }, lowpass: 3400, maxSeconds: 0.5 });
}

/** Proud: a tiny "ta-daa", a pick-up note into a C major chord with a sparkle. */
function anchorTada(): Float64Array {
  const m = new Mix(1.2, 56);
  const ring = { d: 0.25, s: 0.5, r: 0.3 };
  const vibrato = { rate: 5.5, cents: 10, delay: 0.12 };
  chip(m, 0, "G4", 0.05, { env: { d: 0.05, s: 0.3, r: 0.04 }, gain: 0.8, sub: 0.2 });
  timpani(m, 0.13, "C3", 0.7);
  chip(m, 0.13, "C5", 0.22, { env: ring, gain: 0.8, sub: 0.2, vibrato });
  chip(m, 0.13, "E5", 0.22, { env: ring, gain: 0.5, bright: 0.8, vibrato });
  chip(m, 0.13, "G5", 0.22, { env: ring, gain: 0.6, sparkle: 0.2, vibrato });
  bell(m, 0.3, "E7", { gain: 0.14, decay: 0.14, index: 0.8 });
  bell(m, 0.4, "G7", { gain: 0.1, decay: 0.16, index: 0.8 });
  return master(m.buf, { room: { mix: 0.16, size: 0.9 }, maxSeconds: 0.8 });
}

/** Poking a friend (ADR-155): a short rubbery "boing", up and back down with a wobble. */
function poke(): Float64Array {
  const m = new Mix(0.45, 57);
  m.tone({
    at: 0,
    note: "C5",
    to: "G5",
    glide: 0.05,
    gate: 0.05,
    wave: "pulse",
    duty: 0.3,
    gain: 0.3,
    env: { a: 0.003, d: 0.06, s: 0.3, r: 0.05 },
    filter: { type: "lp", cutoff: 3200 },
  });
  m.tone({
    at: 0.055,
    note: "G5",
    to: "D5",
    glide: 0.14,
    gate: 0.12,
    gain: 0.65,
    vibrato: { rate: 24, cents: 70 },
    env: { a: 0.003, d: 0.14, s: 0.2, r: 0.1 },
  });
  noise(m, 0, 0.006, { type: "bp", cutoff: 2600, q: 0.9 }, 0.12, { a: 0.003, r: 0.01 });
  return master(m.buf, { room: { mix: 0.08, size: 0.5 }, maxSeconds: 0.38 });
}

// --- News battles (ADR-160) ----------------------------------------------------

/** Countdown pip ("3", "2", "1"): a short square beep, like an arcade cabinet. */
function battleCountdown(): Float64Array {
  const m = new Mix(0.35, 61);
  chip(m, 0, "C5", 0.09, { gain: 0.9, duty: 0.5, env: { d: 0.06, s: 0.5, r: 0.06 }, sub: 0.2 });
  return master(m.buf, { room: { mix: 0.08, size: 0.5 }, maxSeconds: 0.3 });
}

/** "LOS!": a rising power chord with a cymbal. */
function battleGo(): Float64Array {
  const m = new Mix(1, 62);
  chip(m, 0, "C5", 0.06, { gain: 0.7, duty: 0.5, env: { d: 0.05, s: 0.4, r: 0.04 } });
  for (const note of ["C6", "G5", "E5"])
    chip(m, 0.07, note, 0.3, { gain: 0.6, duty: 0.25, sparkle: 0.2, env: { d: 0.2, s: 0.5, r: 0.25 } });
  timpani(m, 0.07, "C3", 0.9);
  noise(m, 0.07, 0.35, { type: "hp", cutoff: 5000 }, 0.12, { a: 0.002, d: 0.35, r: 0.2 });
  return master(m.buf, { room: { mix: 0.16, size: 0.9 } });
}

/** A floor tile cracks: a dry little snap. */
function battleCrack(): Float64Array {
  const m = new Mix(0.25, 63);
  noise(m, 0, 0.015, { type: "bp", cutoff: 3200, q: 1.5 }, 0.8, { a: 0.001, r: 0.02 });
  noise(m, 0.03, 0.02, { type: "bp", cutoff: 1800, q: 1.2 }, 0.5, { a: 0.001, r: 0.03 });
  m.tone({
    at: 0,
    note: "A4",
    to: "D4",
    glide: 0.05,
    gate: 0.04,
    wave: "pulse",
    duty: 0.12,
    gain: 0.15,
    env: { d: 0.04, s: 0, r: 0.03 },
  });
  return master(m.buf, { lowpass: 7000, maxSeconds: 0.22 });
}

/** Somebody falls: the classic falling whistle that sinks an octave and a half. */
function battleFall(): Float64Array {
  const m = new Mix(0.8, 64);
  const env = { a: 0.005, d: 0.4, s: 0.6, r: 0.12 };
  m.tone({
    at: 0,
    note: "A5",
    to: "C4",
    glide: 0.55,
    gate: 0.55,
    wave: "pulse",
    duty: 0.3,
    gain: 0.45,
    env,
    filter: { type: "lp", cutoff: 3600 },
  });
  m.tone({ at: 0, note: "A5", to: "C4", glide: 0.55, gate: 0.55, gain: 0.35, env });
  timpani(m, 0.58, "G2", 0.6);
  return master(m.buf, { room: { mix: 0.12, size: 0.7 }, maxSeconds: 0.8 });
}

/** A hit: a punchy thud with a crunch on top. */
function battleHit(): Float64Array {
  const m = new Mix(0.4, 65);
  m.tone({
    at: 0,
    note: "E3",
    to: "A1",
    glide: 0.08,
    gate: 0.06,
    gain: 0.9,
    env: { a: 0.001, d: 0.12, s: 0, r: 0.08 },
  });
  noise(m, 0, 0.04, { type: "lp", cutoff: 2400 }, 0.6, { a: 0.001, d: 0.06, r: 0.04 });
  m.tone({
    at: 0.01,
    note: "C4",
    to: "G3",
    glide: 0.05,
    gate: 0.05,
    wave: "pulse",
    duty: 0.2,
    gain: 0.25,
    env: { d: 0.05, s: 0, r: 0.04 },
  });
  return master(m.buf, { lowpass: 6000, maxSeconds: 0.35 });
}

/** One coin caught: two quick notes up. */
function battleCoin(): Float64Array {
  const m = new Mix(0.3, 66);
  chip(m, 0, "B5", 0.04, { gain: 0.7, duty: 0.5, env: { d: 0.04, s: 0.3, r: 0.03 } });
  chip(m, 0.05, "E6", 0.12, { gain: 0.8, duty: 0.5, sparkle: 0.3, env: { d: 0.1, s: 0.3, r: 0.12 } });
  return master(m.buf, { room: { mix: 0.06, size: 0.4 }, maxSeconds: 0.3 });
}

/** A gold bar: the coin plus a shining arpeggio. */
function battleGold(): Float64Array {
  const m = new Mix(0.6, 67);
  ["C6", "E6", "G6", "C7"].forEach((note, i) =>
    chip(m, i * 0.05, note, 0.06, { gain: 0.6, duty: 0.5, sparkle: 0.2, env: { d: 0.06, s: 0.3, r: 0.08 } }),
  );
  bell(m, 0.22, "E7", { gain: 0.35, decay: 0.2, index: 0.8 });
  return master(m.buf, { room: { mix: 0.12, size: 0.6 } });
}

/** A shove in the sumo ring: a whoosh and a rubbery boing. */
function battlePush(): Float64Array {
  const m = new Mix(0.45, 68);
  noise(m, 0, 0.08, { type: "bp", cutoff: 900, to: 3200, sweep: 0.08, q: 0.9 }, 0.5, { a: 0.01, d: 0.08, r: 0.04 });
  m.tone({
    at: 0.05,
    note: "G3",
    to: "D4",
    glide: 0.04,
    gate: 0.12,
    wave: "pulse",
    duty: 0.3,
    gain: 0.35,
    vibrato: { rate: 20, cents: 60 },
    env: { d: 0.12, s: 0.2, r: 0.08 },
    filter: { type: "lp", cutoff: 2600 },
  });
  return master(m.buf, { lowpass: 6000, maxSeconds: 0.4 });
}

/** The toxic stock changes hands: a quick "zip" up. */
function battlePass(): Float64Array {
  const m = new Mix(0.3, 69);
  m.tone({
    at: 0,
    note: "C5",
    to: "C6",
    glide: 0.08,
    gate: 0.08,
    wave: "pulse",
    duty: 0.25,
    gain: 0.5,
    env: { d: 0.08, s: 0.3, r: 0.05 },
    filter: { type: "lp", cutoff: 5000 },
  });
  bell(m, 0.08, "G6", { gain: 0.3, decay: 0.1 });
  return master(m.buf, { maxSeconds: 0.28 });
}

/** A fuse is lit: a hiss with a tick. */
function battleFuse(): Float64Array {
  const m = new Mix(0.6, 70);
  noise(m, 0, 0.45, { type: "hp", cutoff: 4000 }, 0.35, { a: 0.02, d: 0.45, r: 0.1 });
  m.tone({ at: 0, note: "E6", gate: 0.015, wave: "pulse", duty: 0.5, gain: 0.3, env: { d: 0.02, s: 0, r: 0.02 } });
  return master(m.buf, { lowpass: 8000, maxSeconds: 0.55 });
}

/** The bang: a low boom with crackling debris. */
function battleBang(): Float64Array {
  const m = new Mix(1.2, 71);
  m.tone({ at: 0, note: "G2", to: "C1", glide: 0.3, gate: 0.2, gain: 1, env: { a: 0.001, d: 0.5, s: 0, r: 0.3 } });
  noise(m, 0, 0.5, { type: "lp", cutoff: 1800, to: 300, sweep: 0.5 }, 0.9, { a: 0.001, d: 0.6, r: 0.3 });
  for (let i = 0; i < 8; i++)
    noise(
      m,
      0.08 + i * 0.07 + m.rand() * 0.04,
      0.01,
      { type: "bp", cutoff: 2500 + m.rand() * 2000, q: 1.5 },
      0.25 * (1 - i / 9),
      { a: 0.001, r: 0.02 },
    );
  return master(m.buf, { room: { mix: 0.18, size: 1 }, lowpass: 5000 });
}

/** Die Glocke: a big brass bell. */
function battleBell(): Float64Array {
  const m = new Mix(1.6, 72);
  bell(m, 0, "G5", { gain: 0.9, decay: 0.9, index: 2.2 });
  bell(m, 0, "D6", { gain: 0.35, decay: 0.6, index: 1.6 });
  bell(m, 0, "G4", { gain: 0.4, decay: 1.1, index: 1.2 });
  noise(m, 0, 0.01, { type: "bp", cutoff: 3000, q: 1 }, 0.3, { a: 0.001, r: 0.01 });
  return master(m.buf, { room: { mix: 0.25, size: 1 } });
}

/** One pump of the stock: a short rising blip. */
function battlePump(): Float64Array {
  const m = new Mix(0.15, 73);
  m.tone({
    at: 0,
    note: "E5",
    to: "A5",
    glide: 0.03,
    gate: 0.03,
    wave: "pulse",
    duty: 0.4,
    gain: 0.5,
    env: { d: 0.03, s: 0.2, r: 0.02 },
    filter: { type: "lp", cutoff: 4000 },
  });
  return master(m.buf, { maxSeconds: 0.1 });
}

/** A tap in the crash: a buzzer and a sad slide. */
function battleBust(): Float64Array {
  const m = new Mix(0.7, 74);
  const env = { a: 0.005, d: 0.2, s: 0.7, r: 0.08 };
  for (const note of ["A2", "A#2"])
    m.tone({
      at: 0,
      note,
      gate: 0.25,
      wave: "pulse",
      duty: 0.5,
      gain: note === "A2" ? 0.55 : 0.4,
      env,
      filter: { type: "lp", cutoff: 1400 },
    });
  m.tone({ at: 0.28, note: "E4", to: "A3", glide: 0.3, gate: 0.3, gain: 0.35, env: { d: 0.3, s: 0.4, r: 0.1 } });
  return master(m.buf, { lowpass: 5000, maxSeconds: 0.7 });
}

/** The winner: a short victory fanfare (C major, three hits and two held chords with sparkles). */
function battleFanfare(): Float64Array {
  const m = new Mix(2.2, 75);
  const hit = { d: 0.08, s: 0.5, r: 0.08 };
  const vibrato = { rate: 5.5, cents: 12, delay: 0.15 };
  ["G4", "G4", "G4"].forEach((note, i) =>
    chip(m, i * 0.13, note, 0.08, { gain: 0.7, duty: 0.25, env: hit, sub: 0.25 }),
  );
  chip(m, 0.39, "E5", 0.5, { gain: 0.8, duty: 0.25, env: { d: 0.3, s: 0.6, r: 0.4 }, vibrato });
  chip(m, 0.39, "C5", 0.5, { gain: 0.6, duty: 0.25, env: { d: 0.3, s: 0.6, r: 0.4 }, sub: 0.3 });
  chip(m, 0.95, "G5", 0.6, { gain: 0.8, duty: 0.25, sparkle: 0.3, env: { d: 0.4, s: 0.6, r: 0.5 }, vibrato });
  chip(m, 0.95, "C6", 0.6, { gain: 0.6, duty: 0.25, env: { d: 0.4, s: 0.6, r: 0.5 } });
  timpani(m, 0, "C3", 0.6);
  timpani(m, 0.39, "C3", 0.8);
  timpani(m, 0.95, "G2", 0.9);
  ["E6", "G6", "C7", "E7", "G7"].forEach((note, i) =>
    bell(m, 1.0 + i * 0.08, note, { gain: 0.3, decay: 0.2, index: 0.8 }),
  );
  return master(m.buf, { room: { mix: 0.2, size: 1 } });
}

/** Joining the lobby: a friendly "plopp" up. */
function battleJoin(): Float64Array {
  const m = new Mix(0.35, 76);
  chip(m, 0, "G5", 0.05, { gain: 0.6, duty: 0.4, env: { d: 0.05, s: 0.3, r: 0.04 } });
  chip(m, 0.06, "C6", 0.1, { gain: 0.7, duty: 0.4, sparkle: 0.2, env: { d: 0.08, s: 0.3, r: 0.1 } });
  return master(m.buf, { room: { mix: 0.08, size: 0.5 }, maxSeconds: 0.32 });
}

// --- News battles, the games of the addendum (ADR-160) -------------------------------

/** Bärenjagd: a bear comes out: a low, wobbling growl that rises and falls. */
function battleRoar(): Float64Array {
  const m = new Mix(0.9, 77);
  m.tone({
    at: 0,
    note: "A1",
    to: "D2",
    glide: 0.25,
    gate: 0.55,
    wave: "pulse",
    duty: 0.35,
    gain: 0.6,
    vibrato: { rate: 24, cents: 90 },
    env: { a: 0.04, d: 0.3, s: 0.7, r: 0.25 },
    filter: { type: "lp", cutoff: 900, to: 500, sweep: 0.5 },
  });
  noise(m, 0, 0.6, { type: "bp", cutoff: 400, q: 1.2 }, 0.45, { a: 0.05, d: 0.5, r: 0.2 });
  m.tone({ at: 0.45, note: "D2", to: "G1", glide: 0.3, gate: 0.3, gain: 0.5, env: { d: 0.3, s: 0.3, r: 0.12 } });
  return master(m.buf, { room: { mix: 0.12, size: 0.7 }, lowpass: 3000 });
}

/** Bärenjagd: caught: two quick chomps. */
function battleChomp(): Float64Array {
  const m = new Mix(0.4, 78);
  for (const at of [0, 0.12]) {
    m.tone({
      at,
      note: "G3",
      to: "C3",
      glide: 0.05,
      gate: 0.05,
      wave: "pulse",
      duty: 0.4,
      gain: 0.6,
      env: { d: 0.06, s: 0, r: 0.03 },
    });
    noise(m, at, 0.03, { type: "lp", cutoff: 1800 }, 0.5, { a: 0.001, r: 0.02 });
  }
  return master(m.buf, { lowpass: 5000, maxSeconds: 0.35 });
}

/** Margin Call: the gong. */
function battleGong(): Float64Array {
  const m = new Mix(1.8, 79);
  bell(m, 0, "C3", { gain: 0.9, decay: 1.2, index: 3 });
  bell(m, 0, "G3", { gain: 0.35, decay: 0.9, index: 2 });
  bell(m, 0, 98, { gain: 0.5, decay: 1.4, index: 1.2 });
  noise(m, 0, 0.02, { type: "bp", cutoff: 1200, q: 1 }, 0.4, { a: 0.001, r: 0.02 });
  return master(m.buf, { room: { mix: 0.3, size: 1 } });
}

/** Laserschranke: a beam burns you: a sizzling zap down. */
function battleZap(): Float64Array {
  const m = new Mix(0.4, 80);
  m.tone({
    at: 0,
    note: "C7",
    to: "C4",
    glide: 0.18,
    gate: 0.18,
    wave: "pulse",
    duty: 0.15,
    gain: 0.5,
    env: { d: 0.18, s: 0.2, r: 0.06 },
  });
  noise(m, 0, 0.2, { type: "hp", cutoff: 3000 }, 0.35, { a: 0.002, d: 0.2, r: 0.05 });
  return master(m.buf, { lowpass: 9000, maxSeconds: 0.35 });
}

/** Farbrausch (ADR-177): a paint bomb bursts: a wet splat with a short low thump. */
function battleSplat(): Float64Array {
  const m = new Mix(0.35, 83);
  noise(m, 0, 0.16, { type: "bp", cutoff: 900, to: 300, sweep: 0.16, q: 0.9 }, 0.7, { a: 0.002, d: 0.14, r: 0.04 });
  m.tone({ at: 0, note: "A2", to: "D2", glide: 0.1, gate: 0.1, gain: 0.45, env: { d: 0.1, s: 0, r: 0.04 } });
  return master(m.buf, { lowpass: 6000, maxSeconds: 0.35 });
}

/** Bulle und Bär (ADR-177): tagged: two quick notes down, "du bist's". */
function battleTag(): Float64Array {
  const m = new Mix(0.3, 84);
  m.tone({ at: 0, note: "E5", gate: 0.07, wave: "pulse", duty: 0.25, gain: 0.45, env: { d: 0.06, s: 0.4, r: 0.03 } });
  m.tone({ at: 0.09, note: "B4", gate: 0.12, wave: "pulse", duty: 0.25, gain: 0.45, env: { d: 0.1, s: 0.4, r: 0.05 } });
  return master(m.buf, { lowpass: 8000, maxSeconds: 0.3 });
}

/** Crash-Regen (ADR-177): a crash hits the floor: a falling whistle into a dull boom. */
function battleImpact(): Float64Array {
  const m = new Mix(0.55, 85);
  m.tone({
    at: 0,
    note: "G5",
    to: "C4",
    glide: 0.14,
    gate: 0.14,
    wave: "pulse",
    duty: 0.5,
    gain: 0.18,
    env: { d: 0.14, s: 0.6, r: 0.02 },
  });
  noise(m, 0.14, 0.35, { type: "lp", cutoff: 700, to: 200, sweep: 0.3 }, 0.8, { a: 0.002, d: 0.3, r: 0.08 });
  m.tone({ at: 0.14, note: "C2", to: "G1", glide: 0.2, gate: 0.2, gain: 0.55, env: { d: 0.2, s: 0, r: 0.06 } });
  return master(m.buf, { lowpass: 4000, maxSeconds: 0.55 });
}

/** Goldrausch-Zone (ADR-177): the zone shrinks: a rising warble. */
function battleShrink(): Float64Array {
  const m = new Mix(0.5, 86);
  for (let i = 0; i < 4; i++)
    m.tone({
      at: i * 0.1,
      note: ["C4", "E4", "G4", "C5"][i]!,
      gate: 0.08,
      wave: "triangle",
      gain: 0.4,
      env: { d: 0.08, s: 0.5, r: 0.04 },
    });
  return master(m.buf, { room: { mix: 0.15, size: 0.5 }, maxSeconds: 0.5 });
}

/** Laserschranke: a jump: the classic "boing" up. */
function battleJump(): Float64Array {
  const m = new Mix(0.25, 81);
  m.tone({
    at: 0,
    note: "C5",
    to: "C6",
    glide: 0.12,
    gate: 0.12,
    wave: "pulse",
    duty: 0.5,
    gain: 0.45,
    env: { d: 0.12, s: 0.3, r: 0.05 },
    filter: { type: "lp", cutoff: 4500 },
  });
  return master(m.buf, { maxSeconds: 0.22 });
}

/** Laserschranke: a beam switches on: a rising hum. */
function battleLaser(): Float64Array {
  const m = new Mix(0.45, 82);
  m.tone({
    at: 0,
    note: "A4",
    to: "A5",
    glide: 0.3,
    gate: 0.3,
    wave: "pulse",
    duty: 0.25,
    gain: 0.35,
    vibrato: { rate: 30, cents: 30 },
    env: { a: 0.01, d: 0.3, s: 0.6, r: 0.1 },
    filter: { type: "lp", cutoff: 3500 },
  });
  return master(m.buf, { room: { mix: 0.08, size: 0.4 }, maxSeconds: 0.45 });
}

/** A swoosh (Margin Call lights up, the elevator gets faster, a rodeo hit). */
function battleWhoosh(): Float64Array {
  const m = new Mix(0.35, 83);
  noise(m, 0, 0.25, { type: "bp", cutoff: 600, to: 4000, sweep: 0.22, q: 0.8 }, 0.6, { a: 0.03, d: 0.2, r: 0.08 });
  return master(m.buf, { maxSeconds: 0.35 });
}

/** Bullen-Rodeo: the bull bucks: a snort and a thud. */
function battleBuck(): Float64Array {
  const m = new Mix(0.4, 84);
  noise(m, 0, 0.08, { type: "bp", cutoff: 700, q: 1.4 }, 0.5, { a: 0.005, d: 0.08, r: 0.04 });
  m.tone({
    at: 0.06,
    note: "D3",
    to: "G1",
    glide: 0.1,
    gate: 0.08,
    gain: 0.8,
    env: { a: 0.001, d: 0.12, s: 0, r: 0.06 },
  });
  chip(m, 0.06, "A4", 0.04, { gain: 0.25, duty: 0.5, env: { d: 0.04, s: 0, r: 0.03 } });
  return master(m.buf, { lowpass: 5000, maxSeconds: 0.38 });
}

/** Tresorknacker: a digit: the click of the dial. */
function battleClick(): Float64Array {
  const m = new Mix(0.1, 85);
  noise(m, 0, 0.006, { type: "bp", cutoff: 4200, q: 2 }, 0.8, { a: 0.001, r: 0.01 });
  m.tone({ at: 0, note: "E6", gate: 0.01, wave: "pulse", duty: 0.5, gain: 0.25, env: { d: 0.02, s: 0, r: 0.01 } });
  return master(m.buf, { maxSeconds: 0.08 });
}

/** Tresorknacker: cracked: the bolts slide back, a chord of gold. */
function battleUnlock(): Float64Array {
  const m = new Mix(1.1, 86);
  for (let i = 0; i < 3; i++)
    noise(m, i * 0.06, 0.02, { type: "bp", cutoff: 2600, q: 1.6 }, 0.5, { a: 0.001, r: 0.02 });
  m.tone({
    at: 0.2,
    note: "G3",
    to: "C4",
    glide: 0.08,
    gate: 0.1,
    wave: "pulse",
    duty: 0.3,
    gain: 0.4,
    env: { d: 0.1, s: 0.2, r: 0.06 },
  });
  ["C5", "E5", "G5", "C6"].forEach((note, i) =>
    chip(m, 0.32 + i * 0.07, note, 0.12, { gain: 0.55, duty: 0.25, sparkle: 0.25, env: { d: 0.1, s: 0.4, r: 0.18 } }),
  );
  return master(m.buf, { room: { mix: 0.16, size: 0.8 } });
}

/** Wer bietet mehr?: the gavel: two knocks of wood and a "sold" chime. */
function battleGavel(): Float64Array {
  const m = new Mix(0.9, 87);
  for (const at of [0, 0.16]) {
    noise(m, at, 0.02, { type: "bp", cutoff: 900, q: 2 }, 0.8, { a: 0.001, r: 0.03 });
    m.tone({ at, note: "A2", to: "E2", glide: 0.04, gate: 0.04, gain: 0.7, env: { a: 0.001, d: 0.08, s: 0, r: 0.04 } });
  }
  bell(m, 0.32, "E6", { gain: 0.4, decay: 0.3, index: 1 });
  bell(m, 0.4, "A6", { gain: 0.35, decay: 0.35, index: 1 });
  return master(m.buf, { room: { mix: 0.14, size: 0.7 } });
}

/** File name → renderer. The names are what src/lib/sound.ts references. */
const RENDER: Record<string, () => Float64Array> = {
  tap,
  toggle,
  success,
  coin,
  buy,
  sell,
  error,
  warning,
  "level-up": levelUp,
  notify,
  "blip-1": blip("E5", "D5", 0.35, 1800, 31),
  "blip-2": blip("G5", "E5", 0.3, 2000, 32),
  "blip-3": blip("D5", "C5", 0.4, 1600, 33),
  win,
  "news-intro": newsIntro,
  "anchor-talk-1": anchorTalk("A2", "G2", 620, 0.3, 42),
  "anchor-talk-2": anchorTalk("C3", "A2", 820, 0.36, 43),
  "anchor-talk-3": anchorTalk("G2", "A2", 540, 0.26, 44),
  "anchor-talk-4": anchorTalk("D3", "C3", 720, 0.32, 45),
  "news-sting": newsSting,
  "news-bad": newsBad,
  "news-good": newsGood,
  "news-tick": newsTick,
  "anchor-gasp": anchorGasp,
  "anchor-cry": anchorCry,
  "anchor-laugh": anchorLaugh,
  "anchor-grumble": anchorGrumble,
  "anchor-smug": anchorSmug,
  "anchor-huh": anchorHuh,
  "anchor-tada": anchorTada,
  poke,
  "battle-countdown": battleCountdown,
  "battle-go": battleGo,
  "battle-crack": battleCrack,
  "battle-fall": battleFall,
  "battle-hit": battleHit,
  "battle-coin": battleCoin,
  "battle-gold": battleGold,
  "battle-push": battlePush,
  "battle-pass": battlePass,
  "battle-fuse": battleFuse,
  "battle-bang": battleBang,
  "battle-bell": battleBell,
  "battle-pump": battlePump,
  "battle-bust": battleBust,
  "battle-fanfare": battleFanfare,
  "battle-join": battleJoin,
  "battle-roar": battleRoar,
  "battle-chomp": battleChomp,
  "battle-gong": battleGong,
  "battle-zap": battleZap,
  "battle-jump": battleJump,
  "battle-laser": battleLaser,
  "battle-whoosh": battleWhoosh,
  "battle-buck": battleBuck,
  "battle-click": battleClick,
  "battle-unlock": battleUnlock,
  "battle-gavel": battleGavel,
  "battle-splat": battleSplat,
  "battle-tag": battleTag,
  "battle-impact": battleImpact,
  "battle-shrink": battleShrink,
  "pack-crinkle": packCrinkle,
  "pack-tear": packTear,
  "card-flick": cardFlick,
  "card-show": cardShow,
  "pull-rare": pullRare,
  "pull-ultra": pullUltra,
  "pull-prisma": pullPrisma,
  "pull-legendary": pullLegendary,
  "grade-drum": gradeDrum,
  "grade-tick": gradeTick,
  "grade-low": gradeLow,
  "grade-good": gradeGood,
  "grade-ten": gradeTen,
  "black-label": blackLabel,
};

// ---------------------------------------------------------------------------
// Nexamon packs (ADR-165)
// ---------------------------------------------------------------------------

/** Foil crackles under the finger while the pack is being torn: one dry tick. */
function packCrinkle(): Float64Array {
  const m = new Mix(0.09, 91);
  noise(m, 0, 0.012, { type: "hp", cutoff: 5200 }, 0.7, { a: 0.001, r: 0.012 });
  noise(m, 0.022, 0.01, { type: "bp", cutoff: 7400, q: 2 }, 0.45, { a: 0.001, r: 0.015 });
  return master(m.buf, { maxSeconds: 0.09 });
}

/** The strip of foil comes off: a ripping run of crackles that rises, then a bright snap. */
function packTear(): Float64Array {
  const m = new Mix(0.62, 92);
  noise(m, 0, 0.3, { type: "bp", cutoff: 2600, to: 7200, sweep: 0.3, q: 1.1 }, 0.55, {
    a: 0.01,
    d: 0.3,
    s: 0.5,
    r: 0.05,
  });
  for (let i = 0; i < 16; i++) {
    const at = 0.012 + i * 0.019 - (i * i) / 4200;
    noise(m, at, 0.008, { type: "hp", cutoff: 4200 + i * 260 }, 0.5 + (i % 3) * 0.14, { a: 0.001, r: 0.012 });
  }
  noise(m, 0.31, 0.03, { type: "hp", cutoff: 6000 }, 0.9, { a: 0.001, r: 0.05 });
  m.tone({
    at: 0.31,
    note: "E6",
    to: "B6",
    glide: 0.05,
    gate: 0.05,
    wave: "pulse",
    duty: 0.2,
    gain: 0.12,
    env: { a: 0.002, d: 0.06, s: 0, r: 0.05 },
  });
  noise(m, 0.34, 0.2, { type: "hp", cutoff: 8000 }, 0.07, { a: 0.01, d: 0.2, r: 0.08 });
  return master(m.buf, { maxSeconds: 0.62, room: { mix: 0.08, size: 0.6 } });
}

/** A card is flicked off the stack: a short paper swish with a tiny click. */
function cardFlick(): Float64Array {
  const m = new Mix(0.2, 93);
  noise(m, 0, 0.09, { type: "bp", cutoff: 1500, to: 5200, sweep: 0.09, q: 0.9 }, 0.6, { a: 0.008, d: 0.09, r: 0.04 });
  noise(m, 0.085, 0.008, { type: "hp", cutoff: 5000 }, 0.35, { a: 0.001, r: 0.012 });
  return master(m.buf, { maxSeconds: 0.2 });
}

/** The next card shows its face: a soft two-pixel tick. */
function cardShow(): Float64Array {
  const m = new Mix(0.16, 94);
  chip(m, 0, "E5", 0.02, { env: { d: 0.04, s: 0.2, r: 0.03 }, gain: 0.45 });
  chip(m, 0.03, "A5", 0.025, { env: { d: 0.05, s: 0.2, r: 0.05 }, gain: 0.4 });
  return master(m.buf, { maxSeconds: 0.16 });
}

/** A rare card: two bright notes up, a little shine. */
function pullRare(): Float64Array {
  const m = new Mix(0.6, 95);
  chip(m, 0, "E5", 0.05, { env: { d: 0.08, s: 0.3, r: 0.06 }, gain: 0.7 });
  chip(m, 0.07, "B5", 0.14, { env: { d: 0.2, s: 0.35, r: 0.22 }, sparkle: 0.15, gain: 0.8 });
  noise(m, 0.07, 0.2, { type: "hp", cutoff: 7500 }, 0.04, { a: 0.01, d: 0.2, r: 0.08 });
  return master(m.buf, { room: { mix: 0.14, size: 0.8 } });
}

/** An ultra rare card: a quick run of four with a held top note. */
function pullUltra(): Float64Array {
  const m = new Mix(0.95, 96);
  const run: [number, string][] = [
    [0, "D5"],
    [0.06, "F#5"],
    [0.12, "A5"],
  ];
  for (const [at, note] of run) chip(m, at, note, 0.04, { env: { d: 0.06, s: 0.3, r: 0.05 }, gain: 0.75 });
  const ring = { d: 0.3, s: 0.5, r: 0.3 };
  chip(m, 0.19, "D6", 0.3, { env: ring, sparkle: 0.2, vibrato: { rate: 6, cents: 10, delay: 0.1 }, gain: 0.9 });
  chip(m, 0.19, "A5", 0.3, { env: ring, gain: 0.4, bright: 0.6 });
  m.tone({ at: 0, note: "D4", gate: 0.45, wave: "triangle", gain: 0.25, env: { a: 0.01, d: 0.3, s: 0.5, r: 0.1 } });
  noise(m, 0.19, 0.35, { type: "hp", cutoff: 7000 }, 0.04, { a: 0.02, d: 0.35, r: 0.1 });
  return master(m.buf, { room: { mix: 0.16, size: 0.9 } });
}

/** A prisma card: a shimmering arpeggio over two octaves that hangs in the air. */
function pullPrisma(): Float64Array {
  const m = new Mix(1.5, 97);
  const run = ["E5", "G#5", "B5", "E6", "G#6", "B6"];
  run.forEach((note, i) =>
    chip(m, i * 0.055, note, 0.045, { env: { d: 0.07, s: 0.35, r: 0.08 }, gain: 0.7, sparkle: 0.12 }),
  );
  const ring = { d: 0.4, s: 0.55, r: 0.45 };
  const vibrato = { rate: 5.5, cents: 12, delay: 0.12 };
  chip(m, 0.36, "E6", 0.5, { env: ring, sparkle: 0.3, vibrato, gain: 0.9 });
  chip(m, 0.36, "G#6", 0.5, { env: ring, vibrato, gain: 0.5, bright: 0.7 });
  chip(m, 0.36, "B5", 0.5, { env: ring, gain: 0.4 });
  m.tone({ at: 0.36, note: "E4", gate: 0.5, wave: "triangle", gain: 0.28, env: ring });
  for (let i = 0; i < 5; i++) bell(m, 0.42 + i * 0.09, ["B6", "E7", "G#6", "B6", "E7"][i]!, { gain: 0.12 });
  noise(m, 0.36, 0.6, { type: "hp", cutoff: 7000 }, 0.04, { a: 0.03, d: 0.6, r: 0.2 });
  return master(m.buf, { room: { mix: 0.2, size: 1 } });
}

/** A legendary card: a drum, a rising fanfare and a long golden chord. */
function pullLegendary(): Float64Array {
  const m = new Mix(2.3, 98);
  noise(m, 0, 0.12, { type: "lp", cutoff: 220 }, 0.9, { a: 0.002, d: 0.12, r: 0.1 });
  m.tone({
    at: 0,
    note: "C3",
    to: "C2",
    glide: 0.12,
    gate: 0.14,
    wave: "sine",
    gain: 0.6,
    env: { a: 0.002, d: 0.14, s: 0, r: 0.1 },
  });
  const fanfare: [number, string, number][] = [
    [0.1, "C5", 0.07],
    [0.19, "C5", 0.05],
    [0.26, "E5", 0.07],
    [0.35, "G5", 0.07],
    [0.44, "C6", 0.1],
    [0.57, "G5", 0.06],
  ];
  for (const [at, note, gate] of fanfare) chip(m, at, note, gate, { env: { d: 0.08, s: 0.4, r: 0.06 }, gain: 0.85 });
  const hold = 0.85;
  const ring = { d: 0.4, s: 0.6, r: 0.6 };
  const vibrato = { rate: 5.5, cents: 14, delay: 0.2 };
  chip(m, 0.66, "C6", hold, { env: ring, sparkle: 0.3, vibrato, gain: 0.95 });
  chip(m, 0.66, "E6", hold, { env: ring, vibrato, gain: 0.6, bright: 0.7 });
  chip(m, 0.66, "G6", hold, { env: ring, vibrato, gain: 0.45, bright: 0.8 });
  m.tone({ at: 0.66, note: "G4", gate: hold, wave: "triangle", gain: 0.25, env: ring });
  m.tone({ at: 0.66, note: "C3", gate: hold, wave: "triangle", gain: 0.32, env: ring });
  for (let i = 0; i < 8; i++)
    bell(m, 0.72 + i * 0.1, ["G6", "C7", "E7", "G7", "E7", "C7", "G6", "C7"][i]!, { gain: 0.11 });
  noise(m, 0.66, 1, { type: "hp", cutoff: 6500 }, 0.05, { a: 0.04, d: 1, r: 0.3 });
  return master(m.buf, { room: { mix: 0.24, size: 1.1 } });
}

/** The ASP package is open: a snare roll that gets denser and louder while the slab rises (ADR-165). */
function gradeDrum(): Float64Array {
  const m = new Mix(2.4, 201);
  let at = 0;
  let gap = 0.11;
  while (at < 2.05) {
    const power = 0.25 + 0.75 * (at / 2.05);
    noise(m, at, 0.03, { type: "bp", cutoff: 1900, q: 1.2 }, 0.55 * power, { a: 0.001, d: 0.04, r: 0.03 });
    m.tone({
      at,
      note: "D3",
      to: "A2",
      glide: 0.03,
      gate: 0.03,
      gain: 0.3 * power,
      env: { a: 0.001, d: 0.05, s: 0, r: 0.03 },
    });
    at += gap;
    gap = Math.max(0.028, gap * 0.94);
  }
  m.tone({
    at: 0,
    note: "C2",
    to: "G2",
    glide: 2.1,
    gate: 2.1,
    wave: "triangle",
    gain: 0.3,
    env: { a: 1.6, d: 0.3, s: 0.8, r: 0.15 },
  });
  noise(m, 0.6, 1.5, { type: "hp", cutoff: 5000 }, 0.07, { a: 1.3, d: 0.2, r: 0.1 });
  return master(m.buf, { room: { mix: 0.12, size: 0.8 } });
}

/** One step of the grade counting up; the player raises its rate with every step. */
function gradeTick(): Float64Array {
  const m = new Mix(0.22, 202);
  chip(m, 0, "C5", 0.05, { env: { d: 0.06, s: 0.2, r: 0.06 }, gain: 0.8 });
  noise(m, 0, 0.012, { type: "bp", cutoff: 2600, q: 2 }, 0.35, { a: 0.001, r: 0.02 });
  m.tone({ at: 0, note: "C3", gate: 0.05, wave: "triangle", gain: 0.3, env: { a: 0.002, d: 0.08, s: 0, r: 0.04 } });
  return master(m.buf, { room: { mix: 0.08, size: 0.5 } });
}

/** A grade below 8: two soft notes going down, no drama. */
function gradeLow(): Float64Array {
  const m = new Mix(0.8, 203);
  chip(m, 0, "E4", 0.14, { env: { d: 0.12, s: 0.4, r: 0.12 }, gain: 0.7 });
  chip(m, 0.17, "C4", 0.26, { env: { d: 0.2, s: 0.35, r: 0.25 }, gain: 0.7 });
  m.tone({ at: 0.17, note: "C3", gate: 0.3, wave: "triangle", gain: 0.3, env: { a: 0.01, d: 0.25, s: 0.3, r: 0.2 } });
  return master(m.buf, { room: { mix: 0.12, size: 0.7 } });
}

/** An 8 or a 9: a bright rising chime. */
function gradeGood(): Float64Array {
  const m = new Mix(1.2, 204);
  const run = ["G5", "B5", "D6"];
  run.forEach((note, i) => chip(m, i * 0.07, note, 0.05, { env: { d: 0.07, s: 0.35, r: 0.07 }, gain: 0.75 }));
  const ring = { d: 0.3, s: 0.5, r: 0.35 };
  chip(m, 0.22, "G6", 0.3, { env: ring, sparkle: 0.2, vibrato: { rate: 6, cents: 10, delay: 0.1 }, gain: 0.9 });
  chip(m, 0.22, "D6", 0.3, { env: ring, gain: 0.45, bright: 0.6 });
  m.tone({ at: 0.22, note: "G3", gate: 0.35, wave: "triangle", gain: 0.28, env: ring });
  for (let i = 0; i < 3; i++) bell(m, 0.3 + i * 0.1, ["D7", "G7", "B6"][i]!, { gain: 0.12 });
  return master(m.buf, { room: { mix: 0.16, size: 0.9 } });
}

/** A 10: a hit, a golden fanfare and a long major chord. */
function gradeTen(): Float64Array {
  const m = new Mix(2.2, 205);
  noise(m, 0, 0.1, { type: "lp", cutoff: 260 }, 0.9, { a: 0.002, d: 0.1, r: 0.08 });
  m.tone({ at: 0, note: "D3", to: "D2", glide: 0.1, gate: 0.12, gain: 0.6, env: { a: 0.002, d: 0.12, s: 0, r: 0.08 } });
  const fanfare: [number, string, number][] = [
    [0.08, "D5", 0.06],
    [0.16, "F#5", 0.06],
    [0.24, "A5", 0.06],
    [0.32, "D6", 0.1],
    [0.46, "A5", 0.05],
  ];
  for (const [at, note, gate] of fanfare) chip(m, at, note, gate, { env: { d: 0.08, s: 0.4, r: 0.06 }, gain: 0.85 });
  const hold = 0.8;
  const ring = { d: 0.4, s: 0.6, r: 0.6 };
  const vibrato = { rate: 5.5, cents: 14, delay: 0.2 };
  chip(m, 0.56, "D6", hold, { env: ring, sparkle: 0.3, vibrato, gain: 0.95 });
  chip(m, 0.56, "F#6", hold, { env: ring, vibrato, gain: 0.6, bright: 0.7 });
  chip(m, 0.56, "A6", hold, { env: ring, vibrato, gain: 0.45, bright: 0.8 });
  m.tone({ at: 0.56, note: "D3", gate: hold, wave: "triangle", gain: 0.32, env: ring });
  for (let i = 0; i < 8; i++)
    bell(m, 0.62 + i * 0.1, ["A6", "D7", "F#7", "A7", "F#7", "D7", "A6", "D7"][i]!, { gain: 0.11 });
  noise(m, 0.56, 1, { type: "hp", cutoff: 6500 }, 0.05, { a: 0.04, d: 1, r: 0.3 });
  return master(m.buf, { room: { mix: 0.24, size: 1.1 } });
}

/**
 * The Black Label: a deep boom into silence, a dark rising run, then the stamp (a second boom) and a wide, cold
 * chord with bells on top that hangs for a long time. The biggest sound of the card game.
 */
function blackLabel(): Float64Array {
  const m = new Mix(3.6, 206);
  const boom = (at: number, gain: number) => {
    noise(m, at, 0.2, { type: "lp", cutoff: 180 }, gain, { a: 0.002, d: 0.22, r: 0.2 });
    m.tone({
      at,
      note: "E2",
      to: "E1",
      glide: 0.3,
      gate: 0.35,
      gain: gain * 0.8,
      env: { a: 0.002, d: 0.4, s: 0, r: 0.25 },
    });
  };
  boom(0, 0.9);
  const run = ["E3", "G3", "B3", "E4", "G4", "B4", "E5", "G5"];
  run.forEach((note, i) =>
    chip(m, 0.42 + i * 0.065, note, 0.05, { env: { d: 0.06, s: 0.3, r: 0.05 }, gain: 0.4 + i * 0.06, duty: 0.25 }),
  );
  noise(m, 0.42, 0.52, { type: "hp", cutoff: 4000 }, 0.12, { a: 0.5, d: 0.05, r: 0.02 });
  const hit = 1.0;
  boom(hit, 1);
  noise(m, hit, 0.05, { type: "bp", cutoff: 3200, q: 1 }, 0.6, { a: 0.001, d: 0.06, r: 0.05 });
  const hold = 1.5;
  const ring = { d: 0.5, s: 0.65, r: 0.9 };
  const vibrato = { rate: 5, cents: 14, delay: 0.3 };
  chip(m, hit, "E6", hold, { env: ring, sparkle: 0.35, vibrato, gain: 0.95 });
  chip(m, hit, "B5", hold, { env: ring, vibrato, gain: 0.6, bright: 0.7 });
  chip(m, hit, "G#5", hold, { env: ring, vibrato, gain: 0.5, bright: 0.8 });
  chip(m, hit, "E5", hold, { env: ring, gain: 0.45, duty: 0.25 });
  m.tone({ at: hit, note: "E3", gate: hold, wave: "triangle", gain: 0.34, env: ring });
  m.tone({ at: hit, note: "E2", gate: hold, wave: "triangle", gain: 0.36, env: ring });
  const bells = ["B6", "E7", "G#7", "B7", "G#7", "E7", "B6", "E7", "G#7", "B7", "E7", "B7"];
  bells.forEach((note, i) => bell(m, hit + 0.08 + i * 0.11, note, { gain: 0.13, decay: 0.4 }));
  noise(m, hit, 1.8, { type: "hp", cutoff: 6500 }, 0.06, { a: 0.05, d: 1.8, r: 0.4 });
  return master(m.buf, { room: { mix: 0.28, size: 1.2 } });
}

/**
 * Long sounds are written at half the sample rate to keep the download small; they are low-passed far below the
 * new Nyquist frequency before every second sample is dropped.
 */
const HALF_RATE = new Set(["news-intro"]);

function halve(x: Float64Array): Float64Array {
  let y = x;
  for (let pass = 0; pass < 3; pass++) y = filterBuffer(y, "lp", 8000);
  const out = new Float64Array(Math.floor(y.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = y[i * 2] ?? 0;
  const gain = dbToGain(TARGET_PEAK_DB) / peakOf(out);
  return out.map((v) => v * gain);
}

// ---------------------------------------------------------------------------
// Analysis (we cannot listen, so we measure)
// ---------------------------------------------------------------------------

interface Pcm {
  rate: number;
  samples: Float64Array;
}

function decodeWav(buf: Buffer): Pcm {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("Not a WAV file");
  let rate = 0;
  let bits = 0;
  let channels = 1;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      const bytes = bits / 8;
      const frames = Math.floor(size / (bytes * channels));
      const samples = new Float64Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const pos = body + (i * channels + c) * bytes;
          sum += bits === 8 ? (buf.readUInt8(pos) - 128) / 128 : buf.readInt16LE(pos) / 32768;
        }
        samples[i] = sum / channels;
      }
      return { rate, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV without data chunk");
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi;
        const xi = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr;
        re[b] = (re[a] ?? 0) - xr;
        im[b] = (im[a] ?? 0) - xi;
        re[a] = (re[a] ?? 0) + xr;
        im[a] = (im[a] ?? 0) + xi;
      }
    }
  }
}

/** A-weighting gain (IEC 61672), used as a rough loudness proxy for mixing. */
function aWeight(f: number): number {
  const f2 = f * f;
  const ra =
    (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra * dbToGain(2);
}

interface Stats {
  name: string;
  ms: number;
  peakDb: number;
  rmsDb: number;
  dc: number;
  head: number;
  tail: number;
  centroid: number;
  hf: number;
  loudness: number;
  bytes: number;
}

function analyse(name: string, file: Buffer): Stats {
  const { rate, samples } = decodeWav(file);
  const n = samples.length;
  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  for (const v of samples) {
    peak = Math.max(peak, Math.abs(v));
    sumSq += v * v;
    sum += v;
  }
  const edge = (from: number) => {
    let max = 0;
    for (let i = from; i < Math.min(n, from + 32); i++) max = Math.max(max, Math.abs(samples[i] ?? 0));
    return Math.round(max * 32768);
  };

  // Spectral centroid, energy share above 4 kHz and the loudest A-weighted frame.
  const size = 1024;
  const hop = 256;
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  const frames: { centroid: number; energy: number; high: number; weighted: number }[] = [];
  for (let start = 0; start < Math.max(1, n - size / 2); start += hop) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (samples[start + i] ?? 0) * (window[i] ?? 0);
    fft(re, im);
    let magSum = 0;
    let fMagSum = 0;
    let energy = 0;
    let high = 0;
    let weighted = 0;
    for (let k = 1; k < size / 2; k++) {
      const f = (k * rate) / size;
      const power = (re[k] ?? 0) ** 2 + (im[k] ?? 0) ** 2;
      const mag = Math.sqrt(power);
      magSum += mag;
      fMagSum += f * mag;
      energy += power;
      if (f > 4000) high += power;
      weighted += power * aWeight(f) ** 2;
    }
    frames.push({ centroid: magSum > 0 ? fMagSum / magSum : 0, energy, high, weighted });
  }
  const maxEnergy = Math.max(...frames.map((f) => f.energy));
  const loud = frames.filter((f) => f.energy > maxEnergy * 1e-4);
  const totalEnergy = loud.reduce((s, f) => s + f.energy, 0);
  const centroid = loud.reduce((s, f) => s + f.centroid * f.energy, 0) / totalEnergy;
  const hf = loud.reduce((s, f) => s + f.high, 0) / totalEnergy;
  // Normalise the frame power by the window energy so that a full-scale sine reads ≈ -3 dB.
  const windowPower = window.reduce((s, w) => s + w * w, 0) * (size / 2);
  const loudness = gainToDb(Math.sqrt(Math.max(...frames.map((f) => f.weighted)) / windowPower));

  return {
    name,
    ms: (n / rate) * 1000,
    peakDb: gainToDb(peak),
    rmsDb: gainToDb(Math.sqrt(sumSq / n)),
    dc: sum / n,
    head: edge(0),
    tail: edge(Math.max(0, n - 32)),
    centroid,
    hf: hf * 100,
    loudness,
    bytes: file.length,
  };
}

function printTable(title: string, rows: Stats[]): void {
  const header = [
    "file",
    "ms",
    "peak dB",
    "rms dB",
    "DC",
    "first32",
    "last32",
    "centroid Hz",
    ">4k %",
    "loud(A) dB",
    "bytes",
  ];
  const lines = rows.map((s) => [
    s.name,
    s.ms.toFixed(0),
    s.peakDb.toFixed(1),
    s.rmsDb.toFixed(1),
    s.dc.toExponential(1),
    String(s.head),
    String(s.tail),
    s.centroid.toFixed(0),
    s.hf.toFixed(1),
    s.loudness.toFixed(1),
    String(s.bytes),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => (l[i] ?? "").length)));
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join("  ");
  console.log(`\n${title}`);
  console.log(fmt(header));
  for (const line of lines) console.log(fmt(line));
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  const meanCentroid = rows.reduce((s, r) => s + r.centroid, 0) / Math.max(1, rows.length);
  console.log(`total ${(total / 1024).toFixed(1)} KB · mean centroid ${meanCentroid.toFixed(0)} Hz`);
}

function wavFiles(paths: string[]): string[] {
  return paths.flatMap((p) =>
    statSync(p).isDirectory()
      ? readdirSync(p)
          .filter((f) => f.endsWith(".wav"))
          .sort()
          .map((f) => join(p, f))
      : [p],
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === "--analyze") {
    const files = wavFiles(args.length > 1 ? args.slice(1) : [OUT_DIR]);
    printTable(
      "Analysis",
      files.map((f) => analyse(basename(f), readFileSync(f))),
    );
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const rendered = Object.entries(RENDER).map(([name, render]) => ({ name, samples: render() }));
  const stats: Stats[] = [];
  for (const { name, samples } of rendered) {
    const file = HALF_RATE.has(name) ? encodeWav(halve(samples), RATE / 2) : encodeWav(samples);
    writeFileSync(join(OUT_DIR, `${name}.wav`), file);
    stats.push(analyse(`${name}.wav`, file));
  }
  // Remove sounds that are no longer generated.
  const keep = new Set(rendered.map((r) => `${r.name}.wav`));
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith(".wav") && !keep.has(f)) {
      unlinkSync(join(OUT_DIR, f));
      console.log(`removed ${f}`);
    }
  }
  printTable("Rendered to public/sounds", stats);

  const preview = args.find((a) => a.startsWith("--preview="))?.slice("--preview=".length);
  if (preview) {
    const gap = new Float64Array(Math.round(0.35 * RATE));
    const parts = rendered.flatMap((r) => [r.samples, gap]);
    const all = new Float64Array(parts.reduce((s, p) => s + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      all.set(p, offset);
      offset += p.length;
    }
    writeFileSync(preview, encodeWav(all));
    console.log(`preview → ${preview}`);
  }
}

main();
