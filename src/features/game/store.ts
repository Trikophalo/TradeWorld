"use client";

import { create } from "zustand";
import { localizeMoneyDeep } from "@/lib/format";
import { isDemoMode } from "@/lib/supabase/env";
import { liveEngine } from "./api";
import { demoEngine } from "./demo-engine";
import type {
  GameEngine,
  MarketSnapshot,
  MissionGroup,
  OrderInput,
  OrderResult,
  Portfolio,
  ProgressResult,
  Security,
  TrackedEvent,
} from "./types";

/**
 * Texts written by the server (news, notifications, mission texts) name amounts in euros. Every answer passes
 * through here once and comes out in the player's display currency (ADR-113).
 */
function inDisplayCurrency(source: GameEngine): GameEngine {
  return new Proxy(source, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
        return result instanceof Promise ? result.then(localizeMoneyDeep) : localizeMoneyDeep(result);
      };
    },
  });
}

/** The live Supabase API, or the offline demo when no Supabase project is configured. */
export const engine: GameEngine = inDisplayCurrency(isDemoMode ? demoEngine : liveEngine);

interface GameState {
  snapshot: MarketSnapshot | null;
  byTicker: Record<string, Security>;
  portfolio: Portfolio | null;
  missions: MissionGroup[] | null;
  /** Local clock minus server clock in ms, for countdowns. */
  clockSkewMs: number;
  refreshSnapshot: () => Promise<void>;
  refreshPortfolio: () => Promise<void>;
  placeOrder: (input: OrderInput) => Promise<OrderResult>;
  cancelOrder: (orderId: string) => Promise<void>;
  claimVault: () => Promise<number>;
  completeTutorial: () => Promise<void>;
  refreshMissions: () => Promise<void>;
  claimMission: (missionId: string) => Promise<ProgressResult>;
  checkIn: () => Promise<{ xpAwarded: number; streakDays: number; alreadyCheckedIn: boolean }>;
  changeNickname: (nickname: string) => Promise<void>;
  track: (event: TrackedEvent, ref?: string) => void;
  /** Forget everything about the signed-in player (sign-out, account switch). The market stays. */
  resetPlayer: () => void;
}

let snapshotInFlight: Promise<void> | null = null;
let portfolioInFlight: Promise<void> | null = null;
let missionsInFlight: Promise<void> | null = null;

/**
 * Server state the whole app shares: market snapshot (polled every tick) and
 * the player's portfolio. Components select single values, so a price tick only
 * re-renders the rows whose price changed.
 */
export const useGame = create<GameState>((set, get) => ({
  snapshot: null,
  byTicker: {},
  portfolio: null,
  missions: null,
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

  refreshMissions: () =>
    (missionsInFlight ??= engine
      .missions()
      .then((missions) => set({ missions }))
      .catch(() => undefined)
      .finally(() => {
        missionsInFlight = null;
      })),

  placeOrder: async (input) => {
    const result = await engine.placeOrder(input);
    await Promise.all([get().refreshPortfolio(), get().refreshSnapshot(), get().refreshMissions()]);
    return result;
  },

  claimMission: async (missionId) => {
    const result = await engine.claimMission(crypto.randomUUID(), missionId);
    await Promise.all([get().refreshPortfolio(), get().refreshMissions()]);
    return result;
  },

  checkIn: async () => {
    const result = await engine.checkIn(crypto.randomUUID());
    if (!result.alreadyCheckedIn) await Promise.all([get().refreshPortfolio(), get().refreshMissions()]);
    return result;
  },

  changeNickname: async (nickname) => {
    await engine.changeNickname(crypto.randomUUID(), nickname);
    await get().refreshPortfolio();
  },

  resetPlayer: () => set({ portfolio: null, missions: null }),

  track: (event, ref) => {
    void engine.track(event, ref).then(() => get().refreshMissions());
  },

  cancelOrder: async (orderId) => {
    await engine.cancelOrder(crypto.randomUUID(), orderId);
    await get().refreshPortfolio();
  },

  claimVault: async () => {
    const result = await engine.claimVault(crypto.randomUUID());
    await Promise.all([get().refreshPortfolio(), get().refreshMissions()]);
    return result.claimedCents;
  },

  completeTutorial: async () => {
    await engine.completeTutorial(crypto.randomUUID());
    await Promise.all([get().refreshPortfolio(), get().refreshMissions()]);
  },
}));

// ---- Selectors

export const usePlayerLevel = () => useGame((state) => state.portfolio?.level ?? 1);
export const useSecurity = (ticker: string) => useGame((state) => state.byTicker[ticker]);
export const useMarketReady = () => useGame((state) => state.snapshot !== null);
