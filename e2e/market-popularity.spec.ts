import { expect, test, type Page } from "@playwright/test";
import { showOverview, unfoldCompany } from "./company-helpers";

/*
 * The market list (ADR-145): popular stocks first, player companies in the same list, a filter for them only.
 * The IPO (ADR-146): the subscription takes at most 10 minutes, then the company is listed. Demo mode.
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

test("going public takes at most 10 minutes, then the stock is in the market list", async ({ page }) => {
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
  await expect(ipo.getByText(/Bis zu 10 Minuten/)).toBeVisible();
  await ipo.getByRole("button", { name: "Zeichnung starten" }).click();
  await expect(page.getByText("Börsengang gestartet")).toBeVisible();

  // One clear progress: subscribed shares and a countdown of at most 10 minutes.
  const progress = listing.getByTestId("offer-progress");
  await expect(progress).toBeVisible();
  await expect(progress.locator("time")).toHaveText(/^(10:00|09:[0-5]\d)$/);

  // Half way: the AI investors have subscribed part of it.
  await page.clock.fastForward("05:00");
  await expect(progress.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow", "0", { timeout: 40_000 });
  await expect(listing.getByText(/An der Börse als/)).toHaveCount(0);

  // After 10 minutes the company is listed.
  await page.clock.fastForward("05:30");
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
