/**
 * Company autopilot and task pay (ADR-180). Pure rules, mirrored 1:1 in SQL (company_autopilot_chance_bps,
 * company_task_pay_factor_bps, company_task_resolve; migration 20261204006910). Randomness comes in as a number.
 */
import { COMPANY_TASK_RULES } from "../../config/company-tasks.ts";
import { discountedCents, withBonusCents } from "./upgrades.ts";

type Rules = typeof COMPANY_TASK_RULES;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Employee mood 0..1 that drives the autopilot. Listed companies: their employee satisfaction (0..100); private
 * companies: the "Team" strength (0..100), which follows how fully wages were paid.
 */
export function autopilotMood(teamScore: number, listedSatisfaction: number | null = null): number {
  const v = listedSatisfaction ?? teamScore;
  return clamp((Number.isFinite(v) ? v : 0) / 100, 0, 1);
}

/** Success chance in bps: 60 % at the worst mood up to 120 % at the best (floor). */
export function autopilotChanceBps(mood: number, rules: Rules = COMPANY_TASK_RULES): number {
  const a = rules.autopilot;
  return Math.floor(a.baseChanceBps + (a.maxChanceBps - a.baseChanceBps) * clamp(mood, 0, 1));
}

/** Whether the task succeeds for a uniform draw u in [0, 1): always from 100 % on. */
export function autopilotSucceeds(chanceBps: number, u: number): boolean {
  return chanceBps >= 10_000 || u * 10_000 < chanceBps;
}

/** Task pay factor from the six strengths (bps): linear from minBps at overall 0 to maxBps at 100. */
export function taskPayFactorBps(overall: number, rules: Rules = COMPANY_TASK_RULES): number {
  const p = rules.strengthPay;
  return Math.floor(p.minBps + ((p.maxBps - p.minBps) * clamp(overall, 0, 100)) / 100);
}

export type TaskMode = "manual" | "ai" | "autopilot";

/**
 * Money of a resolved task (the server's company_task_resolve): success pays value x score, then the AI share or
 * the autopilot share (times the chance above 100 %), then the strengths factor, then the founder's task_pay
 * upgrade. Failure costs value x penalty (the autopilot's smaller penalty) less the task_safety upgrade.
 */
export function taskRewardCents(
  valueCents: number,
  scoreBps: number | null,
  mode: TaskMode,
  opts: { payFactorBps?: number; chanceBps?: number; payBonusBps?: number; penaltyDiscountBps?: number } = {},
  rules: Rules = COMPANY_TASK_RULES,
): number {
  if (scoreBps !== null && scoreBps >= rules.passScoreBps) {
    let v = Math.trunc((valueCents * scoreBps) / 10_000);
    if (mode === "autopilot") {
      v = Math.trunc((v * rules.autopilot.rewardBps) / 10_000);
      v = Math.trunc((v * Math.max(10_000, opts.chanceBps ?? 0)) / 10_000);
    } else if (mode === "ai") {
      v = Math.trunc((v * rules.ai.valueBps) / 10_000);
    }
    v = Math.trunc((v * (opts.payFactorBps ?? 10_000)) / 10_000);
    return Number(withBonusCents(BigInt(v), opts.payBonusBps ?? 0));
  }
  const penaltyBps = mode === "autopilot" ? rules.autopilot.failPenaltyBps : rules.penaltyBps;
  const penalty = Math.trunc((valueCents * penaltyBps) / 10_000);
  return -Number(discountedCents(BigInt(penalty), opts.penaltyDiscountBps ?? 0));
}

/** Expected money of one autopilot task (for the explanation on the page). */
export function autopilotExpectedCents(
  valueCents: number,
  chanceBps: number,
  payFactorBps: number,
  rules: Rules = COMPANY_TASK_RULES,
): number {
  const p = Math.min(1, chanceBps / 10_000);
  const win = taskRewardCents(valueCents, 10_000, "autopilot", { chanceBps, payFactorBps }, rules);
  const lose = taskRewardCents(valueCents, 0, "autopilot", {}, rules);
  return Math.round(p * win + (1 - p) * lose);
}
