import type { AccessoryRarity } from "@/config/accessories";

/** Colour of a rarity tier (ADR-154): token classes for text, a soft backdrop and a ring. */
export const RARITY_STYLE: Readonly<Record<AccessoryRarity, { text: string; soft: string; ring: string }>> = {
  common: { text: "text-fg-2", soft: "bg-surface-2", ring: "ring-line-2" },
  rare: { text: "text-info", soft: "bg-info-soft", ring: "ring-info" },
  epic: { text: "text-accent", soft: "bg-accent-soft", ring: "ring-accent" },
  legendary: { text: "text-gold", soft: "bg-gold/15", ring: "ring-gold" },
};
