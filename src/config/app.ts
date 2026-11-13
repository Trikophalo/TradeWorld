/** Working title. Change it here and in messages/*.json only. */
export const APP_NAME = "NEXA";
export const INDEX_NAME = "NEXA 30";
export const DEFAULT_LOCALE = "de";
export const TIME_ZONE = "Europe/Berlin";
export const SETTINGS_STORAGE_KEY = "nexa-settings";
/**
 * The game's own currency (ADR-110): play money, never euro. Amounts are stored in hundredths (`*_cents`);
 * `src/lib/format.ts` puts the code behind every amount. Change the name here and in messages/*.json.
 */
export const CURRENCY = { name: "Nex", code: "NX" } as const;
