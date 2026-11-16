import { describe, expect, it } from "vitest";
import { FACE_LAYOUT } from "@/components/pixel/nexamon-face";
import { NEXAMON_CARDS } from "@/config/nexamon";
import {
  estimateNumberWidth,
  estimatePixelTextWidth,
  FACE_TEXT,
  fitText,
  hpBlockWidth,
  MIN_SQUEEZE,
  roomBeforeNumber,
} from "./lib";

/*
 * Every card of the catalogue: the name ends before the KP number, the attack name before the damage, and
 * neither is cut off or squeezed into something unreadable.
 */
const SMALLEST_SIZE = 0.8;

describe("text on the card faces (all 231 cards)", () => {
  it("knows the widths of the pixel font", () => {
    expect(estimatePixelTextWidth("Schlummerfalter", 6)).toBeCloseTo(64.5);
    expect(estimatePixelTextWidth("Goldene Morgenröte", 5)).toBeCloseTo(64.375);
    expect(estimateNumberWidth(120, 10)).toBeCloseTo(19.5);
    expect(estimateNumberWidth(40, 10)).toBeCloseTo(13);
  });

  it("squeezes first and shrinks only what is still too long", () => {
    expect(fitText("Tropfel", 6, 35)).toEqual({ squeeze: 1, size: 1 });
    const squeezed = fitText("Voltaquila", 6, 35);
    expect(squeezed.size).toBe(1);
    expect(squeezed.squeeze).toBeGreaterThanOrEqual(MIN_SQUEEZE);
    const small = fitText("Schlummerfalter", 6, 35);
    expect(small.squeeze).toBe(MIN_SQUEEZE);
    expect(small.size).toBeLessThan(1);
    expect(estimatePixelTextWidth("Schlummerfalter", 6) * small.squeeze * small.size).toBeCloseTo(35);
  });

  it("gives a text without a number the whole line", () => {
    expect(roomBeforeNumber(16, 67, 0)).toBe(51);
    expect(roomBeforeNumber(16, 67, 8)).toBe(67 - 8 - FACE_TEXT.gap - 16);
  });

  it.each(["KP", ""])("keeps every name clear of the KP number (label %j)", (label) => {
    for (const card of NEXAMON_CARDS) {
      const layout = FACE_LAYOUT[card.rarity];
      const hpRight = layout.hp.x + layout.hp.w;
      const hpWidth = hpBlockWidth(card.hp, label);
      // The KP block itself fits its box.
      expect(hpWidth, card.key).toBeLessThanOrEqual(layout.hp.w);
      const room = roomBeforeNumber(layout.name.x, hpRight, hpWidth);
      const fit = fitText(card.name, FACE_TEXT.name, room);
      const width = estimatePixelTextWidth(card.name, FACE_TEXT.name) * fit.squeeze * fit.size;
      expect(width, `${card.key} ${card.name}`).toBeLessThanOrEqual(room + 1e-9);
      expect(layout.name.x + width + FACE_TEXT.gap, card.key).toBeLessThanOrEqual(hpRight - hpWidth + 1e-9);
      expect(fit.squeeze, card.key).toBeGreaterThanOrEqual(MIN_SQUEEZE);
      expect(fit.size, `${card.key} ${card.name}`).toBeGreaterThanOrEqual(SMALLEST_SIZE);
    }
  });

  it("fits every attack name before the damage", () => {
    for (const card of NEXAMON_CARDS) {
      const layout = FACE_LAYOUT[card.rarity];
      const right = layout.damage.x + layout.damage.w;
      const damage = card.attack.damage > 0 ? estimateNumberWidth(card.attack.damage, FACE_TEXT.number) : 0;
      expect(damage, card.key).toBeLessThanOrEqual(layout.damage.w);
      const room = roomBeforeNumber(layout.attackName.x, right, damage);
      const fit = fitText(card.attack.name, FACE_TEXT.attack, room);
      const width = estimatePixelTextWidth(card.attack.name, FACE_TEXT.attack) * fit.squeeze * fit.size;
      expect(width, `${card.key} ${card.attack.name}`).toBeLessThanOrEqual(room + 1e-9);
      expect(fit.size, `${card.key} ${card.attack.name}`).toBeGreaterThanOrEqual(SMALLEST_SIZE);
    }
  });

  it("fits every name on the small card of the binder", () => {
    for (const card of NEXAMON_CARDS) {
      const layout = FACE_LAYOUT[card.rarity];
      const room = layout.type.x - 1 - layout.name.x;
      const fit = fitText(card.name, FACE_TEXT.name, room);
      expect(fit.size, `${card.key} ${card.name}`).toBeGreaterThanOrEqual(SMALLEST_SIZE);
    }
  });
});
