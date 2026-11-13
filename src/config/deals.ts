/**
 * Deals between players and trust (ADR-098). Three kinds of handshake deals:
 *
 * - loan:   a player lends money to another player; the borrower pays it back with interest by a due date.
 * - supply: a company lends its free capacity to another player's company. Whenever the buyer is sold out, the supplier
 *           produces the missing goods; the buyer sells them at its price and pays the agreed fee per unit.
 * - stake:  a player puts money into another player's company and gets a share of every profitable hour for a while.
 *
 * The server enforces payments it can enforce (fees per delivered unit, profit shares, collecting a due loan from free
 * cash). What it cannot enforce is the word: a borrower may not have the money, a founder may end a stake early, a
 * supplier may end a contract and keep the prepayment. Every kept or broken deal moves the player's trust score, which
 * everybody sees before they deal with someone.
 *
 * Plain data, no imports: runs unchanged in Deno and is mirrored in Postgres (game_config.deals, game_config.trust).
 */
export type DealKind = "loan" | "supply" | "stake";

export interface DealsConfig {
  /** Deals unlock at this level (both sides). */
  readonly minLevel: number;
  /** An offer that nobody accepts expires after this many hours. */
  readonly offerValidHours: number;
  /** Open offers per player at a time. */
  readonly maxOpenOffers: number;
  /** Running deals per player and kind at a time. */
  readonly maxActivePerKind: number;
  readonly loan: {
    readonly minPrincipalCents: number;
    /** A lender lends at most this much per own level (abuse guard). */
    readonly maxPrincipalCentsPerLevel: number;
    /** Interest for the whole term, not per year. */
    readonly maxInterestBps: number;
    readonly minHours: number;
    readonly maxHours: number;
    /** An overdue loan counts as defaulted after this many hours. */
    readonly defaultAfterHours: number;
  };
  readonly supply: {
    /** Volume: goods (in cents at the buyer's normal price) the supplier produces at most per hour. */
    readonly minVolumeCentsPerHour: number;
    /** Fee per delivered unit as a share of the normal price. */
    readonly minFeeBps: number;
    readonly maxFeeBps: number;
    /** Prepayment at signing as a share of the most the contract can cost. */
    readonly maxPrepayBps: number;
    readonly minHours: number;
    readonly maxHours: number;
    /** Hours with demand the supplier must have served for the contract to count as kept. */
    readonly keptDeliveryBps: number;
  };
  readonly stake: {
    readonly minAmountCents: number;
    /** Share of the hourly profit one stake may take. */
    readonly maxShareBps: number;
    /** All running stakes of a company together. */
    readonly maxTotalShareBps: number;
    readonly minHours: number;
    readonly maxHours: number;
  };
}

export type TrustBand = "risky" | "shaky" | "blank" | "reliable" | "rock";

export interface TrustConfig {
  readonly start: number;
  readonly min: number;
  readonly max: number;
  readonly deltas: {
    readonly loanRepaidOnTime: number;
    readonly loanRepaidLate: number;
    readonly loanOverdue: number;
    readonly loanDefaulted: number;
    /** The lender of every loan that ends, repaid or forgiven. */
    readonly loanLent: number;
    readonly loanForgiven: number;
    readonly supplyKept: number;
    readonly supplyShort: number;
    readonly stakeKept: number;
    readonly dealBroken: number;
  };
  /** Score from which a band starts, ascending. */
  readonly bands: readonly { readonly from: number; readonly key: TrustBand }[];
}

export const DEALS: DealsConfig = {
  minLevel: 7,
  offerValidHours: 48,
  maxOpenOffers: 5,
  maxActivePerKind: 5,
  loan: {
    minPrincipalCents: 10_000,
    maxPrincipalCentsPerLevel: 2_000_000,
    maxInterestBps: 3_000,
    minHours: 24,
    maxHours: 720,
    defaultAfterHours: 168,
  },
  supply: {
    minVolumeCentsPerHour: 1_000,
    minFeeBps: 1_000,
    maxFeeBps: 9_500,
    maxPrepayBps: 5_000,
    minHours: 24,
    maxHours: 336,
    keptDeliveryBps: 5_000,
  },
  stake: {
    minAmountCents: 10_000,
    maxShareBps: 3_000,
    maxTotalShareBps: 5_000,
    minHours: 24,
    maxHours: 720,
  },
};

export const TRUST: TrustConfig = {
  start: 50,
  min: 0,
  max: 100,
  deltas: {
    loanRepaidOnTime: 4,
    loanRepaidLate: 2,
    loanOverdue: -6,
    loanDefaulted: -12,
    loanLent: 1,
    loanForgiven: 2,
    supplyKept: 3,
    supplyShort: -4,
    stakeKept: 3,
    dealBroken: -12,
  },
  bands: [
    { from: 0, key: "risky" },
    { from: 30, key: "shaky" },
    { from: 45, key: "blank" },
    { from: 60, key: "reliable" },
    { from: 80, key: "rock" },
  ],
};
