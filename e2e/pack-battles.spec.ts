import { expect, test, type Page } from "@playwright/test";

/*
 * Pack Battles and live openings (ADR-172), demo mode: the made-up friends stand on the Collectibles tab, a friend is
 * challenged and accepts by himself, the battle view plays to the winner, and the Live button opens a spectator view.
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

const SHOTS = process.env.NEXA_SHOT_DIR;

test("presence strip, a pack battle against a demo friend and the live spectator view", async ({ page }, info) => {
  test.setTimeout(120_000);
  await preparePlayer(page);
  await page.goto("/nexamon");
  const lobby = page.getByTestId("nexamon-lobby");
  await expect(lobby).toBeVisible();
  const anna = lobby.locator('[data-testid="lobby-figure"][data-nickname="Anna"]');
  await expect(anna).toBeVisible();
  await expect(lobby.locator('[data-nickname="Bruno"]')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/lobby-${info.project.name}.png` });

  await anna.getByTestId("lobby-figure-button").click();
  await page.getByTestId("lobby-challenge").click();
  await page.getByTestId("challenge-send").click();
  const view = page.getByTestId("battle-view");
  await expect(view).toBeVisible({ timeout: 15_000 });
  await expect(view).toHaveAttribute("data-phase", "revealing", { timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/battle-${info.project.name}.png` });
  await expect(page.getByTestId("battle-summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("battle-side-challenger")).toHaveAttribute("data-shown", "5");
  await expect(page.getByTestId("battle-side-opponent")).toHaveAttribute("data-shown", "5");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/battle-end-${info.project.name}.png` });
  await page.getByTestId("battle-done").click();

  // a made-up friend opens live in the first 26 s of every 45 s
  await expect
    .poll(async () => Number(await page.getByTestId("live-button").getAttribute("data-count")), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await page.getByTestId("live-button").click();
  await page.getByTestId("live-session").first().click();
  const spect = page.getByTestId("spectator-view");
  await expect(spect).toBeVisible();
  await expect(spect).not.toHaveAttribute("data-shown", "0", { timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/spectate-${info.project.name}.png` });
});

test("a four-player pack battle over three packs (ADR-192)", async ({ page }, info) => {
  test.setTimeout(150_000);
  await preparePlayer(page);
  await page.goto("/nexamon");
  await expect(page.getByTestId("nexamon-lobby")).toBeVisible();
  await page.getByTestId("battle-create").click();
  await page.getByRole("radio", { name: "4 Spieler" }).click();
  await page.getByTestId("challenge-set-super_apex").click();
  await page.getByTestId("challenge-set-mystic_energy").click();
  await expect(page.getByTestId("lineup-item")).toHaveCount(3);
  // reorder and remove: the lineup keeps its order, the total follows it
  await page.getByTestId("lineup-up").nth(1).click();
  await expect(page.getByTestId("lineup-item").first()).toHaveAttribute("data-set", "super_apex");
  await page.getByTestId("lineup-remove").nth(2).click();
  await expect(page.getByTestId("lineup-item")).toHaveCount(2);
  await page.getByTestId("challenge-set-mystic_energy").click();
  await expect(page.getByTestId("lineup-item")).toHaveCount(3);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/multi-create-${info.project.name}.png` });
  await page.getByTestId("challenge-send").click();
  const view = page.getByTestId("battle-view");
  await expect(view).toBeVisible({ timeout: 15_000 });
  await expect(view).toHaveAttribute("data-players", "4");
  await expect(page.getByTestId("lobby-seat")).toHaveCount(4);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/multi-lobby-${info.project.name}.png` });
  await expect(view).toHaveAttribute("data-phase", "revealing", { timeout: 30_000 });
  await expect(page.getByTestId("battle-seat")).toHaveCount(4);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/multi-battle-${info.project.name}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByTestId("battle-summary")).toBeVisible({ timeout: 60_000 });
  for (const seat of await page.getByTestId("battle-seat").all())
    await expect(seat).toHaveAttribute("data-shown", "15");
  await expect(page.getByTestId("battle-ranking").locator("li")).toHaveCount(4);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/multi-end-${info.project.name}.png` });
  await page.getByTestId("battle-done").click();
});

test("a twist battle: the mode is picked, shown, and the piles swap after the pack (ADR-205)", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await preparePlayer(page);
  await page.goto("/nexamon");
  await expect(page.getByTestId("nexamon-lobby")).toBeVisible();
  await page.getByTestId("battle-create").click();
  const twist = page.getByTestId("mode-twist");
  await expect(twist).toHaveAttribute("aria-pressed", "false");
  await twist.click();
  await expect(twist).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mode-rules")).toContainText("Twist");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/twist-create-${info.project.name}.png` });
  await page.getByTestId("challenge-send").click();
  const view = page.getByTestId("battle-view");
  await expect(view).toBeVisible({ timeout: 15_000 });
  await expect(view.getByTestId("battle-mode-twist").first()).toBeAttached();
  await expect(view).toHaveAttribute("data-phase", "revealing", { timeout: 30_000 });
  // the last two cards of the pack reveal with the effect and its value counter
  await expect(view.getByTestId("battle-reveal-fx").first()).toBeVisible({ timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/twist-reveal-${info.project.name}.png` });
  await expect(view).toHaveAttribute("data-phase", "twisting", { timeout: 20_000 });
  const overlay = view.getByTestId("battle-twist");
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute("data-round", "1");
  // a swap names both players, or nothing moved
  await expect(overlay.getByTestId("battle-twist-move").or(overlay.getByTestId("battle-twist-none"))).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/twist-swap-${info.project.name}.png` });
  await expect(page.getByTestId("battle-summary")).toBeVisible({ timeout: 30_000 });
  // the scores are the piles: together they are everything pulled
  const sides = [page.getByTestId("battle-side-challenger"), page.getByTestId("battle-side-opponent")];
  const totals = await Promise.all(sides.map(async (s) => Number(await s.getAttribute("data-total"))));
  const scores = await Promise.all(sides.map(async (s) => Number(await s.getAttribute("data-score"))));
  expect(scores[0]! + scores[1]!).toBe(totals[0]! + totals[1]!);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/twist-end-${info.project.name}.png` });
  await page.getByTestId("battle-done").click();
});
