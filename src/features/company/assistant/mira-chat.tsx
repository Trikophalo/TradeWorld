"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { LISTED_COMPANY_KEY } from "@/features/game/listed-types";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from "react";
import { create } from "zustand";
import { MIRA } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonState } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BALANCE } from "@/config/balance";
import { COUNTRIES } from "@/config/countries";
import { useGameErrorText } from "@/features/game/errors";
import { engine } from "@/features/game/store";
import type { CompanyMoves, CompanyTask, MyCompany, PitchMoveKind } from "@/features/game/types";
import { useDisclosed } from "@/features/progression/components/reveal";
import { formatMoney } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { DURATION, EASE } from "@/lib/motion";
import { playSound } from "@/lib/sound";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { useHealthText } from "../health";
import { useCompanyEvent, useCompanyRefresh } from "../hooks";
import { COMPANY_MOVES_KEY } from "../components/company-moves";
import { COMPANY_AUTOPILOT_KEY, useCompanyAutopilot } from "../components/autopilot-card";
import { INTERVIEW_KEY } from "../components/interview-card";
import { COMPANY_SKILLS_KEY } from "../components/company-skills";
import { COMPANY_TALENTS_KEY } from "../components/talents";
import { worldOpenOption, worldTurnLines } from "./world";
import type { CompanySection } from "../tabs";
import {
  aiTurn,
  autopilotTurn,
  nextTurn,
  profitTurn,
  reportTurn,
  reputationTurn,
  revenueTurn,
  strengthsTurn,
} from "./advisor";
import { companyFacts, factsForClaude } from "./facts";
import { PITCHES_KEY, askJudge, useCompanyPitches } from "../components/pitch-card";
import { COMPANY_TASKS_KEY, PlaySheet, useCompanyTasks } from "../tasks/task-board";
import { useTaskText } from "../tasks/task-text";
import {
  adviseTask,
  analysisTurn,
  briefings,
  describeAction,
  examples,
  fromClaude,
  healthTurn,
  looksLikeOrder,
  orderTurn,
  parseCommand,
  planTurn,
  resultTurns,
  urgentTurns,
  validActions,
  warningFor,
  type ClaudeAction,
  type MiraAction,
  type MiraHealth,
  type MiraLine,
  type MiraNames,
  type MiraOption,
  type MiraState,
} from "./brain";

const cfg = BALANCE.companyAssistant;
const pitchCfg = BALANCE.pitches;
const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

/** Opens a place on the company page (ADR-185: a section id of tabs.ts). */
export type MiraOpen = (section: CompanySection) => void;

// ---- Conversation (kept while the app is open; Mira re-briefs after a reload) ----------------------------------------

interface Message {
  id: string;
  from: "mira" | "me";
  /** Mira's lines (message keys) or Claude's / the player's own words. */
  lines: MiraLine[];
  text?: string;
  options: MiraOption[];
  /** Options are spent once one was chosen. */
  done?: boolean;
  at: number;
}

interface MiraStore {
  company: string | null;
  messages: Message[];
  posted: string[];
  thinking: boolean;
  compose: "event" | "move" | null;
  goal: PitchMoveKind;
  /** Results older than this are not reported (ms). */
  startedAt: number;
  reset: (company: string) => void;
  push: (message: Omit<Message, "at">, briefingId?: string) => void;
  spend: (id: string) => void;
  set: (patch: Partial<Pick<MiraStore, "thinking" | "compose" | "goal">>) => void;
}

const useMira = create<MiraStore>((set, get) => ({
  company: null,
  messages: [],
  posted: [],
  thinking: false,
  compose: null,
  goal: "cash",
  startedAt: 0,
  reset: (company) =>
    set({ company, messages: [], posted: [], thinking: false, compose: null, startedAt: Date.now() - 60_000 }),
  push: (message, briefingId) => {
    if (briefingId && get().posted.includes(briefingId)) return;
    set((s) => ({
      messages: [...s.messages, { ...message, at: Date.now() }].slice(-60),
      posted: briefingId ? [...s.posted, briefingId].slice(-200) : s.posted,
    }));
  },
  spend: (id) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, done: true } : m)) })),
  set: (patch) => set(patch),
}));

let counter = 0;
const nextId = () => `m${Date.now()}-${counter++}`;

