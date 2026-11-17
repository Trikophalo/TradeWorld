import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import type { CompanyAutopilot, CompanyTasks, MyCompany } from "@/features/game/types";
import { companyHealth } from "@/lib/sim/company-health";
import { aiWageDueCents } from "@/lib/sim/startup";
import { COMPANY_SECTIONS, sectionTarget } from "../tabs";
import {
  ADVICE_RULES,
  actionEnabled,
  adviceList,
  adviceTurns,
  aiTurn,
  autopilotTurn,
  nextTurn,
  profitTurn,
  rankAdvice,
  reportTurn,
  reputationTurn,
  revenueTurn,
  sectionOpen,
  strengthsTurn,
  type AdviceRule,
} from "./advisor";
import { briefings, examples, parseCommand, type MiraAction, type MiraNames, type MiraState } from "./brain";
import { companyFacts, factsForClaude } from "./facts";

/*
 * Mira's advice (ADR-185): every rule with facts that make it true and false, the numbers it names, the links it
 * offers (existing, shown, the action there enabled) and the questions she answers.
 */
const NOW = Date.parse("2026-11-17T12:00:00Z");
const messages = JSON.parse(readFileSync(new URL("../../../../messages/de.json", import.meta.url), "utf8"));
const names: MiraNames = {
  task: (k) => k,
  move: (k) => k,
  money: (c) => `${Math.round(c / 100)} €`,
  health: { factor: (k) => k, reason: () => "", skill: (k) => k },
};

type Live = NonNullable<MyCompany["live"]>;
const live = (extra: Partial<Live> = {}): Live => ({
  lastHourAt: "2026-11-17T11:00:00Z",
  revenuePerHourCents: 40_000,
  profitPerHourCents: 5_000,
  payFactorBps: 10_000,
  todayRevenueCents: 0,
  todayProfitCents: 0,
  quarterRevenueCents: 0,
  quarterProfitCents: 0,
  contractRevenuePerHourCents: 0,
  demandPerHourCents: 40_000,
  capacityPerHourCents: 80_000,
  fixedPerHourCents: 5_000,
  aiWagesPerHourCents: 6_000,
  marketingPerHourCents: 2_000,
  founderPayoutPerHourCents: 0,
  todayFounderPayoutCents: 0,
  ...extra,
});

function company(extra: Partial<MyCompany> = {}): MyCompany {
  return {
    id: "c",
    name: "Shirtly",
    idea: "",
    sector: "tech",
    color: "#336699",
    tier: "small",
    foundedAt: "2026-11-10T00:00:00Z",
    productKey: "software",
    stage: 0,
    stages: [
      { stage: 0, reached: true, skills: [] },
      { stage: 1, reached: false, skills: [{ key: "tech_backend", coveredBy: null, coveredByAi: false }] },
    ],
    aiWorkerSkills: [],
    trainingFrom: 5,
    live: live(),
    hours: [],
    reputation: {
      value: 50,
      target: 50,
      demandFactor: 1,
      drivers: { quality: 0, delivery: 0, price: 0, wages: 0, bills: 0, crisis: 0, campaign: 0 },
      at: null,
      history: [],
    },
    closeWarnings: [],
    founderPayoutBps: 0,
    strengths: null,
    campaign: null,
    campaignCosts: { flyer: 20_000, online: 60_000, tv: 180_000 },
    priceLevel: "normal",
    contractWork: true,
    expansionLevel: 0,
    canExpand: false,
    expansionCostCents: null,
    marketFactor: 1,
    aiWageCentsPerHour: 12_000,
    cashCents: 1_000_000,
    valueCents: 0,
    unpaidCents: 0,
    distress: false,
    awarenessBps: 2_000,
    qualityBps: 6_000,
    quartersActive: 1,
    estimateLowCents: 40_000_000,
    estimateHighCents: 90_000_000,
    marketingCentsPerQuarter: 60_000,
    aiWorkers: 2,
    aiWorkerCostCents: 0,
    maxEmployees: 6,
    employees: 0,
    openPostings: 0,
    pendingApplications: 0,
    founderProductivityBps: 10_000,
    teamProductivityBps: 30_000,
    capacityCents: 0,
    nextQuarterAt: "2026-11-17T18:00:00Z",
    canUpgrade: false,
    upgradeCostCents: null,
    lastQuarter: null,
    history: [],
    payFactorBps: 10_000,
    distressQuarters: 0,
    graceQuarters: 2,
    logo: null,
    logoHidden: false,
    banner: null,
    founderHasJob: false,
    fullTimeFrom: 3,
    headcount: 2,
    listing: null,
    canGoPublic: false,
    canCapitalIncrease: false,
    ...extra,
  } as MyCompany;
}

