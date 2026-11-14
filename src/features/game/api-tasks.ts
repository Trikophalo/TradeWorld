import { z } from "zod";
import type { CompanyTaskPlay, CompanyTaskResult, CompanyTasks, GameEngine, NewsFeedItem } from "./types";
import { rpc } from "./rpc";

/*
 * Company tasks with mini-games and the news feed (ADR-129) against the server.
 */
const tier = z.enum(["intern", "junior", "senior", "team_lead", "c_level"]);
const game = z.enum(["pick", "count", "sort", "order", "seq", "math"]);

const tasksSchema = z.object({
  role: z.enum(["founder", "employee"]),
  company: z.object({ id: z.string(), name: z.string(), tier: z.string(), product: z.string().nullable() }),
  my_tier: z.string(),
  auto_ai: z.boolean(),
  ai_workers: z.number(),
  ai_minutes: z.number(),
  can_use_ai: z.boolean(),
  people: z.array(
    z.object({
      nickname: z.string(),
      tag: z.string().nullable().default(null),
      tier,
      is_me: z.boolean(),
      supervisor: z.string().nullable(),
      reports_to_me: z
        .boolean()
        .nullable()
        .transform((v) => v === true),
      open_tasks: z.number(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: z.number(),
      key: z.string(),
      game,
      branch: z.string(),
      status: z.enum(["open", "assigned", "playing", "ai"]),
      value_cents: z.number(),
      created_at: z.string(),
      due_at: z.string(),
      assignee: z.string().nullable(),
      assignee_ai: z.boolean(),
      assigned_by: z.string().nullable(),
      ai_done_at: z.string().nullable(),
      opened_at: z.string().nullable(),
      mine: z
        .boolean()
        .nullable()
        .transform((v) => v === true),
      can_delegate: z
        .boolean()
        .nullable()
        .transform((v) => v === true),
    }),
  ),
  history: z.array(
    z.object({
      id: z.number(),
      key: z.string(),
      status: z.enum(["success", "failure", "missed"]),
      result_cents: z.number(),
      score_bps: z.number().nullable(),
      ai: z.boolean(),
      done_by: z.string().nullable(),
      resolved_at: z.string(),
    }),
  ),
});

const playSchema = z.object({
  id: z.number(),
  key: z.string(),
  game,
  puzzle: z.record(z.string(), z.unknown()),
  opened_at: z.string(),
  seconds: z.number(),
  value_cents: z.number(),
  due_at: z.string(),
});

const resultSchema = z.object({
  id: z.number(),
  key: z.string(),
  status: z.enum(["success", "failure", "missed"]),
  score_bps: z.number().nullable(),
  result_cents: z.number(),
  xp: z.number(),
  late: z.boolean(),
  solution: z.record(z.string(), z.unknown()),
});

const feedSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["stock", "company", "market", "fun"]),
      at: z.string(),
      headline: z.string().nullable().optional(),
      body: z.string().nullable().optional(),
      ticker: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      direction: z.enum(["up", "down"]).nullable().optional(),
      news_kind: z.string().nullable().optional(),
      payload: z.record(z.string(), z.unknown()).nullable().optional(),
      product: z.string().nullable().optional(),
      tier: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      item_key: z.string().nullable().optional(),
      nickname: z.string().nullable().optional(),
    }),
  ),
});

export const TASK_RPC_SCHEMAS = {
  get_company_tasks: tasksSchema,
  delegate_company_task: tasksSchema,
  set_job_supervisor: tasksSchema,
  set_company_tasks_auto_ai: tasksSchema,
  start_company_task: playSchema,
  submit_company_task: resultSchema,
  get_news_feed: feedSchema,
} as const;

