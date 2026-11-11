/**
 * Work tasks (ADR-059, docs/JOBS_AND_SKILLS.md §6a): every few hours a short
 * multiple-choice task from the job's field, solvable in under a minute.
 * The answer follows from the numbers shown, so thinking pays and guessing
 * does not. The database draws its own numbers and uses the same formulas to
 * find the right answer; the demo uses `generateWorkTask`.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";
import type { SkillBranch } from "../../config/skills.ts";
import type { Rng } from "./types.ts";

export type WorkTaskKind = "finance_choice" | "sales_pick" | "analyst_estimate";

export interface LoanOffer {
  readonly rateBps: number;
  readonly feeCents: number;
}
export interface FinanceParams {
  readonly amountCents: number;
  readonly years: number;
  readonly offers: readonly [LoanOffer, LoanOffer];
}
export interface Customer {
  readonly units: number;
  readonly priceCents: number;
  readonly unitCostCents: number;
  readonly serviceCents: number;
}
export interface SalesParams {
  readonly customers: readonly Customer[];
}
export interface AnalystParams {
  readonly revenueCents: number;
  readonly cogsBps: number;
  readonly fixedCents: number;
  readonly marketingCents: number;
  /** Profit candidates in cents, one of them right. */
  readonly options: readonly number[];
}

export type WorkTaskParams =
  | { readonly kind: "finance_choice"; readonly params: FinanceParams }
  | { readonly kind: "sales_pick"; readonly params: SalesParams }
  | { readonly kind: "analyst_estimate"; readonly params: AnalystParams };

/** Which task fits a job: by the first branch the job asks for. */
export function workTaskKind(branch: SkillBranch): WorkTaskKind {
  if (branch === "finance" || branch === "law") return "finance_choice";
  if (branch === "sales" || branch === "logistics" || branch === "management") return "sales_pick";
  return "analyst_estimate";
}

export function loanCostCents(amountCents: number, years: number, offer: LoanOffer): number {
  return offer.feeCents + Math.round((amountCents * offer.rateBps * years) / 10_000);
}

export function customerProfitCents(c: Customer): number {
  return c.units * (c.priceCents - c.unitCostCents) - c.serviceCents;
}

export function analystProfitCents(p: Omit<AnalystParams, "options">): number {
  return Math.round((p.revenueCents * (10_000 - p.cogsBps)) / 10_000) - p.fixedCents - p.marketingCents;
}

/** Index of the right answer. */
export function correctOption(task: WorkTaskParams): number {
  switch (task.kind) {
    case "finance_choice": {
      const [a, b] = task.params.offers;
      const { amountCents, years } = task.params;
      return loanCostCents(amountCents, years, a) <= loanCostCents(amountCents, years, b) ? 0 : 1;
    }
    case "sales_pick": {
      const profits = task.params.customers.map(customerProfitCents);
      return profits.indexOf(Math.max(...profits));
    }
    case "analyst_estimate":
      return task.params.options.indexOf(analystProfitCents(task.params));
  }
}

const round100 = (cents: number) => Math.round(cents / 100) * 100;

/** Draws a task with a clear right answer (the best option wins by at least 5 %). */
export function generateWorkTask(kind: WorkTaskKind, rng: Rng): WorkTaskParams {
  for (let attempt = 0; ; attempt++) {
    const task = draw(kind, rng);
    if (attempt > 20 || isClear(task)) return task;
  }
}

function draw(kind: WorkTaskKind, rng: Rng): WorkTaskParams {
  if (kind === "finance_choice") {
    const offer = (): LoanOffer => ({ rateBps: rng.int(15, 90) * 10, feeCents: round100(rng.int(0, 60) * 5_000) });
    return {
      kind,
      params: { amountCents: rng.int(2, 40) * 1_000_000, years: rng.int(1, 5), offers: [offer(), offer()] },
    };
  }
  if (kind === "sales_pick") {
    const customer = (): Customer => {
      const unitCost = rng.int(5, 60) * 100;
      return {
        units: rng.int(5, 80) * 10,
        priceCents: unitCost + rng.int(2, 40) * 100,
        unitCostCents: unitCost,
        serviceCents: round100(rng.int(0, 40) * 25_000),
      };
    };
    return { kind, params: { customers: [customer(), customer(), customer()] } };
  }
  const base = {
    revenueCents: rng.int(20, 400) * 100_000,
    cogsBps: rng.int(25, 70) * 100,
    fixedCents: rng.int(2, 60) * 100_000,
    marketingCents: rng.int(0, 20) * 100_000,
  };
  const right = analystProfitCents(base);
  const wrong = [
    right + base.fixedCents, // forgot the fixed costs
    Math.round((base.revenueCents * base.cogsBps) / 10_000) - base.fixedCents - base.marketingCents, // swapped margin
    right - base.marketingCents - Math.round(base.revenueCents * 0.1), // made up extra cost
  ];
  const options = [right, ...wrong];
  for (let i = options.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return { kind, params: { ...base, options } };
}

function isClear(task: WorkTaskParams): boolean {
  if (task.kind === "finance_choice") {
    const [a, b] = task.params.offers.map((o) => loanCostCents(task.params.amountCents, task.params.years, o));
    return Math.abs(a! - b!) >= 0.05 * Math.max(a!, b!, 1);
  }
  if (task.kind === "sales_pick") {
    const profits = task.params.customers.map(customerProfitCents).sort((x, y) => y - x);
    return profits[0]! > 0 && profits[0]! - profits[1]! >= 0.05 * Math.abs(profits[0]!);
  }
  return new Set(task.params.options).size === task.params.options.length;
}

/** XP and bonus share for an answer (spec: 50 to 150 XP by quality). */
export function gradeWorkTask(
  correct: boolean,
  seconds: number,
  cfg: BalanceConfig = BALANCE,
): { xp: number; bonusShare: number } {
  const { minXp, maxXp } = cfg.progression.xpSources.workTask;
  if (!correct) return { xp: minXp, bonusShare: 0 };
  const fast = seconds <= cfg.careers.workTask.fastAnswerSeconds;
  return { xp: fast ? maxXp : Math.round((minXp + maxXp) / 2), bonusShare: 1 };
}
