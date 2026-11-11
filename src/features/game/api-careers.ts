import { z } from "zod";
import type { SkillBranch } from "@/config/skills";
import type { SectorKey } from "@/components/pixel/art";
import { rpc } from "./rpc";
import type {
  CareerTier,
  DailyRewardState,
  Employer,
  GameEngine,
  JobApplication,
  JobPosting,
  MyJob,
  PlayerCard,
  SkillState,
} from "./types";

/*
 * Live engine part for avatars, daily rewards, skills, jobs and player cards
 * (docs/JOBS_AND_SKILLS.md, docs/DATA_MODEL.md section "M2b").
 */

const num = z.number();
const nnum = z.number().nullable();
const iso = z.string();
const branches = z.record(z.string(), num);
const tier = z.enum(["intern", "junior", "senior", "team_lead", "c_level"]);
const required = z.array(z.object({ branch: z.string(), min_score: num }));

const employerSchema = z.object({
  id: z.string(),
  name: z.string(),
  ticker: z.string().nullable(),
  sector: z.string().nullable(),
  color: z.string().nullable(),
  is_ai: z.boolean(),
});

const dailyRewardSchema = z.object({
  day: num,
  claimable: z.boolean(),
  streak_days: num,
  freezes_left: num,
  next_reset_at: iso,
  cycle: z.array(z.object({ day: num, xp: num, cash_cents: num, skill_points: num })),
});

const claimDailySchema = z.object({
  day: num,
  xp: num,
  cash_cents: num,
  skill_points: num,
  streak_days: num,
  level: num,
  xp_total: num,
  leveled_up: z.boolean(),
});

const skillsSchema = z.object({
  free_points: num,
  branch_points: branches,
  branch_progress: branches,
  branch_scores: branches,
  learned: z.array(z.object({ key: z.string(), learned_at: iso })),
});

const postingSchema = z.object({
  id: z.string(),
  company: employerSchema,
  tier,
  title_key: z.string().nullable(),
  title: z.string().nullable(),
  min_level: num,
  required,
  salary_cents_per_hour: num,
  max_salary_cents_per_hour: nnum,
  match_score: num,
  eligible: z.boolean(),
  slots_open: num,
  posted_at: iso,
  expires_at: iso.nullable(),
  my_application: z.object({ id: z.string(), status: z.string() }).nullable(),
  required_skills: z.array(z.string()).default([]),
});

export const applicationSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "offered", "rejected", "declined", "withdrawn", "expired", "signed", "closed"]),
  posting: z.object({
    id: z.string(),
    company: employerSchema,
    tier,
    title_key: z.string().nullable(),
    title: z.string().nullable(),
    required,
    required_skills: z.array(z.string()).default([]),
  }),
  salary_wish_cents_per_hour: num,
  offer_salary_cents_per_hour: nnum,
  offer_expires_at: iso.nullable(),
  message: z.string().nullable(),
  created_at: iso,
  updated_at: iso,
});

const jobSchema = z.object({
  id: z.string(),
  company: employerSchema,
  tier,
  title_key: z.string().nullable(),
  title: z.string().nullable(),
  required,
  salary_cents_per_hour: num,
  pay_factor_bps: num,
  effective_salary_cents_per_hour: num,
  productivity_bps: num,
  started_at: iso,
  paid_hours_today: num,
  paid_hours_cap: num,
  earned_total_cents: num,
  raise_available_at: iso.nullable(),
  raise_max_bps: num,
  pending_raise: z.object({ requested_bps: num, created_at: iso }).nullable(),
  quit_cost_cents: num,
  signature: z.string().nullable(),
  last_bonus_cents: num.default(0),
  next_work_task_at: iso.nullable().default(null),
  work_task_open: z.boolean().default(false),
  notice_ends_at: iso.nullable().default(null),
});

const cardSchema = z.object({
  nickname: z.string(),
  avatar_key: z.string(),
  level: num,
  rank: nnum,
  net_worth_cents: num,
  streak_days: num,
  skills_learned: num,
  branch_scores: branches,
  top_skills: z.array(z.object({ key: z.string(), tier: num })),
  job: z
    .object({
      company_name: z.string(),
      title_key: z.string().nullable(),
      title: z.string().nullable(),
      tier,
      since: iso,
    })
    .nullable(),
  company: z.object({ name: z.string(), ticker: z.string().nullable() }).nullable(),
  member_since: iso,
});

