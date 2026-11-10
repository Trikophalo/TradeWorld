import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, TIME_ZONE } from "@/config/app";

/**
 * One locale for now. Adding a language means adding messages/<locale>.json
 * and choosing the locale here (cookie or profile setting).
 */
export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  timeZone: TIME_ZONE,
  messages: (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default,
}));
