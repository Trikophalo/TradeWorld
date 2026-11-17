import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { awarenessCap } from "@/lib/sim/awareness";
import { awarenessView } from "./awareness-view";

const src = (p: string) => readFileSync(join(process.cwd(), "src/features/company", p), "utf8");

describe("one awareness on the company page (ADR-188)", () => {
  it("shows the server's value against the same cap as the SQL", () => {
    const v = awarenessView({ awarenessBps: 4_925, tier: "garage", stage: 1, expansionLevel: 0 });
    expect(v.pct).toBe(49.3);
    expect(v.capPct).toBe(Math.round(awarenessCap("garage", 1, 0) * 100));
    expect(v.capPct).toBe(65);
    expect(v.ofCap).toBeCloseTo(0.4925 / 0.65, 12);
    expect(v.atCap).toBe(false);
  });

  it("dashboard (status bar) and controlling (market card) read it through the same function", () => {
    const bar = src("components/status-bar.tsx");
    const market = src("components/company-parts.tsx");
    const meter = src("awareness/awareness-meter.tsx");
    expect(bar).toContain("awarenessView(company)");
    expect(market).toContain("<AwarenessMeter company={company} />");
    expect(meter).toContain("awarenessView(company)");
    // no second, private formula for the awareness in either place
    expect(bar).not.toMatch(/awarenessBps\s*\/\s*100/);
    expect(market).not.toMatch(/bps=\{company\.awarenessBps\}/);
  });
});
