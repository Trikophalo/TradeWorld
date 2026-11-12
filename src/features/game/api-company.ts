import { z } from "zod";
import type { SectorKey } from "@/components/pixel/art";
import type { SkillBranch } from "@/config/skills";
import { applicationSchema, toApplication } from "./api-careers";
import { rpc, toErrorKey } from "./rpc";
import type {
  ChatMessage,
  CompanyApplication,
  CompanyPosting,
  GameEngine,
  MyCompany,
  Offer,
  TeamMember,
  WorkTask,
} from "./types";

/*
 * Live engine part for player companies (ADR-057, docs/PLAYER_COMPANIES.md,
 * docs/DATA_MODEL.md section "M3c").
 */

const num = z.number();
const iso = z.string();
const tier = z.enum(["intern", "junior", "senior", "team_lead", "c_level"]);
const required = z.array(z.object({ branch: z.string(), min_score: num }));

const nnum = z.number().nullable();

const offerSchema = z.object({
  id: z.string(),
  kind: z.enum(["ipo", "capital_increase"]),
  company: z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    logo: z
      .object({ palette: z.array(z.string()), grid: z.array(z.string()) })
      .nullable()
      .default(null),
    sector: z.string(),
    product_key: z.string().nullable(),
    stage: nnum,
  }),
  ticker: z.string().nullable(),
  price_cents: num,
  shares_offered_e6: num,
  shares_subscribed_e6: num,
  ends_at: iso,
  status: z.enum(["open", "closed"]),
  my_shares_e6: num,
  value_cents: num,
  last_quarter: z.object({ label: z.string(), revenue_cents: num, profit_cents: num }).nullable(),
});

const toOffer = (o: z.infer<typeof offerSchema>): Offer => ({
  id: o.id,
  kind: o.kind,
  company: {
    id: o.company.id,
    name: o.company.name,
    color: o.company.color,
    logo: o.company.logo,
    sector: o.company.sector as SectorKey,
    productKey: o.company.product_key,
    stage: o.company.stage,
  },
  ticker: o.ticker,
  priceCents: o.price_cents,
  sharesOfferedE6: o.shares_offered_e6,
  sharesSubscribedE6: o.shares_subscribed_e6,
  endsAt: o.ends_at,
  status: o.status,
  mySharesE6: o.my_shares_e6,
  valueCents: o.value_cents,
  lastQuarter: o.last_quarter
    ? {
        label: o.last_quarter.label,
        revenueCents: o.last_quarter.revenue_cents,
        profitCents: o.last_quarter.profit_cents,
      }
    : null,
});

const quarterSchema = z.object({
  label: z.string(),
  demand_cents: num,
  capacity_cents: num,
  revenue_cents: num,
  cogs_cents: num,
  fixed_cents: num,
  ai_worker_cents: num,
  marketing_cents: num,
  wages_cents: num,
  operating_profit_cents: num,
  utilization_bps: num,
  bonus_cents: num.default(0),
});

