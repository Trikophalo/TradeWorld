import { BALANCE } from "@/config/balance";
import type { SkillBranch } from "@/config/skills";
import {
  archetypeOf,
  canStartStep,
  costUnitCents,
  eventModifiers,
  eventPhase,
  NO_EVENT,
  rollCompanyEvent,
  stepCostCents,
  stepSucceeds,
  stepSuccessBps,
  type EventModifiers,
  type Severity,
} from "@/lib/sim/company-events";
import {
  GameError,
  type CompanyBrief,
  type CompanyEvent,
  type CompanyEventState,
  type CompanyNews,
  type GameEngine,
} from "../types";
import type { DemoCompanyState } from "./company";

/*
 * Company crises and chances in the offline demo (ADR-091): same rules as the server (src/lib/sim/company-events.ts),
 * randomness from Math.random, everything stored on the demo company. Two demo shortcuts help testing: trigger an
 * event now, finish the running step now.
 */
const HOUR = 3_600_000;
const cfg = BALANCE.companyEvents;

interface DemoStep {
  idx: number;
  strategy: string;
  key: string;
  status: "running" | "succeeded" | "failed";
  startedAt: number;
  endsAt: number;
  costCents: number;
  successBps: number;
  retry: boolean;
}

interface DemoEvent {
  id: string;
  archetype: string;
  polarity: "crisis" | "chance";
  severity: Severity;
  status: CompanyEvent["status"];
  startedAt: number;
  deadlineAt: number;
  resolvedAt: number | null;
  overAt: number | null;
  strategy: string | null;
  mitigation: number;
  bonusApplied: boolean;
  steps: DemoStep[];
}

export interface DemoCompanyEventsState {
  seq: number;
  lastRollDay?: string;
  events: DemoEvent[];
  news: { id: number; kind: string; payload: Record<string, unknown>; createdAt: string }[];
}

export interface CompanyEventsHost {
  company(): DemoCompanyState | null;
  branchScores(): Record<SkillBranch, number>;
  /** Founder plus AI workers. */
  headcount(company: DemoCompanyState): number;
  fixedCostCentsPerQuarter(company: DemoCompanyState): number;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
}

const berlinDay = (at: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(at));

