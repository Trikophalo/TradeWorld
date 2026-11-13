import { expect, test, type Page } from "@playwright/test";

/*
 * Player companies in demo mode (ADR-057): found a garage startup, close quarters,
 * hire an AI worker, post a job. Level 6 player with 20.000 NX.
 */
async function preparePlayer(page: Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({
        demo: {
          status: "done",
          step: 0,
          seenTours: [
            "first_job",
            "limit_orders",
            "bonds",
            "found_garage",
            "visit_skill_map",
            "visit_company",
            "visit_listing",
            "artworks",
            "visit_artworks",
          ],
        },
      }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Gruenderin",
        cashCents: 2_000_000,
        xpTotal: 7_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
}

async function hold(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
  // Into the middle of the screen: at the lower edge the tab bar would cover it on phones.
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // Settle first: page content rises in (ADR-108), a press during that would miss.
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

test("found a garage startup, run quarters, hire and post a job", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/company");
  // The small business needs level 10.
  await expect(page.locator('[data-tier="small_business"]').getByRole("button", { name: "Gründen" })).toBeDisabled();
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();

  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("4dm1n");
  await expect(sheet.getByText(/nicht erlaubt|reserviert|vergeben/)).toBeVisible();
  await sheet.getByLabel("Firmenname").fill("Pixelbaecker");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Frische Brötchen per App bestellen.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();

  const header = page.getByTestId("company-header");
  await expect(header.getByText("Pixelbaecker")).toBeVisible();
  await expect(page.getByText("Das erste Quartal läuft noch.")).toBeVisible();

  // The office shows the founder; banner and till (ADR-078).
  await expect(page.getByTestId("office")).toContainText("Gruenderin");
  await page.getByTestId("banner-edit").click();
  const bannerSheet = page.getByRole("dialog", { name: "Firmen-Banner" });
  await expect(bannerSheet).toBeVisible();
  await bannerSheet.getByRole("button", { name: "Banner speichern" }).click();
  await expect(page.getByText("Banner gespeichert")).toBeVisible();
  await page
    .getByTestId("treasury")
    .locator("..")
    .getByRole("button", { name: /Einzahlen/ })
    .click();
  const deposit = page.getByRole("dialog", { name: "Einzahlen" });
  await deposit.getByLabel(/Betrag/).fill("1000");
  await expect(deposit.getByTestId("money-flow")).toContainText("→");
  await deposit.getByRole("button", { name: /1\.000 NX einzahlen/ }).click();
  await expect(
    page
      .getByText("Eingezahlt")
      .or(page.getByText(/eingezahlt/i))
      .first(),
  ).toBeVisible();

  // Growth stages (ADR-062): the product needs specialists, the next step is named.
  const growth = page.getByTestId("growth");
  await expect(growth.getByText("Stufe 1")).toBeVisible();
  await expect(growth.getByText(/Als Nächstes brauchst du: Netzwerke/)).toBeVisible();

  // Close two quarters (demo button): a report appears.
  await header.getByText("Demo: Quartal jetzt abschließen").click();
  await header.getByText("Demo: Quartal jetzt abschließen").click();
  await expect(page.getByText(/Letztes Quartal · Q2/i)).toBeVisible();

  // Post a job from the team tab (ADR-071: seats, applications, postings, training in one place).
  await page.getByRole("tab", { name: "Team" }).click();
  await page.getByRole("button", { name: "Stelle ausschreiben", exact: true }).click();
  const posting = page.getByRole("dialog", { name: "Stelle ausschreiben" });
  await posting.getByLabel("Titel der Stelle").fill("Backstube digital");
  await posting.getByRole("button", { name: "Ausschreiben" }).click();
  await expect(page.getByText("Stelle ausgeschrieben")).toBeVisible();
  await expect(page.locator("#main").getByText("Backstube digital")).toBeVisible();
  // Trainings unlock only with five people in the team.
  await expect(page.getByTestId("training-locked")).toContainText("0 von 5 im Team");

  // Fill the open growth seat with an AI worker (ADR-071): the seat then shows the AI, not "fehlt".
  await page.getByRole("tab", { name: "Übersicht" }).click();
  const growthPath = page.getByTestId("growth");
  await growthPath.getByRole("button", { name: /Netzwerke/ }).click();
  const hire = page.getByRole("dialog", { name: "Stelle ausschreiben" });
  await hire.getByRole("radio", { name: "KI-Kraft" }).click();
  await expect(hire.getByText("120 NX pro Stunde", { exact: true })).toBeVisible();
  await expect(hire.getByRole("radio", { name: "Netzwerke" })).toHaveAttribute("aria-checked", "true");
  await hire.getByRole("button", { name: "KI-Kraft einstellen" }).click();
  await expect(page.getByText("KI-Kraft eingestellt")).toBeVisible();
  await expect(growthPath.getByTestId("seat-ai")).toContainText("Netzwerke");
  await expect(growthPath.getByText("Stufe 1 von 4")).toBeVisible();
  await expect(page.getByTestId("ai-workers")).toHaveText("1");
  await expect(page.getByText("1 von 2 Plätzen belegt")).toBeVisible();

  // In the team the AI worker sits in its own seat and can be let go.
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByTestId("ai-seat")).toContainText("für Netzwerke");
  await page.getByTestId("ai-seat").getByRole("button", { name: "Entlassen" }).click();
  await expect(page.getByText("KI-Kraft entlassen")).toBeVisible();
  await expect(page.getByTestId("ai-seat")).toHaveCount(0);

  // The company has its own tab now (ADR-075); the career tab no longer offers it.
  await page.goto("/career");
  await expect(page.getByRole("heading", { level: 1, name: "Karriere" })).toBeVisible();
  await expect(page.locator("#main").getByRole("link", { name: /Firma/ })).toHaveCount(0);
  // The own business card names the founder of the company (ADR-075).
  await expect(page.getByTestId("card-founder")).toContainText("Gründer:in von Pixelbaecker");
});

