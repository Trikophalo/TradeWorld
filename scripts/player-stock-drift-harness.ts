/**
 * Player stock drift harness (ADR-217): the live market of ADR-216 (confidence, mood, incidents, AI business cycle)
 * with four realistic player companies behind their stocks: hourly profit that grows and wobbles, cash that piles up
 * (no dividends), the automatic CEO payout, a founder who invests, players who buy and chase the trend and rarely
 * sell. Compares the old fair value (company value at the quarter close: cash + 4 × quarter profit × P/E × 0,5) with
 * the new valuation (expected profit × breathing multiple, piled-up cash hardly counts).
 * Run: pnpm exec tsx scripts/player-stock-drift-harness.ts [days] [seeds]
 */
import { HARNESS_STOCKS, simulateMarket, type HarnessStock, type MarketRun } from "../src/lib/sim/confidence-market.ts";
import { quantile } from "../src/lib/sim/market-forces.ts";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)} %`;
const share = (xs: number[], f: (x: number) => boolean) =>
  `${Math.round((xs.filter(f).length / Math.max(1, xs.length)) * 100)} %`;

/** Live-like player companies (1 Mio. shares, half held by the founder). */
export const PLAYER_COMPANIES: readonly HarnessStock[] = [
  {
    id: "Wachstum (Tech)",
    kind: "player",
    sector: "tech",
    size: "penny",
    priceE4: 0,
    freeFloat: 500_000,
    steadyBuyCentsPerHour: 300_000,
    chaseBuyCentsPerHour: 1_000_000,
    company: {
      profitCentsPerHour: 200_000,
      growthPerDay: 0.04,
      growthTauDays: 12,
      hourNoise: 0.25,
      walkPerHour: 0.02,
      cashCents: 15_000_000,
      payoutShare: 0,
      investShareDaily: 0.1,
      paybackDays: 12,
    },
  },
  {
    id: "Reif, hortet Kasse (Handel)",
    kind: "player",
    sector: "retail",
    size: "penny",
    priceE4: 0,
    freeFloat: 500_000,
    steadyBuyCentsPerHour: 600_000,
    chaseBuyCentsPerHour: 1_500_000,
    company: {
      profitCentsPerHour: 500_000,
      growthPerDay: 0,
      growthTauDays: 10,
      hourNoise: 0.25,
      walkPerHour: 0.02,
      cashCents: 30_000_000,
      payoutShare: 0,
    },
  },
  {
    id: "Ruhig, CEO-Auszahlung 30 % (Logistik)",
    kind: "player",
    sector: "logistics",
    size: "penny",
    priceE4: 0,
    freeFloat: 500_000,
    company: {
      profitCentsPerHour: 150_000,
      growthPerDay: 0.01,
      growthTauDays: 20,
      hourNoise: 0.2,
      walkPerHour: 0.015,
      cashCents: 5_000_000,
      payoutShare: 0.3,
    },
  },
  {
    id: "Investiert viel (Pharma)",
    kind: "player",
    sector: "pharma",
    size: "penny",
    priceE4: 0,
    freeFloat: 500_000,
    steadyBuyCentsPerHour: 200_000,
    chaseBuyCentsPerHour: 500_000,
    company: {
      profitCentsPerHour: 300_000,
      growthPerDay: 0.01,
      growthTauDays: 15,
      hourNoise: 0.3,
      walkPerHour: 0.025,
      cashCents: 10_000_000,
      payoutShare: 0.1,
      investShareDaily: 0.25,
      paybackDays: 12,
    },
  },
];

const STOCKS: readonly HarnessStock[] = [...HARNESS_STOCKS.filter((s) => s.kind === "ai"), ...PLAYER_COMPANIES];

function weekly(run: MarketRun, i: number, relative: boolean): number[] {
  const out: number[] = [];
  const p = run.prices[i]!;
  for (let h = 168; h < p.length; h += 24) {
    const r = p[h]! / p[h - 168]!;
    out.push(relative ? r / (run.index[h]! / run.index[h - 168]!) - 1 : r - 1);
  }
  return out;
}

function row(label: string, xs: number[]) {
  return `| ${label} | ${pct(quantile(xs, 0.1))} | ${pct(quantile(xs, 0.5))} | ${pct(quantile(xs, 0.9))} | ${share(xs, (x) => x < 0)} |`;
}

function main() {
  const days = Number(process.argv[2] ?? 30);
  const seeds = Array.from({ length: Number(process.argv[3] ?? 4) }, (_, i) => i + 1);
  const runs: Record<"legacy" | "earnings", MarketRun[]> = { legacy: [], earnings: [] };
  for (const valuation of ["legacy", "earnings"] as const) {
    for (const seed of seeds) {
      const t0 = Date.now();
      runs[valuation].push(simulateMarket("after", days, seed, STOCKS, { valuation }));
      console.error(`${valuation} seed ${seed}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }
  const players = STOCKS.map((s, i) => (s.kind === "player" ? i : -1)).filter((i) => i >= 0);
  const name = (v: "legacy" | "earnings") => (v === "legacy" ? "vorher" : "nachher");
  console.log("| Spieleraktien, 7 Tage | p10 | Median | p90 | Anteil im Minus |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const v of ["legacy", "earnings"] as const) {
    console.log(
      row(
        `${name(v)}: absolut`,
        runs[v].flatMap((r) => players.flatMap((i) => weekly(r, i, false))),
      ),
    );
    console.log(
      row(
        `${name(v)}: gegen den KI-Markt`,
        runs[v].flatMap((r) => players.flatMap((i) => weekly(r, i, true))),
      ),
    );
  }
  console.log("");
  console.log(
    "| Spielerfirma | Modell | 7 Tage Median | im Minus | Gesamt (Median) | fairer Wert gesamt | Gewinn/h gesamt | Vorfälle je 30 Tage |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const i of players) {
    for (const v of ["legacy", "earnings"] as const) {
      const rs = runs[v];
      const week = rs.flatMap((r) => weekly(r, i, false));
      const total = quantile(
        rs.map((r) => r.prices[i]!.at(-1)! / r.prices[i]![0]! - 1),
        0.5,
      );
      const fairTotal = quantile(
        rs.map((r) => r.fairs[i]!.at(-1)! / r.fairs[i]![0]! - 1),
        0.5,
      );
      const profit = quantile(
        rs.map((r) => (r.profits?.[i]?.at(-1) ?? 1) / (r.profits?.[i]?.[0] ?? 1) - 1),
        0.5,
      );
      const inc = rs.reduce((a, r) => a + r.incidents[i]!, 0) / rs.length / (days / 30);
      console.log(
        `| ${STOCKS[i]!.id} | ${name(v)} | ${pct(quantile(week, 0.5))} | ${share(week, (x) => x < 0)} | ${pct(total)} | ${pct(fairTotal)} | ${pct(profit)} | ${inc.toFixed(1).replace(".", ",")} |`,
      );
    }
  }
  const idx = (v: "legacy" | "earnings") =>
    pct(
      quantile(
        runs[v].map((r) => r.index.at(-1)! - 1),
        0.5,
      ),
    );
  console.log("");
  console.log(`KI-Index am Ende (Median): vorher ${idx("legacy")}, nachher ${idx("earnings")}`);
}

main();
