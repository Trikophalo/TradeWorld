/*
 * NEXA Nachrichten, season three (ADR-210): the made-up viewers react to the segment that is on air. Per segment a
 * few lines from the pool of its topic (or of its kind), at most one poll per show with a handful of votes, and an
 * emote storm after a big pull. Lines that aired in the last shows (`recent`) are left out while the pool has others.
 * Mirrored by news_show_fresh_chat() in Postgres; the demo calls this. Pure: chance comes in.
 */
import type { NEWS_FRESH } from "../../config/news-fresh.ts";
import { fillScript } from "./news-show.ts";

type ChatRules = (typeof NEWS_FRESH)["chat"];

export interface FreshChatSegment {
  kind: string;
  /** The topic key of a topic segment (ADR-169), else null. */
  topic?: string | null;
  values: Readonly<Record<string, string | number>>;
}

export interface FreshChatLine {
  name: string;
  body: string;
  /** Seconds after the show started. */
  atSeconds: number;
  type: "line" | "poll" | "vote" | "emote";
  /** The template the line came from (remembered to avoid repeats), null for votes and emotes. */
  template: string | null;
}

export interface FreshChatOptions {
  introSeconds: number;
  segmentSeconds: number;
  /** Everyday names of the made-up viewers. */
  names: readonly string[];
  random: () => number;
  /** Templates that aired in the last shows. */
  recent?: ReadonlySet<string>;
}

/** The pool a segment draws from: its topic first, else its kind. */
export function chatPool(rules: ChatRules, segment: FreshChatSegment): readonly string[] {
  const topics = rules.topics as Readonly<Record<string, readonly string[]>>;
  const kinds = rules.kinds as Readonly<Record<string, readonly string[]>>;
  return (segment.topic ? topics[segment.topic] : undefined) ?? kinds[segment.kind] ?? [];
}

/** A template filled with the values of the segment, or null when a placeholder is left over. */
export function fillChatLine(template: string, values: Readonly<Record<string, string | number>>): string | null {
  const body = fillScript(template, values);
  return /\{\w+\}/.test(body) ? null : body;
}

export function freshChatLines(
  segments: readonly FreshChatSegment[],
  rules: ChatRules,
  options: FreshChatOptions,
): FreshChatLine[] {
  const { introSeconds, segmentSeconds, names, random } = options;
  const recent = options.recent ?? new Set<string>();
  if (names.length === 0) return [];
  const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  const span = Math.max(1, segmentSeconds - 4);
  const out: FreshChatLine[] = [];
  const taken = new Set<string>();
  let lines = 0;

  segments.forEach((segment, index) => {
    const start = introSeconds + index * segmentSeconds;
    // the topic-aware lines: not what aired lately while there is something else, never twice in a show
    const pool = chatPool(rules, segment).filter((t) => !taken.has(t) && fillChatLine(t, segment.values) !== null);
    const fresh = pool.filter((t) => !recent.has(t));
    const source = [...(fresh.length > 0 ? fresh : pool)];
    for (let n = 0; n < rules.perSegment && lines < rules.maxPerShow && source.length > 0; n++) {
      const template = source.splice(Math.floor(random() * source.length), 1)[0]!;
      taken.add(template);
      lines += 1;
      out.push({
        name: pick(names),
        body: fillChatLine(template, segment.values)!,
        atSeconds: Math.round(start + 2 + random() * span),
        type: "line",
        template,
      });
    }
    // an emote storm after a big pull
    const burst = rules.burst;
    const key = segment.topic ?? segment.kind;
    if ((burst.on as readonly string[]).includes(key)) {
      const count = between(burst.countMin, burst.countMax);
      for (let n = 0; n < count; n++)
        out.push({
          name: pick(names),
          body: pick(burst.emotes),
          atSeconds: Math.round(start + 3 + random() * burst.seconds),
          type: "emote",
          template: null,
        });
    }
  });

  // at most one poll per show, on a segment it fits
  const polls = rules.polls;
  if (random() * 10_000 < polls.chanceBps) {
    const options2 = segments.flatMap((segment, index) =>
      polls.list
        .filter((poll) => (poll.on as readonly string[]).includes(segment.topic ?? segment.kind))
        .filter((poll) => !recent.has(poll.question))
        .map((poll) => ({ poll, index, question: fillChatLine(poll.question, segment.values) }))
        .filter((o): o is typeof o & { question: string } => o.question !== null),
    );
    if (options2.length > 0) {
      const { poll, index, question } = pick(options2);
      const start = introSeconds + index * segmentSeconds;
      out.push({ name: polls.host, body: question, atSeconds: start + 4, type: "poll", template: poll.question });
      const votes = between(polls.votesMin, polls.votesMax);
      for (let n = 0; n < votes; n++)
        out.push({
          name: pick(names),
          body: pick(polls.votes),
          atSeconds: Math.round(start + 6 + random() * Math.max(1, segmentSeconds - 8)),
          type: "vote",
          template: null,
        });
    }
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds);
}
