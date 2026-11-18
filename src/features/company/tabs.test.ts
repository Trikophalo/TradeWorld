import { describe, expect, it } from "vitest";
import {
  COMPANY_GROUPS,
  COMPANY_TABS,
  sectionAvailable,
  companyHref,
  groupOf,
  isCompanyTab,
  KNOWN_SECTIONS,
  notificationHref,
  placeOf,
  resolveCompanyTarget,
  type CompanyTarget,
} from "./tabs";

/** Every section id a link could carry before ADR-187 (ADR-167, ADR-176, ADR-183, Mira, notifications, e2e). */
const OLD_SECTIONS = [
  // dashboard (ADR-183)
  "mira",
  "health",
  "details",
  "diagnosis",
  "autopilot",
  "staff-value",
  "strengths",
  "todo",
  "situation",
  "history",
  "numbers",
  "quarter",
  "reputation",
  "mood",
  "timers",
  "assist",
  "reputation-mood",
  "team-value",
  // controlling
  "profit",
  "strategy",
  "business",
  "marketing",
  "campaign",
  "boss",
  "company-controls",
  "moves",
  "expansion",
  "money",
  "capital",
  "brand",
  "research",
  "growth",
  "dividends",
  "close",
  "group-sell",
  "group-run",
  "group-money",
  "group-listed",
  "group-brand",
  // staff
  "team",
  "staff",
  "satisfaction",
  "benefits",
  "training",
  "tasks",
  "chat",
  "applications",
  "staff-mood",
  "staff-team",
  "staff-tasks",
  "staff-chat",
  // books and board
  "books",
  "books-duty",
  "books-due",
  "books-ledger",
  "taxes",
  "accounting",
  "advisor",
  "board",
];

/** Where the merged cards put a section on the page: a known card, or a pane of a card, on the same tab. */
function landsOnPage(target: CompanyTarget) {
  if (!target.section) return true;
  const group = groupOf(target.section);
  return group !== null && COMPANY_GROUPS[group].tab === target.tab;
}

