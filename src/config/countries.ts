/*
 * Weltkarte und Standorte (ADR-208): the countries a company can place its headquarters and subsidiaries in, and the
 * rules of headquarters, subsidiaries, image campaigns and the country lobby.
 *
 * Every trait is in basis points against a neutral 10 000 (taxRateBps is a rate on profit): productionCostBps scales the
 * goods costs, labourCostBps the fixed costs (rent, staff overhead), demandPotentialBps the demand, imageBps is the
 * reputation baseline of a company from there (it scales demand with imageDemandWeightBps). politicalRisk,
 * tariffExposure and warRisk (0..100) and disasterRisk are read by the external events (ADR-209); taxRateBps by the
 * taxes (ADR-209).
 *
 * Balance (src/lib/sim/world.ts countryScore, tested in world.test.ts): every advantage and drawback is weighted by
 * its effect on the hourly result; every country's sum lies within `balanceTolerance` of the mean, so no country is a
 * clear best choice. China: cheap production, worse image; Germany: expensive labour, strong image; USA: big demand,
 * higher taxes; Switzerland: low taxes, very expensive; and so on.
 *
 * Keys are stored per company and must never change; names live in messages/de.json under "world.countries".
 * Pure data, no imports (runs in Deno; SQL reads it from game_config "world").
 */
export const DISASTER_KINDS = ["earthquake", "flood", "storm", "wildfire", "drought"] as const;
export type DisasterKind = (typeof DISASTER_KINDS)[number];

export interface CountryConfig {
  readonly key: string;
  /** German name (also in messages; the server uses it in ledger texts and notifications). */
  readonly name: string;
  /** Position on the world map in percent of width and height (equirectangular). */
  readonly map: { readonly x: number; readonly y: number };
  readonly productionCostBps: number;
  readonly labourCostBps: number;
  readonly demandPotentialBps: number;
  readonly imageBps: number;
  readonly taxRateBps: number;
  readonly politicalRisk: number;
  readonly tariffExposure: number;
  readonly disasterRisk: readonly DisasterKind[];
  readonly warRisk: number;
  /** Flag colors as data (pixel flag on the map and in the HQ editor), top to bottom or left to right. */
  readonly flag: readonly string[];
  /** Stripes of the flag run vertically. */
  readonly flagVertical?: boolean;
}

/** lon/lat to map percent (equirectangular, cropped to 80°N..60°S like the map). */
const at = (lon: number, lat: number) => ({
  x: Math.round(((lon + 180) / 360) * 1000) / 10,
  y: Math.round(((80 - lat) / 140) * 1000) / 10,
});

