/**
 * Growth harness (ADR-209): how long a well-run company needs to 10 Mio., 100 Mio. and 1 Mrd. € company value, before
 * and after the size friction, plus the tax of small, mid-size and large listed companies.
 * Run: pnpm exec tsx scripts/growth-harness.ts [days] [seeds]
 */
import { BALANCE } from "../src/config/balance.ts";
import { GROWTH_SCENARIOS, MILESTONES, medianReach } from "../src/lib/sim/growth.ts";
import { advisorWageCents, progressiveTaxCents } from "../src/lib/sim/listed.ts";

const fmt = (h: number | null) => (h === null ? "–" : h < 48 ? `${h} h` : `${(h / 24).toFixed(1)} Tage`);
const eur = (c: number) => `${Math.round(c / 100).toLocaleString("de-DE")} €`;

function main() {
  const days = Number(process.argv[2] ?? 120);
  const seeds = Array.from({ length: Number(process.argv[3] ?? 5) }, (_, i) => i + 1);
  console.log(`| Szenario | Modell | ${MILESTONES.map((m) => eur(m)).join(" | ")} |`);
  for (const s of GROWTH_SCENARIOS) {
    for (const friction of [false, true]) {
      const r = medianReach(s, { friction, hours: days * 24 }, seeds);
      console.log(`| ${s.name} | ${friction ? "nachher" : "vorher"} | ${r.map(fmt).join(" | ")} |`);
    }
  }
  console.log(
    "\n| Firma | Gewinn/Tag | Steuer vorher | Steuer nachher | Umsatz/h | Berater/h vorher | Berater/h nachher |",
  );
  const rate = BALANCE.listed.taxes.rateBps;
  for (const [name, profit, rev] of [
    ["klein", 2_400_000, 50_000],
    ["mittel", 50_000_000, 1_000_000],
    ["groß", 1_000_000_000, 20_000_000],
    ["Konzern", 10_000_000_000, 200_000_000],
  ] as const) {
    const before = Math.floor((profit * rate) / 10_000);
    const after = progressiveTaxCents(profit, rate, 24);
    const oldAdvisor = Math.max(4_000, Math.round((rev * 100) / 10_000));
    const pct = (x: number) => ((x / profit) * 100).toFixed(1).replace(".", ",");
    console.log(
      `| ${name} | ${eur(profit)} | ${eur(before)} (${pct(before)} %) | ${eur(after)} (${pct(after)} %) | ${eur(rev)} | ${eur(oldAdvisor)} | ${eur(advisorWageCents(rev))} |`,
    );
  }
}

main();
