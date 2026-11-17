import { expect, test, type Page } from "@playwright/test";

/*
 * Collectibles on profiles (ADR-165), demo mode: a made-up friend's cards on their profile with the whole
 * collection behind a button, the own profile, the collection's "for sale" filter and missions that lead to
 * the Nexamon page.
 */
async function preparePlayer(page: Page, theme: "dark" | "light" = "dark", extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([mode, more]) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem("nexa-settings", JSON.stringify({ state: { theme: mode }, version: 1 }));
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
              "artworks",
              "visit_artworks",
              "property",
              "visit_property",
              "visit_nexamon",
            ],
          },
        }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({
          nickname: "Sammlerin",
          tag: "K7Q2",
          cashCents: 50_000_000,
          xpTotal: 90_000,
          tutorialCompleted: true,
          curveVersion: 2,
          friendList: [
            {
              nickname: "Anna",
              tag: "A1B2",
              level: 14,
              avatarKey: "seller",
              accessories: [],
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
          ...more,
        }),
      );
    },
    [theme, extra] as const,
  );
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("a friend's profile shows their collectibles and the whole collection", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/players/Anna");
  const section = page.getByTestId("profile-nexamon");
  await expect(section).toBeVisible();
  await expect(section.getByText("Collectibles", { exact: true })).toBeVisible();
  await expect(page.getByTestId("profile-nexamon-summary")).toContainText("150 Karten");
  await expect(page.getByTestId("profile-nexamon-summary")).toContainText("von 321 Motiven");
  await expect(page.getByTestId("profile-nexamon-copies")).toContainText("150");
  await expect(page.getByTestId("profile-nexamon-value")).toContainText("€");

  // The showcase: the eight most valuable cards, slabs as slabs, each with its rarity.
  const showcase = page.getByTestId("profile-nexamon-showcase");
  await expect(showcase.getByTestId("profile-nexamon-tile")).toHaveCount(8);
  await expect(showcase.locator('[data-testid="profile-nexamon-tile"][data-graded="true"]').first()).toBeVisible();
  await expect(showcase.getByTestId("copy-slab").first()).toBeVisible();
  // Somebody else's cards cannot be managed from here.
  await expect(page.getByTestId("profile-nexamon-manage")).toHaveCount(0);
  await expectNoSidewaysScroll(page);

  // The whole collection, set by set, read-only.
  await page.getByTestId("profile-nexamon-all").click();
  const binder = page.getByTestId("profile-nexamon-binder");
  await expect(binder).toBeVisible();
  await expect(page.getByText("Sammlung von Anna")).toBeVisible();
  const ownedTiles = binder.locator('[data-testid="profile-nexamon-tile"][data-owned="true"]');
  const owned = await ownedTiles.count();
  expect(owned).toBeGreaterThan(8);
  await expect(binder.locator('[data-testid="profile-nexamon-tile"][data-owned="false"]')).toHaveCount(0);
  await expect(binder.locator("section[data-set='mystic_energy']")).toContainText("von 77");
  await expect(binder.getByRole("button", { name: /einstellen|verkaufen|ASP/i })).toHaveCount(0);

  await binder.getByText("Alle Karten", { exact: true }).click();
  await expect(binder.getByTestId("profile-nexamon-tile")).toHaveCount(321);
  await expect(ownedTiles).toHaveCount(owned);

  // A card leads to its page.
  const first = ownedTiles.first();
  const key = await first.getAttribute("data-card");
  await first.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/nexamon/${key}$`));
});

test("a friend below the Nexamon level shows no collectibles", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/players/Bruno");
  await expect(page.getByText("Bruno").first()).toBeVisible();
  await expect(
    page
      .getByTestId("business-card")
      .or(page.getByRole("heading", { name: "Bruno" }))
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId("profile-nexamon")).toHaveCount(0);
});

test("the own profile lists the collectibles, and the collection says what is for sale", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/profile");
  const section = page.getByTestId("profile-nexamon");
  await expect(section).toHaveAttribute("data-empty", "true");
  await expect(section.getByText("Noch keine Karte")).toBeVisible();

  // Buy and open a pack, then the cards are on the profile.
  await section.getByRole("link", { name: "Zum Shop" }).click();
  await expect(page).toHaveURL(/\/nexamon\?tab=shop$/);
  await page.getByTestId("buy-mystic_energy").click();
  await page.getByTestId("confirm-buy").click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", /sealed|opening/);

  await page.goto("/profile");
  await expect(page.getByTestId("profile-nexamon-copies")).toContainText("5");
  await expect(page.getByTestId("profile-nexamon-showcase").getByTestId("profile-nexamon-tile")).toHaveCount(5);
  await expectNoSidewaysScroll(page);
  await page.getByTestId("profile-nexamon-all").click();
  await expect(page.getByTestId("profile-nexamon-binder")).toBeVisible();
  await expect(
    page.getByTestId("profile-nexamon-binder").locator('[data-testid="profile-nexamon-tile"][data-owned="true"]'),
  ).toHaveCount(5);
  await page.keyboard.press("Escape");

  // From the profile to the collection: everything is kept until it is listed.
  await page.getByTestId("profile-nexamon-manage").click();
  await expect(page).toHaveURL(/\/nexamon\?tab=collection$/);
  await expect(page.getByRole("heading", { name: "Deine Sammlung" })).toBeVisible();
  await expect(page.getByTestId("binder-kept")).toContainText("5 Karten bleiben bei dir");
  await expect(page.getByTestId("binder-kept")).toContainText("keine steht zum Verkauf");
  await page.getByTestId("binder-sale").selectOption("kept");
  await expect(page.getByTestId("binder-tile")).toHaveCount(5);
  await page.getByTestId("binder-sale").selectOption("listed");
  await expect(page.getByTestId("binder-tile")).toHaveCount(0);
  await expect(page.getByText("Nichts gefunden")).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test("missions about Nexamon lead to the Nexamon page", async ({ page }) => {
  // The story mission "Dein erster Booster" is open; which missions the demo deals out is otherwise its choice.
  await preparePlayer(page, "dark", {
    missions: [
      { id: "mission-nx", key: "m_nexamon_first_pack", kind: "milestone", base: 0, status: "active", period: null },
    ],
  });
  await page.goto("/missions");
  const link = page.getByTestId("mission-link").filter({ hasText: "Dein erster Booster" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/nexamon");
  // Missions that belong to no single page stay plain text.
  expect(await page.getByTestId("mission-link").count()).toBeLessThan(await page.getByText(/\+\d+ XP/).count());
  await link.click();
  await expect(page).toHaveURL(/\/nexamon$/);
  await expect(page.getByTestId("nexamon-hub")).toBeVisible();
});

test("the collection remembers its filters and tab, and marks cards in the market", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon?tab=shop");
  await page.getByTestId("buy-mystic_energy").click();
  await page.getByTestId("confirm-buy").click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", /sealed|opening/);

  await page.goto("/nexamon?tab=collection");
  await page.getByTestId("binder-sort").selectOption("value");
  await page.getByTestId("binder-set").selectOption("mystic_energy");
  // List one card: the copy and its tile carry the market tag, with the price on hover.
  const tile = page.locator('[data-testid="binder-tile"][data-owned="true"]').first();
  const key = await tile.getAttribute("data-card");
  await tile.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/nexamon/${key}$`));
  await page.getByTestId("copy-sell").first().click();
  await page.getByTestId("sell-confirm").click();
  await expect(page.getByTestId("copy-status").first()).toContainText("Im Markt");

  // Without a tab in the address the last one comes back, with the filters.
  await page.goto("/nexamon");
  await expect(page.getByTestId("nexamon-hub")).toHaveAttribute("data-tab", "collection");
  await expect(page.getByTestId("binder-sort")).toHaveValue("value");
  await expect(page.getByTestId("binder-set")).toHaveValue("mystic_energy");
  const listed = page.locator(`[data-testid="binder-tile"][data-card="${key}"]`).getByTestId("tile-listed");
  await expect(listed).toHaveText("Im Markt");
  await expect(listed).toHaveAttribute("title", /Steht im Markt für/);
});
