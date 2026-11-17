import { expect, test, type Page } from "@playwright/test";

/*
 * Cosmic Winds (ADR-174) in demo mode: the pack in the shop, the popup with the One of One row, the event card and
 * the One of One on /dev/ui, the bulk mode of the collection. Screenshots go to test-results when NEXA_SHOTS is set.
 */
async function preparePlayer(page: Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({ demo: { status: "done", step: 0, seenTours: ["visit_nexamon"] } }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Sammlerin",
        cashCents: 50_000_000,
        xpTotal: 90_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
}

const shot = async (page: Page, name: string, target = page.locator("body")) => {
  const dir = process.env.NEXA_SHOTS;
  if (!dir) return;
  await target.scrollIntoViewIfNeeded();
  // the pixel canvases paint after they come into view
  await page.waitForTimeout(800);
  await target.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width}.png` });
};

test("the Cosmic Winds pack is in the shop and its popup shows the One of One row", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon?tab=shop");
  const pack = page.getByTestId("buy-cosmic_winds");
  await expect(pack).toBeVisible();
  await expect(pack).toContainText("5.000");
  await expect(page.getByTestId("odds-one-of-one")).toContainText("1 in 5.000 Packs, jede Karte nur einmal");
  await shot(page, "cosmic-pack", pack);
  await pack.click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", "preview");
  const row = page.locator('[data-testid="contents-group"][data-rarity="one_of_one"]');
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByTestId("contents-rate")).toContainText("1 in 5.000 Packs, jede Karte nur einmal");
  await expect(row.getByTestId("one-of-one-status")).toHaveCount(3);
  await expect(row.getByTestId("one-of-one-status").first()).toContainText("noch nicht gezogen");
  await shot(page, "cosmic-popup", row);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("an event card and a One of One render on /dev/ui", async ({ page }) => {
  await page.goto("/dev/ui");
  const event = page.getByTestId("showcase-event");
  await event.scrollIntoViewIfNeeded();
  await expect(event.locator('[data-kind="event"]').first()).toBeVisible();
  await expect(event.locator('[data-part="event"]').first()).toHaveText(/Ereignis/i);
  const one = page.getByTestId("showcase-one-of-one");
  await expect(one.locator('[data-rarity="one_of_one"]').first()).toBeVisible();
  await shot(page, "event-card", event);
  await shot(page, "one-of-one-card", one);
});

test("the bulk mode of the collection sums value, fee and payout", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon?tab=shop");
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("buy-mystic_energy").click();
    await page.getByTestId("confirm-buy").click();
    await page.keyboard.press("Escape");
  }
  await page.goto("/nexamon?tab=collection");
  await page.getByText("Bulk verkaufen", { exact: true }).click();
  await expect(page.getByTestId("bulk-sell")).toBeVisible();
  await page.getByTestId("bulk-keepOne").getByRole("switch").click();
  await page.getByTestId("bulk-all").click();
  await expect(page.getByTestId("bulk-payout")).not.toHaveText("0,00 €");
  await page.getByTestId("bulk-sell-game").click();
  await expect(page.getByTestId("bulk-list")).toHaveCount(0);
});
