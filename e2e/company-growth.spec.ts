import { expect, test, type Page } from "@playwright/test";

/*
 * Profit levers, endless growth and friends in demo mode (ADR-083, ADR-084).
 */
const TOURS = [
  "first_job",
  "limit_orders",
  "bonds",
  "found_garage",
  "visit_skill_map",
  "visit_company",
  "visit_listing",
  "artworks",
  "visit_artworks",
  "property",
  "visit_property",
];

async function preparePlayer(page: Page, nickname: string, xpTotal: number, cashCents: number) {
  await page.addInitScript(
    ({ nickname, xpTotal, cashCents, tours }) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({ demo: { status: "done", step: 0, seenTours: tours } }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({ nickname, cashCents, xpTotal, tutorialCompleted: true, curveVersion: 2 }),
      );
    },
    { nickname, xpTotal, cashCents, tours: TOURS },
  );
}

async function hold(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
}

async function found(page: Page, tier: string, name: string) {
  await page.goto("/company");
  await page.locator(`[data-tier="${tier}"]`).getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill(name);
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Ein Produkt, das jeder braucht.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();
}

test("profit coach, price strategy, contract work, IPO from the garage, staff open profiles", async ({ page }) => {
  await preparePlayer(page, "Kassenwart", 7_000, 2_000_000);
  await found(page, "garage", "Rechenhaus");

  // Before the first hour the coach waits; a demo quarter runs the hours.
  const coach = page.getByTestId("profit-coach");
  await expect(coach.getByText("Die erste Stunde läuft")).toBeVisible();
  await page.getByTestId("company-header").getByText("Demo: Quartal jetzt abschließen").click();
  await expect(coach.getByTestId("hour-flow")).toBeVisible();
  await expect(coach.getByTestId("hour-flow")).toContainText("Auftragsarbeit");
  await expect(coach.locator("[data-tip]").first()).toBeVisible();

  // Strategy: contract work is on by default; switching to budget prices is saved.
  const strategy = page.getByTestId("strategy");
  await expect(strategy.getByRole("switch", { name: "Auftragsarbeit" })).toBeChecked();
  await strategy.getByRole("radio", { name: "Günstig" }).click();
  await expect(page.getByText("Strategie gespeichert").first()).toBeVisible();
  await expect(strategy.getByRole("radio", { name: "Günstig" })).toHaveAttribute("aria-checked", "true");
  await strategy.getByRole("switch", { name: "Auftragsarbeit" }).click();
  await expect(strategy.getByRole("switch", { name: "Auftragsarbeit" })).not.toBeChecked();

  // A garage cannot expand yet; going public is open from level 6 (ADR-083).
  await expect(page.getByTestId("expansion-locked")).toBeVisible();
  await expect(page.getByTestId("listing").getByRole("button", { name: "Börsengang" })).toBeVisible();

  // Staff in the office open their profile (ADR-084).
  await page.getByTestId("office-person").first().click();
  await expect(page).toHaveURL(/\/players\/Kassenwart$/);
  await expect(page.getByTestId("business-card").or(page.locator("#main")).first()).toContainText("Kassenwart");
  // No friend button on one's own profile.
  await expect(page.getByTestId("friend-button")).toHaveCount(0);
});

test("found a GmbH directly and expand it, step after step", async ({ page }) => {
  await preparePlayer(page, "Grossdenker", 80_000, 30_000_000);
  await page.goto("/company");
  await expect(page.locator('[data-tier="gmbh"]')).toContainText("Markt × 15");
  await found(page, "gmbh", "Weitblick");
  await expect(page.getByTestId("company-header").getByText("GmbH")).toBeVisible();

  // The first expansion costs 100.000 €, from the company's cash: 60.000 € are in, the rest is missing.
  const expansion = page.getByTestId("expansion");
  await expect(expansion.getByText("Stufe 0")).toBeVisible();
  await expect(expansion.getByText(/fehlen noch 40\.000/)).toBeVisible();
  await page
    .getByTestId("treasury")
    .locator("..")
    .getByRole("button", { name: /Einzahlen/ })
    .click();
  const deposit = page.getByRole("dialog", { name: "Einzahlen" });
  await deposit.getByLabel(/Betrag/).fill("100000");
  await deposit.getByRole("button", { name: /100\.000 € einzahlen/ }).click();
  await expect(page.getByText(/eingezahlt/i).first()).toBeVisible();

  await hold(page, /Auf Stufe 1 ausbauen/);
  await expect(page.getByText("Ausgebaut! Mehr Markt, mehr Platz.")).toBeVisible();
  await expect(expansion.getByText("Stufe 1")).toBeVisible();
  // The next step costs more (× 1,8) and the office has more places.
  await expect(expansion.getByRole("button", { name: /Auf Stufe 2 ausbauen · 180\.000/ })).toBeVisible();
  await expect(page.getByText("0 von 30 Plätzen belegt")).toBeVisible();
});

test("friends page: empty list, add by name, helpful errors", async ({ page }) => {
  await preparePlayer(page, "Freundlich", 7_000, 2_000_000);
  await page.goto("/friends");
  await expect(page.getByRole("heading", { level: 1, name: "Freunde" })).toBeVisible();
  await expect(page.getByText("Noch keine Freunde")).toBeVisible();

  const name = page.getByLabel("Spielername");
  await expect(page.getByRole("button", { name: "Anfrage schicken" })).toBeDisabled();
  await name.fill("freundlich");
  await page.getByRole("button", { name: "Anfrage schicken" }).click();
  await expect(page.getByText("Das bist du selbst.", { exact: false })).toBeVisible();
  await name.fill("Niemand123");
  await page.getByRole("button", { name: "Anfrage schicken" }).click();
  await expect(page.getByText(/nicht gefunden|gibt es nicht/i).first()).toBeVisible();

  // The own profile links to the friends page.
  await page.goto("/profile");
  await page
    .getByRole("link", { name: /Freunde/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/friends$/);
});
