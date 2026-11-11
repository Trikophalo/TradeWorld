/**
 * NEXA balancing defaults (ADR-009).
 *
 * This file is the single source of truth for every tunable number in the game.
 * Each top-level key of `BALANCE` becomes one row (one JSON document) of the DB
 * table `game_config`; at runtime the table wins, this file is the default and
 * the type definition.
 *
 * Purity rules (ADR-012): no imports, no path aliases, JSON-serialisable values only.
 *
 * Unit conventions
 * - `*Cents`      money in euro cents as a plain integer `number`. In the simulation
 *                 and the database money is `bigint`; here plain integers are used so
 *                 the sections stay JSON-serialisable. Every value is far below 2^53.
 *                 Convert with `BigInt(value)` (see `src/lib/sim/money.ts`).
 * - `*E4`         price with fixed scale 1 EUR = 10 000 (ADR-003), plain integer.
 * - `*Bps`        basis points, 1 bp = 0.01 %.
 * - "game year"   4 quarters = 24 real hours. All annual rates are per GAME year.
 * - everything else (exponents, probabilities, multipliers) is a plain `number`.
 */

export type SectorId = "tech" | "retail" | "energy" | "pharma" | "logistics";
export type SizeClass = "bluechip" | "midcap" | "penny";
export type CompanyTierId = "small_business" | "gmbh" | "ag" | "listed";
/** Market segment a company sells in. Every company tier has exactly one segment. */
export type SegmentId = "local" | "regional" | "national" | "international";
export type DepartmentId = "development" | "sales" | "production" | "finance" | "marketing";
export type JobTierId = "intern" | "junior" | "senior" | "team_lead" | "c_level";
export type InvestorArchetypeId =
  "market_maker" | "value_fund" | "momentum_trader" | "pension_fund" | "index_fund" | "retail_herd";

export interface TimeConfig {
  readonly quarterHours: number;
  readonly quartersPerGameYear: number;
  readonly timezone: string;
  /** Local wall-clock hours at which a quarter ends (ADR-006). */
  readonly quarterBoundaryHours: readonly number[];
  readonly marketOpenHour: number;
  readonly marketCloseHour: number;
  readonly tickSeconds: number;
  readonly ticksPerRunnerInvocation: number;
  readonly afterHours: {
    readonly spreadMultiplier: number;
    readonly liquidityMultiplier: number;
    readonly volatilityMultiplier: number;
  };
  readonly candleIntervalsSeconds: readonly number[];
  readonly openingBonusMinutes: number;
  readonly openingBonusXpMultiplier: number;
}

export interface EconomyConfig {
  readonly startingCapitalCents: number;
  readonly bankruptcyRestartCents: number;
  readonly basicIncomeCentsPerHour: number;
  readonly vaultCapHours: number;
  /**
   * Hours of basic income already in the vault of a new account, so the tutorial
   * has something to claim right away.
   */
  readonly vaultInitialHours: number;
  /** Smallest amount the vault can be emptied for. */
  readonly vaultMinClaimCents: number;
  readonly bankruptcyStatusGameDays: number;
  readonly bankruptcyReputationPenalty: number;
}

export interface LeverageTier {
  readonly level: number;
  readonly maxLeverage: number;
}

export interface TradingConfig {
  readonly orderFeeCents: number;
  /** Largest number of shares per order. */
  readonly maxOrderQuantity: number;
  /**
   * Fractional shares (owner decision, ADR-040): share quantities are stored in
   * millionths. Smallest tradable step and smallest order value.
   */
  readonly quantityScale: number;
  readonly minOrderValueCents: number;
  readonly capitalGainsTaxBps: number;
  /** Bond coupons and dividends are taxed at this rate when paid out. */
  readonly incomeTaxOnCouponsAndDividendsBps: number;
  readonly spread: {
    /** Half spread (mid to bid, mid to ask) per size class during market hours. */
    readonly halfSpreadBps: Readonly<Record<SizeClass, number>>;
    /** Extra half spread per unit of |sentiment| (nervous markets quote wider). */
    readonly sentimentWideningBps: number;
    readonly minHalfSpreadE4: number;
  };
  readonly priceImpact: {
    /** Price move in bps caused by trading exactly one "depth" worth of shares. */
    readonly impactBpsPerDepth: number;
    /** One depth = this fraction of the free float. */
    readonly depthFreeFloatFraction: number;
    /** 1 = linear (split-invariant). See docs/SIMULATION.md. */
    readonly exponent: number;
    /** Share of the full impact applied to the mid price immediately after a player trade. */
    readonly immediateShare: number;
    /** Share of a player trade the market maker hedges in the market over time. */
    readonly marketMakerHedgeShare: number;
    /** Orders that would move the price further than this are only partially filled. */
    readonly maxImpactBpsPerOrder: number;
  };
  readonly orderBook: {
    readonly levelsPerSide: number;
    readonly levelStepBps: number;
    /** Cosmetic size jitter of synthetic levels (0.2 = +-20 %). */
    readonly sizeJitter: number;
  };
  /** Added to the policy rate; annual (game year), accrued by the second on borrowed notional. */
  readonly financingSpreadBps: number;
  /** Annual (game year) borrow fee for short positions on the shorted notional. */
  readonly borrowFeeBps: Readonly<Record<SizeClass, number>>;
  readonly leverageTiers: readonly LeverageTier[];
  readonly shortSellingMinLevel: number;
  readonly maintenanceMarginBps: number;
  readonly marginCallWarningMarginBps: number;
  readonly liquidationFeeBps: number;
  readonly washTradeWindowSeconds: number;
  readonly minPriceE4: number;
  /** Circuit breaker for the non-event part of a tick return. */
  readonly maxTickReturnBps: number;
}

export interface CentralBankConfig {
  readonly startRateBps: number;
  readonly neutralRateBps: number;
  readonly minRateBps: number;
  readonly maxRateBps: number;
  readonly stepBps: number;
  readonly maxStepsPerDecision: number;
  /** Target growth of the money supply per active player and game year. */
  readonly targetMoneyGrowthBps: number;
  /** One step is taken per full band of deviation from the target. */
  readonly toleranceBandBps: number;
  readonly decisionEveryQuarters: number;
  /** Quarters after game start without rate decisions (see docs/BALANCING.md). */
  readonly warmupQuarters: number;
  readonly announceLeadQuarters: number;
  /** Number of past quarters over which money growth is measured. */
  readonly measurementWindowQuarters: number;
  /** Players count as active if they logged in within this many real days. */
  readonly activePlayerWindowDays: number;
}

export interface BondsConfig {
  readonly faceValueCents: number;
  readonly couponsPerGameYear: number;
  readonly maturities: readonly {
    readonly years: number;
    /** Yield = policy rate + spread, then clamped to [minYieldBps, maxYieldBps]. */
    readonly spreadBps: number;
  }[];
  readonly minYieldBps: number;
  readonly maxYieldBps: number;
  readonly minLevel: number;
}

