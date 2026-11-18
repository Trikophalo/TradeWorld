/*
 * Mira knows the countries of the world map (ADR-208): "Wie ist China?", "Wo soll meine Zentrale hin?". Answered from
 * the config, without Claude (cheap). Pure.
 */
import { COUNTRIES, WORLD_RULES, type CountryConfig } from "@/config/countries";
import { formatBps, formatMoney, formatPercentBps } from "@/lib/format";
import type { MiraLine, MiraOption } from "./brain";

const fold = (text: string) =>
  ` ${text
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, " ")} `;

/** Extra names players use for a country. */
const ALIASES: Record<string, readonly string[]> = {
  us: ["usa", "amerika", "vereinigte staaten", "us"],
  gb: ["uk", "england", "grossbritannien", "britannien", "vereinigtes koenigreich"],
  ae: ["vae", "emirate", "dubai"],
  kr: ["korea", "suedkorea"],
  ch: ["schweiz"],
  za: ["suedafrika"],
  tr: ["tuerkei"],
};

const WORLD =
  /\b(standort\w*|weltkarte|zentrale|hauptquartier|hq|tochterfirm\w*|toechter|lobby|marktfuehrer|land|laender\w*)\b/;

/** The country a text names, if any. */
export function countryInText(text: string): CountryConfig | null {
  const norm = fold(text);
  for (const c of COUNTRIES) {
    const names = [fold(c.name).trim(), ...(ALIASES[c.key] ?? [])];
    if (names.some((n) => norm.includes(` ${n} `))) return c;
  }
  return null;
}

/** Whether a message asks about the world map: a country by name or a word like "Standort". */
export function isWorldQuestion(text: string): boolean {
  return countryInText(text) !== null || WORLD.test(fold(text));
}

const delta = (bps: number) => formatBps(bps - 10_000);

/** Mira's answer: the traits of a named country, or how the world map works. */
export function worldTurnLines(country: CountryConfig | null): MiraLine[] {
  if (!country) {
    return [
      { key: "world.about", values: { amount: formatMoney(WORLD_RULES.unlockWorthCents, { whole: true }) } },
      { key: "world.tip" },
    ];
  }
  const traits = [
    { name: "production", score: 10_000 - country.productionCostBps },
    { name: "labour", score: 10_000 - country.labourCostBps },
    { name: "demand", score: country.demandPotentialBps - 10_000 },
    { name: "image", score: country.imageBps - 10_000 },
    { name: "tax", score: (WORLD_RULES.balance.taxBaselineBps - country.taxRateBps) * 2 },
  ].sort((a, b) => b.score - a.score);
  return [
    {
      key: "world.country",
      values: {
        name: country.name,
        production: delta(country.productionCostBps),
        labour: delta(country.labourCostBps),
        demand: delta(country.demandPotentialBps),
        image: delta(country.imageBps),
        tax: formatPercentBps(country.taxRateBps),
      },
    },
    { key: "world.strength", values: { best: traits[0]!.name, worst: traits.at(-1)!.name } },
    {
      key: "world.risks",
      values: {
        political: country.politicalRisk,
        tariff: country.tariffExposure,
        war: country.warRisk,
        disasters: country.disasterRisk.length,
      },
    },
  ];
}

export const worldOpenOption: MiraOption = {
  action: { type: "open", section: "location" },
  label: { key: "open.label", values: { section: "location" } },
};
