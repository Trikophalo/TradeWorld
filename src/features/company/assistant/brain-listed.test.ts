import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BALANCE } from "@/config/balance";
import type { DemoCompanyState } from "@/features/game/demo/company";
import { createListedEngine } from "@/features/game/demo/listed";
import type { ListedCompany } from "@/features/game/listed-types";
import type { CompanyTasks } from "@/features/game/types";
import {
  affordableItems,
  bestBenefit,
  briefings,
  describeAction,
  listedBriefings,
  validActions,
  type MiraNames,
  type MiraState,
  type MiraTurn,
} from "./brain";

const messages = JSON.parse(readFileSync(new URL("../../../../messages/de.json", import.meta.url), "utf8"));
const NOW = Date.UTC(2026, 10, 16, 9);
const names: MiraNames = {
  task: (k) => k,
  move: (k) => k,
  money: (c) => `${c / 100} €`,
  listed: { item: (k) => messages.listed.items[k]?.name ?? k },
};

/** A real listed state from the demo rules, then bent into the situation under test. */
async function listed(change: (l: ListedCompany) => void = () => undefined): Promise<ListedCompany> {
  const company = {
    id: "c",
    name: "Brezel AG",
    sector: "tech",
    tier: "ag",
    color: "#336699",
    cashCents: 50_000_000,
    unpaidCents: 0,
    aiWorkers: 10,
    listing: {
      status: "listed",
      ticker: "BRZ",
      sharesTotal: 1_000_000,
      founderShares: 600_000,
      lastPriceCents: 1_000,
      offer: null,
    },
  } as unknown as DemoCompanyState;
  const engine = createListedEngine({
    company: () => company,
    nickname: () => "Chefin",
    addCash: () => undefined,
    notify: () => undefined,
    feed: () => undefined,
    track: () => undefined,
    catchUp: () => undefined,
    idempotent: (_id, run) => run(),
    persist: () => undefined,
    now: () => NOW,
    random: () => 0.5,
  }).engine;
  const l = (await engine.listedCompany())!;
  change(l);
  return l;
}

const state = (l: ListedCompany | null, role: "founder" | "employee" = "founder"): MiraState => ({
  tasks: {
    role,
    company: { id: "c", name: "Brezel AG", tier: "ag", product: "software" },
    myTier: "founder",
    autoAi: false,
    aiWorkers: 10,
    aiMinutes: 20,
    canUseAi: true,
    people: [],
    tasks: [],
    history: [],
  } as unknown as CompanyTasks,
  moves: null,
  event: null,
  eventPitched: false,
  applications: 0,
  orders: null,
  listed: l,
  now: NOW,
});

const ids = (turns: MiraTurn[]) => turns.map((t) => t.id.split(":")[0]);

