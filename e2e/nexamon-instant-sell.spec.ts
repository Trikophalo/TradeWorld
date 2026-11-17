import { expect, test, type Page } from "@playwright/test";

/*
 * Instant sell (ADR-196) in demo mode: after a pack opening the summary offers every fresh pull to the game for 90 %,
 * all at once (hold) or card by card, without overflow on a phone. Screenshots go to NEXA_SHOTS when set.
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

const shot = async (page: Page, name: string) => {
  const dir = process.env.NEXA_SHOTS;
  if (!dir) return;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width}.png` });
};

for (const width of [390, 1440]) {
  test(`the pack summary sells fresh pulls to the game for 90 % at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await preparePlayer(page);
    await page.goto("/nexamon?tab=shop");
    await page.getByTestId("buy-mystic_energy").click();
    await page.getByTestId("confirm-buy").click();
    await page.getByTestId("pack-skip").click();
    const panel = page.getByTestId("instant-sell");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("90 %");
    await expect(panel.getByTestId("instant-all")).toContainText("an das Spiel verkaufen");
    // inside the viewport on a phone: no horizontal overflow
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await panel.scrollIntoViewIfNeeded();
    await shot(page, "instant-sell-summary");

    // one card alone
    await panel.getByTestId("instant-toggle").click();
    await expect(panel.getByTestId("instant-row")).toHaveCount(5);
    await panel.getByTestId("instant-one").first().click();
    await expect(panel.getByTestId("instant-paid")).toBeVisible();
    await expect(panel.getByTestId("instant-row").first()).toContainText("Verkauft");

    // the rest at once: hold to confirm
    const hold = panel.getByTestId("instant-all").getByRole("button");
    await hold.focus();
    await page.keyboard.down("Enter");
    await page.waitForTimeout(2_000);
    await page.keyboard.up("Enter");
    await expect(panel.getByTestId("instant-done")).toBeVisible();
    await shot(page, "instant-sell-done");
  });
}