/** A question for Mira from elsewhere on the company page ("Mit Mira angehen", ADR-162); the chat sends it. */
const useMiraAsk = create<{ text: string | null; set: (text: string | null) => void }>((set) => ({
  text: null,
  set: (text) => set({ text }),
}));

export function askMira(text: string) {
  useMiraAsk.getState().set(text);
}

/** Mira writes: lines with message keys, maybe options. */
function mira(lines: MiraLine[], options: MiraOption[] = [], text?: string) {
  useMira.getState().push({ id: nextId(), from: "mira", lines, options, text });
}

// ---- State Mira looks at --------------------------------------------------------------------------------------------

function useMiraState(applications: number, health: MiraHealth | null, company: MyCompany | null): MiraState | null {
  const tasks = useCompanyTasks();
  const founder = tasks.data?.role === "founder";
  const moves = useQuery({
    queryKey: COMPANY_MOVES_KEY,
    queryFn: () => engine.companyMoves(),
    refetchInterval: 20_000,
    enabled: founder,
  });
  const event = useCompanyEvent();
  const pitches = useCompanyPitches(founder);
  // Listed companies (ADR-167): books, taxes, mood and the board; null while the company is private.
  const listed = useQuery({
    queryKey: LISTED_COMPANY_KEY,
    queryFn: () => engine.listedCompany(),
    refetchInterval: 60_000,
    enabled: founder,
  });
  // ADR-185: the autopilot, the last hour's economy and a waiting interview belong to the facts Mira reads.
  const autopilot = useCompanyAutopilot(founder);
  const interviews = useDisclosed("companyInterview");
  const interview = useQuery({
    queryKey: INTERVIEW_KEY,
    queryFn: () => engine.companyInterview(),
    refetchInterval: 60_000,
    enabled: founder && interviews,
  });
  // ADR-194: the Fertigkeiten, so Mira can point to one that can be learned now
  const skillsOn = useDisclosed("companySkills");
  const skills = useQuery({
    queryKey: COMPANY_SKILLS_KEY,
    queryFn: () => engine.companySkills(),
    refetchInterval: 60_000,
    enabled: founder && skillsOn,
  });
  // ADR-199: empty Stellen and unhappy talents
  const talentsOn = useDisclosed("companyTalents");
  const talents = useQuery({
    queryKey: COMPANY_TALENTS_KEY,
    queryFn: () => engine.companyTalents(),
    refetchInterval: 60_000,
    enabled: founder && talentsOn,
  });
  const now = useClock();
  return useMemo(() => {
    // The founder's Mira also needs the moves and the orders before she speaks.
    if (!tasks.data || now === null || (founder && (!moves.data || !pitches.data))) return null;
    const e = event.data?.canAct && event.data.event?.status === "open" ? event.data.event : null;
    return {
      tasks: tasks.data,
      moves: founder ? (moves.data ?? null) : null,
      event: e ? { id: e.id, polarity: e.polarity, headline: e.aiHeadline } : null,
      eventPitched:
        e !== null &&
        (pitches.data?.pitches.some(
          (p) => p.kind === "event" && p.eventId === e.id && (p.status === "judging" || p.status === "running"),
        ) ??
          false),
      applications: founder ? applications : 0,
      orders:
        founder && pitches.data
          ? {
              costCents: pitches.data.moveCostCents,
              nextOrderAt: pitches.data.nextOrderAt ? Date.parse(pitches.data.nextOrderAt) : null,
              pitches: pitches.data.pitches,
            }
          : null,
      health: founder ? health : null,
      listed: founder ? (listed.data ?? null) : null,
      company: founder ? company : null,
      autopilot: founder ? (autopilot.data ?? null) : null,
      interview: founder && interviews ? (interview.data?.interview ?? null) : null,
      skills: founder && skillsOn ? (skills.data ?? null) : null,
      talents: founder && talentsOn ? (talents.data ?? null) : null,
      // a minute is precise enough for deadlines, and keeps the briefing ids stable
      now: Math.floor(now / 60_000) * 60_000,
    };
  }, [
    tasks.data,
    moves.data,
    event.data,
    pitches.data,
    listed.data,
    founder,
    applications,
    health,
    company,
    autopilot.data,
    interview.data,
    interviews,
    skills.data,
    skillsOn,
    talents.data,
    talentsOn,
    now,
  ]);
}