export const toTasks = (r: z.infer<typeof tasksSchema>): CompanyTasks => ({
  role: r.role,
  company: r.company,
  myTier: r.my_tier,
  autoAi: r.auto_ai,
  aiWorkers: r.ai_workers,
  aiMinutes: r.ai_minutes,
  canUseAi: r.can_use_ai,
  people: r.people.map((p) => ({
    nickname: p.nickname,
    tag: p.tag,
    tier: p.tier,
    isMe: p.is_me,
    supervisor: p.supervisor,
    reportsToMe: p.reports_to_me,
    openTasks: p.open_tasks,
  })),
  tasks: r.tasks.map((t) => ({
    id: t.id,
    key: t.key,
    game: t.game,
    branch: t.branch,
    status: t.status,
    valueCents: t.value_cents,
    createdAt: t.created_at,
    dueAt: t.due_at,
    assignee: t.assignee,
    assigneeAi: t.assignee_ai,
    assignedBy: t.assigned_by,
    aiDoneAt: t.ai_done_at,
    openedAt: t.opened_at,
    mine: t.mine,
    canDelegate: t.can_delegate,
  })),
  history: r.history.map((h) => ({
    id: h.id,
    key: h.key,
    status: h.status,
    resultCents: h.result_cents,
    scoreBps: h.score_bps,
    ai: h.ai,
    doneBy: h.done_by,
    resolvedAt: h.resolved_at,
  })),
});

const toPlay = (r: z.infer<typeof playSchema>): CompanyTaskPlay => ({
  id: r.id,
  key: r.key,
  game: r.game,
  puzzle: r.puzzle,
  openedAt: r.opened_at,
  seconds: r.seconds,
  valueCents: r.value_cents,
  dueAt: r.due_at,
});

const toResult = (r: z.infer<typeof resultSchema>): CompanyTaskResult => ({
  id: r.id,
  key: r.key,
  status: r.status,
  scoreBps: r.score_bps,
  resultCents: r.result_cents,
  xp: r.xp,
  late: r.late,
  solution: r.solution,
});

const toFeed = (r: z.infer<typeof feedSchema>): NewsFeedItem[] =>
  r.items.map((i) => ({
    id: i.id,
    kind: i.kind,
    at: i.at,
    headline: i.headline ?? null,
    body: i.body ?? null,
    ticker: i.ticker ?? null,
    name: i.name ?? null,
    direction: i.direction ?? null,
    newsKind: i.news_kind ?? null,
    payload: i.payload ?? {},
    product: i.product ?? null,
    tier: i.tier ?? null,
    category: i.category ?? null,
    itemKey: i.item_key ?? null,
    nickname: i.nickname ?? null,
  }));

export const liveTaskEngine: Pick<
  GameEngine,
  | "companyTasks"
  | "delegateCompanyTask"
  | "startCompanyTask"
  | "submitCompanyTask"
  | "setJobSupervisor"
  | "setCompanyTasksAutoAi"
  | "newsFeed"
> = {
  async companyTasks() {
    return toTasks(await rpc("get_company_tasks", {}, tasksSchema));
  },
  async delegateCompanyTask(requestId, taskId, to) {
    return toTasks(
      await rpc("delegate_company_task", { p_request_id: requestId, p_task_id: taskId, p_to: to }, tasksSchema),
    );
  },
  async startCompanyTask(requestId, taskId) {
    return toPlay(await rpc("start_company_task", { p_request_id: requestId, p_task_id: taskId }, playSchema));
  },
  async submitCompanyTask(requestId, taskId, answer) {
    return toResult(
      await rpc("submit_company_task", { p_request_id: requestId, p_task_id: taskId, p_answer: answer }, resultSchema),
    );
  },
  async setJobSupervisor(requestId, nickname, supervisor) {
    return toTasks(
      await rpc(
        "set_job_supervisor",
        { p_request_id: requestId, p_nickname: nickname, p_supervisor: supervisor },
        tasksSchema,
      ),
    );
  },
  async setCompanyTasksAutoAi(requestId, on) {
    return toTasks(await rpc("set_company_tasks_auto_ai", { p_request_id: requestId, p_on: on }, tasksSchema));
  },
  async newsFeed(kind, limit) {
    return toFeed(await rpc("get_news_feed", { p_kind: kind, p_limit: limit }, feedSchema));
  },
};
