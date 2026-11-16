import { MYSTIC_ENERGY_ART, MYSTIC_ENERGY_CARDS } from "./cards-mystic-energy";
import { PRISMATIC_PEAK_ART, PRISMATIC_PEAK_CARDS } from "./cards-prismatic-peak";
import { SUPER_APEX_ART, SUPER_APEX_CARDS } from "./cards-super-apex";
import type { NexamonArt, NexamonCard } from "./types";

export * from "./types";

/** All 231 cards, set by set, in card-number order. */
export const NEXAMON_CARDS: readonly NexamonCard[] = [
  ...MYSTIC_ENERGY_CARDS,
  ...SUPER_APEX_CARDS,
  ...PRISMATIC_PEAK_CARDS,
];
export const NEXAMON_ART: Readonly<Record<string, NexamonArt>> = {
  ...MYSTIC_ENERGY_ART,
  ...SUPER_APEX_ART,
  ...PRISMATIC_PEAK_ART,
};
const BY_KEY = new Map(NEXAMON_CARDS.map((card) => [card.key, card]));
export const nexamonCard = (key: string): NexamonCard | undefined => BY_KEY.get(key);
