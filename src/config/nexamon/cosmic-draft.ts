/*
 * Cosmic Winds (fourth Nexamon set, ADR-174): the shape the art and catalogue work delivers its cards in, before
 * the shared contract in `types.ts` learns the new rarity "one_of_one", the new type "cosmic" and event cards.
 * `cards-cosmic-winds.ts` maps these drafts to `NexamonCard`. Pure data, no imports.
 *
 * Card numbers: 1-50 common, 51-65 rare, 66-80 ultra, 81-85 prisma, 86-87 legendary, 88-90 one_of_one.
 * Keys: "cw-001" ... "cw-090".
 */
export type CosmicRarity = "common" | "rare" | "ultra" | "prisma" | "legendary" | "one_of_one";
/** The ten existing types plus "cosmic" (stars, void, gravity), used by event cards and some monsters. */
export type CosmicType =
  "fire" | "water" | "grass" | "electric" | "psychic" | "rock" | "dark" | "steel" | "fairy" | "dragon" | "cosmic";

export interface CosmicCardDraft {
  key: string;
  number: number;
  rarity: CosmicRarity;
  /** "monster" is a creature card; "event" is an object or happening (a galaxy, a comet, a solar storm). */
  kind: "monster" | "event";
  name: string;
  type: CosmicType;
  /** Monsters only; 0 for events. */
  hp: number;
  stage: 0 | 1 | 2;
  evolvesFrom: string | null;
  /** For events: the effect's name, damage 0 and the effect text (German). */
  attack: { name: string; damage: number; text: string };
  flavor: string;
  startPriceCents: number;
}

/** Start price ranges of Cosmic Winds in cents: 4.5 x Super Apex (base ranges x 22.5). One of One: 16 to 33 million EUR. */
export const COSMIC_PRICE_RANGE: Record<CosmicRarity, readonly [number, number]> = {
  common: [2_250, 22_500],
  rare: [15_750, 180_000],
  ultra: [360_000, 5_625_000],
  prisma: [11_250_000, 56_250_000],
  legendary: [202_500_000, 405_000_000],
  one_of_one: [1_600_000_000, 3_300_000_000],
};

/** Art sizes: like the other sets; one_of_one is full art 72 x 100. */
export const COSMIC_ART_SIZE: Record<CosmicRarity, { width: number; height: number }> = {
  common: { width: 60, height: 40 },
  rare: { width: 60, height: 40 },
  ultra: { width: 68, height: 48 },
  prisma: { width: 72, height: 100 },
  legendary: { width: 72, height: 100 },
  one_of_one: { width: 72, height: 100 },
};
