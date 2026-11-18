import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import type { ListedCompany, ListedItemState, TaxPeriod } from "@/features/game/listed-types";
import {
  canBuyItem,
  canStopItem,
  companyTodos,
  effectChips,
  gaugeAngle,
  gaugeArc,
  gaugePoint,
  historyLine,
  itemPhase,
  joinCatalogue,
  linePath,
  motionError,
  motionFields,
  motionTally,
  nextTaxDue,
  researchTree,
  sortedDrivers,
  taxPeriodState,
  upkeepShareBps,
  hourSpan,
  researchPrice,
} from "./view";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const iso = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

function states(patch: Record<string, Partial<ListedItemState>> = {}): ListedItemState[] {
  return BALANCE.listed.items.map((item) => ({
    key: item.key,
    kind: item.kind,
    status: "none",
    level: 0,
    maxLevel: item.maxLevel ?? 1,
    readyAt: null,
    cooldownUntil: null,
    costCents: item.minCostCents,
    slowCostCents: item.kind === "research" ? 0 : null,
    slowHours: item.kind === "research" ? item.hours * 3 : null,
    upkeepCents: 0,
    missing: [...(item.requires ?? [])],
    ...patch[item.key],
  }));
}

function period(patch: Partial<TaxPeriod>): TaxPeriod {
  return {
    id: 1,
    kind: "books",
    periodStart: iso(-30),
    periodEnd: iso(-6),
    revenueCents: 1_000_000,
    costsCents: 800_000,
    profitCents: 200_000,
    lossUsedCents: 0,
    taxableCents: 200_000,
    rateBps: 1_500,
    discountCents: 0,
    taxCents: 30_000,
    penaltyCents: 0,
    paidCents: 0,
    status: "due",
    closedBy: "founder",
    checkCorrect: 3,
    stage: 0,
    dueAt: iso(18),
    paidAt: null,
    ...patch,
  };
}

function listed(patch: {
  books?: Partial<ListedCompany["books"]>;
  taxes?: Partial<ListedCompany["taxes"]>;
  zone?: ListedCompany["satisfaction"]["zone"];
  toVote?: number;
  items?: ListedItemState[];
}): ListedCompany {
  return {
    books: {
      canClose: false,
      doneToday: false,
      stage: "none",
      estimatedTaxCents: 0,
      reminderAt: iso(6),
      lateFeeAt: iso(18),
      estimateAt: iso(36),
      ...patch.books,
    },
    taxes: { dueCents: 0, advisor: false, periods: [], ...patch.taxes },
    satisfaction: { zone: patch.zone ?? "green" },
    board: { toVote: patch.toVote ?? 0 },
    items: patch.items ?? states(),
  } as unknown as ListedCompany;
}

describe("effects", () => {
  it("lists effects in a fixed order and knows which direction is good", () => {
    const chips = effectChips({ fixedCostBps: -500, demandBps: 400, satisfaction: 3 });
    expect(chips.map((c) => c.key)).toEqual(["demandBps", "fixedCostBps", "satisfaction"]);
    expect(chips.every((c) => c.good)).toBe(true);
    expect(chips[2]!.unit).toBe("points");
    expect(effectChips({ capacityBps: -300 })[0]!.good).toBe(false);
    expect(effectChips({ taxRateBps: -100 })[0]!.good).toBe(true);
  });

  it("multiplies by the level", () => {
    expect(effectChips({ capacityBps: 500 }, 3)[0]!.value).toBe(1_500);
    expect(effectChips({})).toEqual([]);
  });
});