describe("company tabs", () => {
  it("starts on the dashboard", () => {
    expect(resolveCompanyTarget(null, null)).toEqual({ tab: "dashboard" });
    expect(resolveCompanyTarget("nonsense")).toEqual({ tab: "dashboard" });
    expect(isCompanyTab("books")).toBe(true);
    expect(isCompanyTab("mira")).toBe(false);
  });

  it("maps the old tabs", () => {
    expect(resolveCompanyTarget("mira")).toEqual({ tab: "dashboard", target: "mira" });
    expect(resolveCompanyTarget("overview").tab).toBe("controlling");
    expect(resolveCompanyTarget("tasks")).toEqual({ tab: "staff", section: "staff-tasks", target: "tasks" });
    expect(resolveCompanyTarget("team")).toEqual({ tab: "staff", section: "staff-team" });
    expect(resolveCompanyTarget("chat")).toEqual({ tab: "staff", target: "chat" });
  });

  it("maps the old overview sections to the merged cards", () => {
    expect(resolveCompanyTarget("overview", "money")).toEqual({ tab: "controlling", section: "money" });
    expect(resolveCompanyTarget("overview", "moves")).toEqual({ tab: "controlling", section: "moves" });
    expect(resolveCompanyTarget("overview", "boss")).toEqual({
      tab: "controlling",
      section: "marketing",
      target: "company-controls",
    });
    expect(resolveCompanyTarget("team", "training")).toEqual({
      tab: "staff",
      section: "staff-team",
      target: "training",
    });
    // The action widgets left the dashboard (ADR-187).
    expect(resolveCompanyTarget("overview", "situation")).toEqual({ tab: "staff", section: "situation" });
    expect(resolveCompanyTarget(null, "autopilot")).toEqual({ tab: "staff", section: "todo", target: "autopilot" });
    expect(resolveCompanyTarget(null, "todo")).toEqual({ tab: "staff", section: "todo" });
    expect(resolveCompanyTarget(null, "staff-value").tab).toBe("staff");
    expect(resolveCompanyTarget(null, "strengths")).toEqual({
      tab: "dashboard",
      section: "diagnosis",
      target: "health",
    });
  });

  it("sends Mira's listed sections to the new tabs", () => {
    expect(resolveCompanyTarget("overview", "books")).toEqual({ tab: "books", target: "books-duty" });
    expect(resolveCompanyTarget("overview", "taxes")).toEqual({ tab: "books", target: "taxes" });
    expect(resolveCompanyTarget("overview", "staff")).toEqual({
      tab: "staff",
      section: "staff-mood",
      target: "satisfaction",
    });
    expect(resolveCompanyTarget("overview", "board")).toEqual({ tab: "board" });
    expect(resolveCompanyTarget("overview", "research")).toEqual({ tab: "controlling", section: "research" });
    expect(resolveCompanyTarget("overview", "dividends")).toEqual({ tab: "controlling", section: "dividends" });
  });

  it("keeps an unknown section as scroll target of a known tab", () => {
    expect(resolveCompanyTarget("staff", "somewhere")).toEqual({ tab: "staff", target: "somewhere" });
  });

  it("resolves every old section id to a place that exists on its tab", () => {
    for (const id of OLD_SECTIONS) {
      expect(KNOWN_SECTIONS, id).toContain(id);
      const target = resolveCompanyTarget(null, id);
      expect(landsOnPage(target), `${id} → ${JSON.stringify(target)}`).toBe(true);
    }
    for (const id of KNOWN_SECTIONS) {
      expect(landsOnPage(resolveCompanyTarget(null, id)), id).toBe(true);
    }
  });

  it("builds links that resolve to the same place, for every known section", () => {
    expect(companyHref({ tab: "dashboard" })).toBe("/company");
    expect(companyHref({ tab: "books", target: "taxes" })).toBe("/company?tab=books&section=taxes");
    expect(companyHref({ tab: "controlling", section: "research" })).toBe("/company?tab=controlling&section=research");
    expect(companyHref(resolveCompanyTarget(null, "brand"))).toBe("/company?tab=controlling&section=brand");
    const pairs: [string | null, string | null][] = [
      ["overview", "boss"],
      ["overview", "books"],
      ["tasks", null],
      ["chat", null],
      ["overview", "situation"],
      ...KNOWN_SECTIONS.map((s) => [null, s] as [null, string]),
    ];
    for (const [tab, section] of pairs) {
      const params = new URL(companyHref(resolveCompanyTarget(tab, section)), "https://x").searchParams;
      expect(resolveCompanyTarget(params.get("tab"), params.get("section")), `${tab}/${section}`).toEqual(
        resolveCompanyTarget(tab, section),
      );
    }
  });

  it("knows the merged card and pane of a place", () => {
    expect(groupOf("profit")).toBe("group-offer");
    expect(groupOf("moves")).toBe("group-marketing");
    expect(groupOf("dividends")).toBe("group-money");
    expect(groupOf("research")).toBe("group-growth");
    expect(groupOf("staff-mood")).toBe("group-team");
    expect(groupOf("group-brand")).toBe("group-brand");
    expect(groupOf("nowhere")).toBeNull();
    expect(placeOf({ tab: "controlling", section: "marketing" })).toEqual({
      tab: "controlling",
      group: "group-marketing",
      pane: "marketing",
    });
    expect(placeOf({ tab: "staff", section: "todo" })).toEqual({ tab: "staff", group: "todo", pane: null });
  });

  it("puts the Standort tab right before Buchhaltung (ADR-208)", () => {
    expect(COMPANY_TABS.indexOf("location")).toBe(COMPANY_TABS.indexOf("books") - 1);
    expect(resolveCompanyTarget("location")).toEqual({ tab: "location" });
    expect(resolveCompanyTarget("world")).toEqual({ tab: "location" });
    expect(resolveCompanyTarget(null, "lobby")).toEqual({ tab: "location", target: "world-lobby" });
    expect(resolveCompanyTarget(null, "location")).toEqual({ tab: "location", section: "location" });
    expect(companyHref({ tab: "location" })).toBe("/company?tab=location");
    expect(notificationHref("world_location", "/company")).toBe("/company?tab=location&section=world-lobby");
    expect(sectionAvailable("location", { listed: false, trainingOpen: false })).toBe(true);
  });

  it("adds the tab to notifications that link to the bare company page", () => {
    expect(notificationHref("tax_office", "/company")).toBe("/company?tab=books&section=taxes");
    expect(notificationHref("team_mood", "/company")).toBe("/company?tab=staff&section=satisfaction");
    expect(notificationHref("company_project", "/company")).toBe("/company?tab=controlling&section=research");
    expect(notificationHref("company_dividend", "/company")).toBe("/company?tab=controlling&section=dividends");
    expect(notificationHref("board", "/company")).toBe("/company?tab=board");
    expect(notificationHref("board", "/company?board=abc")).toBe("/company?board=abc");
    expect(notificationHref("team_mood", "/career")).toBe("/career");
    expect(notificationHref("friend_request", "/company")).toBe("/company");
    expect(notificationHref("tax_office", null)).toBeNull();
  });
});