export interface SectorConfig {
  /**
   * Customer spending per quarter in the international segment at baseline
   * (cycle = oil = 1, neutral rate). The smaller segments are shares of this value.
   */
  readonly baseDemandCentsPerQuarter: number;
  readonly demandGrowthBpsPerGameYear: number;
  /** Standard deviation of the random quarterly demand factor. */
  readonly demandNoise: number;
  readonly peRatio: number;
  /** Multiplier on the per-size-class tick volatility. */
  readonly volatilityMultiplier: number;
  /**
   * Price exponent of the attractiveness formula in this sector: how strongly
   * customers punish a higher price. Spec start value is 1.5 for all sectors;
   * see docs/BALANCING.md for why it differs by sector.
   */
  readonly priceExponent: number;
  readonly costStructure: {
    /** Price of the established suppliers; the profit-maximising price of a small company at baseline costs. */
    readonly referencePriceCents: number;
    readonly unitCostCents: number;
    /** Units one effective production skill point can deliver per quarter. */
    readonly capacityUnitsPerSkillPoint: number;
    /** Multiplier on the fixed costs of the company tier (capital intensity). */
    readonly fixedCostMultiplier: number;
    /** Share of the gap between quality and its target closed per quarter (how fast products age). */
    readonly qualityAdjustmentRate: number;
    /** Development effort needed for the same quality relative to other sectors. */
    readonly developmentIntensity: number;
  };
  readonly sensitivity: {
    /** Elasticity of sector demand to the oil index. */
    readonly oilDemand: number;
    /** Elasticity of unit costs to the oil index. */
    readonly oilCost: number;
    /** Relative demand change per +100 bps of policy rate above neutral. */
    readonly ratePer100Bps: number;
    /** Elasticity of sector demand to the business cycle index. */
    readonly cycle: number;
    /** Multiplier on the macro (rate) factor of the fair value. */
    readonly valuationRate: number;
  };
}

export interface CompanyTierConfig {
  readonly id: CompanyTierId;
  readonly minLevel: number;
  readonly foundingCostCents: number;
  readonly fixedCostCentsPerQuarter: number;
  readonly maxEmployees: number;
  readonly creditLineCents: number;
}

export interface SegmentConfig {
  /** The company tier that sells in this segment. */
  readonly tier: CompanyTierId;
  /** Segment demand as a share of the sector's (international) demand. */
  readonly demandShare: number;
  /**
   * Whether the segment grows with the sector trend. Only the international
   * market does; local, regional and national markets have a fixed size, so a
   * company has to move up a tier to grow beyond them.
   */
  readonly growsWithSector: boolean;
  /**
   * The established suppliers of the segment, modelled as one anonymous
   * competitor with unlimited capacity that prices at the reference price.
   * Awareness 0 = no anonymous incumbents (international: the AI companies are the incumbents).
   */
  readonly incumbentQuality: number;
  readonly incumbentAwareness: number;
}

export interface CompanyConfig {
  readonly attractiveness: {
    readonly qualityExponent: number;
    readonly awarenessExponent: number;
    /** Spec start value. The value actually used is `sectors[x].priceExponent`. */
    readonly priceExponent: number;
  };
  readonly segments: Readonly<Record<SegmentId, SegmentConfig>>;
  readonly marketing: {
    /** log2(1.4): doubling the budget multiplies the awareness gain by 1.4. */
    readonly diminishingReturnsExponent: number;
    /** Reference budget as a share of the baseline demand of the company's segment. */
    readonly referenceBudgetShareOfSegmentDemand: number;
    /** Awareness gain (share of the not-yet-aware market) at the reference budget. */
    readonly gainAtReferenceBudget: number;
    readonly maxGainPerQuarter: number;
    readonly awarenessDecayPerQuarter: number;
    readonly initialAwareness: number;
    readonly minAwareness: number;
    /** Marketing department: budget counts up to (1 + max) times, half of it at the given skill points. */
    readonly departmentMaxBoost: number;
    readonly departmentHalfSaturationSkillPoints: number;
  };
  readonly quality: {
    readonly initial: number;
    readonly min: number;
    readonly max: number;
    /**
     * Quality target = max x saturation ^ targetExponent with
     * x = devPoints / (developmentIntensity x (halfSaturationSkillPoints + productionScale x productionPoints)),
     * saturation = x / (1 + x). Larger companies need more developers for the same quality.
     */
    readonly halfSaturationSkillPoints: number;
    readonly productionScale: number;
    readonly targetExponent: number;
  };
  readonly sales: {
    /** Attractiveness boost per effective sales skill point. */
    readonly boostPerSkillPoint: number;
    readonly maxBoost: number;
  };
  /** Finance department: lowers fixed costs by up to `maxFixedCostReduction`, half of it at the given skill points. */
  readonly finance: {
    readonly maxFixedCostReduction: number;
    readonly halfSaturationSkillPoints: number;
  };
  /** Productivity in the first quarters after hiring; afterwards 1. */
  readonly onboardingRamp: readonly number[];
  readonly tiers: readonly CompanyTierConfig[];
  readonly smallBusinessExpansion: { readonly minLevel: number; readonly maxEmployees: number };
  /** Fee for converting into a tier, as a share of that tier's founding cost. */
  readonly conversionFeeBps: number;
  readonly founderCapital: {
    /** Cap on private money put in at founding, as a multiple of the founding cost. */
    readonly foundingMultiple: number;
    /** Additional private money per game year in the growth phase, same multiple base. */
    readonly growthMultiplePerGameYear: number;
    /** After the IPO the founder cannot inject private money (capital increase only). */
    readonly listedMultiplePerGameYear: number;
  };
  readonly corporateTaxBps: number;
  readonly insolvency: {
    /**
     * Grace period: a company is insolvent when its cash is still negative
     * `graceQuarters` quarter closes after the first negative close
     * (4 = one real day between the first warning and the insolvency).
     */
    readonly graceQuarters: number;
    readonly foundingLockoutGameDays: number;
    /** Overdraft rate = policy rate + this spread while cash is negative. */
    readonly overdraftSpreadBps: number;
    readonly priceCrashReturn: number;
  };
  /** Range of the price slider as multiples of the sector reference price (sanity bounds, not a balancing cap). */
  readonly priceBand: { readonly minFactor: number; readonly maxFactor: number };
  readonly aiPolicy: {
    readonly marketingShareOfRevenue: number;
    readonly dividendPayoutRatio: number;
    /** Standard deviation of the quarterly log price change. */
    readonly priceNoise: number;
    /** Share of the gap to the cost-adjusted reference price closed per quarter. */
    readonly priceReversion: number;
    /** AI companies hire above and fire below target utilisation +- band. */
    readonly targetUtilization: number;
    readonly utilizationBand: number;
    readonly hiringRatePerQuarter: number;
    readonly firingRatePerQuarter: number;
    /** How much of last quarter's revenue surprise carries over (0..1). */
    readonly revenueNoisePersistence: number;
    /** Share of a revenue surprise that also shows up in costs. */
    readonly costNoiseShare: number;
  };
}

