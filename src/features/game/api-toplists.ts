import { z } from "zod";
import type { CompanyRankingEntry, CompanyWorth, GameEngine, NetWorthBreakdown, WealthPart } from "./types";
import { WEALTH_PARTS } from "./types";
import { rpc } from "./rpc";

/*
 * Toplists (ADR-074, ADR-203): Forbes 100 / Alle (get_rich_list), Top-Unternehmen (get_company_ranking) and the own
 * net worth in parts (get_my_net_worth). Every number comes from one server function: player_wealth_parts for the
 * net worth, company_worth_cents for a company.
 */
const num = z.number();
const nnum = z.number().nullable();
const iso = z.string();
const source = z.enum(["cash", "depot", "company", "cards", "nfts", "property"]).nullable().catch(null);

export const worthSchema = z.object({
  cents: num,
  basis: z.enum(["market_cap", "company_value"]),
  company_value_cents: nnum.default(null),
  price_e4: nnum.default(null),
  shares: nnum.default(null),
});

export const toWorth = (w: z.infer<typeof worthSchema>): CompanyWorth => ({
  cents: w.cents,
  basis: w.basis,
  companyValueCents: w.company_value_cents,
  priceE4: w.price_e4,
  shares: w.shares,
});

const rankingEntrySchema = z.object({
  rank: num,
  company_id: z.string(),
  kind: z.enum(["ai", "player"]),
  name: z.string(),
  color: z.string(),
  logo: z
    .object({ palette: z.array(z.string()), grid: z.array(z.string()) })
    .nullable()
    .default(null),
  ticker: z.string().nullable(),
  sector: z.enum(["tech", "retail", "energy", "pharma", "logistics"]).nullable(),
  tier: z.enum(["garage", "small_business", "gmbh", "ag"]).nullable(),
  founder: z.string().nullable(),
  value_cents: num,
  basis: z.enum(["market_cap", "company_value"]).default("company_value"),
  price_e4: nnum.default(null),
  revenue_cents: nnum,
  team_size: nnum,
  is_mine: z.boolean(),
  change_24h_bps: nnum.default(null),
  rank_change_24h: nnum.default(null),
});

const companyRankingSchema = z.object({
  server_time: iso,
  total: num,
  entries: z.array(rankingEntrySchema),
  // older servers sent {rank, value_cents} only
  mine: rankingEntrySchema.nullable().catch(null),
});

const richListSchema = z.object({
  server_time: iso,
  total: num,
  entries: z.array(
    z.object({
      rank: num,
      kind: z.enum(["player", "tycoon"]),
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      net_worth_cents: num,
      change_24h_bps: nnum,
      rank_change_24h: nnum,
      is_me: z.boolean(),
      avatar_key: z.string().nullable().default(null),
      source: source.default(null),
    }),
  ),
  me: z
    .object({
      rank: num,
      net_worth_cents: num,
      change_24h_bps: nnum.default(null),
      rank_change_24h: nnum.default(null),
      next: z.object({ rank: num, name: z.string(), gap_cents: num }).nullable(),
    })
    .nullable(),
});

const netWorthSchema = z.object({
  server_time: iso,
  total_cents: num,
  parts: z.object({
    cash_cents: num,
    depot_cents: num,
    company_cents: num,
    cards_cents: num,
    slabs_cents: num,
    nfts_cents: num,
    property_cents: num,
    vault_cents: num,
    escrow_cents: num,
    deals_cents: num,
    debt_cents: num,
  }),
  company: worthSchema.extend({ name: z.string() }).nullable(),
});

export const TOPLIST_RPC_SCHEMAS = {
  get_rich_list: richListSchema,
  get_company_ranking: companyRankingSchema,
  get_my_net_worth: netWorthSchema,
} as const;

const toRankingEntry = (e: z.infer<typeof rankingEntrySchema>): CompanyRankingEntry => ({
  rank: e.rank,
  companyId: e.company_id,
  kind: e.kind,
  name: e.name,
  color: e.color,
  logo: e.logo,
  ticker: e.ticker,
  sector: e.sector,
  tier: e.tier,
  founder: e.founder,
  valueCents: e.value_cents,
  basis: e.basis,
  priceE4: e.price_e4,
  revenueCents: e.revenue_cents,
  teamSize: e.team_size,
  isMine: e.is_mine,
  change24hBps: e.change_24h_bps,
  rankChange24h: e.rank_change_24h,
});

/** The answer of get_my_net_worth as the client uses it (exported for the contract test). */
export function toNetWorth(r: z.infer<typeof netWorthSchema>): NetWorthBreakdown {
  const parts = Object.fromEntries(WEALTH_PARTS.map((p) => [p, r.parts[`${p}_cents`]])) as Record<WealthPart, number>;
  return {
    serverTime: r.server_time,
    totalCents: r.total_cents,
    parts,
    company: r.company ? { ...toWorth(r.company), name: r.company.name } : null,
  };
}

export const liveToplistEngine: Pick<GameEngine, "richList" | "companyRanking" | "myNetWorth"> = {
  async richList(scope, limit, offset) {
    const r = await rpc("get_rich_list", { p_scope: scope, p_limit: limit, p_offset: offset }, richListSchema);
    return {
      serverTime: r.server_time,
      total: r.total,
      entries: r.entries.map((e) => ({
        rank: e.rank,
        kind: e.kind,
        id: e.id,
        name: e.name,
        description: e.description,
        netWorthCents: e.net_worth_cents,
        change24hBps: e.change_24h_bps,
        rankChange24h: e.rank_change_24h,
        isMe: e.is_me,
        avatarKey: e.avatar_key,
        source: e.source,
      })),
      me: r.me
        ? {
            rank: r.me.rank,
            netWorthCents: r.me.net_worth_cents,
            change24hBps: r.me.change_24h_bps,
            rankChange24h: r.me.rank_change_24h,
            next: r.me.next ? { rank: r.me.next.rank, name: r.me.next.name, gapCents: r.me.next.gap_cents } : null,
          }
        : null,
    };
  },

  async companyRanking(scope, limit, sector = null) {
    const params: Record<string, unknown> = { p_scope: scope, p_limit: limit };
    // Only sent when filtering: older servers know get_company_ranking(p_scope, p_limit) alone.
    if (sector) params.p_sector = sector;
    const r = await rpc("get_company_ranking", params, companyRankingSchema);
    return {
      serverTime: r.server_time,
      total: r.total,
      entries: r.entries.map(toRankingEntry),
      mine: r.mine ? toRankingEntry(r.mine) : null,
    };
  },

  async myNetWorth() {
    return toNetWorth(await rpc("get_my_net_worth", {}, netWorthSchema));
  },
};
