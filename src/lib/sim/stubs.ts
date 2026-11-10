/**
 * Architecture-level signatures that are designed but not implemented yet.
 * Each stub names the milestone (docs/ROADMAP.md) in which it becomes real.
 */
import type { CompanyState, DepartmentId, EmployeeInput, Rng } from "./types.ts";

export interface Applicant extends EmployeeInput {
  readonly name: string;
  readonly department: DepartmentId;
  readonly askedSalaryCents: bigint;
}

/** Generates the applicant pool of a company for one quarter (spec 7.1). */
export function generateApplicantPool(_company: CompanyState, _rng: Rng): readonly Applicant[] {
  // M4: draw skill, trait and salary expectation; pool quality grows with company awareness.
  throw new Error("not implemented: M4");
}

export interface LoyaltyInput {
  readonly loyalty: number;
  readonly traitKey: string | null;
  readonly salaryCents: bigint;
  readonly marketSalaryCents: bigint;
  readonly quartersSinceRaise: number;
}

/** Loyalty of one employee after a quarter and whether the employee quits (spec 7.1). */
export function stepEmployeeLoyalty(_input: LoyaltyInput, _rng: Rng): { readonly loyalty: number; readonly quits: boolean } {
  // M4: decay on salary freeze (trait multiplier), gain on raises, quit below the threshold.
  throw new Error("not implemented: M4");
}

export interface RescueOffer {
  readonly bidderId: string;
  readonly priceCents: bigint;
}

/** Price an AI company would bid in a rescue takeover shortly before insolvency (spec 6.7). */
export function aiRescueOffer(_company: CompanyState, _rng: Rng): RescueOffer | null {
  // M4: bid a discount to liquidation value if the sector is healthy.
  throw new Error("not implemented: M4");
}

export interface OptionQuoteInput {
  readonly kind: "call" | "put";
  readonly spotE4: bigint;
  readonly strikeE4: bigint;
  readonly secondsToExpiry: number;
  readonly policyRateBps: number;
  /** Annualised (game year) volatility of the underlying. */
  readonly volatility: number;
}

/** Fair premium of an option, unlocked at level 30 (spec 9.3, 10). */
export function optionPremiumE4(_input: OptionQuoteInput): bigint {
  // Post-M8: Black-Scholes with the market-maker spread on top.
  throw new Error("not implemented: post-M8");
}
