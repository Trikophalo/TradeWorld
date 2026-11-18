import { expect, test } from "@playwright/test";
import { foundListedCompany, prepareRichFounder, showPane, showTab } from "./company-helpers";

/*
 * Research priced from the profit (ADR-215), demo mode: the sheet of a research step tells how many hours of profit
 * it costs and when it is affordable, and offers the slower, cheaper Sparforschung.
 */
const SHOTS = process.env.NEXA_SHOT_DIR;

for (const theme of ["dark", "light"] as const) {
  test(`research shows its price in profit and starts as Sparforschung (${theme})`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.addInitScript((mode) => {
      window.localStorage.setItem("nexa-settings", JSON.stringify({ state: { theme: mode }, version: 1 }));
    }, theme);
    await prepareRichFounder(page, "Forscherin");
    await foundListedCompany(page);
    await showTab(page, "Controlling");
    await showPane(page, "group-growth", "Forschung");
    const tree = page.getByTestId("research-tree");
    await tree.getByTestId("item-r_quality_1").click();
    const sheet = page.getByTestId("item-sheet");
    await expect(sheet).toContainText("Entspricht");
    await expect(sheet).toContainText("Gewinn");
    await expect(sheet.getByTestId("research-affordable")).toHaveText(/jetzt|in etwa|erst mit Gewinn/);
    await expect(sheet.getByTestId("research-price-note")).toContainText("nie der Firmenwert");
    await expect(page.getByTestId("item-buy-slow")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/research-sheet-${info.project.name}-${theme}.png` });
    await page.getByTestId("item-buy-slow").click();
    await expect(page.getByText("Qualitätslabor ist in Arbeit")).toBeVisible();
    await expect(tree.getByTestId("item-r_quality_1")).toHaveAttribute("data-phase", "running");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/research-tree-${info.project.name}-${theme}.png` });
  });
}
