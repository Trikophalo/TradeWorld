import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RPC_SCHEMAS } from "./api";

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
    // M4d (ADR-085) is written in parallel with the database (TODO: remove once search_players.json exists).
    const pending = [
      ...(fixtures.some((file) => file.startsWith("search_players")) ? [] : ["search_players"]),
      ...(fixtures.some((file) => file.startsWith("get_offers")) ? [] : m3f),
    ];
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

  it("the snapshot contains the 15 stocks, 4 bonds and the index", () => {
    const snapshot = RPC_SCHEMAS.get_market_snapshot.parse(
      JSON.parse(readFileSync(dir + "get_market_snapshot.json", "utf8")),
    );
    expect(snapshot.securities.filter((s) => s.kind === "stock")).toHaveLength(15);
    expect(snapshot.securities.filter((s) => s.kind === "bond")).toHaveLength(4);
    expect(snapshot.index.ticker).toBe("NEXA30");
    for (const s of snapshot.securities) expect(s.bid_e4).toBeLessThan(s.ask_e4);
  });

  it("orders report fill, fee and XP", () => {
    const market = RPC_SCHEMAS.place_order.parse(JSON.parse(readFileSync(dir + "place_order_market.json", "utf8")));
    expect(market.status).toBe("filled");
    expect(market.fee_cents).toBe(100);
    const limit = RPC_SCHEMAS.place_order.parse(JSON.parse(readFileSync(dir + "place_order_limit.json", "utf8")));
    expect(limit.status).toBe("open");
  });
});
