import { describe, expect, it } from "vitest";
import { battleRevealTier, revealCountCents } from "./battle-reveal";

describe("battleRevealTier (ADR-205)", () => {
  it("only the last two cards of a pack get an effect", () => {
    expect(battleRevealTier("legendary", 1, 5)).toBe(0);
    expect(battleRevealTier("legendary", 3, 5)).toBe(0);
    expect(battleRevealTier("common", 4, 5)).toBe(1);
    expect(battleRevealTier("common", 5, 5)).toBe(2);
  });

  it("escalates with the rarity and is louder on the very last card", () => {
    expect(battleRevealTier("rare", 4, 5)).toBe(2);
    expect(battleRevealTier("ultra", 4, 5)).toBe(3);
    expect(battleRevealTier("prisma", 4, 5)).toBe(4);
    expect(battleRevealTier("ultra", 5, 5)).toBe(4);
    expect(battleRevealTier("uranium", 5, 5)).toBe(4);
    expect(battleRevealTier("iron", 4, 5)).toBe(1);
    expect(battleRevealTier("titanium", 4, 5)).toBe(3);
  });
});

describe("revealCountCents", () => {
  it("counts up from 0 to the value, ease-out, whole cents", () => {
    expect(revealCountCents(10_000, 0, 600)).toBe(0);
    expect(revealCountCents(10_000, 600, 600)).toBe(10_000);
    expect(revealCountCents(10_000, 900, 600)).toBe(10_000);
    const half = revealCountCents(10_000, 300, 600);
    expect(half).toBeGreaterThan(5_000);
    expect(Number.isInteger(half)).toBe(true);
    expect(revealCountCents(123, 50, 0)).toBe(123);
  });
});
