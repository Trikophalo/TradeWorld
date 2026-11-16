import { describe, expect, it } from "vitest";
import type { CompanyMoves, CompanyTask, CompanyTasks } from "@/features/game/types";
import {
  adviseTask,
  briefings,
  analysisTurn,
  fromClaude,
  inferGoal,
  looksLikeOrder,
  orderBlock,
  orderTurn,
  planTasks,
  resultTurns,
  urgentTurns,
  normalize,
  parseCommand,
  suggestMoves,
  validActions,
  warningFor,
  healthSteps,
  healthTopic,
  healthTurn,
  type MiraAction,
  type MiraNames,
  type MiraState,
} from "./brain";
import { HEALTH_FACTORS, type CompanyHealth, type HealthFactor, type HealthFactorKey } from "@/lib/sim/company-health";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const NAMES: Record<string, string> = { pack_shirts: "T-Shirts packen", inventory: "Inventur zählen" };
const MOVES: Record<string, string> = { market_stall: "Stand auf dem Wochenmarkt", flyer: "Flyer verteilen" };
const names: MiraNames = {
  task: (k) => NAMES[k] ?? k,
  move: (k) => MOVES[k] ?? k,
  money: (c) => `${c / 100} €`,
};

function task(id: number, key: string, extra: Partial<CompanyTask> = {}): CompanyTask {
  return {
    id,
    key,
    game: "pick",
    branch: "operations",
    status: "open",
    valueCents: 40_000,
    createdAt: new Date(NOW - 60_000).toISOString(),
    dueAt: new Date(NOW + 45 * 60_000).toISOString(),
    assignee: null,
    assigneeAi: false,
    assignedBy: null,
    aiDoneAt: null,
    openedAt: null,
    mine: false,
    canDelegate: true,
    ...extra,
  };
}

function tasks(extra: Partial<CompanyTasks> = {}): CompanyTasks {
  return {
    role: "founder",
    company: { id: "c", name: "Shirtly", tier: "garage", product: "fashion" },
    myTier: "founder",
    autoAi: false,
    aiWorkers: 1,
    aiMinutes: 20,
    canUseAi: true,
    people: [
      { nickname: "Chefin", tag: null, tier: "lead", isMe: true, supervisor: null, reportsToMe: false, openTasks: 0 },
      { nickname: "Anna", tag: null, tier: "intern", isMe: false, supervisor: null, reportsToMe: true, openTasks: 0 },
      { nickname: "Bert", tag: null, tier: "junior", isMe: false, supervisor: null, reportsToMe: true, openTasks: 3 },
    ],
    tasks: [task(1, "pack_shirts"), task(2, "inventory")],
    history: [],
    ...extra,
  } as CompanyTasks;
}

const state = (extra: Partial<MiraState> = {}): MiraState => ({
  tasks: tasks(),
  moves: null,
  event: null,
  eventPitched: false,
  applications: 0,
  orders: { costCents: 120_000, nextOrderAt: null, pitches: [] },
  now: NOW,
  ...extra,
});

