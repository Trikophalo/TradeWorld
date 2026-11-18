import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { drawMissions, drawTier, drawWeight, type DrawContext, type DrawTemplate } from "./mission-draw.ts";
import { createRng } from "./rng.ts";

const rules = BALANCE.progression.missionDraw;
const HOUR = 3_600_000;

const pool: DrawTemplate[] = Array.from({ length: 30 }, (_, i) => ({
  key: `q_${i}`,
  metric: `metric_${i % 15}`,
  weight: 40 + (i % 5) * 20,
  feature: i % 3 === 0,
  fromLevel: i % 3 === 0 ? 10 : 1,
}));

const empty = (nowMs = 0): DrawContext => ({
  level: 12,
  nowMs,
  history: [],
  openKeys: new Set(),
  openMetrics: new Set(),
});

describe("mission draw (ADR-202)", () => {
  it("ranks fresh templates first, then the cooldown, then the last draws", () => {
    const t = pool[0]!;
    const ctx = empty(100 * HOUR);
    expect(drawTier(t, "quick", ctx, rules)).toBe(0);
    expect(drawTier(t, "quick", { ...ctx, openMetrics: new Set([t.metric]) }, rules)).toBe(1);
    // drawn 30 hours ago, then 12 other draws: only the cooldown of 48 hours is left
    const later = [{ key: t.key, atMs: 70 * HOUR }, ...pool.slice(1, 13).map((p) => ({ key: p.key, atMs: 80 * HOUR }))];
    expect(drawTier(t, "quick", { ...ctx, history: later }, rules)).toBe(2);
    // among the last 12 draws
    expect(drawTier(t, "quick", { ...ctx, history: [{ key: t.key, atMs: 10 * HOUR }] }, rules)).toBe(4);
    // old enough and long ago
    const old = [{ key: t.key, atMs: 0 }, ...pool.slice(1, 13).map((p) => ({ key: p.key, atMs: HOUR }))];
    expect(drawTier(t, "quick", { ...ctx, history: old }, rules)).toBe(0);
  });

  it("weighs feature missions up, new features most", () => {
    const plain = pool[1]!;
    const feature = { ...pool[0]!, weight: plain.weight };
    expect(drawWeight(feature, 30, rules)).toBeCloseTo((plain.weight * rules.featureWeightBps) / 10_000);
    expect(drawWeight(feature, 12, rules)).toBeCloseTo(
      (plain.weight * rules.featureWeightBps * rules.newFeatureWeightBps) / 1e8,
    );
    expect(drawWeight(plain, 12, rules)).toBe(plain.weight);
  });

  it("never repeats a template within the last draws over many rounds while the pool is big enough", () => {
    const rng = createRng(202);
    let history: { key: string; atMs: number }[] = [];
    for (let round = 0; round < 100; round++) {
      const picks = drawMissions(pool, 3, "quick", { ...empty(round * HOUR), history }, rules, () => rng.next());
      expect(picks).toHaveLength(3);
      history = [...history, ...picks.map((p) => ({ key: p.key, atMs: round * HOUR }))];
    }
    for (let i = 0; i < history.length; i++) {
      const window = history.slice(Math.max(0, i - rules.recentDraws.quick), i).map((h) => h.key);
      expect(window, `draw ${i}`).not.toContain(history[i]!.key);
    }
  });

  it("still fills the slots when the pool is tiny (no soft-lock)", () => {
    const small = pool.slice(0, 2);
    const picks = drawMissions(
      small,
      3,
      "daily",
      { ...empty(), history: small.map((p) => ({ key: p.key, atMs: 0 })) },
      rules,
      () => 0.5,
    );
    expect(picks.map((p) => p.key).sort()).toEqual(["q_0", "q_1"]);
  });

  it("never draws an open template", () => {
    const picks = drawMissions(
      pool.slice(0, 4),
      4,
      "weekly",
      { ...empty(), openKeys: new Set(["q_0", "q_1"]) },
      rules,
      () => 0.3,
    );
    expect(picks.map((p) => p.key).sort()).toEqual(["q_2", "q_3"]);
  });
});
