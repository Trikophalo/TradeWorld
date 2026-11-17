/*
 * Mira, the company assistant (ADR-138): what she reports, what she recommends and how she reads a typed command.
 * Pure: the state, the clock and the names come in, Mira's turns come out. Texts are message keys under "mira." with
 * values; the chat translates them. Every action Mira offers runs through an existing RPC, so the server stays the
 * authority.
 */
import { BALANCE } from "@/config/balance";
import { miniJudge, pitchChanceBps } from "@/features/game/demo/pitches";
import type {
  CampaignKind,
  CompanyAutopilot,
  CompanyInterview,
  CompanyMoveOption,
  CompanyMoves,
  CompanyPitch,
  CompanyTask,
  CompanyTasks,
  MyCompany,
  PitchMoveKind,
  PriceLevel,
} from "@/features/game/types";
import type { ListedCompany } from "@/features/game/listed-types";
import type { CompanyHealth, HealthFactor, HealthFactorKey, HealthLever } from "@/lib/sim/company-health";
import { itemByKey } from "@/lib/sim/listed";
import type { CompanySection } from "../tabs";
import { actionEnabled, adviceTurns, enabledOptions, reportLines } from "./advisor";
import { companyFacts } from "./facts";

const cfg = BALANCE.companyAssistant;
const taskCfg = BALANCE.companyTasks;

export type MiraAction =
  | { type: "delegate"; taskId: number; to: string }
  | { type: "play"; taskId: number }
  | { type: "move"; key: string }
  | { type: "pitch"; kind: "event" | "move"; text: string; goal: PitchMoveKind | null }
  /** Writing mode for the next message: a strategy for the crisis, or an own business move. */
  | { type: "compose"; kind: "event" | "move" }
  | { type: "autoAi"; on: boolean }
  /** Several hand-overs at once: Mira's plan for all open tasks. */
  | { type: "plan"; actions: { taskId: number; to: string }[] }
  /** A place on the company page (ADR-185: a section id of tabs.ts, checked to exist and to be shown). */
  | { type: "open"; section: CompanySection }
  /** The autopilot of the company tasks (ADR-180). */
  | { type: "autopilot"; on: boolean }
  /** The next expansion level, paid from the company's cash (ADR-083). */
  | { type: "expand" }
  /** Fills the input with an example. */
  | { type: "suggest"; text: string }
  /** Company levers (ADR-162), each one existing RPC: marketing budget per quarter, price and contract work. */
  | { type: "marketing"; cents: number }
  | { type: "strategy"; priceLevel: PriceLevel; contractWork: boolean }
  | { type: "campaign"; kind: CampaignKind }
  | { type: "hireAi"; count: number; skill: string | null }
  | { type: "dismissAi"; count: number }
  /** Listed companies (ADR-167), each one existing RPC: buy an item, pay the tax, hire the tax advisor. */
  | { type: "invest"; key: string }
  | { type: "payTax" }
  | { type: "advisor"; hire: boolean };

export interface MiraLine {
  key: string;
  values?: Record<string, string | number>;
}

export interface MiraOption {
  action: MiraAction;
  label: MiraLine;
  /** Why (or why not): shown under the label. */
  hint?: MiraLine;
  tone?: "best" | "warn" | "neutral";
  /** Already asked back: runs without another warning. */
  confirm?: boolean;
}

export interface MiraTurn {
  /** Stable id: a briefing is posted once. */
  id: string;
  lines: MiraLine[];
  options: MiraOption[];
}

export interface MiraNames {
  task: (key: string) => string;
  move: (key: string) => string;
  money: (cents: number) => string;
  /** Company health (ADR-162): factor names, their reason as a sentence and skill names. */
  health?: {
    factor: (key: HealthFactorKey) => string;
    reason: (factor: HealthFactor) => string;
    skill: (key: string) => string;
  };
  /** Listed companies (ADR-167): names of the catalogue items. */
  listed?: { item: (key: string) => string };
}

/** What Mira knows about the company's health (ADR-162), for the founder. */
export interface MiraHealth {
  result: CompanyHealth;
  priceLevel: PriceLevel;
  contractWork: boolean;
  marketingCentsPerQuarter: number;
  aiWageCentsPerHour: number;
}

export interface MiraState {
  tasks: CompanyTasks;
  moves: CompanyMoves | null;
  event: { id: string; polarity: "crisis" | "chance"; headline: string | null } | null;
  /** A strategy for the current event is already being judged or running. */
  eventPitched: boolean;
  applications: number;
  /** Free orders (ADR-139): cost, when the next one may start (ms, null = now), the last ones. Founder only. */
  orders: { costCents: number; nextOrderAt: number | null; pitches: CompanyPitch[] } | null;
  /** The eight factors of the company (ADR-162); null for employees or while loading. */
  health?: MiraHealth | null;
  /** The listed company (ADR-167); null or missing while the company is private, for employees or while loading. */
  listed?: ListedCompany | null;
  /** The company as the page shows it (ADR-185): money, hours, awareness, reputation, strengths. Founder only. */
  company?: MyCompany | null;
  /** Autopilot and the last hour's economy (ADR-180). */
  autopilot?: CompanyAutopilot | null;
  /** The latest CEO interview (ADR-173). */
  interview?: CompanyInterview | null;
  now: number;
}

const minutesLeft = (task: CompanyTask, now: number) =>
  Math.max(0, Math.round((Date.parse(task.dueAt) - now) / 60_000));

// ---- Advice for one task -------------------------------------------------------------------------------------------

