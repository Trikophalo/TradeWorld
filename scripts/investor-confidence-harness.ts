/**
 * Investor confidence harness (ADR-216): a small market (10 AI stocks, 3 player stocks) on the real tick engine,
 * before (ADR-214: AI business grows with the full sector growth, no confidence) and after (confidence, market mood,
 * cyclical AI business). Prints the distribution of 7- and 30-day returns, returns against the fair value, and the
 * index's drawdowns.
 * Run: pnpm exec tsx scripts/investor-confidence-harness.ts [days] [seeds]
 */
import { drawdowns, simulateMarket, windowReturns, type MarketRun } from "../src/lib/sim/confidence-market.ts";
import { quantile } from "../src/lib/sim/market-forces.ts";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)} %`;
const share = (xs: number[], f: (x: number) => boolean) =>
  `${Math.round((xs.filter(f).length / Math.max(1, xs.length)) * 100)} %`;

function row(label: string, xs: number[]) {
  if (xs.length === 0) return `| ${label} | – | – | – | – | – | – |`;
  return `| ${label} | ${pct(quantile(xs, 0.1))} | ${pct(quantile(xs, 0.5))} | ${pct(quantile(xs, 0.9))} | ${pct(Math.min(...xs))} | ${pct(Math.max(...xs))} | ${share(xs, (x) => x < 0)} |`;
}

function main() {
  const days = Number(process.argv[2] ?? 30);
  const seeds = Array.from({ length: Number(process.argv[3] ?? 3) }, (_, i) => i + 1);
  const runs: Record<"before" | "after", MarketRun[]> = { before: [], after: [] };
  for (const model of ["before", "after"] as const) {
    for (const seed of seeds) {
      const t0 = Date.now();
      runs[model].push(simulateMarket(model, days, seed));
      console.error(`${model} seed ${seed}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }
  console.log("| Gruppe, Zeitraum | p10 | Median | p90 | min | max | Anteil im Minus |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const model of ["before", "after"] as const) {
    const rs = runs[model];
    const name = model === "before" ? "vorher" : "nachher";
    for (const kind of ["ai", "player"] as const) {
      const k = kind === "ai" ? "KI" : "Spieler";
      // 7 days stepped by one day (overlapping windows), 30 days from the start
      console.log(
        row(
          `${name}: ${k} 7 Tage`,
          rs.flatMap((r) => windowReturns(r, kind, 168, 24)),
        ),
      );
      console.log(
        row(
          `${name}: ${k} 7 Tage gegen fairen Wert`,
          rs.flatMap((r) => windowReturns(r, kind, 168, 24, true)),
        ),
      );
      if (days >= 30)
        console.log(
          row(
            `${name}: ${k} 30 Tage`,
            rs.flatMap((r) => windowReturns(r, kind, 720, 720)),
          ),
        );
    }
  }
  console.log("");
  console.log(
    "| Spieleraktie | Modell | 7 Tage p10 | 7 Tage Median | 7 Tage p90 | Kurs/fair am Ende (Median) | Vorfälle je 30 Tage |",
  );
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  const first = runs.before[0]!;
  first.ids.forEach((id, i) => {
    if (first.kinds[i] !== "player") return;
    for (const model of ["before", "after"] as const) {
      const rs = runs[model];
      const week: number[] = [];
      for (const r of rs)
        for (let h = 168; h < r.prices[i]!.length; h += 24) week.push(r.prices[i]![h]! / r.prices[i]![h - 168]! - 1);
      const prem = quantile(
        rs.map((r) => r.prices[i]!.at(-1)! / r.fairs[i]!.at(-1)!),
        0.5,
      );
      const inc = rs.reduce((a, r) => a + r.incidents[i]!, 0) / rs.length / (days / 30);
      console.log(
        `| ${id} | ${model === "before" ? "vorher" : "nachher"} | ${pct(quantile(week, 0.1))} | ${pct(quantile(week, 0.5))} | ${pct(quantile(week, 0.9))} | ${prem.toFixed(2).replace(".", ",")} | ${inc.toFixed(1).replace(".", ",")} |`,
      );
    }
  });
  console.log("");
  console.log(
    "| Modell | KI-Index am Ende (Median) | größter Rückgang (Median) | größter Rückgang (max) | größte Rally (max) | Stunden Bärenphase je Lauf |",
  );
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const model of ["before", "after"] as const) {
    const rs = runs[model];
    const dd = rs.map((r) => drawdowns(r.index));
    const bear = rs.reduce((a, r) => a + r.phases.filter((p) => p === "bear").length, 0) / rs.length;
    console.log(
      `| ${model === "before" ? "vorher" : "nachher"} | ${pct(
        quantile(
          rs.map((r) => r.index[r.index.length - 1]! - 1),
          0.5,
        ),
      )} | ${pct(
        -quantile(
          dd.map((d) => d.maxDrawdown),
          0.5,
        ),
      )} | ${pct(-Math.max(...dd.map((d) => d.maxDrawdown)))} | ${pct(Math.max(...dd.map((d) => d.maxRally)))} | ${bear.toFixed(0)} |`,
    );
  }
}

main();
