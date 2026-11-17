import { YIN_YANG_CHASE_ART, YIN_YANG_CHASE_CARDS } from "./cards-yin-yang-chase";
import { YIN_YANG_COMMONS_ART, YIN_YANG_COMMONS_CARDS } from "./cards-yin-yang-commons";
import { YIN_YANG_RARES_ART, YIN_YANG_RARES_CARDS } from "./cards-yin-yang-rares";
import type { NexamonArt, NexamonCard } from "./types";
import type { YinYangCardDraft } from "./yinyang-draft";

/*
 * Nexamon: Yin Yang (ADR-182). Japanese ink style, epic landscapes and lone warriors. 110 cards: 54 common, 30 rare,
 * 16 ultra, 8 prisma and the two legendaries Yin (yy-109) and Yang (yy-110). Warriors are monster cards with their
 * own kind ("KRIEGER" label on the face).
 */
const toCard = (d: YinYangCardDraft): NexamonCard => ({
  key: d.key,
  set: "yin_yang",
  number: d.number,
  rarity: d.rarity,
  name: d.name,
  ...(d.kind === "warrior" ? { kind: "warrior" as const } : {}),
  type: d.type,
  hp: d.hp,
  stage: d.stage,
  evolvesFrom: d.evolvesFrom,
  attack: d.attack,
  flavor: d.flavor,
  startPriceCents: d.startPriceCents,
});

export const YIN_YANG_CARDS: readonly NexamonCard[] = [
  ...YIN_YANG_COMMONS_CARDS,
  ...YIN_YANG_RARES_CARDS,
  ...YIN_YANG_CHASE_CARDS,
]
  .map(toCard)
  .sort((a, b) => a.number - b.number);

export const YIN_YANG_ART: Readonly<Record<string, NexamonArt>> = {
  ...YIN_YANG_COMMONS_ART,
  ...YIN_YANG_RARES_ART,
  ...YIN_YANG_CHASE_ART,
};
