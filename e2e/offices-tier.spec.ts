import { expect, test, type Page } from "@playwright/test";
import { foundListedCompany, prepareRichFounder, showDashboard, showOverview, showPane } from "./company-helpers";

/*
 * Büroflächen and stock tiers (ADR-218), demo mode: a listed company sees its seats up to 1.000 with the next office
 * step in "Wachstum & Ausbau", and its stock's tier with the way to the next class on the dashboard.
 */
const SHOTS = process.env.NEXA_SHOT_DIR;

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript((mode) => {
    window.localStorage.setItem("nexa-settings", JSON.stringify({ state: { theme: mode }, version: 1 }));
  }, theme);
}

for (const theme of ["dark", "light"] as const) {
  test(`offices up to 1.000 seats and the stock tier (${theme})`, async ({ page }, info) => {
    test.skip(theme === "light" && !SHOTS, "the light run only takes screenshots");
    test.setTimeout(120_000);
    const shot = async (name: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${info.project.name}.png` });
    };
    await prepareRichFounder(page, "Flaechenwart");
    await setTheme(page, theme);
    await foundListedCompany(page, "Turmbau");

    await showOverview(page);
    await showPane(page, "group-growth", "Wachstum & Ausbau");
    const offices = page.getByTestId("offices");
    await expect(offices).toBeVisible();
    await expect(offices.getByTestId("offices-seats")).toContainText("von 1.000 Plätzen");
    await expect(offices.getByText("Rechtsform")).toBeVisible();
    await expect(offices.getByRole("button", { name: /Fläche 1 kaufen/ })).toBeVisible();
    await offices.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot("offices");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    await showDashboard(page);
    const tier = page.getByTestId("stock-tier");
    await expect(tier).toBeVisible();
    await expect(tier.getByTestId("stock-tier-badge")).toHaveText("Pennystock");
    await expect(tier.getByText(/Small Cap ab/)).toBeVisible();
    await tier.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot("stock-tier");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
}
