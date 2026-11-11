/**
 * Skills and jobs (ADR-050, ADR-051, docs/JOBS_AND_SKILLS.md): branch scores,
 * learning rules, job matching, productivity and the AI salary ceiling.
 * The database implements the same rules in PL/pgSQL; the UI and the demo use
 * these functions.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig, JobsConfig, SkillsConfig } from "../../config/balance.ts";
import { SKILL_BRANCHES, type SkillBranch, type SkillNodeConfig } from "../../config/skills.ts";

export type BranchScores = Record<SkillBranch, number>;
export type BranchPoints = Record<SkillBranch, number>;

export interface JobRequirement {
  readonly branch: SkillBranch;
  readonly minScore: number;
}

export function emptyBranches(): Record<SkillBranch, number> {
  return Object.fromEntries(SKILL_BRANCHES.map((b) => [b, 0])) as Record<SkillBranch, number>;
}

export function skillNode(key: string, cfg: SkillsConfig = BALANCE.skills): SkillNodeConfig | undefined {
  return cfg.tree.find((node) => node.key === key);
}

export function skillCost(node: SkillNodeConfig, cfg: SkillsConfig = BALANCE.skills): number {
  return cfg.costByTier[node.tier - 1] ?? Number.POSITIVE_INFINITY;
}

/** Branch score = sum of the tier scores of all learned skills; hybrids count for both branches. */
export function branchScores(learned: Iterable<string>, cfg: SkillsConfig = BALANCE.skills): BranchScores {
  const scores = emptyBranches();
  for (const key of learned) {
    const node = skillNode(key, cfg);
    if (!node) continue;
    const score = cfg.scoreByTier[node.tier - 1] ?? 0;
    for (const branch of node.branches) scores[branch] += score;
  }
  return scores;
}

export type LearnCheck = "ok" | "unknown" | "learned" | "locked" | "points";

/**
 * Whether a skill can be learned now. Payment: points of the skill's branches
 * first (for hybrids the larger pot first), then free points.
 */
export function learnCheck(
  key: string,
  learned: ReadonlySet<string>,
  freePoints: number,
  branchPoints: Readonly<BranchPoints>,
  cfg: SkillsConfig = BALANCE.skills,
): LearnCheck {
  const node = skillNode(key, cfg);
  if (!node) return "unknown";
  if (learned.has(key)) return "learned";
  if (!node.requires.every((req) => learned.has(req))) return "locked";
  return payForSkill(node, freePoints, branchPoints, cfg) ? "ok" : "points";
}

/** How a skill is paid, or null when the points do not suffice. */
export function payForSkill(
  node: SkillNodeConfig,
  freePoints: number,
  branchPoints: Readonly<BranchPoints>,
  cfg: SkillsConfig = BALANCE.skills,
): { free: number; branches: Partial<BranchPoints> } | null {
  let remaining = skillCost(node, cfg);
  const branches: Partial<BranchPoints> = {};
  const order = [...node.branches].sort((a, b) => branchPoints[b] - branchPoints[a]);
  for (const branch of order) {
    const take = Math.min(remaining, branchPoints[branch]);
    if (take > 0) {
      branches[branch] = take;
      remaining -= take;
    }
  }
  if (remaining > freePoints) return null;
  return { free: remaining, branches };
}

/** Points a player can spend on a skill (its branches plus free points). */
export function pointsFor(node: SkillNodeConfig, freePoints: number, branchPoints: Readonly<BranchPoints>): number {
  return freePoints + node.branches.reduce((sum, branch) => sum + branchPoints[branch], 0);
}

/**
 * Matching score for a job: per required branch the player's score, counted up
 * to twice the requirement (at least 2), so one huge branch can't carry a job
 * that asks for several.
 */
export function matchScore(required: readonly JobRequirement[], scores: Readonly<BranchScores>): number {
  return required.reduce((sum, req) => sum + Math.min(scores[req.branch], 2 * Math.max(req.minScore, 1)), 0);
}

export function meetsRequirements(required: readonly JobRequirement[], scores: Readonly<BranchScores>): boolean {
  return required.every((req) => scores[req.branch] >= req.minScore);
}

/** Fit in percent for the UI: 100 % = every requirement met twice over. */
export function fitPercent(required: readonly JobRequirement[], scores: Readonly<BranchScores>): number {
  const max = required.reduce((sum, req) => sum + 2 * Math.max(req.minScore, 1), 0);
  return max === 0 ? 100 : Math.round((100 * matchScore(required, scores)) / max);
}

/** Productivity in bps of an AI worker (10 000). A player is always better than an AI worker. */
export function productivityBps(score: number, cfg: JobsConfig = BALANCE.jobs): number {
  const value = Math.min(cfg.maxProductivity, cfg.playerBaseProductivity + cfg.productivityPerSkillScore * score);
  return Math.round(value * 10_000);
}

/** Highest hourly wage an AI employer pays this player for a posting. */
export function aiSalaryCeiling(baseCentsPerHour: number, score: number, cfg: JobsConfig = BALANCE.jobs): number {
  const factor = Math.min(cfg.aiSalaryCapMultiplier, 1 + (cfg.aiSalaryPerScoreBps / 10_000) * score);
  return Math.round(baseCentsPerHour * factor);
}

/** Largest raise a player may ask for, from the score gained since hiring or the last raise. */
export function maxRaiseBps(scoreGained: number, cfg: JobsConfig = BALANCE.jobs): number {
  return Math.max(0, Math.floor(scoreGained)) * cfg.raiseRequest.maxRaiseBpsPerScore;
}

/** "One salary" (quitting cost, severance): salaryUnitHours of the base wage. */
export function oneSalaryCents(centsPerHour: number, cfg: JobsConfig = BALANCE.jobs): number {
  return centsPerHour * cfg.salaryUnitHours;
}

export interface AiPostingSpec {
  readonly titleKey: string;
  readonly branch: SkillBranch;
  readonly tier: string;
  readonly minLevel: number;
  readonly salaryCentsPerHour: number;
  readonly required: readonly JobRequirement[];
}

/**
 * The i-th AI job posting of the AI company with seed index `c` in game quarter `q`
 * (rule in JobsConfig.sectorBranches; the database generates the same postings).
 */
export function aiPostingSpec(
  sector: string,
  c: number,
  i: number,
  q: number,
  cfg: BalanceConfig = BALANCE,
): AiPostingSpec {
  const branches = cfg.jobs.sectorBranches[sector] ?? (["management"] as const);
  const branch = branches[(c + i) % branches.length]!;
  const tiers = cfg.careers.tiers;
  const tier = tiers[(2 * c + i + q) % tiers.length]!;
  const minScore = cfg.jobs.tierMinScore[tier.id] ?? 0;
  const required: JobRequirement[] = [{ branch, minScore }];
  if ((tier.id === "team_lead" || tier.id === "c_level") && branch !== "management") {
    required.push({ branch: "management", minScore: Math.floor(minScore / 2) });
  }
  return {
    titleKey: `${branch}_${tier.id}`,
    branch,
    tier: tier.id,
    minLevel: tier.minLevel,
    salaryCentsPerHour: tier.salaryCentsPerHour,
    required,
  };
}
