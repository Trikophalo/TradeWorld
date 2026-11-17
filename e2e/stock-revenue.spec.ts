import { expect, test } from "@playwright/test";

/*
 * Business figures at the stock exchange (ADR-184): every stock in the market list carries its current revenue in one
 * line, the detail page a "Geschäftszahlen" card. Demo mode: AI companies show their latest quarter.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({ demo: { status: "done", step: 0, seenTours: ["first_job", "limit_orders", "bonds"] } }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({ tutorialCompleted: true, curveVersion: 2, nickname: "Bilanzleser", xpTotal: 2_000 }),
    );
  });
});

test("the market list shows the revenue of every company in one line", async ({ page }) => {
  await page.goto("/markets");
  const line = page.locator('[data-tour="stock-row"]').first().getByTestId("stock-figures-line");
  await expect(line).toContainText(/Umsatz Quartal \d/);
  await expect(line.locator("[data-trend]")).toHaveCount(1);
  // no horizontal scrolling on a phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the stock detail page shows the business figures", async ({ page }) => {
  await page.goto("/markets/VLT");
  const card = page.getByTestId("stock-figures");
  await expect(card).toContainText("Geschäftszahlen");
  await expect(card.getByTestId("stock-figures-revenue")).toContainText(/Umsatz Quartal\s*\d/);
  await expect(card).toContainText("Gewinn Quartal");
  await expect(card.getByTestId("stock-figures-history")).toBeVisible();
});