export function createCompanyEventsEngine(host: CompanyEventsHost) {
  const stateOf = (company: DemoCompanyState) => (company.events ??= { seq: 0, events: [], news: [] });
  const active = (company: DemoCompanyState) =>
    stateOf(company).events.find((e) => e.status === "open" || e.status === "in_force" || e.status === "solved");

  function news(company: DemoCompanyState, kind: string, payload: Record<string, unknown>) {
    const s = stateOf(company);
    s.seq += 1;
    s.news = [{ id: s.seq, kind, payload, createdAt: new Date().toISOString() }, ...s.news].slice(0, 50);
  }

  function start(company: DemoCompanyState, archetypeKey: string, severity: Severity, now: number) {
    const a = archetypeOf(archetypeKey)!;
    const s = stateOf(company);
    s.seq += 1;
    const event: DemoEvent = {
      id: `demo-event-${s.seq}`,
      archetype: a.key,
      polarity: a.polarity,
      severity,
      status: "open",
      startedAt: now,
      deadlineAt: now + a.deadlineHours * HOUR,
      resolvedAt: null,
      overAt: null,
      strategy: null,
      mitigation: 0,
      bonusApplied: false,
      steps: [],
    };
    s.events = [event, ...s.events].slice(0, 10);
    news(company, "event_started", { event_id: event.id, archetype: a.key, severity, polarity: a.polarity });
  }

  /** Daily roll, step results, deadlines, end of the effect. */
  function tick(now = Date.now()) {
    const company = host.company();
    if (!company) return;
    const s = stateOf(company);
    let changed = false;
    const today = berlinDay(now);
    if (s.lastRollDay !== today) {
      s.lastRollDay = today;
      const last = s.events[0];
      const roll = rollCompanyEvent([Math.random(), Math.random(), Math.random(), Math.random()], {
        sector: company.sector,
        ageHours: (now - company.foundedAt) / HOUR,
        hoursSinceLast: last ? (now - last.startedAt) / HOUR : null,
        hasActive: Boolean(active(company)),
      });
      if (roll) start(company, roll.archetype.key, roll.severity, now);
      changed = true;
    }
    for (const e of s.events) {
      const a = archetypeOf(e.archetype)!;
      for (const step of e.steps) {
        if (step.status === "running" && step.endsAt <= now) {
          step.status = stepSucceeds(step.successBps, Math.random()) ? "succeeded" : "failed";
          news(company, step.status === "succeeded" ? "event_step_done" : "event_step_failed", {
            event_id: e.id,
            archetype: e.archetype,
            step: step.key,
          });
          changed = true;
          const strategy = a.strategies.find((x) => x.key === e.strategy);
          const done = e.steps.filter((x) => x.strategy === e.strategy && x.status === "succeeded").length;
          if (strategy && step.status === "succeeded" && done >= strategy.steps.length) {
            e.status = "solved";
            e.resolvedAt = now;
            e.mitigation = strategy.mitigation;
            if (!e.bonusApplied) {
              company.awareness = Math.min(1, Math.max(0, company.awareness + (strategy.bonus?.awareness ?? 0)));
              company.quality = Math.min(1, Math.max(0, company.quality + (strategy.bonus?.quality ?? 0)));
              e.bonusApplied = true;
            }
            news(company, "event_solved", { event_id: e.id, archetype: e.archetype });
          }
        }
      }
      if (e.status === "open" && now >= e.deadlineAt) {
        if (e.polarity === "chance") {
          e.status = "expired";
          news(company, "event_expired", { event_id: e.id, archetype: e.archetype });
        } else {
          const strategy = a.strategies.find((x) => x.key === e.strategy);
          const done = e.steps.filter((x) => x.strategy === e.strategy && x.status === "succeeded").length;
          e.mitigation =
            strategy && strategy.steps.length > 0 ? (strategy.mitigation * done) / strategy.steps.length / 2 : 0;
          e.status = "in_force";
          news(company, "event_deadline", { event_id: e.id, archetype: e.archetype });
        }
        changed = true;
      }
      if ((e.status === "in_force" || e.status === "solved" || e.status === "accepted") && e.overAt === null) {
        const phase = eventPhase(
          a,
          { startedAt: e.startedAt, deadlineAt: e.deadlineAt, resolvedAt: e.resolvedAt },
          now,
        );
        if (phase === "over") {
          e.status = "over";
          e.overAt = now;
          news(company, "event_over", { event_id: e.id, archetype: e.archetype });
          changed = true;
        }
      }
    }
    if (changed) host.persist();
  }

  /** Effect of the current event in the hour starting at `at` (used by the demo's hourly close). */
  function modifiers(company: DemoCompanyState, at: number): EventModifiers {
    const e = stateOf(company).events.find((x) => x.status !== "over" && x.status !== "expired");
    if (!e) return NO_EVENT;
    const a = archetypeOf(e.archetype);
    if (!a) return NO_EVENT;
    const phase = eventPhase(a, { startedAt: e.startedAt, deadlineAt: e.deadlineAt, resolvedAt: e.resolvedAt }, at);
    const running = e.steps.find((s) => s.status === "running" && s.startedAt <= at && s.endsAt > at);
    const stepCfg = running
      ? a.strategies.find((s) => s.key === running.strategy)?.steps.find((s) => s.key === running.key)
      : undefined;
    const mitigation = e.status === "accepted" && a.polarity === "chance" ? 0 : e.mitigation;
    return eventModifiers(a, e.severity, phase, mitigation, stepCfg?.capacityHit ?? 0);
  }

  function brief(company: DemoCompanyState): CompanyBrief {
    return {
      id: company.id,
      name: company.name,
      idea: company.idea,
      sector: company.sector,
      productKey: company.productKey ?? null,
      tier: company.tier,
    };
  }

  function view(company: DemoCompanyState): CompanyEventState {
    const unit = costUnitCents(host.fixedCostCentsPerQuarter(company));
    const scores = host.branchScores();
    const headcount = host.headcount(company);
    const s = stateOf(company);
    const e = s.events.find((x) => x.status !== "over" && x.status !== "expired") ?? null;
    let event: CompanyEvent | null = null;
    if (e) {
      const a = archetypeOf(e.archetype)!;
      const strategy = a.strategies.find((x) => x.key === e.strategy);
      const done = e.steps.filter((x) => x.strategy === e.strategy && x.status === "succeeded").length;
      const running = e.steps.some((x) => x.status === "running");
      const nextStep = strategy && e.status !== "solved" && e.status !== "accepted" ? strategy.steps[done] : undefined;
      const failedBefore = nextStep
        ? e.steps.some((x) => x.strategy === e.strategy && x.key === nextStep.key && x.status === "failed")
        : false;
      event = {
        id: e.id,
        archetype: e.archetype,
        polarity: e.polarity,
        severity: e.severity,
        status: e.status,
        startedAt: new Date(e.startedAt).toISOString(),
        deadlineAt: new Date(e.deadlineAt).toISOString(),
        resolvedAt: e.resolvedAt ? new Date(e.resolvedAt).toISOString() : null,
        overAt: e.overAt ? new Date(e.overAt).toISOString() : null,
        strategy: e.strategy,
        mitigation: e.mitigation,
        aiHeadline: null,
        aiBody: null,
        aiCause: null,
        steps: e.steps.map((x) => ({
          ...x,
          startedAt: new Date(x.startedAt).toISOString(),
          endsAt: new Date(x.endsAt).toISOString(),
        })),
        next:
          nextStep && !running && e.strategy
            ? {
                strategy: e.strategy,
                idx: done,
                key: nextStep.key,
                costCents: stepCostCents(nextStep, unit, e.severity, failedBefore),
                successBps: stepSuccessBps(nextStep, e.severity, nextStep.branch ? scores[nextStep.branch] : 0),
                staffOk: canStartStep(nextStep, headcount),
                hours: nextStep.hours,
              }
            : null,
        options: a.strategies.map((st) => ({
          strategy: st.key,
          firstStepCostCents: st.steps[0] ? stepCostCents(st.steps[0], unit, e.severity) : 0,
          firstStepSuccessBps: st.steps[0]
            ? stepSuccessBps(st.steps[0], e.severity, st.steps[0].branch ? scores[st.steps[0].branch] : 0)
            : 10_000,
        })),
      };
    }
    return {
      company: brief(company),
      canAct: true,
      unitCents: unit,
      headcount,
      branchScores: scores,
      event,
      history: s.events
        .filter((x) => x !== e)
        .slice(0, 5)
        .map((x) => ({
          id: x.id,
          archetype: x.archetype,
          polarity: x.polarity,
          severity: x.severity,
          status: x.status,
          startedAt: new Date(x.startedAt).toISOString(),
          resolvedAt: x.resolvedAt ? new Date(x.resolvedAt).toISOString() : null,
        })),
      profileWords: null,
    };
  }

  const own = () => {
    const company = host.company();
    if (!company) throw new GameError("company_not_found");
    return company;
  };
  const eventOf = (company: DemoCompanyState, eventId: string) => {
    const e = stateOf(company).events.find((x) => x.id === eventId);
    if (!e) throw new GameError("invalid_argument");
    return e;
  };

  const engine: Pick<GameEngine, "companyEvent" | "chooseEventStrategy" | "startEventStep" | "companyNews"> = {
    async companyEvent() {
      tick();
      return view(own());
    },
    chooseEventStrategy: (requestId, eventId, strategyKey) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          tick();
          const company = own();
          const e = eventOf(company, eventId);
          if (e.status !== "open" && e.status !== "in_force") throw new GameError("event_closed");
          const strategy = archetypeOf(e.archetype)!.strategies.find((s) => s.key === strategyKey);
          if (!strategy) throw new GameError("invalid_argument");
          if (e.steps.some((s) => s.status === "running")) throw new GameError("event_closed");
          e.strategy = strategy.key;
          if (strategy.steps.length === 0) e.status = "accepted";
          host.persist();
          return view(company);
        }),
      ),
    startEventStep: (requestId, eventId) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          tick();
          const company = own();
          const e = eventOf(company, eventId);
          const state = view(company);
          const next = state.event?.id === e.id ? state.event.next : null;
          if (!next || (e.status !== "open" && e.status !== "in_force")) throw new GameError("event_closed");
          if (!next.staffOk) throw new GameError("event_needs_staff");
          if (company.cashCents - company.unpaidCents < next.costCents) throw new GameError("insufficient_funds");
          company.cashCents -= next.costCents;
          const now = Date.now();
          e.steps.push({
            idx: next.idx,
            strategy: next.strategy,
            key: next.key,
            status: "running",
            startedAt: now,
            endsAt: now + next.hours * HOUR,
            costCents: next.costCents,
            successBps: next.successBps,
            retry: e.steps.some((s) => s.key === next.key && s.strategy === next.strategy && s.status === "failed"),
          });
          host.persist();
          return view(company);
        }),
      ),
    async companyNews() {
      tick();
      const company = own();
      const s = stateOf(company);
      if (!s.news.some((n) => n.kind === "founded")) {
        s.news.push({ id: 0, kind: "founded", payload: {}, createdAt: new Date(company.foundedAt).toISOString() });
      }
      const result: CompanyNews = {
        company: brief(company),
        profileWords: null,
        items: s.news.map((n) => ({ ...n, aiHeadline: null, aiBody: null })),
      };
      return result;
    },
  };

  return {
    engine,
    tick,
    modifiers,
    /** Demo only: start an event now (a random one, or the given archetype). */
    triggerNow(archetypeKey?: string) {
      const company = host.company();
      if (!company) return;
      const current = active(company);
      if (current) {
        current.status = "over";
        current.overAt = Date.now();
      }
      const pool = cfg.archetypes.filter((a) => !a.sectors || a.sectors.includes(company.sector));
      const a = archetypeKey ? archetypeOf(archetypeKey)! : pool[Math.floor(Math.random() * pool.length)]!;
      start(company, a.key, 1, Date.now());
      host.persist();
    },
    /** Demo only: the running step ends now. */
    finishStepNow() {
      const company = host.company();
      if (!company) return;
      for (const e of stateOf(company).events)
        for (const s of e.steps) if (s.status === "running") s.endsAt = Date.now();
      tick();
    },
  };
}
