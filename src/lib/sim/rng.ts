/**
 * Seedable PRNG (mulberry32) with deterministic sub-streams.
 *
 * `createRng(seed).derive(tick, securityId)` always yields the same stream for the
 * same (seed, tick, securityId), independent of the order in which securities are
 * processed or how many numbers other streams consumed. That makes ticks
 * reproducible and lets a client replay a tick for previews.
 */
import type { Rng } from "./types.ts";

const UINT32 = 4294967296;

/** FNV-1a style mixing of a 32 bit state with one more part. */
function mix(state: number, part: number | string): number {
  let h = state >>> 0;
  const text = typeof part === "number" ? `n:${part}` : `s:${part}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Final avalanche (murmur3 fmix32) so that similar inputs give unrelated seeds.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hashes a seed and any number of parts into a 32 bit seed. */
export function hashSeed(seed: number, ...parts: readonly (number | string)[]): number {
  let h = mix(0x811c9dc5, seed);
  for (const part of parts) h = mix(h, part);
  return h;
}

export function createRng(seed: number): Rng {
  const rootSeed = hashSeed(seed);
  let a = rootSeed;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };

  const rng: Rng = {
    next,
    range(min, max) {
      return min + (max - min) * next();
    },
    int(min, max) {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi < lo) throw new RangeError(`int(${min}, ${max}): empty range`);
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    normal(mean = 0, stdDev = 1) {
      // Box-Muller. 1 - next() is in (0, 1], so the logarithm is finite.
      const u = 1 - next();
      const v = next();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return mean + stdDev * z;
    },
    chance(p) {
      return next() < p;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError("pick(): empty array");
      return items[Math.floor(next() * items.length)] as T;
    },
    derive(...parts) {
      // Depends on the root seed only, never on the consumed state `a`.
      return createRng(hashSeed(rootSeed, ...parts));
    },
  };
  return rng;
}

/** Sub-stream for one security in one tick (ADR-012). */
export function deriveTickRng(seed: number, tick: number, securityId: string): Rng {
  return createRng(seed).derive("tick", tick, securityId);
}
