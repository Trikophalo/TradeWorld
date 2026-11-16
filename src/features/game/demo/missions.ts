import { BALANCE } from "@/config/balance";
import { scaledXp, unlockLevel, missionBaseXp } from "@/lib/sim/progression";
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
  | "check_ins"
  | "art_likes"
  | "art_bids"
  | "artworks_painted"
  | "auctions_started"
  | "nft_offers"
  | "rentals_offered"
  | "tenants_found"
  | "rent_cents"
  | "homes_rented"
  | "wohnwert"
  | "battle_joins"
  | "battle_wins"
  | "nexamon_packs"
  | "nexamon_rares"
  | "nexamon_ultras"
  | "nexamon_sold"
  | "nexamon_tens";

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
  {
    key: "w_battles",
    kind: "weekly",
    title: "Spiel bei 3 News-Battles mit",
    metric: "battle_joins",
    target: 3,
    xp: w.minXp + 100,
  },
  // milestones: a story along the way
  { key: "m_first_trade", kind: "milestone", title: "Dein erster Trade", metric: "trades", target: 1, xp: m.minXp },
  {
    key: "m_battle_first",
    kind: "milestone",
    title: "Dein erstes News-Battle",
    metric: "battle_joins",
    target: 1,
    xp: m.minXp + 200,
  },
  {
    key: "m_battle_win",
    kind: "milestone",
    title: "Gewinne ein News-Battle",
    metric: "battle_wins",
    target: 1,
    xp: 800,
  },
  {
    key: "m_battle_win_10",
    kind: "milestone",
    title: "10 News-Battles gewonnen",
    metric: "battle_wins",
    target: 10,
    xp: m.maxXp,
  },
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
  // More variety (ADR-081): quick
  { key: "q_view_8", kind: "quick", title: "Sieh dir 8 Aktien an", metric: "views", target: 8, xp: q.minXp + 20 },
  { key: "q_buy_2", kind: "quick", title: "Kaufe zweimal", metric: "buys", target: 2, xp: q.minXp + 20 },
  {
    key: "q_buy_250",
    kind: "quick",
    title: "Kaufe für mindestens 250 €",
    metric: "buy_value_cents",
    target: 25_000,
    xp: q.minXp + 10,
  },
  {
    key: "q_check_in",
    kind: "quick",
    title: "Hol dir deinen täglichen Bonus",
    metric: "check_ins",
    target: 1,
    xp: q.minXp,
  },
  { key: "q_sell_2", kind: "quick", title: "Verkaufe zwei Positionen", metric: "sells", target: 2, xp: q.maxXp },
  {
    key: "q_like_art",
    kind: "quick",
    title: "Gib einem NFT ein Herz",
    metric: "art_likes",
    target: 1,
    xp: q.minXp,
    requires: "artworks",
  },
  {
    key: "q_like_art_3",
    kind: "quick",
    title: "Gib 3 NFTs ein Herz",
    metric: "art_likes",
    target: 3,
    xp: q.minXp + 20,
    requires: "artworks",
  },
  {
    key: "q_nft_offer",
    kind: "quick",
    title: "Mach ein Preisangebot für ein NFT",
    metric: "nft_offers",
    target: 1,
    xp: q.maxXp,
    requires: "artworks",
  },
  {
    key: "q_bid",
    kind: "quick",
    title: "Biete bei einer NFT-Auktion mit",
    metric: "art_bids",
    target: 1,
    xp: q.maxXp,
    requires: "artworks",
  },
  // daily
  { key: "d_trades_5", kind: "daily", title: "Mach heute 5 Trades", metric: "trades", target: 5, xp: d.minXp + 50 },
  {
    key: "d_views_10",
    kind: "daily",
    title: "Recherchiere: sieh dir 10 Aktien an",
    metric: "views",
    target: 10,
    xp: d.minXp,
  },
  { key: "d_sell_2", kind: "daily", title: "Verkaufe heute zweimal", metric: "sells", target: 2, xp: d.minXp + 50 },
  {
    key: "d_buy_2000",
    kind: "daily",
    title: "Kaufe heute für mindestens 2.000 €",
    metric: "buy_value_cents",
    target: 200_000,
    xp: d.minXp + 100,
  },
  {
    key: "d_vault_3",
    kind: "daily",
    title: "Leere heute dreimal deinen Tresor",
    metric: "vault_claims",
    target: 3,
    xp: d.minXp + 50,
  },
  {
    key: "d_like_art_5",
    kind: "daily",
    title: "Verteile heute 5 Herzen an NFTs",
    metric: "art_likes",
    target: 5,
    xp: d.minXp,
    requires: "artworks",
  },
  {
    key: "d_bid_2",
    kind: "daily",
    title: "Biete heute bei 2 Auktionen",
    metric: "art_bids",
    target: 2,
    xp: d.minXp + 100,
    requires: "artworks",
  },
  // weekly
  {
    key: "w_trades_40",
    kind: "weekly",
    title: "Mach diese Woche 40 Trades",
    metric: "trades",
    target: 40,
    xp: w.minXp + 300,
  },
  {
    key: "w_views_40",
    kind: "weekly",
    title: "Sieh dir diese Woche 40 Aktien an",
    metric: "views",
    target: 40,
    xp: w.minXp,
  },
  {
    key: "w_profit_2000",
    kind: "weekly",
    title: "Erziele diese Woche 2.000 € Gewinn",
    metric: "profit_cents",
    target: 200_000,
    xp: w.maxXp,
  },
  {
    key: "w_check_in_5",
    kind: "weekly",
    title: "Hol dir an 5 Tagen den Tagesbonus",
    metric: "check_ins",
    target: 5,
    xp: w.minXp + 200,
  },
  {
    key: "w_bonds_3",
    kind: "weekly",
    title: "Kaufe diese Woche 3 Anleihen",
    metric: "bond_buys",
    target: 3,
    xp: w.minXp + 200,
    requires: "bonds",
  },
  {
    key: "w_bids_5",
    kind: "weekly",
    title: "Biete diese Woche bei 5 NFT-Auktionen",
    metric: "art_bids",
    target: 5,
    xp: w.minXp + 200,
    requires: "artworks",
  },
  {
    key: "w_auction",
    kind: "weekly",
    title: "Versteigere ein NFT",
    metric: "auctions_started",
    target: 1,
    xp: w.minXp + 300,
    requires: "artworks",
  },
  // milestones
  {
    key: "m_trades_25",
    kind: "milestone",
    title: "25 Trades insgesamt",
    metric: "trades",
    target: 25,
    xp: m.minXp + 200,
  },
  {
    key: "m_trades_100",
    kind: "milestone",
    title: "100 Trades insgesamt",
    metric: "trades",
    target: 100,
    xp: m.minXp + 500,
  },
  {
    key: "m_profit_1000",
    kind: "milestone",
    title: "Insgesamt 1.000 € Gewinn",
    metric: "profit_cents",
    target: 100_000,
    xp: m.minXp + 300,
  },
  { key: "m_level_8", kind: "milestone", title: "Erreiche Level 8", metric: "level", target: 8, xp: m.minXp + 400 },
  { key: "m_level_10", kind: "milestone", title: "Erreiche Level 10", metric: "level", target: 10, xp: m.minXp + 500 },
  {
    key: "m_worth_20k",
    kind: "milestone",
    title: "Erreiche 20.000 € Vermögen",
    metric: "net_worth_cents",
    target: 2_000_000,
    xp: m.minXp + 500,
  },
  {
    key: "m_worth_50k",
    kind: "milestone",
    title: "Erreiche 50.000 € Vermögen",
    metric: "net_worth_cents",
    target: 5_000_000,
    xp: m.maxXp,
  },
  {
    key: "m_first_art",
    kind: "milestone",
    title: "Präge dein erstes NFT",
    metric: "artworks_painted",
    target: 1,
    xp: m.minXp + 400,
    requires: "artworks",
  },
  {
    key: "m_first_bid",
    kind: "milestone",
    title: "Dein erstes Gebot bei einer NFT-Auktion",
    metric: "art_bids",
    target: 1,
    xp: m.minXp + 200,
    requires: "artworks",
  },
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
  // renting out places in the home (ADR-158)
  {
    key: "m_rent_offer",
    kind: "milestone",
    title: "Biete einen Platz zur Miete an",
    metric: "rentals_offered",
    target: 1,
    xp: 400,
    requires: "property",
  },
  {
    key: "m_rent_tenant",
    kind: "milestone",
    title: "Dein erster Mieter",
    metric: "tenants_found",
    target: 1,
    xp: 600,
    requires: "property",
  },
  {
    key: "m_wohnwert_60",
    kind: "milestone",
    title: "Wohnwert 60",
    metric: "wohnwert",
    target: 60,
    xp: 700,
    requires: "property",
  },
  {
    key: "m_wohnwert_90",
    kind: "milestone",
    title: "Wohnwert 90",
    metric: "wohnwert",
    target: 90,
    xp: 1500,
    requires: "property",
  },
  {
    key: "m_rent_home",
    kind: "milestone",
    title: "Wohne zur Miete",
    metric: "homes_rented",
    target: 1,
    xp: 500,
    requires: "property",
  },
  {
    key: "d_rent_earn",
    kind: "daily",
    title: "Nimm 300 € Miete ein",
    metric: "rent_cents",
    target: 30_000,
    xp: d.minXp + 50,
    requires: "property",
  },
  {
    key: "w_rent_earn",
    kind: "weekly",
    title: "Nimm 3.000 € Miete ein",
    metric: "rent_cents",
    target: 300_000,
    xp: w.minXp + 200,
    requires: "property",
  },
  // Nexamon collectible cards (ADR-165)
  {
    key: "d_nexamon_pack",
    kind: "daily",
    title: "Öffne einen Nexamon-Booster",
    metric: "nexamon_packs",
    target: 1,
    xp: d.minXp,
    requires: "nexamon",
  },
  {
    key: "m_nexamon_first_pack",
    kind: "milestone",
    title: "Dein erster Booster",
    metric: "nexamon_packs",
    target: 1,
    xp: 300,
    requires: "nexamon",
  },
  {
    key: "m_nexamon_first_rare",
    kind: "milestone",
    title: "Deine erste Rare",
    metric: "nexamon_rares",
    target: 1,
    xp: 400,
    requires: "nexamon",
  },
  {
    key: "m_nexamon_packs_10",
    kind: "milestone",
    title: "10 Booster geöffnet",
    metric: "nexamon_packs",
    target: 10,
    xp: 800,
    requires: "nexamon",
  },
  {
    key: "m_nexamon_first_sale",
    kind: "milestone",
    title: "Erste Karte verkauft",
    metric: "nexamon_sold",
    target: 1,
    xp: 500,
    requires: "nexamon",
  },
  {
    key: "m_nexamon_first_ultra",
    kind: "milestone",
    title: "Deine erste Ultra Rare",
    metric: "nexamon_ultras",
    target: 1,
    xp: 1000,
    requires: "nexamon",
  },
  {
    key: "m_nexamon_first_ten",
    kind: "milestone",
    title: "Die erste 10",
    metric: "nexamon_tens",
    target: 1,
    xp: 1500,
    requires: "nexamon",
  },
];

