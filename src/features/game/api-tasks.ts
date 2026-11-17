import { z } from "zod";
import { TASK_GAMES } from "@/config/company-tasks";
import type {
  CompanyAutopilot,
  CompanyTaskPlay,
  CompanyTaskResult,
  CompanyTasks,
  GameEngine,
  NewsFeedItem,
} from "./types";
import { rpc } from "./rpc";

/*
 * Company tasks with mini-games and the news feed (ADR-129) against the server.
 */
const tier = z.enum(["intern", "junior", "senior", "team_lead", "c_level"]);
const game = z.enum(TASK_GAMES);

const tasksSchema = z.object({
  role: z.enum(["founder", "employee"]),
  company: z.object({ id: z.string(), name: z.string(), tier: z.string(), product: z.string().nullable() }),
  momentum: z
    .number()
    .nullable()
    .default(1)
    .transform((v) => v ?? 1),
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

const num = z.number().nullable().default(null);

/** Autopilot and the last hour's economy (ADR-180). */
const autopilotSchema = z.object({
  on: z.boolean(),
  can_toggle: z
    .boolean()
    .nullable()
    .transform((v) => v === true),
  mood: z.number(),
  chance_bps: z.number(),
  reward_bps: z.number(),
  fail_penalty_bps: z.number(),
  max_per_day: z.number(),
  every_minutes: z.number(),
  pay_factor_bps: z.number(),
  today: z.object({ done: z.number(), success: z.number(), cents: z.number() }),
  log: z.array(
    z.object({
      at: z.string(),
      key: z.string(),
      success: z.boolean(),
      result_cents: z.number(),
      chance_bps: z.number(),
    }),
  ),
  last_hour: z
    .object({
      hour_start: z.string(),
      revenue_cents: z.number(),
      profit_cents: z.number(),
      demand_cents: z.number(),
      capacity_cents: z.number(),
      ai_workers: z.number(),
      ai_wages_due_cents: z.number(),
      ai_utilization_bps: num,
      awareness_before: num,
      awareness_after: num,
      awareness_parts: z
        .object({
          word_of_mouth: z.number(),
          marketing: z.number(),
          decay: z.number(),
          extra: z.number(),
          cap: z.number(),
        })
        .nullable()
        .default(null),
    })
    .nullable(),
});

export const toAutopilot = (r: z.infer<typeof autopilotSchema>): CompanyAutopilot => ({
  on: r.on,
  canToggle: r.can_toggle,
  mood: r.mood,
  chanceBps: r.chance_bps,
  rewardBps: r.reward_bps,
  failPenaltyBps: r.fail_penalty_bps,
  maxPerDay: r.max_per_day,
  everyMinutes: r.every_minutes,
  payFactorBps: r.pay_factor_bps,
  today: r.today,
  log: r.log.map((l) => ({
    at: l.at,
    key: l.key,
    success: l.success,
    resultCents: l.result_cents,
    chanceBps: l.chance_bps,
  })),
  lastHour: r.last_hour
    ? {
        hourStart: r.last_hour.hour_start,
        revenueCents: r.last_hour.revenue_cents,
        profitCents: r.last_hour.profit_cents,
        demandCents: r.last_hour.demand_cents,
        capacityCents: r.last_hour.capacity_cents,
        aiWorkers: r.last_hour.ai_workers,
        aiWagesDueCents: r.last_hour.ai_wages_due_cents,
        aiUtilizationBps: r.last_hour.ai_utilization_bps,
        awarenessBefore: r.last_hour.awareness_before,
        awarenessAfter: r.last_hour.awareness_after,
        awarenessParts: r.last_hour.awareness_parts
          ? {
              wordOfMouth: r.last_hour.awareness_parts.word_of_mouth,
              marketing: r.last_hour.awareness_parts.marketing,
              decay: r.last_hour.awareness_parts.decay,
              extra: r.last_hour.awareness_parts.extra,
              cap: r.last_hour.awareness_parts.cap,
            }
          : null,
      }
    : null,
});

export const TASK_RPC_SCHEMAS = {
  get_company_autopilot: autopilotSchema,
  set_company_autopilot: autopilotSchema,
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
  momentum: r.momentum,
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
  | "companyAutopilot"
  | "setCompanyAutopilot"
  | "newsFeed"
> = {
  async companyAutopilot() {
    return toAutopilot(await rpc("get_company_autopilot", {}, autopilotSchema));
  },
  async setCompanyAutopilot(requestId, on) {
    return toAutopilot(await rpc("set_company_autopilot", { p_request_id: requestId, p_on: on }, autopilotSchema));
  },
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