test("company chat, then close the company voluntarily", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Chatbude");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Ein Laden, in dem alle reden.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();

  // The quarter close writes a system message into the chat.
  await page.getByTestId("company-header").getByText("Demo: Quartal jetzt abschließen").click();
  await page.getByText("Chat", { exact: true }).click();
  const messages = page.getByTestId("chat-messages");
  await expect(messages.getByText(/Quartal .*: Umsatz/)).toBeVisible();
  await page.getByPlaceholder("Nachricht an dein Team").fill("Hallo Team!");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(messages.getByText("Hallo Team!")).toBeVisible();

  // Close: the cash comes back, the founding page shows the settlement.
  await page.getByText("Übersicht", { exact: true }).click();
  await page.getByText("Lohnfaktor und Auflösen").click();
  await page.getByRole("button", { name: "Firma auflösen" }).click();
  await expect(page.getByRole("dialog", { name: "Firma auflösen" })).toBeVisible();
  await page.waitForTimeout(500); // the panel slides in
  await hold(page, /Gedrückt halten zum Auflösen/);
  await expect(page.getByText("Firma aufgelöst")).toBeVisible();
  await expect(page.getByTestId("dissolution")).toContainText("Du hast Chatbude aufgelöst.");
});

test("draw a logo, keep a job as founder, go public", async ({ page }) => {
  // Level 12 (IPO), 300.000 NX to found, upgrade and run the company.
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({
        demo: {
          status: "done",
          step: 0,
          seenTours: [
            "first_job",
            "limit_orders",
            "bonds",
            "found_garage",
            "visit_skill_map",
            "visit_company",
            "visit_listing",
            "artworks",
            "visit_artworks",
          ],
        },
      }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Boersenstar",
        cashCents: 30_000_000,
        xpTotal: 80_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
  await page.goto("/company");
  await page.locator('[data-tier="small_business"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Pixelwerft");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Logos für alle Firmen der Welt.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();

  // Pixel editor (ADR-076): offered right after founding, drawn once, forbidden symbols are blocked.
  await page.getByTestId("logo-prompt").getByRole("button", { name: "Logo zeichnen" }).click();
  const board = page.getByTestId("logo-board");
  await expect(page.getByRole("dialog", { name: "Logo zeichnen" })).toBeVisible();
  await page.waitForTimeout(900); // the panel slides in
  const box = (await board.boundingBox())!;
  const cell = box.width / 16;
  await page.mouse.move(box.x + cell * 2.5, box.y + cell * 4.5);
  await page.mouse.down();
  for (let x = 3; x < 8; x++) await page.mouse.move(box.x + cell * (x + 0.5), box.y + cell * 4.5, { steps: 2 });
  await page.mouse.up();
  // Holding the left button paints every cell along the way, mirrored (ADR-079).
  const painted = await board.locator("span[style*='background-color']").count();
  expect(painted).toBeGreaterThanOrEqual(10);
  await hold(page, /Gedrückt halten: Logo festlegen/);
  await expect(page.getByText("Logo gespeichert")).toBeVisible();
  await expect(page.getByTestId("logo-prompt")).toHaveCount(0);
  await expect(page.getByTestId("logo-button")).toBeDisabled();

  // Going public: 25 % of the company, the subscription ends with the demo quarter.
  const listing = page.getByTestId("listing");
  await listing.getByRole("button", { name: "Börsengang" }).click();
  await page.getByRole("dialog", { name: "Börsengang" }).getByRole("button", { name: "Zeichnung starten" }).click();
  await expect(page.getByText("Börsengang gestartet")).toBeVisible();
  await expect(listing.getByText("Zeichnung des Börsengangs")).toBeVisible();
  await page.getByTestId("company-header").getByText("Demo: Quartal jetzt abschließen").click();
  await expect(listing.getByText(/An der Börse als PIX/)).toBeVisible();
  await expect(page.getByTestId("company-header").getByText("AG")).toBeVisible();
});
