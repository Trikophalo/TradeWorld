/**
 * Talente (ADR-199): offer checks, poaching, satisfaction per hour, the capped hour terms of the filled Stellen and
 * the decisions of a Mit-Geschäftsführer. Mirrored 1:1 in SQL (migrations 20261204008900/8910: talent_offer_cost,
 * talent_check_offer, talent_satisfaction_step, talents_hour_effect, talent_coceo_pick). Pure: no clock, no randomness.
 *
 *   hourly cost      wage + Σ wage × benefitCostBps / 10 000          (wages are whole euros: exact in cents)
 *   offer accepted   every demand met (wage, benefits, reputation, awareness, legal form, cash cover)
 *   poach accepted   offer cost ≥ current cost × (10 000 + margin + Σ loyalty) / 10 000
 *   effect           Σ effectBps of the filled Stellen per kind, capped (capBps)
 *   satisfaction     + gain when all is met, − losses per unmet demand × decay of the traits, + morale (HR)
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig } from "../../config/balance.ts";
import type { TalentBenefit, TalentEffect, TalentSeed, TalentTraitConfig } from "../../config/talents.ts";

export type TalentsConfig = BalanceConfig["talents"];

export function talentTrait(key: string, cfg: TalentsConfig = BALANCE.talents): TalentTraitConfig | undefined {
  return cfg.traits.find((t) => t.key === key);
}

export function talentRole(key: string, cfg: TalentsConfig = BALANCE.talents) {
  return cfg.roles.find((r) => r.key === key);
}

/** Hourly cost of a contract: wage plus the benefits as a share of the wage. */
export function talentOfferCost(
  wageCents: number,
  benefits: readonly string[],
  cfg: TalentsConfig = BALANCE.talents,
): number {
  let cost = wageCents;
  for (const b of new Set(benefits)) cost += (wageCents * (cfg.benefitCostBps[b as TalentBenefit] ?? 0)) / 10_000;
  return Math.round(cost);
}

export interface CompanyFacts {
  reputation: number;
  awarenessBps: number;
  /** 0 garage .. 4 listed. */
  formRank: number;
  expansionLevel: number;
  freeCashCents: number;
}

export type OfferCheckKey = "wage" | "benefits" | "reputation" | "awareness" | "form" | "office" | "cash";

export interface OfferCheck {
  key: OfferCheckKey;
  ok: boolean;
}

/** What the talent checks before saying yes; the UI shows the same list live ("erfüllt / nicht erfüllt"). */
export function talentOfferChecks(
  talent: Pick<TalentSeed, "wageCents" | "minReputation" | "minAwarenessBps" | "minForm"> & {
    benefits: readonly string[];
  },
  offer: { wageCents: number; benefits: readonly string[] },
  company: CompanyFacts,
  cfg: TalentsConfig = BALANCE.talents,
): OfferCheck[] {
  const cost = talentOfferCost(offer.wageCents, offer.benefits, cfg);
  return [
    { key: "wage", ok: offer.wageCents >= talent.wageCents },
    { key: "benefits", ok: talent.benefits.every((b) => offer.benefits.includes(b)) },
    { key: "reputation", ok: company.reputation >= talent.minReputation },
    { key: "awareness", ok: company.awarenessBps >= talent.minAwarenessBps },
    { key: "form", ok: company.formRank >= talent.minForm },
    { key: "office", ok: !offer.benefits.includes("office") || company.expansionLevel >= 1 },
    { key: "cash", ok: company.freeCashCents >= cost * cfg.cashCoverHours },
  ];
}

export function talentOfferAccepted(checks: readonly OfferCheck[]): boolean {
  return checks.every((c) => c.ok);
}

/** Minimum hourly cost a poacher must offer: current cost × (1 + margin + loyalty of both traits). */
export function talentPoachMinCost(
  currentCostCents: number,
  traits: readonly string[],
  cfg: TalentsConfig = BALANCE.talents,
): number {
  const loyalty = traits.reduce((s, t) => s + (talentTrait(t, cfg)?.loyaltyBps ?? 0), 0);
  return Math.ceil((currentCostCents * Math.max(0, 10_000 + cfg.poach.marginBps + loyalty)) / 10_000);
}

export interface SatisfactionFacts {
  paid: boolean;
  reputationOk: boolean;
  awarenessOk: boolean;
  benefitsOk: boolean;
  /** Morale bonus of the HR Stelle (bps per hour). */
  moraleBps: number;
}

