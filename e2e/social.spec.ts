import { expect, test } from "@playwright/test";

/*
 * Friends feed, notifications, weekly league (ADR-088, ADR-089) and announced events (ADR-090) in demo mode.
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
    const at = (ms: number) => new Date(Date.now() - ms).toISOString();
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Sozialfuchs",
        tag: "K7Q2",
        cashCents: 2_000_000,
        xpTotal: 7_000,
        tutorialCompleted: true,
        curveVersion: 2,
        social: {
          seq: 3,
          notifications: [
            {
              id: "n-1",
              typeKey: "feed_reaction",
              title: "Mira hat dir Applaus gegeben",
              body: "für deinen Gewinn mit Volta Energie",
              link: "/friends",
              createdAt: at(600_000),
              readAt: null,
            },
          ],
          feed: [
            {
              id: 2,
              kind: "big_trade",
              payload: { ticker: "VLT", security_name: "Volta Energie AG", profit_cents: 412_000, profit_bps: 2_350 },
              createdAt: at(300_000),
              reactions: 2,
              reacted: false,
            },
            { id: 1, kind: "level_up", payload: { level: 5 }, createdAt: at(3_600_000), reactions: 0, reacted: false },
          ],
        },
      }),
    );
  });
});

test("feed on the start page and in the friends hub, applause toggles", async ({ page }) => {
  await page.goto("/");
  const preview = page.getByTestId("feed-preview");
  await expect(preview).toContainText("hat mit Volta Energie AG 4.120 € Gewinn gemacht");
  await expect(page.getByTestId("league-preview")).toContainText("Platz 1 von 1");

  await page.goto("/friends");
  const first = page.getByTestId("feed").getByTestId("feed-item").first();
  await expect(first).toHaveAttribute("data-kind", "big_trade");
  const react = first.getByTestId("feed-react");
  await expect(react).toHaveText("2");
  await react.click();
  await expect(react).toHaveText("3");
  await expect(react).toHaveAttribute("aria-pressed", "true");
  await react.click();
  await expect(react).toHaveText("2");

  // The hub has the league and the friends list as tabs.
  await page.getByRole("radio", { name: "Wochenliga" }).click();
  await expect(page).toHaveURL(/tab=league/);
  await expect(page.getByTestId("league-table")).toContainText("Sozialfuchs");
  await page.getByRole("radio", { name: "Freunde" }).first().click();
  await expect(page.getByLabel("Spielername oder #Tag")).toBeVisible();
});

test("the bell shows unread notifications and marks them read", async ({ page }) => {
  await page.goto("/");
  const bell = page.getByTestId("notification-bell");
  await expect(bell.getByTestId("notification-count")).toHaveText("1");
  await bell.click();
  const list = page.getByTestId("notification-list");
  await expect(list).toContainText("Mira hat dir Applaus gegeben");
  await expect(bell.getByTestId("notification-count")).toHaveCount(0, { timeout: 5_000 });
});

test("announced events: upcoming dates and results", async ({ page }) => {
  await page.goto("/events");
  const events = page.getByTestId("events");
  await expect(events.getByRole("region", { name: "Demnächst" })).toBeVisible();
  await expect(events.locator('[data-kind="earnings"]').first()).toContainText("Quartalszahlen");
  await expect(events.getByTestId("event-outcome").first()).toBeVisible();
});
