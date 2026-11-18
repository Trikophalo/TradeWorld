import { expect, test, type Page } from "@playwright/test";

/*
 * Missions, rich list, player name and the unlock tour, in demo mode.
 * The demo player is prepared through localStorage, like a returning player.
 */
async function preparePlayer(page: Page, player: Record<string, unknown> = {}) {
  await page.addInitScript((extra) => {
    // Init scripts run on every navigation: prepare only once per test.
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    // The daily reward popup is covered in careers.spec.ts.
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({ demo: { status: "done", step: 0, seenTours: ["first_job"] } }),
    );
    const base = {
      nickname: "Testerin",
      nicknameChangedAt: null,
      cashCents: 1_000_000,
      reservedCents: 0,
      lossPotCents: 0,
      holdings: [],
      orders: [],
      trades: [],
      vaultClaimedAt: Date.now() - 2 * 3_600_000,
      xpTotal: 100,
      tradesToday: 0,
      tradesDay: "",
      tutorialCompleted: true,
      counters: {},
      viewedToday: [],
      missions: [],
      missionSeq: 0,
      // Already checked in today: no daily bonus toast in the way.
      checkInDay: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(Date.now()),
      streakDays: 1,
    };
    window.localStorage.setItem("nexa-demo-player-v2", JSON.stringify({ ...base, ...extra }));
  }, player);
}

test("quick missions count real actions and pay XP when claimed", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/missions");
  await expect(page.getByRole("heading", { level: 1, name: "Missionen" })).toBeVisible();
  await expect(page.getByText("Sieh dir 3 Aktien an")).toBeVisible();

  for (const ticker of ["VLT", "KLS", "BRZ"]) {
    await page.goto(`/markets/${ticker}`);
    // The view counts once the live price is there.
    await expect(page.getByText(/Verkauf .* · Kauf /)).toBeVisible();
    await page.waitForTimeout(300);
  }
  // The missions button in the top bar shows a blue dot once a reward is ready, and leads to the missions.
  await expect(page.getByTestId("missions-dot").filter({ visible: true })).toBeVisible();
  await page.getByTestId("missions-button").filter({ visible: true }).click();
  await expect(page).toHaveURL("/missions");
  const claim = page.getByRole("button", { name: /^\+\d+ XP$/ }).first();
  await expect(claim).toBeVisible();
  await claim.click();
  await expect(page.getByText("Belohnung abgeholt")).toBeVisible();
});

test("the open missions can be re-rolled once per day (ADR-166)", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/missions");
  await expect(page.getByText("Sieh dir 3 Aktien an")).toBeVisible();
  const button = page.getByTestId("missions-reset-button");
  await expect(button).toBeEnabled();
  await expect(page.getByTestId("missions-reset-hint")).toContainText("Einmal am Tag");

  // It asks first: the progress of the open missions is lost.
  await button.click();
  await expect(page.getByText("Missionen neu würfeln?")).toBeVisible();
  await page.getByTestId("missions-reset-confirm").click();
  await expect(page.getByText("Neu gewürfelt").first()).toBeVisible();

  // Other missions now, the story stays, and the button rests until tomorrow.
  await expect(page.getByText("Sieh dir 3 Aktien an")).toHaveCount(0);
  await expect(page.getByText("Dein erster Trade")).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(page.getByTestId("missions-reset-hint")).toContainText("Morgen wieder");
  await page.reload();
  await expect(page.getByTestId("missions-reset-button")).toBeDisabled();
});

test("one open mission can be skipped for free once per day (ADR-202)", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/missions");
  await expect(page.getByText("Sieh dir 3 Aktien an")).toBeVisible();
  await expect(page.getByTestId("missions-skip-hint")).toContainText("einmal am Tag");
  // milestones have no skip; quick, daily and weekly missions do
  await expect(page.getByTestId("mission-skip")).toHaveCount(9);
  await page.getByRole("button", { name: "Sieh dir 3 Aktien an gegen eine andere Mission tauschen" }).click();
  await expect(page.getByText("Mission getauscht").first()).toBeVisible();
  await expect(page.getByText("Sieh dir 3 Aktien an")).toHaveCount(0);
  // the full re-roll stays, the single skip rests until tomorrow
  await expect(page.getByTestId("mission-skip")).toHaveCount(0);
  await expect(page.getByTestId("missions-skip-hint")).toContainText("Wieder in");
  await expect(page.getByTestId("missions-reset-button")).toBeEnabled();
});

test("rankings: Forbes 100 of real players, everyone with the AI tycoons, top companies (ADR-074)", async ({
  page,
}) => {
  await preparePlayer(page);
  await page.goto("/rich-list");
  await expect(page.getByRole("heading", { level: 1, name: "Ranglisten" })).toBeVisible();
  // Forbes 100 first: only real players, so the demo player is number one.
  await expect(page.getByRole("radio", { name: "Forbes 100" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Platz 1").first()).toBeVisible();
  await page.getByRole("radio", { name: "Alle" }).click();
  await expect(page.getByText("Testerin").first()).toBeVisible();
  await expect(page.getByText(/Noch .* bis Platz \d+/).first()).toBeVisible();
  await page.getByRole("radio", { name: "Top-Unternehmen" }).click();
  await expect(page.getByText("Noch hat niemand eine Firma gegründet.")).toBeVisible();
  await page.getByRole("radio", { name: "Mit KI-Firmen" }).click();
  await expect(page.getByTestId("company-ranking").getByText("KlarSoft AG")).toBeVisible();
});

test("the player name is shown and can be changed, forbidden names are refused", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/profile");
  await expect(page.getByText("Testerin").first()).toBeVisible();
  await page.getByRole("button", { name: "Namen ändern" }).click();
  const sheet = page.getByRole("dialog", { name: "Spielername ändern" });
  await sheet.getByLabel("Neuer Name").fill("4dm1n");
  await expect(sheet.getByText("Dieser Name ist reserviert.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Namen speichern" })).toBeDisabled();
  await sheet.getByLabel("Neuer Name").fill("Boersenfuchs_7");
  await expect(sheet.getByText("Dieser Name ist frei.")).toBeVisible();
  await sheet.getByRole("button", { name: "Namen speichern" }).click();
  await expect(page.getByText("Name geändert")).toBeVisible();
  await expect(page.getByText("Boersenfuchs_7").first()).toBeVisible();
  // Locked for 60 days now.
  await page.getByRole("button", { name: "Namen ändern" }).click();
  await expect(page.getByText(/nächste Änderung ist ab dem/)).toBeVisible();
});

test("starting over resets the game after typing the name and Finn starts again (ADR-070)", async ({ page }) => {
  await preparePlayer(page, { cashCents: 5_000_000 });
  await page.goto("/profile");
  const sheet = page.getByRole("dialog", { name: "Spiel zurücksetzen?" });
  // The profile page may still be hydrating: click until the sheet opens.
  await expect(async () => {
    await page.getByRole("button", { name: "Spiel zurücksetzen" }).click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await sheet.getByLabel(/Zum Bestätigen/).fill("Falsch");
  await expect(sheet.getByRole("button", { name: /Gedrückt halten zum Zurücksetzen/ })).toBeDisabled();
  await sheet.getByLabel(/Zum Bestätigen/).fill("testerin");
  const hold = sheet.getByRole("button", { name: /Gedrückt halten zum Zurücksetzen/ });
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
  await expect(page).toHaveURL("/");
  await expect(page.locator("[data-tutorial]")).toContainText("Hi, ich bin Finn");
  await expect(page.locator('[data-fly-target="cash"]')).toContainText("10.000,00 €");
});
