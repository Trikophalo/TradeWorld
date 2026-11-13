import { expect, test } from "@playwright/test";

/*
 * Stock news with a lead (ADR-119) in demo mode: a hint on the markets page names a stock and a direction and leads
 * to that stock.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem("nexa-tutorial", JSON.stringify({ demo: { status: "done", step: 0, seenTours: [] } }));
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Leserin",
        cashCents: 1_000_000,
        xpTotal: 0,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
});

test("stock news: an open hint on the markets page leads to the stock", async ({ page }) => {
  await page.goto("/markets");
  const card = page.getByTestId("stock-news");
  await expect(card).toContainText("Etwa 75 % treffen ein.");
  const hint = card.locator('[data-status="open"]').first();
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(/Steigt wohl|Fällt wohl/);
  await expect(hint).toContainText(/in etwa \d+ Minuten|jeden Moment/);
  const ticker = await hint.getAttribute("data-ticker");
  await hint.click();
  await expect(page).toHaveURL(new RegExp(`/markets/${ticker}$`));
});
