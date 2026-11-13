import { expect, test } from "@playwright/test";

/*
 * Display currency (ADR-113) in demo mode: euro by default, dollar or NX as a setting on the profile. Only the sign
 * changes, in amounts, in texts and in what the game engine answers.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem("nexa-tutorial", JSON.stringify({ demo: { status: "done", step: 0, seenTours: [] } }));
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Weltenbummler",
        tag: "K7Q2",
        cashCents: 1_000_000,
        xpTotal: 0,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
});

test("currency: euro by default, dollar and NX by choice, kept after a reload", async ({ page }) => {
  await page.goto("/profile");
  const cash = page.locator('[data-fly-target="cash"]').first();
  const friendCode = page.getByTestId("friend-code");
  await expect(cash).toContainText("10.000,00 €");
  await expect(friendCode).toContainText("5.000 €");

  await page.getByRole("radio", { name: "Dollar $" }).click();
  await expect(cash).toContainText("10.000,00 $");
  await expect(friendCode).toContainText("5.000 $");
  // A text from messages with a fixed amount follows too.
  await expect(page.getByText("Kleinkredit bis 50.000 $")).toBeVisible();
  // The only euro sign left is the choice itself.
  await expect(page.getByText("€")).toHaveCount(1);

  await page.reload();
  await expect(cash).toContainText("10.000,00 $");
  await expect(page.getByRole("radio", { name: "Dollar $" })).toBeChecked();

  await page.getByRole("radio", { name: "Nex NX" }).click();
  await expect(cash).toContainText("10.000,00 NX");
  await expect(page.getByText("Kleinkredit bis 50.000 NX")).toBeVisible();

  // Missions are written by the game engine: their amounts follow as well.
  await page.goto("/missions");
  await expect(page.getByRole("main")).toContainText("NX");
  await expect(page.getByRole("main").getByText("€")).toHaveCount(0);

  await page.goto("/profile");
  await page.getByRole("radio", { name: "Euro €" }).click();
  await expect(cash).toContainText("10.000,00 €");
});
