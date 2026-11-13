/**
 * Promotions (ADR-094): the career ladder intern → junior → senior → team lead → C-level inside one job.
 *
 * The next rank needs the player level of the rank, a score in the job's main branch (the first requirement of the
 * job), for team lead and C-level half of it in management as well, and hours worked in the current rank. Once the
 * requirements are met an AI boss says yes with a chance that grows with every score point above the requirement;
 * a player boss decides. The database applies the same rules.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig, JobTierId } from "../../config/balance.ts";
import type { SkillBranch } from "../../config/skills.ts";

export type PromotionRequirementKey = "level" | "branch" | "management" | "hours";

export interface PromotionRequirement {
  readonly key: PromotionRequirementKey;
  /** Branch of a score requirement. */
  readonly branch: SkillBranch | null;
  readonly need: number;
  readonly have: number;
  readonly met: boolean;
}

export interface PromotionInput {
  readonly tier: JobTierId;
  readonly level: number;
  readonly scores: Readonly<Record<SkillBranch, number>>;
  readonly mainBranch: SkillBranch;
  /** Hours worked in the current rank. */
  readonly rankHours: number;
  /** Extra chance from the rhetoric upgrade, in bps. */
  readonly bonusBps?: number;
}

export interface PromotionCheck {
  /** Next rank, null at the top. */
  readonly next: JobTierId | null;
  readonly requirements: readonly PromotionRequirement[];
  readonly ready: boolean;
  /** Chance that an AI boss says yes now (0 while not ready). */
  readonly chanceBps: number;
}

export function nextTier(tier: JobTierId, cfg: BalanceConfig = BALANCE): JobTierId | null {
  const tiers = cfg.careers.tiers;
  const i = tiers.findIndex((t) => t.id === tier);
  return i >= 0 && i + 1 < tiers.length ? tiers[i + 1]!.id : null;
}

/** Score the main branch needs for a rank. */
export function rankScore(tier: JobTierId, cfg: BalanceConfig = BALANCE): number {
  return cfg.jobs.tierMinScore[tier] ?? 0;
}

export function promotionRequirements(
  input: PromotionInput,
  next: JobTierId,
  cfg: BalanceConfig = BALANCE,
): PromotionRequirement[] {
  const p = cfg.careers.promotion;
  const tier = cfg.careers.tiers.find((t) => t.id === next)!;
  const score = rankScore(next, cfg);
  const req = (key: PromotionRequirementKey, branch: SkillBranch | null, need: number, have: number) => ({
    key,
    branch,
    need,
    have,
    met: have >= need,
  });
  const out: PromotionRequirement[] = [
    req("level", null, tier.minLevel, input.level),
    req("branch", input.mainBranch, score, input.scores[input.mainBranch] ?? 0),
  ];
  if (p.managementFrom.includes(next) && input.mainBranch !== "management") {
    out.push(req("management", "management", Math.floor(score / 2), input.scores.management ?? 0));
  }
  const hours = p.hoursByTier[next as Exclude<JobTierId, "intern">] ?? 0;
  out.push(req("hours", null, hours, Math.floor(Math.max(0, input.rankHours))));
  return out;
}

/** AI boss: base chance plus a share per score point above the requirement, plus the rhetoric bonus. */
export function promotionChanceBps(extraScore: number, bonusBps = 0, cfg: BalanceConfig = BALANCE): number {
  const p = cfg.careers.promotion;
  const chance =
    p.baseChanceBps + p.chancePerExtraScoreBps * Math.max(0, Math.floor(extraScore)) + Math.max(0, bonusBps);
  return Math.min(p.maxChanceBps, chance);
}

export function promotionCheck(input: PromotionInput, cfg: BalanceConfig = BALANCE): PromotionCheck {
  const next = nextTier(input.tier, cfg);
  if (!next) return { next: null, requirements: [], ready: false, chanceBps: 0 };
  const requirements = promotionRequirements(input, next, cfg);
  const ready = requirements.every((r) => r.met);
  const branch = requirements.find((r) => r.key === "branch")!;
  return {
    next,
    requirements,
    ready,
    chanceBps: ready ? promotionChanceBps(branch.have - branch.need, input.bonusBps, cfg) : 0,
  };
}

/** Wage after a promotion: the raise, and at least the base wage of the new rank. */
export function promotedSalaryCents(
  currentCentsPerHour: number,
  next: JobTierId,
  cfg: BalanceConfig = BALANCE,
): number {
  const tier = cfg.careers.tiers.find((t) => t.id === next);
  const raised = Math.round((currentCentsPerHour * (10_000 + cfg.careers.promotion.raiseBps)) / 10_000);
  return Math.max(raised, tier?.salaryCentsPerHour ?? 0);
}

/** Uniform draw u ∈ [0, 1) decides an AI boss's answer. */
export function promotionGranted(chanceBps: number, u: number): boolean {
  return u * 10_000 < chanceBps;
}
