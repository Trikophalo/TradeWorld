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

/**
 * Wiring (ADR-182): the ranges above give a pack an expected value of only 80 % of its price at start prices, so the
 * catalogue takes every start price x 1.125 (rounded to whole euros). That lands at 90 %.
 */
export const TITAN_VALUE_FACTOR = 1.125;

/**
 * Rebalance per rarity (ADR-207, on top of TITAN_VALUE_FACTOR): diamond cards are worth 30 % more, uranium cards less by
 * exactly the amount that keeps a pack's expected value. Per pack a diamond shows up 1/50, a uranium 1/500, so
 * 0.3 x mean(diamond) / 50 = (1 - u) x mean(uranium) / 500, with the means of the catalogue before (diamond
 * 597.375 EUR, uranium 22.078.125 EUR): u = 1 - 3 x 597.375 / 22.078.125 = 0.918828 (to 6 digits; the rest moves the
 * pack's value by less than a cent). Iron and titanium stay. The ratios between the cards of a rarity stay; the
 * migration 20261204009900 scales the live market values by the same factors.
 */
export const TITAN_REBALANCE_FACTOR: Record<TitanRarity, number> = {
  iron: 1,
  titanium: 1,
  diamond: 1.3,
  uranium: 0.918828,
};

/** Art sizes: iron 60 x 40 (framed), titanium 68 x 48 (breaks out), diamond and uranium 72 x 100 full art. */
export const TITAN_ART_SIZE: Record<TitanRarity, { width: number; height: number }> = {
  iron: { width: 60, height: 40 },
  titanium: { width: 68, height: 48 },
  diamond: { width: 72, height: 100 },
  uranium: { width: 72, height: 100 },
};
