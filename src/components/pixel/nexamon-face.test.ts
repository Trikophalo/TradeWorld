import { describe, expect, it } from "vitest";
import { NEXAMON_ART_SIZE, NEXAMON_RARITIES, NEXAMON_SETS, NEXAMON_TYPES } from "@/config/nexamon/types";
import { composeCardBack, composeCardFace, EVENT_LABEL, FACE_LAYOUT, ONE_OF_ONE_BAND } from "./nexamon-face";
import { microTextWidth } from "./nexamon-font";
import { composePack, composeSlab, PACK_SIZE, packTearRow, SLAB_CARD, SLAB_SIZE } from "./nexamon-pack";
import { countOpaque, isOpaque, pixelHex, validateArt } from "./nexamon-raster";
import { NEXAMON_SAMPLE_CARDS, NEXAMON_SAMPLE_EVENT, nexamonSampleArt } from "./nexamon-samples";
import { ONE_OF_ONE_INK, rarityMark, setSymbol, TYPE_INK, TYPE_SYMBOL } from "./nexamon-symbols";

describe("nexamon symbols", () => {
  it("has a nine-pixel symbol with a complete palette for each type", () => {
    const shapes = new Set<string>();
    for (const type of NEXAMON_TYPES) {
      const { grid, palette } = TYPE_SYMBOL[type];
      expect(grid, type).toHaveLength(9);
      for (const row of grid) {
        expect(row, type).toHaveLength(9);
        for (const ch of row) if (ch !== ".") expect(palette[ch], `${type} '${ch}'`).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(grid.join("")).toContain("w");
      shapes.add(grid.join(""));
      for (const hex of Object.values(TYPE_INK[type])) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(shapes.size).toBe(NEXAMON_TYPES.length);
  });

  it("has distinct set symbols and rarity marks", () => {
    const sets = NEXAMON_SETS.map((set) => setSymbol(set, "#000000").grid.join(""));
    expect(new Set(sets).size).toBe(NEXAMON_SETS.length);
    for (const set of NEXAMON_SETS)
      expect(setSymbol(set, "#000000").grid.map((r) => r.length)).toEqual(Array(7).fill(7));
    const marks = NEXAMON_RARITIES.map((rarity) => rarityMark(rarity, "#000000").grid.join(""));
    expect(new Set(marks).size).toBe(NEXAMON_RARITIES.length);
    for (const rarity of NEXAMON_RARITIES)
      expect(rarityMark(rarity, "#000000").grid.map((r) => r.length)).toEqual(Array(5).fill(5));
  });
});

describe("nexamon sample art", () => {
  it("fits the art contract of its rarity", () => {
    const art = nexamonSampleArt();
    expect(NEXAMON_SAMPLE_CARDS.map((c) => c.rarity)).toEqual([...NEXAMON_RARITIES]);
    for (const card of NEXAMON_SAMPLE_CARDS) {
      expect(validateArt(art[card.key]!, card.rarity), card.key).toEqual([]);
      expect(card.flavor.length, card.key).toBeLessThanOrEqual(110);
    }
    // The ultra artwork only fills the window; around it the creature crosses a transparent margin.
    const ultra = art["demo-066"]!;
    expect(ultra.grid[0]).toContain(".");
    expect(ultra.grid[0]!.replace(/\./g, "").length).toBeGreaterThan(0);
  });
});

describe("composeCardFace", () => {
  const art = nexamonSampleArt();

  it("draws a 72 x 100 card with cut corners for every rarity", () => {
    for (const card of NEXAMON_SAMPLE_CARDS) {
      const r = composeCardFace(card, art[card.key]);
      expect([r.width, r.height], card.rarity).toEqual([72, 100]);
      expect(countOpaque(r), card.rarity).toBe(72 * 100 - 4);
      expect(isOpaque(r, 0, 0)).toBe(false);
      expect(isOpaque(r, 71, 99)).toBe(false);
    }
  });

  it("puts the artwork where the contract says", () => {
    const common = NEXAMON_SAMPLE_CARDS[0]!;
    const picture = art[common.key]!;
    const r = composeCardFace(common, picture);
    const { x, y } = FACE_LAYOUT.common.art;
    expect([x, y]).toEqual([6, 14]);
    for (const [ax, ay] of [
      [0, 0],
      [59, 39],
      [30, 20],
    ] as const)
      expect(pixelHex(r, x + ax, y + ay)).toBe(picture.palette[picture.grid[ay]![ax]!]);
    expect(FACE_LAYOUT.ultra.art).toEqual({ x: 2, y: 8 });
    expect(FACE_LAYOUT.prisma.art).toEqual({ x: 0, y: 0 });
    for (const rarity of NEXAMON_RARITIES) {
      const { window } = FACE_LAYOUT[rarity];
      expect(window.w).toBeLessThanOrEqual(NEXAMON_ART_SIZE[rarity].width);
    }
  });

  it("falls back to the placeholder without artwork or with a broken one", () => {
    const common = NEXAMON_SAMPLE_CARDS[0]!;
    const plain = composeCardFace(common);
    const broken = composeCardFace(common, { ...art[common.key]!, width: 12 });
    expect(Buffer.from(broken.data).equals(Buffer.from(plain.data))).toBe(true);
    expect(Buffer.from(composeCardFace(common, art[common.key]).data).equals(Buffer.from(plain.data))).toBe(false);
    // The placeholder differs by type.
    const other = composeCardFace({ ...common, type: "water" });
    expect(Buffer.from(other.data).equals(Buffer.from(plain.data))).toBe(false);
  });

  it("draws the One of One with its band and an event card with its own frame (ADR-174)", () => {
    const one = NEXAMON_SAMPLE_CARDS.find((c) => c.rarity === "one_of_one")!;
    const r = composeCardFace(one, art[one.key]);
    expect([r.width, r.height]).toEqual([72, 100]);
    expect(countOpaque(r)).toBe(72 * 100 - 4);
    // the band is black with gold edges across the full width
    const band = ONE_OF_ONE_BAND;
    expect(pixelHex(r, 36, band.y)).toBe(ONE_OF_ONE_INK.goldLight);
    expect(pixelHex(r, 36, band.y + band.h - 1)).toBe(ONE_OF_ONE_INK.goldLight);
    // gold letters inside the band
    let gold = 0;
    for (let y = band.y + 3; y < band.y + 15; y++)
      for (let x = 0; x < 72; x++) if (pixelHex(r, x, y) === ONE_OF_ONE_INK.gold) gold++;
    expect(gold).toBeGreaterThan(80);
    // not the legendary frame
    const legendary = composeCardFace({ ...one, rarity: "legendary" }, art[one.key]);
    expect(Buffer.from(legendary.data).equals(Buffer.from(r.data))).toBe(false);

    const event = NEXAMON_SAMPLE_EVENT;
    const e = composeCardFace(event, art[event.key]);
    const monster = composeCardFace({ ...event, kind: "monster" }, art[event.key]);
    expect([e.width, e.height]).toEqual([72, 100]);
    expect(Buffer.from(e.data).equals(Buffer.from(monster.data))).toBe(false);
    expect(pixelHex(e, EVENT_LABEL.x + 3, Math.round(FACE_LAYOUT.common.hp.y) + 3)).toBe(TYPE_INK.cosmic.deep);
  });

  it("draws the back once and reuses it", () => {
    const back = composeCardBack();
    expect([back.width, back.height]).toEqual([72, 100]);
    expect(composeCardBack()).toBe(back);
  });
});

describe("packs and slabs", () => {
  it("splits a pack into a torn strip and a rest that add up to the sealed pack", () => {
    for (const set of NEXAMON_SETS) {
      const { full, top, body } = composePack(set);
      expect([full.width, full.height]).toEqual([PACK_SIZE.width, PACK_SIZE.height]);
      expect(countOpaque(top) + countOpaque(body)).toBe(countOpaque(full));
      for (let x = 0; x < full.width; x += 7) {
        const tear = packTearRow(x);
        expect(isOpaque(top, x, tear)).toBe(false);
        expect(isOpaque(body, x, tear - 1)).toBe(false);
        expect(isOpaque(body, x, tear)).toBe(true);
      }
    }
    const fronts = NEXAMON_SETS.map((set) => Buffer.from(composePack(set).full.data).toString("base64"));
    expect(new Set(fronts).size).toBe(NEXAMON_SETS.length);
  });

  it("makes room for a card in the slab and gives a ten the gold label", () => {
    const ten = composeSlab(10);
    const nine = composeSlab(9);
    expect([ten.front.width, ten.front.height]).toEqual([SLAB_SIZE.width, SLAB_SIZE.height]);
    expect(SLAB_CARD.x + 72).toBeLessThan(SLAB_SIZE.width);
    expect(SLAB_CARD.y + 100).toBeLessThan(SLAB_SIZE.height);
    expect(composeSlab(3)).toBe(nine);
    expect(Buffer.from(ten.front.data).equals(Buffer.from(nine.front.data))).toBe(false);
    expect(Buffer.from(nine.front.data).equals(Buffer.from(nine.back.data))).toBe(false);
    const one = composeSlab(9, true);
    expect(one).not.toBe(nine);
    expect(Buffer.from(one.front.data).equals(Buffer.from(nine.front.data))).toBe(false);
  });

  it("measures the micro font", () => {
    expect(microTextWidth("ASP")).toBe(11);
    expect(microTextWidth("NEXAMON", 2)).toBeLessThanOrEqual(PACK_SIZE.width - 4);
    expect(microTextWidth("PRISMATIC PEAK")).toBeLessThanOrEqual(PACK_SIZE.width - 4);
    expect(microTextWidth("COSMIC WINDS")).toBeLessThanOrEqual(PACK_SIZE.width - 4);
  });
});