function useNames(): MiraNames {
  const text = useTaskText();
  const tm = useTranslations("companyMoves");
  const tn = useTranslations("skills.nodes");
  const tl = useTranslations("listed.items");
  const tc = useTranslations("companySkills.items");
  const health = useHealthText();
  return useMemo(
    () => ({
      task: text.name,
      move: (key: string) => {
        const path = `items.${key}.name` as Parameters<typeof tm>[0];
        return tm.has(path) ? tm(path) : key;
      },
      money: (cents: number) => formatMoney(cents, { whole: true }),
      health: {
        ...health,
        skill: (key: string) => {
          const path = `${key}.name` as Parameters<typeof tn>[0];
          return tn.has(path) ? tn(path) : key;
        },
      },
      listed: {
        item: (key: string) => {
          const path = `${key}.name` as Parameters<typeof tl>[0];
          return tl.has(path) ? tl(path) : key;
        },
      },
      companySkill: (key: string) => {
        const path = `${key}.name` as Parameters<typeof tc>[0];
        return tc.has(path) ? tc(path) : key;
      },
    }),
    [text, tm, tn, tl, tc, health],
  );
}

// ---- Running an action ----------------------------------------------------------------------------------------------

function useRunner(state: MiraState | null, names: MiraNames, onOpen: MiraOpen, onPlay: (task: CompanyTask) => void) {
  const client = useQueryClient();
  const refresh = useCompanyRefresh();
  const errorText = useGameErrorText();
  const store = useMira;

  return async (action: MiraAction, opts: { confirmed?: boolean } = {}) => {
    if (!state) return;
    const taskName = (id: number) => {
      const t = state.tasks.tasks.find((x) => x.id === id);
      return t ? names.task(t.key) : "?";
    };
    // Mira thinks along: a risky choice is asked back first.
    if (!opts.confirmed) {
      const warning = warningFor(action, state, names);
      if (warning) {
        mira(warning.lines, warning.options);
        return;
      }
    }
    try {
      switch (action.type) {
        case "delegate": {
          client.setQueryData(
            COMPANY_TASKS_KEY,
            await engine.delegateCompanyTask(crypto.randomUUID(), action.taskId, action.to),
          );
          mira([
            action.to === "ai"
              ? { key: "ok.ai", values: { task: taskName(action.taskId), minutes: state.tasks.aiMinutes } }
              : { key: "ok.delegated", values: { task: taskName(action.taskId), name: action.to } },
          ]);
          break;
        }
        case "play": {
          const task = state.tasks.tasks.find((t) => t.id === action.taskId);
          if (task) onPlay(task);
          return;
        }
        case "move": {
          const next: CompanyMoves = await engine.startCompanyMove(crypto.randomUUID(), action.key);
          client.setQueryData(COMPANY_MOVES_KEY, next);
          const m = next.moves.find((x) => x.key === action.key);
          mira([{ key: "ok.move", values: { move: names.move(action.key), minutes: m?.minutes ?? 0 } }]);
          void playSound("success");
          break;
        }
        case "pitch": {
          const next = await engine.submitCompanyPitch(crypto.randomUUID(), action.kind, action.text, action.goal);
          client.setQueryData(PITCHES_KEY, next);
          const fresh = next.pitches.find((p) => p.status === "judging");
          if (fresh) askJudge(fresh.id, () => void client.invalidateQueries({ queryKey: PITCHES_KEY }));
          mira([
            action.kind === "event"
              ? { key: "ok.pitchEvent" }
              : { key: "ok.order", values: { minutes: pitchCfg.moveMinutes, wait: pitchCfg.orderCooldownMinutes } },
          ]);
          void playSound("success");
          break;
        }
        case "plan": {
          // One after the other: each hand-over is its own idempotent request.
          let done = 0;
          for (const step of action.actions) {
            try {
              client.setQueryData(
                COMPANY_TASKS_KEY,
                await engine.delegateCompanyTask(crypto.randomUUID(), step.taskId, step.to),
              );
              done += 1;
            } catch {
              // someone was faster or the task expired: the rest of the plan still runs
            }
          }
          mira([{ key: "ok.plan", values: { done, count: action.actions.length } }]);
          break;
        }
        case "autoAi": {
          client.setQueryData(COMPANY_TASKS_KEY, await engine.setCompanyTasksAutoAi(crypto.randomUUID(), action.on));
          mira([{ key: action.on ? "ok.autoOn" : "ok.autoOff" }]);
          break;
        }
        case "compose": {
          store.getState().set({ compose: action.kind });
          mira([{ key: action.kind === "event" ? "compose.event" : "compose.move" }]);
          return;
        }
        case "open":
          onOpen(action.section);
          return;
        case "autopilot": {
          client.setQueryData(COMPANY_AUTOPILOT_KEY, await engine.setCompanyAutopilot(crypto.randomUUID(), action.on));
          mira([{ key: action.on ? "ok.autopilotOn" : "ok.autopilotOff" }]);
          break;
        }
        case "expand": {
          await engine.expandCompany(crypto.randomUUID());
          mira([{ key: "ok.expand" }]);
          void playSound("success");
          break;
        }
        case "suggest":
          return;
        // Company levers (ADR-162): the same RPCs as the controls on the overview.
        case "marketing": {
          await engine.setCompanyMarketing(crypto.randomUUID(), action.cents);
          mira([
            action.cents > 0
              ? { key: "health.ok.marketing", values: { amount: names.money(action.cents) } }
              : { key: "health.ok.marketingStop" },
          ]);
          break;
        }
        case "strategy": {
          const contract = action.contractWork && state.health?.contractWork === false;
          await engine.setCompanyStrategy(crypto.randomUUID(), action.priceLevel, action.contractWork);
          mira([
            contract ? { key: "health.ok.contract" } : { key: "health.ok.price", values: { level: action.priceLevel } },
          ]);
          break;
        }
        case "campaign": {
          await engine.startCampaign(crypto.randomUUID(), state.tasks.company.id, action.kind);
          mira([{ key: "health.ok.campaign", values: { kind: action.kind } }]);
          void playSound("success");
          break;
        }
        case "hireAi": {
          await engine.hireAiWorkers(crypto.randomUUID(), action.count, action.skill);
          mira([{ key: "health.ok.hireAi", values: { count: action.count } }]);
          break;
        }
        case "dismissAi": {
          for (let i = 0; i < action.count; i++) await engine.dismissAiWorker(crypto.randomUUID(), null);
          mira([{ key: "health.ok.dismissAi", values: { count: action.count } }]);
          break;
        }
        // Listed companies (ADR-167): the same RPCs as the controls of the company page.
        case "invest": {
          client.setQueryData(LISTED_COMPANY_KEY, await engine.companyInvest(crypto.randomUUID(), action.key));
          mira([{ key: "listed.ok.invest", values: { item: names.listed?.item(action.key) ?? action.key } }]);
          break;
        }
        case "payTax": {
          const r = await engine.payCompanyTax(crypto.randomUUID());
          client.setQueryData(LISTED_COMPANY_KEY, r.listed);
          mira([{ key: "listed.ok.payTax", values: { amount: names.money(r.paidCents) } }]);
          break;
        }
        case "advisor": {
          client.setQueryData(LISTED_COMPANY_KEY, await engine.setTaxAdvisor(crypto.randomUUID(), action.hire));
          mira([{ key: action.hire ? "listed.ok.hireAdvisor" : "listed.ok.fireAdvisor" }]);
          break;
        }
      }
      haptic("success");
      void refresh();
    } catch (error) {
      haptic("error");
      mira([{ key: "error" }], [], errorText(error));
    }
  };
}

