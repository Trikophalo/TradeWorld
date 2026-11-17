import { expect, test, type Page } from "@playwright/test";

/*
 * Titans Revenge and Yin Yang (ADR-182) in demo mode: both packs in the shop, their popup rows (tiers, the iron
 * base, the Yin Yang slot table), a uranium card and a warrior card on /dev/ui, Yin and Yang side by side.
 * Screenshots go to NEXA_SHOTS when it is set.
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
  await page.waitForTimeout(2500);
  await target.screenshot({ path: `${dir}/${name}-${page.viewportSize()?.width}.png` });
};

const noOverflow = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);

test("the Titans Revenge pack is in the shop and its popup shows the tiers", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon?tab=shop");
  const pack = page.getByTestId("buy-titans_revenge");
  await expect(pack).toBeVisible();
  await expect(pack).toContainText("100.000");
  await expect(page.getByTestId("odds-titans")).toContainText("1 von 500");
  await shot(page, "titans-pack", pack);
  await pack.click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", "preview");
  const uranium = page.locator('[data-testid="contents-group"][data-rarity="uranium"]');
  await uranium.scrollIntoViewIfNeeded();
  await expect(uranium.getByTestId("contents-rate")).toContainText("1 in 500 Boostern");
  await expect(
    page.locator('[data-testid="contents-group"][data-rarity="titanium"]').getByTestId("contents-rate"),
  ).toContainText("1 in 5 Boostern");
  await expect(
    page.locator('[data-testid="contents-group"][data-rarity="iron"]').getByTestId("contents-rate"),
  ).toContainText("In jedem Booster");
  await shot(page, "titans-popup", page.getByTestId("set-contents"));
  await noOverflow(page);
});

test("the Yin Yang pack is in the shop and its popup shows the lower chase odds", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon?tab=shop");
  const pack = page.getByTestId("buy-yin_yang");
  await expect(pack).toBeVisible();
  await expect(pack).toContainText("2.000");
  await expect(page.getByTestId("odds-yin-yang")).toContainText("0,1 %");
  await shot(page, "yin-yang-pack", pack);
  await pack.click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", "preview");
  const legendary = page.locator('[data-testid="contents-group"][data-rarity="legendary"]');
  await legendary.scrollIntoViewIfNeeded();
  await expect(legendary.getByTestId("contents-rate")).toContainText("1 in 1.000 Boostern");
  await expect(legendary.locator('[data-card="yy-109"]').first()).toBeVisible();
  await noOverflow(page);
});

test("a uranium card, a warrior card and Yin and Yang render on /dev/ui", async ({ page }) => {
  await page.goto("/dev/ui");
  const uranium = page.getByTestId("showcase-uranium");
  await uranium.scrollIntoViewIfNeeded();
  await expect(uranium.locator('[data-rarity="uranium"]').first()).toBeVisible();
  const warrior = page.getByTestId("showcase-warrior");
  await expect(warrior.locator('[data-kind="warrior"]').first()).toBeVisible();
  await expect(warrior.locator('[data-part="warrior"]').first()).toHaveText(/Krieger/i);
  const pair = page.getByTestId("showcase-yin-yang");
  await expect(pair.locator('[data-card="yy-109"]').first()).toBeVisible();
  await expect(pair.locator('[data-card="yy-110"]').first()).toBeVisible();
  await shot(page, "uranium-card", uranium);
  await shot(page, "warrior-card", warrior);
  await shot(page, "yin-yang-pair", pair);
  const fronts = page.getByTestId("nexamon-fronts");
  for (const key of ["tr-001", "tr-016", "tr-023", "tr-027"])
    await shot(page, `rarity-${key}`, fronts.locator(`[data-card="${key}"]`).first());
  await noOverflow(page);
});
