import { describe, expect, it } from "vitest";
import { createRng, deriveTickRng, hashSeed } from "./rng.ts";

describe("rng", () => {
  it("is deterministic for a seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("differs between seeds", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it("produces uniform values in [0, 1)", () => {
    const rng = createRng(7);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 20_000).toBeCloseTo(0.5, 1);
  });

  it("produces normal values with the requested moments", () => {
    const rng = createRng(11);
    const n = 40_000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.normal(2, 3);
      expect(Number.isFinite(v)).toBe(true);
      sum += v;
      sq += v * v;
    }
    const mean = sum / n;
    expect(mean).toBeCloseTo(2, 1);
    expect(Math.sqrt(sq / n - mean * mean)).toBeCloseTo(3, 1);
  });

  it("chance() respects the probability", () => {
    const rng = createRng(3);
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (rng.chance(0.25)) hits++;
    expect(hits / 20_000).toBeCloseTo(0.25, 1);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
  });

  it("int() and range() stay inside their bounds", () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      const v = rng.int(1, 6);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v);
      const r = rng.range(-2, 2);
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThan(2);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(() => rng.int(3, 2)).toThrow(RangeError);
  });

  it("pick() returns an element and rejects empty arrays", () => {
    const rng = createRng(9);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it("derives sub-streams that do not depend on consumption", () => {
    const fresh = createRng(99);
    const used = createRng(99);
    for (let i = 0; i < 17; i++) used.next();
    expect(used.derive(5, "KLS").next()).toBe(fresh.derive(5, "KLS").next());
  });

  it("derives different streams for different parts", () => {
    const rng = createRng(99);
    const values = new Set([
      rng.derive(5, "KLS").next(),
      rng.derive(6, "KLS").next(),
      rng.derive(5, "VLT").next(),
      rng.derive("5", "KLS").next(),
    ]);
    expect(values.size).toBe(4);
  });

  it("deriveTickRng is a pure function of (seed, tick, security)", () => {
    expect(deriveTickRng(1, 2, "BRZ").next()).toBe(deriveTickRng(1, 2, "BRZ").next());
    expect(deriveTickRng(1, 2, "BRZ").next()).not.toBe(deriveTickRng(1, 3, "BRZ").next());
    expect(hashSeed(1, "a", 2)).toBe(hashSeed(1, "a", 2));
    expect(hashSeed(1, "a", 2)).not.toBe(hashSeed(1, 2, "a"));
  });
});
