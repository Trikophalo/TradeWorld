/*
 * Titans Revenge (fifth Nexamon set, ADR-175): the shape the art and catalogue work delivers its 30 cards in, before
 * the shared contract in `types.ts` learns its own rarities. `cards-titans-revenge.ts` maps these drafts to
 * `NexamonCard`. Pure data, no imports.
 *
 * Card numbers: 1-15 iron, 16-22 titanium, 23-26 diamond, 27-30 uranium. Keys: "tr-001" ... "tr-030".
 * Pack 100.000 EUR, expected value about 90 % of the price (players lose about 10 % on average).
 */
export type TitanRarity = "iron" | "titanium" | "diamond" | "uranium";
export type TitanType =
  "fire" | "water" | "grass" | "electric" | "psychic" | "rock" | "dark" | "steel" | "fairy" | "dragon";

export interface TitanCardDraft {
  key: string;
  number: number;
  rarity: TitanRarity;
  name: string;
  type: TitanType;
  hp: number;
  stage: 0 | 1 | 2;
  evolvesFrom: string | null;
  attack: { name: string; damage: number; text: string };
  flavor: string;
  startPriceCents: number;
}

/** Start values in cents. Scaled to about half of the owner's first ranges so a pack returns ~90 % on average. */
export const TITAN_PRICE_RANGE: Record<TitanRarity, readonly [number, number]> = {
  iron: [250_000, 600_000],
  titanium: [3_000_000, 7_500_000],
  diamond: [30_000_000, 85_000_000],
  uranium: [850_000_000, 3_500_000_000],
};

/** Art sizes: iron 60 x 40 (framed), titanium 68 x 48 (breaks out), diamond and uranium 72 x 100 full art. */
export const TITAN_ART_SIZE: Record<TitanRarity, { width: number; height: number }> = {
  iron: { width: 60, height: 40 },
  titanium: { width: 68, height: 48 },
  diamond: { width: 72, height: 100 },
  uranium: { width: 72, height: 100 },
};
