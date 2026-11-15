import { describe, expect, it } from "vitest";
import { battleParamsFor } from "@/features/game/demo/battles";
import { simulateBattle } from "@/lib/sim/battle";
import { Lockstep } from "./lockstep";

const params = battleParamsFor("floor");
const make = (mySlot: number | null = 0) =>
  new Lockstep({ kind: "floor", seed: 7, n: 2, mySlot, params, startedAtMs: 10_000 });

describe("Lockstep (client of ADR-160)", () => {
  it("records what is held for every tick up to now", () => {
    const ls = make();
    ls.setHeld(2, false);
    ls.record(10_000 + 120);
    ls.setHeld(3, true);
    ls.record(10_000 + 260);
    expect(ls.chunk()).toEqual({ from: 0, data: "222888" });
  });

  it("a tap shorter than a tick still jumps in Laserschranke", () => {
    const ls = new Lockstep({
      kind: "laser",
      seed: 7,
      n: 2,
      mySlot: 0,
      params: battleParamsFor("laser"),
      startedAtMs: 10_000,
    });
    ls.setHeld(2, false);
    ls.record(10_000 + 60);
    // pressed and released between two frames
    ls.tap();
    ls.record(10_000 + 160);
    expect(ls.chunk()).toEqual({ from: 0, data: "2272" });
  });

  it("confirms only the server's final ticks and fills what is missing there with x", () => {
    const ls = make();
    ls.applySync(
      {
        now: "1970-01-01T00:00:12.000Z",
        status: "running",
        finalTick: 20,
        streams: [
          { slot: 0, data: "2".repeat(25) },
          { slot: 1, data: "3".repeat(5) },
        ],
      },
      0,
      12_000,
      12_000,
    );
    const expected = simulateBattle("floor", 7, ["2".repeat(20), "33333" + "x".repeat(15)], 20, params as never);
    expect(ls.confirmedState.tick).toBe(20);
    expect(ls.confirmedState.p.x).toEqual(expected.p.x);
    expect(ls.chunk().from).toBe(25);
  });

  it("predicts the others from their broadcast inputs, else repeats their last one", () => {
    const ls = make();
    ls.applyPeer(1, 0, "4444");
    const view = ls.view(10_000 + 10 * 50);
    const reference = simulateBattle("floor", 7, ["0".repeat(11), "4".repeat(11)], 11, params as never);
    expect(view.state.p.x).toEqual(reference.p.x);
    expect(view.alpha).toBeGreaterThanOrEqual(0);
  });

  it("claims the end only once the confirmed state is over", () => {
    const ls = make(null);
    expect(ls.endClaim()).toBeNull();
    ls.applySync(
      { now: "1970-01-01T00:01:20.000Z", status: "running", finalTick: 1400, streams: [] },
      0,
      80_000,
      80_000,
    );
    expect(ls.endClaim()).not.toBeNull();
  });
});