describe("Mira's advice", () => {
  it("recommends a free person first, warns about a busy one and a late AI", () => {
    const options = adviseTask(task(1, "pack_shirts"), state(), names);
    expect(options[0]).toMatchObject({ action: { type: "delegate", to: "Anna" }, tone: "best" });
    expect(options.find((o) => o.action.type === "delegate" && o.action.to === "Bert")?.tone).toBe("warn");

    const late = task(3, "pack_shirts", { dueAt: new Date(NOW + 5 * 60_000).toISOString() });
    const ai = adviseTask(late, state(), names).find((o) => o.action.type === "delegate" && o.action.to === "ai");
    expect(ai).toMatchObject({ tone: "warn", hint: { key: "why.aiLate" } });
  });

  it("asks before giving work to someone busy and offers the better choice", () => {
    const warn = warningFor({ type: "delegate", taskId: 1, to: "Bert" }, state(), names);
    expect(warn?.options[0]?.action).toEqual({ type: "delegate", taskId: 1, to: "Anna" });
    expect(warningFor({ type: "delegate", taskId: 1, to: "Anna" }, state(), names)).toBeNull();
  });

  it("briefs open tasks with stable ids and says when everything is calm", () => {
    const turns = briefings(state(), names);
    expect(turns.map((t) => t.id)).toEqual(["task:1:open", "task:2:open"]);
    expect(briefings(state(), names)[0]?.id).toBe(turns[0]?.id);
    const calm = briefings(state({ tasks: tasks({ tasks: [] }) }), names);
    expect(calm[0]?.id).toMatch(/^calm:/);
  });

  it("raises a crisis once until a strategy is written", () => {
    const event = { id: "e1", polarity: "crisis" as const, headline: "Streik!" };
    expect(briefings(state({ event }), names).some((t) => t.id === "event:e1")).toBe(true);
    expect(briefings(state({ event, eventPitched: true }), names).some((t) => t.id === "event:e1")).toBe(false);
  });

  it("suggests the best affordable money move and skips resting or too expensive ones", () => {
    const base = {
      branch: "sales",
      minutes: 30,
      skillBonusBps: 0,
      refundCents: 0,
      gain: 0,
      availableAt: null,
      restMinutes: 90,
    } as const;
    const moves: CompanyMoves = {
      slots: 2,
      used: 0,
      cashCents: 100_000,
      tier: "garage",
      product: "fashion",
      running: [],
      history: [],
      moves: [
        {
          ...base,
          key: "market_stall",
          kind: "cash",
          risk: "safe",
          costCents: 20_000,
          chanceBps: 8_000,
          payoutCents: 40_000,
        },
        {
          ...base,
          key: "big",
          kind: "cash",
          risk: "risky",
          costCents: 200_000,
          chanceBps: 9_000,
          payoutCents: 900_000,
        },
        {
          ...base,
          key: "resting",
          kind: "cash",
          risk: "safe",
          costCents: 1_000,
          chanceBps: 9_000,
          payoutCents: 90_000,
          availableAt: new Date(NOW + 60_000).toISOString(),
          restMinutes: 90,
        },
        {
          ...base,
          key: "flyer",
          kind: "awareness",
          risk: "safe",
          costCents: 5_000,
          chanceBps: 7_000,
          payoutCents: 0,
          gain: 0.1,
        },
      ],
    };
    expect(suggestMoves(moves, NOW).map((m) => m.key)).toEqual(["market_stall", "flyer"]);
    expect(suggestMoves({ ...moves, used: 2 }, NOW)).toEqual([]);
  });
});

describe("Mira reads commands", () => {
  it("normalizes umlauts and punctuation", () => {
    expect(normalize("Zähl die Inventur, BITTE!")).toBe("zaehl die inventur bitte");
  });

  it("gives a named task to a person, to the AI or to the player", () => {
    expect(parseCommand("Gib das Packen an Anna", state(), names)).toEqual({
      kind: "actions",
      actions: [{ type: "delegate", taskId: 1, to: "Anna" }],
    });
    expect(parseCommand("Inventur soll die KI machen", state(), names)).toEqual({
      kind: "actions",
      actions: [{ type: "delegate", taskId: 2, to: "ai" }],
    });
    expect(parseCommand("Die T-Shirts packe ich selbst", state(), names)).toEqual({
      kind: "actions",
      actions: [{ type: "play", taskId: 1 }],
    });
    expect(parseCommand("Alles an Anna", state(), names)).toMatchObject({
      actions: [
        { taskId: 1, to: "Anna" },
        { taskId: 2, to: "Anna" },
      ],
    });
  });

  it("asks back when the task or the person is missing", () => {
    expect(parseCommand("Gib das an Anna", state(), names)).toEqual({ kind: "unknown", reason: "noTask", to: "Anna" });
    expect(parseCommand("Inventur zählen", state(), names)).toEqual({ kind: "unknown", reason: "noTarget", taskId: 2 });
    expect(parseCommand("Was steht an?", state(), names)).toEqual({ kind: "status" });
    expect(parseCommand("Erzähl mir einen Witz", state(), names)).toEqual({ kind: "unknown", reason: "nothing" });
  });

  it("switches the automatic AI and starts a move by name", () => {
    expect(parseCommand("KI automatisch an", state(), names)).toEqual({
      kind: "actions",
      actions: [{ type: "autoAi", on: true }],
    });
    expect(parseCommand("Auto-KI bitte aus", state(), names)).toMatchObject({
      actions: [{ type: "autoAi", on: false }],
    });
    const moves = { moves: [{ key: "market_stall" }] } as CompanyMoves;
    expect(parseCommand("Starte den Wochenmarkt", state({ moves }), names)).toEqual({
      kind: "actions",
      actions: [{ type: "move", key: "market_stall" }],
    });
  });

  it("maps Claude's answer and drops what it invents", () => {
    const base = { task_id: null, to: null, move_key: null, text: null, kind: null, goal: null, on: null };
    expect(
      fromClaude([
        { ...base, type: "delegate", task_id: 1, to: "Anna" },
        { ...base, type: "pitch", text: "Wir verkaufen auf Festivals.", kind: "move", goal: null },
        { ...base, type: "auto_ai", on: true },
        { ...base, type: "move" },
      ]),
    ).toEqual([
      { type: "delegate", taskId: 1, to: "Anna" },
      { type: "pitch", kind: "move", text: "Wir verkaufen auf Festivals.", goal: "cash" },
      { type: "autoAi", on: true },
    ]);
  });

  it("drops actions Claude invents", () => {
    const valid = validActions(
      [
        { type: "delegate", taskId: 1, to: "Anna" },
        { type: "delegate", taskId: 1, to: "Niemand" },
        { type: "delegate", taskId: 99, to: "Anna" },
        { type: "move", key: "market_stall" },
        { type: "pitch", kind: "event", text: "Wir zahlen fairere Löhne.", goal: null },
      ],
      state(),
    );
    expect(valid).toEqual([{ type: "delegate", taskId: 1, to: "Anna" }]);
  });
});

