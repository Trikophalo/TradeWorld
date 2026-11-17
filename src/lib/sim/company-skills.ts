/**
 * Fertigkeiten of player companies (ADR-194): the hour terms of the learned levels, the requirement check and the
 * price of the next level. Mirrored 1:1 in SQL (company_skills_hour_effect, learn_company_skill; migration
 * 20261204008300). Pure: no clock, no randomness.
 *
 *   demand factor   1 + min(cap, Σ perLevel × level) / 10 000       (data analysis, campaigns)
 *   capacity factor 1 + min(cap, Σ …) / 10 000                       (automation, leadership)
 *   goods factor    1 − min(cap, Σ …) / 10 000                       (contracts, supply chain)
 *   fixed factor    1 − min(cap, Σ …) / 10 000                       (cost control)
 *   quality add     min(cap, Σ …) / 10 000 quality points            (craftsmanship, research)
 *
 * A level in training (ready_at after the hour) counts one level lower.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";
import type { CompanySkillConfig, CompanySkillEffect } from "../../config/company-skills.ts";

export type CompanySkillsConfig = BalanceConfig["companySkills"];

export interface CompanySkillHourEffect {
  demandFactor: number;
  capacityFactor: number;
  cogsFactor: number;
  fixedFactor: number;
  qualityAdd: number;
}

export function companySkill(key: string, cfg: CompanySkillsConfig = BALANCE.companySkills) {
  return cfg.skills.find((s) => s.key === key);
}

/** The level that works in an hour: one lower while the last level is still in training. */
export function effectiveLevel(level: number, readyAtMs: number | null, hourStartMs: number): number {
  const l = Math.max(0, Math.floor(level));
  return readyAtMs !== null && readyAtMs > hourStartMs ? Math.max(0, l - 1) : l;
}

/** Summed basis points of every effect kind, each capped. */
export function companySkillBps(
  levels: Readonly<Record<string, number>>,
  cfg: CompanySkillsConfig = BALANCE.companySkills,
): Record<CompanySkillEffect, number> {
  const sum: Record<CompanySkillEffect, number> = { demand: 0, capacity: 0, cogs: 0, fixed: 0, quality: 0 };
  for (const s of cfg.skills) {
    const level = Math.min(cfg.maxLevel, Math.max(0, Math.floor(levels[s.key] ?? 0)));
    sum[s.effect] += s.perLevelBps * level;
  }
  for (const k of Object.keys(sum) as CompanySkillEffect[]) sum[k] = Math.min(sum[k], cfg.capBps[k]);
  return sum;
}

export function companySkillHourEffect(
  levels: Readonly<Record<string, number>>,
  cfg: CompanySkillsConfig = BALANCE.companySkills,
): CompanySkillHourEffect {
  const b = companySkillBps(levels, cfg);
  return {
    demandFactor: 1 + b.demand / 10_000,
    capacityFactor: 1 + b.capacity / 10_000,
    cogsFactor: 1 - b.cogs / 10_000,
    fixedFactor: 1 - b.fixed / 10_000,
    qualityAdd: b.quality / 10_000,
  };
}

/** Effect of one skill at a level in basis points (uncapped; the card shows "now" and "next"). */
export function skillEffectBps(skill: CompanySkillConfig, level: number): number {
  return skill.perLevelBps * Math.max(0, Math.floor(level));
}

/** Cost and training hours of a level (1-based); null above the maximum. */
export function levelPrice(
  level: number,
  cfg: CompanySkillsConfig = BALANCE.companySkills,
): { costCents: number; hours: number } | null {
  if (level < 1 || level > cfg.maxLevel) return null;
  return { costCents: cfg.costCentsByLevel[level - 1] ?? 0, hours: cfg.trainingHoursByLevel[level - 1] ?? 0 };
}

/** The skill of the map a level needs, or null when nothing is missing (`held` = founder or an employee). */
export function missingSkill(skill: CompanySkillConfig, level: number, held: ReadonlySet<string>): string | null {
  const need = skill.requires[level - 1];
  return need && !held.has(need) ? need : null;
}

/** Company Fertigkeiten a skill of the map opens, with the level (for the skill map). */
export function unlockedBy(
  skillKey: string,
  cfg: CompanySkillsConfig = BALANCE.companySkills,
): { key: string; level: number }[] {
  return cfg.skills.flatMap((s) => {
    const i = s.requires.indexOf(skillKey);
    return i >= 0 ? [{ key: s.key, level: i + 1 }] : [];
  });
}
