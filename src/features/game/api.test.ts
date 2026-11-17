import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { bottleneck } from "@/features/company/routes";
import { companyHealth } from "@/lib/sim/company-health";
import { isValidBanner } from "@/lib/sim/logo";
import { RPC_SCHEMAS } from "./api";
import { staffValue } from "@/features/company/staff-value";
import { toCompanyOverview } from "./api-company";

/*
 * Contract test between database and frontend. The fixtures are real
 * responses of the Postgres RPCs, written by
 *   NEXA_FIXTURE_DIR=$PWD/src/features/game/__fixtures__ bash supabase/tests/verify_local.sh
 * Regenerate them after every change to the RPCs. If a schema here rejects a
 * fixture, the live game would show an error instead of data.
 */
const dir = fileURLToPath(new URL("./__fixtures__/", import.meta.url));
const fixtures = readdirSync(dir).filter((file) => file.endsWith(".json"));

function schemaFor(file: string) {
  const name = Object.keys(RPC_SCHEMAS)
    .sort((a, b) => b.length - a.length)
    .find((key) => file.startsWith(key));
  if (!name) throw new Error(`no schema for fixture ${file}`);
  return RPC_SCHEMAS[name as keyof typeof RPC_SCHEMAS];
}

describe("RPC contract", () => {
  it("has a fixture for every RPC the client calls", () => {
    // M3f RPCs are written in parallel with the database (TODO: remove once get_offers.json exists).
    const m3f = [
      "set_company_logo",
      "report_company_logo",
      "go_public",
      "capital_increase",
      "get_offers",
      "subscribe_offer",
    ];
    const pending = fixtures.some((file) => file.startsWith("get_offers")) ? [] : m3f;
    for (const name of Object.keys(RPC_SCHEMAS).filter((key) => !pending.includes(key))) {
      expect(
        fixtures.some((file) => file.startsWith(name)),
        name,
      ).toBe(true);
    }
  });

  for (const file of fixtures) {
    it(`${file} matches the client schema`, () => {
      const data: unknown = JSON.parse(readFileSync(dir + file, "utf8"));
      const result = schemaFor(file).safeParse(data);
      expect(result.success ? [] : result.error.issues.slice(0, 5)).toEqual([]);
    });
  }

  it("the snapshot contains the 25 AI stocks, the listed player companies, 4 bonds and the index", () => {
    const snapshot = RPC_SCHEMAS.get_market_snapshot.parse(
      JSON.parse(readFileSync(dir + "get_market_snapshot.json", "utf8")),
    );
    const stocks = snapshot.securities.filter((s) => s.kind === "stock");
    expect(stocks.filter((s) => s.company_kind === "ai")).toHaveLength(25);
    // Player companies stand in the same list (ADR-145), every stock with a popularity score.
    expect(stocks.some((s) => s.company_kind === "player")).toBe(true);
    for (const s of stocks) expect(s.popularity).toBeGreaterThanOrEqual(0);
    expect(snapshot.securities.filter((s) => s.kind === "bond")).toHaveLength(4);
    expect(snapshot.index.ticker).toBe("NEXA30");
    for (const s of snapshot.securities) expect(s.bid_e4).toBeLessThan(s.ask_e4);
  });

  // Company fixes (migration 5300): what the company page needs from a company that grew into a GmbH.
  it("a small business upgraded to GmbH: expandable, real hourly numbers, campaign end, 16-colour banner", () => {
    const raw = RPC_SCHEMAS.get_my_company.parse(
      JSON.parse(readFileSync(dir + "get_my_company_gmbh_upgraded.json", "utf8")),
    );
    const company = toCompanyOverview(raw).company!;
    expect(company.tier).toBe("gmbh");
    expect(company.canExpand).toBe(true);
    expect(company.expansionCostCents).toBeGreaterThan(0);
    // After the first closed hour the page must leave "the first hour is running".
    expect(company.hours.length).toBeGreaterThanOrEqual(3);
    expect(company.live).not.toBeNull();
    expect(bottleneck(company).kind).not.toBe("waiting");
    expect(company.live!.capacityPerHourCents).toBeGreaterThan(0);
    expect(company.live!.profitPerHourCents).toBe(company.hours.at(-1)!.profitCents);
    // The health chart works on the closed hour, not on estimates, and shows its profit.
    const health = companyHealth(company, BALANCE);
    expect(health.estimated).toBe(false);
    expect(health.profitPerHourCents).toBe(company.live!.profitPerHourCents);
    // A running campaign with the time it ends, a banner with all 16 colours.
    expect(Date.parse(company.campaign!.endsAt)).toBeGreaterThan(Date.parse(company.campaign!.startedAt));
    expect(company.banner!.palette).toHaveLength(16);
    expect(isValidBanner(company.banner)).toBe(true);
    expect(company.banner!.grid.join("")).toContain("f");
  });

  // ADR-176: what the owner's company page reads on the live server (real RPC answers).
  it("a listed company: hours and live numbers, strengths; strategy and payout answers carry the stored values", () => {
    const read = (name: string) => JSON.parse(readFileSync(dir + name, "utf8"));
    const listed = toCompanyOverview(RPC_SCHEMAS.get_my_company.parse(read("get_my_company_listed.json"))).company!;
    expect(listed.listing?.status).toBe("listed");
    expect(listed.hours.length).toBeGreaterThan(0);
    expect(listed.live).not.toBeNull();
    expect(listed.strengths).not.toBeNull();
    expect(listed.strengths!.hours).toBe(listed.hours.length);
    expect(listed.strengths!.closeError).toBeNull();
    expect(Object.keys(listed.strengths!.scores).sort()).toEqual(
      ["awareness", "delivery", "finance", "margin", "quality", "team"].sort(),
    );
    // ADR-183: the reputation of every company, and what each hour used for "Was jeder leistet"
    expect(listed.reputation).not.toBeNull();
    expect(listed.reputation!.history.length).toBe(listed.hours.length);
    expect(listed.reputation!.drivers).toHaveProperty("quality");
    expect(listed.closeWarnings).toEqual([]);
    const hour = listed.hours.at(-1)!;
    expect(hour.capacityCents).toBeGreaterThan(0);
    expect(hour.demandCents).toBeGreaterThan(0);
    expect(hour.aiWagesPaidCents).not.toBeNull();
    const value = staffValue({
      founder: { nickname: "F", productivityBps: listed.founderProductivityBps },
      members: [],
      aiWorkers: listed.aiWorkers,
      aiWageCentsPerHour: listed.aiWageCentsPerHour,
      aiProductivityBps: 10_000,
      hours: listed.hours,
      paidHoursPerDay: 8,
    });
    expect(value.noRevenue).toBe(false);
    expect(value.rows.find((r) => r.kind === "founder")!.contributionCents).toBeGreaterThan(0);
    const strategy = RPC_SCHEMAS.set_company_strategy.parse(read("set_company_strategy.json"));
    expect(strategy.company?.price_level).toBe("premium");
    const payout = RPC_SCHEMAS.set_founder_payout.parse(read("set_founder_payout.json"));
    expect(payout.company?.founder_payout_bps).toBe(2500);
  });

  it("a started business move says when it is available again", () => {
    const moves = RPC_SCHEMAS.start_company_move.parse(
      JSON.parse(readFileSync(dir + "start_company_move_resting.json", "utf8")),
    );
    const started = moves.moves.find((m) => m.key === moves.running[0]!.key)!;
    expect(started.rest_minutes).toBeGreaterThan(started.minutes);
    expect(Date.parse(started.available_at!)).toBe(
      Date.parse(moves.running[0]!.started_at) + started.rest_minutes * 60_000,
    );
    for (const m of moves.moves) expect(m.rest_minutes).toBeGreaterThan(0);
  });

  it("orders report fill, fee and XP", () => {
    const market = RPC_SCHEMAS.place_order.parse(JSON.parse(readFileSync(dir + "place_order_market.json", "utf8")));
    expect(market.status).toBe("filled");
    expect(market.fee_cents).toBe(100);
    const limit = RPC_SCHEMAS.place_order.parse(JSON.parse(readFileSync(dir + "place_order_limit.json", "utf8")));
    expect(limit.status).toBe("open");
  });
});
