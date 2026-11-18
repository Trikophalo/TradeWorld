import { describe, expect, it } from "vitest";
import { vaultBoosts, vaultDailyCents, vaultInterestBps, type VaultYieldInput } from "./vault-yield";

const base: VaultYieldInput = {
  incomeCentsPerHour: 10_000,
  rateCentsPerHour: 10_000,
  factorBps: 10_000,
  capHours: 8,
  level: 1,
  upgrades: {},
  cashCents: 1_000_000,
};

describe("vault yield (ADR-201)", () => {
  it("counts a day of income with the interest, at most twice the vault size", () => {
    expect(vaultDailyCents(base)).toBe(160_000);
    expect(vaultDailyCents({ ...base, capHours: 24 })).toBe(240_000);
    // level 15: 450 €/h x 2.12 = 954 €/h, 28 h vault, +20 % interest
    expect(
      vaultDailyCents({
        ...base,
        rateCentsPerHour: 95_400,
        capHours: 28,
        upgrades: { vault_interest: 4 },
      }),
    ).toBe(2_747_520);
    expect(vaultInterestBps({ vault_interest: 4 })).toBe(2_000);
  });

  it("lists what raises the yield: open steps first, the next level last", () => {
    const boosts = vaultBoosts(base);
    expect(boosts.map((b) => b.key)).toEqual(["vault", "income", "vault_interest", "deposits", "vault_xl", "level"]);
    const level = boosts.find((b) => b.key === "level")!;
    expect(level.gainCentsPerHour).toBe(800);
    expect(level.fromLevel).toBe(2);
    const vault = boosts.find((b) => b.key === "vault")!;
    expect(vault).toMatchObject({ gainHours: 2, costCents: 300_000, fromLevel: null, ready: true });
    const income = boosts.find((b) => b.key === "income")!;
    expect(income).toMatchObject({ gainCentsPerHour: 5_000, fromLevel: 3, ready: false });
    expect(boosts.find((b) => b.key === "deposits")).toMatchObject({ fromLevel: 5, ready: false });
  });

  it("scales the gains with level bonus and treasury factor and drops maxed upgrades", () => {
    const boosts = vaultBoosts({
      ...base,
      level: 15,
      incomeCentsPerHour: 45_000,
      factorBps: 5_000,
      upgrades: { vault: 8, vault_interest: 4, income: 7 },
    });
    expect(boosts.some((b) => b.key === "vault" || b.key === "vault_interest")).toBe(false);
    // next income stage: 450 -> 500 €/h, x 2.12 = +106 €/h, half from the treasury factor
    expect(boosts.find((b) => b.key === "income")!.gainCentsPerHour).toBe(5_300);
    // next level: 450 €/h x 0.08 = +36 €/h, half
    expect(boosts.find((b) => b.key === "level")!.gainCentsPerHour).toBe(1_800);
    expect(boosts.find((b) => b.key === "deposits")).toMatchObject({ fromLevel: null, ready: true });
  });

  it("stops the level step at the highest bonus level", () => {
    expect(vaultBoosts({ ...base, level: 40 }).some((b) => b.key === "level")).toBe(false);
  });
});
