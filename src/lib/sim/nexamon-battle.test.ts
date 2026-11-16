import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  battleKnownSlots,
  battleShownSlots,
  battleTimeline,
  decideBattle,
  liveVisibleCards,
  type BattlePull,
} from "./nexamon-battle.ts";

const pull = (rarity: BattlePull["rarity"], valueCents: number): BattlePull => ({ rarity, valueCents });
const b = BALANCE.nexamon.battles;

describe("decideBattle", () => {
  it("the higher total wins", () => {
    const d = decideBattle([pull("common", 100), pull("rare", 900)], [pull("ultra", 950)], 0);
    expect(d).toEqual({ winner: "challenger", tieBreak: "value", challengerCents: 1000, opponentCents: 950 });
    expect(decideBattle([pull("common", 1)], [pull("common", 2)], 0).winner).toBe("opponent");
  });

  it("a tie goes to the rarest single card", () => {
    const d = decideBattle([pull("common", 500), pull("common", 500)], [pull("rare", 1000)], 0);
    expect(d.winner).toBe("opponent");
    expect(d.tieBreak).toBe("rarest");
  });

  it("then the coin: an even seed is the challenger's", () => {
    const a = [pull("rare", 700)];
    expect(decideBattle(a, a, 42)).toMatchObject({ winner: "challenger", tieBreak: "coin" });
    expect(decideBattle(a, a, 7)).toMatchObject({ winner: "opponent", tieBreak: "coin" });
  });
});

describe("battle lockstep", () => {
  const accepted = 1_000_000;
  const t = battleTimeline(accepted);

  it("starts after the delay, one slot per step, the winner one slot after the last card", () => {
    expect(t.startsAt).toBe(accepted + b.startDelayMs);
    expect(t.revealAt).toHaveLength(BALANCE.nexamon.packSize);
    expect(t.revealAt[0]).toBe(t.startsAt + b.tearMs);
    expect(t.revealAt[1]! - t.revealAt[0]!).toBe(b.slotMs);
    expect(t.decideAt).toBe(t.revealAt[4]! + b.slotMs);
    expect(t.endsAt).toBe(t.decideAt + b.outroMs);
  });

  it("nothing is known before the start, a card arrives leadMs before it shows", () => {
    expect(battleKnownSlots(t.startsAt, t.startsAt - 1)).toBe(0);
    expect(battleKnownSlots(t.startsAt, t.revealAt[0]! - b.leadMs - 1)).toBe(0);
    expect(battleKnownSlots(t.startsAt, t.revealAt[0]! - b.leadMs)).toBe(1);
    expect(battleShownSlots(t.startsAt, t.revealAt[0]! - 1)).toBe(0);
    expect(battleShownSlots(t.startsAt, t.revealAt[0]!)).toBe(1);
    expect(battleShownSlots(t.startsAt, t.revealAt[2]!)).toBe(3);
    expect(battleKnownSlots(t.startsAt, t.endsAt)).toBe(5);
    expect(battleShownSlots(t.startsAt, t.endsAt + 99_999)).toBe(5);
  });

  it("every known slot is shown within leadMs", () => {
    for (let now = t.startsAt; now < t.decideAt; now += 97) {
      expect(battleKnownSlots(t.startsAt, now)).toBeGreaterThanOrEqual(battleShownSlots(t.startsAt, now));
      expect(battleShownSlots(t.startsAt, now + b.leadMs)).toBeGreaterThanOrEqual(battleKnownSlots(t.startsAt, now));
    }
  });
});

describe("liveVisibleCards", () => {
  const l = BALANCE.nexamon.live;
  it("follows the opener and falls back to a fixed pace while the opener is silent", () => {
    expect(liveVisibleCards(2, 0, l.staleMs - 1)).toBe(2);
    expect(liveVisibleCards(2, 0, l.staleMs)).toBe(3);
    expect(liveVisibleCards(2, 0, l.staleMs + l.fallbackSlotMs)).toBe(4);
    expect(liveVisibleCards(0, 0, 10_000_000)).toBe(5);
  });
});
