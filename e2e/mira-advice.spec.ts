import { expect, test, type Page } from "@playwright/test";

/*
 * Mira (ADR-185) in demo mode: she answers from the company facts, and her top suggestion is an action that works
 * right now.
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
  await sheet.getByLabel("Firmenname").fill("Advisorium");
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

test("Mira's top suggestion leads to an enabled action", async ({ page }) => {
  await foundCompany(page);
  // Mira is a panel on every tab (ADR-187): the button next to the tabs opens it.
  await page.getByTestId("mira-open").click();
  const mira = page.getByTestId("mira");
  await expect(mira.getByTestId("mira-says").first()).toContainText("Hi, ich bin Mira");

  await mira.getByTestId("mira-input").fill("Lagebericht");
  await mira.getByTestId("mira-send").click();
  await expect(mira.getByText("Lagebericht für Advisorium:")).toBeVisible();

  await mira.getByTestId("mira-input").fill("Was soll ich als Nächstes tun?");
  await mira.getByTestId("mira-send").click();
  const answer = mira.getByTestId("mira-says").last();
  await expect(answer).toContainText(/Das würde ich jetzt tun|wartet eine Aufgabe|warten \d+ Aufgaben/);
  const top = answer.getByTestId("mira-option").first();
  await expect(top).toBeEnabled();
  const before = await mira.getByTestId("mira-says").count();
  await top.click();
  // The action ran: a mini-game opened or Mira confirmed it, and nothing failed.
  await expect
    .poll(
      async () =>
        (await page.getByTestId("play-sheet").isVisible()) || (await mira.getByTestId("mira-says").count()) > before,
    )
    .toBe(true);
  await expect(mira.getByText("Das hat nicht geklappt:")).toHaveCount(0);
});
