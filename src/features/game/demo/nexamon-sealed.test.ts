import { describe, expect, it } from "vitest";
import { NEXAMON_RULES } from "@/config/nexamon-rules";
import { createSealedEngine, type DemoSealedPack } from "./nexamon-sealed";

/** A demo host: cash, the sealed list and a stand-in for the pull of a bought pack. */
function host(level = 12, cash = 1_000_000) {
  const state = { cash, list: [] as DemoSealedPack[], opened: 0 };
  const requests = new Map<string, unknown>();
  const engine = createSealedEngine({
    list: () => state.list,
    setList: (packs) => {
      state.list = packs;
    },
    level: () => level,
    cashCents: () => state.cash,
    pay: (cents) => {
      state.cash -= cents;
    },
    open: async (requestId, set, priceCents) => {
      state.opened++;
      return { packId: `pack-${requestId}`, set, priceCents, cards: [], packsOpened: state.opened };
    },
    idempotent: (id, run) => {
      if (!requests.has(id)) requests.set(id, run());
      return requests.get(id) as never;
    },
    now: () => 1_000,
  });
  return { engine, state };
}

describe("demo sealed booster packs (ADR-177)", () => {
  it("buys packs at the pack price and keeps them sealed; a replay pays nothing", async () => {
    const { engine, state } = host();
    const price = NEXAMON_RULES.sets.mystic_energy.packPriceCents;
    const r = await engine.buyNexamonSealedPack("b1", "mystic_energy", 3);
    expect(await engine.buyNexamonSealedPack("b1", "mystic_energy", 3)).toBe(r);
    expect(r.priceCents).toBe(3 * price);
    expect(state.cash).toBe(1_000_000 - 3 * price);
    expect((await engine.nexamonSealedPacks()).packs).toHaveLength(3);
    await expect(engine.buyNexamonSealedPack("b2", "prismatic_peak", 5)).rejects.toMatchObject({
      key: "insufficient_funds",
    });
    await expect(engine.buyNexamonSealedPack("b3", "mystic_energy", 0)).rejects.toMatchObject({
      key: "invalid_argument",
    });
  });

  it("a won pack opens exactly once, without paying", async () => {
    const { engine, state } = host();
    engine.grantSealed("super_apex", 2, "battle");
    const [first] = (await engine.nexamonSealedPacks()).packs;
    expect(first?.source).toBe("battle");
    const a = await engine.openNexamonSealedPack("o1", first!.id);
    expect(await engine.openNexamonSealedPack("o1", first!.id)).toBe(a);
    expect(a.sealedLeft).toBe(1);
    expect(a.priceCents).toBe(0);
    expect(state.opened).toBe(1);
    expect(state.cash).toBe(1_000_000);
    await expect(engine.openNexamonSealedPack("o2", first!.id)).rejects.toMatchObject({ key: "sealed_pack_unknown" });
  });

  it("is listed while Nexamon is locked, but opens only after the unlock", async () => {
    const { engine } = host(3);
    engine.grantSealed("mystic_energy", 1, "battle");
    const list = await engine.nexamonSealedPacks();
    expect(list.unlocked).toBe(false);
    await expect(engine.openNexamonSealedPack("o1", list.packs[0]!.id)).rejects.toMatchObject({
      key: "nexamon_locked",
    });
  });
});
