/*
 * Weltkarte und Standorte (ADR-208): what get_world returns, in client shape.
 */
import type { HQ_STYLE_OPTIONS } from "@/config/countries";

export type HqRoofKind = (typeof HQ_STYLE_OPTIONS.roofs)[number];
export type HqDecoration = (typeof HQ_STYLE_OPTIONS.decorations)[number];

/** Look of the pixel headquarters (editor). Colors are indices into the building palette. */
export interface HqStyle {
  wall: number;
  roof: number;
  sign: number;
  roofKind: HqRoofKind;
  deco: HqDecoration;
  /** Show the flag of the country on the roof. */
  flag: boolean;
}

export type WorldPlaceKind = "hq" | "subsidiary" | "ai";

export interface WorldPlace {
  companyId: string;
  name: string;
  /** Nickname of the founder; null for AI companies. */
  owner: string | null;
  country: string;
  kind: WorldPlaceKind;
  /** 1..5 for a headquarters, 0 for subsidiaries and AI companies. */
  hqTier: number;
  hqStyle: HqStyle;
  worthCents: number | null;
  sector: string;
  brandColor: string | null;
  mine: boolean;
  /** Marktführer of its country (only player headquarters). */
  leader: boolean;
}

export interface WorldSubsidiary {
  country: string;
  openedAt: string;
  setupCostCents: number;
  /** 0..1, ramped up after subsidiaries.rampUpHours. */
  ramp: number;
  hourlyCostCents: number;
}

export interface WorldEffect {
  demandFactor: number;
  cogsFactor: number;
  fixedFactor: number;
  taxRateBps: number | null;
  subsidiaryShare: number;
}

export interface WorldImage {
  bonusBps: number;
  readyAt: string | null;
  spentCents: number;
}

export interface WorldMine {
  country: string;
  hqTier: number;
  hqStyle: HqStyle;
  investedCents: number;
  placedAt: string;
  movedAt: string | null;
  relocateReadyAt: string;
  relocationCostCents: number;
  nextTierCostCents: number | null;
  subsidiaries: WorldSubsidiary[];
  nextSubsidiaryCostCents: number | null;
  subsidiaryUnlocked: boolean;
  image: Record<string, WorldImage>;
  imageCampaignCostCents: number;
  effect: WorldEffect;
  leader: boolean;
  /** The fee the own company asks as market leader. */
  feeBps: number;
  feeReadyAt: string | null;
  /** The fee the own company pays to the leader of its country. */
  payingFee: { feeBps: number; leaderId: string; leaderName: string | null } | null;
  feesPaidCents: number;
  feesReceivedCents: number;
}

export interface WorldCountryState {
  key: string;
  leaderId: string | null;
  feeBps: number;
}

export interface WorldState {
  company: { id: string; name: string; worthCents: number; freeCashCents: number; listed: boolean } | null;
  unlockWorthCents: number;
  me: WorldMine | null;
  places: WorldPlace[];
  countries: WorldCountryState[];
}

export interface WorldEngine {
  /** The world map and the own location (ADR-208). */
  world(): Promise<WorldState>;
  worldPlaceHq(requestId: string, country: string): Promise<WorldState>;
  worldUpgradeHq(requestId: string): Promise<WorldState>;
  worldRelocateHq(requestId: string, country: string): Promise<WorldState>;
  worldSaveHqStyle(requestId: string, style: HqStyle): Promise<WorldState>;
  worldOpenSubsidiary(requestId: string, country: string): Promise<WorldState>;
  worldCloseSubsidiary(requestId: string, country: string): Promise<WorldState>;
  worldImageCampaign(requestId: string, country: string): Promise<WorldState>;
  worldSetLocationFee(requestId: string, feeBps: number): Promise<WorldState>;
}

export const DEFAULT_HQ_STYLE: HqStyle = { wall: 0, roof: 0, sign: 0, roofKind: "flat", deco: "none", flag: true };
