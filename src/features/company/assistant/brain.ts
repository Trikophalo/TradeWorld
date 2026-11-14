/*
 * Mira, the company assistant (ADR-138): what she reports, what she recommends and how she reads a typed command.
 * Pure: the state, the clock and the names come in, Mira's turns come out. Texts are message keys under "mira." with
 * values; the chat translates them. Every action Mira offers runs through an existing RPC, so the server stays the
 * authority.
 */
import { BALANCE } from "@/config/balance";
import { miniJudge, pitchChanceBps } from "@/features/game/demo/pitches";
import type {
  CompanyMoveOption,
  CompanyMoves,
  CompanyPitch,
  CompanyTask,
  CompanyTasks,
  PitchMoveKind,
} from "@/features/game/types";

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
  | { type: "open"; tab: "overview" | "tasks" | "team"; section?: string }
  /** Fills the input with an example. */
  | { type: "suggest"; text: string };

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
        { action: { type: "open", tab: "overview", section: "situation" }, label: { key: "options.showEvent" } },
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
          orderOption(state),
        ],
      });
    }
  }

  if (state.applications > 0) {
    turns.push({
      id: `apps:${state.applications}`,
      lines: [{ key: "brief.applications", values: { count: state.applications } }],
      options: [{ action: { type: "open", tab: "team" }, label: { key: "options.openTeam" }, tone: "best" }],
    });
  }

  if (turns.length === 0) {
    turns.push({
      id: `calm:${tasks.tasks.length}`,
      lines: [{ key: "brief.calm" }, { key: "brief.examples" }],
      options: examples(state, names),
    });
  }
  return turns;
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

  const open = state.tasks.tasks.filter((t) => t.status === "open" && t.canDelegate);
  const mine = state.tasks.tasks.filter((t) => t.mine && t.status === "assigned");
  const person = state.tasks.people.find((p) => !p.isMe && list.includes(normalize(p.nickname)));
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

/** Checks actions Claude proposed against the current state: unknown tasks, people or moves are dropped. */
export function validActions(actions: readonly MiraAction[], state: MiraState): MiraAction[] {
  const people = new Set(state.tasks.people.filter((p) => !p.isMe).map((p) => p.nickname));
  return actions.filter((a) => {
    switch (a.type) {
      case "delegate": {
        const t = state.tasks.tasks.find((x) => x.id === a.taskId);
        return !!t && t.canDelegate && t.status === "open" && (a.to === "ai" ? state.tasks.canUseAi : people.has(a.to));
      }
      case "play": {
        const t = state.tasks.tasks.find((x) => x.id === a.taskId);
        return !!t && (t.status === "open" || (t.mine && t.status === "assigned"));
      }
      case "move":
        return state.moves?.moves.some((m) => m.key === a.key) ?? false;
      case "pitch":
        return (
          a.text.trim().length >= BALANCE.pitches.minChars &&
          a.text.trim().length <= BALANCE.pitches.maxChars &&
          (a.kind === "move" ? orderBlock(state) === null : state.event !== null)
        );
      case "autoAi":
        return state.tasks.role === "founder";
      case "plan":
        return a.actions.length > 0;
      default:
        return true;
    }
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
      return { action, label: { key: action.tab === "team" ? "options.openTeam" : "options.showEvent" } };
    case "suggest":
      return { action, label: { key: "examples.free", values: { text: action.text } } };
  }
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
      options.push({ action: { type: "open", tab: "team" }, label: { key: "options.hire" } });
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
  if (state.tasks.tasks.some((t) => t.status === "open" && t.canDelegate))
    options.push({ action: { type: "suggest", text: "Verteil alle Aufgaben" }, label: { key: "examples.plan" } });
  return { id: `analysis:${state.now}`, lines, options };
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