describe("catalogue", () => {
  const entries = joinCatalogue(
    BALANCE.listed.items,
    states({
      r_quality_1: { status: "active", level: 1, missing: [] },
      r_quality_2: { status: "running", readyAt: iso(2), missing: [] },
      b_obstkorb: { status: "active", level: 1, missing: [] },
      p_second: { status: "paused", level: 1, missing: [] },
      m_machines: { status: "active", level: 2, missing: [] },
      x_pizza: { cooldownUntil: iso(3), missing: [] },
      x_teamevent: { cooldownUntil: iso(-1), missing: [] },
    }),
  );
  const by = (key: string) => entries.find((e) => e.item.key === key)!;

  it("joins every catalogue item with its state", () => {
    expect(entries).toHaveLength(BALANCE.listed.items.length);
    expect(joinCatalogue(BALANCE.listed.items, [])).toEqual([]);
  });

  it("lays out the research tree: 7 branches with 4 steps in order", () => {
    const tree = researchTree(entries);
    expect(tree).toHaveLength(7);
    for (const row of tree) expect(row.steps.map((s) => s.item.tier)).toEqual([1, 2, 3, 4]);
    expect(tree.find((r) => r.branch === "quality")!.done).toBe(1);
  });

  it("knows the phase of an item", () => {
    expect(itemPhase(by("r_quality_1"), NOW)).toBe("maxed");
    expect(itemPhase(by("r_quality_2"), NOW)).toBe("running");
    expect(itemPhase(by("r_quality_3"), NOW)).toBe("locked");
    expect(itemPhase(by("r_efficiency_1"), NOW)).toBe("available");
    expect(itemPhase(by("p_second"), NOW)).toBe("paused");
    expect(itemPhase(by("m_machines"), NOW)).toBe("active");
    expect(itemPhase(by("x_pizza"), NOW)).toBe("cooldown");
    expect(itemPhase(by("x_teamevent"), NOW)).toBe("available");
  });

  it("offers buy and stop only where the rules allow it", () => {
    expect(canBuyItem(by("r_efficiency_1"), NOW)).toBe(true);
    expect(canBuyItem(by("r_quality_3"), NOW)).toBe(false);
    expect(canBuyItem(by("m_machines"), NOW)).toBe(true);
    expect(canBuyItem(by("r_quality_1"), NOW)).toBe(false);
    expect(canBuyItem(by("x_pizza"), NOW)).toBe(false);
    expect(canStopItem(by("b_obstkorb"))).toBe(true);
    expect(canStopItem(by("p_second"))).toBe(true);
    expect(canStopItem(by("r_quality_1"))).toBe(false);
    expect(canStopItem(by("m_machines"))).toBe(false);
    expect(canStopItem(by("b_kaffee"))).toBe(false);
  });

  it("puts running costs against the reference revenue", () => {
    expect(upkeepShareBps(5_000, 100_000)).toBe(500);
    expect(upkeepShareBps(5_000, 0)).toBe(0);
  });
});

describe("research price in profit (ADR-215)", () => {
  it("reads a span of hours", () => {
    expect(hourSpan(0.4)).toEqual({ unit: "lessHour" });
    expect(hourSpan(13.6)).toEqual({ unit: "hours", value: 14 });
    expect(hourSpan(47.9)).toEqual({ unit: "hours", value: 48 });
    expect(hourSpan(60)).toEqual({ unit: "days", value: 2.5 });
  });

  it("tells how much profit a price is and when it is affordable", () => {
    expect(researchPrice(1_400_000, 2_000_000, 100_000)).toEqual({
      profit: { unit: "hours", value: 14 },
      affordable: "now",
    });
    expect(researchPrice(4_000_000, 1_000_000, 50_000)).toEqual({
      profit: { unit: "days", value: 3.3 },
      affordable: { unit: "days", value: 2.5 },
    });
    expect(researchPrice(500_000, 0, -10_000)).toEqual({ profit: null, affordable: null });
    expect(researchPrice(500_000, 600_000, 0)).toEqual({ profit: null, affordable: "now" });
  });
});

