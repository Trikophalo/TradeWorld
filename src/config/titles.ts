import { BALANCE } from "./balance";

/**
 * Rank titles shown next to the level. Up to level 50 they follow the unlocks;
 * after that every `titleEveryLevels` levels adds a prestige tier (ADR-039).
 * Texts: messages "titles".
 */
export const TITLE_STEPS = [
  { from: 1, key: "rookie" },
  { from: 5, key: "investor" },
  { from: 10, key: "founder" },
  { from: 20, key: "strategist" },
  { from: 25, key: "magnate" },
  { from: 35, key: "tycoon" },
  { from: 50, key: "legend" },
] as const;

export type TitleKey = (typeof TITLE_STEPS)[number]["key"];

/** Title key and, beyond level 50, the prestige tier (II, III, ...). */
export function titleForLevel(level: number): { key: TitleKey; tier: number } {
  const step = [...TITLE_STEPS].reverse().find((s) => level >= s.from) ?? TITLE_STEPS[0];
  const { fromLevel, titleEveryLevels } = BALANCE.progression.prestige;
  const tier = level >= fromLevel ? 1 + Math.floor((level - fromLevel) / titleEveryLevels) : 1;
  return { key: step.key, tier };
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function romanTier(tier: number): string {
  return tier <= 1 ? "" : (ROMAN[tier] ?? String(tier));
}
