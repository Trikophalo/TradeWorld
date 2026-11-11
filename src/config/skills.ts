/**
 * The skill tree (owner decision, ADR-050, docs/JOBS_AND_SKILLS.md). GENERATED structure,
 * edit with care: keys are stored per player in the database and must never change.
 * Names and descriptions live in messages/*.json under "skills".
 *
 * Pure data, no imports: read by the UI, the demo engine and (through game_config)
 * the database.
 */

export const SKILL_BRANCHES = ["it", "finance", "law", "craft", "sales", "management", "science", "logistics"] as const;
export type SkillBranch = (typeof SKILL_BRANCHES)[number];

export interface SkillNodeConfig {
  readonly key: string;
  /** One branch, or two for hybrid skills (they count for both). */
  readonly branches: readonly SkillBranch[];
  /** 1 = basics … 5 = mastery. Cost and branch score follow the tier. */
  readonly tier: number;
  /** All of these must be learned first. */
  readonly requires: readonly string[];
}

export const SKILL_NODES: readonly SkillNodeConfig[] = [
  { key: "it_basics", branches: ["it"], tier: 1, requires: [] },
  { key: "it_programming", branches: ["it"], tier: 2, requires: ["it_basics"] },
  { key: "it_networks", branches: ["it"], tier: 2, requires: ["it_basics"] },
  { key: "it_data", branches: ["it"], tier: 2, requires: ["it_basics"] },
  { key: "it_architecture", branches: ["it"], tier: 3, requires: ["it_programming"] },
  { key: "it_security", branches: ["it"], tier: 3, requires: ["it_networks"] },
  { key: "it_ml", branches: ["it"], tier: 3, requires: ["it_data"] },
  { key: "it_cloud", branches: ["it"], tier: 4, requires: ["it_architecture"] },
  { key: "it_ai", branches: ["it"], tier: 4, requires: ["it_ml"] },
  { key: "it_mastery", branches: ["it"], tier: 5, requires: ["it_cloud", "it_ai"] },
  { key: "finance_basics", branches: ["finance"], tier: 1, requires: [] },
  { key: "finance_accounting", branches: ["finance"], tier: 2, requires: ["finance_basics"] },
  { key: "finance_investment", branches: ["finance"], tier: 2, requires: ["finance_basics"] },
  { key: "finance_controlling", branches: ["finance"], tier: 2, requires: ["finance_basics"] },
  { key: "finance_balance", branches: ["finance"], tier: 3, requires: ["finance_accounting"] },
  { key: "finance_portfolio", branches: ["finance"], tier: 3, requires: ["finance_investment"] },
  { key: "finance_valuation", branches: ["finance"], tier: 3, requires: ["finance_controlling"] },
  { key: "finance_corporate", branches: ["finance"], tier: 4, requires: ["finance_balance"] },
  { key: "finance_risk", branches: ["finance"], tier: 4, requires: ["finance_valuation"] },
  { key: "finance_mastery", branches: ["finance"], tier: 5, requires: ["finance_corporate", "finance_risk"] },
  { key: "law_basics", branches: ["law"], tier: 1, requires: [] },
  { key: "law_contracts", branches: ["law"], tier: 2, requires: ["law_basics"] },
  { key: "law_labor", branches: ["law"], tier: 2, requires: ["law_basics"] },
  { key: "law_tax", branches: ["law"], tier: 2, requires: ["law_basics"] },
  { key: "law_corporate", branches: ["law"], tier: 3, requires: ["law_contracts"] },
  { key: "law_compliance", branches: ["law"], tier: 3, requires: ["law_labor"] },
  { key: "law_intltax", branches: ["law"], tier: 3, requires: ["law_tax"] },
  { key: "law_capital", branches: ["law"], tier: 4, requires: ["law_corporate"] },
  { key: "law_crime", branches: ["law"], tier: 4, requires: ["law_intltax"] },
  { key: "law_mastery", branches: ["law"], tier: 5, requires: ["law_capital", "law_crime"] },
  { key: "craft_basics", branches: ["craft"], tier: 1, requires: [] },
  { key: "craft_mechanics", branches: ["craft"], tier: 2, requires: ["craft_basics"] },
  { key: "craft_electrical", branches: ["craft"], tier: 2, requires: ["craft_basics"] },
  { key: "craft_construction", branches: ["craft"], tier: 2, requires: ["craft_basics"] },
  { key: "craft_engineering", branches: ["craft"], tier: 3, requires: ["craft_mechanics"] },
  { key: "craft_automation", branches: ["craft"], tier: 3, requires: ["craft_electrical"] },
  { key: "craft_site", branches: ["craft"], tier: 3, requires: ["craft_construction"] },
  { key: "craft_manufacturing", branches: ["craft"], tier: 4, requires: ["craft_engineering"] },
  { key: "craft_energy", branches: ["craft"], tier: 4, requires: ["craft_site"] },
  { key: "craft_mastery", branches: ["craft"], tier: 5, requires: ["craft_manufacturing", "craft_energy"] },
  { key: "sales_basics", branches: ["sales"], tier: 1, requires: [] },
  { key: "sales_selling", branches: ["sales"], tier: 2, requires: ["sales_basics"] },
  { key: "sales_marketing", branches: ["sales"], tier: 2, requires: ["sales_basics"] },
  { key: "sales_service", branches: ["sales"], tier: 2, requires: ["sales_basics"] },
  { key: "sales_negotiation", branches: ["sales"], tier: 3, requires: ["sales_selling"] },
  { key: "sales_brand", branches: ["sales"], tier: 3, requires: ["sales_marketing"] },
  { key: "sales_keyaccount", branches: ["sales"], tier: 3, requires: ["sales_service"] },
  { key: "sales_international", branches: ["sales"], tier: 4, requires: ["sales_negotiation"] },
  { key: "sales_growth", branches: ["sales"], tier: 4, requires: ["sales_keyaccount"] },
  { key: "sales_mastery", branches: ["sales"], tier: 5, requires: ["sales_international", "sales_growth"] },
  { key: "management_basics", branches: ["management"], tier: 1, requires: [] },
  { key: "management_team", branches: ["management"], tier: 2, requires: ["management_basics"] },
  { key: "management_projects", branches: ["management"], tier: 2, requires: ["management_basics"] },
  { key: "management_people", branches: ["management"], tier: 2, requires: ["management_basics"] },
  { key: "management_change", branches: ["management"], tier: 3, requires: ["management_team"] },
  { key: "management_agile", branches: ["management"], tier: 3, requires: ["management_projects"] },
  { key: "management_recruiting", branches: ["management"], tier: 3, requires: ["management_people"] },
  { key: "management_strategy", branches: ["management"], tier: 4, requires: ["management_change"] },
  { key: "management_organization", branches: ["management"], tier: 4, requires: ["management_recruiting"] },
  {
    key: "management_mastery",
    branches: ["management"],
    tier: 5,
    requires: ["management_strategy", "management_organization"],
  },
  { key: "science_basics", branches: ["science"], tier: 1, requires: [] },
  { key: "science_chemistry", branches: ["science"], tier: 2, requires: ["science_basics"] },
  { key: "science_biology", branches: ["science"], tier: 2, requires: ["science_basics"] },
  { key: "science_medicine", branches: ["science"], tier: 2, requires: ["science_basics"] },
  { key: "science_pharmacology", branches: ["science"], tier: 3, requires: ["science_chemistry"] },
  { key: "science_biotech", branches: ["science"], tier: 3, requires: ["science_biology"] },
  { key: "science_clinical", branches: ["science"], tier: 3, requires: ["science_medicine"] },
  { key: "science_drugs", branches: ["science"], tier: 4, requires: ["science_pharmacology"] },
  { key: "science_genetics", branches: ["science"], tier: 4, requires: ["science_clinical"] },
  { key: "science_mastery", branches: ["science"], tier: 5, requires: ["science_drugs", "science_genetics"] },
  { key: "logistics_basics", branches: ["logistics"], tier: 1, requires: [] },
  { key: "logistics_warehouse", branches: ["logistics"], tier: 2, requires: ["logistics_basics"] },
  { key: "logistics_transport", branches: ["logistics"], tier: 2, requires: ["logistics_basics"] },
  { key: "logistics_purchasing", branches: ["logistics"], tier: 2, requires: ["logistics_basics"] },
  { key: "logistics_supplychain", branches: ["logistics"], tier: 3, requires: ["logistics_warehouse"] },
  { key: "logistics_fleet", branches: ["logistics"], tier: 3, requires: ["logistics_transport"] },
  { key: "logistics_strategic", branches: ["logistics"], tier: 3, requires: ["logistics_purchasing"] },
  { key: "logistics_global", branches: ["logistics"], tier: 4, requires: ["logistics_supplychain"] },
  { key: "logistics_quality", branches: ["logistics"], tier: 4, requires: ["logistics_strategic"] },
  { key: "logistics_mastery", branches: ["logistics"], tier: 5, requires: ["logistics_global", "logistics_quality"] },
  { key: "hybrid_fintech", branches: ["it", "finance"], tier: 4, requires: ["it_programming", "finance_investment"] },
  {
    key: "hybrid_business_law",
    branches: ["law", "finance"],
    tier: 4,
    requires: ["law_contracts", "finance_accounting"],
  },
  { key: "hybrid_industry40", branches: ["craft", "it"], tier: 4, requires: ["craft_electrical", "it_programming"] },
  {
    key: "hybrid_pharma_sales",
    branches: ["science", "sales"],
    tier: 4,
    requires: ["science_medicine", "sales_selling"],
  },
  {
    key: "hybrid_ecommerce",
    branches: ["sales", "logistics"],
    tier: 4,
    requires: ["sales_marketing", "logistics_transport"],
  },
  {
    key: "hybrid_people_analytics",
    branches: ["management", "it"],
    tier: 4,
    requires: ["management_people", "it_data"],
  },
];
