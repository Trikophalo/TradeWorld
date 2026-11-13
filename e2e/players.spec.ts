import { expect, test } from "@playwright/test";

/*
 * Player tags and the player search in the top bar (ADR-085), demo mode.
 */
test.beforeEach(async ({ page }) => {
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
          seenTours: ["first_job", "limit_orders", "bonds", "found_garage", "visit_skill_map", "property"],
        },
      }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Taggy",
        tag: "K7Q2",
        cashCents: 2_000_000,
        xpTotal: 7_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
});

test("own tag on the profile, find players by name and #tag in the top search", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByTestId("my-tag")).toContainText("Taggy");
  await expect(page.getByTestId("my-tag").getByTestId("player-tag")).toHaveText("#K7Q2");

  // Search by name: stocks and players in one list.
  await page
    .getByRole("button", { name: /suchen/i })
    .first()
    .click();
  const search = page.getByRole("combobox");
  await search.fill("tagg");
  await expect(page.getByTestId("search-player")).toContainText("Taggy");
  await expect(page.getByTestId("search-player")).toContainText("#K7Q2");

  // By tag, with or without #, any case.
  await search.fill("#k7q2");
  await expect(page.getByTestId("search-player")).toHaveCount(1);
  await page.getByTestId("search-player").click();
  await expect(page).toHaveURL(/\/players\/Taggy$/);
  await expect(page.getByTestId("business-card").getByTestId("player-tag")).toHaveText("#K7Q2");
});

test("adding oneself by tag is refused", async ({ page }) => {
  await page.goto("/friends?tab=friends");
  await page.getByLabel("Spielername oder #Tag").fill("#K7Q2");
  await page.getByRole("button", { name: "Anfrage schicken" }).click();
  await expect(page.getByText("Das bist du selbst.", { exact: false })).toBeVisible();
});
