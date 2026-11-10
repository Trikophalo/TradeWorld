/**
 * Display formatting. Money arrives as integer cents, prices as integers
 * scaled by 10_000 (see docs/DECISIONS.md, ADR-003). Conversion to a
 * floating-point number happens only here, at the very edge, for display.
 */
const LOCALE = "de-DE";

export const PRICE_SCALE = 10_000;

type Numeric = bigint | number;

const eur = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const eurWhole = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const eurCompact = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});
const pricePenny = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 3,
  maximumFractionDigits: 4,
});
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

export function centsToEuros(cents: Numeric): number {
  return Number(cents) / 100;
}

export function formatMoney(
  cents: Numeric,
  options: { whole?: boolean; compact?: boolean; sign?: boolean } = {},
): string {
  const value = centsToEuros(cents);
  const formatter = options.compact ? eurCompact : options.whole ? eurWhole : eur;
  const text = formatter.format(value);
  return options.sign && value > 0 ? `+${text}` : text;
}

/** Prices below 1 € show up to four decimals so penny stocks stay readable. */
export function formatPrice(priceE4: Numeric): string {
  const value = Number(priceE4) / PRICE_SCALE;
  return Math.abs(value) < 1 ? pricePenny.format(value) : eur.format(value);
}

/** 150 bps -> "+1,50 %" */
export function formatBps(bps: number): string {
  return percent.format(bps / 10_000);
}

export function formatInteger(value: Numeric): string {
  return integer.format(value);
}

/** "02:14:09" or "14:09" for a duration in seconds. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