const companySchema = z.object({
  id: z.string(),
  name: z.string(),
  idea: z.string(),
  sector: z.string(),
  color: z.string(),
  tier: z.enum(["garage", "small_business", "gmbh", "ag"]),
  founded_at: iso,
  cash_cents: num,
  value_cents: num,
  unpaid_cents: num,
  distress: z.boolean(),
  awareness_bps: num,
  quality_bps: num,
  quarters_active: num,
  estimate_low_cents: num,
  estimate_high_cents: num,
  marketing_cents_per_quarter: num,
  ai_workers: num,
  ai_worker_cost_cents: num,
  max_employees: num,
  employees: num,
  open_postings: num,
  pending_applications: num,
  founder_productivity_bps: num,
  team_productivity_bps: num,
  capacity_cents: num,
  next_quarter_at: iso,
  can_upgrade: z.boolean(),
  upgrade_cost_cents: num.nullable(),
  last_quarter: quarterSchema.nullable(),
  history: z.array(z.object({ label: z.string(), revenue_cents: num, profit_cents: num })),
  pay_factor_bps: num.default(10_000),
  logo: z
    .object({ palette: z.array(z.string()), grid: z.array(z.string()) })
    .nullable()
    .default(null),
  logo_hidden: z.boolean().default(false),
  banner: z
    .object({ palette: z.array(z.string()), grid: z.array(z.string()) })
    .nullable()
    .default(null),
  founder_has_job: z.boolean().default(false),
  full_time_from: num.default(5),
  headcount: num.default(0),
  listing: z
    .object({
      status: z.enum(["subscription", "listed"]),
      ticker: z.string().nullable(),
      shares_total_e6: num,
      founder_shares_e6: num,
      offer: z.lazy(() => offerSchema).nullable(),
      last_price_e4: nnum,
    })
    .nullable()
    .default(null),
  can_go_public: z.boolean().default(false),
  can_capital_increase: z.boolean().default(false),
  distress_quarters: num.default(0),
  grace_quarters: num.default(4),
  product_key: z.string().default(""),
  stage: num.default(0),
  stages: z
    .array(
      z.object({
        stage: num,
        reached: z.boolean(),
        skills: z.array(
          z.object({ key: z.string(), covered_by: z.string().nullable(), covered_by_ai: z.boolean().default(false) }),
        ),
      }),
    )
    .default([]),
  ai_worker_skills: z.array(z.string()).default([]),
  training_from: num.default(5),
  live: z
    .object({
      last_hour_at: iso,
      revenue_per_hour_cents: num,
      profit_per_hour_cents: num,
      pay_factor_bps: num,
      today_revenue_cents: num,
      today_profit_cents: num,
      quarter_revenue_cents: num,
      quarter_profit_cents: num,
      contract_revenue_per_hour_cents: num.default(0),
      demand_per_hour_cents: num.default(0),
      capacity_per_hour_cents: num.default(0),
      fixed_per_hour_cents: num.default(0),
      ai_wages_per_hour_cents: num.default(0),
      marketing_per_hour_cents: num.default(0),
    })
    .nullable()
    .default(null),
  hours: z
    .array(z.object({ hour_start: iso, revenue_cents: num, profit_cents: num, contract_revenue_cents: num.default(0) }))
    .default([]),
  ai_wage_cents_per_hour: num.default(12_000),
  price_level: z.enum(["budget", "normal", "premium"]).default("normal"),
  contract_work: z.boolean().default(false),
  expansion_level: num.default(0),
  can_expand: z.boolean().default(false),
  expansion_cost_cents: num.nullable().default(null),
  market_factor: num.default(1),
});

const wrapped = z.object({ company: companySchema.nullable() });

const dissolutionSchema = z.object({
  company_name: z.string(),
  reason: z.enum(["insolvent", "closed"]),
  at: iso,
  total_debt_cents: num,
  from_founder_cents: num,
  loan_cents: num,
});

const overviewSchema = z.object({
  company: companySchema.nullable(),
  last_dissolution: dissolutionSchema.nullable().default(null),
});

const messageSchema = z.object({
  id: num,
  kind: z.enum(["player", "system"]),
  author: z.string().nullable(),
  avatar_key: z.string().nullable(),
  is_me: z.boolean(),
  is_founder: z.boolean(),
  body: z.string(),
  created_at: iso,
});

const taskSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("finance_choice"),
    params: z.object({
      amount_cents: num,
      years: num,
      offers: z.array(z.object({ rate_bps: num, fee_cents: num })),
    }),
    created_at: iso,
    expires_at: iso,
    started_at: iso.nullable(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("sales_pick"),
    params: z.object({
      customers: z.array(z.object({ units: num, price_cents: num, unit_cost_cents: num, service_cents: num })),
    }),
    created_at: iso,
    expires_at: iso,
    started_at: iso.nullable(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("analyst_estimate"),
    params: z.object({
      revenue_cents: num,
      cogs_bps: num,
      fixed_cents: num,
      marketing_cents: num,
      options: z.array(num),
    }),
    created_at: iso,
    expires_at: iso,
    started_at: iso.nullable(),
  }),
]);