export function availableFor(template: MissionTemplate, level: number): boolean {
  if (!template.requires) return true;
  const needed = unlockLevel(template.requires);
  return needed === null || level >= needed;
}

/** XP a mission pays at this level (ADR-142: more at higher levels). */
export function missionXp(template: MissionTemplate, level = 1): number {
  return scaledXp(missionBaseXp(template.xp, level));
}

// ------------------------------------------------------------------ ADR-166: affordable missions, daily reset

/** What the demo player can move: cash, and cash plus the value of the open positions. */
export interface MissionMeans {
  cashCents: number;
  tradableCents: number;
}

const afford = BALANCE.progression.missionAfford;
const share = (cents: number, bps: number) => Math.floor((cents * bps) / 10_000);

/**
 * The server's rule (mission_affordable) for the demo catalogue: no quick, daily or weekly mission that asks for
 * money the player does not have. The demo's targets are part of the title, so they are not clamped: a mission
 * that is too big is simply not offered. Milestones stay saving goals.
 */
export function affordableFor(template: MissionTemplate, means: MissionMeans): boolean {
  if (template.kind === "milestone") return true;
  switch (template.metric) {
    case "buy_value_cents":
      // counted over all buys of the period: volume
      return (
        means.cashCents >= afford.minCashCents &&
        template.target <= share(means.tradableCents, afford.volumeShareBps[template.kind])
      );
    case "profit_cents":
      return template.target <= share(means.tradableCents, afford.profitShareBps[template.kind]);
    case "buys":
    case "bond_buys":
    case "amount_orders":
    case "art_bids":
    case "nft_offers":
      return means.cashCents >= afford.minCashCents;
    default:
      return true;
  }
}

/** The swaps of one Berlin day and the templates they removed (those rest for the day). */
export interface MissionResetState {
  day: string;
  used: number;
  keys: string[];
}

/** The reset state of `today`: yesterday's swaps no longer count. */
export function resetStateOn(state: MissionResetState | undefined, today: string): MissionResetState {
  return state && state.day === today ? state : { day: today, used: 0, keys: [] };
}

export function resetAvailableOn(state: MissionResetState | undefined, today: string): boolean {
  return resetStateOn(state, today).used < BALANCE.progression.missionResetsPerDay;
}

/**
 * Splits the missions for a reset: open quick, daily and weekly ones go; finished ones (waiting for their claim or
 * claimed) and milestones stay.
 */
export function splitForReset<T extends { kind: MissionKind; status: string }>(
  missions: readonly T[],
): { kept: T[]; removed: T[] } {
  const removed = missions.filter((mission) => mission.kind !== "milestone" && mission.status === "active");
  return { kept: missions.filter((mission) => !removed.includes(mission)), removed };
}
