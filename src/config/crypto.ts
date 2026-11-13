/**
 * Cryptocurrencies (ADR-101). Every coin trades against a liquidity pool (constant product, x · y = k): buying puts
 * cash in and takes coins out, so every trade moves the price, small pools much more than big ones. The market
 * (AI traders) trades against the same pools every tick, so prices move 24/7 and far more than stocks. Players can
 * develop their own coin: build technology, hype and utility, launch it with their own liquidity, and either keep their
 * word or pull the rug (and lose their trust).
 *
 * Plain data, no imports: runs unchanged in Deno and is mirrored in Postgres (game_config.crypto).
 */
export type CoinCategory = "stable" | "major" | "alt" | "meme" | "player";
export type CryptoRegime = "bull" | "flat" | "bear";

export interface CoinCategoryConfig {
  /** Daily volatility of the log price. */
  readonly sigmaDay: number;
  /** Share of the moves that follow the whole crypto market (0..1). */
  readonly beta: number;
  /** Pool fee per trade in bps (stays in the pool). */
  readonly feeBps: number;
  /** Stablecoins: pull back to the peg per hour (share of the gap). */
  readonly pegPullPerHour: number;
}

export interface CoinSeed {
  readonly ticker: string;
  readonly name: string;
  readonly category: Exclude<CoinCategory, "player">;
  /** Start price in E4 (1 € = 10 000). Stablecoins: also the peg. */
  readonly priceE4: number;
  /** Cash in the pool at the start, in cents (the market's depth). */
  readonly poolCents: number;
  /** Algorithmic stablecoins lose their peg more often. */
  readonly algorithmic?: boolean;
  /** Pixel logo colours (data, not UI tokens). */
  readonly color: string;
}

export type CoinEventKey =
  | "hack"
  | "bug"
  | "influencer"
  | "exchange_listing"
  | "delisting_rumor"
  | "whale_buy"
  | "whale_dump"
  | "partnership"
  | "fud"
  | "network_upgrade"
  | "depeg"
  | "meme_wave"
  | "regulation"
  | "rug_pull";

export interface CoinEventConfig {
  readonly key: CoinEventKey;
  /** Who can be hit: categories, or "market" for events that move every coin. */
  readonly scope: readonly (CoinCategory | "market")[];
  /** Base chance per coin and hour in bps (market events: per hour for the whole market). */
  readonly chanceBps: number;
  /** Price shock as a range of log returns. */
  readonly shockMin: number;
  readonly shockMax: number;
  /** Changes of the stats of a player coin. */
  readonly hype?: number;
  readonly utility?: number;
  readonly tech?: number;
  /** Share of the pool's cash that is lost (hacks). */
  readonly poolLossShare?: number;
}

export type CoinActionKey =
  "smart_contract" | "audit" | "community" | "influencer" | "partnership" | "staking" | "bugfix" | "marketing_burn";

export interface CoinActionConfig {
  readonly key: CoinActionKey;
  readonly hours: number;
  readonly costCents: number;
  readonly tech?: number;
  readonly hype?: number;
  readonly utility?: number;
  /** Chance of success without skills (bps); IT skills add `itBpsPerScore` each. Missing = always succeeds. */
  readonly baseBps?: number;
  /** Only possible after launch. */
  readonly afterLaunch?: boolean;
}

export interface CryptoConfig {
  readonly minLevel: number;
  readonly createMinLevel: number;
  /** One market tick every this many seconds (like stocks: prices move all the time). */
  readonly tickSeconds: number;
  readonly categories: Readonly<Record<CoinCategory, CoinCategoryConfig>>;
  readonly coins: readonly CoinSeed[];
  /** The whole crypto market: drift per day for beta 1, and how long a regime lasts. */
  readonly regimes: Readonly<Record<CryptoRegime, { readonly driftDay: number; readonly weight: number }>>;
  readonly regimeHoursMin: number;
  readonly regimeHoursMax: number;
  /** AI meme coins: a rug pull leaves the coin dead; after this many hours a new meme coin takes its place. */
  readonly deadCoinReplaceHours: number;
  /** A coin whose price falls below this (E4) is dead. */
  readonly deadPriceE4: number;
  readonly memeNames: readonly string[];
  readonly events: readonly CoinEventConfig[];
  /** Own coins (ADR-101). */
  readonly create: {
    readonly costCents: number;
    readonly minLiquidityCents: number;
    /** Start prices a creator can pick (E4). The supply follows from liquidity and price. */
    readonly startPriceOptionsE4: readonly number[];
    readonly teamShareMinBps: number;
    readonly teamShareMaxBps: number;
    /** Technology needed for the launch. */
    readonly launchMinTech: number;
    readonly nameMinLength: number;
    readonly nameMaxLength: number;
    readonly tickerMinLength: number;
    readonly tickerMaxLength: number;
    /** Hype and utility fade each hour (factor); technology stays. */
    readonly hypeDecayPerHour: number;
    readonly utilityDecayPerHour: number;
    /** Daily drift of an own coin: hype and utility push, a base selling pressure pulls. */
    readonly driftPerHype: number;
    readonly driftPerUtility: number;
    readonly driftBase: number;
    /** Volatility of an own coin; good technology calms it down. */
    readonly sigmaDay: number;
    readonly sigmaTechDamping: number;
    /** IT skill points raise the chance of technical actions. */
    readonly itBpsPerScore: number;
    readonly actions: readonly CoinActionConfig[];
    /** Selling more than this share of the team tokens within a day counts as a rug pull. */
    readonly rugShareBps: number;
    readonly rugWindowHours: number;
    /** A paid influencer is exposed when the action fails: hype loss and a price shock (log return). */
    readonly exposedHype: number;
    readonly exposedShock: number;
    /** Smallest burn as a share of the team coins at launch (one burn per marketing_burn hours). */
    readonly burnMinBps: number;
  };
}

