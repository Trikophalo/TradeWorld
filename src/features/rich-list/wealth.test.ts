import { describe, expect, it } from "vitest";
import type { WealthPart } from "@/features/game/types";
import { wealthSource, wealthTotal } from "./wealth";

const zero: Record<WealthPart, number> = {
  cash: 0,
  depot: 0,
  company: 0,
  cards: 0,
  slabs: 0,
  nfts: 0,
  property: 0,
  vault: 0,
  escrow: 0,
  deals: 0,
  debt: 0,
};

describe("wealth (ADR-203)", () => {
  it("the net worth is the sum of every part, debt and deals included", () => {
    expect(wealthTotal({ ...zero, cash: 1000, depot: 500, company: 4_940_000_000, debt: -200, deals: -50 })).toBe(
      4_940_001_250,
    );
    expect(wealthTotal(zero)).toBe(0);
  });

  it("the main source is the largest group: the vault and escrow count as cash, cards and slabs together", () => {
    expect(wealthSource({ ...zero, cash: 100, company: 300 })).toBe("company");
    expect(wealthSource({ ...zero, cash: 100, vault: 150, escrow: 100, company: 300 })).toBe("cash");
    expect(wealthSource({ ...zero, cards: 200, slabs: 200, depot: 350 })).toBe("cards");
  });

  it("ties go to the first key alphabetically, as ORDER BY v DESC, k on the server; nothing positive is null", () => {
    expect(wealthSource({ ...zero, depot: 100, cash: 100 })).toBe("cash");
    expect(wealthSource({ ...zero, nfts: 7, property: 7 })).toBe("nfts");
    expect(wealthSource({ ...zero, debt: -100, deals: 50 })).toBeNull();
  });
});
