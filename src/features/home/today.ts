/*
 * "Heute dran" (ADR-102): what the player should do now, in the order that matters most. Pure, so the order is
 * tested; the start page only renders it.
 */
export type TodayKey =
  | "daily"
  | "vault"
  | "missions"
  | "companyEvent"
  | "promotion"
  | "workTask"
  | "dealOffers"
  | "newFeature"
  | "findJob"
  | "foundCompany"
  | "skills"
  | "companyCustomers"
  | "companyStaff"
  | "markets";

export interface TodayInput {
  level: number;
  dailyClaimable: boolean;
  /** 0..1 */
  vaultFill: number;
  missionsClaimable: number;
  job: { promotionReady: boolean; workTaskOpen: boolean } | null;
  firstJobLevel: number;
  freeSkillPoints: number;
  /** A feature that is unlocked but not visited yet. */
  newFeature: { key: string; href: string } | null;
  company: { neck: "customers" | "staff" | "balanced" | "waiting"; eventOpen: boolean } | null;
  canFoundCompany: boolean;
  dealOffers: number;
}

export interface TodayTask {
  key: TodayKey;
  tone: "urgent" | "normal";
  /** Where the task is done; null for tasks done right on the card (daily reward, vault). */
  href: string | null;
  count?: number;
  feature?: string;
}

export function todayTasks(i: TodayInput, limit = 4): TodayTask[] {
  const out: TodayTask[] = [];
  const add = (task: TodayTask) => out.push(task);
  if (i.dailyClaimable) add({ key: "daily", tone: "urgent", href: null });
  if (i.vaultFill >= 0.4) add({ key: "vault", tone: i.vaultFill >= 0.9 ? "urgent" : "normal", href: null });
  if (i.missionsClaimable > 0) add({ key: "missions", tone: "urgent", href: "/missions", count: i.missionsClaimable });
  if (i.company?.eventOpen) add({ key: "companyEvent", tone: "urgent", href: "/company" });
  if (i.job?.promotionReady) add({ key: "promotion", tone: "normal", href: "/job" });
  if (i.job?.workTaskOpen) add({ key: "workTask", tone: "normal", href: "/job" });
  if (i.dealOffers > 0) add({ key: "dealOffers", tone: "normal", href: "/deals?tab=mine", count: i.dealOffers });
  if (i.newFeature) add({ key: "newFeature", tone: "normal", href: i.newFeature.href, feature: i.newFeature.key });
  if (!i.job && !i.company && i.level >= i.firstJobLevel) add({ key: "findJob", tone: "normal", href: "/career/jobs" });
  if (!i.company && i.canFoundCompany) add({ key: "foundCompany", tone: "normal", href: "/company" });
  if (i.freeSkillPoints > 0) add({ key: "skills", tone: "normal", href: "/career/skills", count: i.freeSkillPoints });
  if (i.company?.neck === "customers") add({ key: "companyCustomers", tone: "normal", href: "/company" });
  if (i.company?.neck === "staff") add({ key: "companyStaff", tone: "normal", href: "/company" });
  if (out.length === 0) add({ key: "markets", tone: "normal", href: "/markets" });
  return out.slice(0, limit);
}

export type DayPart = "morning" | "day" | "evening" | "night";

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 18) return "day";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

/** Finn's line: about the most urgent task, else one of the day-part lines, the same all day. */
export function finnLineKey(tasks: readonly TodayTask[], part: DayPart, daySeed: number, lines: number): string {
  const first = tasks[0];
  if (first && first.tone === "urgent") return `about.${first.key}`;
  if (first?.key === "markets") return "about.allDone";
  return `${part}.${Math.abs(Math.floor(daySeed)) % Math.max(1, lines)}`;
}

/** Nav features in unlock order (ADR-099) that greet the player once they are open. */
export const NEW_FEATURES: readonly { unlock: string; key: string; href: string }[] = [
  { unlock: "artworks", key: "artworks", href: "/artworks" },
  { unlock: "found_garage", key: "company", href: "/company" },
  { unlock: "deals", key: "deals", href: "/deals" },
  { unlock: "property", key: "property", href: "/property" },
  { unlock: "crypto", key: "crypto", href: "/crypto" },
];
