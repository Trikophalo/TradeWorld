import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import {
  artworkCode,
  artworkCreateCostCents,
  endAfterBid,
  hotScore,
  isValidArtwork,
  minNextBidCents,
  sellerProceedsCents,
} from "./artworks.ts";

const size = BALANCE.artworks.size;

describe("artworks (ADR-080)", () => {
  it("cost 15.000 € for the first, 1.5 times the previous for every further one (ADR-135)", () => {
    expect(artworkCreateCostCents(0)).toBe(1_500_000);
    expect(artworkCreateCostCents(1)).toBe(2_250_000);
    expect(artworkCreateCostCents(3)).toBe(5_062_500);
  });

  it("bids beat the current one by 5 %, rounded up to whole euros", () => {
    expect(minNextBidCents(500_000, null)).toBe(500_000);
    expect(minNextBidCents(500_000, 1_000_000)).toBe(1_050_000);
    expect(minNextBidCents(10_000, 10_100)).toBe(10_700);
  });

  it("a late bid extends the auction, an early one does not", () => {
    const end = 10 * 60_000;
    expect(endAfterBid(end, end - 30_000)).toBe(end - 30_000 + 2 * 60_000);
    expect(endAfterBid(end, 0)).toBe(end);
  });

  it("the seller gets the price minus 10 %", () => {
    expect(sellerProceedsCents(1_000_000)).toBe(900_000);
  });

  it("popularity grows with likes and bids and fades with age", () => {
    expect(hotScore(10, 0, 1)).toBeGreaterThan(hotScore(2, 0, 1));
    expect(hotScore(0, 3, 1)).toBeGreaterThan(hotScore(3, 0, 1));
    expect(hotScore(10, 0, 48)).toBeLessThan(hotScore(10, 0, 1));
  });

  it("validates size, palette and content", () => {
    const grid = Array.from({ length: size }, (_, y) => (y < 2 ? "1".repeat(size) : ".".repeat(size)));
    expect(isValidArtwork({ palette: ["#000000", "#ffffff"], grid })).toBe(true);
    expect(isValidArtwork({ palette: ["#000000"], grid })).toBe(false);
    expect(isValidArtwork({ palette: ["#000000", "#ffffff"], grid: grid.slice(1) })).toBe(false);
    expect(isValidArtwork({ palette: ["#000000"], grid: Array.from({ length: size }, () => ".".repeat(size)) })).toBe(
      false,
    );
    expect(artworkCode(42)).toBe("NFT-0042");
  });
});
