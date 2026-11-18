import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import type { CompanyWithdrawRhythm } from "@/features/game/types";
import { withdrawableCents, withdrawBlock } from "./withdraw";

const now = Date.UTC(2026, 10, 18, 12);
const at = (ms: number) => new Date(ms).toISOString();
const rhythm = (nextAt: string | null, issueLockedCents = 0): CompanyWithdrawRhythm => ({
  intervalHours: BALANCE.startups.withdrawIntervalHours,
  lastAt: null,
  nextAt,
  issueLockedCents,
  issueLockedUntil: null,
});

describe("withdrawBlock (ADR-213)", () => {
  it("allows a withdrawal every 6 hours", () => {
    expect(BALANCE.startups.withdrawIntervalHours).toBe(6);
  });

  it("is free without a pause or ban, also on older servers", () => {
    expect(withdrawBlock(rhythm(null), null, now)).toBeNull();
    expect(withdrawBlock(null, null, now)).toBeNull();
  });

  it("waits for the next withdrawal, also before the clock is known", () => {
    const next = at(now + 3_600_000);
    expect(withdrawBlock(rhythm(next), null, now)).toEqual({ reason: "interval", until: next });
    expect(withdrawBlock(rhythm(next), null, null)).toEqual({ reason: "interval", until: next });
    expect(withdrawBlock(rhythm(next), null, now + 3_600_001)).toBeNull();
  });

  it("shows the board's ban first", () => {
    const ban = at(now + 86_400_000);
    expect(withdrawBlock(rhythm(at(now + 60_000)), ban, now)).toEqual({ reason: "board", until: ban });
    expect(withdrawBlock(rhythm(null), at(now - 1), now)).toBeNull();
  });
});

describe("withdrawableCents", () => {
  const company = { cashCents: 1_000_000, unpaidCents: 200_000, withdraw: rhythm(null) };

  it("keeps open bills in the company", () => {
    expect(withdrawableCents(company)).toBe(800_000);
    expect(withdrawableCents({ ...company, unpaidCents: 2_000_000 })).toBe(0);
  });

  it("keeps the board's budgets and locked issue proceeds in a listed company", () => {
    expect(withdrawableCents(company, 500_000)).toBe(500_000);
    expect(withdrawableCents({ ...company, withdraw: rhythm(null, 300_000) }, 500_000)).toBe(200_000);
    expect(withdrawableCents({ ...company, withdraw: rhythm(null, 900_000) }, 500_000)).toBe(0);
  });
});