const postingSchema = z.object({
  id: z.string(),
  tier,
  title: z.string().nullable(),
  title_key: z.string().nullable(),
  required,
  salary_cents_per_hour: num,
  slots: num,
  slots_open: num,
  status: z.enum(["open", "closed"]),
  applications_pending: num,
  posted_at: iso,
  required_skills: z.array(z.string()).default([]),
});

const applicantSchema = z.object({
  nickname: z.string(),
  avatar_key: z.string(),
  level: num,
  match_score: num,
  branch_scores: z.record(z.string(), num),
  skills: z.array(z.string()).default([]),
});

const memberSchema = z.object({
  player_job_id: z.string(),
  nickname: z.string(),
  avatar_key: z.string(),
  title: z.string(),
  salary_cents_per_hour: num,
  productivity_bps: num,
  started_at: iso,
  pending_raise: z.object({ requested_bps: num, created_at: iso }).nullable(),
  skills: z.array(z.string()).default([]),
  notice_ends_at: iso.nullable().default(null),
});

export const COMPANY_RPC_SCHEMAS = {
  check_company_name: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
  found_company: z.union([wrapped, companySchema]),
  get_my_company: overviewSchema,
  close_company: z.object({
    from_company_cents: num,
    from_founder_cents: num,
    loan_cents: num,
    to_founder_cents: num,
    total_debt_cents: num,
  }),
  get_company_chat: z.object({
    company: z.object({ id: z.string(), name: z.string(), color: z.string() }).nullable(),
    members: num,
    messages: z.array(messageSchema),
  }),
  post_company_message: messageSchema,
  get_work_task: z.object({ task: taskSchema.nullable(), next_task_at: iso.nullable() }),
  submit_work_task: z.object({
    correct: z.boolean(),
    correct_index: num,
    xp: num,
    bonus_cents: num,
    level: num,
    xp_total: num,
  }),
  set_company_marketing: wrapped,
  set_ai_workers: wrapped,
  hire_ai_workers: wrapped,
  dismiss_ai_worker: wrapped,
  company_deposit: wrapped,
  company_withdraw: wrapped,
  upgrade_company: wrapped,
  set_company_strategy: wrapped,
  expand_company: wrapped,
  get_company_postings: z.object({ postings: z.array(postingSchema) }),
  create_job_posting: z.object({ id: z.string() }).passthrough(),
  close_job_posting: z.object({ id: z.string(), status: z.literal("closed") }),
  get_company_applications: z.object({
    applications: z.array(applicationSchema.extend({ applicant: applicantSchema })),
  }),
  respond_application: z.object({ id: z.string() }).passthrough(),
  get_company_team: z.object({ members: z.array(memberSchema) }),
  fire_employee: z.object({ player_job_id: z.string(), status: z.literal("fired"), severance_cents: num }),
  respond_raise: z.object({ status: z.enum(["accepted", "rejected"]), salary_cents_per_hour: num }),
  set_company_logo: wrapped,
  set_company_banner: wrapped,
  report_company_logo: z.object({ reported: z.boolean() }),
  go_public: wrapped,
  capital_increase: wrapped,
  get_offers: z.object({ offers: z.array(offerSchema) }),
  subscribe_offer: z.object({ shares_e6: num, amount_cents: num, offer: offerSchema }),
  train_employee: z.object({ skill_key: z.string(), cost_cents: num, salary_cents_per_hour: num }),
} as const;

const S = COMPANY_RPC_SCHEMAS;