/** One hour of satisfaction (0..10 000). */
export function talentSatisfactionStep(
  satisfactionBps: number,
  facts: SatisfactionFacts,
  traits: readonly string[],
  cfg: TalentsConfig = BALANCE.talents,
): number {
  const s = cfg.satisfaction;
  const decay = traits.reduce((p, t) => (p * (talentTrait(t, cfg)?.decayPct ?? 100)) / 100, 1);
  let loss = 0;
  if (!facts.paid) loss += s.unpaidBps;
  if (!facts.reputationOk) loss += s.reputationBps;
  if (!facts.awarenessOk) loss += s.awarenessBps;
  if (!facts.benefitsOk) loss += s.benefitBps;
  const delta = loss > 0 ? -Math.round(loss * decay) : s.gainBps;
  return Math.max(0, Math.min(10_000, satisfactionBps + delta + Math.max(0, facts.moraleBps)));
}

export type TalentMood = "happy" | "ok" | "warning" | "quit";

export function talentMood(satisfactionBps: number, cfg: TalentsConfig = BALANCE.talents): TalentMood {
  if (satisfactionBps <= cfg.satisfaction.quitBps) return "quit";
  if (satisfactionBps < cfg.satisfaction.warnBps) return "warning";
  return satisfactionBps >= 7_000 ? "happy" : "ok";
}

export type TalentEffectBps = Record<TalentEffect, number>;

/** Summed, capped effect of the filled Stellen. */
export function talentsEffectBps(
  filled: readonly { role: string; effectBps: number }[],
  cfg: TalentsConfig = BALANCE.talents,
): TalentEffectBps {
  const sum = Object.fromEntries(Object.keys(cfg.capBps).map((k) => [k, 0])) as TalentEffectBps;
  for (const f of filled) {
    const role = talentRole(f.role, cfg);
    if (role) sum[role.effect] += f.effectBps;
  }
  for (const k of Object.keys(sum) as TalentEffect[]) sum[k] = Math.min(sum[k], cfg.capBps[k]);
  return sum;
}

/** The factors of the hourly close (same names as the SQL json). */
export function talentsHourFactors(bps: TalentEffectBps) {
  return {
    demandFactor: 1 + bps.demand / 10_000,
    capacityFactor: 1 + bps.capacity / 10_000,
    cogsFactor: 1 - bps.cogs / 10_000,
    fixedFactor: 1 - bps.fixed / 10_000,
    qualityAdd: bps.quality / 10_000,
  };
}

/** May this talent become Mit-Geschäftsführer? Senior or better; with the trait "leader" one tier earlier. */
export function talentCoCeoEligible(
  talent: { tier: number; traits: readonly string[] },
  cfg: TalentsConfig = BALANCE.talents,
): boolean {
  const leader = talent.traits.some((t) => talentTrait(t, cfg)?.leader);
  return talent.tier >= cfg.coCeo.minTier - (leader ? 1 : 0);
}

export type CoCeoStyle = "cautious" | "bold" | "balanced";

export function talentStyle(traits: readonly string[], cfg: TalentsConfig = BALANCE.talents): CoCeoStyle {
  for (const t of traits) {
    const style = talentTrait(t, cfg)?.style;
    if (style) return style;
  }
  return "balanced";
}

/**
 * The response a Mit-Geschäftsführer picks for a company event: cautious takes the highest mitigation (the most
 * thorough), bold the fewest steps (the quickest), balanced the best mitigation per step. Ties: first in the list.
 */
export function talentCoCeoPick(
  strategies: readonly { key: string; mitigation: number; steps: number }[],
  style: CoCeoStyle,
): string | null {
  let best: { key: string; score: number } | null = null;
  for (const s of strategies) {
    const score =
      style === "cautious"
        ? s.mitigation
        : style === "bold"
          ? -s.steps * 10 + s.mitigation
          : s.mitigation / (1 + s.steps);
    if (!best || score > best.score) best = { key: s.key, score };
  }
  return best?.key ?? null;
}

/** What a Mit-GF may spend now: the remaining day budget, cautious ones only a share of it. */
export function talentCoCeoSpendLimit(
  budgetCents: number,
  spentTodayCents: number,
  style: CoCeoStyle,
  cfg: TalentsConfig = BALANCE.talents,
): number {
  const left = Math.max(0, budgetCents - spentTodayCents);
  return style === "cautious" ? Math.floor((left * cfg.coCeo.cautiousSpendBps) / 10_000) : left;
}
