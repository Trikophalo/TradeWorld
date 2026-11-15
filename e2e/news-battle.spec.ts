import { expect, test } from "@playwright/test";

/*
 * News battles (ADR-160) in demo mode: join the lobby, made-up opponents join, a game starts with its intro, the
 * player plays with the keyboard, and the podium with the winner and the prize appears.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({ demo: { status: "done", step: 0, seenTours: ["first_job", "bonds", "found_garage"] } }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Kämpferin",
        cashCents: 2_000_000,
        xpTotal: 7_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
});

test("a news battle: lobby with made-up opponents, intro, play with the keyboard, podium", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/news");
  const lobby = page.getByTestId("news-battle");
  await expect(lobby).toBeVisible();
  await expect(lobby.getByTestId("battle-lobby-prize")).toBeVisible();

  await page.getByTestId("battle-demo-floor").click();
  await page.getByTestId("battle-join").click();
  await expect(lobby.getByText("Du bist dabei!")).toBeVisible();
  // the made-up opponents step in; from three the countdown runs
  await expect(lobby.getByTestId("battle-countdown")).toBeVisible({ timeout: 10_000 });
  expect(await lobby.getByTestId("battle-lineup").locator("li").count()).toBeGreaterThanOrEqual(3);

  // the battle opens on the whole screen with its intro card
  const stage = page.getByTestId("battle-stage");
  await expect(stage).toBeVisible({ timeout: 20_000 });
  await expect(stage.getByTestId("battle-intro-title")).toHaveText("Kurssturz!");
  await expect(stage.getByTestId("battle-intro")).toBeHidden({ timeout: 15_000 });
  await expect(stage.getByTestId("battle-arena")).toHaveAttribute("data-kind", "floor");

  // play: run around with WASD and the arrows (standing still breaks the floor)
  for (const key of ["KeyD", "KeyS", "ArrowLeft", "KeyW", "ArrowRight", "KeyS"]) {
    await page.keyboard.down(key);
    await page.waitForTimeout(450);
    await page.keyboard.up(key);
  }
  await expect(stage.getByTestId("battle-hud")).toContainText(/übrig/);

  // the server (here the demo) decides: the podium with the winner and the prize
  await expect(stage.getByTestId("battle-podium")).toBeVisible({ timeout: 100_000 });
  await expect(stage.getByTestId("battle-winner")).toContainText(/gewinnt|gewonnen/);
  await expect(stage.getByTestId("battle-prize")).toBeVisible({ timeout: 5_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // back to the next lobby; the last winner stays named
  await stage.getByTestId("battle-podium-close").click();
  await expect(stage).toBeHidden();
  await expect(lobby.getByTestId("battle-last-winner")).toBeVisible();
  await expect(lobby.getByTestId("battle-join")).toBeVisible();
});

test("a quiz battle: questions with four answers, keys 1 to 4", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/news");
  await page.getByTestId("battle-demo-quiz").click();
  await page.getByTestId("battle-join").click();
  const stage = page.getByTestId("battle-stage");
  await expect(stage).toBeVisible({ timeout: 25_000 });
  await expect(stage.getByTestId("battle-intro")).toBeHidden({ timeout: 15_000 });
  await expect(stage.getByTestId("battle-question")).toBeVisible();
  await expect(stage.getByTestId("battle-option")).toHaveCount(4);
  await page.keyboard.press("2");
  await expect(stage.getByText("Antwort abgegeben")).toBeVisible();
  // after the answer time the right answer is shown
  await expect(stage.getByText(/Richtig!|Falsch!/)).toBeVisible({ timeout: 15_000 });
});
