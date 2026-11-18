/**
 * Pack Battles and live openings (ADR-172): who wins a battle and when each card of the shared reveal shows.
 * The database runs the same rules in PL/pgSQL (supabase/migrations/20261204006320_nexamon_battles.sql); the demo
 * and the battle view use these. Time is passed in as milliseconds since the epoch, randomness as a stored seed.
 */
import { BALANCE } from "../../config/balance.ts";
import { NEXAMON_RARITY_RANK, type NexamonRarity } from "../../config/nexamon/types.ts";

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
export const rarityRank = (rarity: NexamonRarity): number => NEXAMON_RARITY_RANK[rarity];

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

/*
 * Pack Battles with several packs and up to four players (ADR-192). The database runs the same rules in PL/pgSQL
 * (supabase/migrations/20261204008000_nexamon_pack_battle_multi.sql).
 */

export interface MultiBattleDecision {
  /** Seat index of the winner (0 = the creator). */
  winner: number;
  tieBreak: BattleTieBreak;
  /** Total pulled value per seat. */
  totals: number[];
}

/**
 * The highest total value over all packs wins; on a tie among the leaders their rarest single card; then the coin
 * picks among the seats still tied, in seat order: `seed % count`. For two seats this is `decideBattle`.
 * ADR-205 `reverse` ("Umgekehrt"): the lowest total wins; on a tie the seat whose rarest card is the least rare;
 * then the same coin.
 */
export function decideMultiBattle(
  seats: readonly (readonly BattlePull[])[],
  seed: number,
  reverse = false,
): MultiBattleDecision {
  const pick = reverse ? Math.min : Math.max;
  const totals = seats.map(battleTotalCents);
  const best = pick(...totals);
  let tied = totals.flatMap((t, i) => (t === best ? [i] : []));
  if (tied.length === 1) return { winner: tied[0]!, tieBreak: "value", totals };
  const ranks = tied.map((i) => rarest(seats[i]!));
  const top = pick(...ranks);
  tied = tied.filter((_, k) => ranks[k] === top);
  if (tied.length === 1) return { winner: tied[0]!, tieBreak: "rarest", totals };
  return { winner: tied[Math.abs(Math.trunc(seed)) % tied.length]!, tieBreak: "coin", totals };
}

/** Cost per player: the sum of the lineup's pack prices. */
export function packBattleCostCents(sets: readonly string[], cfg: Config = BALANCE.nexamon): number {
  const prices = cfg.sets as Record<string, { packPriceCents: number }>;
  return sets.reduce((sum, set) => sum + (prices[set]?.packPriceCents ?? 0), 0);
}

/** Whether a lineup and a size are allowed (count limits and known sets; release gating is checked by the caller). */
export function packBattleLineupOk(sets: readonly string[], size: number, cfg: Config = BALANCE.nexamon): boolean {
  const pb = cfg.packBattle;
  const known = cfg.sets as Record<string, unknown>;
  return (
    sets.length >= 1 &&
    sets.length <= pb.maxPacks &&
    Number.isInteger(size) &&
    size >= pb.minPlayers &&
    size <= pb.maxPlayers &&
    sets.every((s) => Object.hasOwn(known, s))
  );
}

/**
 * When card `index` (0-based over the whole lineup) shows: every pack tears for `tearMs`, then its cards follow one
 * per `slotMs`; the next pack tears after the last card of the one before. ADR-205: in a Twist battle `twistMs`
 * (`packBattle.twistMs`) for the twist follow every pack; 0 otherwise.
 */
export function multiRevealAt(startsAt: number, index: number, cfg: Config = BALANCE.nexamon, twistMs = 0): number {
  const pack = Math.floor(index / cfg.packSize);
  return startsAt + (pack + 1) * cfg.battles.tearMs + index * cfg.battles.slotMs + pack * twistMs;
}

/**
 * ADR-205: when the twist after pack `round` (1-based) shows: one slot after the pack's last card, for `twistMs`;
 * then the next pack tears.
 */
export function multiTwistAt(startsAt: number, round: number, cfg: Config = BALANCE.nexamon, twistMs = 0): number {
  const b = cfg.battles;
  return startsAt + round * (b.tearMs + cfg.packSize * b.slotMs) + (round - 1) * twistMs;
}

/** ADR-205: twists (after packs 1..n) that show at `now` (`lead` earlier: that the clients may know). */
export function multiTwistsShown(
  startsAt: number,
  now: number,
  packs: number,
  cfg: Config = BALANCE.nexamon,
  twistMs = 0,
  lead = 0,
): number {
  let n = 0;
  while (n < packs && multiTwistAt(startsAt, n + 1, cfg, twistMs) - lead <= now) n++;
  return n;
}

export interface MultiBattleTimeline {
  startsAt: number;
  decideAt: number;
  endsAt: number;
}

