/** Working title. Change it here and in messages/*.json only. */
export const APP_NAME = "NEXA";
export const INDEX_NAME = "NEXA 30";
export const DEFAULT_LOCALE = "de";
export const TIME_ZONE = "Europe/Berlin";
export const SETTINGS_STORAGE_KEY = "nexa-settings";

/**
 * Display currencies (ADR-113). The game counts in one unit; the player only picks the sign shown behind amounts.
 * Amounts are the same in every currency. Names for the settings live in messages.
 */
export const CURRENCIES = {
  eur: { sign: "€" },
  usd: { sign: "$" },
  nx: { sign: "NX" },
} as const;
export type CurrencyKey = keyof typeof CURRENCIES;
export const CURRENCY_KEYS = Object.keys(CURRENCIES) as CurrencyKey[];
export const DEFAULT_CURRENCY: CurrencyKey = "eur";
