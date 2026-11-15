import { describe, expect, it } from "vitest";
import { accessoryByKey } from "@/config/accessories";
import { aiTenantLook, freeTiles, idleMs, tenantLook, walkTile } from "./tenants";

describe("tenants in the room (ADR-158)", () => {
  it("an AI tenant always looks the same for the same name, with at most three accessories in different slots", () => {
    expect(aiTenantLook("Mia F.")).toEqual(aiTenantLook("Mia F."));
    const looks = ["Anja K.", "Ben S.", "Carla M.", "Deniz Y.", "Elif A.", "Finn H."].map(aiTenantLook);
    expect(new Set(looks.map((l) => JSON.stringify(l))).size).toBeGreaterThan(1);
    for (const look of looks) {
      expect(look.accessories.length).toBeLessThanOrEqual(3);
      const slots = look.accessories.map((k) => accessoryByKey(k)?.slot);
      expect(new Set(slots).size).toBe(slots.length);
      for (const k of look.accessories) expect(["common", "rare"]).toContain(accessoryByKey(k)?.rarity);
    }
  });

  it("players keep their own portrait and accessories", () => {
    expect(tenantLook({ name: "Tim", isAi: false, avatarKey: "coder", accessories: ["party_hat"] })).toEqual({
      avatarKey: "coder",
      accessories: ["party_hat"],
    });
    expect(tenantLook({ name: "Mia F.", isAi: true, avatarKey: null, accessories: [] })).toEqual(
      aiTenantLook("Mia F."),
    );
  });

  it("tenants walk on tiles without furniture; rugs do not block", () => {
    const tiles = freeTiles({
      width: 3,
      height: 2,
      placed: [
        { id: "a", itemKey: "sofa_leather", x: 0, y: 0, rot: 0 },
        { id: "b", itemKey: "rug_basic", x: 0, y: 1, rot: 0 },
      ],
    });
    expect(tiles).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    const target = walkTile(tiles, "Mia F.", 3);
    expect(tiles).toContainEqual(target);
    expect(walkTile(tiles, "Mia F.", 3)).toEqual(target);
    expect(walkTile([], "Mia F.", 3)).toBeNull();
    expect(idleMs("Mia F.", 1)).toBeGreaterThanOrEqual(1_500);
    expect(idleMs("Mia F.", 1)).toBeLessThan(4_500);
  });
});
