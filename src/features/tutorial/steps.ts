import type { TutorialEvent } from "./store";

/**
 * The guided first session. Every step either explains one thing (the player
 * confirms with the button in the speech bubble) or asks for a real action in
 * the interface. There is no way to skip: the rest of the screen is blocked
 * until the highlighted control has been used.
 *
 * Texts live in messages/*.json under "tutorial.steps.<id>".
 */
export interface TutorialStep {
  id:
    | "welcome"
    | "wealth"
    | "vault"
    | "goMarkets"
    | "pickStock"
    | "chart"
    | "buy"
    | "hold"
    | "goPortfolio"
    | "portfolio"
    | "goProfile"
    | "profile"
    | "done";
  /** `data-tour` value of the highlighted element. None: Finn talks in the middle of the screen. */
  target?: string;
  /** Where the step takes place. The player is brought back if they end up elsewhere. */
  path?: RegExp;
  /** Path to navigate to when `path` does not match, or the step to fall back to. */
  recover?: { to: string } | { step: TutorialStep["id"] };
  /** How the step is completed. */
  advance: { on: "next" } | { on: "route"; path: RegExp } | { on: "event"; event: TutorialEvent };
  /** Event that sends the player back to an earlier step (e.g. the order sheet was closed). */
  fallback?: { event: TutorialEvent; step: TutorialStep["id"] };
  /** The element sits in a dialog that already dims the page: draw the ring only. */
  inDialog?: boolean;
  mood?: "happy";
}

const HOME = /^\/$/;
const MARKETS = /^\/markets$/;
const STOCK = /^\/markets\/[A-Za-z]+$/;
const PORTFOLIO = /^\/portfolio$/;
const PROFILE = /^\/profile$/;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: "welcome", path: HOME, recover: { to: "/" }, advance: { on: "next" } },
  { id: "wealth", target: "wealth", path: HOME, recover: { to: "/" }, advance: { on: "next" } },
  {
    id: "vault",
    target: "vault-claim",
    path: HOME,
    recover: { to: "/" },
    advance: { on: "event", event: "vault-claimed" },
  },
  { id: "goMarkets", target: "nav-markets", advance: { on: "route", path: MARKETS } },
  {
    id: "pickStock",
    target: "stock-row",
    path: MARKETS,
    recover: { to: "/markets" },
    advance: { on: "route", path: STOCK },
  },
  { id: "chart", target: "stock-price", path: STOCK, recover: { step: "pickStock" }, advance: { on: "next" } },
  {
    id: "buy",
    target: "buy",
    path: STOCK,
    recover: { step: "pickStock" },
    advance: { on: "event", event: "order-sheet-opened" },
  },
  {
    id: "hold",
    target: "order-confirm",
    path: STOCK,
    recover: { step: "pickStock" },
    advance: { on: "event", event: "order-confirmed" },
    fallback: { event: "order-sheet-closed", step: "buy" },
    inDialog: true,
  },
  { id: "goPortfolio", target: "nav-portfolio", advance: { on: "route", path: PORTFOLIO } },
  {
    id: "portfolio",
    target: "portfolio-summary",
    path: PORTFOLIO,
    recover: { to: "/portfolio" },
    advance: { on: "next" },
  },
  { id: "goProfile", target: "nav-profile", advance: { on: "route", path: PROFILE } },
  { id: "profile", target: "level-card", path: PROFILE, recover: { to: "/profile" }, advance: { on: "next" } },
  { id: "done", path: PROFILE, recover: { to: "/profile" }, advance: { on: "next" }, mood: "happy" },
];

export function stepIndex(id: TutorialStep["id"]): number {
  return TUTORIAL_STEPS.findIndex((step) => step.id === id);
}
