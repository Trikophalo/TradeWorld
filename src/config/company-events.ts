/**
 * Company events (ADR-091): crises and chances for player companies, at most one a day. Every event offers a few
 * strategies; a strategy is a chain of steps that cost money, time, people and know-how and can fail. The numbers live
 * here (and in game_config); the words come from messages (companyEvents.*) and are tailored to the product by the
 * company profile (src/lib/company-story.ts) or, when configured, by Claude.
 *
 * Plain data, no imports: runs unchanged in Deno and is mirrored in Postgres.
 */
export type CompanyEventPolarity = "crisis" | "chance";
export type EventBranch = "it" | "finance" | "law" | "craft" | "sales" | "management" | "science" | "logistics";
export type EventSector = "tech" | "retail" | "energy" | "pharma" | "logistics";

export interface CompanyEventStep {
  readonly key: string;
  /** How long the step runs once started. */
  readonly hours: number;
  /** Price in cost units (one unit = companyEvents.costUnit, scaled by the company's size). */
  readonly cost: number;
  /** Know-how that raises the success chance (team score in this branch). */
  readonly branch?: EventBranch;
  /** People in the company (founder, players, AI workers) needed to start the step. */
  readonly staff?: number;
  /** Share of the capacity tied up while the step runs. */
  readonly capacityHit?: number;
  /** Success chance without know-how, in bps. */
  readonly baseBps: number;
}

export interface CompanyEventStrategy {
  readonly key: string;
  /** Share of the event's damage removed when every step succeeded (crises), or share of the chance won. */
  readonly mitigation: number;
  /** One-off gains on success. */
  readonly bonus?: { readonly awareness?: number; readonly quality?: number };
  readonly steps: readonly CompanyEventStep[];
}

export interface CompanyEventArchetype {
  readonly key: string;
  readonly polarity: CompanyEventPolarity;
  readonly weight: number;
  /** Only for these sectors; all when omitted. */
  readonly sectors?: readonly EventSector[];
  /**
   * Effect at severity 1 while it is in force (scaled by companyEvents.severityScale). demand and capacity are
   * relative changes, cost is an extra share of the revenue.
   */
  readonly effect: { readonly demand?: number; readonly cost?: number; readonly capacity?: number };
  /** Hours to respond before the full effect (crisis) starts or the chance is gone. */
  readonly deadlineHours: number;
  /** How long the effect lasts after the deadline (crisis) or after success (chance). */
  readonly lastsHours: number;
  readonly strategies: readonly CompanyEventStrategy[];
}

export interface CompanyEventsConfig {
  /** Probability that a company gets an event on a given day (one roll per company and Berlin day). */
  readonly chancePerDay: number;
  /** At most one event per company in this window: time to react. */
  readonly minGapHours: number;
  /** New companies get a grace period. */
  readonly minAgeHours: number;
  readonly chanceShare: number;
  /** Probability of severity 1, 2, 3. */
  readonly severityWeights: readonly [number, number, number];
  /** Effect multiplier per severity. */
  readonly severityScale: readonly [number, number, number];
  /** Before the deadline a crisis already bites with this share of its effect (urgency). */
  readonly preDeadlineShare: number;
  /** One cost unit: max(minUnitCents, quarterly fixed costs × unitShareOfFixed). */
  readonly costUnit: { readonly minUnitCents: number; readonly unitShareOfFixed: number };
  /** Know-how: success bps per point of team branch score, capped. */
  readonly knowHow: { readonly bpsPerPoint: number; readonly maxBonusBps: number };
  /** Each severity above 1 lowers every success chance. */
  readonly severityPenaltyBps: number;
  /** Retrying a failed step costs this share of its price again. */
  readonly retryCostShare: number;
  /** Listed companies: price move at announcement and on resolution, per severity, in bps. */
  readonly shareShockBps: readonly [number, number, number];
  readonly archetypes: readonly CompanyEventArchetype[];
}

const accept: CompanyEventStrategy = { key: "accept", mitigation: 0, steps: [] };
const pass: CompanyEventStrategy = { key: "pass", mitigation: 0, steps: [] };

