/**
 * Prizes of a news battle (ADR-160, ADR-177): which prize kind, which accessory tier, which sealed Nexamon booster
 * packs. Pure: the random numbers (0 <= u < 1) are passed in. Mirrored by public.battle_pick_packs and the tier pick
 * in public.battle_open.
 */

/** A key from weights {key: weight}, keys in sorted order (as jsonb_each in SQL); null without weights. */
export function pickWeighted(weights: Readonly<Record<string, number>>, u: number): string | null {
  const keys = Object.keys(weights)
    .filter((k) => (weights[k] ?? 0) > 0)
    .sort();
  const total = keys.reduce((sum, k) => sum + weights[k]!, 0);
  if (total <= 0) return null;
  let roll = u * total;
  for (const k of keys) {
    roll -= weights[k]!;
    if (roll < 0) return k;
  }
  return keys[keys.length - 1]!;
}

export interface PackSet {
  readonly key: string;
  readonly priceCents: number;
}

export interface PackPrize {
  readonly set: string;
  readonly count: number;
}

/**
 * Sealed booster packs worth at most capCents in total (at most maxPacks): a main set drawn among the sets that fit
 * (most expensive first in the list), 1..as many as fit of it; with u3 < 0.5 the rest of the budget goes to packs of
 * the cheapest other set that still fits. Empty when no set fits.
 */
export function pickPackPrize(
  sets: readonly PackSet[],
  capCents: number,
  maxPacks: number,
  u1: number,
  u2: number,
  u3: number,
  u4: number,
): PackPrize[] {
  const fit = sets
    .filter((s) => s.priceCents > 0 && s.priceCents <= capCents)
    .sort((a, b) => b.priceCents - a.priceCents || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (fit.length === 0 || maxPacks < 1) return [];
  const main = fit[Math.min(fit.length - 1, Math.floor(u1 * fit.length))]!;
  const mainMax = Math.min(maxPacks, Math.floor(capCents / main.priceCents));
  const mainCount = 1 + Math.min(mainMax - 1, Math.floor(u2 * mainMax));
  const out: PackPrize[] = [{ set: main.key, count: mainCount }];
  const rest = capCents - mainCount * main.priceCents;
  if (u3 < 0.5) {
    const second = [...fit].reverse().find((s) => s.key !== main.key && s.priceCents <= rest);
    if (second) {
      const max = Math.min(maxPacks - mainCount, Math.floor(rest / second.priceCents));
      if (max >= 1) out.push({ set: second.key, count: 1 + Math.min(max - 1, Math.floor(u4 * max)) });
    }
  }
  return out;
}

/** The price of packs at the given set prices. */
export function packsValueCents(packs: readonly PackPrize[], sets: readonly PackSet[]): number {
  return packs.reduce((sum, p) => sum + p.count * (sets.find((s) => s.key === p.set)?.priceCents ?? 0), 0);
}
