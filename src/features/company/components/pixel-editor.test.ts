import { describe, expect, it } from "vitest";
import { cellsBetween } from "./pixel-editor";

describe("pixel editor strokes (ADR-079)", () => {
  it("fills every cell between two pointer positions", () => {
    expect(cellsBetween({ x: 0, y: 0 }, { x: 4, y: 0 })).toHaveLength(5);
    expect(cellsBetween({ x: 0, y: 0 }, { x: 3, y: 3 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
    const steep = cellsBetween({ x: 2, y: 0 }, { x: 0, y: 7 });
    expect(steep).toHaveLength(8);
    expect(steep.at(-1)).toEqual({ x: 0, y: 7 });
  });
});
