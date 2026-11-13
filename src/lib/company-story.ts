import {
  NOT_A_PRODUCT,
  PRODUCT_FAMILIES,
  SECTOR_WORDS,
  type ProductFamily,
  type StorySlot,
} from "@/config/company-lexicon";

/*
 * The "Mini-KI" (ADR-091): understands from name and idea what a company makes and fills news and event templates with
 * fitting words. Deterministic: the same company and seed always tell the same story. A profile written by Claude
 * (stored on the server) replaces the lexicon words when present.
 */
export type StoryWords = Record<StorySlot, string[]>;

export interface StoryInput {
  name: string;
  idea: string;
  sector: string;
  /** Name of the chosen product (BALANCE.startups.products), used when the idea names nothing better. */
  productName?: string | null;
  /** Words from the AI profile, if Claude wrote one. */
  aiWords?: Partial<Record<StorySlot, string[]>> | null;
}

export interface CompanyProfile {
  family: string | null;
  words: StoryWords;
}

const SLOTS: readonly StorySlot[] = ["product", "input", "tax", "rule", "risk", "trend", "buyer", "critic", "place"];

/** Lower case, umlauts folded, so "Bäckerei" matches the stem "baeck". */
export function fold(text: string): string {
  return ` ${text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")} `;
}

/** The best matching product family: the one with the most stems in the text. */
export function matchFamily(text: string): ProductFamily | null {
  const hay = fold(text);
  let best: ProductFamily | null = null;
  let bestScore = 0;
  for (const family of PRODUCT_FAMILIES) {
    const score = family.match.reduce((n, stem) => n + (hay.includes(stem) ? stem.length : 0), 0);
    if (score > bestScore) {
      best = family;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The product as the player wrote it: German nouns are capitalised, so take the longest capitalised word of the
 * idea that is not the company's name or a filler word ("Wir stellen Toilettenpapier her" → "Toilettenpapier").
 */
export function productWord(idea: string, name: string): string | null {
  const nameWords = new Set(fold(name).trim().split(/\s+/));
  const words = idea.match(/[A-ZÄÖÜ][a-zäöüß-]{3,}/g) ?? [];
  const candidates = words.filter((w) => {
    const f = fold(w).trim();
    return !NOT_A_PRODUCT.includes(f) && !nameWords.has(f);
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.length > a.length ? b : a));
}

export function companyProfile(input: StoryInput): CompanyProfile {
  const family = matchFamily(`${input.name} ${input.idea}`);
  const sector = SECTOR_WORDS[input.sector] ?? SECTOR_WORDS.tech!;
  const own = productWord(input.idea, input.name);
  const words = {} as StoryWords;
  for (const slot of SLOTS) {
    const ai = input.aiWords?.[slot]?.filter((w) => w.trim().length > 0);
    if (ai && ai.length > 0) {
      words[slot] = ai;
    } else if (slot === "product") {
      // The player's own word wins over the family's, it is what they wrote.
      words.product = [own, family?.words.product[0], input.productName].filter((w): w is string => Boolean(w));
      if (words.product.length === 0) words.product = ["Produkte"];
    } else {
      words[slot] = [...(family?.words[slot] ?? sector[slot])];
    }
  }
  return { family: family?.key ?? null, words };
}

/** A stable number from an id, to pick the same words every time. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function pick<T>(list: readonly T[], seed: number, salt = 0): T {
  return list[(seed + salt * 7919) % list.length]!;
}

/** The values for {company}, {product}, {input} ... in a template. */
export function storyValues(profile: CompanyProfile, company: string, seed: number): Record<string, string> {
  const values: Record<string, string> = { company };
  SLOTS.forEach((slot, i) => {
    // The product stays the same in one story; other slots vary with the seed.
    values[slot] = slot === "product" ? profile.words.product[0]! : pick(profile.words[slot], seed, i + 1);
  });
  return values;
}

/** Replaces {key} placeholders; unknown keys stay readable instead of breaking the text. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? key);
}

/** One of several templates, chosen by the seed, filled in. */
export function tell(templates: readonly string[], profile: CompanyProfile, company: string, seed: number): string {
  if (templates.length === 0) return "";
  return fillTemplate(pick(templates, seed), storyValues(profile, company, seed));
}
