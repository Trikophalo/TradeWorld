import { BALANCE } from "@/config/balance";
import { SKILL_BRANCHES, type SkillBranch } from "@/config/skills";
import { DEMO_COMPANIES } from "@/lib/demo/market";
import {
  aiPostingSpec,
  aiSalaryCeiling,
  branchScores,
  emptyBranches,
  learnCheck,
  matchScore,
  maxRaiseBps,
  meetsRequirements,
  oneSalaryCents,
  payForSkill,
  productivityBps,
  skillNode,
} from "@/lib/sim/skills";
import {
  GameError,
  type ApplyInput,
  type CareerTier,
  type DailyRewardResult,
  type DailyRewardState,
  type Employer,
  type GameEngine,
  type JobApplication,
  type JobPosting,
  type MyJob,
  type PlayerCard,
  type SkillState,
  type WorkTask,
  type WorkTaskResult,
} from "../types";
import { createRng } from "@/lib/sim/rng";
import { correctOption, generateWorkTask, gradeWorkTask, workTaskKind } from "@/lib/sim/work-tasks";

/*
 * Demo part for avatars, daily rewards, skills and jobs (docs/JOBS_AND_SKILLS.md).
 * Same rules as the database in simple form. In the demo only AI employers exist,
 * they answer at once.
 */

const { skills: skillCfg, jobs, dailyRewards, avatars, careers } = BALANCE;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface DemoApplication {
  id: string;
  postingId: string;
  status: JobApplication["status"];
  wish: number;
  offer: number | null;
  offerExpiresAt: number | null;
  message: string;
  createdAt: number;
  updatedAt: number;
}

interface DemoJob {
  id: string;
  postingId: string;
  salary: number;
  startedAt: number;
  lastPaidAt: number;
  payDay: string;
  paidMinutesToday: number;
  earnedTotal: number;
  /** Matching score at hiring or the last raise (raises grow with the score gained since). */
  scoreAtRaise: number;
  lastRaiseAt: number | null;
  signature: string;
  /** Quit with notice (ADR-063). */
  noticeEndsAt?: number | null;
}

export interface CareerState {
  avatarKey: string;
  learned: { key: string; at: number }[];
  /** Free points from daily rewards and missions (level-up points are derived from the level). */
  bonusPoints: number;
  spentFree: number;
  branchPoints: Record<SkillBranch, number>;
  workMinutes: Record<SkillBranch, number>;
  dailyDay: number;
  dailyClaimedOn: string | null;
  freezeUsedWeek: string | null;
  applications: DemoApplication[];
  job: DemoJob | null;
  seq: number;
  /** Open or last work task (ADR-059). */
  workTask?: { task: WorkTask; correctIndex: number; done: boolean } | null;
}

export function initialCareer(): CareerState {
  return {
    avatarKey: avatars.defaultKey,
    learned: [],
    bonusPoints: 0,
    spentFree: 0,
    branchPoints: emptyBranches(),
    workMinutes: emptyBranches(),
    dailyDay: 0,
    dailyClaimedOn: null,
    freezeUsedWeek: null,
    applications: [],
    job: null,
    seq: 0,
  };
}

