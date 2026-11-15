import { describe, expect, it } from "vitest";
import { accessoryByKey } from "@/config/accessories";
import { BALANCE } from "@/config/balance";
import { demoAccessories, demoChatter, demoCoworkerMembers, demoCoworkers } from "./floor";

const NOW = Date.parse("2026-11-15T12:00:30Z");

describe("demo colleagues on the company floor (ADR-156)", () => {
  it("are stable per company, never named like the player, the last one away", () => {
    const a = demoCoworkers("Brezel AG", "Mila");
    expect(a).toEqual(demoCoworkers("Brezel AG", "Mila"));
    expect(a).toHaveLength(3);
    expect(a.map((c) => c.nickname)).not.toContain("Mila");
    expect(new Set(a.map((c) => c.nickname)).size).toBe(3);
    expect(a.map((c) => c.online)).toEqual([true, true, false]);
    for (const c of a) expect(BALANCE.avatars.portraits.some((p) => p.key === c.avatarKey)).toBe(true);
  });

  it("wear one to three known accessories, one per slot", () => {
    for (const name of ["Mila", "Jonas", "Ayla", "Theo", "Lina"]) {
      const worn = demoAccessories(name);
      expect(worn.length).toBeGreaterThanOrEqual(1);
      expect(worn.length).toBeLessThanOrEqual(3);
      const slots = worn.map((k) => accessoryByKey(k)?.slot);
      expect(slots.every(Boolean)).toBe(true);
      expect(new Set(slots).size).toBe(worn.length);
      expect(demoAccessories(name)).toEqual(worn);
    }
  });

  it("one online colleague speaks per bubble window, from its start", () => {
    const team = demoCoworkers("Brezel AG", "Mila");
    const chatter = demoChatter(team, NOW, 120);
    expect(chatter.size).toBe(1);
    const [name, line] = [...chatter][0]!;
    expect(team.find((c) => c.nickname === name)?.online).toBe(true);
    expect(Date.parse(line.at)).toBeLessThanOrEqual(NOW);
    expect(NOW - Date.parse(line.at)).toBeLessThan(120_000);
    expect(demoChatter(team, NOW + 1_000, 120)).toEqual(chatter);
    expect(
      demoChatter(
        team.map((c) => ({ ...c, online: false })),
        NOW,
        120,
      ).size,
    ).toBe(0);
  });

  it("become floor members without ids", () => {
    const members = demoCoworkerMembers(demoCoworkers("Brezel AG", "Mila"), NOW);
    expect(members.every((m) => m.role === "employee" && !m.me)).toBe(true);
    expect(members.filter((m) => m.lastMessage).length).toBeLessThanOrEqual(1);
    expect(Object.keys(members[0]!)).not.toContain("id");
  });
});
