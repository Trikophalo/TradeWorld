import { DEMO_COMPANIES } from "@/lib/demo/market";

const COLORS: Record<string, string> = Object.fromEntries(DEMO_COMPANIES.map((c) => [c.ticker, c.color]));

/** Brand colour of a company (data, like the pixel art palettes). Bonds and unknown tickers get a neutral slate. */
export function brandColor(ticker: string): string {
  return COLORS[ticker] ?? "#3a4a63";
}
