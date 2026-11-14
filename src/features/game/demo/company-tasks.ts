import { BALANCE } from "@/config/balance";
import { aiMinutes, generatePuzzle, gradeAnswer, taskResultCents, type TaskSolution } from "@/lib/sim/company-tasks";
import { GameError, type CompanyTasks, type GameEngine, type NewsFeedItem, type StockNewsItem } from "../types";

/*
 * Company tasks in the offline demo (ADR-129): the founder alone plus the AI workers, same numbers as the server.
 * New tasks appear while the board is looked at; AI results and deadlines are settled on every read.
 */
export interface DemoTask {
  id: number;
  key: string;
  status: "open" | "assigned" | "playing" | "ai" | "success" | "failure" | "missed";
  valueCents: number;
  createdAt: number;
  dueAt: number;
  assigneeAi: boolean;
  mine: boolean;
  aiDoneAt: number | null;
  aiChanceBps: number;
  openedAt: number | null;
  puzzle: Record<string, unknown> | null;
  solution: TaskSolution | null;
  scoreBps: number | null;
  resultCents: number;
  resolvedAt: number | null;
}

export interface DemoTasksState {
  seq: number;
  tasks: DemoTask[];
  autoAi: boolean;
  lastCreatedAt: number | null;
}

export interface CompanyTasksHost {
  company(): {
    name: string;
    tier: string;
    productKey?: string;
    aiWorkers: number;
    aiWorkerSkills?: string[];
  } | null;
  nickname(): string;
  addCompanyCash(cents: number): void;
  news(kind: string, payload: Record<string, unknown>): void;
  companyNews(): { id: number; kind: string; payload: Record<string, unknown>; createdAt: string }[];
  stockNews(limit: number): Promise<StockNewsItem[]>;
  addXp(xp: number): void;
  state(): DemoTasksState | undefined;
  setState(s: DemoTasksState): void;
  idempotent<T>(requestId: string, run: () => T): T;
  now(): number;
  random(): number;
}

const cfg = BALANCE.companyTasks;
const fun = BALANCE.funNews;
type TierKey = keyof typeof cfg.valueCentsByTier;

export function createCompanyTasksEngine(
  host: CompanyTasksHost,
): Pick<
  GameEngine,
  | "companyTasks"
  | "delegateCompanyTask"
  | "startCompanyTask"
  | "submitCompanyTask"
  | "setJobSupervisor"
  | "setCompanyTasksAutoAi"
  | "newsFeed"