// ---- Claude ---------------------------------------------------------------------------------------------------------

async function askClaude(
  text: string,
  state: MiraState,
  names: MiraNames,
  history: { from: "mira" | "me"; text: string }[],
): Promise<{ reply: string; actions: MiraAction[] } | { reason: string } | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const tasks = Object.fromEntries(state.tasks.tasks.map((t) => [String(t.id), names.task(t.key)]));
  const moves = Object.fromEntries((state.moves?.moves ?? []).map((m) => [m.key, names.move(m.key)]));
  const taskKeys = Object.fromEntries(state.tasks.history.map((h) => [h.key, names.task(h.key)]));
  // ADR-185: the same facts the deterministic Mira reads, so Claude's answer is grounded in them.
  const facts = factsForClaude(companyFacts(state));
  try {
    const { data } = await supabase.functions.invoke<{
      ok?: boolean;
      reason?: string;
      reply?: string;
      actions?: ClaudeAction[];
    }>("company-assistant", { body: { text, names: { tasks, moves, taskKeys }, history, facts } });
    if (!data?.ok || !data.reply) return { reason: data?.reason ?? "no_answer" };
    return { reply: data.reply, actions: validActions(fromClaude(data.actions ?? []), state) };
  } catch {
    return { reason: "offline" };
  }
}

