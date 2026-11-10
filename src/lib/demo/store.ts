"use client";

import { create } from "zustand";
import { BALANCE } from "@/config/balance";
import { DEMO_COMPANIES, DEMO_INDEX } from "./market";

/**
 * Client-only state that makes demo mode feel alive: prices wiggle every few
 * seconds and the vault can be emptied. None of this is game logic. In M1 the
 * same components read real server state through TanStack Query and Realtime.
 */
export interface DemoQuote {
  priceE4: number;
  changeBps: number;
}

const HOUR_MS = 3_600_000;
export const DEMO_VAULT = {
  ratePerHourCents: BALANCE.economy.basicIncomeCentsPerHour,
  capHours: BALANCE.economy.vaultCapHours,
} as const;

interface DemoState {
  quotes: Record<string, DemoQuote>;
  indexPoints: number;
  indexChangeBps: number;
  cashCents: number;
  /** Epoch ms of the last claim. Null until the client has mounted. */
  vaultClaimedAt: number | null;
  level: number;
  xpInLevel: number;
  tick: () => void;
  mount: () => void;
  claimVault: () => number;
  addXp: (amount: number) => void;
}

const initialQuotes = Object.fromEntries(
  DEMO_COMPANIES.map((c) => [c.ticker, { priceE4: c.priceE4, changeBps: c.changeBps }]),
);

export function vaultCents(claimedAt: number | null, now: number): number {
  if (claimedAt === null) return 0;
  const hours = Math.min(DEMO_VAULT.capHours, Math.max(0, (now - claimedAt) / HOUR_MS));
  return Math.floor(hours * DEMO_VAULT.ratePerHourCents);
}

export const useDemo = create<DemoState>((set, get) => ({
  quotes: initialQuotes,
  indexPoints: DEMO_INDEX.points,
  indexChangeBps: DEMO_INDEX.changeBps,
  cashCents: BALANCE.economy.startingCapitalCents,
  vaultClaimedAt: null,
  level: 4,
  xpInLevel: 520,

  mount: () => {
    // Start with a vault that is a bit more than half full.
    if (get().vaultClaimedAt === null) set({ vaultClaimedAt: Date.now() - 4.6 * HOUR_MS });
  },

  tick: () =>
    set((state) => {
      const quotes = { ...state.quotes };
      const tickers = Object.keys(quotes);
      let indexMove = 0;
      // Move roughly a third of the list per tick, penny stocks more than blue chips.
      for (const ticker of tickers) {
        if (Math.random() > 0.35) continue;
        const quote = quotes[ticker]!;
        const swing = quote.priceE4 < 50_000 ? 90 : 14;
        const moveBps = Math.round((Math.random() - 0.48) * swing);
        if (moveBps === 0) continue;
        quotes[ticker] = {
          priceE4: Math.max(100, Math.round(quote.priceE4 * (1 + moveBps / 10_000))),
          changeBps: quote.changeBps + moveBps,
        };
        indexMove += moveBps / tickers.length;
      }
      return {
        quotes,
        indexPoints: Math.round(state.indexPoints * (1 + indexMove / 10_000) * 10) / 10,
        indexChangeBps: Math.round(state.indexChangeBps + indexMove),
      };
    }),

  claimVault: () => {
    const now = Date.now();
    const amount = vaultCents(get().vaultClaimedAt, now);
    if (amount <= 0) return 0;
    set((state) => ({ cashCents: state.cashCents + amount, vaultClaimedAt: now }));
    return amount;
  },

  addXp: (amount) => set((state) => ({ xpInLevel: state.xpInLevel + amount })),
}));
