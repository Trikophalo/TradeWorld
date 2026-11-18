import type { CompanyWithdrawRhythm } from "@/features/game/types";

/** Why "Entnehmen" is off right now (ADR-213), with the moment it ends. */
export type WithdrawBlock = { reason: "board" | "interval"; until: string } | null;

/**
 * The board's ban (ADR-167) wins over the 6-hour rhythm (ADR-213): it usually lasts longer. Before the clock is known a
 * running pause counts as running, so the button never flashes on.
 */
export function withdrawBlock(
  rhythm: CompanyWithdrawRhythm | null,
  boardBlockUntil: string | null,
  now: number | null,
): WithdrawBlock {
  const running = (until: string | null): until is string =>
    until !== null && (now === null || Date.parse(until) > now);
  if (running(boardBlockUntil)) return { reason: "board", until: boardBlockUntil };
  if (rhythm && running(rhythm.nextAt)) return { reason: "interval", until: rhythm.nextAt };
  return null;
}

/**
 * What the founder may take out now, as company_withdraw() checks it: cash minus open bills (ADR-083), for listed
 * companies also minus the board's budgets (`freeCashCents`, ADR-167) and minus issue proceeds still locked (ADR-170).
 */
export function withdrawableCents(
  company: { cashCents: number; unpaidCents: number; withdraw: CompanyWithdrawRhythm | null },
  freeCashCents?: number,
): number {
  const free = company.cashCents - company.unpaidCents;
  const listed = (freeCashCents ?? free) - (company.withdraw?.issueLockedCents ?? 0);
  return Math.max(0, Math.min(free, listed));
}
