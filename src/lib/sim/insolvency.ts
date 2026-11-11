/**
 * Dissolving a player company with private liability (ADR-052, ADR-058,
 * docs/PLAYER_COMPANIES.md §3).
 *
 * Order: the company's cash pays open bills, then one salary severance per
 * employee. What is left over goes to the founder; what is missing the founder
 * pays privately; what the founder cannot pay becomes a forced private loan,
 * repaid by keeping back a share of every private income.
 */
import { BALANCE } from "../../config/balance.ts";
import type { StartupsConfig } from "../../config/balance.ts";

const ZERO = BigInt(0);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

export interface DissolutionInput {
  readonly companyCashCents: bigint;
  readonly unpaidCents: bigint;
  /** One salary per employee (salaryUnitHours × contract wage). */
  readonly severancesCents: readonly bigint[];
  readonly founderCashCents: bigint;
}

export interface DissolutionResult {
  /** Paid out of the company's cash (bills and severances). */
  readonly fromCompanyCents: bigint;
  /** Paid out of the founder's private cash. */
  readonly fromFounderCents: bigint;
  /** New forced loan of the founder. */
  readonly loanCents: bigint;
  /** Company cash left after everything was paid, goes to the founder. */
  readonly toFounderCents: bigint;
  readonly totalDebtCents: bigint;
}

export function dissolve(input: DissolutionInput): DissolutionResult {
  const severances = input.severancesCents.reduce((sum, s) => sum + s, ZERO);
  const totalDebt = max(ZERO, input.unpaidCents) + severances;
  const cash = max(ZERO, input.companyCashCents);
  const fromCompany = min(cash, totalDebt);
  const rest = totalDebt - fromCompany;
  const fromFounder = min(max(ZERO, input.founderCashCents), rest);
  return {
    fromCompanyCents: fromCompany,
    fromFounderCents: fromFounder,
    loanCents: rest - fromFounder,
    toFounderCents: cash - fromCompany,
    totalDebtCents: totalDebt,
  };
}

/** Whether the company must be dissolved after this quarter close. */
export function isInsolvent(distressQuarters: number, cfg: StartupsConfig = BALANCE.startups): boolean {
  return distressQuarters >= cfg.insolvency.graceQuarters;
}

/**
 * Keeps back part of a private income for the forced loan. Returns what the
 * player receives and what repays the loan (never more than the loan).
 */
export function withholdIncome(
  incomeCents: bigint,
  loanCents: bigint,
  cfg: StartupsConfig = BALANCE.startups,
): { netCents: bigint; repaidCents: bigint } {
  if (incomeCents <= ZERO || loanCents <= ZERO) return { netCents: incomeCents, repaidCents: ZERO };
  const share = (incomeCents * BigInt(cfg.insolvency.loanWithholdingBps)) / BigInt(10_000);
  const repaid = min(share, loanCents);
  return { netCents: incomeCents - repaid, repaidCents: repaid };
}
