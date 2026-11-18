/**
 * Marketing campaigns (ADR-097): a one-off push that raises a player company's demand for some hours and leaves a
 * little awareness behind. It pays off only when the company has free capacity: a sold-out company cannot sell the
 * extra demand. The effect is rolled once at the start (luck) and grows with the product quality.
 */
import { BALANCE } from "../../config/balance.ts";
import type { BalanceConfig, CampaignKind } from "../../config/balance.ts";

export type CampaignResonance = "weak" | "solid" | "strong";

export interface Campaign {
  readonly kind: CampaignKind;
  readonly startedAt: number;
  readonly endsAt: number;
  /** Demand factor while the campaign runs, e.g. 1.3. */
  readonly demandFactor: number;
}

/** Price: costHours × the demand of the last hour (in cents at the normal price), at least minCostCents, whole euros. */
export function campaignCostCents(
  kind: CampaignKind,
  demandPerHourCents: number,
  cfg: BalanceConfig = BALANCE,
): number {
  const c = cfg.startups.campaigns;
  const raw = Math.max(c.minCostCents, c.kinds[kind].costHours * Math.max(0, demandPerHourCents));
  return Math.round(raw / 100) * 100;
}

/**
 * ADR-212: the highest price of a campaign kind for a company, or null when it pays the normal price. Only the flyer
 * is capped, and only while the company is small (legal form in flyerCapTiers or value below flyerCapBelowValueCents).
 */
export function campaignCapCents(
  kind: CampaignKind,
  tier: string,
  companyValueCents: number,
  cfg: BalanceConfig = BALANCE,
): number | null {
  const c = cfg.startups.campaigns;
  if (kind !== "flyer") return null;
  const small = (c.flyerCapTiers as readonly string[]).includes(tier) || companyValueCents < c.flyerCapBelowValueCents;
  return small ? c.flyerCapCents : null;
}

/** Price of a campaign for a company: campaignCostCents, at most the cap of a small company (ADR-212). */
export function companyCampaignCostCents(
  kind: CampaignKind,
  demandPerHourCents: number,
  tier: string,
  companyValueCents: number,
  cfg: BalanceConfig = BALANCE,
): number {
  const price = campaignCostCents(kind, demandPerHourCents, cfg);
  const cap = campaignCapCents(kind, tier, companyValueCents, cfg);
  return cap === null ? price : Math.min(price, cap);
}

/** Luck of a campaign from a uniform draw u ∈ [0, 1). */
export function campaignLuck(u: number, cfg: BalanceConfig = BALANCE): number {
  const c = cfg.startups.campaigns;
  return c.luckMin + (c.luckMax - c.luckMin) * Math.min(1, Math.max(0, u));
}

/** Demand factor of a campaign: 1 + demandBps × luck × (1 − w + w × quality). */
export function campaignFactor(
  kind: CampaignKind,
  quality: number,
  luck: number,
  cfg: BalanceConfig = BALANCE,
): number {
  const c = cfg.startups.campaigns;
  const q = Math.min(1, Math.max(0, quality));
  return 1 + (c.kinds[kind].demandBps / 10_000) * luck * (1 - c.qualityWeight + c.qualityWeight * q);
}

export function campaignResonance(luck: number, cfg: BalanceConfig = BALANCE): CampaignResonance {
  const c = cfg.startups.campaigns;
  if (luck < c.weakBelow) return "weak";
  return luck >= c.strongFrom ? "strong" : "solid";
}

/** Demand factor at a time: the campaign's factor while it runs, else 1. */
export function campaignDemandFactor(campaign: Campaign | null | undefined, at: number): number {
  if (!campaign || at < campaign.startedAt || at >= campaign.endsAt) return 1;
  return campaign.demandFactor;
}

/**
 * Expected extra profit per hour of a campaign with average luck, from the last hour: extra demand only sells where
 * capacity is free, and every extra sale earns the gross margin at the company's price.
 */
export function campaignGainPerHourCents(
  kind: CampaignKind,
  input: { demandCents: number; capacityCents: number; quality: number; price: number; grossMargin: number },
  cfg: BalanceConfig = BALANCE,
): number {
  const factor = campaignFactor(kind, input.quality, 1, cfg);
  const soldBefore = Math.min(input.demandCents, input.capacityCents);
  const soldAfter = Math.min(input.demandCents * factor, input.capacityCents);
  const extra = Math.max(0, soldAfter - soldBefore);
  return Math.round(extra * (input.price - (1 - input.grossMargin)));
}
