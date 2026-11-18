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
  /** Level, rank and missions tiles on the start page (ADR-109). Level 2 is reached by finishing the tutorial. */
  homeStats: 2,
  /** Key figures and order book arrive with limit orders. */
  stockStats: 2,
  stockOrderBook: 3,
  /** Business figures of listed companies at the stock exchange (ADR-184): with the key figures. */
  stockFigures: 2,
  portfolioHistory: 2,
  profileCareer: 2,
  /** Friends (ADR-084): after the tutorial, when the game has a first shape. */
  profileFriends: 2,
  /** Chats with friends (ADR-164): with the friends, after the tutorial. */
  friendChats: 2,
  /** Wardrobe with accessories for the pixel figure (ADR-155): after the tutorial, like the friends. */
  profileWardrobe: 2,
  /** News battles under the TV (ADR-160): after the tutorial, like the friends (battles.lobby.minLevel). */
  newsBattle: 2,
  /** Link from the vault to the upgrades (ADR-093): not during the tutorial. */
  homeUpgrades: 2,
  /** Patch notes button in the top bar (ADR-137): not during the tutorial. */
  topbarPatchNotes: 2,
  /** Renting out places in the home and the rental market (ADR-158): with the property unlock (level 8). */
  propertyRentals: 8,
  /** Living bonus for the own or rented home (ADR-161): with the property unlock (level 8). */
  livingBonus: 8,
  /** Nexamon collectible cards (ADR-165): with the unlock "nexamon" (level 10). */
  nexamon: 10,
  /** Pack Battles and live openings on the Collectibles tab (ADR-172): with the Nexamon unlock. */
  nexamonLive: 10,
  /**
   * Listed player companies (ADR-167): the tabs Buchhaltung and Geschäftsrat (locked, with a teaser) and what going
   * public brings appear for founders of a private company once the IPO is in reach (startups.ipo.minLevel).
   */
  companyListed: 9,
  /** CEO interviews of NEXA Nachrichten (ADR-173): once the news show and a company are in reach. */
  companyInterview: 3,
  /** Fertigkeiten of the own company (ADR-194): with the company, after the tutorial. */
  companySkills: 3,
  /** News-Aktionen of the live show (ADR-193): the news tab section and the toast, after the tutorial. */
  newsPromo: 2,
  /** The clone on the job tab (ADR-206): shown locked a few levels ahead, usable from jobs.clone.minLevel (20). */
  jobClone: 15,
} as const;

export type DisclosureKey = keyof typeof DISCLOSURE;

export function isDisclosed(key: DisclosureKey, level: number): boolean {
  return level >= DISCLOSURE[key];
}
