import { placeholderSet, type NexamonArt, type NexamonCard } from "./types";

/** Catalogue of the set (77 cards). Placeholder until the set's cards are written. */
export const MYSTIC_ENERGY_CARDS: readonly NexamonCard[] = placeholderSet("mystic_energy");

/** Artwork per card key. A card without an entry is drawn with the renderer's placeholder. */
export const MYSTIC_ENERGY_ART: Readonly<Record<string, NexamonArt>> = {};
