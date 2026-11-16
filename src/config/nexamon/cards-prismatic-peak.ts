import { placeholderSet, type NexamonArt, type NexamonCard } from "./types";

/** Catalogue of the set (77 cards). Placeholder until the set's cards are written. */
export const PRISMATIC_PEAK_CARDS: readonly NexamonCard[] = placeholderSet("prismatic_peak");

/** Artwork per card key. A card without an entry is drawn with the renderer's placeholder. */
export const PRISMATIC_PEAK_ART: Readonly<Record<string, NexamonArt>> = {};
