import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { artworkCreateCostCents } from "./artworks.ts";
import {
  nftAiAccepts,
  nftAiAskCents,
  nftAiValueCents,
  nftAiWouldBuy,
  nftLowballCents,
  nftRoyaltyCents,
  nftSaleSplit,
  nftAiTradeChanceBps,
  nftAiTradePriceCents,
  nftDemandBps,
  nftFairCents,
} from "./nfts.ts";

const base = { lastSaleCents: null, mintCents: null, likes: 0, creatorSales: 0, ageDays: 0 };

describe("NFT royalties (ADR-135)", () => {
  it("pays the creator 10 % of every resale, nothing when the creator sells", () => {
    expect(nftRoyaltyCents(1_000_000, false)).toBe(100_000);
    expect(nftRoyaltyCents(12_345, false)).toBe(1_234);
    expect(nftRoyaltyCents(1_000_000, true)).toBe(0);
  });

  it("splits a sale into fee, royalty and the seller's part without losing a cent", () => {
    const split = nftSaleSplit(1_234_567, false);
    expect(split).toEqual({ feeCents: 123_456, royaltyCents: 123_456, sellerCents: 987_655 });
    expect(split.feeCents + split.royaltyCents + split.sellerCents).toBe(1_234_567);
    expect(nftSaleSplit(1_000_000, true)).toEqual({ feeCents: 100_000, royaltyCents: 0, sellerCents: 900_000 });
  });
});

describe("AI collectors' valuation", () => {
  it("anchors on the highest of last price, mint cost and floor", () => {
    expect(nftAiValueCents(base)).toBe(BALANCE.nfts.ai.floorCents);
    expect(nftAiValueCents({ ...base, mintCents: 1_500_000 })).toBe(1_500_000);
    expect(nftAiValueCents({ ...base, mintCents: 1_500_000, lastSaleCents: 2_000_000 })).toBe(2_000_000);
    expect(nftAiValueCents({ ...base, mintCents: 1_500_000, lastSaleCents: 900_000 })).toBe(1_500_000);
  });

  it("adds likes, reputation and age, each capped", () => {
    // 5 likes x 4 % + 2 sales x 3 % + 3 days x 1 % = +29 %
    expect(
      nftAiValueCents({ lastSaleCents: null, mintCents: 1_000_000, likes: 5, creatorSales: 2, ageDays: 3.9 }),
    ).toBe(1_290_000);
    // caps: 40 likes, 10 sales, 30 days -> +160 % + 30 % + 30 %
    expect(
      nftAiValueCents({ lastSaleCents: null, mintCents: 1_000_000, likes: 999, creatorSales: 99, ageDays: 999 }),
    ).toBe(3_200_000);
  });

  it("buys only at or below the valuation", () => {
    expect(nftAiWouldBuy(1_000_000, 1_000_000)).toBe(true);
    expect(nftAiWouldBuy(999_999, 1_000_000)).toBe(true);
    expect(nftAiWouldBuy(1_000_001, 1_000_000)).toBe(false);
    expect(nftAiWouldBuy(0, 1_000_000)).toBe(false);
  });

  it("makes lowball offers of 65-90 % in whole euros", () => {
    expect(nftLowballCents(1_000_000, 0)).toBe(650_000);
    expect(nftLowballCents(1_000_000, 0.5)).toBe(775_000);
    expect(nftLowballCents(1_000_000, 0.9999999)).toBe(899_900);
    expect(nftLowballCents(1_234_567, 0)).toBe(802_400);
    expect(nftLowballCents(1_000, 0)).toBe(BALANCE.nfts.minOfferCents);
  });

  it("resells at 125 % and accepts offers from 105 % of its valuation", () => {
    expect(nftAiAskCents(1_000_000)).toBe(1_250_000);
    expect(nftAiAskCents(1_000_001)).toBe(1_250_100);
    expect(nftAiAccepts(1_050_000, 1_000_000)).toBe(true);
    expect(nftAiAccepts(1_049_999, 1_000_000)).toBe(false);
  });

  it("minting pays off: a liked NFT is worth more to the collectors than it cost", () => {
    const cost = artworkCreateCostCents(0);
    expect(artworkCreateCostCents(1)).toBe(2_250_000);
    expect(nftAiValueCents({ ...base, mintCents: cost, likes: 3, ageDays: 2 })).toBeGreaterThan(cost * 1.1);
  });
});

describe("NFT market among collectors (ADR-141)", () => {
  const base = { lastSaleCents: null, mintCents: 200_000, likes: 0, creatorSales: 0, ageDays: 0 };

  it("demand: open offers and recent sales raise the value, capped", () => {
    expect(nftDemandBps(0, 0)).toBe(0);
    expect(nftDemandBps(2, 1)).toBe(2 * 600 + 500);
    expect(nftDemandBps(99, 99)).toBe(6 * 600 + 6 * 500);
    const hot = nftAiValueCents({ ...base, openOffers: 3, recentSales: 2 });
    expect(hot).toBeGreaterThan(nftAiValueCents(base));
  });

  it("popular NFTs change hands more often, capped", () => {
    expect(nftAiTradeChanceBps(0, 0, 0)).toBe(60);
    expect(nftAiTradeChanceBps(10, 2, 1)).toBeGreaterThan(nftAiTradeChanceBps(1, 0, 0));
    expect(nftAiTradeChanceBps(999, 99, 99)).toBe(1_500);
  });

  it("trade prices wander around the fair value instead of climbing for ever", () => {
    const fair = nftFairCents({ ...base, likes: 10 });
    let price: number | null = null;
    let s = 3;
    const rng = () => {
      s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
      return s / 2_147_483_648;
    };
    const seen: number[] = [];
    for (let i = 0; i < 300; i++) {
      price = nftAiTradePriceCents(price, fair, rng());
      seen.push(price);
    }
    expect(Math.max(...seen)).toBeLessThanOrEqual(Math.ceil((fair * 1.25) / 100) * 100);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(Math.floor((fair * 0.85) / 100) * 100 - 100);
    // it goes both ways
    const ups = seen.slice(1).filter((p, i) => p > seen[i]!).length;
    const downs = seen.slice(1).filter((p, i) => p < seen[i]!).length;
    expect(ups).toBeGreaterThan(50);
    expect(downs).toBeGreaterThan(50);
    // a price far above the fair value comes down step by step
    expect(nftAiTradePriceCents(10_000_000, fair, 0.5)).toBeLessThan(10_000_000);
    expect(nftAiTradePriceCents(null, 50_000, 0)).toBe(42_500);
  });
});