const autopilot = (extra: Partial<CompanyAutopilot> = {}): CompanyAutopilot => ({
  on: true,
  canToggle: true,
  mood: 0.5,
  chanceBps: 9_000,
  rewardBps: 7_000,
  failPenaltyBps: 3_000,
  maxPerDay: 24,
  everyMinutes: 60,
  payFactorBps: 10_000,
  today: { done: 3, success: 2, cents: 10_000 },
  log: [],
  lastHour: {
    hourStart: "2026-11-17T11:00:00Z",
    revenueCents: 40_000,
    profitCents: 5_000,
    demandCents: 40_000,
    capacityCents: 80_000,
    aiWorkers: 2,
    aiWagesDueCents: 6_000,
    aiUtilizationBps: 10_000,
    awarenessBefore: 0.19,
    awarenessAfter: 0.2,
    awarenessParts: { wordOfMouth: 0.004, marketing: 0.008, decay: 0.002, extra: 0, cap: 0.5 },
  },
  ...extra,
});

const tasks = (extra: Partial<CompanyTasks> = {}): CompanyTasks =>
  ({
    role: "founder",
    company: { id: "c", name: "Shirtly", tier: "small", product: "software" },
    momentum: 1,
    myTier: "founder",
    autoAi: false,
    aiWorkers: 2,
    aiMinutes: 20,
    canUseAi: true,
    people: [],
    tasks: [],
    history: [],
    ...extra,
  }) as CompanyTasks;

function state(c: Partial<MyCompany> = {}, extra: Partial<MiraState> = {}): MiraState {
  const co = company(c);
  return {
    tasks: tasks(),
    moves: null,
    event: null,
    eventPitched: false,
    applications: 0,
    orders: null,
    company: co,
    autopilot: autopilot(),
    health: {
      result: companyHealth(co, BALANCE, {}),
      priceLevel: co.priceLevel,
      contractWork: co.contractWork,
      marketingCentsPerQuarter: co.marketingCentsPerQuarter,
      aiWageCentsPerHour: co.aiWageCentsPerHour,
    },
    now: NOW,
    ...extra,
  };
}

const rules = (s: MiraState) => adviceList(s, names).map((a) => a.rule);
const advice = (s: MiraState, rule: AdviceRule) => adviceList(s, names).find((a) => a.rule === rule);
const idleAuto = (util: number) =>
  autopilot({ lastHour: { ...autopilot().lastHour!, aiUtilizationBps: util } as CompanyAutopilot["lastHour"] });

/** Every option of every advice: enabled for its facts, an open link to a section that is there. */
function checkOptions(s: MiraState) {
  const facts = companyFacts(s);
  for (const a of adviceList(s, names)) {
    expect(a.options.length, a.rule).toBeGreaterThan(0);
    for (const o of a.options) {
      expect(actionEnabled(o.action, s, facts), `${a.rule}: ${JSON.stringify(o.action)}`).toBe(true);
      if (o.action.type === "open") expect(sectionOpen(o.action.section, facts)).toBe(true);
    }
  }
}

