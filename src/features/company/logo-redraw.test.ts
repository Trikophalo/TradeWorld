import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { logoRedrawBlock } from "./logo-redraw";

const info = {
  costCents: BALANCE.startups.logoRedrawCents,
  cooldownHours: BALANCE.startups.logoRedrawCooldownHours,
  redrawnAt: null,
  availableAt: null,
};
const now = Date.UTC(2026, 10, 18, 12);

describe("logoRedrawBlock (ADR-200)", () => {
  it("costs 50 000 € with a 24 h pause", () => {
    expect(BALANCE.startups.logoRedrawCents).toBe(5_000_000);
    expect(BALANCE.startups.logoRedrawCooldownHours).toBe(24);
  });

  it("is free to use with enough free cash and no cooldown", () => {
    expect(logoRedrawBlock(info, info.costCents, now)).toBeNull();
  });

  it("needs the price in free company cash", () => {
    expect(logoRedrawBlock(info, info.costCents - 1, now)).toBe("cash");
  });

  it("waits for the cooldown, also before the clock is known", () => {
    const later = { ...info, availableAt: new Date(now + 60_000).toISOString() };
    expect(logoRedrawBlock(later, info.costCents, now)).toBe("cooldown");
    expect(logoRedrawBlock(later, info.costCents, null)).toBe("cooldown");
    expect(logoRedrawBlock(later, info.costCents, now + 61_000)).toBeNull();
  });
});
