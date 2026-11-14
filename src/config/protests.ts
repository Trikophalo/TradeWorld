/*
 * Campaigns against other companies (ADR-133): boycott calls, shitstorms, petitions, protest marches. Fixed kinds,
 * no free text, so nobody can write insults about other players. Many have to join (players and AI supporters),
 * and even then a campaign only rarely hurts. Texts in messages/de.json (campaigns.kinds).
 */
export const PROTEST_RULES = {
  kinds: ["boycott", "shitstorm", "petition", "protest_march"],
  /** Starting costs the starter this much (to the households); joining is free. */
  startCostCents: 50_000,
  /** Supporters needed in all (players and AI). AI supporters stop at aiMax, so players must make up the rest. */
  goal: 20,
  aiMax: 16,
  /** Each minute AI supporters join with this chance, 1 to aiPerMinuteMax at a time. */
  aiJoinChanceBps: 3_000,
  aiPerMinuteMax: 2,
  /** Without the goal after this long the campaign fizzles out. */
  durationHours: 6,
  /** One open campaign per target; a player starts at most one per this many hours. */
  starterCooldownHours: 6,
  /** At the goal: chance of a real effect = base + per player supporter, at most max. */
  effectChanceBaseBps: 600,
  effectChancePerPlayerBps: 300,
  effectChanceMaxBps: 3_500,
  /** Effect: listed company, price falls by min..max bps; player company also loses awareness. */
  priceHitMinBps: 150,
  priceHitMaxBps: 450,
  awarenessHit: 0.03,
  /** From this level a player may start or join. */
  minLevel: 4,
} as const;
