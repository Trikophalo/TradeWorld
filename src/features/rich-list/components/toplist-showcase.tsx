"use client";

import type { CompanyRankingEntry, NetWorthBreakdown, RichListEntry } from "@/features/game/types";
import { CompanyRow } from "./company-ranking";
import { NetWorthBreakdownView } from "./net-worth-breakdown";
import { RankingMethod, RankingColumns, RankMove } from "./ranking-parts";
import { RankRow } from "./rank-row";

const PLAYER: RichListEntry = {
  rank: 7,
  kind: "player",
  id: "showcase-player",
  name: "Boersenfuchs_7",
  description: null,
  netWorthCents: 5_212_000_00,
  change24hBps: 412,
  rankChange24h: 2,
  isMe: false,
  avatarKey: "analyst",
  source: "company",
};

const COMPANIES: CompanyRankingEntry[] = [
  {
    rank: 3,
    companyId: "showcase-listed",
    kind: "player",
    name: "Listwerk AG",
    color: "#336699",
    logo: null,
    ticker: "LSTW",
    sector: "tech",
    tier: "ag",
    founder: "Boersenfuchs_7",
    valueCents: 300_000_000,
    basis: "market_cap",
    priceE4: 30_000,
    revenueCents: 12_000_000,
    teamSize: 9,
    isMine: true,
    change24hBps: -850,
    rankChange24h: -1,
  },
  {
    rank: 4,
    companyId: "showcase-private",
    kind: "player",
    name: "Garagen Code",
    color: "#22aa66",
    logo: null,
    ticker: null,
    sector: "retail",
    tier: "gmbh",
    founder: "Mira",
    valueCents: 249_000_000,
    basis: "company_value",
    priceE4: null,
    revenueCents: 4_000_000,
    teamSize: 4,
    isMine: false,
    change24hBps: null,
    rankChange24h: null,
  },
];

const BREAKDOWN: NetWorthBreakdown = {
  serverTime: "2026-11-17T12:00:00Z",
  totalCents: 5_212_000_00,
  parts: {
    cash: 41_200_00,
    depot: 1_220_000_00,
    company: 3_600_000_00,
    cards: 18_400_00,
    slabs: 92_000_00,
    nfts: 110_300_00,
    property: 160_000_00,
    vault: 4_800_00,
    escrow: 0,
    deals: 25_300_00,
    debt: -60_000_00,
  },
  company: {
    name: "Listwerk AG",
    cents: 300_000_000,
    basis: "market_cap",
    companyValueCents: 4_940_000_000,
    priceE4: 30_000,
    shares: 1_000_000,
  },
};

/** Toplist building blocks for /dev/ui (ADR-203). */
export function ToplistShowcase() {
  return (
    <div className="grid gap-4 *:min-w-0 lg:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-line-1 bg-surface-1 p-4">
        <RankingMethod board="forbes" />
        <RankingColumns name="Name" value="Vermögen · 24 h" />
        <RankRow entry={PLAYER} />
        <RankingMethod board="companies" />
        {COMPANIES.map((c) => (
          <CompanyRow key={c.companyId} entry={c} />
        ))}
        <p className="flex gap-4">
          <RankMove moved={3} />
          <RankMove moved={-2} />
        </p>
      </div>
      <NetWorthBreakdownView data={BREAKDOWN} />
      <NetWorthBreakdownView data={undefined} />
    </div>
  );
}
