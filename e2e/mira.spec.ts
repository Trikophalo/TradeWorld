import { expect, test, type Page } from "@playwright/test";

/*
 * Mira, the company assistant (ADR-138), in demo mode: she briefs the new task, the founder answers in the chat,
 * and the overview folds into sections.
 */
async function foundCompany(page: Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({
        demo: { status: "done", step: 0, seenTours: ["first_job", "bonds", "found_garage", "visit_company"] },
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
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Miraversum");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Bedruckte T-Shirts mit lustigen Sprüchen.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  const button = page.getByRole("button", { name: /Gedrückt halten zum Gründen/ });
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
  await expect(page.getByText("Firma gegründet!")).toBeVisible();
}

test("Mira briefs the new task and runs the company through the chat", async ({ page }) => {
  await foundCompany(page);
  const mira = page.getByTestId("mira");
  await expect(mira).toBeVisible();
  await expect(mira.getByTestId("mira-says").first()).toContainText("Hi, ich bin Mira");
  // The first task of the demo is briefed with options; the player can do it themself.
  await expect(mira.getByText(/Neue Aufgabe: „/).first()).toBeVisible();
  await expect(mira.getByTestId("mira-option").filter({ hasText: "Mach ich selbst" }).first()).toBeVisible();

  // Free text without Claude: Mini-Mira explains what she understands.
  await mira.getByTestId("mira-input").fill("Erzähl mir einen Witz");
  await mira.getByTestId("mira-send").click();
  await expect(mira.getByText("Hm, das habe ich nicht ganz verstanden.")).toBeVisible();

  // A command: doing the task oneself opens the mini-game.
  await mira.getByTestId("mira-input").fill("Das mache ich selbst");
  await mira.getByTestId("mira-send").click();
  await expect(page.getByTestId("play-sheet")).toBeVisible();
  await page.keyboard.press("Escape");

  // Own idea for a business move: the writing mode, then the jury.
  await mira.getByTestId("mira-option").filter({ hasText: "Eigene Idee" }).first().click();
  await expect(mira.getByTestId("mira-compose")).toBeVisible();
  await mira.getByTestId("mira-input").fill("Wir verkaufen unsere Shirts auf Festivals.");
  await mira.getByTestId("mira-send").click();
  await expect(mira.getByText("Deine Idee liegt bei der Jury.")).toBeVisible();

  // The overview folds into sections; the quarter is open, the rest opens on a tap.
  await page.getByRole("tab", { name: /Übersicht/ }).click();
  await expect(page.getByTestId("treasury")).toBeVisible();
  await expect(page.getByTestId("company-moves")).toHaveCount(0);
  await page.getByTestId("section-moves").click();
  await expect(page.getByTestId("company-moves")).toBeVisible();
});
