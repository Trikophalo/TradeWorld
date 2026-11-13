import { describe, expect, it } from "vitest";
import type { MyCompany } from "@/features/game/types";
import { bottleneck, profitRoutes } from "./routes";

type Live = NonNullable<MyCompany["live"]>;

const live = (demand: number, capacity: number, extra: Partial<Live> = {}): Live =>
  ({
    lastHourAt: "2026-11-13T10:00:00Z",
    revenuePerHourCents: Math.min(demand, capacity),
    profitPerHourCents: 0,
    payFactorBps: 10_000,
    todayRevenueCents: 0,
    todayProfitCents: 0,
    quarterRevenueCents: 0,
    quarterProfitCents: 0,
    contractRevenuePerHourCents: 0,
    demandPerHourCents: demand,
    capacityPerHourCents: capacity,
    fixedPerHourCents: 0,
    aiWagesPerHourCents: 0,
    marketingPerHourCents: 0,
    founderPayoutPerHourCents: 0,
    todayFounderPayoutCents: 0,
    ...extra,
  }) as Live;

const base = {
  sector: "tech" as const,
  live: live(10_000, 20_000),
  priceLevel: "normal" as const,
  contractWork: false,
  qualityBps: 6_000,
  teamProductivityBps: 20_000,
  aiWageCentsPerHour: 12_000,
  headcount: 2,
  maxEmployees: 5,
  canExpand: false,
  expansionCostCents: null,
  canUpgrade: false,
  upgradeCostCents: null,
  listing: null,
  canGoPublic: false,
  campaign: null,
  campaignCosts: null,
};

const route = (routes: ReturnType<typeof profitRoutes>, key: string) => routes.find((r) => r.key === key)!;

describe("bottleneck (ADR-096)", () => {
  it("names missing customers, missing staff or a balance", () => {
    expect(bottleneck({ live: live(10_000, 20_000) })).toEqual({ kind: "customers", cents: 10_000 });
    expect(bottleneck({ live: live(30_000, 20_000) })).toEqual({ kind: "staff", cents: 10_000 });
    expect(bottleneck({ live: live(20_500, 20_000) })).toEqual({ kind: "balanced", cents: 0 });
    expect(bottleneck({ live: null })).toEqual({ kind: "waiting", cents: 0 });
  });
});

describe("profit routes (ADR-096)", () => {
  it("with free capacity: premium (good quality), contract work, a campaign and selling capacity help; staff does not", () => {
    const routes = profitRoutes(base, 10);
    // Normal: 10.000 × (1 − 0,25) = 7.500; premium: 7.500 × (1,3 − 0,25) = 7.875 per hour.
    expect(route(routes, "price")).toMatchObject({ state: "possible", priceLevel: "premium", gainCentsPerHour: 375 });
    // Below the premium quality the normal price fits best.
    expect(route(profitRoutes({ ...base, qualityBps: 4_000 }, 10), "price")).toMatchObject({ state: "fits" });
    // 10.000 free × 25 % × 30 % margin
    expect(route(routes, "contract")).toMatchObject({ state: "possible", gainCentsPerHour: 750 });
    expect(route(routes, "staff").gainCentsPerHour).toBe(-12_000);
    expect(route(routes, "supplyBuy").gainCentsPerHour).toBeNull();
    // 10.000 free × (60 % fee − 25 % goods)
    expect(route(routes, "supplySell").gainCentsPerHour).toBe(3_500);
    expect(route(routes, "campaign").campaign).toBeDefined();
  });

  it("sold out: staff and buying in help, campaigns and selling capacity do not", () => {
    const routes = profitRoutes({ ...base, live: live(40_000, 20_000) }, 10);
    // One AI worker = 20.000 × 10.000 / 20.000 = 10.000 more capacity, at 75 % margin, minus 120 € wage
    expect(route(routes, "staff").gainCentsPerHour).toBe(10_000 * 0.75 - 12_000);
    expect(route(routes, "supplyBuy").gainCentsPerHour).toBe(Math.round(20_000 * (1 - 0.6)));
    expect(route(routes, "supplySell").gainCentsPerHour).toBeNull();
    expect(route(routes, "campaign").gainCentsPerHour).toBeNull();
    expect(route(routes, "price")).toMatchObject({ priceLevel: "premium" });
  });

  it("shows running levers as active and locks what is not possible", () => {
    const routes = profitRoutes(
      {
        ...base,
        contractWork: true,
        live: live(10_000, 20_000, { contractRevenuePerHourCents: 2_500 }),
        headcount: 5,
        listing: { status: "listed", ticker: "ABC", sharesTotalE6: 1, founderSharesE6: 1, offer: null, lastPriceE4: 1 },
        campaign: {
          id: "c",
          kind: "online",
          startedAt: "",
          endsAt: "",
          costCents: 1,
          demandBps: 3_000,
          resonance: "solid",
        },
      },
      10,
    );
    expect(route(routes, "contract")).toMatchObject({ state: "active", gainCentsPerHour: 2_500 });
    expect(route(routes, "staff").state).toBe("locked");
    expect(route(routes, "campaign")).toMatchObject({ state: "active", campaign: "online" });
    expect(route(routes, "ipo").state).toBe("active");
    expect(route(routes, "expand").state).toBe("locked");
  });

  it("estimates nothing before the first hour", () => {
    const routes = profitRoutes({ ...base, live: null }, 1);
    expect(routes.every((r) => r.gainCentsPerHour === null)).toBe(true);
    expect(route(routes, "ipo").state).toBe("locked");
  });
});