describe("company facts (ADR-185)", () => {
  it("reads money, the hour, demand, AI, awareness and reputation in the right units", () => {
    const f = companyFacts(state({}, { autopilot: idleAuto(2_000) }));
    expect(f.cash).toMatchObject({ cashCents: 1_000_000, freeCents: 1_000_000, runwayHours: null });
    expect(f.hour).toMatchObject({
      revenueCents: 40_000,
      profitCents: 5_000,
      costsCents: 35_000,
      goodsAndWagesCents: 22_000,
    });
    expect(f.demand).toMatchObject({ utilizationBps: 5_000, freeCapacityCents: 40_000, soldOut: false });
    // 2 workers at 20 % → one idle; dismissing it: 2 × 120 € × 25 % standby = 60 € against 1 × 120 € × 40 % = 48 €
    expect(f.ai).toMatchObject({ workers: 2, utilizationBps: 2_000, idle: 1 });
    expect(f.ai.idleSavingCents).toBe(aiWageDueCents(2, 2_000) - aiWageDueCents(1, 4_000));
    expect(f.awareness).toMatchObject({ points: 20, capPoints: 50, atCap: false });
    expect(f.awareness.change).toEqual({ total: 1, marketing: 0.8, wordOfMouth: 0.4, decay: 0.2, extra: 0 });
    expect(f.reputation).toMatchObject({ value: 50, demandEffectBps: 0, worst: null });
    expect(f.isListed).toBe(false);
  });

  it("calibrates the marketing estimate with what the last hour really brought", () => {
    const f = companyFacts(state());
    // the last hour: 0.8 points from marketing → the estimate now equals it; the suggestion scales alike
    expect(f.awareness.marketingGainNow).toBe(0.8);
    expect(f.awareness.marketingGainSuggested).toBeGreaterThan(0.8);
  });

  it("gives Claude only numbers that are in the facts", () => {
    const out = factsForClaude(companyFacts(state()));
    expect(out).toMatchObject({ kasse_eur: 10_000, letzte_stunde_gewinn_eur: 50, auslastung_prozent: 50 });
    for (const v of Object.values(out)) expect(["string", "number", "boolean", "object"]).toContain(typeof v);
  });

  it("knows nothing about money without the company (employee view)", () => {
    const s = state({}, { company: null, tasks: tasks({ role: "employee" }) });
    expect(companyFacts(s).known).toBe(false);
    expect(adviceList(s, names)).toEqual([]);
  });
});