/** Who could do the task, best first, each with Mira's reason. */
export function adviseTask(task: CompanyTask, state: MiraState, names: MiraNames): MiraOption[] {
  const { tasks, now } = state;
  const value = names.money(task.valueCents);
  const scored: { option: MiraOption; score: number }[] = [];
  const targets = tasks.people.filter((p) => !p.isMe && (tasks.role === "founder" || p.reportsToMe));

  if (task.canDelegate || task.mine) {
    for (const p of task.canDelegate ? targets : []) {
      const busy = p.openTasks >= cfg.busyTasks;
      scored.push({
        score: busy ? 30 - p.openTasks : 90 - p.openTasks * 10,
        option: {
          action: { type: "delegate", taskId: task.id, to: p.nickname },
          label: { key: "options.give", values: { name: p.nickname } },
          hint: busy
            ? { key: "why.busy", values: { name: p.nickname, open: p.openTasks } }
            : { key: p.openTasks === 0 ? "why.free" : "why.some", values: { name: p.nickname, open: p.openTasks } },
          tone: busy ? "warn" : "neutral",
        },
      });
    }
    // The player themself: full value, but only with an open status (or their own).
    if (task.status === "open" || task.mine) {
      scored.push({
        score: 60,
        option: {
          action: { type: "play", taskId: task.id },
          label: { key: "options.self" },
          hint: { key: "why.self", values: { value } },
          tone: "neutral",
        },
      });
    }
    if (task.canDelegate && tasks.canUseAi) {
      const late = now + tasks.aiMinutes * 60_000 > Date.parse(task.dueAt);
      scored.push({
        score: late ? 0 : 40,
        option: {
          action: { type: "delegate", taskId: task.id, to: "ai" },
          label: { key: "options.ai" },
          hint: late
            ? { key: "why.aiLate", values: { minutes: tasks.aiMinutes } }
            : {
                key: "why.ai",
                values: {
                  minutes: tasks.aiMinutes,
                  chance: Math.round(taskCfg.ai.chanceBps / 100),
                  share: Math.round(taskCfg.ai.valueBps / 100),
                },
              },
          tone: late ? "warn" : "neutral",
        },
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const options = scored.map((s) => s.option);
  const first = options[0];
  if (first && first.tone !== "warn") options[0] = { ...first, tone: "best" };
  return options;
}

/** A warning about a chosen option, or null when Mira has nothing against it. */
export function warningFor(action: MiraAction, state: MiraState, names: MiraNames): MiraTurn | null {
  if (action.type !== "delegate") return null;
  const task = state.tasks.tasks.find((t) => t.id === action.taskId);
  if (!task) return null;
  const options = adviseTask(task, state, names);
  const chosen = options.find((o) => o.action.type === "delegate" && o.action.to === action.to);
  if (!chosen || chosen.tone !== "warn") return null;
  const better = options.find((o) => o.tone === "best");
  return {
    id: `warn:${task.id}:${action.to}:${state.now}`,
    lines: [chosen.hint ?? { key: "why.risky" }, better ? { key: "warn.better" } : { key: "warn.noBetter" }],
    options: [
      ...(better ? [better] : []),
      { action, label: { key: "options.anyway" }, tone: "neutral" as const, confirm: true },
    ],
  };
}

// ---- Briefings ------------------------------------------------------------------------------------------------------

/** The best moves to suggest now: the best money move and the safest other one, both affordable and free. */
export function suggestMoves(moves: CompanyMoves, now: number): CompanyMoveOption[] {
  if (moves.used >= moves.slots) return [];
  const ready = moves.moves.filter(
    (m) => m.costCents <= moves.cashCents && (m.availableAt === null || Date.parse(m.availableAt) <= now),
  );
  const expected = (m: CompanyMoveOption) =>
    (m.chanceBps * m.payoutCents + (10_000 - m.chanceBps) * m.refundCents) / 10_000 - m.costCents;
  const cash = ready
    .filter((m) => m.kind === "cash" && expected(m) > 0)
    .sort((a, b) => expected(b) / b.minutes - expected(a) / a.minutes)[0];
  const other = ready
    .filter((m) => m.kind !== "cash")
    .sort((a, b) => (b.chanceBps * b.gain) / b.costCents - (a.chanceBps * a.gain) / a.costCents)[0];
  return [cash, other].filter((m): m is CompanyMoveOption => m !== undefined);
}

/** What Mira reports now. Ids stay the same while the thing stays the same, so each is posted once. */
export function briefings(state: MiraState, names: MiraNames): MiraTurn[] {
  const { tasks, now } = state;
  const turns: MiraTurn[] = [];

  const actionable = tasks.tasks
    .filter((t) => (t.status === "open" && t.canDelegate) || (t.mine && t.status === "assigned"))
    .slice(0, cfg.briefingTasks);
  for (const task of actionable) {
    const lines: MiraLine[] = [
      {
        key: task.mine ? "brief.myTask" : "brief.task",
        values: {
          task: names.task(task.key),
          value: names.money(task.valueCents),
          minutes: minutesLeft(task, now),
        },
      },
    ];
    const options = adviseTask(task, state, names);
    const best = options.find((o) => o.tone === "best");
    if (best?.hint)
      lines.push({ key: "brief.recommend", values: { option: best.label.values?.name ?? "" } }, best.hint);
    turns.push({ id: `task:${task.id}:${task.status}`, lines, options });
  }

  if (state.event && !state.eventPitched) {
    turns.push({
      id: `event:${state.event.id}`,
      lines: [
        {
          key: state.event.polarity === "crisis" ? "brief.crisis" : "brief.chance",
          values: { headline: state.event.headline ?? "" },
        },
        { key: "brief.eventAsk" },
      ],
      options: [
        { action: { type: "compose", kind: "event" }, label: { key: "options.writeStrategy" }, tone: "best" },
        { action: { type: "open", section: "situation" }, label: { key: "options.showEvent" } },
      ],
    });
  }

  if (state.moves && tasks.role === "founder") {
    const picks = suggestMoves(state.moves, now);
    if (picks.length > 0) {
      const free = state.moves.slots - state.moves.used;
      turns.push({
        id: `moves:${state.moves.used}:${state.moves.running.map((r) => r.id).join(",")}:${picks.map((p) => p.key).join(",")}`,
        lines: [{ key: "brief.moves", values: { free } }],
        options: [
          ...picks.map((m, i): MiraOption => ({
            action: { type: "move", key: m.key },
            label: { key: "options.move", values: { move: names.move(m.key) } },
            hint: {
              key: m.kind === "cash" ? "why.moveCash" : "why.moveGain",
              values: {
                chance: Math.round(m.chanceBps / 100),
                cost: names.money(m.costCents),
                payout: names.money(m.payoutCents),
                minutes: m.minutes,
              },
            },
            tone: i === 0 ? "best" : "neutral",
          })),
          // ADR-185: the free order only while one can start (before, it showed during the cooldown and failed).
          ...(orderBlock(state) === null ? [orderOption(state)] : []),
        ],
      });
    }
  }

  // ADR-185: advice from the company facts, ranked by what it brings; alarms first.
  const facts = companyFacts(state);
  const advice = adviceTurns(state, names, facts);
  turns.push(...advice);

  // The weakest factor, without the buttons the advice already offers.
  const health = healthBriefing(state, names);
  const offered = new Set(advice.flatMap((t) => t.options.map((o) => JSON.stringify(o.action))));
  if (health) {
    const options = health.options.filter((o) => !offered.has(JSON.stringify(o.action)));
    if (options.length > 0) turns.push({ ...health, options });
  }

  turns.push(...listedBriefings(state, names));

  if (state.applications > 0) {
    turns.push({
      id: `apps:${state.applications}`,
      lines: [{ key: "brief.applications", values: { count: state.applications } }],
      options: [
        { action: { type: "open", section: "applications" }, label: { key: "options.openTeam" }, tone: "best" },
      ],
    });
  }

  // ADR-185: no button that would fail; a briefing whose every button fails is not posted.
  const checked = turns.flatMap((t) => {
    const options = t.options.filter((o) => actionEnabled(o.action, state, facts));
    return t.options.length > 0 && options.length === 0 ? [] : [{ ...t, options }];
  });

  if (checked.length === 0) {
    checked.push({
      id: `calm:${tasks.tasks.length}`,
      lines: [{ key: "brief.calm" }, { key: "brief.examples" }],
      options: examples(state, names),
    });
  }
  return checked;
}

/** Example commands that fit the company right now. */
export function examples(state: MiraState, names: MiraNames): MiraOption[] {
  const out: MiraOption[] = [
    { action: { type: "suggest", text: "Was steht an?" }, label: { key: "examples.status" } },
    { action: { type: "suggest", text: "Wie läuft die Firma?" }, label: { key: "examples.analysis" } },
  ];
  const task = state.tasks.tasks.find((t) => t.status === "open" && t.canDelegate);
  const person = state.tasks.people.find((p) => !p.isMe);
  if (task && person) {
    const text = `Gib ${names.task(task.key)} an ${person.nickname}`;
    out.push({ action: { type: "suggest", text }, label: { key: "examples.free", values: { text } } });
  }
  if (state.tasks.role === "founder") {
    // ADR-185: the questions Mira answers from the company facts
    out.push(
      { action: { type: "suggest", text: "Was soll ich als Nächstes tun?" }, label: { key: "examples.next" } },
      { action: { type: "suggest", text: "Lagebericht" }, label: { key: "examples.report" } },
    );
    if (state.company?.live && state.company.live.profitPerHourCents < 0)
      out.push({ action: { type: "suggest", text: "Warum mache ich Verlust?" }, label: { key: "examples.profit" } });
    else
      out.push({ action: { type: "suggest", text: "Wie mache ich mehr Umsatz?" }, label: { key: "examples.revenue" } });
    out.push({
      action: { type: "suggest", text: state.tasks.autoAi ? "KI automatisch aus" : "KI automatisch an" },
      label: { key: state.tasks.autoAi ? "examples.autoOff" : "examples.autoOn" },
    });
  }
  return out;
}

// ---- Understanding a typed command ----------------------------------------------------------------------------------

export type MiraIntent =
  | { kind: "actions"; actions: MiraAction[] }
  | { kind: "status" }
  | { kind: "plan" }
  | { kind: "analysis" }
  /** A question about one of the eight factors (ADR-162); null = where the company loses the most. */
  | { kind: "health"; factor: HealthFactorKey | null }
  /** Questions answered from the company facts (ADR-185). */
  | { kind: "profit" }
  | { kind: "revenue" }
  | { kind: "next" }
  | { kind: "report" }
  | { kind: "reputation" }
  | { kind: "strengths" }
  | { kind: "autopilot" }
  | { kind: "ai" }
  | { kind: "unknown"; reason: "nothing" }
  /** A person or the AI was named, but not which task. */
  | { kind: "unknown"; reason: "noTask"; to: string }
  /** A task was named, but not who should do it. */
  | { kind: "unknown"; reason: "noTarget"; taskId: number };

/** Lower case, umlauts spelled out, only letters and digits. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const words = (text: string) => normalize(text).split(" ").filter(Boolean);
/** Little words that say nothing about which task or move is meant. */
const FILLER = new Set([
  "fuer",
  "eine",
  "einen",
  "einem",
  "einer",
  "ueber",
  "beim",
  "nach",
  "alle",
  "alles",
  "wird",
  "sind",
  "oder",
  "aber",
  "auch",
  "noch",
  "dann",
  "wenn",
  "unser",
  "unsere",
  "unseren",
  "bitte",
  "heute",
  "jetzt",
]);
const keywords = (text: string) => words(text).filter((w) => w.length >= 4 && !FILLER.has(w));
/** Word stems that match "packen", "packt", "gepackt" alike. */
const stem = (word: string) => word.slice(0, Math.max(4, Math.min(5, word.length)));

const AI_WORDS = new Set(["ki", "ai", "bot", "bots", "roboter", "maschine", "computer"]);
const ME_WORDS = new Set(["ich", "selbst", "selber"]);
const PLAN = /\b(plan|plane|verteil\w*|optimier\w*|kuemmer\w*|organisier\w*|teil\w* .*auf)\b/;
const ANALYSIS = /\b(analyse|analysier\w*|bilanz|zahlen|bericht|auswertung|statistik|wie laeuft\w*|wie stehen wir)\b/;
const STATUS = /\b(was|status|lage|hilfe|tipp|tipps|uebersicht|briefing|steht an|zu tun)\b/;
// ADR-185: questions about the company (normalized text: umlauts spelled out)
const PROFIT =
  /\b(warum|wieso|weshalb|woher)\b.*\b(verlust\w*|minus|negativ\w*|gewinn\w*|verlier\w*|kosten|rote)\b|\b(gewinn|ergebnis)\w* (ist )?(so )?(negativ|im minus|schlecht)\b|\brote zahlen\b|\bverlust machen\b|\bmache? ich verlust\b/;
const REVENUE =
  /\b(mehr|steiger\w*|erhoeh\w*|hoeher\w*|wachs\w*)\b.*\b(umsatz\w*|einnahm\w*|verdien\w*|geld|gewinn\w*|nachfrage)\b|\bmehr verdienen\b|\b(umsatz|nachfrage)\w* (steigern|erhoehen)\b/;
const NEXT =
  /\b(was soll ich|was sollte ich|was jetzt|was als naechstes|naechste\w* schritt\w*|was tun|wie weiter|was empfiehlst|empfehlung\w*|womit anfangen|was ist am wichtigsten)\b/;
const REPORT = /\b(lagebericht|lage bericht|lagebild|zusammenfassung|ueberblick|stand der dinge|wie steht es)\b/;
const REPUTATION = /\b(ruf|rufs|reputation|ansehen)\b/;
const STRENGTHS = /\b(staerke\w*|staerken\w*|bonus)\b/;
const AUTOPILOT = /\bautopilot\w*\b/;
const AI_STAFF = /\b(ki kraft|ki kraefte|ki mitarbeiter\w*|ki arbeiter\w*|ki angestellt\w*|ki auslastung)\b/;
const ON = /\b(an|ein|einschalt\w*|aktivier\w*|starte?)\b/;
const OFF = /\b(aus|stopp|stop|abschalt\w*|ausschalt\w*|deaktivier\w*)\b/;

function matchTask(text: string, candidates: CompanyTask[], names: MiraNames): CompanyTask | null {
  const said = new Set(
    words(text)
      .filter((w) => w.length >= 4)
      .map(stem),
  );
  let best: { task: CompanyTask; hits: number } | null = null;
  for (const task of candidates) {
    const hits = keywords(names.task(task.key)).filter((w) => said.has(stem(w))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { task, hits };
  }
  return best?.task ?? null;
}

function matchMove(text: string, moves: CompanyMoves, names: MiraNames): CompanyMoveOption | null {
  const said = new Set(
    words(text)
      .filter((w) => w.length >= 4)
      .map(stem),
  );
  let best: { move: CompanyMoveOption; hits: number } | null = null;
  for (const move of moves.moves) {
    const hits = keywords(names.move(move.key)).filter((w) => said.has(stem(w))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { move, hits };
  }
  return best?.move ?? null;
}

/**
 * Reads a command like "Gib das Packen an Anna", "Mach ich selbst", "Alles an die KI", "Starte den Wochenmarkt",
 * "KI automatisch an". Returns null-free intents; "unknown" goes to Claude when available.
 */
export function parseCommand(text: string, state: MiraState, names: MiraNames): MiraIntent {
  const norm = ` ${normalize(text)} `;
  const list = words(text);
  if (list.length === 0) return { kind: "unknown", reason: "nothing" };

  if (/\b(automatisch|auto)\b/.test(norm) && list.some((w) => AI_WORDS.has(w))) {
    const off = /\b(aus|stopp|stop|nicht|kein|keine|deaktivier\w*|abschalt\w*)\b/.test(norm);
    return { kind: "actions", actions: [{ type: "autoAi", on: !off }] };
  }

  // ADR-185: the autopilot by word, and questions about the company before any hand-over is read.
  if (AUTOPILOT.test(norm)) {
    if (!text.includes("?") && !/\b(was|wie|warum|wieso|lohnt|bringt)\b/.test(norm)) {
      if (OFF.test(norm)) return { kind: "actions", actions: [{ type: "autopilot", on: false }] };
      if (ON.test(norm)) return { kind: "actions", actions: [{ type: "autopilot", on: true }] };
    }
    return { kind: "autopilot" };
  }
  if (REPORT.test(norm)) return { kind: "report" };
  if (PROFIT.test(norm)) return { kind: "profit" };
  if (NEXT.test(norm)) return { kind: "next" };
  if (REVENUE.test(norm)) return { kind: "revenue" };
  if (AI_STAFF.test(norm) && !/\b(gib|geb\w*|uebergib|an die)\b/.test(norm)) return { kind: "ai" };
  if (REPUTATION.test(norm)) return { kind: "reputation" };
  if (STRENGTHS.test(norm)) return { kind: "strengths" };

  const open = state.tasks.tasks.filter((t) => t.status === "open" && t.canDelegate);
  const mine = state.tasks.tasks.filter((t) => t.mine && t.status === "assigned");
  const person = state.tasks.people.find((p) => !p.isMe && list.includes(normalize(p.nickname)));

  // "Wie steigere ich die Bekanntheit?": a question about a factor of the company, not a hand-over.
  const topic = person ? null : healthTopic(text);
  if (topic !== null) return { kind: "health", factor: topic === "any" ? null : topic };
  const toAi = list.some((w) => AI_WORDS.has(w));
  const toMe = list.some((w) => ME_WORDS.has(w));
  const all = /\b(alle|alles|jede|jeden)\b/.test(norm);

  // A business move by name ("Starte den Wochenmarkt")
  if (state.moves && !person && !toAi && /\b(start\w*|zug)\b/.test(norm)) {
    const move = matchMove(text, state.moves, names);
    if (move) return { kind: "actions", actions: [{ type: "move", key: move.key }] };
  }

  const target = person ? person.nickname : toAi ? "ai" : toMe ? "me" : null;
  if (target) {
    const pool = target === "me" ? [...mine, ...open] : open;
    const tasks = all ? pool : [matchTask(text, pool, names) ?? (pool.length === 1 ? pool[0]! : null)];
    const picked = tasks.filter((t): t is CompanyTask => t !== null);
    if (picked.length === 0)
      return pool.length === 0
        ? { kind: "unknown", reason: "nothing" }
        : { kind: "unknown", reason: "noTask", to: target };
    return {
      kind: "actions",
      actions: picked.map((t) =>
        target === "me" ? { type: "play", taskId: t.id } : { type: "delegate", taskId: t.id, to: target },
      ),
    };
  }

  if (PLAN.test(norm)) return { kind: "plan" };
  if (ANALYSIS.test(norm)) return { kind: "analysis" };
  if (STATUS.test(norm)) return { kind: "status" };
  const named = matchTask(text, [...mine, ...open], names);
  // Only a short message is about a task; a long one that happens to share a word is a wish, not a hand-over.
  if (named && list.length <= 5) return { kind: "unknown", reason: "noTarget", taskId: named.id };
  return { kind: "unknown", reason: "nothing" };
}

/**
 * Checks actions (typed or from Claude) against the current state: unknown tasks, people or moves, and anything the
 * page would not allow right now (ADR-185: the same check as every button Mira shows), are dropped.
 */
export function validActions(actions: readonly MiraAction[], state: MiraState): MiraAction[] {
  const facts = companyFacts(state);
  return actions.filter((a) => {
    if (a.type === "pitch") {
      const n = a.text.trim().length;
      if (n < BALANCE.pitches.minChars || n > BALANCE.pitches.maxChars) return false;
    }
    return actionEnabled(a, state, facts);
  });
}

/** An option for an action (from a command or from Claude), labelled with the task, the person or the move. */
export function describeAction(action: MiraAction, state: MiraState, names: MiraNames): MiraOption {
  const taskName = (id: number) => {
    const t = state.tasks.tasks.find((x) => x.id === id);
    return t ? names.task(t.key) : "?";
  };
  switch (action.type) {
    case "delegate":
      return action.to === "ai"
        ? { action, label: { key: "options.aiTask", values: { task: taskName(action.taskId) } } }
        : { action, label: { key: "options.giveTask", values: { name: action.to, task: taskName(action.taskId) } } };
    case "play":
      return { action, label: { key: "options.selfTask", values: { task: taskName(action.taskId) } } };
    case "move":
      return { action, label: { key: "options.move", values: { move: names.move(action.key) } } };
    case "pitch":
      return action.kind === "event"
        ? { action, label: { key: "options.pitchEvent" }, hint: { key: "why.pitch", values: { text: action.text } } }
        : orderConfirm(action.text, action.goal ?? inferGoal(action.text), state, names, "best");
    case "autoAi":
      return { action, label: { key: action.on ? "options.autoOn" : "options.autoOff" } };
    case "plan":
      return { action, label: { key: "options.runPlan", values: { count: action.actions.length } }, tone: "best" };
    case "compose":
      return { action, label: { key: action.kind === "event" ? "options.writeStrategy" : "options.ownMove" } };
    case "open":
      return { action, label: { key: "open.label", values: { section: action.section } } };
    case "autopilot":
      return { action, label: { key: action.on ? "options.autopilotOn" : "options.autopilotOff" } };
    case "expand":
      return {
        action,
        label: {
          key: "options.expand",
          values: { cost: names.money(state.company?.expansionCostCents ?? 0) },
        },
      };
    case "suggest":
      return { action, label: { key: "examples.free", values: { text: action.text } } };
    case "marketing":
      return action.cents > 0
        ? { action, label: { key: "health.options.marketing", values: { amount: names.money(action.cents) } } }
        : { action, label: { key: "health.options.marketingStop" } };
    case "strategy":
      return action.contractWork && (state.company?.contractWork ?? state.health?.contractWork) === false
        ? { action, label: { key: "health.options.contractOn" } }
        : { action, label: { key: "health.options.price", values: { level: action.priceLevel } } };
    case "campaign":
      return { action, label: { key: "health.options.campaign", values: { kind: action.kind } } };
    case "hireAi":
      return action.skill
        ? {
            action,
            label: {
              key: "health.options.hireAiSkill",
              values: { skill: names.health?.skill(action.skill) ?? action.skill },
            },
          }
        : { action, label: { key: "health.options.hireAi", values: { count: action.count } } };
    case "dismissAi":
      return { action, label: { key: "health.options.dismissAi", values: { count: action.count } } };
    case "invest":
      return investOption(action.key, state, names);
    case "payTax":
      return {
        action,
        label: { key: "listed.options.payTax", values: { amount: names.money(state.listed?.taxes.dueCents ?? 0) } },
      };
    case "advisor":
      return {
        action,
        label: { key: action.hire ? "listed.options.hireAdvisor" : "listed.options.fireAdvisor" },
        hint: action.hire
          ? { key: "listed.why.advisor", values: { wage: names.money(state.listed?.taxes.advisorWageCents ?? 0) } }
          : undefined,
      };
  }
}

// ---- Listed companies (ADR-167): books, taxes, mood, board, research ------------------------------------------------

const itemName = (key: string, names: MiraNames) => names.listed?.item(key) ?? key;

function investOption(
  key: string,
  state: MiraState,
  names: MiraNames,
  tone: MiraOption["tone"] = "neutral",
): MiraOption {
  const item = state.listed?.items.find((i) => i.key === key);
  return {
    action: { type: "invest", key },
    label: { key: "listed.options.invest", values: { item: itemName(key, names) } },
    hint: item
      ? {
          key: item.upkeepCents > 0 ? "listed.why.costUpkeep" : "listed.why.cost",
          values: { cost: names.money(item.costCents), upkeep: names.money(item.upkeepCents) },
        }
      : undefined,
    tone,
  };
}

/** Items of a kind the company could start right now and pay from its free cash, cheapest first. */
export function affordableItems(listed: ListedCompany, kinds: readonly string[]): ListedCompany["items"] {
  return listed.items
    .filter((i) => kinds.includes(i.kind) && i.status === "none" && i.missing.length === 0)
    .filter((i) => i.readyAt === null && i.cooldownUntil === null && i.costCents <= listed.freeCashCents)
    .sort((a, b) => a.costCents - b.costCents);
}

/** The benefit that lifts the mood most per euro of running cost, among those the cash can pay. */
export function bestBenefit(listed: ListedCompany): string | null {
  const score = (key: string, upkeep: number) => (itemByKey(key)?.effects.satisfaction ?? 0) / Math.max(1, upkeep);
  const picks = affordableItems(listed, ["benefit"]).sort(
    (a, b) => score(b.key, b.upkeepCents) - score(a.key, a.upkeepCents),
  );
  return picks[0]?.key ?? null;
}

/**
 * What Mira reports about a listed company: open books, taxes due, a bad mood, motions waiting for a vote, finished
 * research and greedy payouts. Founder only. Ids change with the thing, so each is posted once.
 */
export function listedBriefings(state: MiraState, names: MiraNames): MiraTurn[] {
  const l = state.listed;
  if (!l || state.tasks.role !== "founder") return [];
  const turns: MiraTurn[] = [];
  const open = (section: CompanySection): MiraAction => ({ type: "open", section });

  // books: once they can be closed; louder when the tax office is waiting
  if (l.books.canClose && !l.taxes.advisor) {
    const stage = l.books.stage === "late" || l.books.stage === "estimate" ? "late" : l.books.stage;
    turns.push({
      id: `books:${l.books.periodStart}:${stage}`,
      lines: [
        {
          key:
            stage === "late"
              ? "listed.brief.booksLate"
              : stage === "reminder"
                ? "listed.brief.booksReminder"
                : "listed.brief.books",
          values: { profit: names.money(l.books.profitCents), tax: names.money(l.books.estimatedTaxCents) },
        },
      ],
      options: [
        { action: open("books"), label: { key: "listed.options.openBooks" }, tone: "best" },
        describeAction({ type: "advisor", hire: true }, state, names),
      ],
    });
  }

  if (l.taxes.dueCents > 0) {
    const late = l.taxes.periods.some((p) => p.status === "due" && p.stage > 0);
    const canPay = l.cashCents >= l.taxes.dueCents;
    turns.push({
      id: `tax:${l.taxes.dueCents}:${late ? "late" : "due"}`,
      lines: [
        { key: late ? "listed.brief.taxLate" : "listed.brief.tax", values: { amount: names.money(l.taxes.dueCents) } },
        ...(canPay ? [] : [{ key: "listed.brief.taxShort" }]),
      ],
      options: [
        ...(canPay ? [{ ...describeAction({ type: "payTax" }, state, names), tone: "best" as const }] : []),
        { action: open("taxes"), label: { key: "listed.options.openBooks" } },
      ],
    });
  }

  if (l.satisfaction.zone !== "green") {
    const benefit = bestBenefit(l);
    const action = affordableItems(l, ["action"])[0]?.key ?? null;
    turns.push({
      id: `mood:${l.satisfaction.zone}`,
      lines: [
        {
          key: l.satisfaction.zone === "red" ? "listed.brief.moodRed" : "listed.brief.moodYellow",
          values: {
            value: Math.round(l.satisfaction.value),
            green: l.satisfaction.green,
            capacity: Math.round((1 - l.satisfaction.capacityFactor) * 100),
          },
        },
      ],
      options: [
        ...(benefit ? [investOption(benefit, state, names, "best")] : []),
        ...(action ? [investOption(action, state, names, benefit ? "neutral" : "best")] : []),
        { action: open("staff"), label: { key: "listed.options.openStaff" } },
      ],
    });
  }

  if (l.board.toVote > 0) {
    turns.push({
      id: `board:${l.board.openMotions}:${l.board.toVote}`,
      lines: [{ key: "listed.brief.board", values: { count: l.board.toVote } }],
      options: [{ action: open("board"), label: { key: "listed.options.openBoard" }, tone: "best" }],
    });
  }

  const done = l.items.filter((i) => i.kind === "research" && i.status === "active").length;
  const running = l.items.some((i) => i.kind === "research" && i.readyAt !== null);
  if (done > 0 && !running) {
    const next = affordableItems(l, ["research"])[0];
    turns.push({
      id: `research:${done}`,
      lines: [{ key: next ? "listed.brief.researchNext" : "listed.brief.researchDone", values: { count: done } }],
      options: [
        ...(next ? [investOption(next.key, state, names, "best")] : []),
        { action: open("research"), label: { key: "listed.options.openResearch" } },
      ],
    });
  }

  // greed: payouts above 30 % of the profit cost reputation, and with it customers
  if (
    l.reputation.payoutRatioBps > BALANCE.listed.reputation.greed.freeRatioBps &&
    l.reputation.target < l.reputation.value
  ) {
    turns.push({
      id: `greed:${Math.floor(l.reputation.payoutRatioBps / 2_500)}`,
      lines: [
        {
          // ADR-185: above 50 the reputation still lifts the demand; only below it costs (was: "kostet -4 %")
          key: l.reputation.demandFactor < 1 ? "listed.brief.greed" : "listed.brief.greedEarly",
          values: {
            ratio: Math.round(l.reputation.payoutRatioBps / 100),
            reputation: Math.round(l.reputation.value),
            demand: Math.abs(Math.round((l.reputation.demandFactor - 1) * 100)),
          },
        },
      ],
      options: [
        { action: open("money"), label: { key: "listed.options.openPayout" }, tone: "best" },
        { action: open("dividends"), label: { key: "listed.options.openDividends" } },
      ],
    });
  }
  return turns;
}

/** Claude's answer format (edge function company-assistant) as Mira actions. */
export interface ClaudeAction {
  type: "delegate" | "play" | "move" | "pitch" | "order" | "auto_ai";
  task_id: number | null;
  to: string | null;
  move_key: string | null;
  text: string | null;
  kind: "event" | "move" | null;
  goal: PitchMoveKind | null;
  on: boolean | null;
}

export function fromClaude(actions: readonly ClaudeAction[]): MiraAction[] {
  return actions.flatMap((a): MiraAction[] => {
    switch (a.type) {
      case "delegate":
        return a.task_id !== null && a.to ? [{ type: "delegate", taskId: a.task_id, to: a.to }] : [];
      case "play":
        return a.task_id !== null ? [{ type: "play", taskId: a.task_id }] : [];
      case "move":
        return a.move_key ? [{ type: "move", key: a.move_key }] : [];
      case "pitch":
        return a.text
          ? [
              {
                type: "pitch",
                kind: a.kind ?? "move",
                text: a.text,
                goal: a.kind === "event" ? null : (a.goal ?? "cash"),
              },
            ]
          : [];
      case "order":
        return a.text ? [{ type: "pitch", kind: "move", text: a.text, goal: a.goal ?? inferGoal(a.text) }] : [];
      case "auto_ai":
        return a.on !== null ? [{ type: "autoAi", on: a.on }] : [];
    }
  });
}

// ---- Free orders (ADR-139): one per hour, Mira carries them out ---------------------------------------------------

const GOAL_WORDS: Record<PitchMoveKind, readonly string[]> = {
  cash: [...(BALANCE.pitches.mini.good.cash ?? []), "geld", "umsatz", "einnahm", "gewinn", "preis", "verkauf", "deal"],
  awareness: [
    ...(BALANCE.pitches.mini.good.awareness ?? []),
    "bekannt",
    "reichweite",
    "marke",
    "plakat",
    "flyer",
    "tiktok",
  ],
  quality: [
    ...(BALANCE.pitches.mini.good.quality ?? []),
    "qualität",
    "besser",
    "produkt",
    "entwickl",
    "design",
    "service",
  ],
};

/** What an order is mainly after: money, awareness or quality (most matching words; money when unsure). */
export function inferGoal(text: string): PitchMoveKind {
  const t = text.toLowerCase();
  const score = (g: PitchMoveKind) => GOAL_WORDS[g].filter((w) => t.includes(w)).length;
  const goals: PitchMoveKind[] = ["cash", "awareness", "quality"];
  return goals.reduce((best, g) => (score(g) > score(best) ? g : best), "cash");
}

/** Why no order can start right now, or null. */
export function orderBlock(
  state: MiraState,
): { reason: "founder" } | { reason: "cooldown"; minutes: number } | { reason: "cash" } | null {
  const o = state.orders;
  if (!o || state.tasks.role !== "founder") return { reason: "founder" };
  if (o.nextOrderAt !== null && o.nextOrderAt > state.now)
    return { reason: "cooldown", minutes: Math.max(1, Math.ceil((o.nextOrderAt - state.now) / 60_000)) };
  if (state.moves && state.moves.cashCents < o.costCents) return { reason: "cash" };
  return null;
}

/** Free text that reads like something the company should do (not a question). */
export function looksLikeOrder(text: string): boolean {
  const t = text.trim();
  if (t.length < BALANCE.pitches.minChars || t.includes("?")) return false;
  // Talking to Mira ("Erzähl mir ...", "Hilf mir", "Kannst du ...") is not an order for the company.
  if (/\b(mir|mich|du|dich|dir)\b/i.test(t) || /^(erzähl|sag|erklär|zeig|hilf|hallo|hi|hey|danke)/i.test(t))
    return false;
  return !/^(was|wie|wer|wann|warum|wieso|wo|welche\w*|kannst|soll|sollte|ist|sind|hast|gibt)\b/i.test(t);
}

function orderConfirm(
  text: string,
  goal: PitchMoveKind,
  state: MiraState,
  names: MiraNames,
  tone: MiraOption["tone"],
): MiraOption {
  const j = miniJudge(text, goal);
  return {
    action: { type: "pitch", kind: "move", text, goal },
    label: { key: `order.go.${goal}`, values: { cost: names.money(state.orders?.costCents ?? 0) } },
    hint: {
      key: j.risky > 0 ? "order.estimateRisky" : "order.estimate",
      values: { chance: Math.round(pitchChanceBps(j.fit) / 100) },
    },
    tone: j.risky > 0 ? "warn" : tone,
    confirm: true,
  };
}

function orderOption(state: MiraState): MiraOption {
  const block = orderBlock(state);
  return {
    action: { type: "compose", kind: "move" },
    label: { key: "options.freeOrder" },
    hint:
      block?.reason === "cooldown"
        ? { key: "order.waitShort", values: { minutes: block.minutes } }
        : { key: "order.hint" },
    tone: block ? "warn" : "neutral",
  };
}

/** Mira's answer to a free order: her estimate and one tap to carry it out, or why it has to wait. */
export function orderTurn(text: string, state: MiraState, names: MiraNames): MiraTurn {
  const id = `order:${state.now}:${text.length}`;
  const block = orderBlock(state);
  if (block?.reason === "founder") return { id, lines: [{ key: "order.founderOnly" }], options: [] };
  if (block?.reason === "cooldown") {
    const picks = state.moves ? suggestMoves(state.moves, state.now) : [];
    return {
      id,
      lines: [
        { key: "order.wait", values: { minutes: block.minutes } },
        ...(picks.length > 0 ? [{ key: "order.meanwhile" }] : []),
      ],
      options: picks.map((m) => ({
        action: { type: "move", key: m.key } as MiraAction,
        label: { key: "options.move", values: { move: names.move(m.key) } },
      })),
    };
  }
  if (block?.reason === "cash")
    return {
      id,
      lines: [{ key: "order.noCash", values: { cost: names.money(state.orders?.costCents ?? 0) } }],
      options: [],
    };
  const clean = text.trim().slice(0, BALANCE.pitches.maxChars);
  const goal = inferGoal(clean);
  const others = (["cash", "awareness", "quality"] as const).filter((g) => g !== goal);
  const risky = miniJudge(clean, goal).risky > 0;
  return {
    id,
    lines: [
      { key: "order.understood", values: { text: clean } },
      { key: risky ? "order.riskyNote" : "order.note", values: { minutes: BALANCE.pitches.moveMinutes } },
    ],
    options: [
      orderConfirm(clean, goal, state, names, "best"),
      ...others.map((g) => orderConfirm(clean, g, state, names, "neutral")),
    ],
  };
}

// ---- The plan: all open tasks handed out at once -------------------------------------------------------------------

/**
 * Hands out every open task: most urgent first, each to the person with the least work; the AI takes what it can
 * finish in time once everyone is busy (each task in its queue makes it slower). What nobody can take stays with the
 * player.
 */
export function planTasks(state: MiraState): { taskId: number; to: string }[] {
  const { tasks, now } = state;
  const open = tasks.tasks
    .filter((t) => t.status === "open" && t.canDelegate)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const load = new Map(
    tasks.people
      .filter((p) => !p.isMe && (tasks.role === "founder" || p.reportsToMe))
      .map((p) => [p.nickname, p.openTasks]),
  );
  let aiQueue = tasks.tasks.filter((t) => t.status === "ai").length;
  const plan: { taskId: number; to: string }[] = [];
  for (const task of open) {
    const free = [...load.entries()].filter(([, n]) => n < cfg.busyTasks).sort((a, b) => a[1] - b[1])[0];
    if (free) {
      plan.push({ taskId: task.id, to: free[0] });
      load.set(free[0], free[1] + 1);
      continue;
    }
    const aiMinutes = (tasks.aiMinutes * (10_000 + aiQueue * taskCfg.ai.slowdownPerQueuedBps)) / 10_000;
    if (tasks.canUseAi && now + aiMinutes * 60_000 < Date.parse(task.dueAt)) {
      plan.push({ taskId: task.id, to: "ai" });
      aiQueue += 1;
    }
  }
  return plan;
}

export function planTurn(state: MiraState, names: MiraNames): MiraTurn {
  const plan = planTasks(state);
  const open = state.tasks.tasks.filter((t) => t.status === "open" && t.canDelegate);
  const id = `plan:${state.now}`;
  if (open.length === 0) return { id, lines: [{ key: "plan.nothing" }], options: [] };
  const name = (id2: number) => names.task(open.find((t) => t.id === id2)?.key ?? "?");
  const rest = open.filter((t) => !plan.some((p) => p.taskId === t.id));
  return {
    id,
    lines: [
      { key: plan.length > 0 ? "plan.intro" : "plan.none", values: { count: plan.length } },
      ...plan.map((p) => ({
        key: p.to === "ai" ? "plan.itemAi" : "plan.item",
        values: { task: name(p.taskId), name: p.to },
      })),
      ...(rest.length > 0 ? [{ key: "plan.rest", values: { count: rest.length } }] : []),
    ],
    options: [
      ...(plan.length > 0 ? [describeAction({ type: "plan", actions: plan }, state, names)] : []),
      ...rest.slice(0, 2).map((t) => describeAction({ type: "play", taskId: t.id }, state, names)),
    ],
  };
}

// ---- Analysis: how the company is doing ---------------------------------------------------------------------------

export function analysisTurn(state: MiraState, names: MiraNames): MiraTurn {
  const h = state.tasks.history;
  const lines: MiraLine[] = [];
  const options: MiraOption[] = [];
  if (h.length === 0) lines.push({ key: "analysis.noHistory" });
  else {
    const ok = h.filter((x) => x.status === "success").length;
    const net = h.reduce((sum, x) => sum + x.resultCents, 0);
    lines.push({
      key: "analysis.tasks",
      values: { ok, count: h.length, rate: Math.round((ok * 100) / h.length), net: names.money(net) },
    });
    const ai = h.filter((x) => x.ai);
    const aiOk = ai.filter((x) => x.status === "success").length;
    if (ai.length >= 2)
      lines.push({
        key: "analysis.ai",
        values: { ok: aiOk, count: ai.length, rate: Math.round((aiOk * 100) / ai.length) },
      });
    const missed = h.filter((x) => x.status === "missed").length;
    if (missed > 0) {
      lines.push({ key: "analysis.missed", values: { count: missed } });
      if (state.tasks.role === "founder" && state.tasks.canUseAi && !state.tasks.autoAi)
        options.push({ ...describeAction({ type: "autoAi", on: true }, state, names), tone: "best" });
    }
  }
  const staff = state.tasks.people.filter((p) => !p.isMe);
  const busy = staff.filter((p) => p.openTasks >= cfg.busyTasks);
  const idle = staff.filter((p) => p.openTasks === 0);
  if (staff.length === 0) {
    lines.push({ key: "analysis.noStaff" });
    if (state.tasks.role === "founder")
      options.push({ action: { type: "open", section: "team" }, label: { key: "options.hire" } });
  } else lines.push({ key: "analysis.team", values: { busy: busy.length, idle: idle.length, count: staff.length } });
  if (state.moves) {
    lines.push({
      key: "analysis.moves",
      values: { cash: names.money(state.moves.cashCents), used: state.moves.used, slots: state.moves.slots },
    });
    const done = state.moves.history;
    if (done.length >= 2) {
      const won = done.filter((m) => m.status === "success").length;
      const net = done.reduce((sum, m) => sum + m.payoutCents - m.costCents, 0);
      lines.push({ key: "analysis.moveHistory", values: { won, count: done.length, net: names.money(net) } });
    }
    const pick = suggestMoves(state.moves, state.now)[0];
    if (pick) options.push(describeAction({ type: "move", key: pick.key }, state, names));
  }
  if (state.orders && orderBlock(state) === null) options.push(orderOption(state));
  if (state.health && state.tasks.role === "founder") {
    lines.push(...healthSummary(state, names));
    options.unshift(...healthSteps(state.health.result.weakest, state, names).slice(0, 1));
  }
  if (state.tasks.tasks.some((t) => t.status === "open" && t.canDelegate))
    options.push({ action: { type: "suggest", text: "Verteil alle Aufgaben" }, label: { key: "examples.plan" } });
  // ADR-185: the Lagebericht in numbers first (founder with the company loaded); no button that would fail.
  if (state.tasks.role === "founder" && state.company) lines.unshift(...reportLines(state, names));
  return { id: `analysis:${state.now}`, lines, options: enabledOptions(options, state, companyFacts(state)) };
}

// ---- Results and alarms: Mira reports back --------------------------------------------------------------------------

/** What finished since `since` (ms): tasks, business moves and orders, each once. */
export function resultTurns(state: MiraState, names: MiraNames, since: number): MiraTurn[] {
  const turns: MiraTurn[] = [];
  for (const h of state.tasks.history) {
    if (Date.parse(h.resolvedAt) <= since) continue;
    turns.push({
      id: `result:task:${h.id}`,
      lines: [
        {
          key: `result.task.${h.status}${h.ai ? "Ai" : ""}`,
          values: { task: names.task(h.key), name: h.doneBy ?? "?", amount: names.money(Math.abs(h.resultCents)) },
        },
      ],
      options: [],
    });
  }
  for (const m of state.moves?.history ?? []) {
    if (Date.parse(m.resolvedAt) <= since) continue;
    turns.push({
      id: `result:move:${m.id}`,
      lines: [
        {
          key: `result.move.${m.status}`,
          values: { move: names.move(m.key), amount: names.money(Math.abs(m.payoutCents - m.costCents)) },
        },
      ],
      options: [],
    });
  }
  for (const p of state.orders?.pitches ?? []) {
    if (p.verdict && p.status === "running" && Date.parse(p.createdAt) > since) {
      turns.push({
        id: `result:verdict:${p.id}`,
        lines: [
          { key: "result.verdict", values: { verdict: p.verdict, chance: Math.round((p.chanceBps ?? 0) / 100) } },
        ],
        options: [],
      });
    }
    if (p.resolvedAt === null || Date.parse(p.resolvedAt) <= since) continue;
    if (p.status !== "success" && p.status !== "failure" && p.status !== "backfire") continue;
    const story = p.status === "success" ? p.successText : p.status === "backfire" ? p.backfireText : p.failureText;
    turns.push({
      id: `result:pitch:${p.id}`,
      lines: [
        { key: `result.pitch.${p.status}`, values: { amount: names.money(Math.abs(p.resultCents)) } },
        ...(story ? [{ key: "plain", values: { text: story } }] : []),
      ],
      options: [],
    });
  }
  return turns;
}

/** Open tasks about to expire: Mira raises the alarm once per task. */
export function urgentTurns(state: MiraState, names: MiraNames): MiraTurn[] {
  return state.tasks.tasks
    .filter((t) => t.status === "open" && t.canDelegate)
    .filter((t) => minutesLeft(t, state.now) <= cfg.urgentMinutes && Date.parse(t.dueAt) > state.now)
    .map((t) => ({
      id: `urgent:${t.id}`,
      lines: [
        {
          key: "urgent",
          values: { task: names.task(t.key), minutes: minutesLeft(t, state.now), amount: names.money(t.valueCents) },
        },
      ],
      options: adviseTask(t, state, names).filter((o) => o.tone !== "warn"),
    }));
}

// ---- Company health (ADR-162): where the company loses money and what to do about it -------------------------------

/** Words that point at one of the eight factors (normalized: umlauts spelled out). */
const TOPICS: readonly [HealthFactorKey, RegExp][] = [
  ["awareness", /\b(bekannt\w*|reichweite|marketing|werbung|kunden|kundschaft)\b/],
  ["capacity", /\b(menge\w*|kapazitaet\w*|ausverkauft|auslastung|ausgelastet|leerlauf|liefer\w*|produktion)\b/],
  ["quality", /\b(qualitaet\w*)\b/],
  ["image", /\b(image|ruf|krise\w*|skandal\w*|kampagne\w*)\b/],
  ["price", /\b(preis\w*|premium|budget)\b/],
  ["team", /\b(team\w*|personal|mitarbeiter\w*|loehne|lohn\w*|faehigkeit\w*|stufe\w*|schulung\w*)\b/],
  ["cash", /\b(kasse|schulden|rechnung\w*|kosten|insolvenz|pleite)\b/],
  ["momentum", /\b(schwung|momentum)\b/],
];
const HEALTH_ASK =
  /\b(wie|was|warum|wieso|steiger\w*|verbesser\w*|erhoeh\w*|mehr|fehl\w*|hilf\w*|angehen|besser|senk\w*|bring\w*|welche\w*|erklaer\w*|bedeut\w*|heisst)\b/;
const HEALTH_ANY = /\b(verlust\w*|verlier\w*|schwachstelle\w*|schwaechste\w*|gesundheit|wo fehlt\w*|was fehlt)\b/;

/** Which factor a question is about, "any" for "where do I lose money", null when it is about none. */
export function healthTopic(text: string): HealthFactorKey | "any" | null {
  const norm = ` ${normalize(text)} `;
  const topic = TOPICS.find(([, re]) => re.test(norm))?.[0] ?? null;
  if (topic && HEALTH_ASK.test(norm)) return topic;
  if (HEALTH_ANY.test(norm)) return "any";
  return null;
}

const factorName = (key: HealthFactorKey, names: MiraNames) => names.health?.factor(key) ?? key;

/** The best ready business move of a kind, as an option, or the free order when there is none. */
function moveFor(goal: PitchMoveKind, state: MiraState, names: MiraNames): MiraOption[] {
  const moves = state.moves;
  if (moves && moves.used < moves.slots) {
    const value = (m: CompanyMoveOption) => (m.chanceBps * Math.max(1, m.gain)) / Math.max(1, m.costCents);
    const best = moves.moves
      .filter(
        (m) =>
          m.kind === goal &&
          m.costCents <= moves.cashCents &&
          (m.availableAt === null || Date.parse(m.availableAt) <= state.now),
      )
      .sort((a, b) => value(b) - value(a))[0];
    if (best)
      return [
        {
          action: { type: "move", key: best.key },
          label: { key: "options.move", values: { move: names.move(best.key) } },
          hint: {
            key: best.kind === "cash" ? "why.moveCash" : "why.moveGain",
            values: {
              chance: Math.round(best.chanceBps / 100),
              cost: names.money(best.costCents),
              payout: names.money(best.payoutCents),
              minutes: best.minutes,
            },
          },
        },
      ];
  }
  return state.orders && orderBlock(state) === null ? [orderOption(state)] : [];
}

/** One lever of a factor as Mira's buttons: each runs an existing RPC or opens the place where it is done. */
function leverOptions(lever: HealthLever, factor: HealthFactor, state: MiraState, names: MiraNames): MiraOption[] {
  const h = state.health!;
  const amount = names.money(factor.impactCents);
  const option = (action: MiraAction, hint: MiraLine): MiraOption => ({
    ...describeAction(action, state, names),
    hint,
  });
  switch (lever.kind) {
    case "marketing":
      return [
        option(
          { type: "marketing", cents: lever.cents },
          lever.cents > 0
            ? state.company && lever.cents === companyFacts(state).awareness.suggestedMarketingCents
              ? {
                  key: "health.why.marketingGain",
                  values: {
                    now: names.money(h.marketingCentsPerQuarter),
                    gain: companyFacts(state).awareness.marketingGainSuggested,
                  },
                }
              : { key: "health.why.marketing", values: { now: names.money(h.marketingCentsPerQuarter) } }
            : { key: "health.why.marketingStop", values: { amount } },
        ),
      ];
    case "campaign":
      return [
        option(
          { type: "campaign", kind: lever.campaign },
          { key: "health.why.campaign", values: { cost: names.money(lever.costCents) } },
        ),
      ];
    case "price":
      return [
        option(
          { type: "strategy", priceLevel: lever.level, contractWork: h.contractWork },
          factor.key === "price" ? { key: "health.why.price", values: { amount } } : { key: "health.why.priceQuality" },
        ),
      ];
    case "contractWork":
      return [
        option(
          { type: "strategy", priceLevel: h.priceLevel, contractWork: true },
          { key: "health.why.contract", values: { amount } },
        ),
      ];
    case "hireAi":
      return [
        option(
          { type: "hireAi", count: lever.count, skill: null },
          { key: "health.why.hireAi", values: { wage: names.money(h.aiWageCentsPerHour) } },
        ),
      ];
    case "dismissAi":
      return [option({ type: "dismissAi", count: lever.count }, { key: "health.why.dismissAi", values: { amount } })];
    case "skill":
      return [
        option(
          { type: "hireAi", count: 1, skill: lever.skill },
          { key: "health.why.skillAi", values: { wage: names.money(h.aiWageCentsPerHour) } },
        ),
        {
          action: { type: "open", section: "team" },
          label: {
            key: "health.options.findPlayer",
            values: { skill: names.health?.skill(lever.skill) ?? lever.skill },
          },
          hint: { key: "health.why.skillPlayer" },
        },
      ];
    case "train":
      return [
        {
          action: { type: "open", section: "training" },
          label: { key: "health.options.train" },
          hint: { key: "health.why.train" },
        },
      ];
    // ADR-185: the expansion runs from here when the cash allows; the button sits under "Ausbau" (was: "business").
    case "expand":
      return [
        { ...describeAction({ type: "expand" }, state, names), hint: { key: "health.why.expand" } },
        {
          action: { type: "open", section: "expansion" },
          label: { key: "health.options.expand" },
          hint: { key: "health.why.expand" },
        },
      ];
    case "upgrade":
      // ADR-185: only while the next legal form is in reach (the card under "Ausbau" shows the button).
      if (state.company && !state.company.canUpgrade) return [];
      return [
        {
          action: { type: "open", section: "expansion" },
          label: { key: "health.options.upgrade" },
          hint: { key: "health.why.upgrade" },
        },
      ];
    case "tasks": {
      const out: MiraOption[] = [];
      const plan = planTasks(state);
      if (plan.length > 0) out.push(option({ type: "plan", actions: plan }, { key: "health.why.tasks" }));
      const first = state.tasks.tasks.find((t) => t.status === "open" || (t.mine && t.status === "assigned"));
      if (first)
        out.push(
          option(
            { type: "play", taskId: first.id },
            { key: "why.self", values: { value: names.money(first.valueCents) } },
          ),
        );
      if (state.tasks.canUseAi && !state.tasks.autoAi)
        out.push(option({ type: "autoAi", on: true }, { key: "health.why.autoAi" }));
      if (out.length === 0)
        out.push({
          action: { type: "open", section: "tasks" },
          label: { key: "health.options.openTasks" },
          hint: { key: "health.why.tasks" },
        });
      return out;
    }
    case "event": {
      const out: MiraOption[] = [];
      if (state.event && !state.eventPitched)
        out.push({ action: { type: "compose", kind: "event" }, label: { key: "options.writeStrategy" } });
      out.push({
        action: { type: "open", section: "situation" },
        label: { key: "health.options.event" },
        hint: { key: "health.why.event" },
      });
      return out;
    }
    case "deposit":
      return [
        {
          action: { type: "open", section: "money" },
          label: { key: "health.options.deposit" },
          hint: { key: "health.why.deposit", values: { amount: names.money(lever.cents) } },
        },
      ];
    case "move":
      return moveFor(lever.goal, state, names);
  }
}

/** Concrete steps for one factor, most effective first; the first one is Mira's tip. At most four. */
export function healthSteps(key: HealthFactorKey, state: MiraState, names: MiraNames): MiraOption[] {
  const factor = state.health?.result.factors.find((f) => f.key === key);
  if (!factor || state.tasks.role !== "founder") return [];
  const seen = new Set<string>();
  const out: MiraOption[] = [];
  const facts = companyFacts(state);
  for (const lever of factor.levers) {
    for (const option of leverOptions(lever, factor, state, names)) {
      const id = JSON.stringify(option.action);
      // ADR-185: only buttons that work now
      if (seen.has(id) || !actionEnabled(option.action, state, facts)) continue;
      seen.add(id);
      out.push(option);
    }
  }
  const steps = out.slice(0, 4);
  if (steps[0] && steps[0].tone !== "warn") steps[0] = { ...steps[0], tone: "best" };
  return steps;
}

/** Mira's answer to "Wie steigere ich die Bekanntheit?": the factor in numbers, what fixing it brings, the steps. */
export function healthTurn(key: HealthFactorKey | null, state: MiraState, names: MiraNames): MiraTurn {
  const id = `health:ask:${key ?? "any"}:${state.now}`;
  if (state.tasks.role !== "founder") return { id, lines: [{ key: "health.founderOnly" }], options: [] };
  const h = state.health;
  if (!h) return { id, lines: [{ key: "health.loading" }], options: [] };
  const k = key ?? h.result.weakest;
  const factor = h.result.factors.find((f) => f.key === k)!;
  const steps = healthSteps(k, state, names);
  const lines: MiraLine[] = [
    ...(key === null ? [{ key: "health.weakest", values: { factor: factorName(k, names) } }] : []),
    {
      key: "health.intro",
      values: { factor: factorName(k, names), score: factor.score, reason: names.health?.reason(factor) ?? "" },
    },
    factor.impactCents > 0
      ? { key: "health.gain", values: { amount: names.money(factor.impactCents) } }
      : factor.status === "good" || factor.status === "ok"
        ? { key: "health.fine" }
        : { key: "health.noGain" },
    { key: steps.length > 0 ? "health.steps" : "health.noSteps" },
  ];
  return { id, lines, options: steps };
}

/** Mira raises the weakest point on her own once it is weak or critical (once per factor and status). */
export function healthBriefing(state: MiraState, names: MiraNames): MiraTurn | null {
  const h = state.health;
  if (!h || state.tasks.role !== "founder") return null;
  const factor = h.result.factors.find((f) => f.key === h.result.weakest);
  if (!factor || (factor.status !== "weak" && factor.status !== "critical")) return null;
  return {
    id: `health:${factor.key}:${factor.status}`,
    lines: [
      {
        key: "health.brief",
        values: { factor: factorName(factor.key, names), reason: names.health?.reason(factor) ?? "" },
      },
      factor.impactCents > 0
        ? { key: "health.briefGain", values: { amount: names.money(factor.impactCents) } }
        : { key: "health.briefSteps" },
    ],
    options: healthSteps(factor.key, state, names).slice(0, 3),
  };
}

/** The overall score and the weak points, weakest first, for the analysis. */
export function healthSummary(state: MiraState, names: MiraNames): MiraLine[] {
  const h = state.health;
  if (!h) return [];
  const weak = [...h.result.factors]
    .filter((f) => f.status === "weak" || f.status === "critical")
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  return [
    { key: "health.summary", values: { score: h.result.score, factor: factorName(h.result.weakest, names) } },
    ...weak.map((f) => ({ key: "health.summaryItem", values: { factor: factorName(f.key, names), score: f.score } })),
  ];
}
