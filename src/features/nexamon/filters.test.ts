import { describe, expect, it } from "vitest";
import { restoreFilters } from "./hooks";

const defaults = { set: "all", sort: "number" };
const allowed = { set: ["all", "mystic_energy"], sort: ["number", "value"] } as const;

describe("restoreFilters", () => {
  it("takes the remembered values that are still allowed", () => {
    expect(restoreFilters({ set: "mystic_energy", sort: "value" }, defaults, allowed)).toEqual({
      set: "mystic_energy",
      sort: "value",
    });
  });

  it("falls back field by field for unknown, wrong or missing values", () => {
    expect(restoreFilters({ set: "nope", sort: "value", extra: "x" }, defaults, allowed)).toEqual({
      set: "all",
      sort: "value",
    });
    expect(restoreFilters({ set: 3 }, defaults, allowed)).toEqual(defaults);
    expect(restoreFilters(null, defaults, allowed)).toEqual(defaults);
    expect(restoreFilters("text", defaults, allowed)).toEqual(defaults);
  });
});
