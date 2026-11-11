"use client";

import { create } from "zustand";
import { isDemoMode } from "@/lib/supabase/env";
import { liveEngine } from "./api";
import { demoEngine } from "./demo-engine";
import type { GameEngine, MarketSnapshot, OrderInput, OrderResult, Portfolio, Security } from "./types";

/** The live Supabase API, or the offline demo when no Supabase project is configured. */
export const engine: GameEngine = isDemoMode ? demoEngine : liveEngine;

interface GameState {
  snapshot: MarketSnapshot | null;
  byTicker: Record<string, Security>;
  portfolio: Portfolio | null;
  /** Local clock minus server clock in ms, for countdowns. */
  clockSkewMs: number;
  refreshSnapshot: () => Promise<void>;
  refreshPortfolio: () => Promise<void>;
  placeOrder: (input: OrderInput) => Promise<OrderResult>;
  cancelOrder: (orderId: string) => Promise<void>;
  claimVault: () => Promise<number>;
  completeTutorial: () => Promise<void>;
}

let snapshotInFlight: Promise<void> | null = null;
let portfolioInFlight: Promise<void> | null = null;

/**
 * Server state the whole app shares: market snapshot (polled every tick) and
 * the player's portfolio. Components select single values, so a price tick only
 * re-renders the rows whose price changed.
 */
export const useGame = create<GameState>((set, get) => ({
  snapshot: null,
  byTicker: {},
  portfolio: null,
  clockSkewMs: 0,

  refreshSnapshot: () =>
    (snapshotInFlight ??= engine
      .snapshot()
      .then((snapshot) => {
        const previous = get().byTicker;
        const byTicker: Record<string, Security> = {};
        for (const security of snapshot.securities) {
          const old = previous[security.ticker];
          // Keep object identity when nothing changed, so selectors don't re-render.
          byTicker[security.ticker] =
            old && old.lastE4 === security.lastE4 && old.bidE4 === security.bidE4 && old.askE4 === security.askE4
              ? old
              : security;
        }
        set({ snapshot, byTicker, clockSkewMs: Date.now() - Date.parse(snapshot.serverTime) });
      })
      .catch(() => undefined)
      .finally(() => {
        snapshotInFlight = null;
      })),

  refreshPortfolio: () =>
    (portfolioInFlight ??= engine
      .portfolio()
      .then((portfolio) => set({ portfolio }))
      .catch(() => undefined)
      .finally(() => {
        portfolioInFlight = null;
      })),

  placeOrder: async (input) => {
    const result = await engine.placeOrder(input);
    await Promise.all([get().refreshPortfolio(), get().refreshSnapshot()]);
    return result;
  },

  cancelOrder: async (orderId) => {
    await engine.cancelOrder(crypto.randomUUID(), orderId);
    await get().refreshPortfolio();
  },

  claimVault: async () => {
    const result = await engine.claimVault(crypto.randomUUID());
    await get().refreshPortfolio();
    return result.claimedCents;
  },

  completeTutorial: async () => {
    await engine.completeTutorial(crypto.randomUUID());
    await get().refreshPortfolio();
  },
}));

// ---- Selectors

export const usePlayerLevel = () => useGame((state) => state.portfolio?.level ?? 1);
export const useSecurity = (ticker: string) => useGame((state) => state.byTicker[ticker]);
export const useMarketReady = () => useGame((state) => state.snapshot !== null);