export const COUNTRIES: readonly CountryConfig[] = [
  {
    key: "de",
    name: "Deutschland",
    map: at(10, 51),
    productionCostBps: 11_000,
    labourCostBps: 12_500,
    demandPotentialBps: 10_500,
    imageBps: 12_500,
    taxRateBps: 3_000,
    politicalRisk: 10,
    tariffExposure: 30,
    disasterRisk: ["flood"],
    warRisk: 5,
    flag: ["#1a1a1a", "#dd0000", "#ffce00"],
  },
  {
    key: "us",
    name: "USA",
    map: at(-98, 39),
    productionCostBps: 11_000,
    labourCostBps: 12_000,
    demandPotentialBps: 12_000,
    imageBps: 10_500,
    taxRateBps: 3_400,
    politicalRisk: 35,
    tariffExposure: 40,
    disasterRisk: ["storm", "wildfire"],
    warRisk: 10,
    flag: ["#b22234", "#ffffff", "#3c3b6e"],
  },
  {
    key: "cn",
    name: "China",
    map: at(104, 35),
    productionCostBps: 8_400,
    labourCostBps: 8_800,
    demandPotentialBps: 11_300,
    imageBps: 7_600,
    taxRateBps: 2_500,
    politicalRisk: 60,
    tariffExposure: 70,
    disasterRisk: ["flood", "earthquake"],
    warRisk: 25,
    flag: ["#de2910", "#ffde00"],
  },
  {
    key: "jp",
    name: "Japan",
    map: at(138, 36),
    productionCostBps: 10_800,
    labourCostBps: 11_000,
    demandPotentialBps: 10_500,
    imageBps: 12_000,
    taxRateBps: 3_000,
    politicalRisk: 10,
    tariffExposure: 30,
    disasterRisk: ["earthquake", "storm"],
    warRisk: 10,
    flag: ["#ffffff", "#bc002d"],
  },
  {
    key: "in",
    name: "Indien",
    map: at(79, 22),
    productionCostBps: 8_800,
    labourCostBps: 8_000,
    demandPotentialBps: 10_500,
    imageBps: 8_800,
    taxRateBps: 2_700,
    politicalRisk: 40,
    tariffExposure: 40,
    disasterRisk: ["flood", "drought"],
    warRisk: 25,
    flag: ["#ff9933", "#ffffff", "#138808"],
  },
  {
    key: "br",
    name: "Brasilien",
    map: at(-52, -12),
    productionCostBps: 8_800,
    labourCostBps: 8_500,
    demandPotentialBps: 10_200,
    imageBps: 9_500,
    taxRateBps: 3_400,
    politicalRisk: 45,
    tariffExposure: 40,
    disasterRisk: ["flood"],
    warRisk: 5,
    flag: ["#009c3b", "#ffdf00", "#002776"],
  },
  {
    key: "gb",
    name: "Vereinigtes Königreich",
    map: at(-2, 54),
    productionCostBps: 10_600,
    labourCostBps: 11_500,
    demandPotentialBps: 10_200,
    imageBps: 11_500,
    taxRateBps: 2_500,
    politicalRisk: 20,
    tariffExposure: 45,
    disasterRisk: ["flood"],
    warRisk: 5,
    flag: ["#012169", "#ffffff", "#c8102e"],
  },
  {
    key: "fr",
    name: "Frankreich",
    map: at(2, 47),
    productionCostBps: 10_700,
    labourCostBps: 12_000,
    demandPotentialBps: 10_500,
    imageBps: 12_000,
    taxRateBps: 2_800,
    politicalRisk: 25,
    tariffExposure: 30,
    disasterRisk: ["flood"],
    warRisk: 5,
    flag: ["#0055a4", "#ffffff", "#ef4135"],
    flagVertical: true,
  },
  {
    key: "ca",
    name: "Kanada",
    map: at(-106, 56),
    productionCostBps: 10_300,
    labourCostBps: 11_000,
    demandPotentialBps: 9_900,
    imageBps: 11_500,
    taxRateBps: 2_600,
    politicalRisk: 10,
    tariffExposure: 45,
    disasterRisk: ["wildfire"],
    warRisk: 5,
    flag: ["#ff0000", "#ffffff", "#ff0000"],
    flagVertical: true,
  },
  {
    key: "mx",
    name: "Mexiko",
    map: at(-102, 23),
    productionCostBps: 8_500,
    labourCostBps: 7_800,
    demandPotentialBps: 10_000,
    imageBps: 9_000,
    taxRateBps: 3_000,
    politicalRisk: 45,
    tariffExposure: 45,
    disasterRisk: ["earthquake", "storm"],
    warRisk: 10,
    flag: ["#006847", "#ffffff", "#ce1126"],
    flagVertical: true,
  },
  {
    key: "kr",
    name: "Südkorea",
    map: at(128, 36),
    productionCostBps: 9_800,
    labourCostBps: 10_000,
    demandPotentialBps: 10_300,
    imageBps: 11_000,
    taxRateBps: 2_400,
    politicalRisk: 15,
    tariffExposure: 35,
    disasterRisk: ["storm"],
    warRisk: 35,
    flag: ["#ffffff", "#cd2e3a", "#0047a0"],
  },
  {
    key: "au",
    name: "Australien",
    map: at(134, -25),
    productionCostBps: 10_500,
    labourCostBps: 10_800,
    demandPotentialBps: 10_000,
    imageBps: 11_400,
    taxRateBps: 2_500,
    politicalRisk: 10,
    tariffExposure: 25,
    disasterRisk: ["wildfire", "drought"],
    warRisk: 5,
    flag: ["#00008b", "#ffffff", "#ff0000"],
  },
  {
    key: "sg",
    name: "Singapur",
    map: at(104, 1),
    productionCostBps: 10_600,
    labourCostBps: 11_200,
    demandPotentialBps: 9_800,
    imageBps: 11_500,
    taxRateBps: 1_700,
    politicalRisk: 10,
    tariffExposure: 35,
    disasterRisk: [],
    warRisk: 10,
    flag: ["#ef3340", "#ffffff"],
  },
  {
    key: "ch",
    name: "Schweiz",
    map: at(8, 47),
    productionCostBps: 11_000,
    labourCostBps: 12_500,
    demandPotentialBps: 9_500,
    imageBps: 13_000,
    taxRateBps: 1_500,
    politicalRisk: 5,
    tariffExposure: 15,
    disasterRisk: [],
    warRisk: 5,
    flag: ["#ff0000", "#ffffff"],
  },
  {
    key: "ae",
    name: "Vereinigte Arabische Emirate",
    map: at(54, 24),
    productionCostBps: 9_800,
    labourCostBps: 9_800,
    demandPotentialBps: 9_800,
    imageBps: 10_500,
    taxRateBps: 900,
    politicalRisk: 35,
    tariffExposure: 40,
    disasterRisk: ["drought"],
    warRisk: 30,
    flag: ["#00732f", "#ffffff", "#000000"],
  },
  {
    key: "za",
    name: "Südafrika",
    map: at(25, -29),
    productionCostBps: 8_800,
    labourCostBps: 8_300,
    demandPotentialBps: 9_600,
    imageBps: 9_500,
    taxRateBps: 2_700,
    politicalRisk: 45,
    tariffExposure: 35,
    disasterRisk: ["drought"],
    warRisk: 10,
    flag: ["#007a4d", "#ffb612", "#de3831"],
  },
  {
    key: "ng",
    name: "Nigeria",
    map: at(8, 9),
    productionCostBps: 7_800,
    labourCostBps: 7_000,
    demandPotentialBps: 10_000,
    imageBps: 8_500,
    taxRateBps: 3_000,
    politicalRisk: 70,
    tariffExposure: 50,
    disasterRisk: ["flood"],
    warRisk: 30,
    flag: ["#008751", "#ffffff", "#008751"],
    flagVertical: true,
  },
  {
    key: "pl",
    name: "Polen",
    map: at(19, 52),
    productionCostBps: 9_000,
    labourCostBps: 8_800,
    demandPotentialBps: 9_500,
    imageBps: 10_000,
    taxRateBps: 1_900,
    politicalRisk: 25,
    tariffExposure: 30,
    disasterRisk: ["flood"],
    warRisk: 30,
    flag: ["#ffffff", "#dc143c"],
  },
  {
    key: "vn",
    name: "Vietnam",
    map: at(106, 16),
    productionCostBps: 7_800,
    labourCostBps: 7_200,
    demandPotentialBps: 9_500,
    imageBps: 9_000,
    taxRateBps: 2_000,
    politicalRisk: 45,
    tariffExposure: 60,
    disasterRisk: ["storm", "flood"],
    warRisk: 15,
    flag: ["#da251d", "#ffff00"],
  },
  {
    key: "se",
    name: "Schweden",
    map: at(16, 62),
    productionCostBps: 10_600,
    labourCostBps: 12_000,
    demandPotentialBps: 9_700,
    imageBps: 12_500,
    taxRateBps: 2_100,
    politicalRisk: 5,
    tariffExposure: 30,
    disasterRisk: [],
    warRisk: 10,
    flag: ["#006aa7", "#fecc00"],
  },
  {
    key: "ie",
    name: "Irland",
    map: at(-8, 53),
    productionCostBps: 10_800,
    labourCostBps: 11_000,
    demandPotentialBps: 9_500,
    imageBps: 12_000,
    taxRateBps: 1_250,
    politicalRisk: 10,
    tariffExposure: 40,
    disasterRisk: [],
    warRisk: 5,
    flag: ["#169b62", "#ffffff", "#ff883e"],
    flagVertical: true,
  },
  {
    key: "tr",
    name: "Türkei",
    map: at(35, 39),
    productionCostBps: 8_600,
    labourCostBps: 8_400,
    demandPotentialBps: 10_000,
    imageBps: 9_000,
    taxRateBps: 2_500,
    politicalRisk: 55,
    tariffExposure: 45,
    disasterRisk: ["earthquake"],
    warRisk: 30,
    flag: ["#e30a17", "#ffffff"],
  },
];

