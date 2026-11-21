import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { lineupCount, lineupGroups, moveLineupGroup, removeLineupGroup, setLineupCount } from "./battle-lineup";

const pb = BALANCE.nexamon.packBattle;

describe("battle lineup (create sheet)", () => {
  it("groups consecutive packs of a set", () => {
    expect(lineupGroups(["a", "a", "b", "a"])).toEqual([
      { set: "a", count: 2 },
      { set: "b", count: 1 },
      { set: "a", count: 1 },
    ]);
    expect(lineupGroups([])).toEqual([]);
  });

  it("sets a count per set: in place, new sets at the end, 0 removes, merged into one group", () => {
    expect(setLineupCount(["a"], "a", 4, 10, 30)).toEqual(["a", "a", "a", "a"]);
    expect(setLineupCount(["a", "b"], "c", 2, 10, 30)).toEqual(["a", "b", "c", "c"]);
    expect(setLineupCount(["a", "b", "b"], "a", 3, 10, 30)).toEqual(["a", "a", "a", "b", "b"]);
    expect(setLineupCount(["a", "b", "a"], "a", 2, 10, 30)).toEqual(["a", "a", "b"]);
    expect(setLineupCount(["a", "b"], "a", 0, 10, 30)).toEqual(["b"]);
  });

  it("clamps to the per-set and the total maximum", () => {
    expect(lineupCount(setLineupCount([], "a", 99, 10, 30), "a")).toBe(10);
    expect(setLineupCount([], "a", -3, 10, 30)).toEqual([]);
    const full = setLineupCount(setLineupCount([], "a", 10, 10, 15), "b", 10, 10, 15);
    expect(full.length).toBe(15);
    expect(lineupCount(full, "b")).toBe(5);
  });

  it("the config fits ten packs of three sets", () => {
    expect(pb.maxPerSet).toBe(10);
    expect(pb.maxPacks).toBeGreaterThanOrEqual(3 * pb.maxPerSet);
  });

  it("moves and removes whole groups", () => {
    const l = ["a", "a", "b", "c", "c", "c"];
    expect(moveLineupGroup(l, 2, 0)).toEqual(["c", "c", "c", "a", "a", "b"]);
    expect(moveLineupGroup(l, 0, 1)).toEqual(["b", "a", "a", "c", "c", "c"]);
    expect(moveLineupGroup(l, 0, 5)).toEqual(l);
    expect(removeLineupGroup(l, 1)).toEqual(["a", "a", "c", "c", "c"]);
  });
});
