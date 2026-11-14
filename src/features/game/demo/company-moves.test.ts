import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import messages from "../../../../messages/de.json";
import { createCompanyMovesEngine, type CompanyMovesHost, type DemoMoveRun } from "./company-moves";

const cfg = BALANCE.companyMoves;

function setup(opts: { cash?: number; tier?: string; product?: string; roll?: number } = {}) {
  const company = {
    tier: opts.tier ?? "garage",
    productKey: opts.product ?? "courier",
    cashCents: opts.cash ?? 10_000_000,
    awareness: 0.1,
    quality: 0.5,
  };
  let runs: DemoMoveRun[] = [];
  let now = Date.UTC(2026, 10, 14, 12);
  const seen = new Map<string, unknown>();
  const host: CompanyMovesHost = {
    company: () => company,
    addCompanyCash: (c) => {
      company.cashCents += c;
    },
    improve: (kind, by) => {
      company[kind] = Math.min(1, company[kind] + by);
    },
    runs: () => runs,
    setRuns: (r) => {
      runs = r;
    },
    idempotent: <T>(id: string, run: () => T): T => {
      if (!seen.has(id)) seen.set(id, run());
      return seen.get(id) as T;
    },
    now: () => now,
    random: () => opts.roll ?? 0,
  };
  return {
    engine: createCompanyMovesEngine(host),
    company,
    advance: (minutes: number) => {
      now += minutes * 60_000;
    },
  };
}

describe("business move catalogue", () => {
  const products = Object.values(BALANCE.startups.products).flat();
  const items = messages.companyMoves.items as Record<string, { name: string; desc: string }>;

  it("has unique keys, texts for every move and only known products", () => {
    const keys = cfg.moves.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of cfg.moves) {
      expect(items[m.key]?.name, m.key).toBeTruthy();
      expect(items[m.key]?.desc, m.key).toBeTruthy();
      if (m.product !== "*")
        expect(
          products.some((p) => p.key === m.product),
          m.product,
        ).toBe(true);
    }
  });

  it("offers every product its own moves of every kind", () => {
    for (const p of products) {
      const own = cfg.moves.filter((m) => m.product === p.key);
      expect(own.length, p.key).toBeGreaterThanOrEqual(6);
      expect(new Set(own.map((m) => m.kind)).size, p.key).toBe(3);
    }
  });

  it("pays risky moves more on success and less on failure", () => {
    const { safe, normal, risky } = cfg.risk;
    expect(safe.payoutBps).toBeLessThan(normal.payoutBps);
    expect(normal.payoutBps).toBeLessThan(risky.payoutBps);
    expect(safe.refundBps).toBeGreaterThan(risky.refundBps);
    // A cash move is worth starting on average, but not a sure thing.
    for (const r of [safe, normal, risky]) {
      const expected = (r.chanceBps * r.payoutBps + (10_000 - r.chanceBps) * r.refundBps) / 10_000;
      expect(expected).toBeGreaterThan(10_000);
      expect(expected).toBeLessThan(13_000);
    }
  });
});

describe("demo business moves", () => {
  it("lists generic and product moves with the tier's price", async () => {
    const { engine } = setup();
    const s = await engine.companyMoves();
    expect(s.slots).toBe(cfg.slotsByTier.garage);
    expect(s.moves.every((m) => ["*", "courier"].includes(cfg.moves.find((c) => c.key === m.key)!.product))).toBe(true);
    const hospital = s.moves.find((m) => m.key === "hospital_express")!;
    expect(hospital.costCents).toBe(120_000);
    expect(hospital.payoutCents).toBe(180_000);
    expect(hospital.refundCents).toBe(36_000);
  });

  it("charges the cost, pays out after the duration and then rests", async () => {
    const { engine, company, advance } = setup({ roll: 0 });
    await engine.startCompanyMove("r1", "hospital_express");
    expect(company.cashCents).toBe(10_000_000 - 120_000);
    // A replay with the same request id changes nothing.
    await engine.startCompanyMove("r1", "hospital_express");
    expect(company.cashCents).toBe(10_000_000 - 120_000);
    await expect(engine.startCompanyMove("r2", "courier_app")).rejects.toMatchObject({ key: "move_busy" });

    advance(31);
    const s = await engine.companyMoves();
    expect(company.cashCents).toBe(10_000_000 + 60_000);
    expect(s.history[0]).toMatchObject({ key: "hospital_express", status: "success", payoutCents: 180_000 });
    expect(s.moves.find((m) => m.key === "hospital_express")!.availableAt).not.toBeNull();
    await expect(engine.startCompanyMove("r3", "hospital_express")).rejects.toMatchObject({ key: "move_resting" });
  });

  it("refunds part of the cost when the move fails", async () => {
    const { engine, company, advance } = setup({ roll: 0.9999 });
    await engine.startCompanyMove("r1", "hospital_express");
    advance(31);
    const s = await engine.companyMoves();
    expect(s.history[0]).toMatchObject({ status: "failure", payoutCents: 36_000 });
    expect(company.cashCents).toBe(10_000_000 - 120_000 + 36_000);
  });

  it("raises awareness with an awareness move", async () => {
    const { engine, company, advance } = setup({ roll: 0 });
    await engine.startCompanyMove("r1", "courier_app");
    advance(40);
    await engine.companyMoves();
    expect(company.awareness).toBeCloseTo(0.1 + cfg.risk.normal.gain);
  });

  it("refuses moves that are unknown, too expensive or of another product", async () => {
    const { engine } = setup({ cash: 1_000 });
    await expect(engine.startCompanyMove("a", "nope")).rejects.toMatchObject({ key: "move_unknown" });
    await expect(engine.startCompanyMove("b", "hospital_express")).rejects.toMatchObject({
      key: "insufficient_funds",
    });
    await expect(engine.startCompanyMove("c", "solar_park")).rejects.toMatchObject({ key: "move_unknown" });
  });
});
