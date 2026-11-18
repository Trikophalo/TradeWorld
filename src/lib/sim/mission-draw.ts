/**
 * Mission draw (ADR-202): which quick, daily or weekly mission comes next.
 *
 * The server does the same in SQL (public.missions_assign); the offline demo uses this module. Only templates the
 * player can do right now are handed in (level, unlock, requirement, money: the caller filters). Among them:
 *
 * - tier 0: not among the last `recentDraws` draws of the kind, not drawn within `cooldownHours`, and no open
 *   mission counts the same metric;
 * - +1 when an open mission counts the same metric, +2 within the cooldown, +4 among the last draws.
 *
 * The lowest tier wins, so a template only repeats when nothing fresher is doable and the slots always fill. Within a
 * tier the draw is weighted (Efraimidis-Spirakis): weight × featureWeight for missions of an unlocked feature,
 * × newFeatureWeight when that feature came within the last `newFeatureLevels` levels. Randomness is passed in.
 */
import type { ProgressionConfig } from "../../config/balance.ts";

export type DrawKind = "quick" | "daily" | "weekly";

export interface DrawTemplate {
  readonly key: string;
  readonly metric: string;
  readonly weight: number;
  /** Tied to a feature (an unlock or a requirement such as a company or a job). */
  readonly feature: boolean;
  /** Level from which the template is available (its unlock or minimum level). */
  readonly fromLevel: number;
}

export interface DrawContext {
  readonly level: number;
  readonly nowMs: number;
  /** Earlier draws of this kind, oldest first (time of the draw in ms). */
  readonly history: readonly { readonly key: string; readonly atMs: number }[];
  /** Templates that are open right now: never drawn again. */
  readonly openKeys: ReadonlySet<string>;
  /** Metrics the open missions count. */
  readonly openMetrics: ReadonlySet<string>;
}

type DrawRules = ProgressionConfig["missionDraw"];

const HOUR_MS = 3_600_000;

/** Tier of a template (lower is better); see the module comment. */
export function drawTier(template: DrawTemplate, kind: DrawKind, ctx: DrawContext, rules: DrawRules): number {
  const recent = ctx.history.slice(Math.max(0, ctx.history.length - rules.recentDraws[kind]));
  let tier = ctx.openMetrics.has(template.metric) ? 1 : 0;
  if (recent.some((h) => h.key === template.key)) tier += 4;
  else if (ctx.history.some((h) => h.key === template.key && h.atMs > ctx.nowMs - rules.cooldownHours[kind] * HOUR_MS))
    tier += 2;
  return tier;
}

/** Weight of a template in the draw. */
export function drawWeight(template: DrawTemplate, level: number, rules: DrawRules): number {
  let weight = Math.max(1, template.weight);
  if (template.feature) weight *= rules.featureWeightBps / 10_000;
  if (template.fromLevel > 1 && template.fromLevel > level - rules.newFeatureLevels)
    weight *= rules.newFeatureWeightBps / 10_000;
  return weight;
}

/**
 * Draws up to `count` templates one after the other (each pick counts as open for the next one). `random` returns
 * uniform numbers in [0, 1).
 */
export function drawMissions<T extends DrawTemplate>(
  pool: readonly T[],
  count: number,
  kind: DrawKind,
  ctx: DrawContext,
  rules: DrawRules,
  random: () => number,
): T[] {
  const picks: T[] = [];
  const openKeys = new Set(ctx.openKeys);
  const openMetrics = new Set(ctx.openMetrics);
  const history = [...ctx.history];
  for (let i = 0; i < count; i++) {
    const now: DrawContext = { ...ctx, history, openKeys, openMetrics };
    let best: { template: T; tier: number; key: number } | null = null;
    for (const template of pool) {
      if (openKeys.has(template.key)) continue;
      const tier = drawTier(template, kind, now, rules);
      const key = -Math.log(1 - random()) / drawWeight(template, ctx.level, rules);
      if (!best || tier < best.tier || (tier === best.tier && key < best.key)) best = { template, tier, key };
    }
    if (!best) break;
    picks.push(best.template);
    openKeys.add(best.template.key);
    openMetrics.add(best.template.metric);
    history.push({ key: best.template.key, atMs: ctx.nowMs });
  }
  return picks;
}