describe("gauge and history", () => {
  it("points the needle from left to right", () => {
    expect(gaugeAngle(0)).toBe(-90);
    expect(gaugeAngle(50)).toBe(0);
    expect(gaugeAngle(100)).toBe(90);
    expect(gaugeAngle(140)).toBe(90);
    const left = gaugePoint(0, 100, 100, 80);
    const top = gaugePoint(50, 100, 100, 80);
    const right = gaugePoint(100, 100, 100, 80);
    expect(Math.round(left.x)).toBe(20);
    expect(Math.round(top.y)).toBe(20);
    expect(Math.round(right.x)).toBe(180);
    expect(gaugeArc(0, 100, 100, 100, 80)).toBe("M 20 100 A 80 80 0 0 1 180 100");
  });

  it("scales the history into the box", () => {
    const history = [10, 60, 100].map((satisfaction, i) => ({
      at: iso(i - 3),
      satisfaction,
      reputation: 50,
      demandFactor: 1,
      capacityFactor: 1,
      upkeepCents: 0,
    }));
    const points = historyLine(history, (p) => p.satisfaction, 200, 100);
    expect(points.map((p) => p.x)).toEqual([0, 100, 200]);
    expect(points.map((p) => p.y)).toEqual([90, 40, 0]);
    expect(linePath(points)).toBe("M 0 90 L 100 40 L 200 0");
    expect(historyLine(history.slice(0, 1), (p) => p.satisfaction, 200, 100)[0]!.x).toBe(200);
    expect(historyLine([], (p) => p.satisfaction, 200, 100)).toEqual([]);
  });

  it("sorts drivers: pushes first, pulls last, base and zeros out", () => {
    expect(sortedDrivers({ base: 50, benefits: 11, greed: -6, crisis: 0, success: 3 })).toEqual([
      { key: "benefits", value: 11 },
      { key: "success", value: 3 },
      { key: "greed", value: -6 },
    ]);
  });
});

describe("what is due", () => {
  it("has nothing to do in a calm company", () => {
    expect(companyTodos(listed({}), NOW)).toEqual([]);
  });

  it("asks for the books, louder when the tax office waits", () => {
    const open = companyTodos(listed({ books: { canClose: true, stage: "open", estimatedTaxCents: 9_000 } }), NOW);
    expect(open).toEqual([{ key: "books", tone: "normal", section: "books", amountCents: 9_000, deadline: iso(18) }]);
    expect(companyTodos(listed({ books: { canClose: true, stage: "reminder" } }), NOW)[0]!.tone).toBe("warn");
    const late = companyTodos(listed({ books: { canClose: true, stage: "late" } }), NOW)[0]!;
    expect(late.tone).toBe("urgent");
    expect(late.deadline).toBe(iso(36));
  });

  it("leaves the books to the advisor", () => {
    expect(companyTodos(listed({ books: { canClose: true, stage: "open" }, taxes: { advisor: true } }), NOW)).toEqual(
      [],
    );
  });

  it("shows taxes with their deadline and puts the urgent ones first", () => {
    const todos = companyTodos(
      listed({
        toVote: 2,
        zone: "red",
        taxes: { dueCents: 30_000, periods: [period({ id: 2, dueAt: iso(30) }), period({ id: 1, dueAt: iso(5) })] },
      }),
      NOW,
    );
    expect(todos.map((t) => t.key)).toEqual(["mood", "tax", "board"]);
    expect(todos[1]).toMatchObject({ amountCents: 30_000, deadline: iso(5), tone: "warn" });
    const overdue = companyTodos(listed({ taxes: { dueCents: 1, periods: [period({ dueAt: iso(-1) })] } }), NOW);
    expect(overdue[0]).toMatchObject({ key: "tax", tone: "urgent" });
    expect(overdue[0]!.deadline).toBeUndefined();
  });

  it("points at finished research when nothing is running", () => {
    const done = states({ r_quality_1: { status: "active", level: 1, missing: [] }, r_quality_2: { missing: [] } });
    expect(companyTodos(listed({ items: done }), NOW).map((t) => t.key)).toEqual(["research"]);
    const running = states({
      r_quality_1: { status: "active", level: 1, missing: [] },
      r_quality_2: { status: "running", readyAt: iso(1), missing: [] },
    });
    expect(companyTodos(listed({ items: running }), NOW)).toEqual([]);
  });

  it("warns about paused items", () => {
    const paused = states({ b_obstkorb: { status: "paused", level: 1, missing: [] } });
    expect(companyTodos(listed({ items: paused }), NOW)[0]).toMatchObject({ key: "paused", count: 1 });
  });

  it("finds the next tax period and its state", () => {
    expect(nextTaxDue([])).toBeNull();
    expect(nextTaxDue([period({ id: 1, dueAt: iso(9) }), period({ id: 2, dueAt: iso(3) })])!.id).toBe(2);
    expect(nextTaxDue([period({ status: "paid" })])).toBeNull();
    expect(taxPeriodState(period({}), NOW)).toBe("due");
    expect(taxPeriodState(period({ dueAt: iso(-1) }), NOW)).toBe("overdue");
    expect(taxPeriodState(period({ stage: 1 }), NOW)).toBe("overdue");
    expect(taxPeriodState(period({ stage: 2 }), NOW)).toBe("enforced");
    expect(taxPeriodState(period({ status: "paid" }), NOW)).toBe("paid");
  });
});

