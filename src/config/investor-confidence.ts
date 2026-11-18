/**
 * Investor confidence (ADR-216): every listed stock carries the confidence of the AI investors, 0..100 (50 = neutral).
 * It is the strongest price driver for AI and player stocks alike: the AI "confidence investors" buy while it is high
 * and sell while it is low, every tick, against the value funds that pull towards the fair value. So a stock with weak
 * confidence falls below its value even without news, panics below `flow.panicBelow`, and recovers when confidence
 * returns.
 *
 * confidence target = 50 + Σ factors. Two kinds of factors:
 * - events (bumps that fade with a half-life): earnings beat or miss, stock news, market forces (ADR-214), crises and
 *   external events (ADR-209), scandals, dividends, founder withdrawals and sells, capital increases;
 * - state (recomputed every minute): profit trend, reputation, active crisis, country risk (ADR-208), management
 *   (talents, co-CEO), volatility, market mood and sector rotation, price momentum (herd), valuation, chatter (an
 *   idiosyncratic random walk of rumours).
 * The confidence moves `smoothingPerMinute` of the way to its target every minute.
 *
 * The market mood (Marktstimmung, 0..100) cycles through bull, calm and bear phases; it feeds every stock's
 * confidence (`state.macroPerPoint`) and the growth of the AI companies' business (`aiFundamentals`).
 *
 * Formulas in src/lib/sim/investor-confidence.ts, mirrored in Postgres
 * (supabase/migrations/20261204011100_investor_confidence.sql). Plain data, no imports
 * (part of BALANCE as "investorConfidence").
 */
