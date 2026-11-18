/**
 * Büroflächen (ADR-218): a paid line of seats beside legal form, expansion levels and headquarters. Seats of a player
 * company = legal form + employeesPerLevel × expansion level + headquarters seats + office seats, at most
 * maxTotalSeats (1.000). Mirrored in Postgres (supabase/migrations/20261204011310_company_offices.sql).
 */
import { BALANCE } from "../../config/balance.ts";
import type { StartupsConfig } from "../../config/balance.ts";

export type OfficesConfig = StartupsConfig["offices"];
export type OfficeStep = OfficesConfig["steps"][number];

/** Office seats after `level` bought steps. */
export function officeSeats(level: number, cfg: OfficesConfig = BALANCE.startups.offices): number {
  let seats = 0;
  for (let i = 0; i < Math.min(Math.max(0, level), cfg.steps.length); i++) seats += cfg.steps[i]!.seats;
  return seats;
}

/** The step bought next (level + 1), or null when every step is bought. */
export function nextOfficeStep(level: number, cfg: OfficesConfig = BALANCE.startups.offices): OfficeStep | null {
  return cfg.steps[Math.max(0, level)] ?? null;
}

/** All seats of a player company, capped at maxTotalSeats. */
export function totalSeats(
  parts: { tier: number; expansion: number; headquarters: number; offices: number },
  cfg: OfficesConfig = BALANCE.startups.offices,
): number {
  return Math.min(cfg.maxTotalSeats, parts.tier + parts.expansion + parts.headquarters + parts.offices);
}

/** Rent of the bought office seats per hour (cents). */
export function officeRentCentsPerHour(level: number, cfg: OfficesConfig = BALANCE.startups.offices): number {
  return officeSeats(level, cfg) * cfg.rentCentsPerSeatPerHour;
}

export type OfficeBlock = "max_level" | "seats_max" | "legal_form" | "worth" | "cash" | null;

/**
 * Why the next step cannot be bought right now (null = it can). Order as on the server: all steps bought, seats
 * already at the cap, legal form, company value, free cash.
 */
export function officeBlock(
  input: { level: number; tier: string; worthCents: number; freeCashCents: number; seats: number },
  cfg: OfficesConfig = BALANCE.startups.offices,
): OfficeBlock {
  const step = nextOfficeStep(input.level, cfg);
  if (!step) return "max_level";
  if (input.seats >= cfg.maxTotalSeats) return "seats_max";
  if (!(step.tiers as readonly string[]).includes(input.tier)) return "legal_form";
  if (input.worthCents < step.minWorthCents) return "worth";
  if (input.freeCashCents < step.costCents) return "cash";
  return null;
}
