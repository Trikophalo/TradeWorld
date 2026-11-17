/**
 * Nexamon card bonuses and the Black Label hype (ADR-171). Some cards give a small passive account bonus while the
 * player owns a copy that is not listed; collections (all cards of a type in a set, a complete set, a master set)
 * give more. Bonuses of one kind stack with diminishing returns up to a hard cap. The Black Labels of a card carry
 * their own value factor that sometimes jumps ("Hype") and decays back to the base.
 *
 * The database runs the same rules in PL/pgSQL (supabase/migrations/20261204006210_nexamon_card_bonuses.sql and
 * 20261204006230_nexamon_black_label_hype.sql). Integer basis points only; randomness is passed in.
 */
import { BALANCE } from "../../config/balance.ts";
import type { NexamonRarity, NexamonSetKey, NexamonType } from "../../config/nexamon/types.ts";

type Config = typeof BALANCE.nexamon;
export type NexamonBonusKind = Config["bonuses"]["kinds"][number];
export type NexamonCollectionKind = "type" | "complete" | "master";

const BLACK_LABEL_FROM = 10.75;

/** What the bonus rules need of a catalogue card. */
export interface NexamonBonusCardInput {
  readonly key: string;
  readonly set: NexamonSetKey;
  readonly number: number;
  readonly rarity: NexamonRarity;
  readonly type: NexamonType;
}

export interface NexamonCardBonusDef {
  readonly kind: NexamonBonusKind;
  /** Bonus of a raw copy in bps. */
  readonly bps: number;
}

/** The bonus a card gives (raw copy), or null. */
export function nexamonCardBonusDef(
  card: NexamonBonusCardInput,
  cfg: Config = BALANCE.nexamon,
): NexamonCardBonusDef | null {
  const b = cfg.bonuses;
  const byRarity = (b.rarities as readonly string[]).includes(card.rarity);
  const extra = card.rarity === "rare" && (b.extraNumbers as readonly number[]).includes(card.number);
  if (!byRarity && !extra) return null;
  const kind = b.typeKind[card.type] as NexamonBonusKind;
  const bps = Math.floor((b.rarityBps[card.rarity] * b.setBps[card.set]) / 10_000);
  return bps > 0 ? { kind, bps } : null;
}

/** key -> bonus of every card that gives one. */
export function nexamonBonusCatalogue(
  cards: readonly NexamonBonusCardInput[],
  cfg: Config = BALANCE.nexamon,
): Record<string, NexamonCardBonusDef> {
  const out: Record<string, NexamonCardBonusDef> = {};
  for (const card of cards) {
    const def = nexamonCardBonusDef(card, cfg);
    if (def) out[card.key] = def;
  }
  return out;
}

/** Multiplier of the best own copy in bps: a slab of slab.minGrade or better, a Black Label more, else 1x. */
export function nexamonSlabBoostBps(bestGrade: number | null, cfg: Config = BALANCE.nexamon): number {
  const s = cfg.bonuses.slab;
  if (bestGrade != null && bestGrade >= BLACK_LABEL_FROM) return s.blackLabelBps;
  if (bestGrade != null && bestGrade >= s.minGrade) return s.gradeBps;
  return 10_000;
}

/** A card's bonus with the boost of its best own copy. */
export const nexamonBoostedBps = (baseBps: number, bestGrade: number | null, cfg: Config = BALANCE.nexamon): number =>
  Math.floor((baseBps * nexamonSlabBoostBps(bestGrade, cfg)) / 10_000);

/** Diminishing returns and the cap: raw up to the knee counts fully, above it tailBps of the rest, at most the cap. */
export function nexamonStackBps(rawBps: number, kind: NexamonBonusKind, cfg: Config = BALANCE.nexamon): number {
  const b = cfg.bonuses;
  const cap = b.caps[kind];
  const raw = Math.max(0, Math.floor(rawBps));
  const knee = Math.floor((cap * b.kneeShareBps) / 10_000);
  const eff = raw <= knee ? raw : knee + Math.floor(((raw - knee) * b.tailBps) / 10_000);
  return Math.min(cap, eff);
}

/** One own copy as the rules see it. */
export interface NexamonOwnedCopy {
  readonly cardKey: string;
  /** null = raw (or at ASP). */
  readonly grade: number | null;
  readonly listed: boolean;
}

