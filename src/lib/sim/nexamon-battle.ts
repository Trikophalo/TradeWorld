/**
 * Pack Battles and live openings (ADR-172): who wins a battle and when each card of the shared reveal shows.
 * The database runs the same rules in PL/pgSQL (supabase/migrations/20261204006320_nexamon_battles.sql); the demo
 * and the battle view use these. Time is passed in as milliseconds since the epoch, randomness as a stored seed.
 */
import { BALANCE } from "../../config/balance.ts";
import { NEXAMON_RARITIES, type NexamonRarity } from "../../config/nexamon/types.ts";

type Config = typeof BALANCE.nexamon;

export interface BattlePull {
  rarity: NexamonRarity;
  valueCents: number;
}

export type BattleSide = "challenger" | "opponent";
export type BattleTieBreak = "value" | "rarest" | "coin";

export interface BattleDecision {
  winner: BattleSide;
  tieBreak: BattleTieBreak;
  challengerCents: number;
  opponentCents: number;
}

/** 0 = common … 4 = legendary. */
export const rarityRank = (rarity: NexamonRarity): number => NEXAMON_RARITIES.indexOf(rarity);

export const battleTotalCents = (pulls: readonly BattlePull[]): number =>
  pulls.reduce((sum, p) => sum + p.valueCents, 0);

const rarest = (pulls: readonly BattlePull[]): number =>
  pulls.reduce((best, p) => Math.max(best, rarityRank(p.rarity)), -1);

/**
 * The higher total value wins; on a tie the rarest single card; then the coin: an even seed is the challenger's.
 */
export function decideBattle(
  challenger: readonly BattlePull[],
  opponent: readonly BattlePull[],
  seed: number,
): BattleDecision {
  const challengerCents = battleTotalCents(challenger);
  const opponentCents = battleTotalCents(opponent);
  if (challengerCents !== opponentCents) {
    return {
      winner: challengerCents > opponentCents ? "challenger" : "opponent",
      tieBreak: "value",
      challengerCents,
      opponentCents,
    };
  }
  const a = rarest(challenger);
  const b = rarest(opponent);
  if (a !== b) return { winner: a > b ? "challenger" : "opponent", tieBreak: "rarest", challengerCents, opponentCents };
  const coin = Math.abs(Math.trunc(seed)) % 2;
  return { winner: coin === 0 ? "challenger" : "opponent", tieBreak: "coin", challengerCents, opponentCents };
}

export interface BattleTimeline {
  /** Both packs tear. */
  startsAt: number;
  /** When the card of slot 1..packSize shows (index 0 = slot 1). */
  revealAt: number[];
  /** Totals are final, the winner is shown. */
  decideAt: number;
  /** The battle view stops being live. */
  endsAt: number;
}

/** The shared clock of a battle accepted at `acceptedAt`. */
export function battleTimeline(acceptedAt: number, cfg: Config = BALANCE.nexamon): BattleTimeline {
  const b = cfg.battles;
  const startsAt = acceptedAt + b.startDelayMs;
  const revealAt = Array.from({ length: cfg.packSize }, (_, i) => startsAt + b.tearMs + i * b.slotMs);
  const decideAt = revealAt[revealAt.length - 1]! + b.slotMs;
  return { startsAt, revealAt, decideAt, endsAt: decideAt + b.outroMs };
}

/**
 * How many slots a client may know at `now`: a card arrives `leadMs` before it shows, so every client can flip it
 * on the shared clock; nothing ever before the start.
 */
export function battleKnownSlots(startsAt: number, now: number, cfg: Config = BALANCE.nexamon): number {
  if (now < startsAt) return 0;
  const b = cfg.battles;
  const first = startsAt + b.tearMs - b.leadMs;
  if (now < first) return 0;
  return Math.min(cfg.packSize, Math.floor((now - first) / b.slotMs) + 1);
}

/** How many slots show at `now` on the shared clock (what every client animates in lockstep). */
export function battleShownSlots(startsAt: number, now: number, cfg: Config = BALANCE.nexamon): number {
  const b = cfg.battles;
  const first = startsAt + b.tearMs;
  if (now < first) return 0;
  return Math.min(cfg.packSize, Math.floor((now - first) / b.slotMs) + 1);
}

/**
 * Cards a spectator of a live opening sees: what the opener reported, and while the opener's page stays silent for
 * `staleMs`, one more card every `fallbackSlotMs`.
 */
export function liveVisibleCards(
  progress: number,
  lastReportAt: number,
  now: number,
  cfg: Config = BALANCE.nexamon,
): number {
  const l = cfg.live;
  const silent = now - lastReportAt - l.staleMs;
  const extra = silent >= 0 ? Math.floor(silent / l.fallbackSlotMs) + 1 : 0;
  return Math.max(0, Math.min(cfg.packSize, progress + extra));
}
