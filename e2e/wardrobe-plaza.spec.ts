import { expect, test } from "@playwright/test";

/*
 * Accessories for the pixel figure and the friends plaza with poking (ADR-155), demo mode with two made-up friends.
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
        nickname: "Modefuchs",
        tag: "K7Q2",
        cashCents: 2_000_000,
        xpTotal: 7_000,
        tutorialCompleted: true,
        curveVersion: 2,
        friendList: [
          {
            nickname: "Anna",
            tag: "A1B2",
            level: 9,
            avatarKey: "seller",
            accessories: ["cowboy_hat", "banana_costume"],
            online: true,
            since: "2026-11-01T10:00:00Z",
          },
          {
            nickname: "Bruno",
            tag: "B3C4",
            level: 4,
            avatarKey: "punk",
            accessories: [],
            online: false,
            since: "2026-11-02T10:00:00Z",
          },
        ],
      }),
    );
  });
});

test("wardrobe: try on, buy, wear and see it on the own profile", async ({ page }) => {
  await page.goto("/profile");
  await page.getByTestId("open-wardrobe").click();
  await expect(page).toHaveURL(/\/profile\/wardrobe$/);
  await expect(page.getByRole("heading", { level: 1, name: "Kleiderschrank" })).toBeVisible();

  const hat = page.locator('[data-testid="accessory"][data-key="cowboy_hat"]');
  // Trying on changes only the figure.
  await hat.getByRole("button", { name: /Cowboyhut: Anprobieren/ }).click();
  await expect(page.getByTestId("wardrobe-preview")).toBeVisible();
  await expect(page.getByTestId("wardrobe-figure")).toHaveAttribute("data-worn", "cowboy_hat");
  await expect(hat).toHaveAttribute("data-owned", "false");

  await hat.getByTestId("accessory-buy").click();
  await expect(page.getByText("Cowboyhut gehört dir!")).toBeVisible();
  await expect(hat).toHaveAttribute("data-worn", "true");
  await expect(page.getByTestId("wardrobe-preview")).toHaveCount(0);
  await expect(page.getByTestId("wardrobe-worn")).toContainText("Cowboyhut");

  // Take it off and on again.
  await hat.getByTestId("accessory-wear").click();
  await expect(hat).toHaveAttribute("data-worn", "false");
  await hat.getByTestId("accessory-wear").click();
  await expect(hat).toHaveAttribute("data-worn", "true");

  // The crown waits for level 25.
  await expect(page.locator('[data-testid="accessory"][data-key="crown"]')).toContainText("Level 25");

  await page.goto("/players/Modefuchs");
  await expect(page.getByTestId("figure-card").getByTestId("figure-worn")).toContainText("Cowboyhut");
});

test("friends plaza: every friend on the square, online sign, profile, poke", async ({ page }) => {
  await page.goto("/friends");
  const plaza = page.getByTestId("friends-plaza");
  await expect(plaza.getByTestId("plaza-friend")).toHaveCount(2);
  await expect(plaza.getByTestId("plaza-summary")).toContainText("2 Freunde · 1 online");
  const anna = plaza.locator('[data-nickname="Anna"]');
  await expect(anna).toHaveAttribute("data-online", "true");
  await expect(anna.getByTestId("plaza-online")).toBeVisible();
  await expect(plaza.locator('[data-nickname="Bruno"]').getByTestId("plaza-online")).toBeHidden();

  await anna.getByTestId("plaza-poke").click();
  await expect(page.getByText("Anna angestupst!")).toBeVisible();
  await anna.getByTestId("plaza-poke").click();
  await expect(page.getByText(/Nicht so stürmisch/)).toBeVisible();

  await anna.getByRole("link", { name: "Profil von Anna öffnen" }).click();
  await expect(page).toHaveURL(/\/players\/Anna$/);
  await expect(page.getByTestId("figure-card").getByTestId("figure-worn")).toContainText("Bananenkostüm");
  await page.getByTestId("figure-card").getByTestId("poke-button").click();
  await expect(page.getByText(/Nicht so stürmisch/).first()).toBeVisible();
});
