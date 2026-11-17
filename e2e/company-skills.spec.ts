import { expect, test } from "@playwright/test";
import { hold, prepareRichFounder, showOverview, showPane } from "./company-helpers";

/*
 * Fertigkeiten of the own company (ADR-194) in demo mode: the pane in the growth card, a locked level names the
 * missing skill of the map and links there; the skill map shows what a skill opens in the company.
 * NEXA_SHOTS=<dir> also saves screenshots (390 px and 1440 px, light and dark).
 */
const SHOTS = process.env.NEXA_SHOTS;

test("Fertigkeiten: locked by the skill map, linked both ways", async ({ page }, info) => {
  await prepareRichFounder(page, "Datenfuchs");
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Zahlenwerk");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Wir rechnen für alle.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();

  await showOverview(page);
  await showPane(page, "group-growth", "Fertigkeiten");
  const card = page.getByTestId("company-skills");
  await expect(card).toBeVisible();
  const data = card.getByTestId("company-skill-data_analysis");
  await expect(data).toContainText("Daten analysieren");
  await expect(data.getByTestId("company-skill-locked")).toContainText("Datenanalyse");
  await expect(card.getByTestId("company-skill-learn-data_analysis")).toBeDisabled();

  if (SHOTS) {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/company-skills-${info.project.name}-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }

  await data.getByRole("link", { name: /Zum Skilltree/ }).click();
  await expect(page).toHaveURL(/\/career\/skills\?skill=it_data/);
  const unlocks = page.getByTestId("skill-company-unlocks");
  await expect(unlocks).toContainText("Daten analysieren, Stufe 1");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/skill-map-unlocks-${info.project.name}.png` });
});