export const INVESTOR_CONFIDENCE = {
  neutral: 50,
  /** Share of the way to the target per minute (≈ 9 minutes half-life). */
  smoothingPerMinute: 0.075,
  /** AI order flow of the confidence investors in every tick (server: market_tick_at). */
  flow: {
    /** Capital share × reaction speed per tick, like an archetype: 0,25 × 0,0005 (the value fund has 0,3 × 0,0005). */
    capitalShare: 0.25,
    reactionSpeed: 0.0005,
    /** signal = gain × (confidence − 50) / 50, plus panic below panicBelow and euphoria above 100 − panicBelow. */
    gain: 1,
    panicBelow: 15,
    panicGain: 0.8,
  },
  /** Event bumps: Δ points per unit, the bump fades with halfLifeHours, each key is capped at ±max. */
  events: {
    earnings: { halfLifeHours: 12, max: 22, perSurprise: 30 },
    news: { halfLifeHours: 5, max: 14, pointsPerTenPercent: 6 },
    market: { halfLifeHours: 8, max: 18, pointsPerTenPercent: 5 },
    event: { halfLifeHours: 12, max: 20, perSeverity: 5, solvedPerSeverity: 3, lostPerSeverity: 4 },
    scandal: { halfLifeHours: 24, max: 22, perSeverity: 7 },
    payout: { halfLifeHours: 24, max: 10, pointsPerPercentYield: 4, min: 1 },
    withdraw: { halfLifeHours: 24, max: 30, perCashShare: 32, min: 2 },
    insider: { halfLifeHours: 24, max: 25, base: 3, perStakeShare: 25 },
    dilution: { halfLifeHours: 24, max: 18, perNewShare: 40 },
    /**
     * Stock incidents (incidents below): a crash at the start, back step by step (each step that succeeded), worse with
     * a failed step or a bad strategy, a bonus when solved, a further loss when the deadline passes unsolved.
     */
    incident: {
      halfLifeHours: 18,
      max: 30,
      perSeverity: 9,
      stepSucceededPerSeverity: 2.5,
      stepFailedPerSeverity: 1.5,
      solvedPerSeverity: 4,
      lostPerSeverity: 5,
      badStrategyPerSeverity: 6,
    },
  },
  /**
   * Stock incidents (ADR-216): serious crises of listed player companies (companyEvents archetypes with incident: true,
   * weight 0). Drawn once a minute per listed player company without an open event: chance per hour =
   * min(maxPerHour, basePerHour + perHeatPerHour × heat (ADR-214 market_force_heat)) × (1 + perWorthDecade ×
   * log10(market cap / 1 Mio. €), from 1 Mio. €). Severity 1, from heat severity2Heat 2, from severity3Heat 3.
   * While one is open the stock carries state.incidentPerSeverity × severity.
   */
  incidents: {
    basePerHour: 0.001,
    perHeatPerHour: 0.07,
    maxPerHour: 0.5,
    perWorthDecade: 0.25,
    cooldownHours: 24,
    minListedHours: 6,
    severity2Heat: 0.6,
    severity3Heat: 1.6,
    badStrategies: ["cover_up", "deny", "ignore", "price_war"],
    /** Note for the founder (beside the usual crisis note). */
    founderNote:
      "Die Anleger verlieren das Vertrauen, der Kurs steht unter Druck. Nur Schritt für Schritt gelöst kommt es zurück. Wähle in der Firma eine Strategie, Mira hilft.",
    /** News for the stock news and Mr. Doodle ({name}). */
    news: {
      incident_accounting: [
        "Bilanzskandal bei {name}",
        "Ein Whistleblower erhebt schwere Vorwürfe gegen die Bücher. Eine Sonderprüfung droht, Anleger verkaufen.",
      ],
      incident_recall: [
        "Rückruf und Klagewelle bei {name}",
        "Defekte Produkte, erste Klagen, eine Sammelklage droht. Die Aktie gerät unter Druck.",
      ],
      incident_data_leak: [
        "Datenleck bei {name}",
        "Kundendaten sind im Netz, die Behörde ermittelt. Ein Bußgeld droht.",
      ],
      incident_ceo_scandal: [
        "Skandal um die Chefetage von {name}",
        "Schwere Vorwürfe gegen die Führung. Große Anleger drohen mit dem Ausstieg.",
      ],
      incident_supplier_bankrupt: [
        "Lieferant von {name} ist pleite",
        "Ohne Teile stockt die Produktion. Anleger fürchten einen Umsatzeinbruch.",
      ],
      incident_patent_suit: [
        "Patentklage gegen {name}",
        "Ein Konkurrent will ein Verkaufsverbot erwirken. Bis zum Urteil bleibt die Aktie unter Druck.",
      ],
      incident_rating_downgrade: ["Ratingagentur stuft {name} herab", "Kredite werden teurer, Fonds müssen verkaufen."],
      incident_key_customer: [
        "Großkunde springt bei {name} ab",
        "Ein großer Teil des Umsatzes fällt weg. Analysten senken ihre Ziele.",
      ],
    },
  },
  /** Crisis archetypes that count as a scandal (key "scandal" instead of "event"). */
  scandalArchetypes: ["shitstorm", "quality_scandal", "data_breach", "tax_audit", "bad_review", "protest", "antitrust"],
  /** External events (ADR-209) weigh this much more. */
  externalArchetypes: [
    "political_decision",
    "tariffs",
    "earthquake",
    "tsunami",
    "flood",
    "wildfire",
    "pandemic",
    "war_conflict",
    "commodity_crunch",
    "cyber_attack",
    "union_strike",
    "currency_crisis",
    "energy_shock",
  ],
  externalWeight: 1.3,
  /** State factors, recomputed every minute (points). */
  state: {
    /** Profit trend: max × tanh((recent − prior) / max(|prior|, 1 €)); a loss adds lossPoints. */
    profitMax: 8,
    lossPoints: -5,
    /** Reputation 0..100 of a player company: (reputation − 50) × perPoint. */
    reputationPerPoint: 0.2,
    /** An active crisis: perSeverity × severity (negative); an open stock incident: incidentPerSeverity × severity. */
    crisisPerSeverity: -3,
    incidentPerSeverity: -5,
    /** Country of the headquarters: −perRisk × (political + war risk) / 2. */
    countryPerRisk: 0.12,
    /** Talents: perTier × Σ (tier + 1), plus coCeo, at most managementMax. */
    managementPerTier: 0.6,
    managementCoCeo: 2,
    managementMax: 7,
    /** Volatility: −perSigma × max(0, σ of the hourly log returns over 24 h − free), at most volatilityMax. */
    volatilityFree: 0.025,
    volatilityPerSigma: 120,
    volatilityMax: 10,
    /** Market mood: (mood − 50) × macroPerPoint, plus the tilt of the sector. */
    macroPerPoint: 0.5,
    /** Herd: momentumMax × tanh(gain over 24 h / momentumScale); the crowd follows the price both ways. */
    momentumMax: 10,
    momentumScale: 0.15,
    /** Valuation: −valuationMax × tanh(ln(price / fair value) / valuationScale); dear stocks lose friends. */
    valuationMax: 12,
    valuationScale: 0.35,
    /** Chatter: x ← x × (1 − 1 / τ) + σ × N per minute (τ in hours × 60), a random walk of rumours. */
    chatterTauHours: 6,
    chatterSigma: 0.45,
  },
  /** Market mood (Marktstimmung): a slow random walk towards the target of its phase. */
  mood: {
    start: 50,
    tauHours: 5,
    sigmaPerMinute: 0.35,
    /** Phases with target, duration and weight of being drawn next. */
    phases: {
      bull: { target: 68, minHours: 20, maxHours: 60, weight: 0.35 },
      calm: { target: 50, minHours: 10, maxHours: 40, weight: 0.35 },
      bear: { target: 28, minHours: 18, maxHours: 54, weight: 0.3 },
    },
    /** Sector rotation: every minHours..maxHours one sector gets +tilt, another −tilt (points of confidence). */
    rotation: { minHours: 12, maxHours: 36, tilt: 7 },
  },
  /**
   * The business of the AI companies follows the mood instead of growing every quarter: growth per game year =
   * sector growth × trendShare + cycleGrowth × (mood − 50) / 50. A game year is a real day; before ADR-216 the full
   * sector growth (1,5 to 8 % a day) lifted every AI stock without end.
   */
  aiFundamentals: { trendShare: 0.1, cycleGrowthPerGameYear: 0.08 },
  /** Texts of the market-wide news (phase changes, sector rotation, big swings of one stock). */
  newsTexts: {
    phases: {
      bull: [
        "Bullenmarkt: Anleger greifen wieder zu",
        "Die Marktstimmung dreht ins Positive. KI-Fonds kaufen breit über alle Branchen.",
      ],
      calm: [
        "Die Börse beruhigt sich",
        "Nach den letzten Tagen pendelt sich die Marktstimmung ein. Anleger warten ab.",
      ],
      bear: [
        "Bärenmarkt: Anleger flüchten aus Aktien",
        "Die Marktstimmung kippt. KI-Fonds verkaufen breit, auch gute Werte geben nach.",
      ],
    },
    rotation: [
      "Branchenrotation: {up} gefragt, {down} gemieden",
      "Große Anleger schichten um: Sie kaufen {up} und verkaufen {down}.",
    ],
    swingDown: [
      "Anleger verlieren das Vertrauen in {name}",
      "Das Anlegervertrauen fiel in sechs Stunden von {from} auf {to}. KI-Anleger verkaufen.",
    ],
    swingUp: [
      "Anleger fassen Vertrauen in {name}",
      "Das Anlegervertrauen stieg in sechs Stunden von {from} auf {to}. KI-Anleger kaufen.",
    ],
  },
  /** A news item when the confidence moved at least swingPoints in 6 hours (at most one per stock in cooldownHours). */
  news: { swingPoints: 15, cooldownHours: 12, historyHours: 24 },
  /** Mira explains how to raise the confidence of the own listed company below this value. */
  miraBelow: 40,
  /** Top reasons shown on the stock page: |factor| ≥ minPoints, at most maxReasons. */
  reasons: { minPoints: 1.5, maxReasons: 4 },
} as const;

export type InvestorConfidenceConfig = typeof INVESTOR_CONFIDENCE;
export type ConfidenceEventKey = keyof InvestorConfidenceConfig["events"];
export type MoodPhase = keyof InvestorConfidenceConfig["mood"]["phases"];