// ---- The chat -------------------------------------------------------------------------------------------------------

/**
 * Mira, the company assistant (ADR-138): the company runs through this chat. She reports new tasks, crises and free
 * move slots, weighs who should do what and hands out work on the player's word. Clear commands are read here;
 * anything else goes to Claude, which only proposes. Every action is one tap and runs through the existing RPCs.
 */
export function MiraChat({
  applications = 0,
  health = null,
  company = null,
  onOpen,
  className,
}: {
  applications?: number;
  /** The own company as the page shows it (ADR-185), for the founder's facts. */
  company?: MyCompany | null;
  /** The company's eight factors (ADR-162), for the founder. */
  health?: MiraHealth | null;
  onOpen: MiraOpen;
  className?: string;
}) {
  const t = useTranslations("mira");
  const line = (l: MiraLine) => t(l.key as Parameters<typeof t>[0], l.values as Record<string, string>);
  const state = useMiraState(applications, health, company);
  const names = useNames();
  const [playing, setPlaying] = useState<CompanyTask | null>(null);
  const run = useRunner(state, names, onOpen, setPlaying);
  const messages = useMira((s) => s.messages);
  const thinking = useMira((s) => s.thinking);
  const compose = useMira((s) => s.compose);
  const [text, setText] = useState("");
  const [sendState, setSendState] = useState<ButtonState>("idle");
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const companyId = state?.tasks.company.id ?? null;

  // A new company (account switch, refounded) starts a new conversation.
  useEffect(() => {
    if (companyId && useMira.getState().company !== companyId) {
      useMira.getState().reset(companyId);
      useMira.getState().push(
        {
          id: nextId(),
          from: "mira",
          lines: [{ key: "hello", values: { company: state?.tasks.company.name ?? "" } }],
          options: [],
        },
        "hello",
      );
    }
  }, [companyId, state?.tasks.company.name]);

  // Briefings, alarms and results: each new thing once.
  useEffect(() => {
    if (!state || useMira.getState().company !== state.tasks.company.id) return;
    const since = useMira.getState().startedAt;
    for (const turn of [
      ...resultTurns(state, names, since),
      ...urgentTurns(state, names),
      ...briefings(state, names),
    ]) {
      useMira.getState().push({ id: nextId(), from: "mira", lines: turn.lines, options: turn.options }, turn.id);
    }
  }, [state, names]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, thinking]);

  const choose = (message: Message, option: MiraOption) => {
    if (option.action.type === "suggest") {
      setText(option.action.text);
      input.current?.focus();
      return;
    }
    haptic("tap");
    useMira.getState().spend(message.id);
    void run(option.action, { confirmed: option.confirm === true });
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim().slice(0, cfg.maxTextLength);
    if (!body || sendState === "loading") return;
    setText("");
    await submit(body);
  };

  async function submit(body: string) {
    if (!state) return;
    void playSound("tap");
    useMira.getState().push({ id: nextId(), from: "me", lines: [], text: body, options: [] });

    // Writing mode: the message is the own strategy.
    if (compose) {
      if (body.length < pitchCfg.minChars) {
        mira([{ key: "compose.short", values: { min: pitchCfg.minChars } }]);
        return;
      }
      useMira.getState().set({ compose: null });
      if (compose === "move") {
        // A free order (ADR-139): Mira says what she makes of it; one tap carries it out.
        const turn = orderTurn(body, state, names);
        mira(turn.lines, turn.options);
        return;
      }
      await run(
        { type: "pitch", kind: "event", text: body.slice(0, pitchCfg.maxChars), goal: null },
        { confirmed: true },
      );
      return;
    }

    const intent = parseCommand(body, state, names);
    if (intent.kind === "actions") {
      if (intent.actions.length === 1) {
        await run(intent.actions[0]!);
      } else {
        mira(
          [{ key: "many", values: { count: intent.actions.length } }],
          intent.actions.map((a) => describeAction(a, state, names)),
        );
      }
      return;
    }
    if (intent.kind === "status") {
      const turns = briefings(state, names);
      for (const turn of turns) mira(turn.lines, turn.options);
      return;
    }
    if (intent.kind === "plan" || intent.kind === "analysis") {
      const turn = intent.kind === "plan" ? planTurn(state, names) : analysisTurn(state, names);
      mira(turn.lines, turn.options);
      return;
    }
    // ADR-208: the countries of the world map, from the config (no Claude)
    if (intent.kind === "world") {
      mira(worldTurnLines(COUNTRIES.find((c) => c.key === intent.country) ?? null), [worldOpenOption]);
      return;
    }
    if (intent.kind === "health") {
      const turn = healthTurn(intent.factor, state, names);
      mira(turn.lines, turn.options);
      return;
    }
    // ADR-185: questions answered from the company facts
    const answers = {
      profit: profitTurn,
      revenue: revenueTurn,
      next: nextTurn,
      report: reportTurn,
      reputation: reputationTurn,
      strengths: strengthsTurn,
      autopilot: autopilotTurn,
      ai: aiTurn,
    } as const;
    if (intent.kind in answers) {
      const turn = answers[intent.kind as keyof typeof answers](state, names);
      mira(turn.lines, turn.options);
      return;
    }
    if (intent.kind !== "unknown") return;
    if (intent.reason === "noTarget") {
      const task = state.tasks.tasks.find((x) => x.id === intent.taskId);
      if (task) {
        mira([{ key: "ask.who", values: { task: names.task(task.key) } }], adviseTask(task, state, names));
        return;
      }
    }
    if (intent.reason === "noTask") {
      const open = state.tasks.tasks.filter((x) => x.status === "open" && x.canDelegate).slice(0, 4);
      mira(
        [{ key: "ask.which" }],
        open.map((x) =>
          describeAction(
            intent.to === "me" ? { type: "play", taskId: x.id } : { type: "delegate", taskId: x.id, to: intent.to },
            state,
            names,
          ),
        ),
      );
      return;
    }

    // Free text: Claude, if the game has a key; otherwise Mini-Mira explains what she understands.
    setSendState("loading");
    useMira.getState().set({ thinking: true });
    const history = useMira
      .getState()
      .messages.slice(-cfg.historyTurns - 1, -1)
      .map((m) => ({ from: m.from, text: (m.text ?? m.lines.map(line).join(" ")).slice(0, 400) }))
      .filter((m) => m.text.length > 0);
    const answer = await askClaude(body, state, names, history);
    useMira.getState().set({ thinking: false });
    setSendState("idle");
    if (answer && "reply" in answer) {
      mira(
        [],
        answer.actions.map((a) => describeAction(a, state, names)),
        answer.reply,
      );
      return;
    }
    // Without Claude: something the company should do becomes a free order; anything else gets examples.
    if (state.tasks.role === "founder" && looksLikeOrder(body)) {
      const turn = orderTurn(body, state, names);
      mira(turn.lines, turn.options);
      return;
    }
    mira([{ key: answer?.reason === "busy" ? "busy" : "unknown" }, { key: "brief.examples" }], examples(state, names));
  }

  // "Mit Mira angehen" on the overview (ADR-162): the question arrives here and is sent like a typed one.
  const pending = useMiraAsk((s) => s.text);
  const ready = state !== null;
  const sendPending = useEffectEvent((body: string) => void submit(body));
  useEffect(() => {
    if (!pending || !ready) return;
    useMiraAsk.getState().set(null);
    sendPending(pending);
  }, [pending, ready]);

  if (!state) {
    return (
      <Card padding="lg" className={cn("space-y-3", className)} aria-hidden>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-3/4 rounded-lg" />
        <Skeleton className="h-16 w-2/3 rounded-lg" />
        <Skeleton className="h-11 w-full rounded-md" />
      </Card>
    );
  }

  return (
    <Card
      padding="none"
      className={cn("flex h-[min(74dvh,640px)] flex-col overflow-hidden", className)}
      data-testid="mira"
      data-tour="assistant"
    >
      <header className="flex items-center gap-3 border-b border-line-1 px-4 py-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-md bg-accent-soft">
          <PixelIcon {...(thinking ? MIRA.think : MIRA.idle)} scale={3} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold text-fg-1">
            {t("name")} <Badge tone="accent">{t("badge")}</Badge>
          </p>
          <p className="truncate text-xs text-fg-3">{t("subtitle", { company: state.tasks.company.name })}</p>
        </div>
      </header>

      <ol
        ref={list}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4"
        aria-live="polite"
        data-testid="mira-messages"
      >
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <Bubble key={m.id} message={m} onChoose={(o) => choose(m, o)} />
          ))}
        </AnimatePresence>
        {thinking && <Thinking />}
      </ol>

      <form onSubmit={(event) => void send(event)} className="space-y-2 border-t border-line-1 p-3">
        {compose && (
          <div className="flex flex-wrap items-center gap-2" data-testid="mira-compose">
            <Badge tone="accent">{t(compose === "event" ? "compose.badgeEvent" : "compose.badgeMove")}</Badge>
            <button
              type="button"
              onClick={() => useMira.getState().set({ compose: null })}
              className="ml-auto text-2xs text-fg-3 underline-offset-2 focus-ring hover:underline"
            >
              {t("compose.cancel")}
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("placeholder")}</span>
            <input
              ref={input}
              value={text}
              maxLength={compose ? pitchCfg.maxChars : cfg.maxTextLength}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                compose
                  ? t(compose === "event" ? "compose.placeholderEvent" : "compose.placeholderMove")
                  : t("placeholder")
              }
              className="h-11 w-full rounded-md border border-line-2 bg-surface-2 px-3 text-fg-1 focus-ring placeholder:text-fg-3"
              data-testid="mira-input"
            />
          </label>
          <Button type="submit" state={sendState} disabled={!text.trim()} data-testid="mira-send">
            {t("send")}
          </Button>
        </div>
      </form>
      <PlaySheet task={playing} onClose={() => setPlaying(null)} />
    </Card>
  );
}

