/**
 * Stock heat harness (ADR-214): price paths of a hot player stock before (daily band +100 %/−50 %, no market forces)
 * and after (no band, market forces). Prints the distribution of 24-hour and 7-day gains.
 * Run: pnpm exec tsx scripts/stock-heat-harness.ts [days] [seeds]
 */
import { quantile, simulateStockPath, type StockPathOptions } from "../src/lib/sim/market-forces.ts";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)} %`;

const SCENARIOS: { name: string; base: Omit<StockPathOptions, "dailyBandBps" | "forces" | "days"> }[] = [
  {
    name: "Hype: Firma +3 %/Quartal, Spieler kaufen 20.000 €/h und jagen den Trend (40.000 €/h)",
    base: { fairGrowthPerQuarter: 0.03, steadyBuyCentsPerHour: 2_000_000, chaseBuyCentsPerHour: 4_000_000 },
  },
  {
    name: "Wachstum: Firma +10 %/Quartal, 5.000 €/h, Trendjagd 20.000 €/h",
    base: { fairGrowthPerQuarter: 0.1, steadyBuyCentsPerHour: 500_000, chaseBuyCentsPerHour: 2_000_000 },
  },
  {
    name: "Reiner Hype: Firma +0 %, Spieler kaufen 20.000 €/h und jagen den Trend (40.000 €/h)",
    base: { fairGrowthPerQuarter: 0, steadyBuyCentsPerHour: 2_000_000, chaseBuyCentsPerHour: 4_000_000 },
  },
  {
    name: "Ruhig: Firma +2 %/Quartal, keine Spieler",
    base: { fairGrowthPerQuarter: 0.02, steadyBuyCentsPerHour: 0, chaseBuyCentsPerHour: 0 },
  },
];

function main() {
  const days = Number(process.argv[2] ?? 14);
  const seeds = Array.from({ length: Number(process.argv[3] ?? 8) }, (_, i) => i + 1);
  console.log(
    "| Szenario | Modell | 24 h Median | 24 h p90 | 24 h max | 7 Tage Median | 7 Tage p90 | Kurs/fair am Ende | Kräfte/Tag |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of SCENARIOS) {
    for (const after of [false, true]) {
      const runs = seeds.map((seed) =>
        simulateStockPath({ ...s.base, days, dailyBandBps: after ? 0 : 10_000, forces: after }, seed),
      );
      const day = runs.flatMap((r) => r.dayGains);
      const week = runs.flatMap((r) => r.weekGains);
      const prem = quantile(
        runs.map((r) => r.endPremium),
        0.5,
      );
      const hits = runs.reduce((a, r) => a + r.forcesHit, 0) / runs.length / days;
      console.log(
        `| ${s.name} | ${after ? "nachher" : "vorher"} | ${pct(quantile(day, 0.5))} | ${pct(quantile(day, 0.9))} | ${pct(Math.max(...day))} | ${pct(quantile(week, 0.5))} | ${pct(quantile(week, 0.9))} | ${prem.toFixed(2).replace(".", ",")} | ${hits.toFixed(1).replace(".", ",")} |`,
      );
    }
  }
}

main();
