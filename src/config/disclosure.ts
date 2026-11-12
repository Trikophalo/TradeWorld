/**
 * Progressive disclosure for information panels: from which level a panel is
 * shown, so the first screens stay calm (docs/DECISIONS.md, ADR-033).
 * Features the player unlocks later (company, bonds, limit orders, leverage ...)
 * are never hidden: they are shown locked with their level (ADR-035).
 *
 * This is presentation only. Whether an action is allowed is decided by the
 * unlock rules in BALANCE.progression and enforced on the server.
 */
export const DISCLOSURE = {
  /** Lead index chart on the start page. Level 2 is reached by finishing the tutorial. */
  homeIndex: 2,
  homeEvents: 3,
  homeNews: 3,
  /** Key figures and order book arrive with limit orders. */
  stockStats: 2,
  stockOrderBook: 3,
  portfolioHistory: 2,
  profileCareer: 2,
  /** Friends (ADR-084): after the tutorial, when the game has a first shape. */
  profileFriends: 2,
} as const;

export type DisclosureKey = keyof typeof DISCLOSURE;

export function isDisclosed(key: DisclosureKey, level: number): boolean {
  return level >= DISCLOSURE[key];
}