describe("Mira and the listed company (ADR-167)", () => {
  it("says nothing for a private company, an employee or a calm listed company", async () => {
    const calm = await listed();
    expect(listedBriefings(state(null), names)).toEqual([]);
    expect(listedBriefings(state(calm, "employee"), names)).toEqual([]);
    expect(listedBriefings(state(calm), names)).toEqual([]);
    expect(ids(briefings(state(calm), names))).toEqual(["calm"]);
  });

  it("reminds of open books, louder when the tax office waits, not with an advisor", async () => {
    const open = await listed((l) => {
      l.books.canClose = true;
      l.books.stage = "open";
      l.books.profitCents = 100_000;
      l.books.estimatedTaxCents = 15_000;
    });
    const turn = listedBriefings(state(open), names)[0]!;
    expect(turn.id).toBe(`books:${open.books.periodStart}:open`);
    expect(turn.lines[0]).toEqual({ key: "listed.brief.books", values: { profit: "1000 €", tax: "150 €" } });
    expect(turn.options[0]).toMatchObject({ action: { type: "open", section: "books" }, tone: "best" });
    expect(turn.options[1]).toMatchObject({
      action: { type: "advisor", hire: true },
      hint: { key: "listed.why.advisor" },
    });

    const late = await listed((l) => {
      l.books.canClose = true;
      l.books.stage = "late";
    });
    expect(listedBriefings(state(late), names)[0]!.lines[0]!.key).toBe("listed.brief.booksLate");
    expect(listedBriefings(state(late), names)[0]!.id).not.toBe(turn.id);

    const advised = await listed((l) => {
      l.books.canClose = true;
      l.taxes.advisor = true;
    });
    expect(listedBriefings(state(advised), names)).toEqual([]);
  });

  it("offers to pay a due tax when the cash is there", async () => {
    const due = await listed((l) => {
      l.taxes.dueCents = 33_250;
    });
    const turn = listedBriefings(state(due), names)[0]!;
    expect(turn.id).toBe("tax:33250:due");
    expect(turn.options[0]).toMatchObject({ action: { type: "payTax" }, tone: "best" });
    expect(validActions([{ type: "payTax" }], state(due))).toHaveLength(1);
    expect(validActions([{ type: "payTax" }], state(await listed()))).toHaveLength(0);

    const broke = await listed((l) => {
      l.taxes.dueCents = 33_250;
      l.cashCents = 100;
    });
    const short = listedBriefings(state(broke), names)[0]!;
    expect(short.lines.map((x) => x.key)).toEqual(["listed.brief.tax", "listed.brief.taxShort"]);
    expect(short.options.some((o) => o.action.type === "payTax")).toBe(false);
  });

  it("answers a bad mood with the benefit that helps most per euro, and a team action", async () => {
    const sad = await listed((l) => {
      l.satisfaction.zone = "yellow";
      l.satisfaction.value = 48;
      l.satisfaction.capacityFactor = 0.94;
    });
    const turn = listedBriefings(state(sad), names)[0]!;
    expect(turn.id).toBe("mood:yellow");
    expect(turn.lines[0]).toEqual({ key: "listed.brief.moodYellow", values: { value: 48, green: 60, capacity: 6 } });
    const best = bestBenefit(sad)!;
    expect(turn.options[0]).toMatchObject({ action: { type: "invest", key: best }, tone: "best" });
    // the best benefit beats every other affordable one in points per running cost
    const score = (key: string) => {
      const item = BALANCE.listed.items.find((i) => i.key === key)!;
      return (item.effects.satisfaction ?? 0) / Math.max(1, sad.items.find((i) => i.key === key)!.upkeepCents);
    };
    for (const other of affordableItems(sad, ["benefit"])) expect(score(best)).toBeGreaterThanOrEqual(score(other.key));
    expect(turn.options[1]).toMatchObject({ action: { type: "invest", key: "x_pizza" } });
    expect(turn.options[0]!.label.values?.item).toBe(messages.listed.items[best].name);
    expect(validActions([{ type: "invest", key: best }], state(sad))).toHaveLength(1);
    expect(validActions([{ type: "invest", key: "r_quality_2" }], state(sad))).toHaveLength(0);

    const red = await listed((l) => {
      l.satisfaction.zone = "red";
      l.freeCashCents = 0;
    });
    const alarm = listedBriefings(state(red), names)[0]!;
    expect(alarm.lines[0]!.key).toBe("listed.brief.moodRed");
    // no money: only the bonus programme (no setup price) is left, and the team tab
    expect(alarm.options.map((o) => o.action)).toEqual([
      { type: "invest", key: "b_bonus" },
      { type: "open", section: "staff" },
    ]);
  });

  it("points to board votes, finished research and greedy payouts", async () => {
    const l = await listed((x) => {
      x.board.toVote = 2;
      x.board.openMotions = 2;
      x.items.find((i) => i.key === "r_quality_1")!.status = "active";
      x.items.find((i) => i.key === "r_quality_2")!.missing = [];
      x.reputation.payoutRatioBps = 8_000;
      x.reputation.value = 44;
      x.reputation.target = 25;
      x.reputation.demandFactor = 0.976;
    });
    const turns = listedBriefings(state(l), names);
    expect(ids(turns)).toEqual(["board", "research", "greed"]);
    expect(turns[0]!.lines[0]).toEqual({ key: "listed.brief.board", values: { count: 2 } });
    expect(turns[1]!.options[0]!.action.type).toBe("invest");
    expect(turns[2]!.lines[0]).toEqual({
      key: "listed.brief.greed",
      values: { ratio: 80, reputation: 44, demand: 2 },
    });
    // a research in work: no nagging
    l.items.find((i) => i.key === "r_brand_1")!.readyAt = new Date(NOW + 1).toISOString();
    expect(ids(listedBriefings(state(l), names))).toEqual(["board", "greed"]);
  });

  it("every text Mira uses for listed companies exists", async () => {
    const all = await listed((l) => {
      l.books.canClose = true;
      l.books.stage = "reminder";
      l.taxes.dueCents = 10;
      l.satisfaction.zone = "red";
      l.board.toVote = 1;
      l.items.find((i) => i.key === "r_quality_1")!.status = "active";
      l.reputation.payoutRatioBps = 9_000;
      l.reputation.target = 10;
    });
    const turns = listedBriefings(state(all), names);
    expect(ids(turns)).toEqual(["books", "tax", "mood", "board", "research", "greed"]);
    const keys = new Set<string>();
    for (const t of turns) {
      for (const line of t.lines) keys.add(line.key);
      for (const o of t.options) {
        keys.add(o.label.key);
        if (o.hint) keys.add(o.hint.key);
      }
    }
    for (const a of [{ type: "advisor", hire: false }, { type: "payTax" }] as const)
      keys.add(describeAction(a, state(all), names).label.key);
    for (const k of [
      ...keys,
      "listed.ok.invest",
      "listed.ok.payTax",
      "listed.ok.hireAdvisor",
      "listed.ok.fireAdvisor",
    ]) {
      const text = k.split(".").reduce((node, part) => node?.[part], messages.mira);
      expect(typeof text, k).toBe("string");
    }
  });
});

describe("listed company texts", () => {
  it("every catalogue item, receipt, category and motion kind has a German text", () => {
    for (const item of BALANCE.listed.items) {
      expect(messages.listed.items[item.key]?.name, item.key).toBeTruthy();
      expect(messages.listed.items[item.key]?.description, item.key).toBeTruthy();
      expect(messages.listed.kinds[item.kind], item.kind).toBeTruthy();
      if (item.branch) expect(messages.listed.branches[item.branch], item.branch).toBeTruthy();
      for (const effect of Object.keys(item.effects)) expect(messages.listed.effects[effect], effect).toBeTruthy();
    }
    for (const r of BALANCE.listed.taxes.receipts) expect(messages.listed.receipts[r.key], r.key).toBeTruthy();
    for (const c of BALANCE.listed.taxes.receiptCategories) expect(messages.listed.categories[c], c).toBeTruthy();
    for (const k of BALANCE.listed.board.kinds) expect(messages.listed.motions[k], k).toBeTruthy();
    for (const p of BALANCE.listed.board.purposes) expect(messages.listed.purposes[p], p).toBeTruthy();
    for (const k of [
      "tax_penalty",
      "tax_audit",
      "greedy_founder",
      "mass_quit",
      "record_dividend",
      "board_revolt",
      "research_done",
    ])
      expect(messages.social.feed.kinds[k], k).toContain("{company}");
  });
});
