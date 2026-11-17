/**
 * Running gags of NEXA Nachrichten (ADR-179): which company a gag is about, which host line runs and what the
 * made-up viewers write. The database does the same in news_show_running_gags() and news_show_gag_chat()
 * (migration 20261204006800); the demo and /dev/ui use these. Pure: randomness comes in.
 */
import type { RunningGagConfig, RunningGagLine } from "../../config/running-gags.ts";

const DAY = 86_400_000;

/** SQL ILIKE on a name: % is any text, _ any single character, case does not matter. */
export function matchesNamePattern(name: string, pattern: string): boolean {
  const source = pattern
    .split("")
    .map((ch) => (ch === "%" ? ".*" : ch === "_" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}$`, "is").test(name);
}

/** "Tag X ohne Bohrung": the founding day is day 1. */
export const gagDays = (foundedAtMs: number, nowMs: number): number =>
  Math.max(1, Math.floor((nowMs - foundedAtMs) / DAY) + 1);

/** Lines an episode may use: the first escalateStart + episode × escalatePerEpisode (the later ones are wilder). */
export function gagLinePool(
  cfg: Pick<RunningGagConfig, "escalateStart" | "escalatePerEpisode">,
  total: number,
  episode: number,
) {
  return Math.max(1, Math.min(total, cfg.escalateStart + Math.max(0, episode) * cfg.escalatePerEpisode));
}

/** A random index below `size` that is not `last` (when there is a choice). */
export function pickIndex(size: number, last: number | null, random: () => number): number {
  if (size <= 1) return 0;
  if (last === null || last < 0 || last >= size) return Math.min(size - 1, Math.floor(random() * size));
  const i = Math.min(size - 2, Math.floor(random() * (size - 1)));
  return i >= last ? i + 1 : i;
}

/** Replaces {placeholders}; unknown ones stay as they are. */
const fill = (template: string, values: Readonly<Record<string, string | number>>) =>
  template.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? String(values[key]) : all));

export interface GagFacts {
  company: string;
  founder: string;
  days: number;
  /** This segment's episode (aired ones before + 1). */
  episode: number;
  /** Line of the last aired episode, so it does not come twice in a row. */
  lastLine: number | null;
  phase?: "private" | "ipo" | "listed";
}

export interface GagSegment {
  kind: "gag";
  mood: RunningGagLine["mood"];
  headline: string;
  text: string;
  line: number;
  values: Record<string, string | number>;
}

/** The host's segment: an intro that names the player company and its founder, then a line of the pool. */
export function buildGagSegment(cfg: RunningGagConfig, facts: GagFacts, random: () => number): GagSegment {
  const pick = <T>(list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  const pool = gagLinePool(cfg, cfg.lines.length, facts.episode - 1);
  const line = pickIndex(pool, facts.lastLine, random);
  const values = {
    company: facts.company,
    founder: facts.founder,
    days: facts.days,
    episode: facts.episode,
    when: pick(cfg.whens),
  };
  const extra = facts.phase === "ipo" || facts.phase === "listed" ? cfg.phaseLines[facts.phase] : [];
  const parts = [pick(cfg.intros), cfg.lines[line]!.text, ...(extra.length > 0 ? [pick(extra)] : [])];
  return {
    kind: "gag",
    mood: cfg.lines[line]!.mood,
    headline: fill(pick(cfg.headlines), values),
    text: parts.map((part) => fill(part, values)).join(" "),
    line,
    values,
  };
}

export interface GagChatLine {
  name: string;
  body: string;
  /** Seconds after the segment started (negative: just before). */
  atSeconds: number;
  fan: boolean;
}

/** The chat around a gag segment: annoyed viewers (names from `names`) and the die-hard fans, no line twice. */
export function gagChatLines(
  cfg: RunningGagConfig,
  values: Readonly<Record<string, string | number>>,
  names: readonly string[],
  segmentSeconds: number,
  random: () => number,
): GagChatLine[] {
  const span = cfg.chat.leadSeconds + segmentSeconds + cfg.chat.tailSeconds;
  const take = (list: readonly string[], count: number) => {
    const rest = [...list];
    const out: string[] = [];
    while (out.length < count && rest.length > 0) out.push(rest.splice(Math.floor(random() * rest.length), 1)[0]!);
    return out;
  };
  const pick = (list: readonly string[]) => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  const at = () => Math.round(-cfg.chat.leadSeconds + random() * span);
  const annoyed = names.length === 0 ? [] : take(cfg.chat.annoyed, cfg.chat.annoyedPerSegment);
  const fans = cfg.chat.fanNames.length === 0 ? [] : take(cfg.chat.fans, cfg.chat.fansPerSegment);
  return [
    ...annoyed.map((body) => ({ name: pick(names), body: fill(body, values), atSeconds: at(), fan: false })),
    ...fans.map((body) => ({ name: pick(cfg.chat.fanNames), body: fill(body, values), atSeconds: at(), fan: true })),
  ].sort((a, b) => a.atSeconds - b.atSeconds);
}