function toCompany(c: z.infer<typeof companySchema>): MyCompany {
  return {
    id: c.id,
    name: c.name,
    idea: c.idea,
    sector: c.sector as SectorKey,
    color: c.color,
    tier: c.tier,
    foundedAt: c.founded_at,
    cashCents: c.cash_cents,
    valueCents: c.value_cents,
    unpaidCents: c.unpaid_cents,
    distress: c.distress,
    awarenessBps: c.awareness_bps,
    qualityBps: c.quality_bps,
    quartersActive: c.quarters_active,
    estimateLowCents: c.estimate_low_cents,
    estimateHighCents: c.estimate_high_cents,
    marketingCentsPerQuarter: c.marketing_cents_per_quarter,
    aiWorkers: c.ai_workers,
    aiWorkerCostCents: c.ai_worker_cost_cents,
    maxEmployees: c.max_employees,
    employees: c.employees,
    openPostings: c.open_postings,
    pendingApplications: c.pending_applications,
    founderProductivityBps: c.founder_productivity_bps,
    teamProductivityBps: c.team_productivity_bps,
    capacityCents: c.capacity_cents,
    nextQuarterAt: c.next_quarter_at,
    canUpgrade: c.can_upgrade,
    upgradeCostCents: c.upgrade_cost_cents,
    lastQuarter: c.last_quarter
      ? {
          label: c.last_quarter.label,
          demandCents: c.last_quarter.demand_cents,
          capacityCents: c.last_quarter.capacity_cents,
          revenueCents: c.last_quarter.revenue_cents,
          cogsCents: c.last_quarter.cogs_cents,
          fixedCents: c.last_quarter.fixed_cents,
          aiWorkerCents: c.last_quarter.ai_worker_cents,
          marketingCents: c.last_quarter.marketing_cents,
          wagesCents: c.last_quarter.wages_cents,
          operatingProfitCents: c.last_quarter.operating_profit_cents,
          utilizationBps: c.last_quarter.utilization_bps,
          bonusCents: c.last_quarter.bonus_cents,
        }
      : null,
    history: c.history.map((h) => ({ label: h.label, revenueCents: h.revenue_cents, profitCents: h.profit_cents })),
    payFactorBps: c.pay_factor_bps,
    logo: c.logo,
    banner: c.banner,
    logoHidden: c.logo_hidden,
    founderHasJob: c.founder_has_job,
    fullTimeFrom: c.full_time_from,
    headcount: c.headcount,
    listing: c.listing
      ? {
          status: c.listing.status,
          ticker: c.listing.ticker,
          sharesTotalE6: c.listing.shares_total_e6,
          founderSharesE6: c.listing.founder_shares_e6,
          offer: c.listing.offer ? toOffer(c.listing.offer) : null,
          lastPriceE4: c.listing.last_price_e4,
        }
      : null,
    canGoPublic: c.can_go_public,
    canCapitalIncrease: c.can_capital_increase,
    productKey: c.product_key,
    stage: c.stage,
    stages: c.stages.map((st) => ({
      stage: st.stage,
      reached: st.reached,
      skills: st.skills.map((k) => ({ key: k.key, coveredBy: k.covered_by, coveredByAi: k.covered_by_ai })),
    })),
    distressQuarters: c.distress_quarters,
    graceQuarters: c.grace_quarters,
    aiWorkerSkills: c.ai_worker_skills,
    trainingFrom: c.training_from,
    live: c.live
      ? {
          lastHourAt: c.live.last_hour_at,
          revenuePerHourCents: c.live.revenue_per_hour_cents,
          profitPerHourCents: c.live.profit_per_hour_cents,
          payFactorBps: c.live.pay_factor_bps,
          todayRevenueCents: c.live.today_revenue_cents,
          todayProfitCents: c.live.today_profit_cents,
          quarterRevenueCents: c.live.quarter_revenue_cents,
          quarterProfitCents: c.live.quarter_profit_cents,
          contractRevenuePerHourCents: c.live.contract_revenue_per_hour_cents,
          demandPerHourCents: c.live.demand_per_hour_cents,
          capacityPerHourCents: c.live.capacity_per_hour_cents,
          fixedPerHourCents: c.live.fixed_per_hour_cents,
          aiWagesPerHourCents: c.live.ai_wages_per_hour_cents,
          marketingPerHourCents: c.live.marketing_per_hour_cents,
        }
      : null,
    hours: c.hours.map((h) => ({
      hourStart: h.hour_start,
      revenueCents: h.revenue_cents,
      profitCents: h.profit_cents,
      contractRevenueCents: h.contract_revenue_cents,
    })),
    aiWageCentsPerHour: c.ai_wage_cents_per_hour,
    priceLevel: c.price_level,
    contractWork: c.contract_work,
    expansionLevel: c.expansion_level,
    canExpand: c.can_expand,
    expansionCostCents: c.expansion_cost_cents,
    marketFactor: c.market_factor,
  };
}