> {
  const load = (): DemoTasksState => host.state() ?? { seq: 0, tasks: [], autoAi: true, lastCreatedAt: null };
  const company = () => {
    const c = host.company();
    if (!c) throw new GameError("company_not_found");
    return c;
  };
  const defOf = (key: string) => cfg.tasks.find((t) => t.key === key);

  function resolve(s: DemoTasksState, t: DemoTask, score: number | null, byAi: boolean, now: number) {
    const result = taskResultCents(t.valueCents, score, byAi);
    t.status = score !== null && score >= cfg.passScoreBps ? "success" : score === null ? "missed" : "failure";
    t.scoreBps = score;
    t.resultCents = result;
    t.resolvedAt = now;
    host.addCompanyCash(result);
    host.news(`task_${t.status}`, {
      task: t.key,
      amount_cents: result,
      nickname: byAi ? null : host.nickname(),
      ai: byAi,
    });
    if (!byAi && score !== null) host.addXp(t.status === "success" ? cfg.xp.success : cfg.xp.failure);
    s.tasks = s.tasks.slice(-40);
  }

  /** AI results, deadlines, auto AI and a new task when the board is short. */
  function tick(): DemoTasksState {
    const c = company();
    const s = load();
    const now = host.now();
    for (const t of s.tasks) {
      if (t.status === "ai" && t.aiDoneAt !== null && t.aiDoneAt <= now) {
        const ok = t.aiDoneAt <= t.dueAt && host.random() * 10_000 < t.aiChanceBps;
        resolve(s, t, ok ? 10_000 : 0, true, now);
      }
      if (t.status === "playing" && t.openedAt !== null) {
        const g = cfg.games[defOf(t.key)?.game ?? "math"];
        if (t.openedAt + (g.seconds + cfg.graceSeconds + 60) * 1000 <= now) resolve(s, t, 0, false, now);
      }
      if (
        t.status === "open" &&
        s.autoAi &&
        c.aiWorkers > 0 &&
        t.dueAt - cfg.board.autoAiBeforeDueMinutes * 60_000 <= now &&
        t.dueAt > now
      ) {
        toAi(s, t, now);
      }
      if ((t.status === "open" || t.status === "assigned") && t.dueAt <= now) resolve(s, t, null, false, now);
    }
    const active = s.tasks.filter((t) => ["open", "assigned", "playing", "ai"].includes(t.status));
    const target = Math.min(cfg.board.max, cfg.board.base + Math.floor((1 + c.aiWorkers) / cfg.board.membersPerTask));
    if (
      active.length < target &&
      (s.lastCreatedAt === null || s.lastCreatedAt + cfg.board.everyMinutes * 60_000 <= now)
    ) {
      const pool = cfg.tasks.filter(
        (t) => (t.product === "*" || t.product === c.productKey) && !active.some((a) => a.key === t.key),
      );
      const pick = pool[Math.floor(host.random() * pool.length)];
      if (pick) {
        const tier = (c.tier in cfg.valueCentsByTier ? c.tier : "garage") as TierKey;
        s.seq += 1;
        s.tasks.push({
          id: s.seq,
          key: pick.key,
          status: "open",
          valueCents: Math.max(1, Math.round(cfg.valueCentsByTier[tier] * pick.factor)),
          createdAt: now,
          dueAt: now + pick.minutes * 60_000,
          assigneeAi: false,
          mine: false,
          aiDoneAt: null,
          aiChanceBps: 0,
          openedAt: null,
          puzzle: null,
          solution: null,
          scoreBps: null,
          resultCents: 0,
          resolvedAt: null,
        });
        s.lastCreatedAt = now;
      }
    }
    host.setState(s);
    return s;
  }

  function toAi(s: DemoTasksState, t: DemoTask, now: number) {
    const c = company();
    if (c.aiWorkers <= 0) throw new GameError("no_ai_workers");
    const branch = defOf(t.key)?.branch ?? "";
    const trained = (c.aiWorkerSkills ?? []).some((k) => k.startsWith(`${branch}_`));
    const queued = s.tasks.filter((x) => x.status === "ai").length;
    t.status = "ai";
    t.assigneeAi = true;
    t.mine = false;
    t.aiDoneAt = now + aiMinutes(queued) * 60_000;
    t.aiChanceBps = Math.min(9_500, cfg.ai.chanceBps + (trained ? cfg.ai.skillBonusBps : 0));
  }

  function state(s: DemoTasksState): CompanyTasks {
    const c = company();
    const me = host.nickname();
    return {
      role: "founder",
      company: { id: "demo-company", name: c.name, tier: c.tier, product: c.productKey ?? null },
      myTier: "c_level",
      autoAi: s.autoAi,
      aiWorkers: c.aiWorkers,
      aiMinutes: aiMinutes(s.tasks.filter((t) => t.status === "ai").length),
      canUseAi: c.aiWorkers > 0,
      people: [],
      tasks: s.tasks
        .filter((t) => ["open", "assigned", "playing", "ai"].includes(t.status))
        .sort((a, b) => a.dueAt - b.dueAt)
        .map((t) => ({
          id: t.id,
          key: t.key,
          game: defOf(t.key)?.game ?? "math",
          branch: defOf(t.key)?.branch ?? "",
          status: t.status as "open" | "assigned" | "playing" | "ai",
          valueCents: t.valueCents,
          createdAt: new Date(t.createdAt).toISOString(),
          dueAt: new Date(t.dueAt).toISOString(),
          assignee: t.mine ? me : null,
          assigneeAi: t.assigneeAi,
          assignedBy: t.mine || t.assigneeAi ? me : null,
          aiDoneAt: t.aiDoneAt === null ? null : new Date(t.aiDoneAt).toISOString(),
          openedAt: t.openedAt === null ? null : new Date(t.openedAt).toISOString(),
          mine: t.mine,
          canDelegate: t.status === "open" || t.status === "assigned",
        })),
      history: s.tasks
        .filter((t) => t.resolvedAt !== null)
        .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
        .slice(0, cfg.historyLimit)
        .map((t) => ({
          id: t.id,
          key: t.key,
          status: t.status as "success" | "failure" | "missed",
          resultCents: t.resultCents,
          scoreBps: t.scoreBps,
          ai: t.assigneeAi,
          doneBy: t.assigneeAi ? null : me,
          resolvedAt: new Date(t.resolvedAt ?? 0).toISOString(),
        })),
    };
  }

  const find = (s: DemoTasksState, id: number) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) throw new GameError("task_not_found");
    return t;
  };

  /** One funny item per slot of a few minutes, the same for every reload within the slot. */
  function funItems(now: number): NewsFeedItem[] {
    const slot = Math.floor(now / (fun.everyMinutes * 60_000));
    return Array.from({ length: 6 }, (_, i) => {
      const n = slot - i;
      const item = fun.items[((n % fun.items.length) + fun.items.length) % fun.items.length]!;
      return {
        id: `f${n}`,
        kind: "fun" as const,
        at: new Date(n * fun.everyMinutes * 60_000).toISOString(),
        headline: null,
        body: null,
        ticker: "KLS",
        name: "KlarSoft AG",
        direction: null,
        newsKind: null,
        payload: {},
        product: null,
        tier: null,
        category: null,
        itemKey: item.key,
        nickname: host.nickname(),
      };
    });
  }

  return {
    async companyTasks() {
      return state(tick());
    },
    delegateCompanyTask: (requestId, taskId, to) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const s = tick();
          const t = find(s, taskId);
          if (!["open", "assigned"].includes(t.status) || t.dueAt <= host.now()) throw new GameError("task_closed");
          if (to === "ai") toAi(s, t, host.now());
          else if (to === "me") {
            t.status = "assigned";
            t.mine = true;
            t.assigneeAi = false;
          } else throw new GameError("task_not_allowed");
          host.setState(s);
          return state(s);
        }),
      ),
    startCompanyTask: (requestId, taskId) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const s = tick();
          const t = find(s, taskId);
          const def = defOf(t.key);
          if (!def) throw new GameError("task_not_found");
          if (t.status !== "playing") {
            if (!["open", "assigned"].includes(t.status) || t.dueAt <= host.now()) throw new GameError("task_closed");
            const { puzzle, solution } = generatePuzzle(def, host.random);
            t.status = "playing";
            t.mine = true;
            t.openedAt = host.now();
            t.puzzle = puzzle as Record<string, unknown>;
            t.solution = solution;
            host.setState(s);
          }
          return {
            id: t.id,
            key: t.key,
            game: def.game,
            puzzle: t.puzzle ?? {},
            openedAt: new Date(t.openedAt ?? host.now()).toISOString(),
            seconds: cfg.games[def.game].seconds,
            valueCents: t.valueCents,
            dueAt: new Date(t.dueAt).toISOString(),
          };
        }),
      ),
    submitCompanyTask: (requestId, taskId, answer) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const s = load();
          const t = find(s, taskId);
          const def = defOf(t.key);
          if (!def || !t.solution || t.openedAt === null) throw new GameError("task_not_found");
          if (t.status !== "playing") throw new GameError("task_closed");
          const late = host.now() - t.openedAt > (cfg.games[def.game].seconds + cfg.graceSeconds) * 1000;
          const score = late ? 0 : gradeAnswer(def.game, t.solution, answer);
          resolve(s, t, score, false, host.now());
          host.setState(s);
          const status = t.status as DemoTask["status"] as "success" | "failure" | "missed";
          return {
            id: t.id,
            key: t.key,
            status,
            scoreBps: score,
            resultCents: t.resultCents,
            xp: status === "success" ? cfg.xp.success : cfg.xp.failure,
            late,
            solution: t.solution as Record<string, unknown>,
          };
        }),
      ),
    setJobSupervisor: () => Promise.reject(new GameError("task_not_allowed")),
    setCompanyTasksAutoAi: (requestId, on) =>
      Promise.resolve().then(() =>
        host.idempotent(requestId, () => {
          const s = tick();
          s.autoAi = on;
          host.setState(s);
          return state(s);
        }),
      ),
    async newsFeed(kind, limit) {
      const now = host.now();
      const stock: NewsFeedItem[] = (await host.stockNews(10)).map((n) => ({
        id: `s${n.id}`,
        kind: "stock",
        at: n.publishedAt,
        headline: n.headline,
        body: n.body,
        ticker: n.ticker,
        name: n.name,
        direction: n.direction,
        newsKind: null,
        payload: {},
        product: null,
        tier: null,
        category: null,
        itemKey: null,
        nickname: null,
      }));
      const c = host.company();
      const own: NewsFeedItem[] = c
        ? host.companyNews().map((n) => ({
            id: `c${n.id}`,
            kind: "company",
            at: n.createdAt,
            headline: null,
            body: null,
            ticker: null,
            name: c.name,
            direction: null,
            newsKind: n.kind,
            payload: n.payload,
            product: c.productKey ?? null,
            tier: c.tier,
            category: null,
            itemKey: null,
            nickname: null,
          }))
        : [];
      return [...stock, ...own, ...funItems(now)]
        .filter((i) => kind === "all" || i.kind === kind)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit);
    },
  };
}
