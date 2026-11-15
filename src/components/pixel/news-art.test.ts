import { describe, expect, it } from "vitest";
import {
  ANCHOR_MOODS,
  ANCHOR_SIZE,
  BACKDROP,
  DESK_HEIGHT,
  DESK_SIGN,
  DESK_SIGN_ROW,
  DESK_SIGN_SHORT,
  HANDS,
  INTRO_ART,
  MOOD_FX,
  NEWS_ICON_ART,
  NEWS_STUDIO_ART,
  SCENE_DESK_ROW,
  SCENE_HEIGHT,
  SCENE_MAX_WIDTH,
  SHOW_NAME,
  SHOW_TITLE,
  SNOW,
  anchorArt,
  cropArt,
  cropCenter,
  deskArt,
  outlineGrid,
  patchGrid,
  type AnchorArm,
  type AnchorMouth,
  type AnchorPose,
} from "./news-art";
import type { PixelArt } from "./pixel-icon";

/** Every character of the grid is transparent or a colour of the palette, and all rows are equally long. */
function expectValid(art: PixelArt, label: string): void {
  const width = art.grid[0]?.length ?? 0;
  expect(width, label).toBeGreaterThan(0);
  const colours = Object.keys(art.palette);
  for (const row of art.grid) {
    expect(row.length, `${label}: row "${row}"`).toBe(width);
    for (const char of row) if (char !== ".") expect(colours, `${label}: "${char}"`).toContain(char);
  }
}

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
      expect(Object.keys(art.palette).length).toBeLessThanOrEqual(20);
    });
  }

  it("registers a 16×16 icon per kind of story", () => {
    expect(Object.keys(NEWS_ICON_ART).sort()).toEqual(
      [
        "crypto",
        "gossip",
        "hype",
        "intro",
        "loser",
        "nft",
        "outro",
        "ramble",
        "scandal",
        "sector",
        "stock",
        "tasks",
        "winner",
        "world",
      ].map((kind) => `news/${kind}`),
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

  const moods = ANCHOR_MOODS.filter((mood) => mood !== "neutral");
  const mouths: AnchorMouth[] = ["closed", "half", "open"];

  it("knows eight moods, the newsreader's face first", () => {
    expect(ANCHOR_MOODS).toEqual(["neutral", "shocked", "crying", "laughing", "angry", "smug", "confused", "proud"]);
    expect(anchorArt({ mood: "neutral" })).toBe(anchorArt());
  });

  for (const mood of moods) {
    // 240 poses per mood: generous timeout, the full suite runs many files in parallel
    it(`${mood}: every frame is valid art of the anchor's size`, () => {
      const base = anchorArt();
      const arms: AnchorArm[] = ["down", "hanky", "twirl", "twirlUp", "waveLeft"];
      for (const mouth of mouths) {
        for (const frame of [0, 1] as const) {
          for (const react of [false, true]) {
            for (const eyes of ["open", "blink"] as const) {
              for (const arm of arms) {
                const pose: AnchorPose = { mood, mouth, frame, react, eyes, arm };
                const art = anchorArt(pose);
                const label = JSON.stringify(pose);
                expectValid(art, label);
                expect(art.grid, label).toHaveLength(ANCHOR_SIZE.height);
                expect(art.grid[0], label).toHaveLength(ANCHOR_SIZE.width);
                expect(art.palette).toBe(base.palette);
                expect(art.grid, label).not.toEqual(base.grid);
              }
            }
          }
        }
      }
    }, 30_000);

    it(`${mood}: has its own face and three different mouths to talk with`, () => {
      const closed = anchorArt({ mood });
      const half = anchorArt({ mood, mouth: "half" });
      const open = anchorArt({ mood, mouth: "open" });
      expect(half.grid).not.toEqual(closed.grid);
      expect(open.grid).not.toEqual(closed.grid);
      expect(open.grid).not.toEqual(half.grid);
      // Not just another mouth: the eyes and brows (rows 7 to 13) differ from the neutral face.
      expect(closed.grid.slice(7, 14)).not.toEqual(anchorArt().grid.slice(7, 14));
      // Every mood looks different from every other one.
      for (const other of moods) {
        if (other !== mood) expect(closed.grid, other).not.toEqual(anchorArt({ mood: other }).grid);
      }
      // The same pose is the same object, also when a frame cannot change the picture.
      expect(anchorArt({ mood, mouth: "open", frame: 0 })).toBe(anchorArt({ mood, mouth: "open", frame: 0 }));
    });
  }

  it("moods move what they should: tears run, the lip wobbles, the jaw drops, the face goes red", () => {
    expect(anchorArt({ mood: "crying", frame: 1 }).grid).not.toEqual(anchorArt({ mood: "crying", frame: 0 }).grid);
    expect(anchorArt({ mood: "crying", mouth: "open", frame: 1 }).grid.join("")).toContain("c");
    expect(anchorArt({ mood: "shocked", react: true }).grid).not.toEqual(anchorArt({ mood: "shocked" }).grid);
    // A mood without loop frames or a reaction pose does not make new pictures for them.
    expect(anchorArt({ mood: "laughing", frame: 1, react: true })).toBe(anchorArt({ mood: "laughing" }));
    const angry = anchorArt({ mood: "angry" }).grid;
    expect(angry.slice(6, 22).join("")).toContain("a");
    expect(angry.slice(6, 22).join("")).not.toContain("s");
    // Only the face is flushed: neck, collar and suit keep their colours.
    expect(angry.slice(22)).toEqual(anchorArt().grid.slice(22));
    // A tilted head: the hair is shifted, the chin is not.
    const confused = anchorArt({ mood: "confused" }).grid;
    expect(confused[0]).toBe(`..${anchorArt().grid[0]!.slice(0, -2)}`);
    expect(confused[21]).toBe(anchorArt().grid[21]);
    // Chest out: the shoulders are a row higher.
    expect(anchorArt({ mood: "proud" }).grid[22]).not.toBe(anchorArt().grid[22]);
  });

  it("the hands on the desk and the marks around his head are valid", () => {
    for (const [name, art] of Object.entries(HANDS)) {
      expectValid(art, name);
      expect(art.grid, name).toHaveLength(HANDS.rest.grid.length);
      expect(art.grid[0], name).toHaveLength(HANDS.rest.grid[0].length);
    }
    for (const [name, art] of Object.entries(MOOD_FX)) {
      expectValid(art, name);
      // They have to fit beside his head.
      expect(art.grid[0]!.length, name).toBeLessThanOrEqual(9);
      expect(art.grid.length, name).toBeLessThanOrEqual(12);
    }
    expect(MOOD_FX.sparkleSmall.grid).toHaveLength(MOOD_FX.sparkle.grid.length);
  });

  it("the art of the opener is valid and the title card fits a phone", () => {
    const pieces: Record<string, PixelArt> = {
      face0: INTRO_ART.face[0],
      face1: INTRO_ART.face[1],
      comb: INTRO_ART.comb,
      point: INTRO_ART.point,
      mug: INTRO_ART.mug,
      grip: INTRO_ART.grip,
      splash0: INTRO_ART.splash[0],
      splash1: INTRO_ART.splash[1],
      splash2: INTRO_ART.splash[2],
      banknote: INTRO_ART.banknote,
      cape0: INTRO_ART.cape[0],
      cape1: INTRO_ART.cape[1],
      ...SHOW_NAME,
    };
    for (const [name, art] of Object.entries(pieces)) expectValid(art, name);
    expect(INTRO_ART.face[0].grid).toHaveLength(INTRO_ART.face[1].grid.length);
    expect(INTRO_ART.face[0].grid).not.toEqual(INTRO_ART.face[1].grid);
    expect(INTRO_ART.cape[0].grid).not.toEqual(INTRO_ART.cape[1].grid);
    expect(INTRO_ART.cape[0].grid[0]).toHaveLength(INTRO_ART.cape[1].grid[0]!.length);
    // The narrowest picture is 72 art pixels wide.
    for (const art of Object.values(SHOW_NAME)) expect(art.grid[0]!.length).toBeLessThanOrEqual(72);
    expect(SHOW_NAME.first.grid[0]).toHaveLength(SHOW_NAME.last.grid[0]!.length);
    expect(SHOW_NAME.first.grid).toHaveLength(15);
    expect(SHOW_NAME.show.grid).toHaveLength(7);
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

  it("outlineGrid draws a border around a shape and cropArt cuts a rectangle", () => {
    expect(outlineGrid(["x"], "o")).toEqual(["ooo", "oxo", "ooo"]);
    expect(outlineGrid(["x.", ".."], "o")).toEqual(["ooo.", "oxo.", "ooo.", "...."]);
    const art = { palette: { a: "red" }, grid: ["a..", ".a.", "..a"] };
    expect(cropArt(art, 1, 1, 2, 2)).toEqual({ palette: art.palette, grid: ["a.", ".a"] });
  });

  it("patchGrid overlays patches, keeps pixels under a space and ignores what is outside", () => {
    expect(patchGrid(["....", "...."], [{ x: 1, y: 0, rows: ["ab", "c d"] }])).toEqual([".ab.", ".c.d"]);
    expect(patchGrid(["...."], [{ x: 3, y: 0, rows: ["xyz", "more"] }])).toEqual(["...x"]);
  });
});