export const COMPANY_EVENTS: CompanyEventsConfig = {
  chancePerDay: 0.6,
  minGapHours: 22,
  minAgeHours: 6,
  chanceShare: 0.4,
  severityWeights: [0.5, 0.35, 0.15],
  severityScale: [1, 1.7, 2.5],
  preDeadlineShare: 0.25,
  costUnit: { minUnitCents: 20_000, unitShareOfFixed: 0.5 },
  knowHow: { bpsPerPoint: 150, maxBonusBps: 2_500 },
  severityPenaltyBps: 700,
  retryCostShare: 0.5,
  shareShockBps: [400, 900, 1_500],
  archetypes: [
    // ---------------------------------------------------------------- crises
    {
      key: "regulation",
      polarity: "crisis",
      weight: 12,
      effect: { demand: -0.12, cost: 0.06 },
      deadlineHours: 30,
      lastsHours: 72,
      strategies: [
        {
          key: "lobby",
          mitigation: 1,
          bonus: { awareness: 0.02 },
          steps: [
            { key: "study", hours: 3, cost: 2, branch: "law", baseBps: 9_000 },
            { key: "alliance", hours: 5, cost: 1, branch: "sales", staff: 2, baseBps: 6_500 },
            { key: "hearing", hours: 6, cost: 3, branch: "law", baseBps: 5_500 },
          ],
        },
        {
          key: "adapt",
          mitigation: 0.7,
          bonus: { quality: 0.03 },
          steps: [
            { key: "retool", hours: 8, cost: 4, staff: 1, capacityHit: 0.3, baseBps: 9_500 },
            { key: "certify", hours: 4, cost: 1, branch: "science", baseBps: 8_000 },
          ],
        },
        accept,
      ],
    },
    {
      key: "special_tax",
      polarity: "crisis",
      weight: 10,
      effect: { cost: 0.1 },
      deadlineHours: 30,
      lastsHours: 96,
      strategies: [
        {
          key: "lobby",
          mitigation: 1,
          steps: [
            { key: "petition", hours: 2, cost: 1, branch: "sales", baseBps: 9_000 },
            { key: "experts", hours: 5, cost: 2, branch: "finance", baseBps: 7_000 },
            { key: "hearing", hours: 6, cost: 3, branch: "law", baseBps: 5_500 },
          ],
        },
        {
          key: "reformulate",
          mitigation: 0.8,
          bonus: { quality: -0.02 },
          steps: [
            { key: "lab", hours: 6, cost: 3, branch: "science", staff: 1, baseBps: 6_500 },
            { key: "relaunch", hours: 4, cost: 2, branch: "sales", baseBps: 8_500 },
          ],
        },
        {
          key: "pass_on",
          mitigation: 0.5,
          steps: [{ key: "price_talk", hours: 3, cost: 1, branch: "sales", baseBps: 8_000 }],
        },
        accept,
      ],
    },
    {
      key: "supply_shortage",
      polarity: "crisis",
      weight: 11,
      effect: { capacity: -0.25, cost: 0.05 },
      deadlineHours: 24,
      lastsHours: 60,
      strategies: [
        {
          key: "new_supplier",
          mitigation: 1,
          steps: [
            { key: "scout", hours: 3, cost: 1, branch: "logistics", baseBps: 8_500 },
            { key: "contract", hours: 4, cost: 3, branch: "finance", baseBps: 7_500 },
          ],
        },
        { key: "stockpile", mitigation: 0.8, steps: [{ key: "buy_stock", hours: 2, cost: 6, baseBps: 10_000 }] },
        {
          key: "redesign",
          mitigation: 1,
          bonus: { quality: 0.02 },
          steps: [
            { key: "prototype", hours: 6, cost: 2, branch: "science", staff: 1, baseBps: 6_000 },
            { key: "switch", hours: 6, cost: 2, branch: "craft", capacityHit: 0.2, baseBps: 8_500 },
          ],
        },
        accept,
      ],
    },
    {
      key: "quality_scandal",
      polarity: "crisis",
      weight: 9,
      effect: { demand: -0.2 },
      deadlineHours: 20,
      lastsHours: 72,
      strategies: [
        {
          key: "recall",
          mitigation: 1,
          bonus: { quality: 0.04 },
          steps: [
            { key: "pull_back", hours: 4, cost: 4, branch: "logistics", capacityHit: 0.3, baseBps: 9_500 },
            { key: "fix", hours: 6, cost: 2, branch: "craft", baseBps: 7_500 },
          ],
        },
        {
          key: "pr_offensive",
          mitigation: 0.6,
          bonus: { awareness: 0.03 },
          steps: [
            { key: "statement", hours: 1, cost: 1, branch: "management", baseBps: 9_000 },
            { key: "campaign", hours: 5, cost: 3, branch: "sales", baseBps: 6_500 },
          ],
        },
        {
          key: "independent_test",
          mitigation: 0.9,
          steps: [
            { key: "lab_test", hours: 8, cost: 2, branch: "science", baseBps: 7_000 },
            { key: "publish", hours: 2, cost: 1, branch: "sales", baseBps: 9_000 },
          ],
        },
        accept,
      ],
    },
    {
      key: "data_breach",
      polarity: "crisis",
      weight: 8,
      sectors: ["tech", "retail", "logistics"],
      effect: { demand: -0.15, cost: 0.04 },
      deadlineHours: 18,
      lastsHours: 60,
      strategies: [
        {
          key: "forensics",
          mitigation: 1,
          bonus: { quality: 0.02 },
          steps: [
            { key: "analyse", hours: 4, cost: 2, branch: "it", baseBps: 7_500 },
            { key: "patch", hours: 4, cost: 1, branch: "it", staff: 2, baseBps: 8_000 },
            { key: "audit", hours: 3, cost: 2, branch: "law", baseBps: 9_000 },
          ],
        },
        {
          key: "transparency",
          mitigation: 0.6,
          bonus: { awareness: 0.01 },
          steps: [{ key: "disclose", hours: 2, cost: 1, branch: "management", baseBps: 8_500 }],
        },
        accept,
      ],
    },
    {
      key: "price_war",
      polarity: "crisis",
      weight: 10,
      effect: { demand: -0.18 },
      deadlineHours: 30,
      lastsHours: 72,
      strategies: [
        {
          key: "undercut",
          mitigation: 0.8,
          steps: [
            { key: "calculate", hours: 2, cost: 1, branch: "finance", baseBps: 9_000 },
            { key: "discount", hours: 6, cost: 4, branch: "sales", baseBps: 9_500 },
          ],
        },
        {
          key: "innovate",
          mitigation: 1,
          bonus: { quality: 0.04 },
          steps: [
            { key: "research", hours: 6, cost: 2, branch: "science", baseBps: 7_000 },
            { key: "build", hours: 6, cost: 2, branch: "craft", staff: 2, capacityHit: 0.2, baseBps: 7_500 },
            { key: "launch", hours: 3, cost: 2, branch: "sales", baseBps: 8_500 },
          ],
        },
        {
          key: "niche",
          mitigation: 0.6,
          steps: [{ key: "reposition", hours: 4, cost: 2, branch: "sales", baseBps: 8_000 }],
        },
        accept,
      ],
    },
    {
      key: "strike",
      polarity: "crisis",
      weight: 7,
      effect: { capacity: -0.35 },
      deadlineHours: 16,
      lastsHours: 48,
      strategies: [
        {
          key: "negotiate",
          mitigation: 1,
          steps: [
            { key: "listen", hours: 2, cost: 0, branch: "management", baseBps: 9_000 },
            { key: "deal", hours: 4, cost: 3, branch: "management", baseBps: 7_000 },
          ],
        },
        { key: "bonus", mitigation: 0.8, steps: [{ key: "pay_bonus", hours: 1, cost: 5, baseBps: 10_000 }] },
        {
          key: "automate",
          mitigation: 0.7,
          bonus: { quality: -0.02 },
          steps: [{ key: "machines", hours: 8, cost: 4, branch: "it", baseBps: 8_000 }],
        },
        accept,
      ],
    },
    {
      key: "protest",
      polarity: "crisis",
      weight: 8,
      effect: { demand: -0.1, cost: 0.03 },
      deadlineHours: 30,
      lastsHours: 72,
      strategies: [
        {
          key: "green",
          mitigation: 1,
          bonus: { awareness: 0.03, quality: 0.02 },
          steps: [
            { key: "footprint", hours: 4, cost: 1, branch: "science", baseBps: 8_500 },
            { key: "program", hours: 8, cost: 4, branch: "craft", staff: 1, baseBps: 8_500 },
            { key: "report", hours: 2, cost: 1, branch: "sales", baseBps: 9_000 },
          ],
        },
        {
          key: "dialogue",
          mitigation: 0.6,
          steps: [
            { key: "invite", hours: 2, cost: 0, branch: "management", baseBps: 8_500 },
            { key: "round_table", hours: 4, cost: 1, branch: "sales", baseBps: 7_000 },
          ],
        },
        accept,
      ],
    },
    {
      key: "patent_claim",
      polarity: "crisis",
      weight: 6,
      effect: { demand: -0.08, cost: 0.08 },
      deadlineHours: 36,
      lastsHours: 96,
      strategies: [
        {
          key: "lawyers",
          mitigation: 1,
          steps: [
            { key: "review", hours: 4, cost: 2, branch: "law", baseBps: 8_000 },
            { key: "court", hours: 8, cost: 4, branch: "law", baseBps: 5_500 },
          ],
        },
        { key: "license", mitigation: 0.7, steps: [{ key: "pay_license", hours: 2, cost: 5, baseBps: 10_000 }] },
        {
          key: "workaround",
          mitigation: 0.9,
          bonus: { quality: 0.02 },
          steps: [
            { key: "redesign", hours: 8, cost: 2, branch: "science", staff: 1, baseBps: 6_500 },
            { key: "test", hours: 4, cost: 1, branch: "craft", baseBps: 8_500 },
          ],
        },
        accept,
      ],
    },
    {
      key: "bad_review",
      polarity: "crisis",
      weight: 9,
      effect: { demand: -0.14 },
      deadlineHours: 24,
      lastsHours: 48,
      strategies: [
        {
          key: "improve",
          mitigation: 1,
          bonus: { quality: 0.05 },
          steps: [
            { key: "analyse", hours: 3, cost: 1, branch: "science", baseBps: 9_000 },
            { key: "rework", hours: 6, cost: 3, branch: "craft", capacityHit: 0.2, baseBps: 7_500 },
            { key: "retest", hours: 3, cost: 1, branch: "sales", baseBps: 7_000 },
          ],
        },
        {
          key: "counter",
          mitigation: 0.6,
          bonus: { awareness: 0.02 },
          steps: [{ key: "campaign", hours: 4, cost: 3, branch: "sales", baseBps: 7_500 }],
        },
        accept,
      ],
    },
    // ---------------------------------------------------------------- chances
    {
      key: "viral_trend",
      polarity: "chance",
      weight: 10,
      effect: { demand: 0.35 },
      deadlineHours: 12,
      lastsHours: 48,
      strategies: [
        {
          key: "scale_up",
          mitigation: 1,
          bonus: { awareness: 0.04 },
          steps: [
            { key: "overtime", hours: 2, cost: 2, staff: 1, baseBps: 9_500 },
            { key: "restock", hours: 4, cost: 3, branch: "logistics", baseBps: 8_500 },
          ],
        },
        {
          key: "ride_wave",
          mitigation: 0.6,
          bonus: { awareness: 0.06 },
          steps: [{ key: "content", hours: 3, cost: 1, branch: "sales", baseBps: 8_000 }],
        },
        pass,
      ],
    },
    {
      key: "big_contract",
      polarity: "chance",
      weight: 9,
      effect: { demand: 0.25 },
      deadlineHours: 24,
      lastsHours: 72,
      strategies: [
        {
          key: "pitch",
          mitigation: 1,
          steps: [
            { key: "offer", hours: 3, cost: 1, branch: "sales", baseBps: 8_500 },
            { key: "negotiate", hours: 4, cost: 1, branch: "management", baseBps: 6_500 },
            { key: "deliver", hours: 6, cost: 3, staff: 2, capacityHit: 0.2, baseBps: 9_000 },
          ],
        },
        {
          key: "quick_deal",
          mitigation: 0.5,
          steps: [{ key: "discount_offer", hours: 2, cost: 1, branch: "sales", baseBps: 9_000 }],
        },
        pass,
      ],
    },
    {
      key: "award",
      polarity: "chance",
      weight: 8,
      effect: { demand: 0.15 },
      deadlineHours: 24,
      lastsHours: 72,
      strategies: [
        {
          key: "press_tour",
          mitigation: 1,
          bonus: { awareness: 0.06 },
          steps: [
            { key: "interviews", hours: 3, cost: 1, branch: "management", baseBps: 8_500 },
            { key: "ads", hours: 4, cost: 3, branch: "sales", baseBps: 9_000 },
          ],
        },
        { key: "badge", mitigation: 0.5, steps: [{ key: "seal", hours: 1, cost: 1, baseBps: 10_000 }] },
        pass,
      ],
    },
    {
      key: "subsidy",
      polarity: "chance",
      weight: 7,
      effect: { cost: -0.08 },
      deadlineHours: 36,
      lastsHours: 96,
      strategies: [
        {
          key: "apply",
          mitigation: 1,
          steps: [
            { key: "forms", hours: 3, cost: 0, branch: "law", baseBps: 9_000 },
            { key: "plan", hours: 5, cost: 1, branch: "finance", baseBps: 7_500 },
            { key: "jury", hours: 4, cost: 0, branch: "management", baseBps: 6_000 },
          ],
        },
        pass,
      ],
    },
    {
      key: "partnership",
      polarity: "chance",
      weight: 7,
      effect: { demand: 0.2, capacity: 0.1 },
      deadlineHours: 24,
      lastsHours: 96,
      strategies: [
        {
          key: "join",
          mitigation: 1,
          bonus: { awareness: 0.03 },
          steps: [
            { key: "meeting", hours: 2, cost: 0, branch: "management", baseBps: 9_000 },
            { key: "integrate", hours: 6, cost: 2, branch: "it", staff: 1, baseBps: 7_500 },
          ],
        },
        pass,
      ],
    },
  ],
};
