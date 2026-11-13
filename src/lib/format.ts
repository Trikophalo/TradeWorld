/**
 * Display formatting. Money arrives as integer cents, prices as integers
 * scaled by 10_000 (see docs/DECISIONS.md, ADR-003). Conversion to a
 * floating-point number happens only here, at the very edge, for display.
 */
import { CURRENCIES, DEFAULT_CURRENCY, type CurrencyKey } from "@/config/app";

const LOCALE = "de-DE";
const EURO = CURRENCIES.eur.sign;

/**
 * The sign shown behind amounts (ADR-113). A display setting of the player, set once after the settings are loaded;
 * on the server it stays the default.
 */
let moneySign: string = CURRENCIES[DEFAULT_CURRENCY].sign;

export function setDisplayCurrency(key: CurrencyKey): void {
  moneySign = CURRENCIES[key].sign;
}

export function currencySign(): string {
  return moneySign;
}

/** Intl lays the amount out as euros; the sign is then swapped for the chosen one. */
const own = (text: string) => (moneySign === EURO ? text : text.replace(EURO, moneySign));

/** Texts from messages and from the server name amounts in euros: show them in the chosen currency. */
export function localizeMoneyText(text: string): string {
  return moneySign === EURO || !text.includes(EURO) ? text : text.replaceAll(EURO, moneySign);
}

/**
 * The same for whole answers (objects, arrays): every text inside. Untouched parts keep their identity, nothing is
 * changed in place.
 */
export function localizeMoneyDeep<T>(value: T): T {
  if (moneySign === EURO) return value;
  if (typeof value === "string") return localizeMoneyText(value) as T;
  if (Array.isArray(value)) {
    let copy: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const next = localizeMoneyDeep(value[i] as unknown);
      if (next !== value[i]) (copy ??= [...(value as unknown[])])[i] = next;
    }
    return (copy ?? value) as T;
  }
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    let copy: Record<string, unknown> | null = null;
    for (const [key, item] of Object.entries(value)) {
      const next = localizeMoneyDeep(item);
      if (next !== item) (copy ??= { ...(value as Record<string, unknown>) })[key] = next;
    }
    return (copy ?? value) as T;
  }
  return value;
}

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
  const text = own(formatter.format(value));
  return options.sign && value > 0 ? `+${text}` : text;
}

const shortUnits = [
  { at: 1e12, div: 1e12, unit: "Bio." },
  { at: 1e9, div: 1e9, unit: "Mrd." },
  { at: 1e6, div: 1e6, unit: "Mio." },
] as const;
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/**
 * Short money for live counters (ADR-072): below 10.000 € in whole euros, then "15k €", "1,2 Mio. €".
 * Always rounded towards zero, so "16k" only shows from 16.000 €. The exact amount belongs in a tooltip.
 */
export function formatMoneyShort(cents: Numeric): string {
  const euros = Math.trunc(centsToEuros(cents));
  const abs = Math.abs(euros);
  const sign = euros < 0 ? "−" : "";
  if (abs < 10_000) return own(eurWhole.format(euros));
  for (const { at, div, unit } of shortUnits) {
    if (abs >= at) return `${sign}${oneDecimal.format(Math.floor((abs / div) * 10) / 10)} ${unit} ${moneySign}`;
  }
  return `${sign}${integer.format(Math.floor(abs / 1_000))}k ${moneySign}`;
}

/** Prices below 1 € show up to four decimals so penny stocks stay readable. */
export function formatPrice(priceE4: Numeric): string {
  const value = Number(priceE4) / PRICE_SCALE;
  return own(Math.abs(value) < 1 ? pricePenny.format(value) : eur.format(value));
}

/** 150 bps -> "+1,50 %" */
export function formatBps(bps: number): string {
  return percent.format(bps / 10_000);
}

const shares = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 6 });
const sharesShort = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 4 });

/**
 * Share quantity from millionths (fractional shares): "4", "0,4439", "12,5".
 * `precise` shows all six decimals where they matter (order receipts).
 */
export function formatShares(quantityE6: Numeric, precise = false): string {
  const value = Number(quantityE6) / 1_000_000;
  return (precise ? shares : sharesShort).format(value === 0 || Math.abs(value) >= 0.0001 || precise ? value : 0.0001);
}

export function formatInteger(value: Numeric): string {
  return integer.format(value);
}

/** "02:14:09" or "14:09" for a duration in seconds. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s >= 86_400) {
    // "4 T 10:04" for anything longer than a day
    const days = Math.floor(s / 86_400);
    const rest = s % 86_400;
    const pad2 = (n: number) => String(n).padStart(2, "0");
    return `${days} T ${pad2(Math.floor(rest / 3600))}:${pad2(Math.floor((rest % 3600) / 60))}`;
  }
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
