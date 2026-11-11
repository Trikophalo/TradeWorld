import { BALANCE } from "@/config/balance";
import { scaledXp, unlockLevel } from "@/lib/sim/progression";
import type { MissionKind } from "../types";

/*
 * Mission catalogue of the offline demo. The live game uses the server's
 * catalogue (get_my_missions); both follow docs/ECONOMY.md and the same rules:
 * quick missions refill, daily and weekly ones reset, milestones form a story.
 */

/** What a mission counts. Every metric is fed by the demo engine. */
export type Metric =
  | "trades"
  | "buys"
  | "sells"
  | "buy_value_cents"
  | "profit_cents"
  | "vault_claims"
  | "views"
  | "rich_list_views"
  | "rules_views"
  | "limit_orders"
  | "bond_buys"
  | "sectors_held"
  | "net_worth_cents"
  | "level"
  | "amount_orders"
  | "check_ins";

export interface MissionTemplate {
  key: string;
  kind: MissionKind;
  title: string;
  metric: Metric;
  target: number;
  /** Base XP, before the alpha multiplier. */
  xp: number;
  /** Only offered once this unlock is reached. */
  requires?: string;
}

const xp = BALANCE.progression.xpSources;
const q = xp.quickMission;
const d = xp.dailyMission;
const w = xp.weeklyMission;
const m = xp.milestoneMission;

export const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  // quick: a few minutes
  { key: "q_view_3", kind: "quick", title: "Sieh dir 3 Aktien an", metric: "views", target: 3, xp: q.minXp },
  { key: "q_vault", kind: "quick", title: "Leere deinen Tresor", metric: "vault_claims", target: 1, xp: q.minXp + 10 },
  { key: "q_trade_1", kind: "quick", title: "Führe einen Trade aus", metric: "trades", target: 1, xp: q.minXp + 20 },
  {
    key: "q_amount",
    kind: "quick",
    title: "Kaufe per Betrag statt per Stückzahl",
    metric: "amount_orders",
    target: 1,
    xp: q.minXp + 20,
  },
  {
    key: "q_rich_list",
    kind: "quick",
    title: "Wirf einen Blick auf die Reichenliste",
    metric: "rich_list_views",
    target: 1,
    xp: q.minXp,
  },
  { key: "q_rules", kind: "quick", title: "Lies die Spielregeln", metric: "rules_views", target: 1, xp: q.minXp },
  { key: "q_sell", kind: "quick", title: "Verkaufe eine Position", metric: "sells", target: 1, xp: q.maxXp },
  { key: "q_view_5", kind: "quick", title: "Sieh dir 5 Aktien an", metric: "views", target: 5, xp: q.minXp + 10 },
  {
    key: "q_limit",
    kind: "quick",
    title: "Setze eine Limit-Order",
    metric: "limit_orders",
    target: 1,
    xp: q.maxXp,
    requires: "limit_orders",
  },
  // daily
  { key: "d_trades_3", kind: "daily", title: "Mach heute 3 Trades", metric: "trades", target: 3, xp: d.minXp },
  {
    key: "d_buy_500",
    kind: "daily",
    title: "Kaufe heute für mindestens 500 €",
    metric: "buy_value_cents",
    target: 50_000,
    xp: d.minXp,
  },
  {
    key: "d_profit_50",
    kind: "daily",
    title: "Erziele heute 50 € Gewinn mit Verkäufen",
    metric: "profit_cents",
    target: 5_000,
    xp: d.maxXp,
  },
  {
    key: "d_vault_2",
    kind: "daily",
    title: "Leere heute zweimal deinen Tresor",
    metric: "vault_claims",
    target: 2,
    xp: d.minXp,
  },
  {
    key: "d_sectors_2",
    kind: "daily",
    title: "Halte Aktien aus 2 Branchen",
    metric: "sectors_held",
    target: 2,
    xp: d.minXp + 100,
  },
  {
    key: "d_check_in",
    kind: "daily",
    title: "Hol dir deinen täglichen Bonus",
    metric: "check_ins",
    target: 1,
    xp: d.minXp,
  },
  // weekly
  {
    key: "w_trades_20",
    kind: "weekly",
    title: "Mach diese Woche 20 Trades",
    metric: "trades",
    target: 20,
    xp: w.minXp,
  },
  {
    key: "w_profit_500",
    kind: "weekly",
    title: "Erziele diese Woche 500 € Gewinn",
    metric: "profit_cents",
    target: 50_000,
    xp: w.maxXp,
  },
  {
    key: "w_sectors_4",
    kind: "weekly",
    title: "Halte Aktien aus 4 Branchen",
    metric: "sectors_held",
    target: 4,
    xp: w.minXp + 200,
  },
  {
    key: "w_buy_5000",
    kind: "weekly",
    title: "Kaufe diese Woche für 5.000 €",
    metric: "buy_value_cents",
    target: 500_000,
    xp: w.minXp + 200,
  },
  {
    key: "w_bond",
    kind: "weekly",
    title: "Kaufe eine Staatsanleihe",
    metric: "bond_buys",
    target: 1,
    xp: w.minXp,
    requires: "bonds",
  },
  // milestones: a story along the way
  { key: "m_first_trade", kind: "milestone", title: "Dein erster Trade", metric: "trades", target: 1, xp: m.minXp },
  {
    key: "m_first_profit",
    kind: "milestone",
    title: "Verkaufe zum ersten Mal mit Gewinn",
    metric: "profit_cents",
    target: 1,
    xp: m.minXp + 100,
  },
  {
    key: "m_sectors_3",
    kind: "milestone",
    title: "Investiere in 3 Branchen",
    metric: "sectors_held",
    target: 3,
    xp: m.minXp + 200,
  },
  { key: "m_level_3", kind: "milestone", title: "Erreiche Level 3", metric: "level", target: 3, xp: m.minXp + 100 },
  {
    key: "m_worth_11k",
    kind: "milestone",
    title: "Erreiche 11.000 € Vermögen",
    metric: "net_worth_cents",
    target: 1_100_000,
    xp: m.minXp + 200,
  },
  { key: "m_level_5", kind: "milestone", title: "Erreiche Level 5", metric: "level", target: 5, xp: m.minXp + 300 },
  {
    key: "m_worth_12_5k",
    kind: "milestone",
    title: "Erreiche 12.500 € Vermögen",
    metric: "net_worth_cents",
    target: 1_250_000,
    xp: m.minXp + 400,
  },
  {
    key: "m_first_bond",
    kind: "milestone",
    title: "Kaufe deine erste Staatsanleihe",
    metric: "bond_buys",
    target: 1,
    xp: m.minXp + 200,
    requires: "bonds",
  },
  {
    key: "m_worth_15k",
    kind: "milestone",
    title: "Erreiche 15.000 € Vermögen",
    metric: "net_worth_cents",
    target: 1_500_000,
    xp: m.minXp + 600,
  },
  { key: "m_level_10", kind: "milestone", title: "Erreiche Level 10", metric: "level", target: 10, xp: m.minXp + 900 },
  {
    key: "m_worth_25k",
    kind: "milestone",
    title: "Erreiche 25.000 € Vermögen",
    metric: "net_worth_cents",
    target: 2_500_000,
    xp: m.maxXp,
  },
];

export function availableFor(template: MissionTemplate, level: number): boolean {
  if (!template.requires) return true;
  const needed = unlockLevel(template.requires);
  return needed === null || level >= needed;
}

export function missionXp(template: MissionTemplate): number {
  return scaledXp(template.xp);
}
