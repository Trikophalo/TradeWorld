import { COSMIC_WINDS_CHASE_ART, COSMIC_WINDS_CHASE_CARDS } from "./cards-cosmic-winds-chase";
import { COSMIC_WINDS_COMMONS_ART, COSMIC_WINDS_COMMONS_CARDS } from "./cards-cosmic-winds-commons";
import { COSMIC_WINDS_RARES_ULTRAS_ART, COSMIC_WINDS_RARES_ULTRAS_CARDS } from "./cards-cosmic-winds-rares-ultras";
import type { CosmicCardDraft } from "./cosmic-draft";
import type { NexamonArt, NexamonCard } from "./types";

/*
 * Nexamon: Cosmic Winds (ADR-174). Monsters from space and galaxies plus event cards (comets, galaxies, solar
 * storms). 90 cards: 50 common, 15 rare, 15 ultra, 5 prisma, 2 legendary and 3 One of Ones. The three draft files
 * deliver the cards in the shape of `cosmic-draft.ts`; this file maps them to the shared contract.
 */
const toCard = (d: CosmicCardDraft): NexamonCard => ({
  key: d.key,
  set: "cosmic_winds",
  number: d.number,
  rarity: d.rarity,
  name: d.name,
  kind: d.kind,
  type: d.type,
  hp: d.kind === "event" ? 0 : d.hp,
  stage: d.kind === "event" ? 0 : d.stage,
  evolvesFrom: d.kind === "event" ? null : d.evolvesFrom,
  attack: d.kind === "event" ? { ...d.attack, damage: 0 } : d.attack,
  flavor: d.flavor,
  startPriceCents: d.startPriceCents,
});

export const COSMIC_WINDS_CARDS: readonly NexamonCard[] = [
  ...COSMIC_WINDS_COMMONS_CARDS,
  ...COSMIC_WINDS_RARES_ULTRAS_CARDS,
  ...COSMIC_WINDS_CHASE_CARDS,
]
  .map(toCard)
  .sort((a, b) => a.number - b.number);

export const COSMIC_WINDS_ART: Readonly<Record<string, NexamonArt>> = {
  ...COSMIC_WINDS_COMMONS_ART,
  ...COSMIC_WINDS_RARES_ULTRAS_ART,
  ...COSMIC_WINDS_CHASE_ART,
};
