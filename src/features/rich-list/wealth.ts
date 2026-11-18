import { WEALTH_PARTS, type WealthPart, type WealthSource } from "@/features/game/types";

/** The net worth: the sum of every part (debt negative), as player_wealth_parts on the server (ADR-203). */
export function wealthTotal(parts: Record<WealthPart, number>): number {
  return WEALTH_PARTS.reduce((sum, key) => sum + parts[key], 0);
}

/**
 * The main source of a fortune, as rich_list_rows on the server (ADR-203): the largest positive group, ties by key.
 * Cash includes the vault and subscription money, Nexamon cards and slabs count together.
 */
export function wealthSource(parts: Record<WealthPart, number>): WealthSource | null {
  const groups: [WealthSource, number][] = [
    ["cash", parts.cash + parts.vault + parts.escrow],
    ["depot", parts.depot],
    ["company", parts.company],
    ["cards", parts.cards + parts.slabs],
    ["nfts", parts.nfts],
    ["property", parts.property],
  ];
  let best: [WealthSource, number] | null = null;
  for (const g of groups) {
    if (g[1] <= 0) continue;
    if (!best || g[1] > best[1] || (g[1] === best[1] && g[0] < best[0])) best = g;
  }
  return best ? best[0] : null;
}
