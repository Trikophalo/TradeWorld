import type { CompanyHourCosts, HourCostPart } from "../types";

/*
 * Demo of get_company_hour_costs (ADR-208, Nachtrag): fixed and variable costs of the last closed hour of the demo
 * company. The demo hour records revenue, profit, wages, fixed costs and marketing; the goods are what is left of the
 * costs. Insurance and overhead (ADR-209) are a share of the revenue inside the goods, split out like the server.
 */
export interface DemoHourInput {
  hourStart: string | null;
  revenueCents: number;
  profitCents: number;
  playerWagesCents: number;
  aiWagesCents: number;
  fixedCents: number;
  marketingCents: number;
  talentsCents: number;
  /** Insurance premium and overhead as basis points of the revenue. */
  premiumBps: number;
  overheadBps: number;
}

const sum = (parts: readonly HourCostPart[]) => parts.reduce((s, p) => s + p.cents, 0);

export function demoHourCosts(h: DemoHourInput): CompanyHourCosts {
  if (h.hourStart === null)
    return { hourStart: null, revenueCents: 0, fixedCents: 0, variableCents: 0, fixed: [], variable: [] };
  const rest = Math.max(
    0,
    h.revenueCents - h.profitCents - h.playerWagesCents - h.aiWagesCents - h.fixedCents - h.marketingCents,
  );
  let insurance = Math.floor((h.revenueCents * h.premiumBps) / 10_000);
  let overhead = Math.floor((h.revenueCents * h.overheadBps) / 10_000);
  if (insurance + overhead > rest) {
    insurance = insurance + overhead > 0 ? Math.floor((rest * insurance) / (insurance + overhead)) : 0;
    overhead = rest - insurance;
  }
  const fixed: HourCostPart[] = [
    { key: "wages_players", cents: h.playerWagesCents },
    { key: "wages_ai", cents: h.aiWagesCents },
    { key: "talents", cents: h.talentsCents },
    { key: "rent", cents: h.fixedCents },
    { key: "marketing", cents: h.marketingCents },
    { key: "upkeep", cents: 0 },
    { key: "advisor", cents: 0 },
    { key: "subsidiaries", cents: 0 },
    { key: "insurance", cents: insurance },
    { key: "overhead", cents: overhead },
  ];
  const variable: HourCostPart[] = [
    { key: "goods", cents: rest - insurance - overhead },
    { key: "profit_share", cents: 0 },
    { key: "location_fee", cents: 0 },
    { key: "supply_fees", cents: 0 },
  ];
  return {
    hourStart: h.hourStart,
    revenueCents: h.revenueCents,
    fixedCents: sum(fixed),
    variableCents: sum(variable),
    fixed,
    variable,
  };
}