describe("board", () => {
  const rules = { maxDays: 7, earmarkMaxShareOfCashBps: 8_000, payoutCapStepBps: 500, minDividendCents: 10_000 };
  const board = {
    cashCents: 1_000_000,
    freeCashCents: 600_000,
    budgets: [{ purpose: "research" as const, amountCents: 400_000 }],
  };

  it("counts the votes against all shares", () => {
    const tally = motionTally({ yesE6: 250_000, noE6: 100_000, totalE6: 1_000_000 }, 3_000);
    expect(tally).toEqual({ yesBps: 2_500, noBps: 1_000, castBps: 3_500, quorumMet: true, leading: "yes" });
    expect(motionTally({ yesE6: 100_000, noE6: 100_000, totalE6: 1_000_000 }, 3_000)).toMatchObject({
      quorumMet: false,
      leading: "tie",
    });
    expect(motionTally({ yesE6: 0, noE6: 0, totalE6: 0 }, 3_000).castBps).toBe(0);
  });

  it("validates motions like the server", () => {
    expect(motionError({ kind: "earmark", purpose: "research", amountCents: 800_000 }, board, rules)).toBeNull();
    expect(motionError({ kind: "earmark", purpose: "research", amountCents: 800_001 }, board, rules)).toBe(
      "amountTooHigh",
    );
    expect(motionError({ kind: "earmark", purpose: "research", amountCents: 0 }, board, rules)).toBe("amount");
    expect(motionError({ kind: "release", purpose: "research" }, board, rules)).toBeNull();
    expect(motionError({ kind: "release", purpose: "benefits" }, board, rules)).toBe("noBudget");
    expect(motionError({ kind: "dividend", amountCents: 9_999 }, board, rules)).toBe("dividendMin");
    expect(motionError({ kind: "dividend", amountCents: 700_000 }, board, rules)).toBe("dividendMax");
    expect(motionError({ kind: "dividend", amountCents: 50_000 }, board, rules)).toBeNull();
    expect(motionError({ kind: "payout_cap", bps: 1_500, days: 3 }, board, rules)).toBeNull();
    expect(motionError({ kind: "payout_cap", bps: 1_250, days: 3 }, board, rules)).toBe("bps");
    expect(motionError({ kind: "payout_cap", bps: 1_500, days: 8 }, board, rules)).toBe("days");
    expect(motionError({ kind: "withdraw_ban", days: 0 }, board, rules)).toBe("days");
    expect(motionError({ kind: "price_level", priceLevel: "premium", days: 7 }, board, rules)).toBeNull();
    expect(motionError({ kind: "debt", amountCents: 1.5 }, board, rules)).toBe("amount");
  });

  it("knows the inputs of each kind", () => {
    expect(motionFields("earmark")).toMatchObject({ purpose: true, amount: true, days: false });
    expect(motionFields("release")).toMatchObject({ purpose: true, amount: false });
    expect(motionFields("payout_cap")).toMatchObject({ bps: true, days: true, amount: false });
    expect(motionFields("price_level")).toMatchObject({ priceLevel: true, days: true });
    expect(motionFields("debt")).toMatchObject({ amount: true, purpose: false });
  });
});
