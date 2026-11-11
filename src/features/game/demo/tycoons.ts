import { BALANCE } from "@/config/balance";

/*
 * Fictional AI tycoons for the offline demo's rich list. The live game seeds
 * its own list in the database. Names are invented; any similarity to real
 * people would be accidental.
 */

const FIRST = [
  "Helga",
  "Jonas",
  "Marlene",
  "Friedrich",
  "Ilse",
  "Konrad",
  "Theresa",
  "Anton",
  "Greta",
  "Lorenz",
  "Paula",
  "Valentin",
  "Edith",
  "Ruben",
  "Clara",
  "Gustav",
  "Frieda",
  "Matteo",
  "Ida",
  "Leopold",
];
const LAST = [
  "Brandt",
  "Wiegand",
  "Achterberg",
  "Hollmann",
  "Stöckel",
  "Rautenberg",
  "Falkner",
  "Lindqvist",
  "Overbeck",
  "Sauerland",
  "Marquardt",
  "Zellweger",
  "Kerschbaum",
  "Ostrowski",
  "Duvenbeck",
  "Tannhäuser",
  "Brökelmann",
  "Vogtland",
  "Hinrichsen",
  "Wolkenstein",
];
const DESCRIPTIONS = [
  "Gründer:in von KlarSoft",
  "Mehrheitsaktionär:in bei Volta Energie",
  "Erb:in einer Reederei",
  "Family Office aus Hamburg",
  "Investor:in in Pharma-Start-ups",
  "Gründer:in von Nordlicht Logistik",
  "Handelsimperium Brotzeit",
  "Business Angel aus München",
  "Immobilien und Beteiligungen",
  "Tech-Investor:in",
  "Day-Trader:in",
  "Ehemalige:r Fondsmanager:in",
  "Mittelständler:in aus dem Schwarzwald",
  "Privatier",
];

export interface DemoTycoon {
  id: string;
  name: string;
  description: string;
  /** Net worth at the start of the demo; moves with the market index. */
  baseWealthCents: number;
  /** How strongly this fortune follows the market (diversified ones less). */
  beta: number;
}

/** Pareto-like ladder from the poorest to the richest tycoon, deterministic. */
export function demoTycoons(): DemoTycoon[] {
  const { aiTycoons, tycoonMinWealthCents, tycoonMaxWealthCents } = BALANCE.richList;
  const ratio = tycoonMaxWealthCents / tycoonMinWealthCents;
  return Array.from({ length: aiTycoons }, (_, i) => {
    // Position 0 = richest. Exponent > 1 puts most tycoons at the lower end.
    const t = 1 - i / (aiTycoons - 1);
    const wealth = tycoonMinWealthCents * Math.pow(ratio, Math.pow(t, 2.2));
    const first = FIRST[(i * 7) % FIRST.length]!;
    const last = LAST[(i * 11 + Math.floor(i / FIRST.length)) % LAST.length]!;
    return {
      id: `tycoon-${i}`,
      name: i % 9 === 4 ? `Familie ${last}` : `${first} ${last}`,
      description: DESCRIPTIONS[(i * 5) % DESCRIPTIONS.length]!,
      baseWealthCents: Math.round(wealth),
      beta: 0.4 + ((i * 37) % 100) / 100,
    };
  });
}
