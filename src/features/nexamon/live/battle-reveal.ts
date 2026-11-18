import { NEXAMON_RARITY_RANK, type NexamonRarity } from "@/config/nexamon/types";

/*
 * ADR-205: the last two cards of every pack in a Pack Battle reveal with an effect that escalates with the rarity.
 * Self-contained for the battle view (the pack opening has its own reveal).
 */

/** 0 = no effect, 1 glow, 2 + flash, 3 + shake, 4 + burst. */
export type BattleRevealTier = 0 | 1 | 2 | 3 | 4;

/**
 * How big the reveal of the card in `slot` (1-based within its pack) is: only the last two slots of a pack get one.
 * Glow for any card; a rare adds the flash, an ultra the shake, prisma and up the burst. The very last card of a pack
 * is one step louder (up to the burst).
 */
export function battleRevealTier(rarity: NexamonRarity, slot: number, packSize: number): BattleRevealTier {
  if (slot < packSize - 1 || slot > packSize) return 0;
  const rank = NEXAMON_RARITY_RANK[rarity];
  const base = 1 + (rank >= 1 ? 1 : 0) + (rank >= 2 ? 1 : 0) + (rank >= 3 ? 1 : 0);
  const last = slot === packSize ? 1 : 0;
  return Math.min(4, base + last) as BattleRevealTier;
}

/** The colour token of the glow and the burst per rarity (as a Tailwind background utility). */
export const REVEAL_GLOW: Record<NexamonRarity, string> = {
  common: "bg-fg-3",
  iron: "bg-fg-3",
  rare: "bg-info",
  titanium: "bg-info",
  ultra: "bg-warn",
  prisma: "bg-accent",
  diamond: "bg-accent",
  legendary: "bg-gold",
  one_of_one: "bg-gold",
  uranium: "bg-gain",
};

/** The value counter: what shows `elapsed` ms into a count of `durationMs` up to `cents` (ease-out, whole cents). */
export function revealCountCents(cents: number, elapsed: number, durationMs: number): number {
  if (durationMs <= 0 || elapsed >= durationMs) return cents;
  if (elapsed <= 0) return 0;
  const t = elapsed / durationMs;
  return Math.round(cents * (1 - (1 - t) ** 3));
}