const toMessage = (m: z.infer<typeof messageSchema>): ChatMessage => ({
  id: m.id,
  kind: m.kind,
  author: m.author,
  avatarKey: m.avatar_key,
  isMe: m.is_me,
  isFounder: m.is_founder,
  body: m.body,
  createdAt: m.created_at,
});

function toTask(t: z.infer<typeof taskSchema>): WorkTask {
  const base = { id: t.id, createdAt: t.created_at, expiresAt: t.expires_at, startedAt: t.started_at };
  if (t.kind === "finance_choice") {
    return {
      ...base,
      kind: t.kind,
      params: {
        amountCents: t.params.amount_cents,
        years: t.params.years,
        offers: t.params.offers.map((o) => ({ rateBps: o.rate_bps, feeCents: o.fee_cents })),
      },
    };
  }
  if (t.kind === "sales_pick") {
    return {
      ...base,
      kind: t.kind,
      params: {
        customers: t.params.customers.map((c) => ({
          units: c.units,
          priceCents: c.price_cents,
          unitCostCents: c.unit_cost_cents,
          serviceCents: c.service_cents,
        })),
      },
    };
  }
  return {
    ...base,
    kind: t.kind,
    params: {
      revenueCents: t.params.revenue_cents,
      cogsBps: t.params.cogs_bps,
      fixedCents: t.params.fixed_cents,
      marketingCents: t.params.marketing_cents,
      options: t.params.options,
    },
  };
}

function requireCompany(r: z.infer<typeof wrapped>): MyCompany {
  if (!r.company) throw new Error("company missing in response");
  return toCompany(r.company);
}

type CompanyEngine = Pick<
  GameEngine,
  | "checkCompanyName"
  | "foundCompany"
  | "myCompany"
  | "closeCompany"
  | "companyChat"
  | "postCompanyMessage"
  | "workTask"
  | "submitWorkTask"
  | "setCompanyMarketing"
  | "setAiWorkers"
  | "hireAiWorkers"
  | "dismissAiWorker"
  | "companyDeposit"
  | "companyWithdraw"
  | "upgradeCompany"
  | "setCompanyStrategy"
  | "expandCompany"
  | "companyPostings"
  | "createJobPosting"
  | "closeJobPosting"
  | "companyApplications"
  | "respondApplication"
  | "companyTeam"
  | "fireEmployee"
  | "respondRaise"
  | "trainEmployee"
  | "setCompanyLogo"
  | "setCompanyBanner"
  | "reportCompanyLogo"
  | "goPublic"
  | "capitalIncrease"
  | "offers"
  | "subscribeOffer"
>;

