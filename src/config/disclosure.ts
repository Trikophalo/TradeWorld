/**
 * Progressive disclosure: from which player level a part of the interface is
 * shown. New players see a calm screen with only what they can use; the rest
 * appears as they level up (docs/DECISIONS.md, ADR-033).
 *
 * This is presentation only. Whether an action is allowed is decided by the
 * unlock rules in BALANCE.progression and enforced on the server.
 */
export const DISCLOSURE = {
  /** Lead index chart on the start page. Level 2 is reached by finishing the tutorial. */
  homeIndex: 2,
  homeMissions: 2,
  homeEvents: 3,
  homeNews: 3,
  /** Asset class tabs appear together with government bonds. */
  marketAssetTabs: 5,
  /** Key figures and order book arrive with limit orders. */
  stockStats: 2,
  stockOrderBook: 3,
  portfolioHistory: 2,
  profileCareer: 2,
  /** The company tab shows up as a locked teaser two levels before founding unlocks. */
  navCompany: 8,
} as const;

export type DisclosureKey = keyof typeof DISCLOSURE;

/** How many upcoming unlock levels the profile reveals. Everything beyond stays a surprise. */
export const UNLOCK_PREVIEW_LEVELS = 2;

export function isDisclosed(key: DisclosureKey, level: number): boolean {
  return level >= DISCLOSURE[key];
}