describe("Mira's free orders, plan and reports", () => {
  it("reads the goal of an order and tells orders from questions", () => {
    expect(inferGoal("Wir machen eine Rabattaktion für Stammkunden")).toBe("cash");
    expect(inferGoal("Wir drehen ein Video für Social Media")).toBe("awareness");
    expect(inferGoal("Wir testen das Material und verbessern das Produkt")).toBe("quality");
    expect(looksLikeOrder("Wir machen eine Rabattaktion")).toBe(true);
    expect(looksLikeOrder("Was soll ich jetzt machen?")).toBe(false);
    expect(looksLikeOrder("Hallo")).toBe(false);
  });

  it("offers an order once per hour, with the inferred goal first and a warning for whitewashing", () => {
    const turn = orderTurn("Wir drehen ein Video für Social Media", state(), names);
    expect(turn.options[0]).toMatchObject({ action: { type: "pitch", kind: "move", goal: "awareness" }, tone: "best" });
    expect(turn.options).toHaveLength(3);
    const risky = orderTurn("Wir drehen einen Imagefilm und leugnen alles", state(), names);
    expect(risky.options[0]?.tone).toBe("warn");

    const waiting = state({ orders: { costCents: 120_000, nextOrderAt: NOW + 25 * 60_000, pitches: [] } });
    expect(orderBlock(waiting)).toEqual({ reason: "cooldown", minutes: 25 });
    expect(orderTurn("Wir machen eine Rabattaktion", waiting, names).options).toEqual([]);
    expect(orderBlock(state({ tasks: tasks({ role: "employee" }) }))).toEqual({ reason: "founder" });
  });

  it("plans all open tasks: free people first, then the AI, nobody overloaded", () => {
    const many = tasks({
      tasks: [task(1, "pack_shirts"), task(2, "inventory"), task(3, "pack_shirts"), task(4, "inventory")],
    });
    const plan = planTasks(state({ tasks: many }));
    // Anna takes two (then she is busy), Bert is full, the AI takes the rest in time.
    expect(plan).toEqual([
      { taskId: 1, to: "Anna" },
      { taskId: 2, to: "Anna" },
      { taskId: 3, to: "ai" },
      { taskId: 4, to: "ai" },
    ]);
    const tight = tasks({
      tasks: [task(1, "pack_shirts", { dueAt: new Date(NOW + 5 * 60_000).toISOString() })],
      people: [],
    });
    expect(planTasks(state({ tasks: tight }))).toEqual([]);
  });

  it("reports results once and raises the alarm for a task about to expire", () => {
    const history = [
      {
        id: 7,
        key: "inventory",
        status: "success" as const,
        resultCents: 40_000,
        scoreBps: 10_000,
        ai: false,
        doneBy: "Anna",
        resolvedAt: new Date(NOW - 30_000).toISOString(),
      },
      {
        id: 6,
        key: "inventory",
        status: "missed" as const,
        resultCents: -24_000,
        scoreBps: null,
        ai: false,
        doneBy: null,
        resolvedAt: new Date(NOW - 3_600_000).toISOString(),
      },
    ];
    const s = state({ tasks: tasks({ history }) });
    expect(resultTurns(s, names, NOW - 60_000).map((t) => t.id)).toEqual(["result:task:7"]);
    expect(analysisTurn(s, names).lines.map((l) => l.key)).toContain("analysis.missed");

    const soon = tasks({ tasks: [task(9, "inventory", { dueAt: new Date(NOW + 6 * 60_000).toISOString() })] });
    const alarm = urgentTurns(state({ tasks: soon }), names);
    expect(alarm[0]?.id).toBe("urgent:9");
    // The AI would be too late: not offered in the alarm.
    expect(alarm[0]?.options.some((o) => o.action.type === "delegate" && o.action.to === "ai")).toBe(false);
  });
});

