import { TITANS_REVENGE_ART as ART, TITANS_REVENGE_CARDS as DRAFTS } from "./cards-titans-revenge-data";
import { TITAN_VALUE_FACTOR, type TitanCardDraft } from "./titans-draft";
import type { NexamonArt, NexamonCard } from "./types";

/*
 * Nexamon: Titans Revenge (ADR-182). Colossal ancient giants, 30 cards in four own rarities: 15 iron, 7 titanium,
 * 4 diamond and 4 uranium. The draft file delivers the cards in the shape of `titans-draft.ts`; this file maps them
 * to the shared contract. Start prices x TITAN_VALUE_FACTOR (1.125), so a pack is worth about 90 % of its price.
 */
const toCard = (d: TitanCardDraft): NexamonCard => ({
  key: d.key,
  set: "titans_revenge",
  number: d.number,
  rarity: d.rarity,
  name: d.name,
  type: d.type,
  hp: d.hp,
  stage: d.stage,
  evolvesFrom: d.evolvesFrom,
  attack: d.attack,
  flavor: d.flavor,
  startPriceCents: Math.round((d.startPriceCents * TITAN_VALUE_FACTOR) / 100) * 100,
});

export const TITANS_REVENGE_CARDS: readonly NexamonCard[] = DRAFTS.map(toCard).sort((a, b) => a.number - b.number);
export const TITANS_REVENGE_ART: Readonly<Record<string, NexamonArt>> = ART;
