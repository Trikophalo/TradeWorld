import { describe, expect, it } from "vitest";
import { INTRO_BEATS, INTRO_SHOTS, introShot } from "./intro";

describe("the opening montage", () => {
  it("is seven bars long: five shots of one bar and the title card over two", () => {
    expect(INTRO_SHOTS.map((shot) => shot.id)).toEqual(["comb", "point", "mug", "money", "hero", "title"]);
    expect(INTRO_BEATS).toBe(28);
    expect(INTRO_SHOTS.at(-1)).toEqual({ id: "title", beats: 8 });
  });

  it("starts on the first shot and cuts on the beat, whatever the length of the intro", () => {
    for (const introMs of [8000, 12_000, 5000, 20_000]) {
      const beatMs = introMs / INTRO_BEATS;
      expect(introShot(0, introMs)).toMatchObject({ id: "comb", index: 0, beat: 0, sinceMs: 0 });
      let start = 0;
      INTRO_SHOTS.forEach((shot, index) => {
        const first = introShot(start * beatMs + 1, introMs);
        const last = introShot((start + shot.beats) * beatMs - 1, introMs);
        expect(first.id, `${introMs} ms, start of ${shot.id}`).toBe(shot.id);
        expect(last.id, `${introMs} ms, end of ${shot.id}`).toBe(shot.id);
        expect(first.index).toBe(index);
        expect(first.beats).toBe(shot.beats);
        expect(first.beat).toBeCloseTo(1 / beatMs, 5);
        expect(last.beat).toBeCloseTo(shot.beats - 1 / beatMs, 5);
        expect(first.beatMs).toBeCloseTo(beatMs, 5);
        start += shot.beats;
      });
    }
  });

  it("gives every viewer the same frame for the same moment", () => {
    // 12 s: a beat is 12000 / 28 ms, the mug shot runs from beat 8 to beat 12.
    const frame = introShot(4000, 12_000);
    expect(frame.id).toBe("mug");
    expect(frame.beat).toBeCloseTo(4000 / (12_000 / 28) - 8, 5);
    expect(frame.sinceMs).toBeCloseTo(4000 - 8 * (12_000 / 28), 5);
    // The same share of a shorter intro is the same frame.
    expect(introShot((4000 * 8) / 12, 8000).beat).toBeCloseTo(frame.beat, 5);
    expect(introShot(4000, 12_000)).toEqual(frame);
  });

  it("only moves forward", () => {
    let index = 0;
    for (let ms = 0; ms <= 12_000; ms += 50) {
      const frame = introShot(ms, 12_000);
      expect(frame.index).toBeGreaterThanOrEqual(index);
      expect(frame.beat).toBeGreaterThanOrEqual(0);
      expect(frame.beat).toBeLessThanOrEqual(frame.beats);
      index = frame.index;
    }
    expect(index).toBe(INTRO_SHOTS.length - 1);
  });

  it("ends on the finished title card", () => {
    for (const elapsed of [8000, 9000, Number.POSITIVE_INFINITY]) {
      expect(introShot(elapsed, 8000)).toMatchObject({ id: "title", index: 5, beat: 8, beats: 8 });
    }
    expect(introShot(Number.POSITIVE_INFINITY, 8000).sinceMs).toBe(Number.POSITIVE_INFINITY);
    // Nonsense in, the first frame out.
    expect(introShot(-500, 8000)).toMatchObject({ id: "comb", beat: 0 });
    expect(introShot(0, 0).id).toBe("comb");
  });
});