export interface IpoConfig {
  readonly minLevel: number;
  readonly minHistoryQuarters: number;
  readonly minTrailingRevenueCents: number;
  readonly minReputation: number;
  readonly requiresCfo: boolean;
  readonly defaultLockupQuarters: number;
  readonly subscriptionQuarters: number;
  readonly minFloatBps: number;
  readonly maxFloatBps: number;
  /** Mid of the price range = fair value x (1 - discount). */
  readonly discountBps: number;
  readonly rangeHalfWidthBps: number;
  /** Coverage (subscribed / offered) below which the IPO fails. */
  readonly minCoverage: number;
  /** Coverage at which the price reaches the top of the range. */
  readonly fullPriceCoverage: number;
  readonly aiDemand: {
    readonly baseCoverage: number;
    readonly priceElasticity: number;
    readonly sentimentWeight: number;
    readonly noise: number;
  };
}

export interface ReputationConfig {
  readonly start: number;
  readonly min: number;
  readonly max: number;
  readonly valuationFactorMin: number;
  readonly valuationFactorMax: number;
  readonly guidanceMissThreshold: number;
  readonly guidanceHitThreshold: number;
  readonly deltas: {
    readonly guidanceMet: number;
    readonly guidanceMissed: number;
    readonly lockupKept: number;
    readonly longHoldPerGameYear: number;
    readonly postIpoDumping: number;
    readonly reliableDividend: number;
    readonly dividendCut: number;
    readonly repeatedCapitalIncrease: number;
    readonly useOfProceedsKept: number;
    readonly useOfProceedsDeviated: number;
    readonly employeeTenure: number;
    readonly insiderViolation: number;
    readonly ipoFailed: number;
    readonly insolvency: number;
    readonly playerBankruptcy: number;
  };
}

export interface LoansConfig {
  readonly basePremiumBps: number;
  /** Premium per missing reputation point below 100. */
  readonly reputationBpsPerPoint: number;
  /** Premium per 1.0 of debt-to-equity. */
  readonly leverageBpsPerDebtToEquity: number;
  readonly maxLeveragePremiumBps: number;
  readonly lossMakingPremiumBps: number;
  /** Discount for profitable borrowers, per 1.0 of interest coverage above 1. */
  readonly coverageDiscountBpsPerTurn: number;
  readonly maxCoverageDiscountBps: number;
  readonly cfoDiscountBpsPerSkill: number;
  readonly minPremiumBps: number;
  readonly maxPremiumBps: number;
  readonly creditLinesByLevel: readonly { readonly level: number; readonly limitCents: number }[];
  /** Credit line multiplier = min + (max - min) x reputation / 100. */
  readonly creditLineReputationFactorMin: number;
  readonly creditLineReputationFactorMax: number;
}

export interface EmployeeTraitConfig {
  readonly key: string;
  readonly performanceMultiplier: number;
  readonly salaryMultiplier: number;
  readonly loyaltyDecayMultiplier: number;
}

export interface EmployeesConfig {
  readonly minSkill: number;
  readonly maxSkill: number;
  /** Effective capacity points = skill ^ exponent. */
  readonly skillCapacityExponent: number;
  /** Salary per quarter = base x skill ^ exponent. */
  readonly salaryBaseCentsPerQuarter: number;
  readonly salarySkillExponent: number;
  readonly playerProductivityMultiplier: number;
  readonly traits: readonly EmployeeTraitConfig[];
  readonly loyalty: {
    readonly start: number;
    readonly quitThreshold: number;
    readonly decayPerQuarterOnSalaryFreeze: number;
    readonly gainPerQuarterOnRaise: number;
    readonly poachingSalaryPremiumBps: number;
  };
  readonly leadership: {
    readonly cooCapacityBonusPerSkill: number;
    readonly ctoDevelopmentTimeReductionPerSkill: number;
    readonly headOfSalesBoostPerSkill: number;
    /** Narrows the forecast range shown to the founder when giving guidance (UI preview, M6). */
    readonly cfoGuidanceBandReductionPerSkill: number;
  };
  readonly applicantPoolSize: number;
  readonly insiderLockHours: number;
  readonly insiderDetectionProbability: number;
  readonly insiderFineBps: number;
  readonly maxSideRoles: number;
  readonly optionVestingQuarters: number;
}

export interface JobTierConfig {
  readonly id: JobTierId;
  readonly minLevel: number;
  readonly salaryCentsPerHour: number;
  readonly stockOptions: boolean;
}

export interface CareersConfig {
  readonly tiers: readonly JobTierConfig[];
  readonly paidHoursPerDayCap: number;
  readonly playerCompanyExperienceMultiplier: number;
  readonly promotionSteps: readonly {
    readonly experienceHours: number;
    readonly raiseBps: number;
  }[];
  readonly negotiation: {
    readonly cooldownDays: number;
    readonly baseSuccessProbability: number;
    readonly successPerExperienceHour: number;
    readonly maxSuccessProbability: number;
    readonly raiseMinBps: number;
    readonly raiseMaxBps: number;
  };
  readonly jobSwitch: { readonly raiseMinBps: number; readonly raiseMaxBps: number };
  readonly workTask: {
    readonly intervalHours: number;
    /** Bonus = hours of salary x quality (0..1). */
    readonly bonusSalaryHours: number;
  };
}

export interface UnlockConfig {
  readonly level: number;
  readonly key: string;
}

export interface ProgressionConfig {
  readonly xpBase: number;
  readonly xpExponent: number;
  /**
   * Levels are endless (owner decision, ADR-039). This is only a technical
   * ceiling far beyond reach; features unlock up to level 50, prestige titles after.
   */
  readonly maxLevel: number;
  /** From this level on, every `titleEveryLevels` levels brings a new prestige title. */
  readonly prestige: { readonly fromLevel: number; readonly titleEveryLevels: number };
  /**
   * Global multiplier, 1 = spec values. Applied exactly once, when XP are granted
   * (`scaledXp()` in src/lib/sim/progression.ts); all other values are base XP.
   */
  readonly xpMultiplier: number;
  readonly xpSources: {
    readonly trade: {
      readonly xp: number;
      readonly maxTradesPerDay: number;
      /** Orders below this value give no XP (no farming with 1-share trades). */
      readonly minOrderValueCents: number;
    };
    readonly profitableClose: { readonly profitCentsPerXp: number; readonly maxXpPerTrade: number };
    readonly workHour: {
      readonly xp: number;
      readonly playerCompanyMultiplier: number;
      readonly maxHoursPerDay: number;
    };
    readonly workTask: { readonly minXp: number; readonly maxXp: number };
    readonly dailyMission: { readonly minXp: number; readonly maxXp: number; readonly perDay: number };
    /** Quick missions (a few minutes): always this many active, a new one replaces each claimed one. */
    readonly quickMission: { readonly minXp: number; readonly maxXp: number; readonly active: number };
    /** Weekly missions (several sessions), reset Monday 00:00 Berlin. */
    readonly weeklyMission: { readonly minXp: number; readonly maxXp: number; readonly perWeek: number };
    /** One-time story missions along the way (first trade, first 15.000 € ...); this many shown at once. */
    readonly milestoneMission: { readonly minXp: number; readonly maxXp: number; readonly visible: number };
    readonly dailyLogin: {
      readonly xp: number;
      readonly streakBonusPerDay: number;
      readonly streakBonusCap: number;
      readonly streakFreezesPerWeek: number;
    };
    readonly profitableCompanyQuarter: { readonly xp: number };
    readonly successfulIpo: { readonly xp: number };
    readonly achievement: { readonly minXp: number; readonly maxXp: number };
    /** One-time reward for finishing the tutorial. With the alpha multiplier it lifts a new player to level 2. */
    readonly tutorial: { readonly xp: number };
  };
  readonly unlocks: readonly UnlockConfig[];
}