export const liveCompanyEngine: CompanyEngine = {
  async checkCompanyName(name) {
    const r = await rpc("check_company_name", { p_name: name }, S.check_company_name);
    return { allowed: r.allowed, reason: r.reason ? toErrorKey(r.reason) : null };
  },

  async foundCompany(input) {
    const r = await rpc(
      "found_company",
      {
        p_request_id: input.requestId,
        p_name: input.name,
        p_idea: input.idea,
        p_sector: input.sector,
        p_color: input.color,
        p_tier: input.tier,
        p_product: input.product,
      },
      S.found_company,
    );
    return "company" in r ? requireCompany(r) : toCompany(r);
  },

  async myCompany() {
    const r = await rpc("get_my_company", {}, S.get_my_company);
    const d = r.last_dissolution;
    return {
      company: r.company ? toCompany(r.company) : null,
      lastDissolution: d
        ? {
            companyName: d.company_name,
            reason: d.reason,
            at: d.at,
            totalDebtCents: d.total_debt_cents,
            fromFounderCents: d.from_founder_cents,
            loanCents: d.loan_cents,
          }
        : null,
    };
  },

  async closeCompany(requestId) {
    const r = await rpc("close_company", { p_request_id: requestId }, S.close_company);
    return {
      fromCompanyCents: r.from_company_cents,
      fromFounderCents: r.from_founder_cents,
      loanCents: r.loan_cents,
      toFounderCents: r.to_founder_cents,
      totalDebtCents: r.total_debt_cents,
    };
  },

  async companyChat(beforeId) {
    const r = await rpc("get_company_chat", { p_before_id: beforeId ?? null }, S.get_company_chat);
    return { company: r.company, members: r.members, messages: r.messages.map(toMessage) };
  },

  async postCompanyMessage(requestId, body) {
    return toMessage(
      await rpc("post_company_message", { p_request_id: requestId, p_body: body }, S.post_company_message),
    );
  },

  async workTask() {
    const r = await rpc("get_work_task", {}, S.get_work_task);
    return { task: r.task ? toTask(r.task) : null, nextTaskAt: r.next_task_at };
  },

  async submitWorkTask(requestId, taskId, choice) {
    const r = await rpc(
      "submit_work_task",
      { p_request_id: requestId, p_task_id: taskId, p_choice: choice },
      S.submit_work_task,
    );
    return {
      correct: r.correct,
      correctIndex: r.correct_index,
      xpAwarded: r.xp,
      bonusCents: r.bonus_cents,
      level: r.level,
      xpTotal: r.xp_total,
    };
  },

  async setCompanyMarketing(requestId, marketingCents) {
    return requireCompany(
      await rpc(
        "set_company_marketing",
        { p_request_id: requestId, p_marketing_cents: marketingCents },
        S.set_company_marketing,
      ),
    );
  },

  async setAiWorkers(requestId, count) {
    return requireCompany(await rpc("set_ai_workers", { p_request_id: requestId, p_count: count }, S.set_ai_workers));
  },

  async hireAiWorkers(requestId, count, skill) {
    return requireCompany(
      await rpc(
        "hire_ai_workers",
        { p_request_id: requestId, p_count: count, p_skill: skill ?? null },
        S.hire_ai_workers,
      ),
    );
  },

  async dismissAiWorker(requestId, skill) {
    return requireCompany(
      await rpc("dismiss_ai_worker", { p_request_id: requestId, p_skill: skill ?? null }, S.dismiss_ai_worker),
    );
  },

  async companyDeposit(requestId, amountCents) {
    return requireCompany(
      await rpc("company_deposit", { p_request_id: requestId, p_amount_cents: amountCents }, S.company_deposit),
    );
  },

  async companyWithdraw(requestId, amountCents) {
    return requireCompany(
      await rpc("company_withdraw", { p_request_id: requestId, p_amount_cents: amountCents }, S.company_withdraw),
    );
  },

  async upgradeCompany(requestId) {
    return requireCompany(await rpc("upgrade_company", { p_request_id: requestId }, S.upgrade_company));
  },

  async setCompanyStrategy(requestId, priceLevel, contractWork) {
    return requireCompany(
      await rpc(
        "set_company_strategy",
        { p_request_id: requestId, p_price_level: priceLevel, p_contract_work: contractWork },
        S.set_company_strategy,
      ),
    );
  },

  async expandCompany(requestId) {
    return requireCompany(await rpc("expand_company", { p_request_id: requestId }, S.expand_company));
  },

  async companyPostings(): Promise<CompanyPosting[]> {
    const r = await rpc("get_company_postings", {}, S.get_company_postings);
    return r.postings.map((p) => ({
      id: p.id,
      tier: p.tier,
      title: p.title,
      titleKey: p.title_key,
      required: p.required.map((x) => ({ branch: x.branch as SkillBranch, minScore: x.min_score })),
      salaryCentsPerHour: p.salary_cents_per_hour,
      slots: p.slots,
      slotsOpen: p.slots_open,
      status: p.status,
      applicationsPending: p.applications_pending,
      postedAt: p.posted_at,
      requiredSkills: p.required_skills,
    }));
  },

  async createJobPosting(input) {
    await rpc(
      "create_job_posting",
      {
        p_request_id: input.requestId,
        p_company_id: input.companyId,
        p_tier: input.tier,
        p_title: input.title,
        p_required: input.required.map((r) => ({ branch: r.branch, min_score: r.minScore })),
        p_salary_cents_per_hour: input.salaryCentsPerHour,
        p_slots: input.slots,
        p_required_skills: input.requiredSkills,
      },
      S.create_job_posting,
    );
  },

  async closeJobPosting(requestId, postingId) {
    await rpc("close_job_posting", { p_request_id: requestId, p_posting_id: postingId }, S.close_job_posting);
  },

  async companyApplications(companyId): Promise<CompanyApplication[]> {
    const r = await rpc("get_company_applications", { p_company_id: companyId }, S.get_company_applications);
    return r.applications.map((a) => ({
      ...toApplication(a),
      applicant: {
        nickname: a.applicant.nickname,
        avatarKey: a.applicant.avatar_key,
        level: a.applicant.level,
        matchScore: a.applicant.match_score,
        branchScores: a.applicant.branch_scores as Record<SkillBranch, number>,
        skills: a.applicant.skills,
      },
    }));
  },

  async respondApplication(requestId, applicationId, action, salary) {
    await rpc(
      "respond_application",
      {
        p_request_id: requestId,
        p_application_id: applicationId,
        p_action: action,
        p_salary_cents_per_hour: salary ?? null,
      },
      S.respond_application,
    );
  },

  async companyTeam(companyId): Promise<TeamMember[]> {
    const r = await rpc("get_company_team", { p_company_id: companyId }, S.get_company_team);
    return r.members.map((m) => ({
      playerJobId: m.player_job_id,
      nickname: m.nickname,
      avatarKey: m.avatar_key,
      title: m.title,
      salaryCentsPerHour: m.salary_cents_per_hour,
      productivityBps: m.productivity_bps,
      startedAt: m.started_at,
      pendingRaise: m.pending_raise
        ? { requestedBps: m.pending_raise.requested_bps, createdAt: m.pending_raise.created_at }
        : null,
      skills: m.skills,
      noticeEndsAt: m.notice_ends_at,
    }));
  },

  async fireEmployee(requestId, playerJobId) {
    const r = await rpc("fire_employee", { p_request_id: requestId, p_player_job_id: playerJobId }, S.fire_employee);
    return { severanceCents: r.severance_cents };
  },

  async setCompanyLogo(requestId, logo) {
    return requireCompany(await rpc("set_company_logo", { p_request_id: requestId, p_logo: logo }, S.set_company_logo));
  },

  async setCompanyBanner(requestId, banner) {
    return requireCompany(
      await rpc("set_company_banner", { p_request_id: requestId, p_banner: banner }, S.set_company_banner),
    );
  },

  async reportCompanyLogo(requestId, companyId) {
    await rpc("report_company_logo", { p_request_id: requestId, p_company_id: companyId }, S.report_company_logo);
  },

  async goPublic(requestId, sharePercent) {
    return requireCompany(
      await rpc("go_public", { p_request_id: requestId, p_share_percent: sharePercent }, S.go_public),
    );
  },

  async capitalIncrease(requestId, sharePercent) {
    return requireCompany(
      await rpc("capital_increase", { p_request_id: requestId, p_share_percent: sharePercent }, S.capital_increase),
    );
  },

  async offers() {
    const r = await rpc("get_offers", {}, S.get_offers);
    return r.offers.map(toOffer);
  },

  async subscribeOffer(requestId, offerId, amountCents) {
    const r = await rpc(
      "subscribe_offer",
      { p_request_id: requestId, p_offer_id: offerId, p_amount_cents: amountCents },
      S.subscribe_offer,
    );
    return { sharesE6: r.shares_e6, amountCents: r.amount_cents };
  },

  async trainEmployee(requestId, playerJobId, skillKey) {
    const r = await rpc(
      "train_employee",
      { p_request_id: requestId, p_player_job_id: playerJobId, p_skill_key: skillKey },
      S.train_employee,
    );
    return { costCents: r.cost_cents, salaryCentsPerHour: r.salary_cents_per_hour };
  },

  async respondRaise(requestId, playerJobId, accept) {
    await rpc(
      "respond_raise",
      { p_request_id: requestId, p_player_job_id: playerJobId, p_accept: accept },
      S.respond_raise,
    );
  },
};
