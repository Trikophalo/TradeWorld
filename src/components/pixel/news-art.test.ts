import { describe, expect, it } from "vitest";
import {
  ANCHOR_SIZE,
  BACKDROP,
  DESK_HEIGHT,
  DESK_SIGN,
  DESK_SIGN_ROW,
  DESK_SIGN_SHORT,
  NEWS_ICON_ART,
  NEWS_STUDIO_ART,
  SCENE_DESK_ROW,
  SCENE_HEIGHT,
  SCENE_MAX_WIDTH,
  SHOW_TITLE,
  SNOW,
  anchorArt,
  cropCenter,
  deskArt,
  patchGrid,
  type AnchorPose,
} from "./news-art";

describe("news studio art", () => {
  for (const [name, art] of Object.entries(NEWS_STUDIO_ART)) {
    it(`${name} is a rectangle that only uses palette colours`, () => {
      const width = art.grid[0]?.length ?? 0;
      expect(width).toBeGreaterThan(0);
      for (const row of art.grid) {
        expect(row.length, `row "${row}"`).toBe(width);
        for (const char of row) {
          if (char !== ".") expect(Object.keys(art.palette)).toContain(char);
        }
      }
      // Big sprites may use more colours than icons, but still a small, deliberate set.
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(18);
    });
  }

  it("registers a 16×16 icon per kind of story", () => {
    expect(Object.keys(NEWS_ICON_ART).sort()).toEqual(
      ["crypto", "hype", "intro", "loser", "outro", "scandal", "sector", "stock", "tasks", "winner", "world"].map(
        (kind) => `news/${kind}`,
      ),
    );
    for (const art of Object.values(NEWS_ICON_ART)) expect(art.grid).toHaveLength(16);
  });

  it("every pose of the anchor has the same size and only differs where it should", () => {
    const base = anchorArt();
    const poses: AnchorPose[] = [
      { mouth: "half" },
      { mouth: "open" },
      { eyes: "blink" },
      { eyes: "happy" },
      { brows: "raised" },
      { brows: "cocked" },
      { arm: "waveLeft" },
      { arm: "waveRight" },
      { mouth: "open", eyes: "blink", brows: "raised", arm: "waveLeft" },
    ];
    expect(base.grid).toHaveLength(ANCHOR_SIZE.height);
    for (const pose of poses) {
      const art = anchorArt(pose);
      expect(art.grid).toHaveLength(ANCHOR_SIZE.height);
      for (const row of art.grid) expect(row).toHaveLength(ANCHOR_SIZE.width);
      expect(art.grid, JSON.stringify(pose)).not.toEqual(base.grid);
      // The hair, the tie and the lower body never move.
      expect(art.grid[1]!.slice(0, 28)).toBe(base.grid[1]!.slice(0, 28));
      expect(art.grid.slice(26).map((row) => row.slice(0, 30))).toEqual(
        base.grid.slice(26).map((row) => row.slice(0, 30)),
      );
    }
    // Face patches stay inside the face: the mouth only touches rows 18 and 19.
    const open = anchorArt({ mouth: "open" });
    open.grid.forEach((row, y) => {
      if (y !== 18 && y !== 19) expect(row).toBe(base.grid[y]);
    });
  });

  it("returns the same object for the same pose, so memoised sprites do not redraw", () => {
    expect(anchorArt({ mouth: "open" })).toBe(anchorArt({ mouth: "open", eyes: "open" }));
    expect(anchorArt({ mouth: "open" })).not.toBe(anchorArt({ mouth: "half" }));
  });

  it("the backdrop fills the widest picture and both frames have the same city", () => {
    for (const frame of BACKDROP) {
      expect(frame.grid).toHaveLength(SCENE_HEIGHT);
      expect(frame.grid[0]).toHaveLength(SCENE_MAX_WIDTH);
    }
    const changed = BACKDROP[0].grid.join("").length;
    let different = 0;
    BACKDROP[0].grid.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] !== BACKDROP[1].grid[y]![x]) different++;
    });
    // Only a few windows and the beacons switch.
    expect(different).toBeGreaterThan(0);
    expect(different / changed).toBeLessThan(0.02);
  });

  it("is deterministic: the same snow on every load", () => {
    expect(SNOW[0].grid).not.toEqual(SNOW[1].grid);
    expect(SNOW[0].grid[0]).toHaveLength(80);
  });

  it("the desk fits the scene and both signs fit the desk front", () => {
    expect(SCENE_DESK_ROW + DESK_HEIGHT).toBe(SCENE_HEIGHT);
    expect(deskArt(100).grid).toHaveLength(DESK_HEIGHT);
    expect(deskArt(100).grid[0]).toHaveLength(100);
    for (const sign of [DESK_SIGN, DESK_SIGN_SHORT]) {
      expect(DESK_SIGN_ROW + sign.grid.length).toBeLessThan(DESK_HEIGHT - 2);
    }
    expect(DESK_SIGN_SHORT.grid[0]!.length).toBeLessThan(DESK_SIGN.grid[0]!.length);
    expect(SHOW_TITLE.name.grid[0]).toHaveLength(SHOW_TITLE.word.grid[0]!.length);
  });

  it("cropCenter cuts the middle and repeats a narrow grid", () => {
    expect(cropCenter(["abcdef"], 2)).toEqual(["cd"]);
    expect(cropCenter(["abcdef"], 6)).toEqual(["abcdef"]);
    expect(cropCenter(["abc"], 7)).toEqual(["bcabcab"]);
  });

  it("patchGrid overlays patches, keeps pixels under a space and ignores what is outside", () => {
    expect(patchGrid(["....", "...."], [{ x: 1, y: 0, rows: ["ab", "c d"] }])).toEqual([".ab.", ".c.d"]);
    expect(patchGrid(["...."], [{ x: 3, y: 0, rows: ["xyz", "more"] }])).toEqual(["...x"]);
  });
});