describe("Mira's rules (ADR-185)", () => {
  it("knows every rule only once", () => {
    expect(new Set(ADVICE_RULES).size).toBe(ADVICE_RULES.length);
  });

  it("distress: open bills are an alarm with the deposit", () => {
    const a = advice(state({ unpaidCents: 30_000, distress: true }), "distress")!;
    expect(a).toMatchObject({ urgent: true, lines: [{ key: "advice.distress", values: { unpaid: "300 €" } }] });
    expect(a.options[0]!.action).toEqual({ type: "open", section: "money" });
    expect(advice(state(), "distress")).toBeUndefined();
  });

  it("runway: a loss that empties the cash within hours", () => {
    const s = state({ cashCents: 20_000, live: live({ profitPerHourCents: -5_000 }) });
    expect(advice(s, "runway")).toMatchObject({ urgent: true, lines: [{ values: { hours: 4, loss: "50 €" } }] });
    expect(advice(state({ live: live({ profitPerHourCents: -5_000 }) }), "runway")).toBeUndefined();
  });

  it("aiIdle: says how many stand still and what dismissing saves", () => {
    const a = advice(state({}, { autopilot: idleAuto(1_000) }), "aiIdle")!;
    expect(a.lines[0]).toMatchObject({ key: "advice.aiIdle", values: { idle: 1, workers: 2, util: 10 } });
    expect(a.options[0]!.action).toEqual({ type: "dismissAi", count: 1 });
    expect(a.impactCents).toBe(aiWageDueCents(2, 1_000) - aiWageDueCents(1, 2_000));
    expect(advice(state({}, { autopilot: idleAuto(9_000) }), "aiIdle")).toBeUndefined();
  });

  it("marketing: a budget below the suggestion, with the points it buys per hour", () => {
    const s = state({ marketingCentsPerQuarter: 0, live: live({ marketingPerHourCents: 0 }) });
    const a = advice(s, "marketing")!;
    const f = companyFacts(s);
    expect(a.lines[0]).toMatchObject({ key: "advice.marketing", values: { gain: f.awareness.marketingGainSuggested } });
    expect(a.options[0]!.action).toEqual({ type: "marketing", cents: f.awareness.suggestedMarketingCents });
    // at the suggested budget there is nothing to raise
    expect(
      advice(state({ marketingCentsPerQuarter: f.awareness.suggestedMarketingCents }), "marketing"),
    ).toBeUndefined();
  });

  it("marketingWasted: at the stage's cap marketing buys nothing", () => {
    const s = state({ awarenessBps: 5_000 });
    expect(advice(s, "marketingWasted")?.options.map((o) => o.action)).toEqual([
      { type: "marketing", cents: 0 },
      { type: "hireAi", count: 1, skill: "tech_backend" },
    ]);
    expect(advice(s, "marketing")).toBeUndefined();
    expect(advice(state(), "marketingWasted")).toBeUndefined();
  });

  it("contractWork: free capacity × 25 % × 30 % margin", () => {
    const a = advice(state({ contractWork: false }), "contractWork")!;
    expect(a.impactCents).toBe(40_000 * 0.25 * 0.3);
    expect(a.options[0]!.action).toEqual({ type: "strategy", priceLevel: "normal", contractWork: true });
    expect(advice(state(), "contractWork")).toBeUndefined();
  });

  it("premiumLow: premium below the quality customers expect", () => {
    const a = advice(state({ priceLevel: "premium", qualityBps: 3_000 }), "premiumLow")!;
    expect(a.options[0]!.action).toEqual({ type: "strategy", priceLevel: "normal", contractWork: true });
    expect(advice(state({ priceLevel: "premium", qualityBps: 8_000 }), "premiumLow")).toBeUndefined();
  });

  it("price: a better level from the diagnosis, not while the board locks the price", () => {
    const s = state({ qualityBps: 9_000, live: live({ demandPerHourCents: 90_000, capacityPerHourCents: 80_000 }) });
    const a = advice(s, "price");
    if (a) {
      expect(a.options[0]!.action).toMatchObject({ type: "strategy" });
      const locked = { ...s, listed: null };
      expect(actionEnabled(a.options[0]!.action, locked)).toBe(true);
    }
    // at the level the diagnosis finds best there is nothing to say
    const best = advice(state(), "price");
    const level = best?.options[0]!.action.type === "strategy" ? best.options[0]!.action.priceLevel : "normal";
    expect(advice(state({ priceLevel: level }), "price")).toBeUndefined();
  });

  it("soldOut: more hands while places are free, else growth", () => {
    const sold = { live: live({ demandPerHourCents: 120_000, capacityPerHourCents: 80_000 }) };
    const a = advice(state(sold), "soldOut")!;
    expect(a.lines[0]).toMatchObject({ key: "advice.soldOut", values: { missing: "400 €" } });
    expect(a.options[0]!.action).toMatchObject({ type: "hireAi", skill: null });
    const full = advice(
      state({ ...sold, headcount: 6, canExpand: true, expansionCostCents: 50_000 }),
      "soldOutFull" as never,
    );
    expect(full).toBeUndefined();
    const b = advice(state({ ...sold, headcount: 6, canExpand: true, expansionCostCents: 50_000 }), "soldOut")!;
    expect(b.lines[0]!.key).toBe("advice.soldOutFull");
    expect(b.options.map((o) => o.action.type)).toEqual(["expand"]);
    // full and nothing affordable: no button, so no advice
    expect(advice(state({ ...sold, headcount: 6 }), "soldOut")).toBeUndefined();
  });

  it("campaign: only when it pays, none while one runs or without the cash", () => {
    const a = advice(state(), "campaign")!;
    expect(a.options[0]!.action).toEqual({ type: "campaign", kind: "flyer" });
    expect(a.impactCents).toBeGreaterThan(0);
    const running = {
      id: "x",
      kind: "flyer" as const,
      startedAt: "",
      endsAt: "2026-11-17T20:00:00Z",
      costCents: 1,
      demandBps: 1,
      resonance: "solid" as const,
    };
    expect(advice(state({ campaign: running }), "campaign")).toBeUndefined();
    expect(advice(state({ cashCents: 10_000 }), "campaign")).toBeUndefined();
  });

  it("expand and upgrade: busy and profitable, with the cash", () => {
    const busy = { live: live({ demandPerHourCents: 78_000 }), canExpand: true, expansionCostCents: 300_000 };
    expect(advice(state(busy), "expand")?.options[0]!.action).toEqual({ type: "expand" });
    expect(advice(state({ ...busy, cashCents: 100_000 }), "expand")).toBeUndefined();
    expect(advice(state({ canUpgrade: true, upgradeCostCents: 1 }), "upgrade")?.options[0]!.action).toEqual({
      type: "open",
      section: "expansion",
    });
    expect(advice(state({ canUpgrade: true, live: live({ profitPerHourCents: -1 }) }), "upgrade")).toBeUndefined();
  });

  it("autopilot: off with open tasks", () => {
    const open = tasks({
      tasks: [
        {
          id: 1,
          key: "k",
          status: "open",
          valueCents: 10_000,
          dueAt: "2026-11-17T13:00:00Z",
          canDelegate: true,
        } as never,
      ],
    });
    const a = advice(state({}, { tasks: open, autopilot: autopilot({ on: false }) }), "autopilot")!;
    // 100 € × 90 % × 70 %
    expect(a.impactCents).toBe(6_300);
    expect(a.options[0]!.action).toEqual({ type: "autopilot", on: true });
    expect(advice(state({}, { tasks: open }), "autopilot")).toBeUndefined();
    expect(advice(state({}, { autopilot: autopilot({ on: false }) }), "autopilot")).toBeUndefined();
  });

  it("reputation: names the driver that takes the most and fixes it", () => {
    const rep = (drivers: Record<string, number>, value = 40) => ({
      reputation: { value, target: 35, demandFactor: 0.96, drivers, at: null, history: [] },
    });
    const a = advice(
      state({ ...rep({ price: -6, quality: 1 }), priceLevel: "premium", qualityBps: 4_000 }),
      "reputation",
    )!;
    expect(a.lines[0]).toMatchObject({ values: { driver: "price", points: 6, demand: 4, sign: "minus" } });
    expect(a.options[0]!.action).toMatchObject({ type: "strategy", priceLevel: "normal" });
    expect(advice(state(rep({ bills: -6 })), "reputation")!.options[0]!.action).toEqual({
      type: "open",
      section: "money",
    });
    expect(advice(state(rep({ quality: -1 })), "reputation")).toBeUndefined();
  });

  it("strengths: the next reward when it is close", () => {
    const strengths = {
      scores: { awareness: 30, quality: 60, delivery: 60, margin: 50, team: 60, finance: 60 },
      overall: 47,
      hours: 10,
      rewardBps: 0,
      next: { at: 50, bps: 200 },
      closeError: null,
    };
    const a = advice(state({ strengths }), "strengths")!;
    // 2 % of 400 € revenue
    expect(a.impactCents).toBe(800);
    expect(a.lines[0]).toMatchObject({ values: { weakest: "awareness", at: 50, bonus: 2 } });
    expect(advice(state({ strengths: { ...strengths, overall: 30 } }), "strengths")).toBeUndefined();
  });

  it("interview and IPO: links to the places where they happen", () => {
    const interview = { status: "requested", expiresAt: "2026-11-17T13:00:00Z" } as never;
    expect(advice(state({}, { interview }), "interview")!.options[0]!.action).toEqual({
      type: "open",
      section: "interview",
    });
    expect(advice(state({ canGoPublic: true }), "ipo")!.options[0]!.action).toEqual({
      type: "open",
      section: "capital",
    });
    expect(rules(state())).not.toContain("ipo");
  });

  it("loss: the biggest cost with the best fixes", () => {
    const s = state(
      { contractWork: false, live: live({ profitPerHourCents: -3_000 }) },
      { autopilot: idleAuto(1_000) },
    );
    const a = advice(s, "loss")!;
    expect(a.lines[0]).toMatchObject({ values: { loss: "30 €", item: "goods" } });
    expect(a.options.length).toBeGreaterThan(0);
  });

  it("ranks alarms first, then by money per hour, and posts only the best few", () => {
    const s = state({ unpaidCents: 1, contractWork: false }, { autopilot: idleAuto(1_000) });
    const ranked = rankAdvice(adviceList(s, names));
    expect(ranked[0]!.rule).toBe("distress");
    for (let i = 2; i < ranked.length; i++)
      if (!ranked[i]!.urgent) expect(ranked[i - 1]!.impactCents).toBeGreaterThanOrEqual(ranked[i]!.impactCents);
    expect(adviceTurns(s, names).length).toBeLessThanOrEqual(1 + BALANCE.companyAssistant.advice.briefings);
  });

  it("every offered button works for its facts, across many situations", () => {
    for (const c of [
      {},
      { contractWork: false },
      { unpaidCents: 5_000, distress: true },
      { awarenessBps: 5_000 },
      { marketingCentsPerQuarter: 0 },
      { priceLevel: "premium" as const, qualityBps: 3_000 },
      { live: live({ demandPerHourCents: 120_000 }), headcount: 6, canExpand: true, expansionCostCents: 10_000 },
      { live: live({ profitPerHourCents: -20_000 }), cashCents: 30_000 },
      { canUpgrade: true, canGoPublic: true },
    ])
      checkOptions(state(c, { autopilot: idleAuto(1_000) }));
  });

  it("briefings post no button that would fail", () => {
    const s = state({ contractWork: false, marketingCentsPerQuarter: 0 }, { autopilot: idleAuto(1_000) });
    for (const t of briefings(s, names)) for (const o of t.options) expect(actionEnabled(o.action, s)).toBe(true);
  });
});