/**
 * The shared clock of a battle with `packs` packs that filled at `filledAt`. One pack is `battleTimeline`.
 * ADR-205: a Twist battle adds `twistMs` after every pack.
 */
export function multiBattleTimeline(
  filledAt: number,
  packs: number,
  cfg: Config = BALANCE.nexamon,
  twistMs = 0,
): MultiBattleTimeline {
  const b = cfg.battles;
  const startsAt = filledAt + b.startDelayMs;
  const decideAt = startsAt + packs * (b.tearMs + cfg.packSize * b.slotMs + twistMs);
  return { startsAt, decideAt, endsAt: decideAt + b.outroMs };
}

/** Cards (over the whole lineup) a client may know at `now`: each arrives `leadMs` before it shows. */
export function multiKnownCards(
  startsAt: number,
  now: number,
  packs: number,
  cfg: Config = BALANCE.nexamon,
  twistMs = 0,
): number {
  if (now < startsAt) return 0;
  let n = 0;
  while (n < packs * cfg.packSize && multiRevealAt(startsAt, n, cfg, twistMs) - cfg.battles.leadMs <= now) n++;
  return n;
}

/** Cards (over the whole lineup) that show at `now` on the shared clock. */
export function multiShownCards(
  startsAt: number,
  now: number,
  packs: number,
  cfg: Config = BALANCE.nexamon,
  twistMs = 0,
): number {
  let n = 0;
  while (n < packs * cfg.packSize && multiRevealAt(startsAt, n, cfg, twistMs) <= now) n++;
  return n;
}

/*
 * Battle modes (ADR-205). "Umgekehrt" (reverse): see decideMultiBattle. "Twist": after every pack (the last one
 * too) the piles of all seats are permuted at random. A pile is what a seat holds for the decision: its own pulls
 * of the next pack are added to it, then the twist hands seat i the pile seat perm[i] held. The pile's total (and,
 * for a tie, its rarest card) decides; the winner still takes every card of every seat. The permutation of round k
 * comes from the stored twist seed: uniform over all n! orders (also "nothing moves").
 */

const TWIST_MOD = 2_147_483_647;

/**
 * The twist after pack `round` (1-based) for `n` seats: `perm[i]` is the seat whose pile seat i takes. Three MINSTD
 * steps from `(seed % (2^31 − 1) + round · 7919) % (2^31 − 1)`, modulo n!, decoded as a Lehmer code (PL/pgSQL:
 * nexamon_battle_twist_perm, identical).
 */
export function twistPermutation(seed: number, round: number, n: number): number[] {
  let x = ((Math.abs(Math.trunc(seed)) % TWIST_MOD) + round * 7919) % TWIST_MOD;
  for (let i = 0; i < 3; i++) x = (x * 48_271) % TWIST_MOD;
  let fact = 1;
  for (let i = 2; i <= n; i++) fact *= i;
  x %= fact;
  const pool = Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = n; i >= 1; i--) {
    const f = fact / i;
    const k = Math.floor(x / f);
    x %= f;
    out.push(pool.splice(k, 1)[0]!);
    fact = f;
  }
  return out;
}

/** The twists of a battle: one permutation per pack. */
export const twistPermutations = (seed: number, packs: number, n: number): number[][] =>
  Array.from({ length: packs }, (_, k) => twistPermutation(seed, k + 1, n));

/**
 * The piles of every seat (ADR-205): pack by pack each seat adds its own pulls of that pack, then the twist of that
 * pack (if given) permutes the piles. Without twists every seat holds its own pulls.
 */
export function twistPiles<T extends { pack: number }>(
  seats: readonly (readonly T[])[],
  twists: readonly (readonly number[])[],
  packs: number,
): T[][] {
  let piles: T[][] = seats.map(() => []);
  for (let p = 1; p <= packs; p++) {
    piles = piles.map((pile, i) => [...pile, ...seats[i]!.filter((c) => c.pack === p)]);
    const perm = twists[p - 1];
    if (perm) piles = piles.map((_, i) => piles[perm[i]!]!);
  }
  return piles;
}

/** The running score of every seat: the pile totals from the cards and twists given so far. */
export const twistScores = (
  seats: readonly (readonly (BattlePull & { pack: number })[])[],
  twists: readonly (readonly number[])[],
  packs: number,
): number[] => twistPiles(seats, twists, packs).map(battleTotalCents);

/**
 * How a twist reads (ADR-205): its cycles, each in the direction the piles travel (seat a's pile goes to b, …);
 * seats that keep their pile are left out. Empty: nothing moves.
 */
export function twistCycles(perm: readonly number[]): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let start = 0; start < perm.length; start++) {
    if (seen.has(start) || perm[start] === start) continue;
    const cycle: number[] = [];
    let s = start;
    while (!seen.has(s)) {
      seen.add(s);
      cycle.push(s);
      // the pile of s goes to the seat that takes from s
      s = perm.indexOf(s);
    }
    out.push(cycle);
  }
  return out;
}