export interface NexamonCollectionState {
  readonly set: NexamonSetKey;
  readonly kind: NexamonCollectionKind;
  /** The type of a type collection, else null. */
  readonly type: NexamonType | null;
  readonly have: number;
  readonly need: number;
  readonly complete: boolean;
  /** Card keys still missing (for master: cards without a slab good enough). */
  readonly missing: readonly string[];
  /** Bonus while complete: kind null = every kind. */
  readonly bonusKind: NexamonBonusKind | null;
  readonly bonusBps: number;
}

export interface NexamonBonusSource {
  readonly cardKey: string | null;
  readonly collection: { set: NexamonSetKey; kind: NexamonCollectionKind; type: NexamonType | null } | null;
  readonly kind: NexamonBonusKind;
  readonly bps: number;
}

export interface NexamonBonusTotals {
  readonly kind: NexamonBonusKind;
  readonly rawBps: number;
  readonly effectiveBps: number;
  readonly capBps: number;
}

export interface NexamonBonusSummary {
  readonly totals: readonly NexamonBonusTotals[];
  readonly sources: readonly NexamonBonusSource[];
  readonly collections: readonly NexamonCollectionState[];
}

/** Best grade among the unlisted copies per card, and which cards are owned unlisted at all. */
function ownedMap(copies: readonly NexamonOwnedCopy[]): Map<string, number | null> {
  const owned = new Map<string, number | null>();
  for (const c of copies) {
    if (c.listed) continue;
    const prev = owned.get(c.cardKey);
    if (!owned.has(c.cardKey)) owned.set(c.cardKey, c.grade);
    else if (c.grade != null && (prev == null || c.grade > prev)) owned.set(c.cardKey, c.grade);
  }
  return owned;
}

/** The collections of every set in the catalogue and how far the player is. */
export function nexamonCollections(
  cards: readonly NexamonBonusCardInput[],
  copies: readonly NexamonOwnedCopy[],
  cfg: Config = BALANCE.nexamon,
): NexamonCollectionState[] {
  const s = cfg.bonuses.sets;
  const owned = ownedMap(copies);
  const out: NexamonCollectionState[] = [];
  const sets = [...new Set(cards.map((c) => c.set))];
  for (const set of sets) {
    const setCards = cards.filter((c) => c.set === set);
    const setBps = cfg.bonuses.setBps[set];
    const types = [...new Set(setCards.map((c) => c.type))];
    for (const type of types) {
      const of = setCards.filter((c) => c.type === type);
      const missing = of.filter((c) => !owned.has(c.key)).map((c) => c.key);
      out.push({
        set,
        kind: "type",
        type,
        have: of.length - missing.length,
        need: of.length,
        complete: missing.length === 0,
        missing,
        bonusKind: cfg.bonuses.typeKind[type] as NexamonBonusKind,
        bonusBps: Math.floor((s.type.bps * setBps) / 10_000),
      });
    }
    const missingAll = setCards.filter((c) => !owned.has(c.key)).map((c) => c.key);
    out.push({
      set,
      kind: "complete",
      type: null,
      have: setCards.length - missingAll.length,
      need: setCards.length,
      complete: missingAll.length === 0,
      missing: missingAll,
      bonusKind: s.complete.kind as NexamonBonusKind,
      bonusBps: Math.floor((s.complete.bps * setBps) / 10_000),
    });
    const top = setCards.filter((c) => (s.masterRarities as readonly string[]).includes(c.rarity));
    const missingSlab = top.filter((c) => {
      const g = owned.get(c.key);
      return g == null || g < s.masterMinGrade;
    });
    const missingMaster = [...missingAll, ...missingSlab.map((c) => c.key).filter((k) => !missingAll.includes(k))];
    out.push({
      set,
      kind: "master",
      type: null,
      have: setCards.length + top.length - missingAll.length - missingSlab.length,
      need: setCards.length + top.length,
      complete: missingMaster.length === 0,
      missing: missingMaster,
      bonusKind: null,
      bonusBps: Math.floor((s.master.bps * setBps) / 10_000),
    });
  }
  return out;
}

