/**
 * Integer helpers for money (bigint cents), prices (bigint E4) and rates (bps).
 *
 * Note: the project compiles with target ES2017, so bigint literals (`1n`) are
 * not available. Use `BigInt(1)` or the constants below.
 */

export const ZERO = BigInt(0);
export const ONE = BigInt(1);
export const TWO = BigInt(2);
export const HUNDRED = BigInt(100);
export const BPS_DENOMINATOR = BigInt(10_000);
/** 1 EUR = 10 000 price units (ADR-003). */
export const E4_PER_EURO = BigInt(10_000);
/** 1 cent = 100 price units. */
export const E4_PER_CENT = BigInt(100);

const FLOAT_SCALE = 1_000_000_000;
const FLOAT_SCALE_BIG = BigInt(FLOAT_SCALE);

export function absBig(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function clampBig(value: bigint, min: bigint, max: bigint): bigint {
  return value < min ? min : value > max ? max : value;
}

/** Integer division rounded half to even ("banker's rounding"), correct for negative values. */
export function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === ZERO) throw new RangeError("division by zero");
  const negative = numerator < ZERO !== denominator < ZERO;
  const n = absBig(numerator);
  const d = absBig(denominator);
  let q = n / d;
  const twiceRemainder = (n % d) * TWO;
  if (twiceRemainder > d || (twiceRemainder === d && q % TWO === ONE)) q += ONE;
  return negative ? -q : q;
}

/** Integer division rounded towards negative infinity. */
export function divFloor(numerator: bigint, denominator: bigint): bigint {
  if (denominator === ZERO) throw new RangeError("division by zero");
  const q = numerator / denominator;
  const exact = q * denominator === numerator;
  return !exact && numerator < ZERO !== denominator < ZERO ? q - ONE : q;
}

/** Integer division rounded towards positive infinity. */
export function divCeil(numerator: bigint, denominator: bigint): bigint {
  return -divFloor(-numerator, denominator);
}

/**
 * Order value (ADR-003): `round_half_even(quantity x price_e4 / 100)` in cents.
 * This is the single place where a price turns into money.
 */
export function orderValueCents(quantity: bigint, priceE4: bigint): bigint {
  return divRoundHalfEven(quantity * priceE4, E4_PER_CENT);
}

/** `amount x bps / 10 000`, rounded half to even. */
export function applyBps(amount: bigint, bps: number | bigint): bigint {
  return divRoundHalfEven(amount * toBigInt(bps), BPS_DENOMINATOR);
}

/** Ratio `part / whole` in basis points (rounded half to even), 0 if `whole` is 0. */
export function ratioBps(part: bigint, whole: bigint): number {
  if (whole === ZERO) return 0;
  return Number(divRoundHalfEven(part * BPS_DENOMINATOR, whole));
}

/** Converts an integer `number` to bigint and rejects fractions and unsafe values. */
export function toBigInt(value: number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) throw new RangeError(`not a safe integer: ${value}`);
  return BigInt(value);
}

/** Converts a bigint to `number` and rejects values that would lose precision. */
export function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`exceeds safe integer range: ${value}`);
  return n;
}

/** Rounds a model value (float) to whole cents / shares / price units. */
export function roundToBigInt(value: number): bigint {
  if (!Number.isFinite(value)) throw new RangeError(`not finite: ${value}`);
  const rounded = Math.round(value);
  return Number.isSafeInteger(rounded) ? BigInt(rounded) : BigInt(rounded.toFixed(0));
}

/**
 * Multiplies a bigint amount with a float factor (market share, growth factor)
 * without converting the amount to float. The factor is quantised to 1e-9.
 */
export function scaleByFloat(amount: bigint, factor: number): bigint {
  if (!Number.isFinite(factor)) throw new RangeError(`not finite: ${factor}`);
  const scaled = BigInt(Math.round(factor * FLOAT_SCALE));
  return divRoundHalfEven(amount * scaled, FLOAT_SCALE_BIG);
}

/** Euro amount as float to bigint cents (seed data and tests only, never for bookings). */
export function centsFromEuros(euros: number): bigint {
  return roundToBigInt(euros * 100);
}

/** Euro price as float to bigint E4. */
export function priceE4FromEuros(euros: number): bigint {
  return roundToBigInt(euros * 10_000);
}

export function eurosFromE4(priceE4: bigint): number {
  return Number(priceE4) / 10_000;
}

export function eurosFromCents(cents: bigint): number {
  return Number(cents) / 100;
}

/** Cents per share to an E4 price. */
export function e4FromCents(cents: bigint): bigint {
  return cents * E4_PER_CENT;
}

export function sumBig(values: readonly bigint[]): bigint {
  let total = ZERO;
  for (const v of values) total += v;
  return total;
}
