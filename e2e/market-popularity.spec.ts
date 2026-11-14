import { expect, test, type Page } from "@playwright/test";
import { showOverview, unfoldCompany } from "./company-helpers";

/*
 * The market list (ADR-145): popular stocks first, player companies in the same list, a filter for them only.
 * The IPO (ADR-146): the subscription takes at most an hour (ADR-149), then the company is listed. Demo mode.
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
];

async function preparePlayer(page: Page, player: Record<string, unknown>) {
  await page.addInitScript(
    ({ tours, state }) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({ demo: { status: "done", step: 0, seenTours: tours } }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({ tutorialCompleted: true, curveVersion: 2, ...state }),
      );
    },
    { tours: TOURS, state: player },
  );
}

async function hold(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(async () => {
    const a = await button.boundingBox();
    await page.waitForTimeout(100);
    const b = await button.boundingBox();
    expect(a && b && Math.abs(a.y - b.y) < 1).toBe(true);
  }).toPass();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
}

const rows = (page: Page) => page.locator('[data-tour="stock-row"]');

/** Picks a sort order; retried, because a click before hydration does nothing. */
async function sortBy(page: Page, name: string) {
  const option = page.getByRole("radiogroup", { name: "Sortierung" }).getByRole("radio", { name });
  await expect(async () => {
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true", { timeout: 1_000 });
  }).toPass();
}

test("market list: popular first, player companies only on request", async ({ page }) => {
  await preparePlayer(page, { nickname: "Kursjaeger", cashCents: 1_000_000, xpTotal: 2_000 });
  await page.goto("/markets");
  const sort = page.getByRole("radiogroup", { name: "Sortierung" });
  await expect(sort.getByRole("radio", { name: "Beliebt" })).toHaveAttribute("aria-checked", "true");
  await expect(rows(page).first()).toBeVisible();

  // No player company is listed yet in a fresh demo.
  await sortBy(page, "Spieler");
  await expect(page.getByText("Noch keine Spielerfirma")).toBeVisible();
  await expect(rows(page)).toHaveCount(0);

  // Opening a stock counts as a view: back in the list, the small penny stock stands at the top.
  await sortBy(page, "Beliebt");
  await expect(rows(page).first()).not.toContainText("QuantenSprung Labs");
  await page.goto("/markets/QSL");
  await expect(page.getByRole("heading", { level: 1, name: "QuantenSprung Labs" })).toBeVisible();
  await page.goto("/markets");
  await expect(rows(page).first()).toContainText("QuantenSprung Labs", { timeout: 15_000 });

  // The other sort orders stay.
  await sortBy(page, "A–Z");
  await expect(rows(page).first()).not.toContainText("QuantenSprung Labs");
});

test("going public takes at most an hour, the AI comes in early, then the stock is in the market list", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // The hour may cross midnight: the daily reward of the new day must not cover the page.
  await page.addLocatorHandler(page.getByRole("dialog", { name: "Tägliche Belohnung" }), async (dialog) => {
    await dialog.getByRole("button", { name: "Schließen" }).click();
  });
  await page.clock.install();
  await unfoldCompany(page);
  await preparePlayer(page, { nickname: "Glockenspiel", cashCents: 30_000_000, xpTotal: 80_000 });
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Zehnminuten");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Alles in zehn Minuten.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();
  await showOverview(page);

  const listing = page.getByTestId("listing");
  await listing.getByRole("button", { name: "Börsengang" }).click();
  const ipo = page.getByRole("dialog", { name: "Börsengang" });
  await expect(ipo.getByText(/Bis zu 60 Minuten/)).toBeVisible();
  // Full or money back (ADR-151): the sheet says which part fellow players must take.
  await expect(ipo.getByText("Mitspieler müssen zeichnen")).toBeVisible();
  await expect(ipo.getByText(/bekommen alle ihr Geld zurück/).first()).toBeVisible();
  await ipo.getByRole("button", { name: "Zeichnung starten" }).click();
  await expect(page.getByText("Börsengang gestartet")).toBeVisible();

  // One clear progress: subscribed shares and a countdown of at most an hour (ADR-149).
  const progress = listing.getByTestId("offer-progress");
  await expect(progress).toBeVisible();
  // The money is held back until the company is listed.
  await expect(listing.getByTestId("offer-escrow")).toContainText("Vorher kannst du nichts davon auszahlen");
  await expect(progress.locator("time")).toHaveText(/^(01:00:00|59:[0-5]\d)$/);

  // After ten minutes most AI investors are already in (front-loaded, ADR-149).
  await page.clock.fastForward("10:00");
  await expect(progress.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow", "0", { timeout: 40_000 });
  await expect(listing.getByText(/An der Börse als/)).toHaveCount(0);

  // At the latest after an hour the company is listed.
  await page.clock.fastForward("50:30");
  await expect(listing.getByText(/An der Börse als ZEH/)).toBeVisible({ timeout: 40_000 });

  await page.goto("/markets");
  await sortBy(page, "Spieler");
  // Under the installed clock the other rows do not finish their exit animation; the count says what is listed.
  await expect(page.getByText("1 Aktie", { exact: true })).toBeVisible();
  const row = page.getByRole("link", { name: /Zehnminuten/ });
  await expect(row.getByTestId("player-badge")).toBeVisible();
  await row.click();
  await expect(page).toHaveURL("/markets/ZEH");
});
