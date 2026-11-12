import { describe, expect, it } from "vitest";
import { shrinkLogo, staffFigure } from "./figures";

const logo = {
  palette: ["#ff0000", "#00ff00"],
  grid: Array.from({ length: 16 }, (_, y) => (y < 8 ? "0".repeat(8) + ".".repeat(8) : ".".repeat(8) + "1".repeat(8))),
};

describe("staff figures (ADR-078)", () => {
  it("shrinks the logo by majority per block", () => {
    expect(shrinkLogo(logo, 4)).toEqual(["00..", "00..", "..11", "..11"]);
  });

  it("puts the logo on the shirt and keeps 12 × 16", () => {
    const f = staffFigure("person", "Lea", "#123456", logo);
    expect(f.grid).toHaveLength(16);
    for (const row of f.grid) {
      expect(row).toHaveLength(12);
      for (const c of row) if (c !== ".") expect(Object.keys(f.palette)).toContain(c);
    }
    expect(f.grid[7]!.slice(4, 8)).toBe("00tt");
    expect(f.palette.t).toBe("#123456");
  });

  it("looks the same for the same name, robots have no hair", () => {
    expect(staffFigure("person", "Max", "#000000", null)).toEqual(staffFigure("person", "Max", "#000000", null));
    expect(staffFigure("robot", "x", "#000000", null).palette.h).toBeUndefined();
  });
});
