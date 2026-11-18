import { describe, expect, it } from "vitest";
import { HQ_STYLE_OPTIONS } from "@/config/countries";
import { companyInitials, HQ_CANVAS, hqArt } from "./hq";

describe("headquarters pixel art (ADR-208)", () => {
  it("draws every tier, roof and decoration on the same rectangular canvas with known colors", () => {
    for (let tier = 0; tier <= 5; tier++) {
      for (const roofKind of HQ_STYLE_OPTIONS.roofs) {
        for (const deco of HQ_STYLE_OPTIONS.decorations) {
          const art = hqArt({ tier, roofKind, deco, initials: "NX", flag: ["#000000", "#ff0000", "#ffcc00"] });
          expect(art.grid).toHaveLength(HQ_CANVAS.height);
          for (const row of art.grid) {
            expect(row).toHaveLength(HQ_CANVAS.width);
            for (const c of row)
              if (c !== ".") expect(art.palette[c], `${tier}/${roofKind}/${deco}: ${c}`).toBeDefined();
          }
        }
      }
    }
  });

  it("grows with the tier", () => {
    const filled = (tier: number) => hqArt({ tier }).grid.join("").replace(/\./g, "").length;
    for (let tier = 1; tier <= 5; tier++) expect(filled(tier)).toBeGreaterThan(filled(tier - 1));
  });

  it("is deterministic and shows the style", () => {
    const a = hqArt({ tier: 2, wall: 3, roof: 1, sign: 2, initials: "AB" });
    expect(hqArt({ tier: 2, wall: 3, roof: 1, sign: 2, initials: "AB" })).toEqual(a);
    expect(hqArt({ tier: 2, wall: 4, roof: 1, sign: 2, initials: "AB" }).palette.w).not.toBe(a.palette.w);
    expect(hqArt({ tier: 2, initials: "XY" }).grid).not.toEqual(hqArt({ tier: 2, initials: "AB" }).grid);
  });

  it("takes the initials of the name", () => {
    expect(companyInitials("Welt Anna GmbH")).toBe("WA");
    expect(companyInitials("Öko")).toBe("OK");
    expect(companyInitials("  ")).toBe("N");
  });
});
