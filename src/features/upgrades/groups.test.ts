import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { DISCLOSURE } from "@/config/disclosure";
import { upgradeGroupSummary } from "./groups";

const vaultGroup = BALANCE.upgrades.groups.find((g) => g.key === "vault")!.keys;

describe("upgrade group summary (ADR-201)", () => {
  it("counts stages, buyable upgrades and the cheapest next stage", () => {
    const s = upgradeGroupSummary(vaultGroup, {}, 1, 1_000_000);
    // vault 8, vault_xl 3, vault_interest 4, income 12, daily_bonus 3
    expect(s).toEqual({ bought: 0, total: 30, buyable: 1, nextCostCents: 300_000, nextLevel: null });
  });

  it("names the cheapest stage the level allows even without the cash", () => {
    const s = upgradeGroupSummary(vaultGroup, { vault: 1 }, 2, 0);
    // vault stage 2 needs level 3; daily_bonus (level 2) costs 2.500 €
    expect(s).toMatchObject({ bought: 1, buyable: 0, nextCostCents: 250_000, nextLevel: null });
  });

  it("names the next level when the level allows nothing", () => {
    const s = upgradeGroupSummary(["vault_xl"], {}, 5, 100_000_000);
    expect(s).toMatchObject({ buyable: 0, nextCostCents: null, nextLevel: 14 });
  });

  it("is done when everything is bought", () => {
    const s = upgradeGroupSummary(["vault_xl"], { vault_xl: 3 }, 40, 0);
    expect(s).toEqual({ bought: 3, total: 3, buyable: 0, nextCostCents: null, nextLevel: null });
  });

  it("shows Festgeld from the level the server unlocks it", () => {
    expect(DISCLOSURE.vaultDeposits).toBe(BALANCE.vault.deposits.minLevel);
  });
});
