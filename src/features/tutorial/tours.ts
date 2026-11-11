import { MARKETS, STOCK, type TutorialStep } from "./steps";

/**
 * Short Finn tours when a level-up unlocks something important (ADR-046).
 * Keyed by the unlock key in BALANCE.progression.unlocks; each runs once per
 * player, right after the level-up overlay. Texts: "tutorial.tours.<key>.<id>".
 * Tours for later features (short selling, founding, leverage, IPO) are added
 * together with those features.
 */
export const TOURS: Readonly<Record<string, readonly TutorialStep[]>> = {
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
