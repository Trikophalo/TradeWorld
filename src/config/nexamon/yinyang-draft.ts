/*
 * Yin Yang (sixth Nexamon set, ADR-178): Japanese art style, epic landscapes and lonely warriors. The shape the art
 * and catalogue work delivers its 110 cards in; `cards-yin-yang.ts` maps these drafts to `NexamonCard`. Pure data.
 *
 * Card numbers: 1-54 common, 55-84 rare, 85-100 ultra, 101-108 prisma, 109-110 legendary (109 Yin, 110 Yang).
 * Keys: "yy-001" ... "yy-110". Pack 2.000 EUR; card values 2 x Super Apex (base ranges x 10).
 */
export type YinYangRarity = "common" | "rare" | "ultra" | "prisma" | "legendary";
export type YinYangType =
  "fire" | "water" | "grass" | "electric" | "psychic" | "rock" | "dark" | "steel" | "fairy" | "dragon";

export interface YinYangCardDraft {
  key: string;
  number: number;
  rarity: YinYangRarity;
  /** "monster": a creature (yokai-like spirits, beasts, dragons, koi…); "warrior": a lone wanderer, ronin, monk… */
  kind: "monster" | "warrior";
  name: string;
  type: YinYangType;
  hp: number;
  stage: 0 | 1 | 2;
  evolvesFrom: string | null;
  attack: { name: string; damage: number; text: string };
  flavor: string;
  startPriceCents: number;
}

/** Start price ranges in cents: the base ranges x 10 (2 x Super Apex). */
export const YINYANG_PRICE_RANGE: Record<YinYangRarity, readonly [number, number]> = {
  common: [1_000, 10_000],
  rare: [7_000, 80_000],
  ultra: [160_000, 2_500_000],
  prisma: [5_000_000, 25_000_000],
  legendary: [90_000_000, 180_000_000],
};

export const YINYANG_ART_SIZE: Record<YinYangRarity, { width: number; height: number }> = {
  common: { width: 60, height: 40 },
  rare: { width: 60, height: 40 },
  ultra: { width: 68, height: 48 },
  prisma: { width: 72, height: 100 },
  legendary: { width: 72, height: 100 },
};
