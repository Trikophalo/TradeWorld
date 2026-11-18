/**
 * Size, risk and the world outside (ADR-209). Small companies grow as before; from tens of millions on, every
 * further step gets harder: the market saturates, overhead grows, external events (politics, tariffs, disasters,
 * war, pandemics, shitstorms, cyber attacks, antitrust, strikes, currency and energy shocks) come more often and
 * hit harder. Insurance softens disasters, won lobby campaigns soften politics. Formulas in src/lib/sim/macro.ts,
 * mirrored in Postgres (supabase/migrations/20261204010100_macro_events.sql).
 *
 * Plain data, no imports (part of BALANCE as "macro").
 */
export const MACRO = {
  /**
   * Friction by company value (company_worth_cents, ADR-203). Below the pivot nothing changes. Above it the market
   * saturates (demand × (pivot / value)^(1 − exponent): new customers get ever harder to win) and overhead
   * (bureaucracy, compliance, coordination) costs perDecadeBps of the revenue per tenfold value, at most maxBps.
   */
  friction: {
    worthPivotCents: 3_000_000_000,
    saturationExponent: 0.4,
    overheadPerDecadeBps: 1_500,
    overheadMaxBps: 4_000,
  },
  /**
   * External events scale with the company value (company_worth_cents). decades = log10(value / pivot), 0 below
   * the pivot, at most maxDecades. Per decade: higher daily chance, fewer chances among the events, worse
   * severities (u → 1 − (1 − u)^(1 + severityPowerPerDecade × decades)), external archetypes weigh more.
   */
  events: {
    worthPivotCents: 2_000_000_000,
    maxDecades: 3,
    chancePerDayPerDecade: 0.2,
    maxChancePerDay: 0.95,
    chanceShareCutPerDecade: 0.08,
    minChanceShare: 0.15,
    severityPowerPerDecade: 0.6,
    externalBoostPerDecade: 1,
    /** One cost unit of a response step is at least this share of the company value (bps), so lobbying a billion-euro
     * group is not paid from petty cash. Below ~10 Mio. € the old unit (fixed costs) is larger. */
    unitWorthBps: 12,
    /** News show (Mr. Doodle Dangle): external events of at least this severity and company value are a topic. */
    newsMinSeverity: 2,
    newsMinWorthCents: 5_000_000_000,
  },
  /**
   * Country risk (ADR-208, country_cfg of the company's headquarters). Without a headquarters every factor is 1.
   * Risks are 0..100; the weight of an archetype is multiplied by 1 + boost × risk / 100 (image: a negative imageBps);
   * disasters named in disasterRisk[] (earthquake → also tsunami, storm → flood and tsunami, drought → wildfire)
   * weigh × disasterListed, the others × disasterOther. Market leaders of their country feel political events less
   * (game_config world.lobby.politicalImpactReductionBps, ADR-208).
   */
  country: {
    politicalBoost: 2,
    tariffBoost: 2,
    warBoost: 3,
    imageBoost: 1,
    disasterListed: 2.5,
    disasterOther: 0.4,
    /** Disaster kinds of the world map and the archetypes they make likelier. */
    disasterMap: {
      earthquake: ["earthquake", "tsunami"],
      flood: ["flood"],
      storm: ["flood", "tsunami"],
      wildfire: ["wildfire"],
      drought: ["wildfire"],
    } as Readonly<Record<string, readonly string[]>>,
  },
  /**
   * Insurance against disasters and cyber attacks: an optional running cost (share of the own revenue, booked with
   * the goods) that takes coverage of the damage of an insurable event. Coverage is fixed when the event starts;
   * after a change of level the new level counts for events from changeWaitHours on (no buying after the quake).
   */
  insurance: {
    levels: [
      { key: "none", coverage: 0, premiumBps: 0 },
      { key: "basic", coverage: 0.5, premiumBps: 40 },
      { key: "full", coverage: 0.8, premiumBps: 110 },
    ],
    changeWaitHours: 12,
  },
  /**
   * Lobby: every won lobby campaign (strategy key starting with "lobby") raises the lobby level by one, up to
   * maxLevel. Each level adds successBpsPerLevel to the base chance of lobby steps (at most 9 500) and cuts the weight of
   * political archetypes by politicalCutPerLevel.
   */
  lobby: { maxLevel: 5, successBpsPerLevel: 350, politicalCutPerLevel: 0.12 },
  /** "Never bankrupt a well-run company outright": extra costs of event, overhead and premium together, at most. */
  maxExtraCostShare: 0.6,
} as const;

export type MacroConfig = typeof MACRO;
