import { beforeEach, describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { demoEngine, resetDemoPlayer } from "../demo-engine";
import { GameError, type MissionsState } from "../types";
import {
  MISSION_TEMPLATES,
  affordableFor,
  resetAvailableOn,
  resetStateOn,
  splitForReset,
  type MissionTemplate,
} from "./missions";

const template = (key: string): MissionTemplate => MISSION_TEMPLATES.find((t) => t.key === key)!;
const rich = { cashCents: 1_000_000, tradableCents: 1_000_000 };

describe("affordable missions in the demo (ADR-166)", () => {
  it("offers everything of the start catalogue that fits the starting capital", () => {
    expect(affordableFor(template("d_buy_500"), rich)).toBe(true);
    expect(affordableFor(template("d_buy_2000"), rich)).toBe(true);
    expect(affordableFor(template("w_buy_5000"), rich)).toBe(true);
    expect(affordableFor(template("d_profit_50"), rich)).toBe(true);
    expect(affordableFor(template("w_profit_500"), rich)).toBe(true);
    // 2.000 € profit in a week is more than a tenth of 10.000 €
    expect(affordableFor(template("w_profit_2000"), rich)).toBe(false);
  });

  it("drops money missions the player cannot pay for", () => {
    const poor = { cashCents: 30_000, tradableCents: 30_000 };
    expect(affordableFor(template("q_buy_250"), poor)).toBe(false); // half of 300 € is 150 €
    expect(affordableFor(template("d_buy_500"), poor)).toBe(false);
    expect(affordableFor(template("d_profit_50"), poor)).toBe(false);
    expect(affordableFor(template("q_buy_2"), poor)).toBe(true);
    // all the money is in shares: volume still works by selling and buying again, single buys need cash
    const invested = { cashCents: 500, tradableCents: 1_000_000 };
    expect(affordableFor(template("d_profit_50"), invested)).toBe(true);
    expect(affordableFor(template("d_buy_500"), invested)).toBe(false);
    expect(affordableFor(template("q_buy_2"), invested)).toBe(false);
    expect(affordableFor(template("q_bid"), invested)).toBe(false);
    expect(affordableFor(template("q_sell"), invested)).toBe(true);
    expect(affordableFor(template("q_vault"), invested)).toBe(true);
  });

  it("keeps milestones as saving goals", () => {
    const broke = { cashCents: 0, tradableCents: 0 };
    for (const t of MISSION_TEMPLATES.filter((x) => x.kind === "milestone")) {
      expect(affordableFor(t, broke), t.key).toBe(true);
    }
  });
});

describe("mission reset rules (ADR-166)", () => {
  it("allows the configured number of resets per day and forgets yesterday", () => {
    const limit = BALANCE.progression.missionResetsPerDay;
    expect(limit).toBe(1);
    expect(resetAvailableOn(undefined, "2026-11-16")).toBe(true);
    expect(resetAvailableOn({ day: "2026-11-16", used: limit, keys: ["q_vault"] }, "2026-11-16")).toBe(false);
    expect(resetAvailableOn({ day: "2026-11-15", used: limit, keys: ["q_vault"] }, "2026-11-16")).toBe(true);
    expect(resetStateOn({ day: "2026-11-15", used: 1, keys: ["q_vault"] }, "2026-11-16")).toEqual({
      day: "2026-11-16",
      used: 0,
      keys: [],
    });
  });

  it("swaps open quick, daily and weekly missions; finished ones and milestones stay", () => {
    const missions = [
      { key: "q1", kind: "quick", status: "active" },
      { key: "q2", kind: "quick", status: "completed" },
      { key: "d1", kind: "daily", status: "active" },
      { key: "d2", kind: "daily", status: "claimed" },
      { key: "w1", kind: "weekly", status: "active" },
      { key: "m1", kind: "milestone", status: "active" },
    ] as const;
    const { kept, removed } = splitForReset(missions);
    expect(removed.map((x) => x.key)).toEqual(["q1", "d1", "w1"]);
    expect(kept.map((x) => x.key)).toEqual(["q2", "d2", "m1"]);
  });
});

describe("demoEngine.resetMissions (ADR-166)", () => {
  const keys = (state: MissionsState, kinds: readonly string[]) =>
    state.groups.filter((g) => kinds.includes(g.kind)).flatMap((g) => g.missions.map((m) => m.key));

  beforeEach(() => resetDemoPlayer());

  it("replaces the open missions once per day, with other templates, and is idempotent", async () => {
    const before = await demoEngine.missions();
    expect(before.reset).toEqual({ available: true, nextAt: null });
    const open = keys(before, ["quick", "daily", "weekly"]);
    expect(open).toHaveLength(9);

    const after = await demoEngine.resetMissions("reset-1");
    expect(after.reset.available).toBe(false);
    expect(Date.parse(after.reset.nextAt!)).toBeGreaterThan(Date.now());
    const fresh = keys(after, ["quick", "daily", "weekly"]);
    expect(fresh).toHaveLength(9);
    expect(fresh.filter((key) => open.includes(key))).toEqual([]);
    expect(keys(after, ["milestone"])).toEqual(keys(before, ["milestone"]));

    // the same request returns the stored answer; a new one is refused until tomorrow
    expect(await demoEngine.resetMissions("reset-1")).toEqual(after);
    await expect(demoEngine.resetMissions("reset-2")).rejects.toEqual(new GameError("mission_reset_used"));
    expect((await demoEngine.missions()).reset.available).toBe(false);
    // what was swapped away does not come back today
    expect(keys(await demoEngine.missions(), ["quick", "daily", "weekly"])).toEqual(fresh);
  });
});

describe("demoEngine.skipMission (ADR-202)", () => {
  beforeEach(() => resetDemoPlayer());

  it("swaps one open mission once per day, free, never a milestone", async () => {
    const before = await demoEngine.missions();
    expect(before.skip).toEqual({ available: true, nextAt: null });
    const quick = before.groups.find((g) => g.kind === "quick")!.missions[0]!;
    const milestone = before.groups.find((g) => g.kind === "milestone")!.missions[0]!;
    await expect(demoEngine.skipMission("skip-0", milestone.id)).rejects.toEqual(new GameError("mission_skip_invalid"));

    const after = await demoEngine.skipMission("skip-1", quick.id);
    const quickAfter = after.groups.find((g) => g.kind === "quick")!.missions;
    expect(quickAfter).toHaveLength(3);
    expect(quickAfter.map((m) => m.key)).not.toContain(quick.key);
    expect(after.skip.available).toBe(false);
    expect(after.reset.available).toBe(true);
    expect(await demoEngine.skipMission("skip-1", quick.id)).toEqual(after);
    await expect(demoEngine.skipMission("skip-2", quickAfter[0]!.id)).rejects.toEqual(
      new GameError("mission_skip_used"),
    );
  });
});
