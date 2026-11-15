import { describe, expect, it } from "vitest";
import { accessoryByKey } from "@/config/accessories";
import { GameError } from "../types";
import { createAccessoryEngine, sortWorn, type DemoWardrobe } from "./accessories";

function setup(level = 5, cash = 1_000_000) {
  const state = { cash, level, wardrobe: undefined as DemoWardrobe | undefined, feed: [] as string[] };
  const requests = new Map<string, unknown>();
  const engine = createAccessoryEngine({
    state: () => state.wardrobe,
    setState: (value) => {
      state.wardrobe = value;
    },
    level: () => state.level,
    avatarKey: () => "rookie",
    cashCents: () => state.cash,
    pay: (cents) => {
      state.cash -= cents;
    },
    feed: (kind, payload) => state.feed.push(`${kind}:${String(payload.key)}`),
    idempotent: <T>(id: string, run: () => T): T => {
      if (requests.has(id)) return requests.get(id) as T;
      const result = run();
      requests.set(id, result);
      return result;
    },
  });
  return { state, engine };
}

const key = (run: Promise<unknown>) =>
  run.then(
    () => "ok",
    (error: unknown) => (error instanceof GameError ? error.key : "other"),
  );

describe("accessories in the demo (ADR-154)", () => {
  it("buys once, pays the price, wears it at once; the same request replays", async () => {
    const { engine, state } = setup();
    const price = accessoryByKey("cowboy_hat")!.priceCents;
    const bought = await engine.buyAccessory("r1", "cowboy_hat");
    expect(bought).toEqual({ owned: ["cowboy_hat"], worn: ["cowboy_hat"], avatarKey: "rookie", paidCents: price });
    expect(await engine.buyAccessory("r1", "cowboy_hat")).toEqual(bought);
    expect(state.cash).toBe(1_000_000 - price);
    expect(await key(engine.buyAccessory("r2", "cowboy_hat"))).toBe("accessory_owned");
    expect(await key(engine.buyAccessory("r3", "flux"))).toBe("accessory_unknown");
    expect(await key(engine.buyAccessory("r4", "crown"))).toBe("accessory_locked");
    expect(state.feed).toEqual([]);
  });

  it("refuses what the player cannot pay", async () => {
    const { engine, state } = setup(5, 100);
    expect(await key(engine.buyAccessory("r1", "party_hat"))).toBe("insufficient_funds");
    expect(state.cash).toBe(100);
    expect(state.wardrobe).toBeUndefined();
  });

  it("wears one per slot, only owned ones; taking off keeps it", async () => {
    const { engine } = setup();
    expect(await key(engine.wearAccessory("w0", "party_hat", true))).toBe("accessory_not_owned");
    await engine.buyAccessory("b1", "party_hat");
    await engine.buyAccessory("b2", "sunglasses");
    await engine.buyAccessory("b3", "superhero_cape");
    expect((await engine.accessories()).worn).toEqual(["superhero_cape", "sunglasses", "party_hat"]);
    await engine.buyAccessory("b4", "beanie");
    expect((await engine.accessories()).worn).toEqual(["superhero_cape", "sunglasses", "beanie"]);
    const off = await engine.wearAccessory("w1", "sunglasses", false);
    expect(off.worn).toEqual(["superhero_cape", "beanie"]);
    expect(off.owned).toContain("sunglasses");
    expect((await engine.wearAccessory("w2", "party_hat", true)).worn).toEqual(["superhero_cape", "party_hat"]);
  });

  it("a legendary purchase is news for the friends", async () => {
    const { engine, state } = setup(30, 1_000_000_000);
    await engine.buyAccessory("l1", "crown");
    expect(state.feed).toEqual(["accessory_bought:crown"]);
  });

  it("sorts worn keys back to front and drops unknown ones", () => {
    expect(sortWorn(["parrot", "nope", "top_hat", "jetpack", "top_hat"])).toEqual(["jetpack", "top_hat", "parrot"]);
  });
});