export const HQ_TIER_KEYS = ["office", "complex", "campus", "tower", "mega"] as const;
export type HqTierKey = (typeof HQ_TIER_KEYS)[number];

export interface HqTierConfig {
  readonly tier: number;
  readonly key: HqTierKey;
  /** Price to build (tier 1) or to upgrade to this tier, from the company cash to the treasury. */
  readonly costCents: number;
  /** Extra places for employees (company_max_employees). */
  readonly seats: number;
  /** Prestige: permanent extra demand in basis points. */
  readonly demandBps: number;
  /** Once on reaching the tier: reputation points, awareness (company_awareness_add), satisfaction of a listed team. */
  readonly reputationPoints: number;
  readonly awarenessAdd: number;
  readonly satisfactionPoints: number;
  /** Prestige points on the profile and in the toplists. */
  readonly prestige: number;
}

export const HQ_STYLE_OPTIONS = {
  /** Wall, roof and sign colors (indices into the pixel palette of the headquarters icon). */
  wallColors: 8,
  roofColors: 8,
  roofs: ["flat", "gable", "dome", "antenna", "garden"],
  decorations: ["none", "trees", "fountain", "statue", "flags", "lights"],
} as const;

export const WORLD_RULES = {
  /** Company value (company_worth_cents, ADR-203) from which a company can place its headquarters. */
  unlockWorthCents: 1_000_000_000,
  hqTiers: [
    {
      tier: 1,
      key: "office",
      costCents: 100_000_000,
      seats: 5,
      demandBps: 0,
      reputationPoints: 1,
      awarenessAdd: 0.01,
      satisfactionPoints: 1,
      prestige: 1,
    },
    {
      tier: 2,
      key: "complex",
      costCents: 400_000_000,
      seats: 15,
      demandBps: 100,
      reputationPoints: 2,
      awarenessAdd: 0.02,
      satisfactionPoints: 2,
      prestige: 3,
    },
    {
      tier: 3,
      key: "campus",
      costCents: 1_500_000_000,
      seats: 40,
      demandBps: 200,
      reputationPoints: 3,
      awarenessAdd: 0.03,
      satisfactionPoints: 3,
      prestige: 7,
    },
    {
      tier: 4,
      key: "tower",
      costCents: 6_000_000_000,
      seats: 100,
      demandBps: 300,
      reputationPoints: 4,
      awarenessAdd: 0.04,
      satisfactionPoints: 4,
      prestige: 15,
    },
    {
      tier: 5,
      key: "mega",
      costCents: 25_000_000_000,
      seats: 250,
      demandBps: 400,
      reputationPoints: 5,
      awarenessAdd: 0.05,
      satisfactionPoints: 5,
      prestige: 30,
    },
  ] as readonly HqTierConfig[],
  /** Moving the headquarters: a share of everything paid for it (minimum below), then a cooldown. */
  relocation: { costBpsOfInvested: 2_000, minCostCents: 50_000_000, cooldownHours: 168 },
  effects: {
    /** How strongly the image (country baseline + campaigns) moves demand: 1 + (image − 1) × weight. */
    imageDemandWeightBps: 5_000,
    /** Effect factors stay inside these bounds (bps), whatever is stacked. */
    minFactorBps: 6_000,
    maxFactorBps: 16_000,
  },
  subsidiaries: {
    unlockWorthCents: 5_000_000_000,
    /** Alternatively a headquarters of at least this tier. */
    unlockHqTier: 2,
    max: 4,
    /** Setup cost of the n-th subsidiary: setupCostCents × (setupGrowthBps / 10 000)^(n − 1). */
    setupCostCents: 300_000_000,
    setupGrowthBps: 16_000,
    /** Running costs per hour; during the ramp-up × rampUpCostMultiplier, falling to × 1 at the end. */
    hourlyCostCents: 60_000,
    rampUpHours: 336,
    rampUpCostMultiplier: 3,
    /** Share of the revenue made at the country's terms (full after the ramp-up); every further one × diminishingBps. */
    revenueShareBps: 1_500,
    /** Extra demand of the new market (full after the ramp-up), diminishing like the share. */
    demandBonusBps: 500,
    diminishingBps: 6_000,
  },
  imageCampaign: {
    /** Price: costBpsOfWorth of the company value, at least minCostCents. */
    costBpsOfWorth: 50,
    minCostCents: 20_000_000,
    gainBps: 500,
    /** The bonus of a country never exceeds this; it fades by decayPerDayBps a day. */
    maxBonusBps: 3_000,
    decayPerDayBps: 100,
    cooldownHours: 12,
  },
  lobby: {
    /** The market leader may ask up to maxFeeBps of the hourly revenue of every other player company in its country. */
    maxFeeBps: 300,
    feeChangeCooldownHours: 24,
    /** Lobby bonus of the leader, read by taxes and external events (ADR-209). */
    taxDiscountBps: 1_000,
    politicalImpactReductionBps: 3_000,
    /** A company only leads with at least this value (no lobby for tiny companies). */
    minWorthCents: 1_000_000_000,
  },
  /** Weights of the balance check (score per bps of advantage; risks per point). */
  balance: {
    production: 0.5,
    labour: 0.3,
    demand: 1,
    image: 0.5,
    taxBaselineBps: 2_500,
    tax: 0.2,
    political: 4,
    tariff: 3,
    war: 6,
    disaster: 120,
    tolerance: 400,
  },
} as const;

export type WorldConfig = typeof WORLD_RULES;
