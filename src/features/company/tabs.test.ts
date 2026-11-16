import { describe, expect, it } from "vitest";
import { companyHref, isCompanyTab, notificationHref, resolveCompanyTarget } from "./tabs";

describe("company tabs", () => {
  it("starts on the dashboard", () => {
    expect(resolveCompanyTarget(null, null)).toEqual({ tab: "dashboard" });
    expect(resolveCompanyTarget("nonsense")).toEqual({ tab: "dashboard" });
    expect(isCompanyTab("books")).toBe(true);
    expect(isCompanyTab("mira")).toBe(false);
  });

  it("maps the old tabs", () => {
    expect(resolveCompanyTarget("mira").tab).toBe("dashboard");
    expect(resolveCompanyTarget("overview").tab).toBe("controlling");
    expect(resolveCompanyTarget("tasks")).toEqual({ tab: "staff", target: "tasks" });
    expect(resolveCompanyTarget("team")).toEqual({ tab: "staff" });
    expect(resolveCompanyTarget("chat")).toEqual({ tab: "staff", target: "chat" });
  });

  it("maps the old overview sections", () => {
    expect(resolveCompanyTarget("overview", "situation")).toEqual({ tab: "dashboard", section: "situation" });
    expect(resolveCompanyTarget("overview", "money")).toEqual({ tab: "controlling", section: "money" });
    expect(resolveCompanyTarget("overview", "moves")).toEqual({ tab: "controlling", section: "moves" });
    expect(resolveCompanyTarget("overview", "boss")).toEqual({
      tab: "controlling",
      section: "marketing",
      target: "company-controls",
    });
    expect(resolveCompanyTarget("team", "training")).toEqual({ tab: "staff", target: "training" });
  });

  it("sends Mira's listed sections to the new tabs", () => {
    expect(resolveCompanyTarget("overview", "books")).toEqual({ tab: "books", target: "books-duty" });
    expect(resolveCompanyTarget("overview", "taxes")).toEqual({ tab: "books", target: "taxes" });
    expect(resolveCompanyTarget("overview", "staff")).toEqual({ tab: "staff", target: "satisfaction" });
    expect(resolveCompanyTarget("overview", "board")).toEqual({ tab: "board" });
    expect(resolveCompanyTarget("overview", "research")).toEqual({ tab: "controlling", section: "research" });
    expect(resolveCompanyTarget("overview", "dividends")).toEqual({ tab: "controlling", section: "dividends" });
  });

  it("keeps an unknown section as scroll target of a known tab", () => {
    expect(resolveCompanyTarget("staff", "somewhere")).toEqual({ tab: "staff", target: "somewhere" });
  });

  it("builds links that resolve to the same place", () => {
    expect(companyHref({ tab: "dashboard" })).toBe("/company");
    expect(companyHref({ tab: "books", target: "taxes" })).toBe("/company?tab=books&section=taxes");
    expect(companyHref({ tab: "controlling", section: "research" })).toBe("/company?tab=controlling&section=research");
    for (const [tab, section] of [
      ["overview", "boss"],
      ["overview", "books"],
      ["tasks", null],
      ["chat", null],
      ["overview", "situation"],
    ] as const) {
      const params = new URL(companyHref(resolveCompanyTarget(tab, section)), "https://x").searchParams;
      expect(resolveCompanyTarget(params.get("tab"), params.get("section"))).toEqual(
        resolveCompanyTarget(tab, section),
      );
    }
  });

  it("adds the tab to notifications that link to the bare company page", () => {
    expect(notificationHref("tax_office", "/company")).toBe("/company?tab=books&section=taxes");
    expect(notificationHref("team_mood", "/company")).toBe("/company?tab=staff&section=satisfaction");
    expect(notificationHref("company_project", "/company")).toBe("/company?tab=controlling&section=research");
    expect(notificationHref("board", "/company?board=abc")).toBe("/company?board=abc");
    expect(notificationHref("team_mood", "/career")).toBe("/career");
    expect(notificationHref("friend_request", "/company")).toBe("/company");
    expect(notificationHref("tax_office", null)).toBeNull();
  });
});
