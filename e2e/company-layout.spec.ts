import { expect, test } from "@playwright/test";
import { hold, prepareRichFounder, showDashboard } from "./company-helpers";

/*
 * ADR-187: the dashboard shows numbers and charts only; each leads to where the value is influenced, opening the
 * merged card on the right pane. Old section links still land on their place, Mira is a panel on every tab.
 */
test("dashboard tiles lead to the place that moves them", async ({ page }) => {
  await prepareRichFounder(page, "Kachelfan");
  await page.goto("/company");
  await page.locator('[data-tier="small_business"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Kachelwerk");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Kacheln für alle Dashboards.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();
  await showDashboard(page);

  // No action widgets on the dashboard any more.
  const dash = page.getByTestId("company-dashboard");
  await expect(dash.getByTestId("company-autopilot")).toHaveCount(0);
  await expect(dash.getByTestId("mira")).toHaveCount(0);
  await expect(dash.getByTestId("task-board")).toHaveCount(0);

  // Bekanntheit → Controlling, Marketing card on "Budget & Kampagnen".
  const awareness = page.getByTestId("tile-awareness");
  await expect(awareness).toContainText("Beeinflussen in Controlling → Budget & Kampagnen");
  await awareness.click();
  await expect(page.getByTestId("company-tabs").getByRole("tab", { name: /Controlling/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page).toHaveURL(/tab=controlling&section=marketing/);
  await expect(page.getByTestId("section-marketing")).toBeVisible();
  await expect(page.getByTestId("campaign")).toBeVisible();

  // Kasse → Geld, "Kasse & Auszahlung".
  await showDashboard(page);
  await page.getByTestId("tile-cash").click();
  await expect(page.getByTestId("section-money")).toBeVisible();
  await expect(page.getByTestId("treasury")).toBeVisible();

  // Zu erledigen → the to-do center on Mitarbeiter.
  await showDashboard(page);
  await page.getByTestId("tile-todo").click();
  await expect(page.getByTestId("firm-section-todo")).toBeVisible();
  await expect(page.getByTestId("company-todo")).toBeVisible();

  // A chart: the trend leads to prices and strategy.
  await showDashboard(page);
  await page.getByTestId("chart-trend-go").click();
  await expect(page.getByTestId("section-profit")).toBeVisible();

  // An old link opens the merged card on its pane.
  await page.goto("/company?tab=overview&section=moves");
  await expect(page.getByTestId("section-moves")).toBeVisible();
  await expect(page.getByTestId("company-moves")).toBeVisible();
  await page.goto("/company?section=autopilot");
  await expect(page.getByTestId("company-autopilot")).toBeVisible();

  // Mira opens as a panel from any tab.
  await page.getByTestId("mira-open").click();
  await expect(page.getByTestId("mira")).toBeVisible();
});