export interface ValuationConfig {
  /** Fair value growth factor = 1 + weight x trailing revenue growth, clamped. */
  readonly growthWeight: number;
  readonly growthFactorMin: number;
  readonly growthFactorMax: number;
  /** Relative fair value change per +100 bps of policy rate above neutral. */
  readonly macroSensitivityPer100Bps: number;
  readonly macroFactorMin: number;
  readonly macroFactorMax: number;
  /** Floor: this share of book value per share (loss-making companies). */
  readonly bookValueFloorShare: number;
  /** Loss-making companies: fair value moves with revenue at this elasticity. */
  readonly lossMakerRevenueElasticity: number;
  readonly analystTargetNoise: number;
  readonly analystWrongProbability: number;
}

export interface InvestorArchetypeConfig {
  /** Share of the free float this archetype steers. */
  readonly capitalShare: number;
  /** Reaction speed: fraction of its capital traded per tick at full signal (flow types) or fraction of the gap to target closed per tick (stock types). */
  readonly reactionSpeed: number;
  readonly params: Readonly<Record<string, number>>;
}

export interface AiInvestorsConfig {
  /** Standard deviation of the noise return per tick in bps, per size class. */
  readonly tickNoiseBps: Readonly<Record<SizeClass, number>>;
  /**
   * Global multiplier on tickNoiseBps. Calibrated with the database tick over a
   * simulated day (docs/BALANCING.md): blue chips about 3 %, mid caps 6-7 %,
   * penny stocks 16-19 % daily range.
   */
  readonly tickNoiseScale: number;
  readonly emaFastAlpha: number;
  readonly emaSlowAlpha: number;
  readonly sentimentDecayPerTick: number;
  /** Cosmetic AI-vs-AI turnover per tick as a fraction of one depth (volume bars only). */
  readonly baselineVolumeDepthFraction: number;
  readonly archetypes: Readonly<Record<InvestorArchetypeId, InvestorArchetypeConfig>>;
}

export interface IndexConfig {
  readonly size: number;
  readonly baseLevel: number;
  readonly reviewEveryQuarters: number;
  readonly minListedQuarters: number;
  /** A non-member must rank at or above (size - buffer) to replace a member. */
  readonly entryBuffer: number;
}

export interface EventsConfig {
  readonly pharmaTrial: {
    readonly probabilityPerQuarter: number;
    readonly announceLeadQuarters: number;
    readonly successProbability: Readonly<Record<SizeClass, number>>;
    readonly minMove: number;
    readonly maxMove: number;
  };
  readonly oilReport: {
    readonly everyQuarters: number;
    readonly changeStdDev: number;
    readonly meanReversion: number;
    readonly minIndex: number;
    readonly maxIndex: number;
  };
  readonly businessCycle: {
    readonly noiseStdDev: number;
    readonly meanReversion: number;
    readonly minIndex: number;
    readonly maxIndex: number;
  };
  readonly earnings: {
    /** Sentiment shock per 1.0 of relative earnings surprise. */
    readonly sentimentPerSurprise: number;
    readonly maxSentimentShock: number;
  };
  readonly macro: {
    readonly sectorCrisis: MacroEventConfig;
    readonly commodityShock: MacroEventConfig;
    readonly recession: MacroEventConfig;
    readonly techBoom: MacroEventConfig;
  };
  readonly rateDecisionSentimentPer25Bps: number;
}

export interface MacroEventConfig {
  readonly probabilityPerQuarter: number;
  /** Relative magnitude (demand factor change, or oil index change for the commodity shock). */
  readonly magnitude: number;
  readonly durationQuarters: number;
  readonly sentimentShock: number;
}

export interface LifestyleItemConfig {
  readonly key: string;
  readonly priceCents: number;
  /** Upkeep per game year as a share of the purchase price. */
  readonly upkeepBpsPerGameYear: number;
  readonly reputationBonus: number;
}

export interface LifestyleConfig {
  readonly items: readonly LifestyleItemConfig[];
  readonly resaleValueBps: number;
}

export interface RandomEventsConfig {
  readonly maxPerPlayerPerDay: number;
  readonly inheritance: { readonly probabilityPerDay: number; readonly amountCents: number };
  readonly taxAudit: { readonly probabilityPerDay: number; readonly cashBps: number };
  readonly headhunter: { readonly probabilityPerDay: number; readonly salaryRaiseBps: number };
  readonly golfClubTip: { readonly probabilityPerDay: number; readonly accuracy: number };
}

export interface AbuseConfig {
  readonly rateLimits: {
    readonly ordersPerMinute: number;
    readonly ordersPerDay: number;
    readonly actionsPerMinute: number;
  };
  readonly newAccountIpo: {
    readonly accountAgeDays: number;
    readonly minLevel: number;
    readonly maxAllocationBps: number;
    readonly maxInvestmentCents: number;
  };
  readonly suspicious: {
    /** Flag pairs of accounts whose mutual trades exceed this share of their volume. */
    readonly mutualTradeShare: number;
    /** Flag transfers of value above this amount at off-market prices. */
    readonly offMarketValueCents: number;
    readonly offMarketDeviationBps: number;
  };
}

export interface BalanceConfig {
  readonly time: TimeConfig;
  readonly economy: EconomyConfig;
  readonly trading: TradingConfig;
  readonly centralBank: CentralBankConfig;
  readonly bonds: BondsConfig;
  readonly sectors: Readonly<Record<SectorId, SectorConfig>>;
  readonly company: CompanyConfig;
  readonly ipo: IpoConfig;
  readonly reputation: ReputationConfig;
  readonly loans: LoansConfig;
  readonly employees: EmployeesConfig;
  readonly careers: CareersConfig;
  readonly progression: ProgressionConfig;
  readonly valuation: ValuationConfig;
  readonly aiInvestors: AiInvestorsConfig;
  readonly index: IndexConfig;
  readonly events: EventsConfig;
  readonly lifestyle: LifestyleConfig;
  readonly randomEvents: RandomEventsConfig;
  readonly abuse: AbuseConfig;
  readonly money: MoneyConfig;
  readonly richList: RichListConfig;
  readonly names: NamesConfig;
}

/**
 * Closed money system (owner decision, ADR-041, docs/ECONOMY.md): the total
 * amount of money is created once and afterwards only moves between accounts.
 */
export interface MoneyConfig {
  /** All money that will ever exist in this game world. */
  readonly totalSupplyCents: number;
  /** Where the supply sits at world creation (shares sum to 1). */
  readonly allocation: {
    /** State treasury: starting capital, basic income, bond coupons and redemptions. */
    readonly treasury: number;
    /** AI investors and market makers: counterparty of player trades. */
    readonly financialMarket: number;
    /** Cash of the AI tycoons on the rich list. */
    readonly tycoons: number;
    /** Households: customers of all companies (company accounting from M4). */
    readonly households: number;
  };
  /**
   * Basic income shrinks when the treasury runs low: factor = treasury / target,
   * clamped to [minFactor, 1]. Starting capital is always paid.
   */
  readonly basicIncome: { readonly treasuryTargetCents: number; readonly minFactor: number };
}