describe("Mira's links (ADR-185)", () => {
  const src = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? src(p) : p.endsWith(".tsx") ? [readFileSync(p, "utf8")] : [];
    });
  const code = src(new URL("../", import.meta.url).pathname).join("\n");

  it("every section of tabs.ts is an element on the company page", () => {
    for (const section of COMPANY_SECTIONS) {
      const t = sectionTarget(section);
      const id = t.target ?? (t.section ? t.section : null);
      if (!id) continue;
      const found = code.includes(`id="${id}"`) || code.includes(`id: "${id}"`) || code.includes(`id="section-${id}"`);
      expect(found, `${section} → ${id}`).toBe(true);
    }
  });

  it("every place Mira links to resolves and has a label", () => {
    const label: string = messages.mira.open.label;
    const used = new Set<string>();
    const scan = (s: MiraState) => {
      for (const a of adviceList(s, names))
        for (const o of a.options) if (o.action.type === "open") used.add(o.action.section);
    };
    scan(state({ unpaidCents: 1 }));
    scan(
      state(
        { canUpgrade: true, canGoPublic: true },
        { interview: { status: "requested", expiresAt: "2026-11-17T13:00:00Z" } as never },
      ),
    );
    scan(
      state(
        { reputation: { value: 30, target: 20, demandFactor: 0.9, drivers: { crisis: -6 }, at: null, history: [] } },
        { event: { id: "e", polarity: "crisis", headline: null } },
      ),
    );
    expect(used.size).toBeGreaterThan(3);
    for (const s of used) {
      expect(COMPANY_SECTIONS).toContain(s);
      expect(label).toContain(`${s} {`);
    }
  });

  it("hides listed places, trainings and every money lever from what is not there", () => {
    const f = companyFacts(state());
    expect(sectionOpen("books", f)).toBe(false);
    expect(sectionOpen("dividends", f)).toBe(false);
    expect(sectionOpen("training", f)).toBe(false);
    expect(sectionOpen("money", f)).toBe(true);
    expect(sectionOpen("nowhere", f)).toBe(false);
    const employee = companyFacts(state({}, { tasks: tasks({ role: "employee" }) }));
    expect(sectionOpen("money", employee)).toBe(false);
    expect(sectionOpen("tasks", employee)).toBe(true);
    const actions: MiraAction[] = [
      { type: "marketing", cents: 60_000 },
      { type: "strategy", priceLevel: "normal", contractWork: true },
      { type: "hireAi", count: 5, skill: null },
      { type: "dismissAi", count: 3 },
      { type: "expand" },
      { type: "autopilot", on: true },
    ];
    // all unchanged, too many or impossible here
    for (const a of actions) expect(actionEnabled(a, state()), JSON.stringify(a)).toBe(false);
  });
});

