import { expect, test, type Page } from "@playwright/test";

/*
 * ADR-177 in demo mode: the five new WASD games start through the demo picker and take the player's keys; sealed
 * booster packs (a battle prize, or bought to open later) wait in Collectibles and open like a bought pack.
 */
function prepare(page: Page, extra: Record<string, unknown> = {}) {
  return page.addInitScript((more) => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
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
        nickname: "Kämpferin",
        cashCents: 50_000_000,
        xpTotal: 90_000,
        tutorialCompleted: true,
        curveVersion: 2,
        ...more,
      }),
    );
  }, extra);
}

const GAMES = [
  { kind: "zone", title: "Goldrausch-Zone", keys: ["KeyD", "KeyS", "ArrowLeft"] },
  { kind: "tag", title: "Bulle und Bär", keys: ["KeyW", "KeyD", "ArrowDown"] },
  { kind: "tiles", title: "Wackelparkett", keys: ["KeyD", "KeyD", "KeyS", "KeyA"] },
  { kind: "paint", title: "Farbrausch", keys: ["KeyD", "Space", "KeyS"] },
  { kind: "crash", title: "Crash-Regen", keys: ["ArrowUp", "ArrowRight"] },
] as const;

for (const game of GAMES) {
  test(`${game.title}: intro, the arena, keys`, async ({ page }) => {
    test.setTimeout(90_000);
    await prepare(page);
    await page.goto("/news");
    await page.getByTestId(`battle-demo-${game.kind}`).click();
    await page.getByTestId("battle-join").click();
    const stage = page.getByTestId("battle-stage");
    await expect(stage).toBeVisible({ timeout: 25_000 });
    await expect(stage.getByTestId("battle-intro-title")).toHaveText(`${game.title}!`);
    await expect(stage.getByTestId("battle-intro")).toBeHidden({ timeout: 15_000 });
    await expect(stage.getByTestId("battle-arena")).toHaveAttribute("data-kind", game.kind);
    for (const key of game.keys) {
      await page.keyboard.down(key);
      await page.waitForTimeout(300);
      await page.keyboard.up(key);
    }
    await expect(stage.getByTestId("battle-hud")).toContainText(/übrig/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("a sealed booster won in a battle opens in Collectibles", async ({ page }) => {
  await prepare(page, {
    nexamonSealed: [
      { id: "sealed-e2e-1", set: "mystic_energy", source: "battle", priceCents: 0, createdAt: Date.now() - 60_000 },
    ],
  });
  await page.goto("/nexamon");
  const strip = page.getByTestId("sealed-packs");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Battle-Gewinn");
  await page.getByTestId("sealed-open-mystic_energy").click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", "opening");
  await page.getByTestId("pack-skip").click();
  await expect(page.getByTestId("pull-row")).toHaveCount(5);
  await page.getByTestId("pack-close").click();
  await expect(page.getByTestId("sealed-packs")).toHaveCount(0);
});

test("buy a booster now and open it later", async ({ page }) => {
  await prepare(page);
  await page.goto("/nexamon");
  await expect(page.getByTestId("sealed-packs")).toHaveCount(0);
  await page.getByTestId("buy-mystic_energy").click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", "preview");
  await page.getByTestId("buy-sealed").click();
  await expect(page.getByText("liegt bei „Ungeöffnete Booster“")).toBeVisible();
  await page.getByTestId("pack-close").click();
  const strip = page.getByTestId("sealed-packs");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("× 1");
  await page.getByTestId("sealed-open-mystic_energy").click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", "opening");
  await page.getByTestId("pack-skip").click();
  await expect(page.getByTestId("pull-row")).toHaveCount(5);
  await page.getByTestId("pack-close").click();
  await expect(page.getByTestId("sealed-packs")).toHaveCount(0);
});
