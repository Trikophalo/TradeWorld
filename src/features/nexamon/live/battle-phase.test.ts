import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { multiRevealAt, multiTwistAt } from "@/lib/sim/nexamon-battle";
import { battlePhase } from "./battle-phase";

const cfg = BALANCE.nexamon;
const START = Date.parse("2026-11-21T12:00:00Z");

function battle(packs: number, twist = false) {
  const cards = Array.from({ length: packs * cfg.packSize }, (_, i) => ({ pack: Math.floor(i / cfg.packSize) + 1 }));
  const twistMs = twist ? cfg.packBattle.twistMs : 0;
  return {
    packs: Array.from({ length: packs }, () => ({ set: "mystic_energy", priceCents: 0 })),
    seats: [{ cards }, { cards }],
    startsAt: new Date(START).toISOString(),
    decideAt: new Date(
      START + packs * (cfg.battles.tearMs + cfg.packSize * cfg.battles.slotMs + twistMs),
    ).toISOString(),
    winnerSeat: 0,
    twist,
    twists: twist ? Array.from({ length: packs }, () => [0, 1]) : [],
    twistMs,
  } as unknown as Parameters<typeof battlePhase>[0];
}

describe("battlePhase", () => {
  it("keeps the last card of every pack on screen for its whole slot (owner bug: the 5th card was never seen)", () => {
    for (const twist of [false, true]) {
      const b = battle(3, twist);
      const twistMs = twist ? cfg.packBattle.twistMs : 0;
      for (let pack = 1; pack <= 3; pack++) {
        const fifth = multiRevealAt(START, pack * cfg.packSize - 1, cfg, twistMs);
        for (const t of [fifth, fifth + cfg.battles.slotMs / 2, fifth + cfg.battles.slotMs - 1]) {
          const s = battlePhase(b, t);
          expect(s.phase).toBe("revealing");
          expect(s.shown).toBe(pack * cfg.packSize);
          expect(s.pack).toBe(pack);
        }
        // the slot is over: the twist (Twist), the next pack, or (last pack) the decision
        const after = battlePhase(b, multiTwistAt(START, pack, cfg, twistMs));
        expect(after.phase).toBe(twist ? "twisting" : pack === 3 ? "decided" : "tearing");
        if (!twist && pack < 3) expect(after.pack).toBe(pack + 1);
      }
    }
  });

  it("shows every card of the lineup one after another", () => {
    const b = battle(2);
    for (let i = 0; i < 2 * cfg.packSize; i++) {
      const s = battlePhase(b, multiRevealAt(START, i, cfg));
      expect(s.phase).toBe("revealing");
      expect(s.shown).toBe(i + 1);
    }
  });

  it("tears the first pack before its first card and counts down before the start", () => {
    const b = battle(1);
    expect(battlePhase(b, START - 1500).phase).toBe("countdown");
    expect(battlePhase(b, START + 10).phase).toBe("tearing");
    expect(battlePhase(b, START + 10).pack).toBe(1);
  });
});
