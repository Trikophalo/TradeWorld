/**
 * The battle hash (ADR-160): every random event of a battle is a pure function of (seed, a, b), so the database can
 * compute the same numbers without sharing a random stream (public.battle_hash in SQL). 32-bit "lowbias32" mixing;
 * the multiplication modulo 2^32 is exact in JavaScript (Math.imul) and in SQL (split into 16-bit halves).
 */

/** a * b modulo 2^32, unsigned. */
export function mul32(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

/** lowbias32 by Chris Wellons: an unsigned 32-bit integer to an unrelated unsigned 32-bit integer. */
export function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** The hash of a battle seed (0 .. 2^32 - 1) and two non-negative integers. */
export function battleHash(seed: number, a: number, b: number): number {
  const first = mix32((seed + mul32(a, 0x9e3779b1) + 0x6a09e667) >>> 0);
  return mix32((first + mul32(b, 0x85ebca77)) >>> 0);
}

/** 0 .. n - 1 from the hash. */
export function battleInt(seed: number, a: number, b: number, n: number): number {
  return battleHash(seed, a, b) % n;
}
