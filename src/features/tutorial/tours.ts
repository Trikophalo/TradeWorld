import { unlocksUpToLevel } from "@/lib/sim/progression";
import { MARKETS, STOCK, type TutorialStep } from "./steps";

/**
 * Short Finn tours when a level-up unlocks something important (ADR-046).
 * Keyed by the unlock key in BALANCE.progression.unlocks; each runs once per
 * player, right after the level-up overlay. Texts: "tutorial.tours.<key>.<id>".
 * Tours for later features (short selling, founding, leverage, IPO) are added
 * together with those features.
 */
const CAREER = /^\/career$/;
const JOB = /^\/job$/;

export const TOURS: Readonly<Record<string, readonly TutorialStep[]>> = {
  first_job: [
    { id: "intro", advance: { on: "next" } },
    { id: "goJob", target: "nav-job", advance: { on: "route", path: JOB } },
    { id: "job", path: JOB, recover: { to: "/job" }, advance: { on: "next" } },
    { id: "goCareer", target: "nav-career", advance: { on: "route", path: CAREER } },
    { id: "skills", path: CAREER, recover: { to: "/career" }, advance: { on: "next" }, mood: "happy" },
  ],
  found_garage: [
    { id: "intro", advance: { on: "next" } },
    { id: "where", target: "nav-career", advance: { on: "next" }, mood: "happy" },
  ],
  // Short tours on the first visit of a new area (ADR-068), started by useVisitTour.
  visit_skill_map: [{ id: "map", target: "skill-map", advance: { on: "next" }, mood: "happy" }],
  visit_company: [
    { id: "dashboard", advance: { on: "next" } },
    { id: "growth", target: "growth", advance: { on: "next" }, mood: "happy" },
  ],
  visit_listing: [{ id: "listing", target: "listing", advance: { on: "next" }, mood: "happy" }],
  limit_orders: [
    { id: "intro", advance: { on: "next" } },
    { id: "goMarkets", target: "nav-markets", advance: { on: "route", path: MARKETS } },
    {
      id: "pickStock",
      target: "stock-row",
      path: MARKETS,
      recover: { to: "/markets" },
      advance: { on: "route", path: STOCK },
    },
    {
      id: "buy",
      target: "buy",
      path: STOCK,
      recover: { step: "pickStock" },
      advance: { on: "event", event: "order-sheet-opened" },
    },
    {
      id: "chooseLimit",
      target: "order-type",
      path: STOCK,
      recover: { step: "pickStock" },
      advance: { on: "event", event: "limit-selected" },
      fallback: { event: "order-sheet-closed", step: "buy" },
      inDialog: true,
    },
    {
      id: "limitPrice",
      target: "order-limit-price",
      path: STOCK,
      recover: { step: "pickStock" },
      advance: { on: "next" },
      inDialog: true,
      mood: "happy",
    },
  ],
  bonds: [
    { id: "intro", advance: { on: "next" } },
    { id: "goMarkets", target: "nav-markets", advance: { on: "route", path: MARKETS } },
    {
      id: "bondsTab",
      target: "asset-tabs",
      path: MARKETS,
      recover: { to: "/markets" },
      advance: { on: "event", event: "bonds-tab-opened" },
    },
    {
      id: "bondList",
      target: "bond-list",
      path: MARKETS,
      recover: { to: "/markets" },
      advance: { on: "next" },
      mood: "happy",
    },
  ],
};

export type TourKey = keyof typeof TOURS;

/** The next unlock tour that is due at this level and not seen yet (they run one after another). */
export function nextUnlockTour(level: number, seen: readonly string[]): string | null {
  return unlocksUpToLevel(level).find((u) => TOURS[u.key] && !seen.includes(u.key))?.key ?? null;
}