// ---- Company health (ADR-162) ---------------------------------------------------------------------------------------

function factorOf(key: HealthFactorKey, extra: Partial<HealthFactor> = {}): HealthFactor {
  return {
    key,
    score: 90,
    status: "good",
    reason: { key: `${key}.x`, values: {} },
    impactCents: 0,
    levers: [],
    ...extra,
  };
}

function health(
  weak: Partial<Record<HealthFactorKey, Partial<HealthFactor>>> = {},
  weakest: HealthFactorKey = "awareness",
) {
  const result: CompanyHealth = {
    factors: HEALTH_FACTORS.map((k) => factorOf(k, weak[k])),
    weakest,
    profitPerHourCents: -5_000,
    score: 70,
    estimated: false,
  };
  return {
    result,
    priceLevel: "normal" as const,
    contractWork: false,
    marketingCentsPerQuarter: 0,
    aiWageCentsPerHour: 12_000,
  };
}

const healthNames: MiraNames = {
  ...names,
  health: { factor: (k) => `F:${k}`, reason: (f) => `R:${f.reason.key}`, skill: (k) => `S:${k}` },
};

const weakAwareness = health({
  awareness: {
    score: 20,
    status: "critical",
    impactCents: 8_000,
    levers: [
      { kind: "marketing", cents: 60_000 },
      { kind: "campaign", campaign: "flyer", costCents: 10_000 },
      { kind: "move", goal: "awareness" },
    ],
  },
});