/** What the career part needs from the rest of the demo engine. */
export interface CareerHost {
  state(): CareerState;
  nickname(): string;
  /** Permanent player tag (ADR-085). */
  tag(): string;
  /** League trophies (ADR-089). */
  trophies(): { gold: number; silver: number; bronze: number };
  level(): number;
  /** Adds XP (multiplier applied) and returns the amount. */
  addXp(base: number): number;
  xpTotal(): number;
  cashCents(): number;
  addCash(cents: number): void;
  netWorthCents(): number;
  rank(): number | null;
  streakDays(): number;
  /** Runs the daily check-in (streak, mission event). */
  checkIn(): void;
  day(at?: number): string;
  week(at?: number): string;
  idempotent<T>(requestId: string, run: () => T): T;
  persist(): void;
  /** Founders work in their own company (ADR-045). */
  ownsCompany(): boolean;
  /** The own company for the business card (ADR-075). */
  ownCompany(): { name: string; ticker: string | null } | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function avatarLevel(key: string): number | null {
  return avatars.portraits.find((p) => p.key === key)?.level ?? null;
}

/** A stable portrait for an AI tycoon (only the ones up to level 25). */
export function tycoonAvatar(id: string): string {
  const pool = avatars.portraits.filter((p) => p.level <= 25);
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[hash % pool.length]!.key;
}

const POSTINGS: { posting: Omit<JobPosting, "maxSalaryCentsPerHour" | "matchScore" | "eligible" | "myApplication"> }[] =
  [...DEMO_COMPANIES]
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
    .flatMap((company, c) =>
      Array.from({ length: jobs.aiPostingsPerCompany }, (_, i) => {
        const spec = aiPostingSpec(company.sector, c, i, 0);
        const employer: Employer = {
          id: `demo-${company.ticker}`,
          name: company.name,
          ticker: company.ticker,
          sector: company.sector,
          color: company.color,
          isAi: true,
          logo: null,
        };
        return {
          posting: {
            id: `posting-${company.ticker}-${i}`,
            company: employer,
            tier: spec.tier as CareerTier,
            titleKey: spec.titleKey,
            title: null,
            minLevel: spec.minLevel,
            required: [...spec.required],
            salaryCentsPerHour: spec.salaryCentsPerHour,
            requiredSkills: [],
            slotsOpen: jobs.aiSlotsOpen,
            postedAt: iso(Date.UTC(2026, 10, 1)),
            expiresAt: null,
          },
        };
      }),
    );

export function createCareerEngine(host: CareerHost) {
  const st = () => host.state();

  const scores = () => branchScores(st().learned.map((l) => l.key));
  const freePoints = () =>
    Math.max(0, (host.level() - 1) * skillCfg.freePointsPerLevel + st().bonusPoints - st().spentFree);

  function skillState(): SkillState {
    const s = st();
    const per = skillCfg.workHoursPerBranchPoint * 60;
    return {
      freePoints: freePoints(),
      branchPoints: { ...s.branchPoints },
      branchProgress: Object.fromEntries(SKILL_BRANCHES.map((b) => [b, (s.workMinutes[b] % per) / per])) as Record<
        SkillBranch,
        number
      >,
      branchScores: scores(),
      learned: s.learned.map((l) => ({ key: l.key, learnedAt: iso(l.at) })),
    };
  }

  function postingById(id: string) {
    const found = POSTINGS.find((x) => x.posting.id === id)?.posting;
    if (!found) throw new GameError("job_not_found");
    return found;
  }

  function ceilingFor(posting: (typeof POSTINGS)[number]["posting"]): number {
    return aiSalaryCeiling(posting.salaryCentsPerHour, matchScore(posting.required, scores()));
  }

  function toApplication(a: DemoApplication): JobApplication {
    const posting = postingById(a.postingId);
    return {
      id: a.id,
      status: a.status,
      posting: {
        id: posting.id,
        company: posting.company,
        tier: posting.tier,
        titleKey: posting.titleKey,
        title: posting.title,
        required: posting.required,
        requiredSkills: posting.requiredSkills,
      },
      salaryWishCentsPerHour: a.wish,
      offerSalaryCentsPerHour: a.offer,
      offerExpiresAt: a.offerExpiresAt === null ? null : iso(a.offerExpiresAt),
      message: a.message || null,
      createdAt: iso(a.createdAt),
      updatedAt: iso(a.updatedAt),
    };
  }

  /** Expire old offers. */
  function sweep(now = Date.now()) {
    for (const a of st().applications) {
      if (a.status === "offered" && a.offerExpiresAt !== null && a.offerExpiresAt < now) {
        a.status = "expired";
        a.updatedAt = now;
      }
    }
  }

  /** AI employers answer at once: offer the wish, at most the personal ceiling. */
  function aiOffer(a: DemoApplication, now: number) {
    const posting = postingById(a.postingId);
    // AI employers offer their maximum at once, there is no salary wish (ADR-064).
    a.offer = ceilingFor(posting);
    a.wish = a.offer;
    a.offerExpiresAt = now + jobs.offerValidHours * HOUR;
    a.status = "offered";
    a.updatedAt = now;
  }

  /** Passive salary: up to the daily cap, paid for the time since the last payout. */
  function accrue(now = Date.now()) {
    const job = st().job;
    if (!job) return;
    // The notice period is over: pay up to its end, then the job ends (ADR-063).
    if (job.noticeEndsAt && now >= job.noticeEndsAt) {
      accrueUntil(job, job.noticeEndsAt);
      st().job = null;
      host.persist();
      return;
    }
    accrueUntil(job, now);
  }

  function accrueUntil(job: DemoJob, now: number) {
    const today = host.day(now);
    if (job.payDay !== today) {
      job.payDay = today;
      job.paidMinutesToday = 0;
    }
    const capMinutes = careers.paidHoursPerDayCap * 60;
    const minutes = Math.min(Math.floor((now - job.lastPaidAt) / 60_000), capMinutes - job.paidMinutesToday);
    if (minutes <= 0) {
      job.lastPaidAt = Math.max(job.lastPaidAt, now - 60_000);
      return;
    }
    const pay = Math.floor((job.salary * minutes) / 60);
    host.addCash(pay);
    job.earnedTotal += pay;
    job.paidMinutesToday += minutes;
    job.lastPaidAt = now;
    host.addXp((BALANCE.progression.xpSources.workHour.xp * minutes) / 60);
    const posting = postingById(job.postingId);
    const per = skillCfg.workHoursPerBranchPoint * 60;
    const share = minutes / posting.required.length;
    for (const req of posting.required) {
      const before = Math.floor(st().workMinutes[req.branch] / per);
      st().workMinutes[req.branch] += share;
      const after = Math.floor(st().workMinutes[req.branch] / per);
      st().branchPoints[req.branch] += after - before;
    }
    host.persist();
  }

  function myJobNow(): MyJob | null {
    const job = st().job;
    if (!job) return null;
    const posting = postingById(job.postingId);
    const score = matchScore(posting.required, scores());
    const ceiling = ceilingFor(posting);
    const raiseRoom = Math.max(0, Math.floor(((ceiling - job.salary) * 10_000) / job.salary));
    const raiseAvailable = job.lastRaiseAt === null ? null : job.lastRaiseAt + jobs.raiseRequest.cooldownDays * DAY;
    return {
      id: job.id,
      company: posting.company,
      tier: posting.tier,
      titleKey: posting.titleKey,
      title: posting.title,
      required: posting.required,
      salaryCentsPerHour: job.salary,
      payFactorBps: 10_000,
      effectiveSalaryCentsPerHour: job.salary,
      productivityBps: productivityBps(score),
      startedAt: iso(job.startedAt),
      paidHoursToday: job.paidMinutesToday / 60,
      paidHoursCap: careers.paidHoursPerDayCap,
      earnedTotalCents: job.earnedTotal,
      raiseAvailableAt: raiseAvailable !== null && raiseAvailable > Date.now() ? iso(raiseAvailable) : null,
      raiseMaxBps: Math.min(maxRaiseBps(score - job.scoreAtRaise), raiseRoom),
      pendingRaise: null,
      quitCostCents: oneSalaryCents(job.salary),
      signature: job.signature,
      noticeEndsAt: job.noticeEndsAt ? iso(job.noticeEndsAt) : null,
      quitNowCostCents: job.salary * jobs.quitNowCostHours,
      lastBonusCents: 0,
      nextWorkTaskAt: nextTaskAt(),
      workTaskOpen: openTask() !== null,
    };
  }

  /** Today's cycle day; a missed day restarts the cycle unless this week's freeze is still left. */
  function dailyPlan(): { state: DailyRewardState; usesFreeze: boolean } {
    const s = st();
    const today = host.day();
    const claimedToday = s.dailyClaimedOn === today;
    const freezeLeft = s.freezeUsedWeek !== host.week();
    const continues = claimedToday || s.dailyClaimedOn === host.day(Date.now() - DAY);
    const usesFreeze = !continues && s.dailyClaimedOn !== null && freezeLeft;
    const day = s.dailyClaimedOn === null || (!continues && !usesFreeze) ? 1 : (s.dailyDay % 7) + 1;
    const midnight = new Date(`${today}T00:00:00`).getTime();
    return {
      usesFreeze,
      state: {
        day,
        claimable: !claimedToday,
        streakDays: host.streakDays(),
        freezesLeft: freezeLeft ? dailyRewards.freezesPerWeek : 0,
        nextResetAt: iso(midnight + DAY),
        cycle: dailyRewards.cycle.map((c, i) => ({
          day: i + 1,
          xp: c.xp,
          cashCents: c.cashCents,
          skillPoints: c.skillPoints,
        })),
      },
    };
  }

  /** The open task, if it is still open (not solved, not expired). */
  function openTask() {
    const current = st().workTask;
    if (!current || current.done || Date.parse(current.task.expiresAt) < Date.now()) return null;
    return current;
  }

  function nextTaskAt(): string | null {
    const job = st().job;
    if (!job) return null;
    const current = st().workTask;
    if (!current) return new Date().toISOString();
    return new Date(Date.parse(current.task.createdAt) + careers.workTask.intervalHours * HOUR).toISOString();
  }

  /** A new task every few hours while the player has a job (the first one right away). */
  function ensureTask() {
    const job = st().job;
    if (!job || openTask()) return;
    const due = nextTaskAt();
    if (due && Date.parse(due) > Date.now()) return;
    const posting = postingById(job.postingId);
    const kind = workTaskKind(posting.required[0]?.branch ?? "management");
    const now = Date.now();
    const generated = generateWorkTask(kind, createRng(now % 2_147_483_647));
    const base = {
      id: `task-${++st().seq}`,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + careers.workTask.expiresHours * HOUR).toISOString(),
      startedAt: null,
    };
    st().workTask = {
      task: { ...base, ...generated } as WorkTask,
      correctIndex: correctOption(generated),
      done: false,
    };
  }