/** Every active bonus of a player: card bonuses, collection bonuses, totals per kind with the cap. */
export function nexamonBonusSummary(
  cards: readonly NexamonBonusCardInput[],
  copies: readonly NexamonOwnedCopy[],
  cfg: Config = BALANCE.nexamon,
): NexamonBonusSummary {
  const owned = ownedMap(copies);
  const sources: NexamonBonusSource[] = [];
  for (const card of cards) {
    if (!owned.has(card.key)) continue;
    const def = nexamonCardBonusDef(card, cfg);
    if (!def) continue;
    sources.push({
      cardKey: card.key,
      collection: null,
      kind: def.kind,
      bps: nexamonBoostedBps(def.bps, owned.get(card.key) ?? null, cfg),
    });
  }
  const collections = nexamonCollections(cards, copies, cfg);
  const kinds = cfg.bonuses.kinds as readonly NexamonBonusKind[];
  for (const c of collections) {
    if (!c.complete || c.bonusBps <= 0) continue;
    const collection = { set: c.set, kind: c.kind, type: c.type };
    for (const kind of c.bonusKind ? [c.bonusKind] : kinds) {
      sources.push({ cardKey: null, collection, kind, bps: c.bonusBps });
    }
  }
  const totals = kinds.map((kind) => {
    const rawBps = sources.filter((s) => s.kind === kind).reduce((sum, s) => sum + s.bps, 0);
    return { kind, rawBps, effectiveBps: nexamonStackBps(rawBps, kind, cfg), capBps: cfg.bonuses.caps[kind] };
  });
  return { totals, sources, collections };
}

/** One-time reward of a first completion: money (pack prices of the set) and XP. */
export function nexamonCollectionReward(
  kind: NexamonCollectionKind,
  set: NexamonSetKey,
  cfg: Config = BALANCE.nexamon,
): { cents: number; xp: number } {
  const r = cfg.bonuses.sets[kind];
  return { cents: r.rewardPacks * cfg.sets[set].packPriceCents, xp: r.rewardXp };
}

// ---------------------------------------------------------------------------------------------- Black Label hype

/** The base factor of a Black Label (grading.blackLabel.valueBps). */
export const nexamonHypeBaseBps = (cfg: Config = BALANCE.nexamon): number => cfg.grading.blackLabel.valueBps;

/** Chance per hour that the Black Label factor of a card jumps (bps). 0 without a Black Label. */
export function nexamonHypeChanceBps(
  rarity: NexamonRarity,
  popularityBps: number,
  blackLabels: number,
  cfg: Config = BALANCE.nexamon,
): number {
  if (blackLabels <= 0) return 0;
  const h = cfg.blackLabelHype;
  const pop = Math.min(10_000, Math.max(0, Math.floor(popularityBps)));
  return Math.floor(
    (h.rarityChanceBps[rarity] * (10_000 + pop) * h.blRef) / (10_000 * (h.blRef + Math.max(0, blackLabels - 1))),
  );
}

/** Size of a jump in bps of the factor, from u in [0, 1). */
export function nexamonHypeJumpBps(u: number, cfg: Config = BALANCE.nexamon): number {
  const h = cfg.blackLabelHype;
  const x = Math.min(Math.max(Number.isFinite(u) ? u : 0, 0), 0.999999999);
  return h.minJumpBps + Math.floor(x * (h.maxJumpBps - h.minJumpBps + 1));
}

/** The factor after a jump of jumpBps, at most the cap. */
export const nexamonHypeAfterJump = (factorBps: number, jumpBps: number, cfg: Config = BALANCE.nexamon): number =>
  Math.min(cfg.blackLabelHype.capBps, factorBps + Math.floor((factorBps * jumpBps) / 10_000));

/** One hour of decay: the factor loses decayBps of what it lies above the base (at least 1 bps), never below it. */
export function nexamonHypeDecay(factorBps: number, cfg: Config = BALANCE.nexamon): number {
  const base = nexamonHypeBaseBps(cfg);
  if (factorBps <= base) return base;
  const excess = factorBps - base;
  return factorBps - Math.max(1, Math.ceil((excess * cfg.blackLabelHype.decayBps) / 10_000));
}

/**
 * One hourly step of a card: decay first, then the roll. `u` decides whether it jumps (u x 10 000 < chance), `u2`
 * how far.
 */
export function nexamonHypeStep(
  factorBps: number,
  chanceBps: number,
  u: number,
  u2: number,
  cfg: Config = BALANCE.nexamon,
): { factorBps: number; jumpBps: number } {
  const decayed = nexamonHypeDecay(factorBps, cfg);
  if (u * 10_000 >= chanceBps) return { factorBps: decayed, jumpBps: 0 };
  const jumpBps = nexamonHypeJumpBps(u2, cfg);
  return { factorBps: nexamonHypeAfterJump(decayed, jumpBps, cfg), jumpBps };
}
