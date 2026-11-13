import { expect, test } from "@playwright/test";

/*
 * Friend code on the profile (ADR-111) in demo mode: the own code, wrong codes, redeeming once for the bonus.
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
        nickname: "Neuling",
        tag: "K7Q2",
        cashCents: 1_000_000,
        xpTotal: 0,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
});

test("friend code: own code, wrong codes, one bonus", async ({ page }) => {
  await page.goto("/profile");
  const card = page.getByTestId("friend-code");
  await expect(card.getByTestId("friend-code-own")).toHaveText("NEXA-K7Q2");
  await expect(card).toContainText("5.000 NX");
  await expect(card.getByTestId("friend-code-invited")).toContainText("Noch hat niemand");
  await expect(card.getByTestId("friend-code-submit")).toBeDisabled();

  const input = card.getByTestId("friend-code-input");
  await input.fill("hallo");
  await card.getByTestId("friend-code-submit").click();
  await expect(card.getByTestId("friend-code-error")).toContainText("NEXA-K7Q2");

  await input.fill("nexa-k7q2");
  await card.getByTestId("friend-code-submit").click();
  await expect(card.getByTestId("friend-code-error")).toContainText("dein eigener Code");

  await input.fill("NEXA-ABCD");
  await card.getByTestId("friend-code-submit").click();
  await expect(card.getByTestId("friend-code-error")).toContainText("gibt es nicht");

  await input.fill("nexa f7nn");
  await card.getByTestId("friend-code-submit").click();
  await expect(page.getByText("Freundescode eingelöst")).toBeVisible();
  await expect(card.getByTestId("friend-code-redeemed")).toContainText("Finn");
  await expect(card.getByTestId("friend-code-form")).toHaveCount(0);
  await expect(page.locator('[data-fly-target="cash"]').first()).toContainText("15.000");

  // Once only: after a reload the form stays away and the money stays the same.
  await page.reload();
  await expect(page.getByTestId("friend-code-redeemed")).toBeVisible();
  await expect(page.locator('[data-fly-target="cash"]').first()).toContainText("15.000");
});
