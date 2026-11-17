/*
 * Fertigkeiten of player companies (ADR-194): what the company itself gets better at, one or two per area of the
 * player skill map. Every level needs one skill of the map, held by the founder or by a player employed in the
 * company (active job), costs company money and takes training hours before it works. The effect is a small,
 * capped term of the hourly close: demand, capacity, goods costs, fixed costs or quality.
 *
 * Keys are stored per company and must never change; names and texts live in messages/*.json under
 * "companySkills". Pure data, no imports (runs in Deno and SQL reads it from game_config "companySkills").
 */
export const COMPANY_SKILL_EFFECTS = ["demand", "capacity", "cogs", "fixed", "quality"] as const;
export type CompanySkillEffect = (typeof COMPANY_SKILL_EFFECTS)[number];

export interface CompanySkillConfig {
  readonly key: string;
  /** Area of the skill map (src/config/skills.ts SKILL_BRANCHES). */
  readonly branch: string;
  readonly effect: CompanySkillEffect;
  /**
   * Effect per level in basis points: demand and capacity +, cogs and fixed costs − (as a share), quality + quality
   * points × 10 000 (quality is 0..1).
   */
  readonly perLevelBps: number;
  /** Skill of the map each level needs (index 0 = level 1). */
  readonly requires: readonly string[];
}

export const COMPANY_SKILLS: readonly CompanySkillConfig[] = [
  {
    key: "data_analysis",
    branch: "it",
    effect: "demand",
    perLevelBps: 100,
    requires: ["it_data", "it_ml", "it_databases", "it_ai", "it_bigdata"],
  },
  {
    key: "automation",
    branch: "it",
    effect: "capacity",
    perLevelBps: 150,
    requires: ["it_programming", "it_devops", "it_cloud", "it_testing", "it_mastery"],
  },
  {
    key: "cost_control",
    branch: "finance",
    effect: "fixed",
    perLevelBps: 200,
    requires: [
      "finance_accounting",
      "finance_controlling",
      "finance_budgeting",
      "finance_corporate",
      "finance_mastery",
    ],
  },
  {
    key: "contracts",
    branch: "law",
    effect: "cogs",
    perLevelBps: 100,
    requires: ["law_contracts", "law_tax", "law_corporate", "law_capital", "law_mastery"],
  },
  {
    key: "craftsmanship",
    branch: "craft",
    effect: "quality",
    perLevelBps: 60,
    requires: ["craft_mechanics", "craft_engineering", "craft_manufacturing", "craft_cnc", "craft_mastery"],
  },
  {
    key: "campaigns",
    branch: "sales",
    effect: "demand",
    perLevelBps: 100,
    requires: ["sales_marketing", "sales_brand", "sales_seo", "sales_growth", "sales_mastery"],
  },
  {
    key: "leadership",
    branch: "management",
    effect: "capacity",
    perLevelBps: 100,
    requires: [
      "management_team",
      "management_people",
      "management_agile",
      "management_operations",
      "management_mastery",
    ],
  },
  {
    key: "research",
    branch: "science",
    effect: "quality",
    perLevelBps: 60,
    requires: ["science_physics", "science_lab", "science_statistics", "science_materials", "science_mastery"],
  },
  {
    key: "supply_chain",
    branch: "logistics",
    effect: "cogs",
    perLevelBps: 100,
    requires: [
      "logistics_purchasing",
      "logistics_supplychain",
      "logistics_strategic",
      "logistics_global",
      "logistics_mastery",
    ],
  },
];

export const COMPANY_SKILL_RULES = {
  maxLevel: 5,
  /** Company money per level (index 0 = level 1), in cents: 1 000 € … 50 000 €. */
  costCentsByLevel: [100_000, 300_000, 800_000, 2_000_000, 5_000_000],
  /** Training hours until a learned level works (game time). */
  trainingHoursByLevel: [1, 2, 4, 8, 12],
  /** Cap of the summed effect per kind, in basis points (see perLevelBps). */
  capBps: { demand: 1000, capacity: 1000, cogs: 800, fixed: 1000, quality: 500 },
} as const;
