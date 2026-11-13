"use client";

import { useEffect } from "react";
import { BALANCE } from "@/config/balance";
import { isDemoMode } from "@/lib/supabase/env";
import { demoTick } from "./demo-engine";
import { useGame } from "./store";

const TICK_MS = BALANCE.time.tickSeconds * 1000;
// Own data changes after own actions (refreshed right then) and slowly otherwise (ADR-123).
const PORTFOLIO_MS = 30_000;
const MISSIONS_MS = 60_000;

/**
 * Keeps the shared game state fresh while the tab is visible: the market every
 * tick, the portfolio every few ticks and right after every action.
 * Demo mode advances its own little market in the same rhythm.
 */
export function GameSync() {
  useEffect(() => {
    const { refreshSnapshot, refreshPortfolio } = useGame.getState();
    const visible = () => document.visibilityState === "visible";
    const { refreshMissions } = useGame.getState();
    void refreshSnapshot();
    void refreshPortfolio();
    void refreshMissions();

    const market = window.setInterval(() => {
      if (!visible()) return;
      if (isDemoMode) demoTick();
      void refreshSnapshot();
    }, TICK_MS);
    const portfolio = window.setInterval(() => {
      if (!visible()) return;
      void refreshPortfolio();
    }, PORTFOLIO_MS);
    const missions = window.setInterval(() => {
      if (visible()) void refreshMissions();
    }, MISSIONS_MS);
    const onVisible = () => {
      if (!visible()) return;
      void refreshSnapshot();
      void refreshPortfolio();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(market);
      window.clearInterval(portfolio);
      window.clearInterval(missions);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
