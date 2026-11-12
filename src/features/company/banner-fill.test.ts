import { describe, expect, it } from "vitest";
import { edgeColors, edgeStripes } from "./banner-fill";

const banner = { palette: ["#111111", "#9b7bff", "#22aa55"], grid: ["0112", "1112", "2221"] };

describe("banner edges fill the strip (ADR-078)", () => {
  it("takes the colour of the outermost cell of every row", () => {
    expect(edgeColors(banner, "left")).toEqual(["#111111", "#9b7bff", "#22aa55"]);
    expect(edgeColors(banner, "right")).toEqual(["#22aa55", "#22aa55", "#9b7bff"]);
  });

  it("an all-purple banner gives an all-purple strip", () => {
    const purple = { palette: ["#22aa55", "#9b7bff"], grid: ["1111", "1111"] };
    expect(new Set([...edgeColors(purple, "left"), ...edgeColors(purple, "right")])).toEqual(new Set(["#9b7bff"]));
  });

  it("builds hard stripes, one per row, scale pixels high", () => {
    expect(edgeStripes(banner, "left", 8)).toBe(
      "linear-gradient(to bottom, #111111 0px 8px, #9b7bff 8px 16px, #22aa55 16px 24px)",
    );
  });
});