export const CAREER_RPC_SCHEMAS = {
  set_avatar: z.object({ avatar_key: z.string() }),
  get_daily_reward: dailyRewardSchema,
  claim_daily_reward: claimDailySchema,
  get_my_skills: skillsSchema,
  learn_skill: skillsSchema.extend({ learned_key: z.string() }),
  get_job_board: z.object({ postings: z.array(postingSchema), next_refresh_at: iso.nullable() }),
  apply_for_job: applicationSchema,
  get_my_applications: z.object({ applications: z.array(applicationSchema) }),
  counter_offer: applicationSchema,
  withdraw_application: applicationSchema,
  sign_contract: z.object({ job: jobSchema.nullable() }),
  get_my_job: z.object({ job: jobSchema.nullable() }),
  quit_job: z.union([
    z.object({ notice_ends_at: iso }),
    // Servers before ADR-063 charged one salary and ended the job at once.
    z.object({ paid_cents: num, cash_cents: num }),
  ]),
  cancel_quit: z.object({ job: jobSchema.nullable() }),
  get_employer: z.object({
    employer: z
      .object({
        company: employerSchema,
        kind: z.enum(["ai", "player"]),
        product_key: z.string().nullable(),
        stage: nnum,
        tier: z.enum(["garage", "small_business"]).nullable(),
        founder: z.string().nullable(),
        team_size: num,
        last_quarter: z.object({ label: z.string(), revenue_cents: num, profit_cents: num }).nullable(),
        pay_factor_bps: num,
      })
      .nullable(),
  }),
  request_raise: z.object({ status: z.enum(["accepted", "pending"]), salary_cents_per_hour: num }),
  get_player_card: cardSchema,
} as const;

const S = CAREER_RPC_SCHEMAS;
type Branches = Record<SkillBranch, number>;

const toEmployer = (c: z.infer<typeof employerSchema>): Employer => ({
  id: c.id,
  name: c.name,
  ticker: c.ticker,
  sector: c.sector as SectorKey | null,
  color: c.color,
  isAi: c.is_ai,
});

const toRequired = (r: z.infer<typeof required>) =>
  r.map((x) => ({ branch: x.branch as SkillBranch, minScore: x.min_score }));

const toSkills = (s: z.infer<typeof skillsSchema>): SkillState => ({
  freePoints: s.free_points,
  branchPoints: s.branch_points as Branches,
  branchProgress: s.branch_progress as Branches,
  branchScores: s.branch_scores as Branches,
  learned: s.learned.map((l) => ({ key: l.key, learnedAt: l.learned_at })),
});

const toPosting = (p: z.infer<typeof postingSchema>): JobPosting => ({
  id: p.id,
  company: toEmployer(p.company),
  tier: p.tier,
  titleKey: p.title_key,
  title: p.title,
  minLevel: p.min_level,
  required: toRequired(p.required),
  salaryCentsPerHour: p.salary_cents_per_hour,
  maxSalaryCentsPerHour: p.max_salary_cents_per_hour,
  matchScore: p.match_score,
  eligible: p.eligible,
  slotsOpen: p.slots_open,
  postedAt: p.posted_at,
  expiresAt: p.expires_at,
  myApplication: p.my_application
    ? { id: p.my_application.id, status: p.my_application.status as JobApplication["status"] }
    : null,
  requiredSkills: p.required_skills,
});

export const toApplication = (a: z.infer<typeof applicationSchema>): JobApplication => ({
  id: a.id,
  status: a.status,
  posting: {
    id: a.posting.id,
    company: toEmployer(a.posting.company),
    tier: a.posting.tier,
    titleKey: a.posting.title_key,
    title: a.posting.title,
    required: toRequired(a.posting.required),
    requiredSkills: a.posting.required_skills,
  },
  salaryWishCentsPerHour: a.salary_wish_cents_per_hour,
  offerSalaryCentsPerHour: a.offer_salary_cents_per_hour,
  offerExpiresAt: a.offer_expires_at,
  message: a.message,
  createdAt: a.created_at,
  updatedAt: a.updated_at,
});

const toJob = (j: z.infer<typeof jobSchema>): MyJob => ({
  id: j.id,
  company: toEmployer(j.company),
  tier: j.tier,
  titleKey: j.title_key,
  title: j.title,
  required: toRequired(j.required),
  salaryCentsPerHour: j.salary_cents_per_hour,
  payFactorBps: j.pay_factor_bps,
  effectiveSalaryCentsPerHour: j.effective_salary_cents_per_hour,
  productivityBps: j.productivity_bps,
  startedAt: j.started_at,
  paidHoursToday: j.paid_hours_today,
  paidHoursCap: j.paid_hours_cap,
  earnedTotalCents: j.earned_total_cents,
  raiseAvailableAt: j.raise_available_at,
  raiseMaxBps: j.raise_max_bps,
  pendingRaise: j.pending_raise
    ? { requestedBps: j.pending_raise.requested_bps, createdAt: j.pending_raise.created_at }
    : null,
  quitCostCents: j.quit_cost_cents,
  signature: j.signature,
  lastBonusCents: j.last_bonus_cents,
  nextWorkTaskAt: j.next_work_task_at,
  workTaskOpen: j.work_task_open,
  noticeEndsAt: j.notice_ends_at,
});

type CareerEngine = Pick<
  GameEngine,
  | "setAvatar"
  | "dailyReward"
  | "claimDailyReward"
  | "skills"
  | "learnSkill"
  | "jobBoard"
  | "applyForJob"
  | "applications"
  | "counterOffer"
  | "withdrawApplication"
  | "signContract"
  | "myJob"
  | "quitJob"
  | "cancelQuit"
  | "employer"
  | "requestRaise"
  | "playerCard"
>;

