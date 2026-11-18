import { describe, expect, it } from "vitest";
import { BALANCE } from "../../config/balance.ts";
import { WORLD_RULES } from "../../config/countries.ts";
import { nextOfficeStep, officeBlock, officeRentCentsPerHour, officeSeats, totalSeats } from "./offices.ts";

const cfg = BALANCE.startups.offices;
const hqSeats = WORLD_RULES.hqTiers.reduce((sum, t) => sum + t.seats, 0);

describe("offices (ADR-218)", () => {
  it("adds the seats of every bought step once", () => {
    expect(officeSeats(0)).toBe(0);
    expect(officeSeats(1)).toBe(cfg.steps[0]!.seats);
    expect(officeSeats(cfg.steps.length)).toBe(cfg.steps.reduce((s, x) => s + x.seats, 0));
    expect(officeSeats(cfg.steps.length + 5)).toBe(officeSeats(cfg.steps.length));
  });

  it("reaches 1.000 seats as an AG with the full headquarters and the offices, never more", () => {
    const ag = BALANCE.startups.ag.maxEmployees;
    const all = totalSeats({ tier: ag, expansion: 0, headquarters: hqSeats, offices: officeSeats(cfg.steps.length) });
    expect(all).toBe(1_000);
    expect(ag + hqSeats + officeSeats(cfg.steps.length)).toBeGreaterThanOrEqual(1_000);
    // without the last step the AG stays below the cap
    expect(ag + hqSeats + officeSeats(cfg.steps.length - 1)).toBeLessThan(1_000);
    expect(totalSeats({ tier: ag, expansion: 400, headquarters: hqSeats, offices: 500 })).toBe(cfg.maxTotalSeats);
  });

  it("costs rise steeply: every step costs more per seat, the last ones hundreds of millions", () => {
    for (let i = 1; i < cfg.steps.length; i++) {
      const a = cfg.steps[i - 1]!;
      const b = cfg.steps[i]!;
      expect(b.costCents / b.seats).toBeGreaterThan(a.costCents / a.seats);
      expect(b.costCents).toBeGreaterThan(a.costCents * 1.4);
      expect(b.minWorthCents).toBeGreaterThan(a.minWorthCents);
    }
    expect(cfg.steps.at(-1)!.costCents).toBeGreaterThanOrEqual(50_000_000_000);
    // a step never costs more than the company value it needs (the gate stays meaningful)
    for (const s of cfg.steps.slice(1)) expect(s.costCents).toBeLessThan(s.minWorthCents);
  });

  it("charges rent for every bought office seat", () => {
    expect(officeRentCentsPerHour(0)).toBe(0);
    expect(officeRentCentsPerHour(2)).toBe((cfg.steps[0]!.seats + cfg.steps[1]!.seats) * cfg.rentCentsPerSeatPerHour);
  });

  it("names why the next step is blocked, in server order", () => {
    const ok = { level: 0, tier: "gmbh", worthCents: 0, freeCashCents: cfg.steps[0]!.costCents, seats: 20 };
    expect(officeBlock(ok)).toBeNull();
    expect(officeBlock({ ...ok, tier: "garage" })).toBe("legal_form");
    expect(officeBlock({ ...ok, freeCashCents: 0 })).toBe("cash");
    expect(officeBlock({ ...ok, level: 3, freeCashCents: 1e15, worthCents: 1e15 })).toBe("legal_form");
    expect(officeBlock({ ...ok, level: 3, tier: "ag", freeCashCents: 1e15, worthCents: 0 })).toBe("worth");
    expect(officeBlock({ ...ok, seats: 1_000 })).toBe("seats_max");
    expect(officeBlock({ ...ok, level: cfg.steps.length })).toBe("max_level");
    expect(nextOfficeStep(cfg.steps.length)).toBeNull();
  });
});
