import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import { GameError } from "../types";
import type { DemoCompanyState } from "./company";
import { createListedEngine, type ListedHost, type ListedHourFacts } from "./listed";

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 16, 9);

function setup(over: Partial<DemoCompanyState> = {}) {
  let now = START;
  let cash = 0;
  const notes: string[] = [];
  const feed: string[] = [];
  const counters: Record<string, number> = {};
  const company = {
    id: "demo-company-1",
    name: "Brezel AG",
    idea: "",
    sector: "tech",
    color: "#336699",
    tier: "ag",
    foundedAt: START,
    potentialAnnualCents: 1_000_000,
    awareness: 0.5,
    quality: 0.5,
    quartersActive: 3,
    cashCents: 50_000_000,
    unpaidCents: 0,
    marketingCents: 0,
    aiWorkers: 10,
    lastClosedAt: START,
    reports: [],
    estimateSeeds: [0.5, 0.5],
    postings: [],
    seq: 0,
    founderPayoutBps: 0,
    listing: {
      status: "listed",
      ticker: "BRZ",
      sharesTotal: 1_000_000,
      founderShares: 600_000,
      lastPriceCents: 1_000,
      offer: null,
    },
    ...over,
  } as DemoCompanyState;
  const host: ListedHost = {
    company: () => company,
    nickname: () => "Demo",
    addCash: (c) => {
      cash += c;
    },
    notify: (type, title) => notes.push(`${type}:${title}`),
    feed: (kind) => feed.push(kind),
    track: (m, by = 1) => {
      counters[m] = (counters[m] ?? 0) + by;
    },
    catchUp: () => undefined,
    idempotent: (_id, run) => run(),
    persist: () => undefined,
    now: () => now,
    random: () => 0.5,
  };
  const listed = createListedEngine(host);
  /** One operating hour with the given numbers, the way the company engine calls the hooks. */
  const hour = (facts: Partial<ListedHourFacts> = {}) => {
    const terms = listed.hourTerms(company, now);
    const f: ListedHourFacts = {
      at: now,
      demandCents: 400_000,
      capacityCents: 575_000,
      revenueCents: 400_000,
      cogsCents: 100_000,
      aiWagesCents: 120_000,
      fixedCents: 166_667 + (terms?.costsCents ?? 0),
      listedCostsCents: terms?.costsCents ?? 0,
      marketingCents: 0,
      profitCents: 13_333 - (terms?.costsCents ?? 0),
      payoutCents: 0,
      payFactorBps: 10_000,
      ...facts,
    };
    company.cashCents += f.profitCents - f.payoutCents;
    now += HOUR;
    listed.afterHour(company, f);
    return terms;
  };
  return {
    company,
    listed,
    engine: listed.engine,
    hour,
    notes,
    feed,
    counters,
    cash: () => cash,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const expectError = async (run: () => Promise<unknown>, key: string) => {
  await expect(run()).rejects.toSatisfy((e) => e instanceof GameError && e.key === key);
};

describe("demo: listed companies (ADR-167)", () => {
  it("a private company has no listed part", async () => {
    const s = setup({ listing: null });
    expect(await s.engine.listedCompany()).toBeNull();
    expect(s.listed.hourTerms(s.company, START)).toBeUndefined();
    expect(s.listed.reservedCents(s.company)).toBe(0);
    expect(s.listed.payoutCapBps(s.company, START)).toBe(10_000);
    await expectError(() => s.engine.companyInvest("r1", "b_obstkorb"), "not_listed");
    s.listed.afterHour(s.company, { at: START } as ListedHourFacts);
    expect(s.company.listed).toBeUndefined();
  });

  it("starts at the green line with the whole catalogue", async () => {
    const s = setup();
    const l = (await s.engine.listedCompany())!;
    expect(l.satisfaction.value).toBe(60);
    expect(l.satisfaction.zone).toBe("green");
    expect(l.reputation.value).toBe(50);
    expect(l.items).toHaveLength(BALANCE.listed.items.length);
    expect(l.items.every((i) => i.status === "none")).toBe(true);
    expect(l.hour.demandFactor).toBe(1);
    expect(l.books.stage).toBe("none");
    expect(l.board.canConvene).toBe(true);
  });

  it("research costs money, takes time and then lasts; requirements and levels hold", async () => {
    const s = setup();
    await expectError(() => s.engine.companyInvest("a", "r_quality_2"), "item_locked");
    await expectError(() => s.engine.companyInvest("a", "nope"), "item_unknown");
    const before = s.company.cashCents;
    let l = await s.engine.companyInvest("b", "r_quality_1");
    // ADR-215: 3 hours of the reference profit (at least 200 EUR/h), never the revenue or the value
    expect(before - s.company.cashCents).toBe(60_000);
    expect(l.researchStarted).toBe(1);
    expect(l.items.find((i) => i.key === "r_quality_1")!.status).toBe("running");
    expect(l.effects.qualityBps).toBe(0);
    await expectError(() => s.engine.companyInvest("c", "r_quality_1"), "item_running");
    s.advance(HOUR + 1);
    l = (await s.engine.listedCompany())!;
    expect(l.items.find((i) => i.key === "r_quality_1")!.status).toBe("active");
    expect(l.effects.qualityBps).toBe(300);
    expect(l.hour.qualityAdd).toBeCloseTo(0.03, 9);
    expect(s.counters.listed_research).toBe(1);
    expect(l.items.find((i) => i.key === "r_quality_2")!.missing).toEqual([]);
    // Sparforschung: half the price, three times the time; only for research
    const slow = l.items.find((i) => i.key === "r_brand_1")!;
    expect(slow.slowCostCents).toBe(Math.floor(slow.costCents / 2));
    expect(slow.slowHours).toBe(3);
    await expectError(() => s.engine.companyInvest("d", "p_second", true), "invalid_argument");
    const cash = s.company.cashCents;
    l = await s.engine.companyInvest("e", "r_brand_1", true);
    expect(cash - s.company.cashCents).toBe(slow.slowCostCents);
    s.advance(HOUR + 1);
    l = (await s.engine.listedCompany())!;
    expect(l.items.find((i) => i.key === "r_brand_1")!.status).toBe("running");
  });

  it("benefits lift the mood, cost by the hour and pause when the cash is gone", async () => {
    const s = setup();
    s.company.listed = undefined;
    await s.engine.companyInvest("a", "b_obstkorb");
    let l = await s.engine.companyInvest("b", "b_homeoffice");
    expect(l.effects.satisfaction).toBe(8);
    expect(l.upkeepPerHourCents).toBe((40 + 100) * 10);
    const terms = s.hour();
    expect(terms?.costsCents).toBe(1_400);
    l = (await s.engine.listedCompany())!;
    // base 50 + benefits 8 + profitable hour 3 = 61: the mood moves 15 % of the way
    expect(l.satisfaction.target).toBe(61);
    expect(l.satisfaction.value).toBeCloseTo(60.15, 2);
    expect(l.upkeep.benefit).toBe(1_400);
    // a team action lifts the mood at once and then rests
    l = await s.engine.companyInvest("c", "x_teamevent");
    expect(l.satisfaction.value).toBeCloseTo(68.15, 2);
    await expectError(() => s.engine.companyInvest("d", "x_teamevent"), "item_running");
    // no cash: the benefits pause
    s.company.cashCents = 500;
    expect(s.hour({ profitCents: 0 })?.costsCents).toBe(400);
    l = (await s.engine.listedCompany())!;
    expect(l.items.find((i) => i.key === "b_homeoffice")!.status).toBe("paused");
    expect(l.effects.satisfaction).toBe(3);
  });

  it("a red mood lets AI workers quit", async () => {
    const s = setup();
    await s.engine.listedCompany();
    s.company.listed!.satisfaction = 5;
    for (let i = 0; i < 3; i++) s.hour({ profitCents: -1_000 });
    expect(s.company.aiWorkers).toBe(9);
    expect(s.notes.some((n) => n.startsWith("team_mood"))).toBe(true);
    // the quit is not a dismissal
    expect(s.company.listed!.layoffHeat).toBe(0);
  });

  it("a greedy founder loses reputation and with it demand; dividends bring it back", async () => {
    const s = setup();
    await s.engine.listedCompany();
    for (let i = 0; i < 10; i++) s.hour({ payoutCents: 13_333 });
    let l = (await s.engine.listedCompany())!;
    expect(l.reputation.payoutRatioBps).toBeGreaterThan(3_000);
    expect(l.reputation.drivers.greed).toBeLessThan(0);
    expect(l.reputation.value).toBeLessThan(50);
    expect(l.hour.demandFactor).toBeLessThan(1);
    expect(s.company.listing!.lastPriceCents).toBeLessThan(1_000);
    const greedy = l.reputation.value;
    const r = await s.engine.declareDividend("d", 1_000_000);
    // 60 % founder, 22 % Ingrid, the rest AI float
    expect(s.cash()).toBe(600_000);
    expect(r.dividend).toEqual({ totalCents: 1_000_000, playersCents: 820_000, floatCents: 180_000 });
    await expectError(() => s.engine.declareDividend("e", 1_000_000), "dividend_limit");
    for (let i = 0; i < 10; i++) s.hour();
    l = (await s.engine.listedCompany())!;
    expect(l.reputation.drivers.dividends).toBeGreaterThan(12);
    expect(l.reputation.value).toBeGreaterThan(greedy);
  });

  it("the books: once a day, tax on the profit, receipts for a discount, the tax office when skipped", async () => {
    const s = setup();
    await s.engine.listedCompany();
    await expectError(() => s.engine.closeCompanyBooks("a", [], false), "books_nothing");
    s.hour({ profitCents: 100_000, cogsCents: 13_333 });
    const l = (await s.engine.listedCompany())!;
    expect(l.books.canClose).toBe(true);
    expect(l.books.revenueCents).toBe(400_000);
    expect(l.books.profitCents).toBe(400_000 - 13_333 - 120_000 - 166_667);
    expect(l.books.receipts).toHaveLength(3);
    // wrong receipts: no discount, nothing worse
    const cashBefore = s.company.cashCents;
    const r = await s.engine.closeCompanyBooks("b", ["tax", "tax", "tax"], true);
    expect(r.period.taxCents).toBe(15_000);
    expect(r.period.discountCents).toBe(0);
    expect(r.paidCents).toBe(15_000);
    expect(r.period.status).toBe("paid");
    expect(cashBefore - s.company.cashCents).toBe(15_000);
    expect(r.listed.books.doneToday).toBe(true);
    await expectError(() => s.engine.closeCompanyBooks("c", [], false), "books_nothing");
    await expectError(() => s.engine.payCompanyTax("d"), "tax_nothing_due");
    // nobody does the books: reminder, late fee, estimate
    for (let i = 0; i < 61; i++) s.hour();
    const late = (await s.engine.listedCompany())!;
    expect(s.notes.filter((n) => n.startsWith("tax_office")).length).toBeGreaterThanOrEqual(3);
    expect(late.taxes.periods.some((p) => p.kind === "late_fee")).toBe(true);
    expect(late.taxes.periods.some((p) => p.closedBy === "finanzamt" && p.kind === "books" && p.penaltyCents > 0)).toBe(
      true,
    );
    expect(s.feed).toContain("tax_penalty");
    expect(late.taxes.dueCents).toBeGreaterThan(0);
    const paid = await s.engine.payCompanyTax("e");
    expect(paid.listed.taxes.dueCents).toBe(0);
    // the books show every booking
    const acc = await s.engine.companyAccounting(7);
    expect(acc.totals.revenue).toBeGreaterThan(0);
    expect(acc.totals.tax).toBeLessThan(0);
    expect(acc.totals.penalty).toBeLessThan(0);
    expect(acc.entries.length).toBeGreaterThan(0);
    expect(acc.entries[0]!.id).toBeGreaterThan(acc.entries.at(-1)!.id);
  });

  it("the tax advisor does the books and pays", async () => {
    const s = setup();
    const l = await s.engine.setTaxAdvisor("a", true);
    expect(l.taxes.advisor).toBe(true);
    const terms = s.hour({ profitCents: 100_000, cogsCents: 13_333 });
    expect(terms?.costsCents).toBe(BALANCE.listed.taxes.advisor.minWageCentsPerHour);
    const after = (await s.engine.listedCompany())!;
    expect(after.taxes.periods[0]!.closedBy).toBe("advisor");
    expect(after.taxes.periods[0]!.status).toBe("paid");
    expect(after.taxes.dueCents).toBe(0);
    expect(after.upkeep.advisor).toBe(BALANCE.listed.taxes.advisor.minWageCentsPerHour);
  });

  it("the board: earmarked money cannot be withdrawn, caps and bans are binding", async () => {
    const s = setup();
    let board = await s.engine.companyBoard();
    expect(board.myShareBps).toBe(6_000);
    expect(board.holders.map((h) => h.shareBps)).toEqual([6_000, 2_200]);
    expect(board.canConvene).toBe(true);
    // the founder holds more than half: the motion passes at once
    board = await s.engine.proposeBoardMotion("a", null, {
      kind: "earmark",
      purpose: "research",
      amountCents: 10_000_000,
    });
    expect(board.history[0]!.status).toBe("passed");
    expect(board.budgets).toEqual([{ purpose: "research", amountCents: 10_000_000 }]);
    expect(s.listed.reservedCents(s.company)).toBe(10_000_000);
    expect(() => s.listed.withdraw(s.company, 45_000_000)).toThrow(GameError);
    expect(() => s.listed.withdraw(s.company, 40_000_000)).not.toThrow();
    // the budget pays research, and only research
    s.company.cashCents = 10_000_000;
    await expectError(() => s.engine.companyInvest("b", "p_second"), "budget_reserved");
    const l = await s.engine.companyInvest("c", "r_quality_1");
    expect(l.reservedCents).toBe(10_000_000 - 60_000);
    await expectError(() => s.engine.proposeBoardMotion("d", null, { kind: "withdraw_ban", days: 2 }), "board_limit");
    s.advance(7 * HOUR);
    board = await s.engine.proposeBoardMotion("e", null, { kind: "payout_cap", bps: 1_000, days: 3 });
    expect(board.restrictions.payoutCapBps).toBe(1_000);
    expect(s.listed.payoutCapBps(s.company, START + 8 * HOUR)).toBe(1_000);
    expect(() => s.listed.payoutCheck(s.company, 1_500)).toThrow(GameError);
    expect(() => s.listed.payoutCheck(s.company, 1_000)).not.toThrow();
    await expectError(
      () => s.engine.proposeBoardMotion("f", null, { kind: "payout_cap", bps: 1_234, days: 3 }),
      "board_limit",
    );
  });

  it("Ingrid Invest brings a payout cap when the reputation is bad; the founder can vote it down", async () => {
    const s = setup();
    await s.engine.listedCompany();
    s.company.listed!.reputation = 20;
    s.hour();
    let board = await s.engine.companyBoard();
    expect(board.motions).toHaveLength(1);
    expect(board.motions[0]!.proposer).toBe("Ingrid Invest");
    expect(board.motions[0]!.kind).toBe("payout_cap");
    // the AI float sides with her: 22 % + 18 %
    expect(board.motions[0]!.aiE6).toBe(180_000_000_000);
    expect(board.aiVotes).toBe(true);
    board = await s.engine.voteBoardMotion("a", board.motions[0]!.id, false);
    expect(board.motions).toHaveLength(0);
    expect(board.history[0]!.status).toBe("rejected");
    expect(s.counters.board_votes).toBe(1);
    await expectError(() => s.engine.voteBoardMotion("b", 999, true), "board_motion_unknown");
  });
});
