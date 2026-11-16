/**
 * NEXA Nachrichten (ADR-150): the timeline of a show and the Mini-KI's construction kit for its scripts.
 * The database runs the same rules (supabase/migrations/20261204002000_news_show.sql); the demo and the UI use these.
 * Pure: time and randomness come in.
 */
import { NEWS_SHOW_RULES, type NewsShowTextKey } from "../../config/news-show.ts";

type Rules = typeof NEWS_SHOW_RULES;
const HOUR = 3_600_000;

/** The full hour a show is scheduled for: the one that started at most waitMinutes ago, else the next one. */
export function showSlot(nowMs: number, rules: Rules = NEWS_SHOW_RULES): number {
  const hour = Math.floor(nowMs / HOUR) * HOUR;
  return nowMs - hour < rules.waitMinutes * 60_000 ? hour : hour + HOUR;
}

/** The next full hour after now (for the countdown once this hour's show is over or cancelled). */
export const nextShowAt = (nowMs: number): number => (Math.floor(nowMs / HOUR) + 1) * HOUR;

export function showDurationMs(segments: number, rules: Rules = NEWS_SHOW_RULES): number {
  return (rules.introSeconds + Math.max(0, segments) * rules.segmentSeconds + rules.outroSeconds) * 1000;
}

export type ShowPhase =
  | { mode: "intro"; elapsedMs: number }
  | { mode: "live"; segmentIndex: number; elapsedMs: number }
  | { mode: "outro"; elapsedMs: number }
  | { mode: "over" };

/** Where a show that started at `startedAtMs` is at `nowMs`: every viewer computes the same, so all see the same. */
export function showPhase(
  nowMs: number,
  startedAtMs: number,
  segments: number,
  rules: Rules = NEWS_SHOW_RULES,
): ShowPhase {
  const t = Math.max(0, nowMs - startedAtMs);
  const intro = rules.introSeconds * 1000;
  const seg = rules.segmentSeconds * 1000;
  if (t < intro) return { mode: "intro", elapsedMs: t };
  const index = Math.floor((t - intro) / seg);
  if (index < segments) return { mode: "live", segmentIndex: index, elapsedMs: t - intro - index * seg };
  const outro = t - intro - segments * seg;
  return outro < rules.outroSeconds * 1000 ? { mode: "outro", elapsedMs: outro } : { mode: "over" };
}

/** Replaces {placeholders}; unknown ones stay as they are. */
export function fillScript(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? String(values[key]) : all));
}

export interface ScriptPick {
  /** "<kind>:<frame>:<reason>", remembered so the same combination does not come back soon. */
  key: string;
  headline: string;
  text: string;
}

/**
 * Picks a frame and a reason for a kind: the combination used longest ago (never used first), among those the reason
 * used longest ago, then by chance. `used` lists remembered keys, oldest first (also "r:<kind>:<reason>" entries).
 */
export function pickScript(
  kind: NewsShowTextKey,
  used: readonly string[],
  rng: () => number,
  rules: Rules = NEWS_SHOW_RULES,
): ScriptPick {
  const kit = rules.texts[kind];
  const age = (key: string) => {
    const i = used.lastIndexOf(key);
    return i < 0 ? -1 : i; // -1 = never used, best
  };
  let best: { f: number; r: number; combo: number; reason: number; tie: number } | null = null;
  for (let f = 0; f < kit.frames.length; f++) {
    for (let r = 0; r < kit.reasons.length; r++) {
      const c = { f, r, combo: age(`${kind}:${f}:${r}`), reason: age(`r:${kind}:${r}`), tie: rng() };
      if (
        !best ||
        c.combo < best.combo ||
        (c.combo === best.combo && (c.reason < best.reason || (c.reason === best.reason && c.tie < best.tie)))
      )
        best = c;
    }
  }
  const pick = best!;
  const frame = kit.frames[pick.f]!;
  const reason = kit.reasons[pick.r]!;
  return {
    key: `${kind}:${pick.f}:${pick.r}`,
    headline: frame.headline,
    text: frame.text.replace("{reason}", reason),
  };
}

/** The keys to remember after a pick. */
export function usedKeys(pick: ScriptPick): string[] {
  const [kind, , reason] = pick.key.split(":");
  return [pick.key, `r:${kind}:${reason}`];
}

/** "12,4 %" from basis points, always positive (the direction is in the text). */
export function movePercent(bps: number): string {
  return `${(Math.abs(bps) / 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
}

/** The {placeholders} in a text, each once, in order of appearance. */
export function scriptPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];
}

/** Something a topic could tell right now (ADR-169). */
export interface TopicCandidate {
  /** Key of the topic in newsShow.topics.list (and of its script). */
  topic: string;
  /** The player it is about, if any: a show tells one story per player. */
  player?: string | null;
}

/**
 * The topics of a show (ADR-169), the same draw as news_show_topics() in the database: `topics.count` times the best
 * candidate left, where best means (1) its topic did not run in the last show, (2) its group has the fewest stories
 * in this show so far, (3) the weighted lot (-ln(u) / weight, smallest first). One story per topic and per player;
 * players in `seen` already have a story in this show. Topics that are not in the list or weigh nothing never come.
 */
export function pickTopics<T extends TopicCandidate>(
  candidates: readonly T[],
  lastTopics: readonly string[],
  rng: () => number,
  rules: Rules = NEWS_SHOW_RULES,
  seen: readonly string[] = [],
): T[] {
  const list = rules.topics.list as Readonly<Record<string, { group: string; weight: number } | undefined>>;
  const picks: T[] = [];
  const players = new Set(seen);
  const groups = new Map<string, number>();
  const pool = candidates.filter((c) => (list[c.topic]?.weight ?? 0) > 0).map((c) => ({ c, lot: rng() }));
  while (picks.length < rules.topics.count) {
    let best: { c: T; rank: [number, number, number] } | null = null;
    for (const { c, lot } of pool) {
      if (picks.some((p) => p.topic === c.topic) || (c.player != null && players.has(c.player))) continue;
      const entry = list[c.topic]!;
      const rank: [number, number, number] = [
        lastTopics.includes(c.topic) ? 1 : 0,
        groups.get(entry.group) ?? 0,
        -Math.log(Math.max(lot, 1e-9)) / entry.weight,
      ];
      if (
        !best ||
        rank[0] < best.rank[0] ||
        (rank[0] === best.rank[0] && (rank[1] < best.rank[1] || (rank[1] === best.rank[1] && rank[2] < best.rank[2])))
      )
        best = { c, rank };
    }
    if (!best) break;
    picks.push(best.c);
    if (best.c.player != null) players.add(best.c.player);
    const group = list[best.c.topic]!.group;
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  return picks;
}
