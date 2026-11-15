import { AVATAR_ART } from "@/components/pixel/avatars";
import { ACCESSORIES, ACCESSORY_SLOTS } from "@/config/accessories";
import { BALANCE } from "@/config/balance";
import type { NewsShowAudienceMember, NewsShowChatMessage } from "@/features/game/types";

/*
 * The studio audience of NEXA Nachrichten (ADR-157), as pure functions: who stands on the stage (the players the
 * server sends, plus the made-up chat viewers while they write, each with a figure seeded by the name) and which
 * speech bubbles are up at a given moment (a few at once, the rest wait their turn, a new line of the same person
 * replaces the old one). Everything follows from the chat and the server clock, so every viewer sees the same.
 */

export type AudienceRules = Record<Exclude<keyof typeof BALANCE.newsShow.audience, "botsOnStage">, number> & {
  botsOnStage: boolean;
};

const RULES: AudienceRules = BALANCE.newsShow.audience;

export interface StageFigure {
  nickname: string;
  avatarKey: string | null;
  accessories: string[];
  me: boolean;
  friend: boolean;
  bot: boolean;
}

export interface Stage {
  figures: StageFigure[];
  /** Watching but not on the stage ("+N"). */
  hidden: number;
  /** Made-up viewers in the audience right now (they count as watching). */
  bots: number;
}

export interface Bubble {
  id: number;
  nickname: string;
  body: string;
  /** ms epoch (server clock) the bubble went up and comes down. */
  from: number;
  until: number;
  /** Height step above the figures, 0 lowest: bubbles up at the same time never share one. */
  lane: number;
}

/** A small stable hash (FNV-1a), so the same name always looks the same. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A tiny seeded generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const BOT_AVATARS = Object.keys(AVATAR_ART).filter((key) => key !== "finn_fan");

/**
 * The look of a made-up viewer: a portrait and up to `botAccessoriesMax` accessories from the catalogue (one per
 * slot), always the same for the same name.
 */
export function botFigure(
  name: string,
  rules: Pick<AudienceRules, "botAccessoriesMax"> = RULES,
): { avatarKey: string; accessories: string[] } {
  const random = seeded(hash(name));
  const avatarKey = BOT_AVATARS[Math.floor(random() * BOT_AVATARS.length)] ?? "rookie";
  const count = Math.floor(random() * (rules.botAccessoriesMax + 1));
  // Fisher-Yates (a random comparator in sort() is not the same in every engine: server and browser would differ)
  const slots: string[] = [...ACCESSORY_SLOTS];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  slots.length = Math.min(slots.length, count);
  const accessories = slots.flatMap((slot) => {
    const items = ACCESSORIES.filter((item) => item.slot === slot);
    const pick = items[Math.floor(random() * items.length)];
    return pick ? [pick.key] : [];
  });
  return { avatarKey, accessories };
}

/**
 * Who stands on the stage: me, friends, the other players (as the server sends them), then (only with `botsOnStage`)
 * the made-up viewers who wrote within `botMinutes`, in the order they first spoke, so nobody jumps around. At most `max` figures.
 */
export function stageAudience(
  audience: readonly NewsShowAudienceMember[],
  chat: readonly NewsShowChatMessage[],
  viewers: number,
  now: number,
  rules: Pick<AudienceRules, "max" | "botMinutes" | "botAccessoriesMax" | "botsOnStage"> = RULES,
): Stage {
  const players: StageFigure[] = audience.map((a) => ({
    nickname: a.nickname,
    avatarKey: a.avatarKey,
    accessories: a.accessories,
    me: a.me,
    friend: a.friend && !a.me,
    bot: false,
  }));
  const taken = new Set(players.map((p) => p.nickname));
  const since = now - rules.botMinutes * 60_000;
  const bots: StageFigure[] = [];
  for (const m of [...chat].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id)) {
    const at = Date.parse(m.at);
    if (!rules.botsOnStage || !m.bot || taken.has(m.nickname) || at < since || at > now) continue;
    taken.add(m.nickname);
    bots.push({ nickname: m.nickname, ...botFigure(m.nickname, rules), me: false, friend: false, bot: true });
  }
  const everyone = [...players, ...bots];
  const figures = everyone.slice(0, Math.max(1, rules.max));
  // players the server did not send (beyond its cap) and whoever did not fit on the stage
  const hidden = Math.max(0, viewers - players.length) + everyone.length - figures.length;
  return { figures, hidden, bots: bots.length };
}

/**
 * The speech bubbles up at `now`: lines of people on the stage, each `bubbleSeconds` long. At most `bubblesAtOnce`
 * at a time; a line waits for a free place, but not longer than `bubbleMaxDelaySeconds` (then only the chat has
 * it). A new line of someone who still has a bubble replaces it at once. Each bubble keeps the lowest height step
 * (`lane`) that was free when it went up. Oldest first.
 */
export function bubblesAt(
  chat: readonly NewsShowChatMessage[],
  onStage: ReadonlySet<string>,
  now: number,
  rules: Pick<AudienceRules, "bubbleSeconds" | "bubblesAtOnce" | "bubbleMaxDelaySeconds"> = RULES,
): Bubble[] {
  const length = rules.bubbleSeconds * 1000;
  const maxDelay = rules.bubbleMaxDelaySeconds * 1000;
  // Only the last minute or so can still have a bubble; older lines do not change what is up now.
  const window = now - 4 * (length + maxDelay);
  const lines = chat
    .filter((m) => onStage.has(m.nickname))
    .map((m) => ({ m, at: Date.parse(m.at) }))
    .filter(({ at }) => at >= window && at <= now)
    .sort((a, b) => a.at - b.at || a.m.id - b.m.id);
  const placed: Bubble[] = [];
  for (const { m, at } of lines) {
    // the same person: the old bubble makes room right away
    const own = placed.find((b) => b.nickname === m.nickname && b.until > at);
    if (own) own.until = Math.max(own.from, at);
    const busy = placed.filter((b) => b.until > at).map((b) => b.until);
    let from = at;
    if (busy.length >= rules.bubblesAtOnce) {
      busy.sort((a, b) => a - b);
      from = busy[busy.length - rules.bubblesAtOnce]!;
    }
    if (from - at > maxDelay) continue;
    const used = new Set(placed.filter((b) => b.from <= from && b.until > from).map((b) => b.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    placed.push({ id: m.id, nickname: m.nickname, body: m.body, from, until: from + length, lane });
  }
  return placed.filter((b) => b.from <= now && now < b.until);
}