export interface RichListConfig {
  /** Fictional AI tycoons that make the ranking alive from day one. */
  readonly aiTycoons: number;
  /** Their net worth spans this range (Pareto-like), from reachable to legendary. */
  readonly tycoonMinWealthCents: number;
  readonly tycoonMaxWealthCents: number;
  /** How often ranks are snapshotted and rank news are written. */
  readonly snapshotMinutes: number;
  /** Entering one of these top ranks makes the news. */
  readonly newsRanks: readonly number[];
}

export interface NamesConfig {
  readonly minLength: number;
  readonly maxLength: number;
  readonly nicknameChangeDays: number;
}

export const BALANCE = {
  // ---------------------------------------------------------------- time (spec 4)
  time: {
    quarterHours: 6,
    quartersPerGameYear: 4,
    timezone: "Europe/Berlin",
    quarterBoundaryHours: [8, 14, 20, 2],
    marketOpenHour: 8,
    marketCloseHour: 22,
    tickSeconds: 5,
    ticksPerRunnerInvocation: 12,
    afterHours: {
      spreadMultiplier: 3,
      liquidityMultiplier: 0.25,
      volatilityMultiplier: 0.5,
    },
    // 1 min, 5 min, 1 h. Quarter and game-year candles follow `game_quarters`.
    candleIntervalsSeconds: [60, 300, 3600],
    openingBonusMinutes: 60,
    openingBonusXpMultiplier: 1.5,
  },

  // ------------------------------------------------------- economy (spec 8.1, ADR-011)
  economy: {
    startingCapitalCents: 1_000_000,
    bankruptcyRestartCents: 250_000,
    basicIncomeCentsPerHour: 10_000,
    vaultCapHours: 8,
    vaultInitialHours: 2,
    vaultMinClaimCents: 100,
    bankruptcyStatusGameDays: 3,
    bankruptcyReputationPenalty: 10,
  },

  // --------------------------------------------------------------- trading (spec 10)
  trading: {
    orderFeeCents: 100,
    maxOrderQuantity: 100_000,
    quantityScale: 1_000_000,
    minOrderValueCents: 100,
    capitalGainsTaxBps: 2500,
    incomeTaxOnCouponsAndDividendsBps: 2500,
    spread: {
      halfSpreadBps: { bluechip: 5, midcap: 15, penny: 60 },
      sentimentWideningBps: 20,
      minHalfSpreadE4: 1,
    },
    priceImpact: {
      impactBpsPerDepth: 100,
      depthFreeFloatFraction: 0.002,
      exponent: 1,
      immediateShare: 0.5,
      marketMakerHedgeShare: 0.5,
      maxImpactBpsPerOrder: 1500,
    },
    orderBook: {
      levelsPerSide: 10,
      levelStepBps: 10,
      sizeJitter: 0.2,
    },
    financingSpreadBps: 400,
    borrowFeeBps: { bluechip: 100, midcap: 300, penny: 1000 },
    leverageTiers: [
      { level: 1, maxLeverage: 1 },
      { level: 12, maxLeverage: 2 },
      { level: 18, maxLeverage: 5 },
      { level: 30, maxLeverage: 10 },
    ],
    shortSellingMinLevel: 8,
    maintenanceMarginBps: 500,
    marginCallWarningMarginBps: 750,
    liquidationFeeBps: 50,
    washTradeWindowSeconds: 300,
    minPriceE4: 1,
    maxTickReturnBps: 300,
  },

  // ----------------------------------------------------------- centralBank (spec 5.1)
  centralBank: {
    startRateBps: 300,
    neutralRateBps: 300,
    minRateBps: 50,
    maxRateBps: 1000,
    stepBps: 25,
    maxStepsPerDecision: 2,
    targetMoneyGrowthBps: 800,
    toleranceBandBps: 400,
    decisionEveryQuarters: 4,
    // No decisions in the first 14 real days: early money growth is high only because the base is tiny.
    warmupQuarters: 56,
    announceLeadQuarters: 1,
    measurementWindowQuarters: 4,
    activePlayerWindowDays: 7,
  },

  // ----------------------------------------------------------------- bonds (spec 5.1)
  bonds: {
    faceValueCents: 10_000,
    couponsPerGameYear: 4,
    // At the 3 % start rate: 2.25 %, 2.50 %, 2.90 %, 3.25 %.
    maturities: [
      { years: 1, spreadBps: -75 },
      { years: 2, spreadBps: -50 },
      { years: 5, spreadBps: -10 },
      { years: 10, spreadBps: 25 },
    ],
    minYieldBps: 200,
    maxYieldBps: 400,
    minLevel: 5,
  },

  // --------------------------------------------------------------- sectors (spec 6.1)
  // Calibration rule (docs/BALANCING.md 4.2): with price exponent e the profit-maximising price of a
  // small company is (e + 1) / e x (unit cost + production salary per unit). Unit cost and capacity are
  // chosen so that this optimum equals the reference price, and so that a well-run small business earns
  // about the same in every sector (sectors that need more developers get more margin per unit).
  sectors: {
    tech: {
      baseDemandCentsPerQuarter: 3_000_000_000,
      demandGrowthBpsPerGameYear: 800,
      demandNoise: 0.04,
      peRatio: 28,
      volatilityMultiplier: 1.2,
      priceExponent: 1.2,
      costStructure: {
        referencePriceCents: 5_000,
        unitCostCents: 1_180,
        capacityUnitsPerSkillPoint: 16.5,
        fixedCostMultiplier: 0.7,
        qualityAdjustmentRate: 0.1,
        developmentIntensity: 2.0,
      },
      sensitivity: { oilDemand: 0, oilCost: 0, ratePer100Bps: -0.03, cycle: 0.8, valuationRate: 1.5 },
    },
    retail: {
      baseDemandCentsPerQuarter: 5_000_000_000,
      demandGrowthBpsPerGameYear: 200,
      demandNoise: 0.02,
      peRatio: 14,
      volatilityMultiplier: 0.8,
      priceExponent: 2.5,
      costStructure: {
        referencePriceCents: 2_000,
        unitCostCents: 892,
        capacityUnitsPerSkillPoint: 47.6,
        fixedCostMultiplier: 1,
        qualityAdjustmentRate: 0.03,
        developmentIntensity: 0.5,
      },
      sensitivity: { oilDemand: -0.05, oilCost: 0.1, ratePer100Bps: -0.01, cycle: 0.5, valuationRate: 0.8 },
    },
    energy: {
      baseDemandCentsPerQuarter: 3_600_000_000,
      demandGrowthBpsPerGameYear: 150,
      demandNoise: 0.03,
      peRatio: 11,
      volatilityMultiplier: 1.0,
      priceExponent: 1.5,
      costStructure: {
        referencePriceCents: 8_000,
        unitCostCents: 1_995,
        capacityUnitsPerSkillPoint: 9.1,
        fixedCostMultiplier: 1.4,
        qualityAdjustmentRate: 0.03,
        developmentIntensity: 0.6,
      },
      sensitivity: { oilDemand: 0.8, oilCost: 0.3, ratePer100Bps: -0.01, cycle: 0.6, valuationRate: 1.0 },
    },
    pharma: {
      baseDemandCentsPerQuarter: 2_800_000_000,
      demandGrowthBpsPerGameYear: 500,
      demandNoise: 0.03,
      peRatio: 22,
      volatilityMultiplier: 1.4,
      priceExponent: 1.0,
      costStructure: {
        referencePriceCents: 12_000,
        unitCostCents: 2_685,
        capacityUnitsPerSkillPoint: 7.7,
        fixedCostMultiplier: 1.2,
        qualityAdjustmentRate: 0.06,
        developmentIntensity: 1.5,
      },
      sensitivity: { oilDemand: 0, oilCost: 0, ratePer100Bps: -0.01, cycle: 0.1, valuationRate: 1.2 },
    },
    logistics: {
      baseDemandCentsPerQuarter: 4_200_000_000,
      demandGrowthBpsPerGameYear: 300,
      demandNoise: 0.03,
      peRatio: 15,
      volatilityMultiplier: 0.9,
      priceExponent: 2.0,
      costStructure: {
        referencePriceCents: 3_000,
        unitCostCents: 1_048,
        capacityUnitsPerSkillPoint: 26.8,
        fixedCostMultiplier: 1.1,
        qualityAdjustmentRate: 0.04,
        developmentIntensity: 0.7,
      },
      sensitivity: { oilDemand: 0, oilCost: 0.5, ratePer100Bps: -0.02, cycle: 1.2, valuationRate: 1.0 },
    },
  },

  // --------------------------------------------------------------- company (spec 6)
  company: {
    attractiveness: {
      qualityExponent: 1.2,
      awarenessExponent: 0.8,
      priceExponent: 1.5,
    },
    // One market per company tier. Demand is a share of the sector demand; the established
    // suppliers of the three small segments are one anonymous competitor (docs/SIMULATION.md 11.3).
    segments: {
      local: {
        tier: "small_business",
        demandShare: 0.0018,
        growsWithSector: false,
        incumbentQuality: 40,
        incumbentAwareness: 0.5,
      },
      regional: {
        tier: "gmbh",
        demandShare: 0.006,
        growsWithSector: false,
        incumbentQuality: 50,
        incumbentAwareness: 0.5,
      },
      national: {
        tier: "ag",
        demandShare: 0.022,
        growsWithSector: false,
        incumbentQuality: 55,
        incumbentAwareness: 0.5,
      },
      international: {
        tier: "listed",
        demandShare: 1,
        growsWithSector: true,
        incumbentQuality: 0,
        incumbentAwareness: 0,
      },
    },
    marketing: {
      // 2 ^ x = 1.4  =>  x = log2(1.4) = 0.485426827...
      diminishingReturnsExponent: 0.485427,
      referenceBudgetShareOfSegmentDemand: 0.015,
      gainAtReferenceBudget: 0.05,
      maxGainPerQuarter: 0.15,
      awarenessDecayPerQuarter: 0.1,
      initialAwareness: 0.08,
      minAwareness: 0.005,
      departmentMaxBoost: 1,
      departmentHalfSaturationSkillPoints: 15,
    },
    quality: {
      initial: 30,
      min: 1,
      max: 100,
      halfSaturationSkillPoints: 10,
      productionScale: 0.25,
      targetExponent: 0.5,
    },
    sales: {
      boostPerSkillPoint: 0.01,
      maxBoost: 0.5,
    },
    finance: {
      maxFixedCostReduction: 0.3,
      halfSaturationSkillPoints: 15,
    },
    onboardingRamp: [0.4, 0.7],
    // Spec 6.4. "listed" is an assumption: the spec defines no caps after the IPO.
    tiers: [
      {
        id: "small_business",
        minLevel: 10,
        foundingCostCents: 1_500_000,
        fixedCostCentsPerQuarter: 200_000,
        maxEmployees: 5,
        creditLineCents: 0,
      },
      {
        id: "gmbh",
        minLevel: 20,
        foundingCostCents: 7_500_000,
        fixedCostCentsPerQuarter: 1_000_000,
        maxEmployees: 20,
        creditLineCents: 25_000_000,
      },
      {
        id: "ag",
        minLevel: 25,
        foundingCostCents: 30_000_000,
        fixedCostCentsPerQuarter: 4_000_000,
        maxEmployees: 100,
        creditLineCents: 200_000_000,
      },
      {
        id: "listed",
        minLevel: 25,
        foundingCostCents: 0,
        fixedCostCentsPerQuarter: 12_000_000,
        maxEmployees: 1_000,
        creditLineCents: 1_000_000_000,
      },
    ],
    smallBusinessExpansion: { minLevel: 18, maxEmployees: 20 },
    conversionFeeBps: 6000,
    founderCapital: {
      foundingMultiple: 2,
      growthMultiplePerGameYear: 1,
      listedMultiplePerGameYear: 0,
    },
    corporateTaxBps: 1500,
    insolvency: {
      graceQuarters: 4,
      foundingLockoutGameDays: 3,
      overdraftSpreadBps: 1000,
      priceCrashReturn: -0.9,
    },
    // Range of the price slider. Prices are disciplined by competition, not by this band.
    priceBand: { minFactor: 0.25, maxFactor: 3 },
    // Decision policy of the AI companies (they run through the same quarter simulation).
    aiPolicy: {
      marketingShareOfRevenue: 0.012,
      dividendPayoutRatio: 0.6,
      priceNoise: 0.01,
      priceReversion: 0.25,
      targetUtilization: 0.9,
      utilizationBand: 0.07,
      hiringRatePerQuarter: 0.06,
      firingRatePerQuarter: 0.03,
      revenueNoisePersistence: 0.3,
      costNoiseShare: 0.25,
    },
  },

  // ------------------------------------------------------------------ ipo (spec 6.5)
  ipo: {
    minLevel: 25,
    minHistoryQuarters: 4,
    minTrailingRevenueCents: 100_000_000,
    minReputation: 50,
    requiresCfo: true,
    defaultLockupQuarters: 4,
    subscriptionQuarters: 1,
    minFloatBps: 1500,
    maxFloatBps: 6000,
    discountBps: 1000,
    rangeHalfWidthBps: 1500,
    minCoverage: 1,
    fullPriceCoverage: 2,
    aiDemand: {
      baseCoverage: 1.3,
      priceElasticity: 3,
      sentimentWeight: 0.5,
      noise: 0.15,
    },
  },

  // ----------------------------------------------------------- reputation (spec 6.6)
  reputation: {
    start: 50,
    min: 0,
    max: 100,
    valuationFactorMin: 0.6,
    valuationFactorMax: 1.4,
    guidanceMissThreshold: 0.3,
    guidanceHitThreshold: 0.1,
    deltas: {
      guidanceMet: 3,
      guidanceMissed: -5,
      lockupKept: 4,
      longHoldPerGameYear: 1,
      postIpoDumping: -12,
      reliableDividend: 1,
      dividendCut: -2,
      repeatedCapitalIncrease: -4,
      useOfProceedsKept: 5,
      useOfProceedsDeviated: -8,
      employeeTenure: 1,
      insiderViolation: -15,
      ipoFailed: -10,
      insolvency: -30,
      playerBankruptcy: -10,
    },
  },

  // ---------------------------------------------------------------- loans (spec 6.7)
  loans: {
    basePremiumBps: 150,
    reputationBpsPerPoint: 4,
    leverageBpsPerDebtToEquity: 150,
    maxLeveragePremiumBps: 600,
    lossMakingPremiumBps: 200,
    coverageDiscountBpsPerTurn: 10,
    maxCoverageDiscountBps: 100,
    cfoDiscountBpsPerSkill: 10,
    minPremiumBps: 50,
    maxPremiumBps: 1500,
    creditLinesByLevel: [
      { level: 15, limitCents: 5_000_000 },
      { level: 20, limitCents: 25_000_000 },
      { level: 25, limitCents: 200_000_000 },
    ],
    creditLineReputationFactorMin: 0.5,
    creditLineReputationFactorMax: 1.5,
  },

  // ------------------------------------------------------------- employees (spec 7)
  employees: {
    minSkill: 1,
    maxSkill: 10,
    skillCapacityExponent: 1.1,
    salaryBaseCentsPerQuarter: 18_500,
    salarySkillExponent: 1.3,
    playerProductivityMultiplier: 2,
    traits: [
      { key: "ambitious", performanceMultiplier: 1.15, salaryMultiplier: 1.0, loyaltyDecayMultiplier: 2.0 },
      { key: "loyal", performanceMultiplier: 1.0, salaryMultiplier: 1.0, loyaltyDecayMultiplier: 0.5 },
      { key: "frugal", performanceMultiplier: 1.0, salaryMultiplier: 0.9, loyaltyDecayMultiplier: 1.0 },
      { key: "genius", performanceMultiplier: 1.25, salaryMultiplier: 1.3, loyaltyDecayMultiplier: 1.2 },
      { key: "easygoing", performanceMultiplier: 0.92, salaryMultiplier: 0.95, loyaltyDecayMultiplier: 0.7 },
      { key: "mentor", performanceMultiplier: 1.05, salaryMultiplier: 1.1, loyaltyDecayMultiplier: 0.8 },
    ],
    loyalty: {
      start: 70,
      quitThreshold: 25,
      decayPerQuarterOnSalaryFreeze: 3,
      gainPerQuarterOnRaise: 8,
      poachingSalaryPremiumBps: 2000,
    },
    leadership: {
      cooCapacityBonusPerSkill: 0.015,
      ctoDevelopmentTimeReductionPerSkill: 0.03,
      headOfSalesBoostPerSkill: 0.02,
      cfoGuidanceBandReductionPerSkill: 0.02,
    },
    applicantPoolSize: 6,
    insiderLockHours: 2,
    insiderDetectionProbability: 0.6,
    insiderFineBps: 15_000,
    maxSideRoles: 1,
    optionVestingQuarters: 4,
  },

  // --------------------------------------------------------------- careers (spec 8)
  careers: {
    tiers: [
      { id: "intern", minLevel: 2, salaryCentsPerHour: 15_000, stockOptions: false },
      { id: "junior", minLevel: 5, salaryCentsPerHour: 30_000, stockOptions: false },
      { id: "senior", minLevel: 12, salaryCentsPerHour: 70_000, stockOptions: false },
      { id: "team_lead", minLevel: 20, salaryCentsPerHour: 130_000, stockOptions: false },
      { id: "c_level", minLevel: 25, salaryCentsPerHour: 250_000, stockOptions: true },
    ],
    paidHoursPerDayCap: 12,
    playerCompanyExperienceMultiplier: 2,
    promotionSteps: [
      { experienceHours: 24, raiseBps: 1000 },
      { experienceHours: 72, raiseBps: 1250 },
      { experienceHours: 168, raiseBps: 1500 },
      { experienceHours: 336, raiseBps: 2000 },
    ],
    negotiation: {
      cooldownDays: 7,
      baseSuccessProbability: 0.3,
      successPerExperienceHour: 0.002,
      maxSuccessProbability: 0.85,
      raiseMinBps: 500,
      raiseMaxBps: 1200,
    },
    jobSwitch: { raiseMinBps: 1500, raiseMaxBps: 3000 },
    workTask: { intervalHours: 3, bonusSalaryHours: 1 },
  },

  // ----------------------------------------------------------- progression (spec 9)
  progression: {
    xpBase: 100,
    xpExponent: 1.5,
    maxLevel: 10_000,
    prestige: { fromLevel: 50, titleEveryLevels: 10 },
    // Alpha bonus: all XP count double (owner decision). 1 = spec values.
    // Typed as `number` (not the literal 2) so that code may compare it with 1.
    xpMultiplier: 2 as number,
    xpSources: {
      trade: { xp: 10, maxTradesPerDay: 30, minOrderValueCents: 10_000 },
      profitableClose: { profitCentsPerXp: 10_000, maxXpPerTrade: 500 },
      workHour: { xp: 40, playerCompanyMultiplier: 1.5, maxHoursPerDay: 12 },
      workTask: { minXp: 50, maxXp: 150 },
      dailyMission: { minXp: 200, maxXp: 400, perDay: 3 },
      quickMission: { minXp: 20, maxXp: 60, active: 3 },
      weeklyMission: { minXp: 600, maxXp: 1200, perWeek: 3 },
      milestoneMission: { minXp: 100, maxXp: 2000, visible: 3 },
      dailyLogin: { xp: 50, streakBonusPerDay: 10, streakBonusCap: 200, streakFreezesPerWeek: 1 },
      profitableCompanyQuarter: { xp: 500 },
      successfulIpo: { xp: 5000 },
      achievement: { minXp: 100, maxXp: 10_000 },
      tutorial: { xp: 50 },
    },
    // Spec 9.3, one entry per unlocked feature. Keys are stable identifiers (DB, i18n, UI).
    unlocks: [
      { level: 1, key: "market_orders" },
      { level: 1, key: "basic_income" },
      { level: 2, key: "first_job" },
      { level: 3, key: "limit_orders" },
      { level: 3, key: "watchlist" },
      { level: 5, key: "stop_loss" },
      { level: 5, key: "bonds" },
      { level: 5, key: "junior_jobs" },
      { level: 7, key: "analyst_reports" },
      { level: 8, key: "short_selling" },
      { level: 10, key: "found_small_business" },
      { level: 12, key: "leverage_2x" },
      { level: 12, key: "senior_jobs" },
      { level: 15, key: "small_loan" },
      { level: 15, key: "business_angel" },
      { level: 18, key: "leverage_5x" },
      { level: 18, key: "expand_small_business" },
      { level: 20, key: "found_gmbh" },
      { level: 20, key: "loans_250k" },
      { level: 20, key: "team_lead_jobs" },
      { level: 25, key: "ipo" },
      { level: 25, key: "c_level_jobs" },
      { level: 30, key: "leverage_10x" },
      { level: 30, key: "options" },
      { level: 35, key: "takeovers" },
      { level: 35, key: "hostile_takeovers" },
      { level: 40, key: "holding" },
      { level: 50, key: "title_market_legend" },
      { level: 50, key: "golden_profile_frame" },
      { level: 50, key: "hall_of_fame" },
    ],
  },

  // ------------------------------------------------------------ valuation (spec 5.3)
  valuation: {
    growthWeight: 1,
    growthFactorMin: 0.6,
    growthFactorMax: 1.8,
    macroSensitivityPer100Bps: 0.04,
    macroFactorMin: 0.6,
    macroFactorMax: 1.3,
    bookValueFloorShare: 0.5,
    lossMakerRevenueElasticity: 0.5,
    analystTargetNoise: 0.08,
    analystWrongProbability: 0.25,
  },

  // ---------------------------------------------------------- aiInvestors (spec 5.3)
  aiInvestors: {
    tickNoiseBps: { bluechip: 6, midcap: 15, penny: 45 },
    tickNoiseScale: 0.2,
    emaFastAlpha: 0.15,
    emaSlowAlpha: 0.0165,
    sentimentDecayPerTick: 0.0019,
    baselineVolumeDepthFraction: 0.02,
    archetypes: {
      market_maker: {
        capitalShare: 0.05,
        // Fraction of its inventory unwound per tick.
        reactionSpeed: 0.005,
        params: {},
      },
      value_fund: {
        capitalShare: 0.3,
        reactionSpeed: 0.000167,
        // Full signal at 50 % mispricing, no trading inside the dead band.
        params: { gapScale: 0.5, deadBand: 0.01 },
      },
      momentum_trader: {
        capitalShare: 0.1,
        reactionSpeed: 0.0002,
        // tanh(trend / trendScale); trend = emaFast / emaSlow - 1.
        // Stability: the trend-following loop gain must stay below 1, see docs/SIMULATION.md.
        params: { trendScale: 0.02 },
      },
      pension_fund: {
        capitalShare: 0.2,
        reactionSpeed: 0.002,
        params: {
          // Target weight change per +100 bps policy rate above neutral.
          rateSensitivityPer100Bps: -0.05,
          // Target weight change per +100 bps of dividend yield above the 10-year bond yield.
          yieldTiltPer100Bps: 0.03,
          minWeight: 0.2,
          maxWeight: 1.8,
        },
      },
      index_fund: {
        capitalShare: 0.04,
        reactionSpeed: 0.005,
        params: {},
      },
      retail_herd: {
        capitalShare: 0.1,
        reactionSpeed: 0.0012,
        // signal = sentiment + chaseGain x tanh(trend / trendScale), clamped to [-1, 1].
        params: { chaseGain: 0.1, trendScale: 0.02 },
      },
    },
  },

  // ---------------------------------------------------------------- index (spec 5.4)
  index: {
    size: 30,
    baseLevel: 1000,
    reviewEveryQuarters: 4,
    minListedQuarters: 1,
    entryBuffer: 3,
  },

  // --------------------------------------------------------------- events (spec 5.5)
  events: {
    pharmaTrial: {
      probabilityPerQuarter: 0.12,
      announceLeadQuarters: 2,
      successProbability: { bluechip: 0.6, midcap: 0.5, penny: 0.4 },
      minMove: 0.5,
      maxMove: 0.7,
    },
    oilReport: {
      everyQuarters: 2,
      changeStdDev: 0.06,
      meanReversion: 0.25,
      minIndex: 0.4,
      maxIndex: 2.5,
    },
    businessCycle: {
      noiseStdDev: 0.01,
      meanReversion: 0.1,
      minIndex: 0.8,
      maxIndex: 1.2,
    },
    earnings: {
      sentimentPerSurprise: 1.5,
      maxSentimentShock: 0.6,
    },
    macro: {
      sectorCrisis: { probabilityPerQuarter: 0.03, magnitude: -0.15, durationQuarters: 3, sentimentShock: -0.5 },
      commodityShock: { probabilityPerQuarter: 0.04, magnitude: 0.25, durationQuarters: 1, sentimentShock: 0.3 },
      recession: { probabilityPerQuarter: 0.03, magnitude: -0.08, durationQuarters: 4, sentimentShock: -0.4 },
      techBoom: { probabilityPerQuarter: 0.03, magnitude: 0.2, durationQuarters: 4, sentimentShock: 0.5 },
    },
    rateDecisionSentimentPer25Bps: -0.1,
  },

  // ----------------------------------------------------------- lifestyle (spec 11.3)
  lifestyle: {
    items: [
      { key: "rolex", priceCents: 2_500_000, upkeepBpsPerGameYear: 50, reputationBonus: 0 },
      { key: "porsche", priceCents: 15_000_000, upkeepBpsPerGameYear: 100, reputationBonus: 0 },
      { key: "penthouse", priceCents: 150_000_000, upkeepBpsPerGameYear: 100, reputationBonus: 5 },
      { key: "private_jet", priceCents: 2_000_000_000, upkeepBpsPerGameYear: 150, reputationBonus: 0 },
      { key: "private_island", priceCents: 10_000_000_000, upkeepBpsPerGameYear: 200, reputationBonus: 0 },
    ],
    resaleValueBps: 5000,
  },

  // -------------------------------------------------------- randomEvents (spec 11.4)
  randomEvents: {
    maxPerPlayerPerDay: 1,
    inheritance: { probabilityPerDay: 0.04, amountCents: 500_000 },
    taxAudit: { probabilityPerDay: 0.04, cashBps: 300 },
    headhunter: { probabilityPerDay: 0.03, salaryRaiseBps: 3000 },
    golfClubTip: { probabilityPerDay: 0.06, accuracy: 0.6 },
  },

  // ------------------------------------------------------------------ abuse (spec 13)
  abuse: {
    rateLimits: {
      ordersPerMinute: 20,
      ordersPerDay: 500,
      actionsPerMinute: 60,
    },
    newAccountIpo: {
      accountAgeDays: 7,
      minLevel: 5,
      maxAllocationBps: 500,
      maxInvestmentCents: 500_000,
    },
    suspicious: {
      mutualTradeShare: 0.5,
      offMarketValueCents: 1_000_000,
      offMarketDeviationBps: 1000,
    },
  },

  // --------------------------------------------- money (closed system, ADR-041)
  money: {
    totalSupplyCents: 1_000_000_000_000, // 10 Mrd. €
    allocation: { treasury: 0.05, financialMarket: 0.6, tycoons: 0.05, households: 0.3 },
    basicIncome: { treasuryTargetCents: 25_000_000_000, minFactor: 0.25 },
  },

  // ------------------------------------------------- rich list (ADR-042)
  richList: {
    aiTycoons: 120,
    tycoonMinWealthCents: 1_500_000, // 15.000 €
    tycoonMaxWealthCents: 40_000_000_000, // 400 Mio. €
    snapshotMinutes: 5,
    newsRanks: [1, 3, 10, 25, 50, 100],
  },

  // ------------------------------------------------------- names (ADR-043)
  names: { minLength: 3, maxLength: 20, nicknameChangeDays: 60 },
} as const satisfies BalanceConfig;

/** Names of the `game_config` rows. */
export type BalanceSection = keyof BalanceConfig;
