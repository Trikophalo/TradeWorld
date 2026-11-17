import { expect, test, type Page } from "@playwright/test";

/*
 * Nexamon card bonuses (ADR-171), demo mode: the "Boni" tab with totals and collections, the bonus on a card page,
 * the slabs-only view of the own collection and of a friend's collection.
 */
const SHOTS = process.env.NEXA_SHOT_DIR;

async function preparePlayer(page: Page, theme: "dark" | "light" = "dark") {
  await page.addInitScript(
    ([mode]) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem("nexa-settings", JSON.stringify({ state: { theme: mode }, version: 1 }));
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({ demo: { status: "done", step: 0, seenTours: ["visit_nexamon"] } }),
      );
      const now = Date.now();
      const copy = (id: string, cardKey: string, grade: number | null) => ({
        id,
        cardKey,
        serial: 3,
        condition: "mint",
        grade,
        gradingUntil: null,
        gradedAt: grade === null ? null : now,
        acquiredAt: now,
        listing: null,
      });
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
          ],
          nexamon: {
            cards: {},
            copies: [copy("e2e-1", "me-072", 9.5), copy("e2e-2", "me-001", null)],
            sales: [],
            points: {},
            packs: {},
            packTimes: [],
            aiPacksAt: {},
            pressureAt: now,
            tickAt: now,
            createdAt: now,
            nextId: 100,
          },
        }),
      );
    },
    [theme] as const,
  );
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test("the Boni tab shows active card bonuses against their caps and the collections", async ({ page }, info) => {
  await preparePlayer(page);
  await page.goto("/nexamon?tab=bonuses");
  const view = page.getByTestId("nexamon-bonuses");
  await expect(view).toBeVisible();
  // a water prisma in a 9.5 slab: 1 % x 1.5 vault interest
  await expect(page.getByTestId("bonus-total-vault")).toContainText("1,5");
  await expect(view.getByTestId("nexamon-bonus-tag").first()).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("bonus-col-col:mystic_energy:complete")).toContainText("2/77");
  await expect(view.getByTestId("bonus-missing-link").first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, `bonuses-${info.project.name}`);
});

test("a card page shows the bonus the card gives", async ({ page }, info) => {
  await preparePlayer(page, "light");
  await page.goto("/nexamon/me-072");
  const bonus = page.getByTestId("inspect-bonus");
  await expect(bonus).toBeVisible();
  await expect(bonus).toContainText("Tresorzinsen");
  await shot(page, `card-bonus-${info.project.name}`);
});

test("slabs only: the own collection and a friend's collection", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon?tab=collection");
  await page.getByTestId("binder-slabs-only").getByRole("switch").click();
  await expect(page.getByTestId("slab-tile")).toHaveCount(1);
  await expect(page.getByTestId("slab-summary")).toContainText("1 Slab");

  await page.goto("/players/Anna");
  await page.getByTestId("profile-nexamon-all").click();
  const binder = page.getByTestId("profile-nexamon-binder");
  await binder.getByText("Nur gegradete", { exact: true }).click();
  await expect(binder.getByTestId("slab-list")).toBeVisible();
  const grades = await binder
    .getByTestId("slab-tile")
    .evaluateAll((tiles) => tiles.map((t) => Number(t.getAttribute("data-grade"))));
  expect(grades.length).toBeGreaterThan(0);
  expect([...grades].sort((a, b) => b - a)).toEqual(grades);
});
