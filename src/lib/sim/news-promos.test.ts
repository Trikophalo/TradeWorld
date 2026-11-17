import { describe, expect, it } from "vitest";
import { NEWS_PROMO_KINDS } from "../../config/news-promos.ts";
import { drawNewsPromoKind, promoPackPriceCents, taxRefundCents } from "./news-promos.ts";

describe("drawNewsPromoKind", () => {
  it("brings nothing when the chance roll misses", () => {
    expect(drawNewsPromoKind(NEWS_PROMO_KINDS, null, 3400, 0.34, 0)).toBeNull();
    expect(drawNewsPromoKind(NEWS_PROMO_KINDS, null, 3400, 0.3399, 0)).toBe("pack_sale");
  });
  it("never repeats the previous kind", () => {
    for (const last of NEWS_PROMO_KINDS) {
      for (let i = 0; i < 100; i++) {
        expect(drawNewsPromoKind(NEWS_PROMO_KINDS, last, 10_000, 0, i / 100)).not.toBe(last);
      }
    }
  });
  it("reaches every other kind", () => {
    const seen = new Set([0, 0.5, 0.99].map((r) => drawNewsPromoKind(NEWS_PROMO_KINDS, "free_nft", 10_000, 0, r)));
    expect(seen).toEqual(new Set(["pack_sale", "tax_return"]));
  });
});

describe("promo amounts", () => {
  it("takes 20 % off, rounded half to even", () => {
    expect(promoPackPriceCents(50_000n, 2000)).toBe(40_000n);
    expect(promoPackPriceCents(12_345n, 2000)).toBe(9_876n);
  });
  it("refunds 10 % of the revenue up to the cap", () => {
    expect(taxRefundCents(1_234_567n, 1000, 5_000_000n)).toBe(123_457n);
    expect(taxRefundCents(90_000_000n, 1000, 5_000_000n)).toBe(5_000_000n);
    expect(taxRefundCents(0n, 1000, 5_000_000n)).toBe(0n);
  });
});