function Bubble({ message, onChoose }: { message: Message; onChoose: (option: MiraOption) => void }) {
  const t = useTranslations("mira");
  const line = (l: MiraLine) => t(l.key as Parameters<typeof t>[0], l.values as Record<string, string>);
  const mine = message.from === "me";
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
      className={cn("flex gap-2", mine ? "flex-row-reverse items-end" : "items-start")}
      data-testid={mine ? "mira-me" : "mira-says"}
    >
      {!mine && (
        <span className="grid size-7 shrink-0 place-items-center rounded-xs bg-accent-soft" aria-hidden>
          <PixelIcon {...MIRA.idle} scale={2} />
        </span>
      )}
      <div className={cn("max-w-[85%] min-w-0 space-y-2", mine && "max-w-[75%]")}>
        <div className={cn("rounded-lg px-3 py-2", mine ? "bg-accent-soft" : "bg-surface-2")}>
          {message.lines.map((l, i) => (
            <p key={i} className={cn("text-sm text-pretty break-words text-fg-1", i > 0 && "mt-1 text-fg-2")}>
              {line(l)}
            </p>
          ))}
          {message.text && <p className="text-sm text-pretty break-words text-fg-1">{message.text}</p>}
          <p className="mt-0.5 text-right nums text-2xs text-fg-3">{time.format(new Date(message.at))}</p>
        </div>
        {message.options.length > 0 && (
          <div className="grid gap-1.5" role="group" aria-label={t("choices")}>
            {message.options.map((o, i) => (
              <button
                key={i}
                type="button"
                disabled={message.done}
                onClick={() => onChoose(o)}
                data-testid="mira-option"
                className={cn(
                  "group flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left focus-ring transition duration-fast active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100",
                  o.tone === "best"
                    ? "border-accent bg-surface-1 hover:bg-accent-soft"
                    : "border-line-1 bg-surface-1 hover:bg-surface-2",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg-1">
                    {line(o.label)}
                    {o.tone === "best" && <Badge tone="accent">{t("tip")}</Badge>}
                  </span>
                  {o.hint && (
                    <span className={cn("block text-xs text-pretty", o.tone === "warn" ? "text-warn" : "text-fg-3")}>
                      {line(o.hint)}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden
                  className="pt-0.5 text-fg-3 transition-transform duration-fast group-hover:translate-x-0.5"
                >
                  →
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.li>
  );
}

function Thinking() {
  const t = useTranslations("mira");
  return (
    <li className="flex items-end gap-2" aria-label={t("thinking")}>
      <span className="grid size-7 shrink-0 place-items-center rounded-xs bg-accent-soft" aria-hidden>
        <PixelIcon {...MIRA.think} scale={2} />
      </span>
      <span className="flex gap-1 rounded-lg bg-surface-2 px-3 py-3" data-testid="mira-thinking">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-pill bg-fg-3"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: DURATION.slower * 2, ease: EASE.inOut, repeat: Infinity, delay: i * DURATION.fast }}
          />
        ))}
      </span>
    </li>
  );
}
