/**
 * Talent value harness (ADR-199): what one talent of each tier earns per hour for a company of 10 Mio., 100 Mio. and
 * 1 Mrd. € value (growth harness of ADR-209, friction on), compared with its wage. Counterfactual per hour: the same
 * state closed once without and once with the talent's effect.
 * Run: pnpm exec tsx scripts/talent-value.ts [seeds]
 */
import { BALANCE } from "../src/config/balance.ts";
import { TALENT_ROLES, TALENT_RULES } from "../src/config/talents.ts";
import { GROWTH_SCENARIOS, MILESTONES, runGrowth } from "../src/lib/sim/growth.ts";
import { closeStartupHour } from "../src/lib/sim/startup.ts";

const eur = (c: number) => `${Math.round(c / 100).toLocaleString("de-DE")} €`;
const baseBps = (key: string) => TALENT_ROLES.find((r) => r.key === key)!.baseBps;
const TIER_NAMES = ["Junior", "Profi", "Senior", "Experte", "Legende"];

function main() {
  const seeds = Array.from({ length: Number(process.argv[2] ?? 3) }, (_, i) => i + 1);
  const scenario = GROWTH_SCENARIOS[1]!;
  console.log(
    "| Firmenwert | Stufe | Lohn/h (Produktion) | + Gewinn/h Vertrieb | + Gewinn/h Produktion | + Gewinn/h Controlling |",
  );
  for (const m of [100_000_000, ...MILESTONES]) {
    const sums = { demand: [0, 0, 0, 0, 0], capacity: [0, 0, 0, 0, 0], fixed: [0, 0, 0, 0, 0], profit: 0, revenue: 0 };
    let n = 0;
    for (const seed of seeds) {
      let start: number | null = null;
      runGrowth(scenario, {
        friction: true,
        hours: 24 * 2_200,
        seed,
        milestonesCents: [m],
        probe: (h, value, state, input) => {
          if (start === null && value >= m) start = h;
          if (start === null || h >= start + 24) return;
          const base = closeStartupHour(state, input, BALANCE);
          const ev = input.event ?? { demandFactor: 1, capacityFactor: 1, extraCostShare: 0 };
          sums.profit += Number(base.profitCents);
          sums.revenue += Number(base.revenueCents);
          for (let tier = 0; tier < 5; tier++) {
            const k = TALENT_RULES.effectPctByTier[tier]! / 100;
            const demandFactor = ev.demandFactor * (1 + (baseBps("sales") * k) / 10_000);
            const capacityFactor = ev.capacityFactor * (1 + (baseBps("production") * k) / 10_000);
            const d = closeStartupHour(state, { ...input, event: { ...ev, demandFactor } }, BALANCE);
            const c = closeStartupHour(state, { ...input, event: { ...ev, capacityFactor } }, BALANCE);
            sums.demand[tier]! += Number(d.profitCents - base.profitCents);
            sums.capacity[tier]! += Number(c.profitCents - base.profitCents);
            sums.fixed[tier]! += (Number(base.fixedCents) * baseBps("controlling") * k) / 10_000;
          }
          n += 1;
        },
      });
    }
    console.log(`| ${eur(m)} | Umsatz/h ${eur(sums.revenue / n)} | Gewinn/h ${eur(sums.profit / n)} | | | |`);
    for (let tier = 0; tier < 5; tier++) {
      const wage =
        (TALENT_RULES.wageCentsByTier[tier]! * TALENT_ROLES.find((r) => r.key === "production")!.wagePct) / 100;
      console.log(
        `| | ${TIER_NAMES[tier]} | ${eur(wage)} | ${eur(sums.demand[tier]! / n)} | ${eur(sums.capacity[tier]! / n)} | ${eur(sums.fixed[tier]! / n)} |`,
      );
    }
  }
}

main();
