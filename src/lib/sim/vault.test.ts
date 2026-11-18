import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  vaultDepositCapCents,
  vaultDepositCheck,
  vaultDepositInterestCents,
  vaultDepositTerm,
  vaultLevelFactorBps,
  vaultRateCentsPerHour,
} from "./vault.ts";

const b = (n: number) => BigInt(n);

describe("vault level bonus (ADR-201)", () => {
  it("adds 8 % per level above 1 and stops at level 40", () => {
    expect(vaultLevelFactorBps(1)).toBe(10_000);
    expect(vaultLevelFactorBps(5)).toBe(13_200);
    expect(vaultLevelFactorBps(15)).toBe(21_200);
    expect(vaultLevelFactorBps(30)).toBe(33_200);
    expect(vaultLevelFactorBps(40)).toBe(41_200);
    expect(vaultLevelFactorBps(80)).toBe(41_200);
    expect(vaultLevelFactorBps(0)).toBe(10_000);
  });

  it("scales the basic income with the upgrades, rounded half even", () => {
    expect(vaultRateCentsPerHour(10_000, 1)).toBe(10_000);
    // 200 €/h (two income stages) at level 5: 264 €/h
    expect(vaultRateCentsPerHour(20_000, 5)).toBe(26_400);
    // 700 €/h (all income stages) at level 30: 2 324 €/h
    expect(vaultRateCentsPerHour(70_000, 30)).toBe(232_400);
    // 1 cent x 1.08 = 1.08 -> 1; 25 cents x 1.08 = 27; 125 x 1.32 = 165
    expect(vaultRateCentsPerHour(1, 2)).toBe(1);
    expect(vaultRateCentsPerHour(125, 5)).toBe(165);
    const half = { ...BALANCE.vault, levelBonusBps: 5_000 };
    // 1 cent x 1.5 = 1.5 -> 2 (even), 3 cents x 1.5 = 4.5 -> 4 (even)
    expect(vaultRateCentsPerHour(1, 2, half)).toBe(2);
    expect(vaultRateCentsPerHour(3, 2, half)).toBe(4);
  });
});

describe("vault deposits (ADR-201)", () => {
  it("caps all open deposits at 25.000 € per level", () => {
    expect(vaultDepositCapCents(5)).toBe(12_500_000);
    expect(vaultDepositCapCents(30)).toBe(75_000_000);
  });

  it("knows the three terms", () => {
    expect(vaultDepositTerm(1)?.rateBps).toBe(150);
    expect(vaultDepositTerm(3)?.rateBps).toBe(500);
    expect(vaultDepositTerm(7)?.rateBps).toBe(1_400);
    expect(vaultDepositTerm(2)).toBeNull();
  });

  it("pays amount x rate x treasury factor, rounded half even once", () => {
    expect(vaultDepositInterestCents(b(10_000_000), 1_400)).toBe(b(1_400_000));
    expect(vaultDepositInterestCents(b(10_000_000), 1_400, 5_000)).toBe(b(700_000));
    // 1 050 cents x 1.5 % = 15.75 -> 16; 50 cents x 1 % = 0.5 -> 0 (even); 150 x 1 % = 1.5 -> 2 (even)
    expect(vaultDepositInterestCents(b(1_050), 150)).toBe(b(16));
    expect(vaultDepositInterestCents(b(50), 100)).toBe(b(0));
    expect(vaultDepositInterestCents(b(150), 100)).toBe(b(2));
    expect(vaultDepositInterestCents(b(0), 1_400)).toBe(b(0));
    expect(vaultDepositInterestCents(b(1_000), 0)).toBe(b(0));
  });

  it("checks level, term, size, count, cap and cash in this order", () => {
    const base = { level: 10, amountCents: 1_000_000, days: 7, cashCents: 5_000_000, openCents: 0, openCount: 0 };
    expect(vaultDepositCheck(base)).toBe("ok");
    expect(vaultDepositCheck({ ...base, level: 4 })).toBe("level");
    expect(vaultDepositCheck({ ...base, days: 2 })).toBe("term");
    expect(vaultDepositCheck({ ...base, amountCents: 99_999 })).toBe("too_small");
    expect(vaultDepositCheck({ ...base, openCount: 3 })).toBe("max_open");
    expect(vaultDepositCheck({ ...base, openCents: 24_500_000 })).toBe("cap");
    expect(vaultDepositCheck({ ...base, openCents: 24_000_000 })).toBe("ok");
    expect(vaultDepositCheck({ ...base, cashCents: 999_999 })).toBe("cash");
  });
});
