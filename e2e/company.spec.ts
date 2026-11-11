import { expect, test, type Page } from "@playwright/test";

/*
 * Player companies in demo mode (ADR-057): found a garage startup, close quarters,
 * hire an AI worker, post a job. Level 6 player with 20.000 €.
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

  // Growth stages (ADR-062): the product needs specialists, the next step is named.
  const growth = page.getByTestId("growth");
  await expect(growth.getByText("Stufe 1")).toBeVisible();
  await expect(growth.getByText(/Als Nächstes brauchst du: IT-Sicherheit/)).toBeVisible();

  // Close two quarters (demo button): a report appears.
  await header.getByText("Demo: Quartal jetzt abschließen").click();
  await header.getByText("Demo: Quartal jetzt abschließen").click();
  await expect(page.getByText(/Letztes Quartal · Q2/i)).toBeVisible();

  // Hire an AI worker: more capacity.
  await page.getByRole("button", { name: "+" }).click();
  await expect(page.getByTestId("ai-workers")).toHaveText("1");
  await expect(page.getByText("1 von 2 Plätzen belegt")).toBeVisible();

  // Post a job.
  await page.getByText("Stellen", { exact: true }).click();
  await page.getByRole("button", { name: "Stelle ausschreiben" }).click();
  const posting = page.getByRole("dialog", { name: "Stelle ausschreiben" });
  await posting.getByLabel("Titel der Stelle").fill("Backstube digital");
  await posting.getByRole("button", { name: "Ausschreiben" }).click();
  await expect(page.getByText("Stelle ausgeschrieben")).toBeVisible();
  await expect(page.locator("#main").getByText("Backstube digital")).toBeVisible();

  // The founder cannot take a job elsewhere; the career tab links to the company.
  await page.goto("/career");
  await expect(page.getByText("Deine Firma führen")).toBeVisible();
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
  await page.getByRole("button", { name: "Firma auflösen" }).click();
  await expect(page.getByRole("dialog", { name: "Firma auflösen" })).toBeVisible();
  await page.waitForTimeout(500); // the panel slides in
  await hold(page, /Gedrückt halten zum Auflösen/);
  await expect(page.getByText("Firma aufgelöst")).toBeVisible();
  await expect(page.getByTestId("dissolution")).toContainText("Du hast Chatbude aufgelöst.");
});

test("draw a logo, keep a job as founder, go public", async ({ page }) => {
  // Level 12 (IPO), 300.000 € to found, upgrade and run the company.
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

  // Pixel editor: draw a line (mirrored) and save.
  await page.getByTestId("logo-button").click();
  const board = page.getByTestId("logo-board");
  await expect(page.getByRole("dialog", { name: "Logo zeichnen" })).toBeVisible();
  await page.waitForTimeout(900); // the panel slides in
  const box = (await board.boundingBox())!;
  const cell = box.width / 16;
  await page.mouse.move(box.x + cell * 2.5, box.y + cell * 4.5);
  await page.mouse.down();
  for (let x = 3; x < 8; x++) await page.mouse.move(box.x + cell * (x + 0.5), box.y + cell * 4.5, { steps: 2 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Logo speichern" }).click();
  await expect(page.getByText("Logo gespeichert")).toBeVisible();

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
