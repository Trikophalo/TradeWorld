/**
 * NFT chat of the AI collectors (ADR-181): what a player's message means (keyword intents), which line a collector
 * picks (never one of the last lines of the chat), which kind of offer text fits the critic's score, and how far a
 * collector raises an offer when haggled with. The database runs the same rules (nft_intent, nft_line,
 * nft_offer_path, nft_counter_cents in supabase/migrations/20261204007020_nft_talk.sql); the demo uses these.
 */
import { BALANCE } from "../../config/balance.ts";
import type { ArtQualityKey } from "./art-quality.ts";

type NftConfig = typeof BALANCE.nfts;
export type NftIntent = "insult" | "higher" | "lower" | "no" | "yes" | "question" | "other";

/** Lower case, everything but letters and digits as spaces, "?" as its own word, padded with spaces. */
export function normalizeChat(text: string): string {
  const t = text
    .toLowerCase()
    .replace(/\?/g, " ? ")
    .replace(/[^a-z0-9äöüß?]+/g, " ")
    .trim();
  return ` ${t} `;
}

/** The first intent (in intentOrder) with a keyword as a whole word or phrase in the message, else "other". */
export function detectIntent(text: string, cfg: NftConfig = BALANCE.nfts): NftIntent {
  const t = normalizeChat(text);
  const talk = cfg.ai.talk;
  for (const intent of talk.intentOrder) {
    const words: readonly string[] = talk.intents[intent];
    if (words.some((w) => t.includes(` ${w} `))) return intent;
  }
  return "other";
}

/** A line at u in [0, 1), moving on to the next one while it is among the recent lines (no immediate repeats). */
export function pickLine(lines: readonly string[], u: number, recent: readonly string[] = []): string {
  if (lines.length === 0) return "";
  const start = Math.min(lines.length - 1, Math.floor(Math.max(u, 0) * lines.length));
  for (let k = 0; k < lines.length; k++) {
    const line = lines[(start + k) % lines.length]!;
    if (!recent.includes(line)) return line;
  }
  return lines[start]!;
}

/**
 * The text kind of a collector's offer (path below ai.talk.lines): copies and poor art get mocking lines, great art
 * praise or a compliment on its best sub-score, the middle a comment on the weakest or best sub-score or the classic
 * lines (ai.lines.offer, path "offer").
 */
export function nftOfferPath(
  quality: number | null,
  copy: "exact" | "near" | null,
  best: ArtQualityKey | null,
  bestScore: number,
  worst: ArtQualityKey | null,
  worstScore: number,
  u: number,
  cfg: NftConfig = BALANCE.nfts,
): string {
  const q = cfg.ai.quality;
  if (copy) return "copy";
  if (quality === null) return "offer";
  if (quality < q.mockBelow) return "mock";
  if (quality >= q.praiseFrom) return u < 0.5 || !best ? "praise" : `good.${best}`;
  if (u < 1 / 3 && worst && worstScore < q.badBelow) return `bad.${worst}`;
  if (u >= 1 / 3 && u < 2 / 3 && best && bestScore >= q.goodFrom) return `good.${best}`;
  return "offer";
}

/**
 * Haggling: a collector raises an open offer by counterStepBps (down to whole euros), at most to counterCeilingBps
 * of the valuation; null when there is no room left (then the collector says it is the final offer).
 */
export function nftCounterCents(
  previousCents: number,
  valueCents: number,
  cfg: NftConfig = BALANCE.nfts,
): number | null {
  const t = cfg.ai.talk;
  const ceiling = Math.floor((valueCents * t.counterCeilingBps) / 10_000 / 100) * 100;
  const next = Math.min(ceiling, Math.floor((previousCents * (10_000 + t.counterStepBps)) / 10_000 / 100) * 100);
  return next > previousCents ? next : null;
}
