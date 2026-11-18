import { expect, test, type Page } from "@playwright/test";
import { hold, prepareRichFounder, showStaff } from "./company-helpers";

/*
 * Talente (ADR-199) in demo mode: the 15 Stellen, the talent market of one Stelle, an offer with live checks, the
 * hire, the filled seat. NEXA_SHOTS=<dir> also saves screenshots (390 px and 1440 px, theme setting light and dark).
 */
const SHOTS = process.env.NEXA_SHOTS;

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((mode) => {
    window.localStorage.setItem("nexa-settings", JSON.stringify({ state: { theme: mode }, version: 1 }));
  }, theme);
}

test("Talente: find a talent for an empty Stelle, offer, hire", async ({ page }, info) => {
  if (info.project.name === "phone") await page.setViewportSize({ width: 390, height: 844 });
  await prepareRichFounder(page, "Talentscout");
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const found = page.getByRole("dialog", { name: "Firma gründen" });
  await found.getByLabel("Firmenname").fill("Kopfwerk");
  await found.getByLabel("Deine Idee in einem Satz").fill("Wir finden die Besten.");
  await expect(found.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();

  await showStaff(page);
  const card = page.getByTestId("company-talents");
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByTestId("talent-seats").locator('[data-filled="false"]')).toHaveCount(15);

  await card.getByTestId("talent-find-sales").click();
  const market = card.getByTestId("talent-market");
  await expect(market).toBeVisible();
  await market.getByRole("button", { name: "Junior", exact: true }).click();
  await market.getByRole("radio", { name: "Verfügbar" }).click();
  await market.getByRole("radio", { name: "Preis" }).click();
  const first = market.locator('[data-status="available"]').first();
  await expect(first).toBeVisible();
  const name = (await first.locator("span.truncate").first().textContent())?.trim() ?? "";
  await first.click();

  const sheet = page.getByTestId("talent-sheet");
  await expect(sheet).toContainText("Persönlichkeit");
  await expect(sheet).toContainText("Forderungen");
  await sheet.getByTestId("talent-make-offer").click();

  const offer = page.getByTestId("talent-offer-sheet");
  const checks = offer.getByTestId("talent-offer-checks");
  await expect(checks.locator('[data-ok="false"]')).toHaveCount(0);
  // a wage below the demand is flagged live
  const wage = offer.getByTestId("talent-offer-wage");
  const demand = await wage.inputValue();
  await wage.fill("1");
  await expect(checks.locator('[data-ok="false"]').first()).toBeVisible();
  await expect(offer.getByTestId("talent-offer-send")).toBeDisabled();
  await wage.fill(demand);
  await expect(checks.locator('[data-ok="false"]')).toHaveCount(0);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/talents-offer-${info.project.name}.png` });
  await offer.getByTestId("talent-offer-send").click();
  await expect(page.getByText(`${name} fängt bei dir an!`)).toBeVisible();

  await card.getByRole("radio", { name: "Stellen" }).click();
  const seat = card.getByTestId("talent-seat-sales");
  await expect(seat).toHaveAttribute("data-filled", "true");
  await expect(seat).toContainText(name);
  await expect(card.getByTestId("talents-total")).toContainText("1 von 15 Stellen besetzt");

  // a new contract (Nachtrag ADR-199): at least the demand, one euro more is fine
  await seat.click();
  const own = page.getByTestId("talent-sheet");
  await own.getByTestId("talent-raise").click();
  const raise = page.getByTestId("talent-offer-sheet");
  const raiseWage = raise.getByTestId("talent-offer-wage");
  const current = Number(await raiseWage.inputValue());
  await raiseWage.fill(String(current - 1));
  await expect(raise.getByTestId("talent-offer-send")).toBeDisabled();
  await raiseWage.fill(String(current + 1));
  await expect(raise.getByTestId("talent-offer-checks").locator('[data-ok="false"]')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/talents-raise-${info.project.name}.png` });
  await raise.getByTestId("talent-offer-send").click();
  await expect(page.getByText(`Neuer Vertrag mit ${name}.`)).toBeVisible();

  // the talent leads its Stelle: in the org chart above the AI workers
  const org = page.getByTestId("org-chart");
  await org.scrollIntoViewIfNeeded();
  await expect(org.locator('[data-level="talents"]').getByTestId("org-talent")).toContainText(name);

  if (SHOTS) {
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await page.reload();
      await showStaff(page);
      const c = page.getByTestId("company-talents");
      await c.scrollIntoViewIfNeeded();
      await expect(c.getByTestId("talent-seat-sales")).toHaveAttribute("data-filled", "true");
      await c.screenshot({ path: `${SHOTS}/talents-seats-${info.project.name}-${theme}.png` });
      await c.getByRole("radio", { name: "Talentmarkt" }).click();
      await expect(c.getByTestId("talent-market").locator("[data-status]").first()).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/talents-market-${info.project.name}-${theme}.png` });
      const o = page.getByTestId("org-chart");
      await o.scrollIntoViewIfNeeded();
      await expect(o.getByTestId("org-talent")).toHaveCount(1);
      await o.screenshot({ path: `${SHOTS}/talents-org-${info.project.name}-${theme}.png` });
    }
  }
});
