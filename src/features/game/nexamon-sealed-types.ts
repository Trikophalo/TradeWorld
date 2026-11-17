import type { NexamonPackResult, NexamonSetKey } from "./nexamon-types";

/** A booster pack the player owns but has not opened (ADR-177): won in a news battle or bought to open later. */
export interface NexamonSealedPack {
  id: string;
  set: NexamonSetKey;
  name: string;
  source: "battle" | "bought";
  /** What was paid for it (0 for a prize). */
  priceCents: number;
  createdAt: string;
}

export interface NexamonSealedPacks {
  packs: NexamonSealedPack[];
  unlocked: boolean;
}

export interface NexamonSealedOpenResult extends NexamonPackResult {
  sealedId: string;
  sealedLeft: number;
}

export interface NexamonSealedBuyResult {
  set: NexamonSetKey;
  count: number;
  priceCents: number;
  packs: NexamonSealedPack[];
}

export interface NexamonSealedEngine {
  /** The unopened packs, oldest first (works while Nexamon is still locked). */
  nexamonSealedPacks(): Promise<NexamonSealedPacks>;
  /** Opens one: the same pull as a bought pack, nothing to pay. */
  openNexamonSealedPack(requestId: string, packId: string): Promise<NexamonSealedOpenResult>;
  /** Buys `count` packs of a set at the pack price and keeps them sealed. */
  buyNexamonSealedPack(requestId: string, set: NexamonSetKey, count: number): Promise<NexamonSealedBuyResult>;
}