describe("Mira and the company's health", () => {
  it("reads which factor a question is about", () => {
    expect(healthTopic("Wie steigere ich die Bekanntheit?")).toBe("awareness");
    expect(healthTopic("Wie bringe ich die Menge passend zur Nachfrage?")).toBe("capacity");
    expect(healthTopic("Wie verbessere ich die Qualität?")).toBe("quality");
    expect(healthTopic("Wie bringe ich unser Image in Ordnung?")).toBe("image");
    expect(healthTopic("Welcher Preis bringt am meisten?")).toBe("price");
    expect(healthTopic("Was fehlt meinem Team?")).toBe("team");
    expect(healthTopic("Wie bringe ich die Kasse in Ordnung?")).toBe("cash");
    expect(healthTopic("Wie bekomme ich mehr Schwung?")).toBe("momentum");
    expect(healthTopic("Wo verliere ich Geld?")).toBe("any");
    expect(healthTopic("Verteil alle Aufgaben")).toBeNull();
    expect(healthTopic("Gib T-Shirts packen an Anna")).toBeNull();
  });

  it("turns the question into a health intent before the hand-over words ('ich')", () => {
    const s = state({ health: weakAwareness });
    expect(parseCommand("Wie steigere ich die Bekanntheit?", s, healthNames)).toEqual({
      kind: "health",
      factor: "awareness",
    });
    expect(parseCommand("Was ist meine größte Schwachstelle?", s, healthNames)).toEqual({
      kind: "health",
      factor: null,
    });
    // Hand-overs still work.
    expect(parseCommand("Gib T-Shirts packen an Anna", s, healthNames).kind).toBe("actions");
  });

  it("offers concrete steps with existing actions: marketing, a campaign, a business move", () => {
    const moves: CompanyMoves = {
      slots: 2,
      used: 0,
      cashCents: 100_000,
      tier: "garage",
      product: "fashion",
      running: [],
      history: [],
      moves: [
        {
          key: "flyer",
          kind: "awareness",
          risk: "safe",
          branch: "marketing",
          minutes: 30,
          costCents: 5_000,
          chanceBps: 7_000,
          skillBonusBps: 0,
          payoutCents: 0,
          refundCents: 0,
          gain: 0.1,
          availableAt: null,
          restMinutes: 90,
        },
      ],
    };
    const s = state({ health: weakAwareness, moves });
    const steps = healthSteps("awareness", s, healthNames);
    expect(steps.map((o) => o.action)).toEqual([
      { type: "marketing", cents: 60_000 },
      { type: "campaign", kind: "flyer" },
      { type: "move", key: "flyer" },
    ]);
    expect(steps[0]?.tone).toBe("best");
    expect(
      validActions(
        steps.map((o) => o.action),
        s,
      ),
    ).toHaveLength(3);
  });

  it("answers with the reason, the hourly gain and the steps", () => {
    const turn = healthTurn("awareness", state({ health: weakAwareness }), healthNames);
    expect(turn.lines[0]).toEqual({
      key: "health.intro",
      values: { factor: "F:awareness", score: 20, reason: "R:awareness.x" },
    });
    expect(turn.lines[1]).toEqual({ key: "health.gain", values: { amount: "80 €" } });
    expect(turn.options.length).toBeGreaterThanOrEqual(2);
    // "Where do I lose money?" goes to the weakest factor.
    expect(healthTurn(null, state({ health: weakAwareness }), healthNames).lines[0]).toEqual({
      key: "health.weakest",
      values: { factor: "F:awareness" },
    });
    expect(healthTurn("awareness", state({ tasks: tasks({ role: "employee" }) }), healthNames).lines[0]?.key).toBe(
      "health.founderOnly",
    );
  });

  it("turns price, contract work, AI workers, skills and tasks into buttons", () => {
    const h = health(
      {
        capacity: {
          status: "weak",
          score: 40,
          impactCents: 3_000,
          levers: [{ kind: "contractWork" }, { kind: "dismissAi", count: 2 }],
        },
        price: { status: "weak", score: 50, impactCents: 2_000, levers: [{ kind: "price", level: "premium" }] },
        team: { status: "weak", score: 40, levers: [{ kind: "skill", skill: "sales" }, { kind: "train" }] },
        momentum: { status: "critical", score: 30, impactCents: 1_000, levers: [{ kind: "tasks", open: 2 }] },
      },
      "capacity",
    );
    const s = state({ health: h });
    expect(healthSteps("capacity", s, healthNames).map((o) => o.action)).toEqual([
      { type: "strategy", priceLevel: "normal", contractWork: true },
      { type: "dismissAi", count: 2 },
    ]);
    expect(healthSteps("price", s, healthNames)[0]?.action).toEqual({
      type: "strategy",
      priceLevel: "premium",
      contractWork: false,
    });
    expect(healthSteps("team", s, healthNames).map((o) => o.action)).toEqual([
      { type: "hireAi", count: 1, skill: "sales" },
      { type: "open", tab: "team" },
      { type: "open", tab: "team", section: "training" },
    ]);
    expect(healthSteps("momentum", s, healthNames).map((o) => o.action.type)).toEqual(["plan", "play", "autoAi"]);
  });

  it("briefs the weakest factor once it is weak or critical, with a stable id", () => {
    const turn = briefings(state({ health: weakAwareness }), healthNames).find((t) => t.id.startsWith("health:"));
    expect(turn?.id).toBe("health:awareness:critical");
    expect(turn?.lines[0]).toEqual({
      key: "health.brief",
      values: { factor: "F:awareness", reason: "R:awareness.x" },
    });
    expect(turn?.options[0]?.action).toEqual({ type: "marketing", cents: 60_000 });
    const quiet = (s: MiraState) => briefings(s, healthNames).some((t) => t.id.startsWith("health:"));
    expect(quiet(state({ health: health() }))).toBe(false);
    expect(quiet(state({ health: weakAwareness, tasks: tasks({ role: "employee" }) }))).toBe(false);
  });

  it("mentions the health in the analysis", () => {
    const turn = analysisTurn(state({ health: weakAwareness }), healthNames);
    expect(turn.lines).toContainEqual({ key: "health.summary", values: { score: 70, factor: "F:awareness" } });
    expect(turn.options[0]?.action).toEqual({ type: "marketing", cents: 60_000 });
  });

  it("only lets the founder pull the company levers", () => {
    const actions: MiraAction[] = [
      { type: "marketing", cents: 10_000 },
      { type: "strategy", priceLevel: "budget", contractWork: true },
      { type: "campaign", kind: "tv" },
      { type: "hireAi", count: 1, skill: null },
      { type: "dismissAi", count: 1 },
    ];
    expect(validActions(actions, state())).toHaveLength(5);
    expect(validActions(actions, state({ tasks: tasks({ role: "employee" }) }))).toHaveLength(0);
    expect(validActions([{ type: "hireAi", count: 0, skill: null }], state())).toHaveLength(0);
  });
});
