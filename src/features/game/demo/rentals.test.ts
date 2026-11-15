import { describe, expect, it } from "vitest";
import { FURNITURE } from "@/config/furniture";
import { ownerLivingBonus, tenantLivingBonus } from "@/lib/sim/living";
import { invalidPlacements, rotated, tierConfig } from "@/lib/sim/property";
import { autoLayout, createRentalsEngine, type DemoRentalsState, type RentalsHost } from "./rentals";

const FLAT = [
  "bed_double",
  "sofa_leather",
  "table_oak",
  "lamp_table",
  "vase_flowers",
  "kitchen_fridge",
  "shower",
  "plant_monstera",
  "rug_wool",
];

function host(over: Partial<RentalsHost> = {}) {
  let state: DemoRentalsState | undefined;
  let cash = 1_000_000;
  let now = Date.UTC(2026, 10, 15, 12);
  const notes: string[] = [];
  const counters: Record<string, number> = {};
  const h: RentalsHost = {
    state: () => state,
    setState: (v) => {
      state = v;
    },
    home: () => ({ tier: "flat", floor: "laminate", items: FLAT }),
    nickname: () => "Demo",
    avatarKey: () => "coder",
    accessories: () => [],
    level: () => 10,
    cashCents: () => cash,
    addCash: (c) => {
      cash += c;
    },
    addXp: (base) => base * 2,
    notify: (type, title) => notes.push(`${type}:${title}`),
    feed: () => undefined,
    track: (m, by = 1) => {
      counters[m] = (counters[m] ?? 0) + by;
    },
    idempotent: (_id, run) => run(),
    persist: () => undefined,
    now: () => now,
    ...over,
  };
  return {
    h,
    notes,
    counters,
    cash: () => cash,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("demo living bonus (ADR-161)", () => {
  it("pays the running hour once, then every new hour, as living_bonus_run_due() does", async () => {
    const t = host();
    const r = createRentalsEngine(t.h);
    const bonus = ownerLivingBonus("flat", 90);
    expect(r.propertyRental().livingBonus).toEqual({
      ...bonus,
      source: "own",
      tier: "flat",
      wohnwert: 90,
      owner: null,
    });
    expect(t.cash()).toBe(1_000_000 + bonus.cents);
    r.propertyRental();
    expect(t.cash()).toBe(1_000_000 + bonus.cents);
    t.advance(3 * 3_600_000);
    r.propertyRental();
    expect(t.cash()).toBe(1_000_000 + 4 * bonus.cents);
  });

  it("nothing for a player who lives nowhere", () => {
    const t = host({ home: () => ({ tier: null, floor: "laminate", items: [] }) });
    const r = createRentalsEngine(t.h);
    expect(r.propertyRental().livingBonus).toBeNull();
    expect(t.cash()).toBe(1_000_000);
  });

  it("furniture bought in a bigger home counts its list price for the Wohnwert", () => {
    const t = host({
      home: () => ({ tier: "flat", floor: "laminate", items: [{ itemKey: "sofa_leather", valueCents: 600_000 }] }),
    });
    const cheap = host({ home: () => ({ tier: "flat", floor: "laminate", items: ["sofa_leather"] }) });
    const dear = createRentalsEngine(t.h).propertyRental().wohnwert;
    expect(dear).toBeGreaterThan(createRentalsEngine(cheap.h).propertyRental().wohnwert);
  });
});

describe("demo rentals (ADR-158)", () => {
  it("lays out the made-up homes without overlaps and keeps the middle row free for walking", () => {
    const placed = autoLayout("apartment", ["bed_double", "sofa_leather", "table_oak", "lamp_table", "rug_wool"], "x");
    expect(placed).toHaveLength(5);
    const item = (key: string) => FURNITURE.find((f) => f.key === key)!;
    const byId = new Map(placed.map((p) => [p.id, p.itemKey]));
    const fp = (id: string) => {
      const f = item(byId.get(id)!);
      return { w: f.w, h: f.h, layer: f.layer, surface: f.surface };
    };
    const { width, height } = tierConfig("apartment");
    expect(invalidPlacements(placed, fp, width, height)).toEqual([]);
    const middle = Math.floor(height / 2);
    for (const p of placed.filter((x) => item(x.itemKey).layer === "object")) {
      const { h } = rotated(item(p.itemKey), p.rot);
      expect(p.y > middle || p.y + h <= middle).toBe(true);
    }
  });

  it("an open offer at the lowest price brings an AI tenant at once, who pays every hour", async () => {
    const t = host();
    const r = createRentalsEngine(t.h);
    const state = await r.engine.rentals();
    expect(state.home?.wohnwert.total).toBe(90);
    // the living bonus of the running hour came with the first look (ADR-161)
    const bonus = ownerLivingBonus("flat", 90).cents;
    expect(t.cash()).toBe(1_000_000 + bonus);
    const min = state.home!.limits.hour.minCents;
    const after = await r.engine.setRentalOffer("r1", "hour", min, true);
    expect(after.tenants).toHaveLength(1);
    expect(t.cash()).toBe(1_000_000 + bonus + min);
    expect(t.counters.tenants_found).toBe(1);
    expect(t.notes[0]).toMatch(/^rental_new_tenant:/);
    t.advance(3_600_000);
    const later = await r.engine.rentals();
    expect(later.tenants[0]!.paidCents).toBe(2 * min);
    expect(r.propertyRental().tenants).toHaveLength(1);
  });

  it("a price out of range is refused; notice ends a tenancy after the minimum", async () => {
    const t = host();
    const r = createRentalsEngine(t.h);
    await expect(r.engine.setRentalOffer("r0", "hour", 1, true)).rejects.toMatchObject({
      key: "rent_price_out_of_range",
    });
    const s = await r.engine.setRentalOffer("r1", "hour", 150, true);
    const ended = await r.engine.endTenancy("r2", s.tenants[0]!.id);
    expect(Date.parse(ended.tenants[0]!.endsAt!) - Date.parse(ended.tenants[0]!.startedAt)).toBe(24 * 3_600_000);
    t.advance(25 * 3_600_000);
    expect((await r.engine.rentals()).past[0]?.endReason).toBe("notice_owner");
  });

  it("renting at a made-up landlord: paid at once, XP, one place at a time, out when the money is gone", async () => {
    const t = host({ home: () => ({ tier: null, floor: "laminate", items: [] }) });
    const r = createRentalsEngine(t.h);
    const market = await r.engine.rentalMarket();
    expect(market.length).toBeGreaterThan(0);
    const offer = market.find((o) => o.owner === "Lena_Loft")!;
    const s = await r.engine.rentHome("r1", "Lena_Loft");
    expect(s.renting?.owner).toBe("Lena_Loft");
    expect(s.renting?.tenants.some((x) => !x.isAi && x.name === "Demo")).toBe(true);
    expect(t.cash()).toBe(1_000_000 - offer.priceCents);
    // the next look pays the living bonus of the running hour as a tenant (ADR-161)
    expect(r.propertyRental().livingBonus?.source).toBe("tenant");
    expect(t.cash()).toBe(
      1_000_000 - offer.priceCents + tenantLivingBonus("apartment", offer.wohnwert, offer.priceCents).cents,
    );
    expect(s.renting!.xpTotal).toBeGreaterThan(0);
    await expect(r.engine.rentHome("r2", "Vicky_Villa")).rejects.toMatchObject({ key: "already_renting" });
    t.h.addCash(-t.cash());
    t.advance(3_600_000);
    expect((await r.engine.rentals()).renting).toBeNull();
    expect(t.notes.some((n) => n.startsWith("rental_ended:"))).toBe(true);
  });
});
