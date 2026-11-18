import { expect, test, type Page } from "@playwright/test";
import { hold, prepareRichFounder } from "./company-helpers";

/*
 * Weltkarte und Standort (ADR-208) in demo mode: the tab "Standort" sits before Buchhaltung, is locked below 10 Mio. €
 * company value (progress inside the tab), then the headquarters is placed from the country sheet, upgraded and
 * styled in the editor. NEXA_SHOTS=<dir> also saves screenshots (390 px and 1440 px, light and dark).
 */
const SHOTS = process.env.NEXA_SHOTS;

async function setCompanyCash(page: Page, cents: number) {
  await page.evaluate((value) => {
    const raw = window.localStorage.getItem("nexa-demo-player-v2");
    if (!raw) throw new Error("no demo player");
    const state = JSON.parse(raw) as { company?: { cashCents: number } };
    if (!state.company) throw new Error("no demo company");
    state.company.cashCents = value;
    window.localStorage.setItem("nexa-demo-player-v2", JSON.stringify(state));
  }, cents);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((value) => {
    const raw = window.localStorage.getItem("nexa-settings");
    const stored = raw ? (JSON.parse(raw) as { state?: Record<string, unknown> }) : {};
    window.localStorage.setItem(
      "nexa-settings",
      JSON.stringify({ state: { ...(stored.state ?? {}), theme: value }, version: 1 }),
    );
  }, theme);
}

test("Standort: locked, place the headquarters, upgrade and style it", async ({ page }, info) => {
  await prepareRichFounder(page, "Weltenbummler");
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Globus Werke");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Wir liefern in alle Länder.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();

  // The tab sits right before Buchhaltung and is locked with the progress inside.
  const tabs = page.getByTestId("company-tabs");
  const order = await tabs.getByRole("tab").evaluateAll((els) => els.map((el) => el.getAttribute("data-tab")));
  expect(order.indexOf("location")).toBeGreaterThan(order.indexOf("staff"));
  if (order.includes("books")) expect(order.indexOf("location")).toBe(order.indexOf("books") - 1);
  await tabs.getByRole("tab", { name: /Standort/ }).click();
  await expect(page).toHaveURL(/tab=location/);
  await expect(page.getByTestId("world-locked")).toContainText("Weltkarte ab 10 Mio. € Firmenwert");
  await expect(page.getByTestId("world-map")).toBeVisible();
  // Other countries can be looked at before.
  await page.getByTestId("world-chip-cn").click();
  const country = page.getByTestId("country-sheet");
  await expect(country).toContainText("Produktionskosten");
  await expect(country).toContainText("Ab 10 Mio. € Firmenwert kannst du hier bauen.");
  await page.keyboard.press("Escape");

  // Worth 20 Mio. €: the map opens.
  await setCompanyCash(page, 2_000_000_000);
  await page.goto("/company?tab=location");
  await expect(page.getByTestId("world-choose")).toBeVisible();
  await page.getByTestId("world-chip-de").click();
  await expect(country).toHaveAttribute("data-country", "de");
  await country.getByTestId("world-place").click();
  await expect(page.getByText("Zentrale in Deutschland eröffnet")).toBeVisible();
  const hq = page.getByTestId("world-hq");
  await expect(hq).toHaveAttribute("data-tier", "1");
  await expect(page.getByTestId("world-effect-cogs")).toBeVisible();

  // Upgrade to the Bürokomplex.
  await hq.getByTestId("hq-upgrade").click();
  await expect(page.getByText("Bürokomplex eröffnet!")).toBeVisible();
  await expect(hq).toHaveAttribute("data-tier", "2");

  // Style it.
  await hq.getByTestId("hq-edit").click();
  const editor = page.getByTestId("hq-editor");
  await editor.getByTestId("hq-roof").getByRole("button", { name: "Kuppel" }).click();
  await expect(editor.getByTestId("hq-roof").getByRole("button", { name: "Kuppel" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("hq-editor-save").click();
  await expect(page.getByText("Zentrale neu gestaltet")).toBeVisible();

  // No sideways scroll on the phone.
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sideways).toBeLessThanOrEqual(1);

  if (SHOTS) {
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await page.reload();
      await expect(page.getByTestId("world-hq")).toBeVisible();
      await page.getByTestId("world-hq").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/world-hq-${info.project.name}-${theme}.png`, fullPage: false });
      await page.getByTestId("world-map").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/world-map-${info.project.name}-${theme}.png`, fullPage: false });
      await page.getByTestId("world-chip-de").click();
      await expect(page.getByTestId("country-sheet")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/world-country-${info.project.name}-${theme}.png` });
      await page.keyboard.press("Escape");
    }
  }
});
