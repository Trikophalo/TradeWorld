import { z } from "zod";
import type { SectorKey } from "@/components/pixel/art";
import type { SkillBranch } from "@/config/skills";
import { applicationSchema, toApplication } from "./api-careers";
import { rpc, toErrorKey } from "./rpc";
import type { CompanyApplication, CompanyPosting, GameEngine, MyCompany, TeamMember } from "./types";

/*
 * Live engine part for player companies (ADR-057, docs/PLAYER_COMPANIES.md,
 * docs/DATA_MODEL.md section "M3c").
 */

const num = z.number();
const iso = z.string();
const tier = z.enum(["intern", "junior", "senior", "team_lead", "c_level"]);
const required = z.array(z.object({ branch: z.string(), min_score: num }));

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
});

const companySchema = z.object({
  id: z.string(),
  name: z.string(),
  idea: z.string(),
  sector: z.string(),
  color: z.string(),
  tier: z.enum(["garage", "small_business"]),
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
});

const wrapped = z.object({ company: companySchema.nullable() });

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
});

const applicantSchema = z.object({
  nickname: z.string(),
  avatar_key: z.string(),
  level: num,
  match_score: num,
  branch_scores: z.record(z.string(), num),
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
});

export const COMPANY_RPC_SCHEMAS = {
  check_company_name: z.object({ allowed: z.boolean(), reason: z.string().nullable() }),
  found_company: z.union([wrapped, companySchema]),
  get_my_company: wrapped,
  set_company_marketing: wrapped,
  set_ai_workers: wrapped,
  company_deposit: wrapped,
  company_withdraw: wrapped,
  upgrade_company: wrapped,
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
        }
      : null,
    history: c.history.map((h) => ({ label: h.label, revenueCents: h.revenue_cents, profitCents: h.profit_cents })),
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
  | "setCompanyMarketing"
  | "setAiWorkers"
  | "companyDeposit"
  | "companyWithdraw"
  | "upgradeCompany"
  | "companyPostings"
  | "createJobPosting"
  | "closeJobPosting"
  | "companyApplications"
  | "respondApplication"
  | "companyTeam"
  | "fireEmployee"
  | "respondRaise"
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
      },
      S.found_company,
    );
    return "company" in r ? requireCompany(r) : toCompany(r);
  },

  async myCompany() {
    const r = await rpc("get_my_company", {}, S.get_my_company);
    return r.company ? toCompany(r.company) : null;
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
    }));
  },

  async fireEmployee(requestId, playerJobId) {
    const r = await rpc("fire_employee", { p_request_id: requestId, p_player_job_id: playerJobId }, S.fire_employee);
    return { severanceCents: r.severance_cents };
  },

  async respondRaise(requestId, playerJobId, accept) {
    await rpc(
      "respond_raise",
      { p_request_id: requestId, p_player_job_id: playerJobId, p_accept: accept },
      S.respond_raise,
    );
  },
};