describe("Mira's answers (ADR-185)", () => {
  const intent = (text: string) => parseCommand(text, state(), names).kind;

  it("reads the new questions", () => {
    expect(intent("Warum mache ich Verlust?")).toBe("profit");
    expect(intent("Wieso ist mein Gewinn negativ")).toBe("profit");
    expect(intent("Wie mache ich mehr Umsatz?")).toBe("revenue");
    expect(intent("Was soll ich als Nächstes tun?")).toBe("next");
    expect(intent("Lagebericht")).toBe("report");
    expect(intent("Was bringt der Ruf?")).toBe("reputation");
    expect(intent("Was bringen die Stärken?")).toBe("strengths");
    expect(intent("Lohnen sich meine KI-Kräfte?")).toBe("ai");
    expect(intent("Wie läuft der Autopilot?")).toBe("autopilot");
    expect(parseCommand("Autopilot an", state(), names)).toEqual({
      kind: "actions",
      actions: [{ type: "autopilot", on: true }],
    });
    expect(parseCommand("Autopilot aus", state(), names)).toMatchObject({ actions: [{ on: false }] });
    expect(intent("Erklär mir die Bekanntheit")).toBe("health");
  });

  it("explains a loss with the hour's numbers and offers fixes", () => {
    const s = state(
      { contractWork: false, live: live({ profitPerHourCents: -3_000 }) },
      { autopilot: idleAuto(1_000) },
    );
    const turn = profitTurn(s, names);
    expect(turn.lines[0]).toEqual({ key: "profit.loss", values: { revenue: "400 €", costs: "430 €", profit: "30 €" } });
    expect(turn.lines.map((l) => l.key)).toContain("profit.aiIdle");
    expect(turn.options.length).toBeGreaterThan(0);
    for (const o of turn.options) expect(actionEnabled(o.action, s)).toBe(true);
    expect(profitTurn(state({ live: null }), names).lines[0]!.key).toBe("profit.noHour");
  });

  it("names the bottleneck for more revenue", () => {
    expect(revenueTurn(state(), names).lines[0]!.key).toBe("revenue.demand");
    expect(revenueTurn(state({ live: live({ demandPerHourCents: 99_000 }) }), names).lines[0]!.key).toBe(
      "revenue.capacity",
    );
  });

  it("explains reputation, strengths, autopilot and AI workers", () => {
    expect(reputationTurn(state(), names).lines[0]).toMatchObject({ key: "rep.what", values: { max: 20, base: 50 } });
    expect(reputationTurn(state({ reputation: null }), names).lines.at(-1)!.key).toBe("rep.none");
    expect(strengthsTurn(state(), names).lines[0]!.key).toBe("str.none");
    expect(autopilotTurn(state(), names)).toMatchObject({
      lines: [{ key: "auto.on", values: { chance: 90, done: 3 } }, { key: "auto.how" }],
      options: [{ action: { type: "autopilot", on: false } }],
    });
    expect(aiTurn(state({}, { autopilot: idleAuto(1_000) }), names).lines[1]).toMatchObject({
      key: "ai.state",
      values: { idle: 1 },
    });
  });

  it("gives a Lagebericht and the next steps", () => {
    const report = reportTurn(state(), names);
    expect(report.lines[0]).toEqual({ key: "report.title", values: { company: "Shirtly" } });
    expect(report.lines.map((l) => l.key)).toEqual(
      expect.arrayContaining(["report.cash", "report.hour", "report.demand", "report.awareness"]),
    );
    const next = nextTurn(state({ contractWork: false }), names);
    expect(next.lines[0]!.key).toBe("next.intro");
    expect(next.options.map((o) => o.action)).toContainEqual({
      type: "strategy",
      priceLevel: "normal",
      contractWork: true,
    });
    expect(examples(state(), names).map((o) => o.label.key)).toContain("examples.next");
  });

  it("every message key Mira uses exists", () => {
    const has = (key: string) =>
      key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages.mira) !== undefined;
    const s = state(
      { contractWork: false, unpaidCents: 1, awarenessBps: 5_000, canGoPublic: true },
      { autopilot: idleAuto(1_000) },
    );
    const turns = [
      ...adviceTurns(s, names),
      profitTurn(s, names),
      revenueTurn(s, names),
      reputationTurn(s, names),
      strengthsTurn(s, names),
      autopilotTurn(s, names),
      aiTurn(s, names),
      reportTurn(s, names),
      nextTurn(s, names),
    ];
    for (const t of turns) {
      for (const l of t.lines) expect(has(l.key), l.key).toBe(true);
      for (const o of t.options) {
        expect(has(o.label.key), o.label.key).toBe(true);
        if (o.hint) expect(has(o.hint.key), o.hint.key).toBe(true);
      }
    }
  });
});
