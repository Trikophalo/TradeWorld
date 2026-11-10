import type { SectorKey } from "@/components/pixel/art";

/**
 * Example data for demo mode and for the M0 screens. The 15 companies match
 * supabase/seed.sql (docs/DECISIONS.md, ADR-014). Prices are scaled by 10_000.
 * Everything in src/lib/demo disappears from the data path in M1.
 */
export type CompanyTier = "bluechip" | "midcap" | "penny";

export interface DemoCompany {
  ticker: string;
  name: string;
  sector: SectorKey;
  tier: CompanyTier;
  priceE4: number;
  /** Change since the opening bell in basis points. */
  changeBps: number;
  marketCapCents: number;
  /** Brand colour, used by the fallback logo and the chart accent. */
  color: string;
}

export const DEMO_COMPANIES: readonly DemoCompany[] = [
  {
    ticker: "KLS",
    name: "KlarSoft AG",
    sector: "tech",
    tier: "bluechip",
    priceE4: 1_842_500,
    changeBps: 124,
    marketCapCents: 921_250_000_00,
    color: "#0f6f7a",
  },
  {
    ticker: "PXW",
    name: "Pixelwerk Studios",
    sector: "tech",
    tier: "midcap",
    priceE4: 463_800,
    changeBps: -86,
    marketCapCents: 92_760_000_00,
    color: "#7a3fd1",
  },
  {
    ticker: "QSL",
    name: "QuantenSprung Labs",
    sector: "tech",
    tier: "penny",
    priceE4: 7_420,
    changeBps: 1840,
    marketCapCents: 3_710_000_00,
    color: "#c2287a",
  },
  {
    ticker: "BRZ",
    name: "Brotzeit Handel AG",
    sector: "retail",
    tier: "bluechip",
    priceE4: 678_900,
    changeBps: 31,
    marketCapCents: 543_120_000_00,
    color: "#7d2a2a",
  },
  {
    ticker: "KFR",
    name: "Kaufrausch Märkte",
    sector: "retail",
    tier: "midcap",
    priceE4: 214_300,
    changeBps: -142,
    marketCapCents: 64_290_000_00,
    color: "#b54a08",
  },
  {
    ticker: "FGD",
    name: "Fundgrube Discount",
    sector: "retail",
    tier: "penny",
    priceE4: 11_850,
    changeBps: -720,
    marketCapCents: 2_370_000_00,
    color: "#5d6b1e",
  },
  {
    ticker: "VLT",
    name: "Volta Energie AG",
    sector: "energy",
    tier: "bluechip",
    priceE4: 1_126_400,
    changeBps: 208,
    marketCapCents: 788_480_000_00,
    color: "#17306b",
  },
  {
    ticker: "RKW",
    name: "Rheinkraft Werke",
    sector: "energy",
    tier: "midcap",
    priceE4: 352_700,
    changeBps: 67,
    marketCapCents: 105_810_000_00,
    color: "#0b5c4a",
  },
  {
    ticker: "SFX",
    name: "SolarFuchs",
    sector: "energy",
    tier: "penny",
    priceE4: 23_600,
    changeBps: 912,
    marketCapCents: 4_720_000_00,
    color: "#b8742f",
  },
  {
    ticker: "NPH",
    name: "NeuroPharm AG",
    sector: "pharma",
    tier: "bluechip",
    priceE4: 2_314_000,
    changeBps: -58,
    marketCapCents: 694_200_000_00,
    color: "#a31c64",
  },
  {
    ticker: "ALM",
    name: "Alpenmed",
    sector: "pharma",
    tier: "midcap",
    priceE4: 587_200,
    changeBps: 15,
    marketCapCents: 88_080_000_00,
    color: "#1f6f4a",
  },
  {
    ticker: "GNV",
    name: "GenoVita Biotech",
    sector: "pharma",
    tier: "penny",
    priceE4: 4_180,
    changeBps: -1260,
    marketCapCents: 2_090_000_00,
    color: "#5b45e6",
  },
  {
    ticker: "NDL",
    name: "Nordlicht Logistik AG",
    sector: "logistics",
    tier: "bluechip",
    priceE4: 894_100,
    changeBps: -24,
    marketCapCents: 447_050_000_00,
    color: "#0f52a3",
  },
  {
    ticker: "EBX",
    name: "Eilbote Express",
    sector: "logistics",
    tier: "midcap",
    priceE4: 176_500,
    changeBps: 93,
    marketCapCents: 52_950_000_00,
    color: "#9a5b00",
  },
  {
    ticker: "FPT",
    name: "Frachtpilot",
    sector: "logistics",
    tier: "penny",
    priceE4: 15_300,
    changeBps: 455,
    marketCapCents: 3_060_000_00,
    color: "#3a4a63",
  },
];

export const DEMO_INDEX = { name: "NEXA 30", points: 12_486.4, changeBps: 47 } as const;

export function findDemoCompany(ticker: string): DemoCompany | undefined {
  return DEMO_COMPANIES.find((company) => company.ticker === ticker.toUpperCase());
}

/** Small deterministic generator so demo charts look the same on server and client. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface DemoPoint {
  /** Unix seconds */
  time: number;
  value: number;
}

export const DEMO_RANGES = ["1T", "1W", "1M", "1J"] as const;
export type DemoRange = (typeof DEMO_RANGES)[number];

const RANGE_SHAPE: Record<DemoRange, { points: number; stepSeconds: number; volatility: number }> = {
  "1T": { points: 168, stepSeconds: 300, volatility: 0.0022 },
  "1W": { points: 168, stepSeconds: 3600, volatility: 0.005 },
  "1M": { points: 180, stepSeconds: 14_400, volatility: 0.009 },
  "1J": { points: 365, stepSeconds: 86_400, volatility: 0.016 },
};

/**
 * A random walk that ends exactly at `endValue`. `anchor` (unix seconds) is
 * passed in, so the function stays pure.
 */
export function demoSeries(key: string, endValue: number, range: DemoRange, anchor: number): DemoPoint[] {
  const shape = RANGE_SHAPE[range];
  const random = mulberry32(hash(`${key}:${range}`));
  const drift = (random() - 0.42) * shape.volatility * 0.35;
  const raw: number[] = [1];
  for (let i = 1; i < shape.points; i++) {
    const shock = (random() + random() + random() - 1.5) * shape.volatility * 1.6;
    raw.push(Math.max(0.05, raw[i - 1]! * (1 + drift + shock)));
  }
  const factor = endValue / raw[raw.length - 1]!;
  const end = Math.floor(anchor / shape.stepSeconds) * shape.stepSeconds;
  return raw.map((value, i) => ({
    time: end - (shape.points - 1 - i) * shape.stepSeconds,
    value: Math.round(value * factor * 100) / 100,
  }));
}