export const CRYPTO: CryptoConfig = {
  minLevel: 10,
  createMinLevel: 14,
  tickSeconds: 5,
  categories: {
    stable: { sigmaDay: 0.002, beta: 0, feeBps: 5, pegPullPerHour: 0.5 },
    major: { sigmaDay: 0.06, beta: 1, feeBps: 10, pegPullPerHour: 0 },
    alt: { sigmaDay: 0.14, beta: 1.3, feeBps: 30, pegPullPerHour: 0 },
    meme: { sigmaDay: 0.4, beta: 1.6, feeBps: 100, pegPullPerHour: 0 },
    player: { sigmaDay: 0.35, beta: 1.2, feeBps: 100, pegPullPerHour: 0 },
  },
  coins: [
    {
      ticker: "EUS",
      name: "Eins-Stabil",
      category: "stable",
      priceE4: 10_000,
      poolCents: 5_000_000_000,
      color: "#4f8cff",
    },
    {
      ticker: "NXS",
      name: "Nexa-Stable",
      category: "stable",
      priceE4: 10_000,
      poolCents: 3_000_000_000,
      color: "#7c5cff",
    },
    {
      ticker: "ALGS",
      name: "Algostabil",
      category: "stable",
      priceE4: 10_000,
      poolCents: 800_000_000,
      algorithmic: true,
      color: "#2fd98c",
    },
    {
      ticker: "GTL",
      name: "Goldtaler",
      category: "stable",
      priceE4: 600_000,
      poolCents: 1_500_000_000,
      color: "#f2c14e",
    },
    {
      ticker: "KTL",
      name: "Kryptaler",
      category: "major",
      priceE4: 420_000_000,
      poolCents: 10_000_000_000,
      color: "#ff9a52",
    },
    {
      ticker: "NBC",
      name: "Nebula Chain",
      category: "major",
      priceE4: 21_000_000,
      poolCents: 5_000_000_000,
      color: "#9b7bff",
    },
    { ticker: "QTR", name: "Quantor", category: "major", priceE4: 850_000, poolCents: 2_000_000_000, color: "#2bc3d9" },
    { ticker: "FLX", name: "Flux", category: "alt", priceE4: 12_000, poolCents: 300_000_000, color: "#ef5b5b" },
    { ticker: "ORB", name: "Orbit", category: "alt", priceE4: 4_500, poolCents: 150_000_000, color: "#8e99ad" },
    { ticker: "SNP", name: "Synapse", category: "alt", priceE4: 120_000, poolCents: 200_000_000, color: "#c8553d" },
    { ticker: "HMR", name: "Hamsterrakete", category: "meme", priceE4: 420, poolCents: 30_000_000, color: "#e0a92e" },
    { ticker: "MKS", name: "Mondkeks", category: "meme", priceE4: 690, poolCents: 15_000_000, color: "#c9d2e0" },
    { ticker: "LFR", name: "Laserfrosch", category: "meme", priceE4: 1_000, poolCents: 25_000_000, color: "#2f7a4a" },
    { ticker: "TBZ", name: "Turbobrezel", category: "meme", priceE4: 2_500, poolCents: 10_000_000, color: "#a0612c" },
    { ticker: "PPD", name: "Pixelpudel", category: "meme", priceE4: 150, poolCents: 8_000_000, color: "#f8bbd0" },
  ],
  regimes: {
    bull: { driftDay: 0.03, weight: 0.3 },
    flat: { driftDay: 0, weight: 0.45 },
    bear: { driftDay: -0.03, weight: 0.25 },
  },
  regimeHoursMin: 24,
  regimeHoursMax: 72,
  deadCoinReplaceHours: 24,
  deadPriceE4: 2,
  memeNames: [
    "Katzenkanone",
    "Wurstwal",
    "Raketenrentner",
    "Glitzergurke",
    "Turbotoaster",
    "Mondmaulwurf",
    "Laserlama",
    "Pixelpinguin",
    "Bananenbank",
    "Sockensaurus",
    "Kometenkrabbe",
    "Diamanthamster",
  ],
  events: [
    {
      key: "hack",
      scope: ["alt", "meme", "player"],
      chanceBps: 20,
      shockMin: -0.9,
      shockMax: -0.35,
      tech: -10,
      hype: -30,
      poolLossShare: 0.2,
    },
    {
      key: "bug",
      scope: ["alt", "meme", "player"],
      chanceBps: 40,
      shockMin: -0.25,
      shockMax: -0.08,
      tech: -5,
      hype: -5,
    },
    { key: "influencer", scope: ["alt", "meme", "player"], chanceBps: 60, shockMin: 0.25, shockMax: 1.2, hype: 20 },
    {
      key: "exchange_listing",
      scope: ["alt", "meme", "player"],
      chanceBps: 25,
      shockMin: 0.2,
      shockMax: 0.6,
      utility: 10,
    },
    {
      key: "delisting_rumor",
      scope: ["alt", "meme", "player"],
      chanceBps: 30,
      shockMin: -0.35,
      shockMax: -0.1,
      hype: -10,
    },
    { key: "whale_buy", scope: ["major", "alt", "meme", "player"], chanceBps: 50, shockMin: 0.1, shockMax: 0.4 },
    { key: "whale_dump", scope: ["major", "alt", "meme", "player"], chanceBps: 50, shockMin: -0.4, shockMax: -0.1 },
    {
      key: "partnership",
      scope: ["major", "alt", "player"],
      chanceBps: 30,
      shockMin: 0.1,
      shockMax: 0.35,
      utility: 15,
    },
    { key: "fud", scope: ["major", "alt", "meme", "player"], chanceBps: 60, shockMin: -0.3, shockMax: -0.05, hype: -8 },
    { key: "network_upgrade", scope: ["major", "alt"], chanceBps: 20, shockMin: 0.05, shockMax: 0.2 },
    { key: "depeg", scope: ["stable"], chanceBps: 3, shockMin: -0.4, shockMax: -0.03 },
    { key: "meme_wave", scope: ["market"], chanceBps: 40, shockMin: 0.2, shockMax: 0.8 },
    { key: "regulation", scope: ["market"], chanceBps: 25, shockMin: -0.25, shockMax: -0.05 },
    { key: "rug_pull", scope: ["meme"], chanceBps: 12, shockMin: -4.5, shockMax: -2.5 },
  ],
  create: {
    costCents: 2_500_000,
    minLiquidityCents: 500_000,
    startPriceOptionsE4: [100, 1_000, 10_000, 100_000],
    teamShareMinBps: 1_000,
    teamShareMaxBps: 5_000,
    launchMinTech: 20,
    nameMinLength: 3,
    nameMaxLength: 24,
    tickerMinLength: 3,
    tickerMaxLength: 5,
    hypeDecayPerHour: 0.97,
    utilityDecayPerHour: 0.995,
    driftPerHype: 0.2,
    driftPerUtility: 0.08,
    driftBase: -0.06,
    sigmaDay: 0.35,
    sigmaTechDamping: 0.5,
    itBpsPerScore: 300,
    actions: [
      { key: "smart_contract", hours: 6, costCents: 200_000, tech: 15, baseBps: 5_000 },
      { key: "audit", hours: 24, costCents: 1_500_000, tech: 35 },
      { key: "community", hours: 4, costCents: 50_000, hype: 10 },
      { key: "influencer", hours: 2, costCents: 800_000, hype: 35, baseBps: 8_500 },
      { key: "partnership", hours: 12, costCents: 600_000, utility: 20, baseBps: 7_000, afterLaunch: true },
      { key: "staking", hours: 12, costCents: 500_000, utility: 15, afterLaunch: true },
      { key: "bugfix", hours: 3, costCents: 100_000, tech: 5 },
      { key: "marketing_burn", hours: 1, costCents: 0, hype: 8, afterLaunch: true },
    ],
    rugShareBps: 2_000,
    rugWindowHours: 24,
    exposedHype: -20,
    exposedShock: -0.1625,
    burnMinBps: 100,
  },
};
