import type { FloorMember } from "@/features/game/types";

/*
 * Pure helpers for the company floor (ADR-156): which bubble is still up, how long it stays, and a stable rhythm per
 * figure so the office does not move in lockstep.
 */

/** The longest text a bubble shows; the chat has the rest. */
export const BUBBLE_MAX_CHARS = 80;

/** Milliseconds until the bubble of `member` fades, or null if there is none (any more). */
export function bubbleLeftMs(
  member: Pick<FloorMember, "lastMessage">,
  nowMs: number,
  bubbleSeconds: number,
): number | null {
  const message = member.lastMessage;
  if (!message || bubbleSeconds <= 0) return null;
  const at = Date.parse(message.at);
  if (!Number.isFinite(at)) return null;
  // A clock a little ahead of the server: the message is fresh.
  const left = Math.min(at, nowMs) + bubbleSeconds * 1000 - nowMs;
  return left > 0 ? left : null;
}

/** The text in the bubble: trimmed, long messages cut at a word with an ellipsis. */
export function bubbleText(body: string, max = BUBBLE_MAX_CHARS): string {
  const text = body.trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Pseudo-random but stable per name: every figure gets its own rhythm (delay and duration in seconds). */
export function floorRhythm(key: string): { delay: number; duration: number; sway: number } {
  let h = 7;
  for (const ch of key) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return { delay: (h % 1000) / 1000, duration: 1.6 + ((h >> 4) % 900) / 1000, sway: (h >> 8) % 2 === 0 ? 2 : -2 };
}

/** Online first counts: how many of the people are there right now. */
export function onlineCount(members: readonly Pick<FloorMember, "online">[]): number {
  return members.filter((m) => m.online).length;
}
