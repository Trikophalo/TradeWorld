import { expect, test, type Page } from "@playwright/test";
import { foundListedCompany, hold, prepareRichFounder, showPane, showTab } from "./company-helpers";

/*
 * Firma QA (ADR-183): the flat layout (sections with headers, jump bars, nothing folded), the status line with
 * explanations, the reputation of a private company, "Wo es fehlt" with what to do, "Was jeder leistet" with
 * revenue once hours are closed, deep links into the new places. Demo mode.
 */

async function foundPrivate(page: Page, name: string) {
  await page.goto("/company");
  await page.locator('[data-tier="small_business"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill(name);
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Gute Ware zum fairen Preis.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("private company: flat sections, status line, reputation, diagnosis and staff value", async ({ page }) => {
  test.setTimeout(120_000);
  await prepareRichFounder(page, "Rufpruefer");
  await foundPrivate(page, "Rufwerk");
  // Two quarters of closed hours in the demo.
  const header = page.getByTestId("company-header");
  await header.getByText("Demo: Quartal jetzt abschließen").click();
  await header.getByText("Demo: Quartal jetzt abschließen").click();

  // The status line under the header: state and the four slow values, each explained.
  const status = page.getByTestId("company-status");
  await expect(status).toBeVisible();
  for (const key of ["awareness", "quality", "reputation", "strengths"]) {
    await expect(status.getByTestId(`status-${key}`)).toBeVisible();
  }
  await status.getByTestId("status-reputation").getByTestId("info-tip").click();
  await expect(page.getByText(/Wie Kunden über dich denken/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Dashboard (ADR-187): numbers, charts, strengths and weaknesses; no folding control anywhere on the page.
  const dashboard = page.getByTestId("company-dashboard");
  const nav = dashboard.getByTestId("dashboard-nav");
  for (const id of ["numbers", "charts", "diagnosis"]) {
    await expect(nav.getByTestId(`nav-${id}`)).toBeVisible();
    await expect(dashboard.getByTestId(`firm-section-${id}`)).toBeAttached();
  }
  await expect(page.locator("[data-section][data-state]")).toHaveCount(0);

  // A private company has a reputation now, with its drivers and its effect on the demand.
  await nav.getByTestId("nav-charts").click();
  const reputation = dashboard.getByTestId("company-reputation");
  await expect(reputation).toBeVisible();
  await expect(reputation.getByTestId("reputation-value")).toContainText("/ 100");
  await expect(reputation.getByTestId("reputation-demand")).toContainText("%");
  await expect(reputation.getByTestId("reputation-history")).toBeVisible();

  // "Wo es fehlt": eight factors with what they measure; the weakest says what to do.
  await nav.getByTestId("nav-diagnosis").click();
  const health = dashboard.getByTestId("company-health");
  await expect(health.getByTestId("health-factor")).toHaveCount(8);
  await expect(health.getByTestId("health-score")).toContainText("/ 100");
  await expect(health.getByText(/^Misst/).first()).toBeVisible();
  await expect(health.getByTestId("health-weakest")).toContainText(/Was tun:|Alles im grünen Bereich/);

  // "Was jeder leistet" (Mitarbeiter, team card): with closed hours the founder brings revenue (before: "bringt 0 €").
  await showTab(page, "Mitarbeiter");
  await showPane(page, "group-team", "Wert des Teams");
  const value = page.getByTestId("staff-value");
  const founder = value.locator('[data-kind="founder"]');
  await expect(founder).toBeVisible();
  await expect(founder).not.toContainText("bringt 0 €");
  await noSidewaysScroll(page);

  // Controlling: five merged cards, each pane with one line of what it does (ADR-187).
  await showTab(page, "Controlling");
  const controlling = page.getByTestId("company-controlling");
  for (const id of ["group-offer", "group-marketing", "group-money", "group-growth", "group-brand"]) {
    await expect(controlling.getByTestId(`firm-section-${id}`)).toBeAttached();
  }
  for (const id of ["profit", "marketing", "money", "expansion", "brand"]) {
    await expect(controlling.getByTestId(`section-${id}`)).toBeAttached();
  }
  await showPane(page, "group-marketing", "Geschäftszüge");
  await expect(controlling.getByTestId("company-moves")).toBeAttached();
  await noSidewaysScroll(page);

  // Staff: sections with a jump bar; the chat sits last on phones, next to the team from lg.
  await showTab(page, "Mitarbeiter");
  const staff = page.getByTestId("company-staff");
  await expect(staff.getByTestId("staff-nav")).toBeVisible();
  await expect(staff.getByTestId("firm-section-todo")).toBeVisible();
  await expect(staff.getByTestId("firm-section-group-team")).toBeAttached();
  await noSidewaysScroll(page);

  // Deep links (Mira, notifications) still lead to the place.
  await page.goto("/company?section=health");
  await expect(page.getByTestId("company-health")).toBeInViewport();
  await page.goto("/company?section=staff-value");
  await expect(page.getByTestId("company-staff").getByTestId("staff-value")).toBeInViewport();
  await page.goto("/company?tab=controlling&section=dividends");
  await expect(page.getByTestId("section-money")).toBeVisible();
  await page.goto("/company?section=reputation");
  await expect(page.getByTestId("company-reputation")).toBeInViewport();
});

test("listed company: reputation and mood side by side, books and board with headers", async ({ page }) => {
  test.setTimeout(150_000);
  await prepareRichFounder(page, "Rufaktie");
  await foundListedCompany(page, "Rufbank");
  await showTab(page, "Dashboard");
  const dashboard = page.getByTestId("company-dashboard");
  await expect(dashboard.getByTestId("company-reputation")).toBeVisible();
  await expect(dashboard.getByTestId("dashboard-mood")).toBeVisible();
  await expect(dashboard.getByTestId("stat-reputation")).toContainText("/ 100");
  await showTab(page, "Buchhaltung");
  await expect(page.getByTestId("firm-section-books-due")).toBeVisible();
  await expect(page.getByTestId("firm-section-books-ledger")).toBeAttached();
  await showTab(page, "Geschäftsrat");
  await expect(page.getByTestId("firm-section-board")).toBeVisible();
  await expect(page.getByTestId("company-board")).toBeVisible();
  await noSidewaysScroll(page);
});
