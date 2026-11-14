import { describe, expect, it } from "vitest";
import type { CompanyMoves, CompanyTask, CompanyTasks } from "@/features/game/types";
import {
  adviseTask,
  briefings,
  fromClaude,
  normalize,
  parseCommand,
  suggestMoves,
  validActions,
  warningFor,
  type MiraNames,
  type MiraState,
} from "./brain";

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
