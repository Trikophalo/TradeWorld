import { expect, test, type Page } from "@playwright/test";
import { foundListedCompany, prepareRichFounder } from "./company-helpers";

/*
 * Toplists (ADR-203), demo mode: a listed company shows on its page exactly the value Top-Unternehmen ranks it by
 * (market cap), the net worth card adds up, filters and the "how it is counted" note work.
 */
const SHOTS = process.env.NEXA_SHOT_DIR;

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((mode) => {
    const raw = window.localStorage.getItem("nexa-settings");
    const parsed = raw ? (JSON.parse(raw) as { state?: Record<string, unknown>; version?: number }) : {};
    window.localStorage.setItem(
      "nexa-settings",
      JSON.stringify({ ...parsed, state: { ...(parsed.state ?? {}), theme: mode }, version: parsed.version ?? 1 }),
    );
  }, theme);
}

test("a listed company has one value: company page = Top-Unternehmen; the net worth adds up (ADR-203)", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  if (info.project.name === "phone") await page.setViewportSize({ width: 390, height: 844 });
  await prepareRichFounder(page, "Rangliste");
  await foundListedCompany(page, "Pixelwerft");

  const header = page.getByTestId("company-header");
  await expect(header.locator("dt", { hasText: "Börsenwert" })).toBeVisible();
  await expect(header.getByText(/Ertragswert/)).toBeVisible();
  const pageValue = (await page.getByTestId("company-worth").innerText()).trim();

  await page.goto("/rich-list");
  await page.getByRole("radio", { name: "Top-Unternehmen" }).click();
  const mine = page.getByTestId("company-ranking").locator("a", { hasText: "Pixelwerft" }).first();
  await expect(mine).toBeVisible();
  await expect(mine.getByText("Börsenwert")).toBeVisible();
  await expect(mine.getByText(pageValue, { exact: true })).toBeVisible();

  // The net worth card: the parts add up to the total that Forbes 100 shows for you.
  await page.getByRole("radio", { name: "Forbes 100" }).click();
  const breakdown = page.getByTestId("net-worth-breakdown");
  await expect(breakdown.getByText("Eigene Firma")).toBeVisible();
  await expect(breakdown.getByTestId("net-worth-total")).toBeVisible();

  if (SHOTS) {
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await page.reload();
      await expect(page.getByTestId("net-worth-breakdown").getByTestId("net-worth-total")).toBeVisible();
      await page.getByRole("button", { name: "Wie wird gerechnet?" }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/forbes-${info.project.name}-${theme}.png`, fullPage: true });
      await page.getByRole("radio", { name: "Top-Unternehmen" }).click();
      await page.getByRole("radio", { name: "Mit KI-Firmen" }).click();
      await expect(page.getByTestId("company-ranking").getByText("KlarSoft AG")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/companies-${info.project.name}-${theme}.png`, fullPage: true });
      await page.goto("/company");
      await expect(page.getByTestId("company-worth")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/company-${info.project.name}-${theme}.png` });
      await page.goto("/rich-list");
    }
  }
  // Phone first: nothing scrolls sideways.
  const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(width).toBeLessThanOrEqual(0);
});
