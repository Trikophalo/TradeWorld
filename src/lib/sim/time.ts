/**
 * Game time helpers. The simulation never reads a clock: callers pass the
 * current time and the local (Europe/Berlin) hour.
 */
import { BALANCE } from "../../config/balance.ts";
import type { TimeConfig } from "../../config/balance.ts";
import type { MarketSession } from "./types.ts";

/** Market session for a local wall-clock hour (may be fractional, e.g. 21.5). */
export function marketSession(localHour: number, cfg: TimeConfig = BALANCE.time): MarketSession {
  return localHour >= cfg.marketOpenHour && localHour < cfg.marketCloseHour ? "open" : "after_hours";
}

export function secondsPerGameYear(cfg: TimeConfig = BALANCE.time): number {
  return cfg.quarterHours * cfg.quartersPerGameYear * 3600;
}

export function ticksPerQuarter(cfg: TimeConfig = BALANCE.time): number {
  return (cfg.quarterHours * 3600) / cfg.tickSeconds;
}
