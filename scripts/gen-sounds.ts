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
  x = x.map((v) => v * (target / peakOf(x)));

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

function encodeWav(x: Float64Array): Buffer {
  const out = Buffer.alloc(44 + x.length * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + x.length * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28); // byte rate
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
};

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
    const file = encodeWav(samples);
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