  const engine: Pick<
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
    | "workTask"
    | "submitWorkTask"
  > = {
    async setAvatar(requestId, avatarKey) {
      return host.idempotent(requestId, () => {
        const needed = avatarLevel(avatarKey);
        if (needed === null) throw new GameError("avatar_unknown");
        if (host.level() < needed) throw new GameError("avatar_locked");
        st().avatarKey = avatarKey;
        return avatarKey;
      });
    },

    async dailyReward() {
      return dailyPlan().state;
    },

    async claimDailyReward(requestId): Promise<DailyRewardResult> {
      return host.idempotent(requestId, () => {
        const s = st();
        const { state, usesFreeze } = dailyPlan();
        if (!state.claimable) throw new GameError("daily_reward_claimed");
        if (usesFreeze) s.freezeUsedWeek = host.week();
        const reward = dailyRewards.cycle[state.day - 1]!;
        const levelBefore = host.level();
        host.checkIn();
        const xp = host.addXp(reward.xp);
        host.addCash(reward.cashCents);
        s.bonusPoints += reward.skillPoints;
        s.dailyDay = state.day;
        s.dailyClaimedOn = host.day();
        return {
          day: state.day,
          xpAwarded: xp,
          cashCents: reward.cashCents,
          skillPoints: reward.skillPoints,
          streakDays: host.streakDays(),
          level: host.level(),
          xpTotal: host.xpTotal(),
          leveledUp: host.level() > levelBefore,
        };
      });
    },

    async skills() {
      accrue();
      return skillState();
    },

    async learnSkill(requestId, skillKey) {
      return host.idempotent(requestId, () => {
        accrue();
        const s = st();
        const learned = new Set(s.learned.map((l) => l.key));
        const check = learnCheck(skillKey, learned, freePoints(), s.branchPoints);
        if (check === "unknown") throw new GameError("skill_unknown");
        if (check === "learned") throw new GameError("skill_learned");
        if (check === "locked") throw new GameError("skill_locked");
        if (check === "points") throw new GameError("skill_points_insufficient");
        const pay = payForSkill(skillNode(skillKey)!, freePoints(), s.branchPoints)!;
        for (const [branch, amount] of Object.entries(pay.branches)) s.branchPoints[branch as SkillBranch] -= amount;
        s.spentFree += pay.free;
        s.learned.push({ key: skillKey, at: Date.now() });
        return skillState();
      });
    },

    async jobBoard() {
      sweep();
      const current = scores();
      const level = host.level();
      return {
        postings: POSTINGS.map(({ posting }) => {
          const mine = st()
            .applications.filter((a) => a.postingId === posting.id)
            .sort((a, b) => b.createdAt - a.createdAt)[0];
          return {
            ...posting,
            maxSalaryCentsPerHour: ceilingFor(posting),
            matchScore: matchScore(posting.required, current),
            eligible: level >= posting.minLevel && meetsRequirements(posting.required, current),
            myApplication: mine ? { id: mine.id, status: mine.status } : null,
          };
        }),
        nextRefreshAt: null,
      };
    },

    async applyForJob(input: ApplyInput) {
      return host.idempotent(input.requestId, () => {
        sweep();
        const posting = postingById(input.postingId);
        if (host.level() < posting.minLevel) throw new GameError("job_level_too_low");
        if (!meetsRequirements(posting.required, scores())) throw new GameError("job_skills_missing");
        const s = st();
        if (
          s.applications.some((a) => a.postingId === posting.id && (a.status === "pending" || a.status === "offered"))
        )
          throw new GameError("application_exists");
        if (
          s.applications.filter((a) => a.status === "pending" || a.status === "offered").length >=
          jobs.maxOpenApplications
        )
          throw new GameError("application_limit");
        if (input.salaryWishCentsPerHour <= 0) throw new GameError("invalid_argument");
        const now = Date.now();
        const application: DemoApplication = {
          id: `app-${++s.seq}`,
          postingId: posting.id,
          status: "pending",
          wish: Math.round(input.salaryWishCentsPerHour),
          offer: null,
          offerExpiresAt: null,
          message: input.message.slice(0, jobs.applicationMessageMaxLength),
          createdAt: now,
          updatedAt: now,
        };
        aiOffer(application, now);
        s.applications.unshift(application);
        return toApplication(application);
      });
    },

    async applications() {
      sweep();
      return st().applications.slice(0, 30).map(toApplication);
    },

    async counterOffer(requestId, applicationId, salary) {
      return host.idempotent(requestId, () => {
        const a = st().applications.find((x) => x.id === applicationId);
        if (!a) throw new GameError("application_not_found");
        if (a.status !== "offered") throw new GameError("application_not_offered");
        // Only player employers negotiate; every demo employer is an AI company.
        if (postingById(a.postingId).company.isAi) throw new GameError("invalid_argument");
        a.wish = Math.round(salary);
        aiOffer(a, Date.now());
        return toApplication(a);
      });
    },

    async withdrawApplication(requestId, applicationId) {
      return host.idempotent(requestId, () => {
        const a = st().applications.find((x) => x.id === applicationId);
        if (!a) throw new GameError("application_not_found");
        if (a.status !== "offered" && a.status !== "pending") throw new GameError("application_not_offered");
        a.status = a.status === "offered" ? "declined" : "withdrawn";
        a.updatedAt = Date.now();
        return toApplication(a);
      });
    },

    async signContract(requestId, applicationId, signature) {
      return host.idempotent(requestId, () => {
        sweep();
        const s = st();
        const a = s.applications.find((x) => x.id === applicationId);
        if (!a) throw new GameError("application_not_found");
        if (a.status === "expired") throw new GameError("offer_expired");
        if (a.status !== "offered" || a.offer === null) throw new GameError("application_not_offered");
        if (s.job) throw new GameError("job_active_exists");
        if (host.ownsCompany()) throw new GameError("owns_company");
        const now = Date.now();
        const posting = postingById(a.postingId);
        a.status = "signed";
        a.updatedAt = now;
        for (const other of s.applications) {
          if (other !== a && (other.status === "pending" || other.status === "offered")) {
            other.status = "closed";
            other.updatedAt = now;
          }
        }
        s.job = {
          id: `job-${++s.seq}`,
          postingId: posting.id,
          salary: a.offer,
          startedAt: now,
          lastPaidAt: now,
          payDay: host.day(now),
          paidMinutesToday: 0,
          earnedTotal: 0,
          scoreAtRaise: matchScore(posting.required, scores()),
          lastRaiseAt: null,
          signature: signature.slice(0, 8000),
        };
        return myJobNow()!;
      });
    },

    async myJob() {
      accrue();
      return myJobNow();
    },

    async quitJob(requestId, immediate = false) {
      return host.idempotent(requestId, () => {
        accrue();
        const s = st();
        if (!s.job) throw new GameError("no_active_job");
        if (immediate) {
          // At once for a day's wage, paid to the company (ADR-066).
          const cost = s.job.salary * jobs.quitNowCostHours;
          if (host.cashCents() < cost) throw new GameError("insufficient_funds");
          host.addCash(-cost);
          s.job = null;
          return { noticeEndsAt: null, ended: true, paidCents: cost };
        }
        s.job.noticeEndsAt ??= Date.now() + jobs.quitNoticeHours * HOUR;
        return { noticeEndsAt: iso(s.job.noticeEndsAt), ended: false, paidCents: 0 };
      });
    },

    async cancelQuit(requestId) {
      return host.idempotent(requestId, () => {
        accrue();
        const job = st().job;
        if (!job) throw new GameError("no_active_job");
        if (!job.noticeEndsAt) throw new GameError("invalid_argument");
        job.noticeEndsAt = null;
        return myJobNow()!;
      });
    },

    async employer() {
      accrue();
      const job = st().job;
      if (!job) return null;
      const posting = postingById(job.postingId);
      return {
        company: posting.company,
        kind: "ai" as const,
        productKey: null,
        stage: null,
        tier: null,
        founder: null,
        teamSize: 1,
        lastQuarter: null,
        payFactorBps: 10_000,
      };
    },

    async requestRaise(requestId, raiseBps) {
      return host.idempotent(requestId, () => {
        accrue();
        const job = st().job;
        const info = myJobNow();
        if (!job || !info) throw new GameError("no_active_job");
        if (info.raiseAvailableAt) throw new GameError("raise_too_soon");
        if (raiseBps <= 0 || raiseBps > info.raiseMaxBps) throw new GameError("raise_too_high");
        job.salary = Math.round((job.salary * (10_000 + raiseBps)) / 10_000);
        job.lastRaiseAt = Date.now();
        job.scoreAtRaise = matchScore(postingById(job.postingId).required, scores());
        return { status: "accepted" as const, salaryCentsPerHour: job.salary };
      });
    },

    async workTask() {
      accrue();
      ensureTask();
      const open = openTask();
      if (open && !open.task.startedAt) open.task = { ...open.task, startedAt: new Date().toISOString() };
      host.persist();
      return { task: open?.task ?? null, nextTaskAt: nextTaskAt() };
    },

    async submitWorkTask(requestId, taskId, choice): Promise<WorkTaskResult> {
      return host.idempotent(requestId, () => {
        const job = st().job;
        if (!job) throw new GameError("no_active_job");
        const current = st().workTask;
        if (!current || current.task.id !== taskId) throw new GameError("work_task_not_found");
        if (current.done) throw new GameError("work_task_done");
        if (Date.parse(current.task.expiresAt) < Date.now()) throw new GameError("work_task_expired");
        const started = Date.parse(current.task.startedAt ?? current.task.createdAt);
        const correct = choice === current.correctIndex;
        const grade = gradeWorkTask(correct, (Date.now() - started) / 1000);
        current.done = true;
        const xp = host.addXp(grade.xp);
        const bonus = Math.round(grade.bonusShare * careers.workTask.bonusSalaryHours * job.salary);
        if (bonus > 0) host.addCash(bonus);
        return {
          correct,
          correctIndex: current.correctIndex,
          xpAwarded: xp,
          bonusCents: bonus,
          level: host.level(),
          xpTotal: host.xpTotal(),
        };
      });
    },

    async playerCard(nickname): Promise<PlayerCard> {
      if (nickname.toLowerCase() !== host.nickname().toLowerCase()) throw new GameError("player_not_found");
      const s = st();
      const job = myJobNow();
      return {
        nickname: host.nickname(),
        tag: host.tag(),
        trophies: host.trophies(),
        avatarKey: s.avatarKey,
        level: host.level(),
        rank: host.rank(),
        netWorthCents: host.netWorthCents(),
        streakDays: host.streakDays(),
        skillsLearned: s.learned.length,
        branchScores: scores(),
        topSkills: s.learned
          .map((l) => ({ key: l.key, tier: skillNode(l.key)?.tier ?? 1 }))
          .sort((a, b) => b.tier - a.tier)
          .slice(0, 3),
        job: job
          ? {
              companyName: job.company.name,
              titleKey: job.titleKey,
              title: job.title,
              tier: job.tier,
              since: job.startedAt,
            }
          : null,
        company: host.ownCompany(),
        memberSince: iso(Date.now() - 3 * DAY),
      };
    },
  };

  return {
    engine,
    accrue,
    hasJob: () => st().job !== null,
    /** The founder's company reached full size: the job gets the regular notice (ADR-066). */
    startNotice: () => {
      const job = st().job;
      if (job && !job.noticeEndsAt) job.noticeEndsAt = Date.now() + jobs.quitNoticeHours * HOUR;
    },
    branchScores: scores,
    learnedSkills: () => st().learned.map((l) => l.key),
    freePoints,
    avatarKey: () => st().avatarKey,
    dailyClaimable: () => dailyPlan().state.claimable,
  };
}