export const liveCareerEngine: CareerEngine = {
  async setAvatar(requestId, avatarKey) {
    const r = await rpc("set_avatar", { p_request_id: requestId, p_avatar_key: avatarKey }, S.set_avatar);
    return r.avatar_key;
  },

  async dailyReward(): Promise<DailyRewardState> {
    const r = await rpc("get_daily_reward", {}, S.get_daily_reward);
    return {
      day: r.day,
      claimable: r.claimable,
      streakDays: r.streak_days,
      freezesLeft: r.freezes_left,
      nextResetAt: r.next_reset_at,
      cycle: r.cycle.map((c) => ({ day: c.day, xp: c.xp, cashCents: c.cash_cents, skillPoints: c.skill_points })),
    };
  },

  async claimDailyReward(requestId) {
    const r = await rpc("claim_daily_reward", { p_request_id: requestId }, S.claim_daily_reward);
    return {
      day: r.day,
      xpAwarded: r.xp,
      cashCents: r.cash_cents,
      skillPoints: r.skill_points,
      streakDays: r.streak_days,
      level: r.level,
      xpTotal: r.xp_total,
      leveledUp: r.leveled_up,
    };
  },

  async skills() {
    return toSkills(await rpc("get_my_skills", {}, S.get_my_skills));
  },

  async learnSkill(requestId, skillKey) {
    return toSkills(await rpc("learn_skill", { p_request_id: requestId, p_skill_key: skillKey }, S.learn_skill));
  },

  async jobBoard() {
    const r = await rpc("get_job_board", {}, S.get_job_board);
    return { postings: r.postings.map(toPosting), nextRefreshAt: r.next_refresh_at };
  },

  async applyForJob(input) {
    const r = await rpc(
      "apply_for_job",
      {
        p_request_id: input.requestId,
        p_posting_id: input.postingId,
        p_salary_wish_cents_per_hour: input.salaryWishCentsPerHour,
        p_message: input.message,
      },
      S.apply_for_job,
    );
    return toApplication(r);
  },

  async applications() {
    const r = await rpc("get_my_applications", {}, S.get_my_applications);
    return r.applications.map(toApplication);
  },

  async counterOffer(requestId, applicationId, salary) {
    const r = await rpc(
      "counter_offer",
      { p_request_id: requestId, p_application_id: applicationId, p_salary_wish_cents_per_hour: salary },
      S.counter_offer,
    );
    return toApplication(r);
  },

  async withdrawApplication(requestId, applicationId) {
    const r = await rpc(
      "withdraw_application",
      { p_request_id: requestId, p_application_id: applicationId },
      S.withdraw_application,
    );
    return toApplication(r);
  },

  async signContract(requestId, applicationId, signature) {
    const r = await rpc(
      "sign_contract",
      { p_request_id: requestId, p_application_id: applicationId, p_signature: signature },
      S.sign_contract,
    );
    if (!r.job) throw new Error("sign_contract returned no job");
    return toJob(r.job);
  },

  async myJob() {
    const r = await rpc("get_my_job", {}, S.get_my_job);
    return r.job ? toJob(r.job) : null;
  },

  async quitJob(requestId) {
    const r = await rpc("quit_job", { p_request_id: requestId }, S.quit_job);
    return { noticeEndsAt: "notice_ends_at" in r ? r.notice_ends_at : new Date().toISOString() };
  },

  async cancelQuit(requestId) {
    const r = await rpc("cancel_quit", { p_request_id: requestId }, S.cancel_quit);
    if (!r.job) throw new Error("cancel_quit returned no job");
    return toJob(r.job);
  },

  async employer() {
    const r = await rpc("get_employer", {}, S.get_employer);
    const e = r.employer;
    if (!e) return null;
    return {
      company: toEmployer(e.company),
      kind: e.kind,
      productKey: e.product_key,
      stage: e.stage,
      tier: e.tier,
      founder: e.founder,
      teamSize: e.team_size,
      lastQuarter: e.last_quarter
        ? {
            label: e.last_quarter.label,
            revenueCents: e.last_quarter.revenue_cents,
            profitCents: e.last_quarter.profit_cents,
          }
        : null,
      payFactorBps: e.pay_factor_bps,
    };
  },

  async requestRaise(requestId, raiseBps) {
    const r = await rpc("request_raise", { p_request_id: requestId, p_raise_bps: raiseBps }, S.request_raise);
    return { status: r.status, salaryCentsPerHour: r.salary_cents_per_hour };
  },

  async playerCard(nickname): Promise<PlayerCard> {
    const c = await rpc("get_player_card", { p_nickname: nickname }, S.get_player_card);
    return {
      nickname: c.nickname,
      avatarKey: c.avatar_key,
      level: c.level,
      rank: c.rank,
      netWorthCents: c.net_worth_cents,
      streakDays: c.streak_days,
      skillsLearned: c.skills_learned,
      branchScores: c.branch_scores as Branches,
      topSkills: c.top_skills,
      job: c.job
        ? {
            companyName: c.job.company_name,
            titleKey: c.job.title_key,
            title: c.job.title,
            tier: c.job.tier as CareerTier,
            since: c.job.since,
          }
        : null,
      company: c.company,
      memberSince: c.member_since,
    };
  },
};
