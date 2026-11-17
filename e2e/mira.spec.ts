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
  // Mira is a panel on every tab since ADR-187: the button next to the tabs opens it.
  await page.getByTestId("mira-open").click();
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
  await expect(page.getByTestId("play-sheet")).toBeHidden();
  if (!(await mira.isVisible())) await page.getByTestId("mira-open").click();

  // The plan: no team and no AI yet, so Mira says the task stays with the player.
  await mira.getByTestId("mira-input").fill("Verteil alle Aufgaben");
  await mira.getByTestId("mira-send").click();
  await expect(mira.getByText(/Gerade kann ich nichts sinnvoll vergeben|Mein Plan:/)).toBeVisible();
  await mira.getByTestId("mira-input").fill("Wie läuft die Firma?");
  await mira.getByTestId("mira-send").click();
  await expect(mira.getByText(/Du hast noch kein Team/)).toBeVisible();

  // A free order (ADR-139): Mira reads the goal, estimates the chance and carries it out; one per hour.
  await mira.getByTestId("mira-input").fill("Wir drehen ein lustiges Video für Social Media.");
  await mira.getByTestId("mira-send").click();
  await expect(mira.getByText(/Verstanden: „Wir drehen ein lustiges Video/)).toBeVisible();
  const go = mira.getByTestId("mira-option").filter({ hasText: "Umsetzen für mehr Bekanntheit" });
  await expect(go).toContainText("Tipp");
  await go.click();
  await expect(mira.getByText(/Auftrag läuft!/)).toBeVisible();
  await mira.getByTestId("mira-input").fill("Wir machen eine Rabattaktion für Stammkunden.");
  await mira.getByTestId("mira-send").click();
  await expect(mira.getByText(/Pro Stunde kann ich nur einen freien Auftrag umsetzen/)).toBeVisible();

  // Controlling: the jump bar leads to the marketing card, its switch to the business moves (ADR-187).
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Controlling/ }).click();
  await expect(page.getByTestId("treasury")).toBeAttached();
  await page.getByTestId("controlling-nav").getByTestId("nav-group-marketing").click();
  await page.getByTestId("firm-section-group-marketing").getByRole("radio", { name: "Geschäftszüge" }).click();
  await page.getByTestId("company-moves").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("company-moves")).toBeVisible();
});
