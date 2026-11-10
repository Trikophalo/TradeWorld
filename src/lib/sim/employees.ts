/**
 * Employees (spec 7): skill to capacity, onboarding, traits, salary.
 */
import { BALANCE } from "../../config/balance.ts";
import type { CompanyConfig, EmployeesConfig } from "../../config/balance.ts";
import type { EmployeeInput } from "./types.ts";
import { roundToBigInt } from "./money.ts";

/** Productivity factor from onboarding: ramps up over the first quarters, then 1. */
export function onboardingFactor(
  quartersEmployed: number,
  ramp: CompanyConfig["onboardingRamp"] = BALANCE.company.onboardingRamp,
): number {
  const index = Math.max(0, Math.floor(quartersEmployed));
  return ramp[index] ?? 1;
}

/**
 * Effective skill points an employee contributes to the department:
 * `skill^1.1 x onboarding x trait performance x 2 (real players)`.
 */
export function effectiveSkillPoints(
  employee: EmployeeInput,
  cfg: EmployeesConfig = BALANCE.employees,
  ramp: CompanyConfig["onboardingRamp"] = BALANCE.company.onboardingRamp,
): number {
  const skill = Math.min(cfg.maxSkill, Math.max(cfg.minSkill, employee.skill));
  const trait = cfg.traits.find((t) => t.key === employee.traitKey);
  const performance = trait ? trait.performanceMultiplier : 1;
  const player = employee.isPlayer ? cfg.playerProductivityMultiplier : 1;
  return (
    Math.pow(skill, cfg.skillCapacityExponent) *
    onboardingFactor(employee.quartersEmployed, ramp) *
    performance *
    player
  );
}

/** Market salary per quarter for a skill level and trait: `base x skill^1.3 x trait`. */
export function marketSalaryCents(
  skill: number,
  traitKey: string | null = null,
  cfg: EmployeesConfig = BALANCE.employees,
): bigint {
  const s = Math.min(cfg.maxSkill, Math.max(cfg.minSkill, skill));
  const trait = cfg.traits.find((t) => t.key === traitKey);
  const multiplier = trait ? trait.salaryMultiplier : 1;
  return roundToBigInt(cfg.salaryBaseCentsPerQuarter * Math.pow(s, cfg.salarySkillExponent) * multiplier);
}
