import { expect, test, type Page } from "@playwright/test";

/*
 * The games of the addendum to ADR-160 in demo mode: each one can be started through the demo picker (the test hook
 * battle-demo-<kind>), shows its intro card, then its game, and takes the player's input.
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

async function startGame(page: Page, kind: string, title: string) {
  await page.goto("/news");
  await page.getByTestId(`battle-demo-${kind}`).click();
  await page.getByTestId("battle-join").click();
  const stage = page.getByTestId("battle-stage");
  await expect(stage).toBeVisible({ timeout: 25_000 });
  await expect(stage.getByTestId("battle-intro-title")).toHaveText(`${title}!`);
  await expect(stage.getByTestId("battle-intro")).toBeHidden({ timeout: 15_000 });
  return stage;
}

const ARENA = [
  { kind: "bear", title: "Bärenjagd", keys: ["KeyD", "KeyS", "ArrowLeft"] },
  { kind: "dash", title: "Dividenden-Dash", keys: ["KeyD", "Space", "KeyW"] },
  { kind: "margin", title: "Margin Call", keys: ["ArrowRight", "ArrowDown"] },
  { kind: "elevator", title: "Fahrstuhl zum Mond", keys: ["KeyW", "KeyW", "KeyA"] },
  { kind: "laser", title: "Laserschranke", keys: ["Space", "KeyD", "Space"] },
] as const;

for (const game of ARENA) {
  test(`${game.title}: intro, the arena, keys`, async ({ page }) => {
    test.setTimeout(90_000);
    const stage = await startGame(page, game.kind, game.title);
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

test("Bullen-Rodeo: intro, the riders, a cue", async ({ page }) => {
  test.setTimeout(90_000);
  const stage = await startGame(page, "rodeo", "Bullen-Rodeo");
  await expect(stage.getByTestId("battle-rodeo")).toBeVisible();
  expect(await stage.getByTestId("rodeo-rider").count()).toBeGreaterThanOrEqual(3);
  await expect(stage.getByTestId("rodeo-cue")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("ArrowUp");
});

test("Tresorknacker: a try gets the server's answer", async ({ page }) => {
  test.setTimeout(90_000);
  const stage = await startGame(page, "vault", "Tresorknacker");
  await expect(stage.getByTestId("battle-vault")).toBeVisible();
  for (const key of ["1", "2", "3", "Enter"]) await page.keyboard.press(key);
  await expect(stage.getByTestId("vault-guesses").locator("li")).toHaveCount(1);
  await expect(stage.getByTestId("vault-progress")).toBeVisible();
});

test("Ticker-Tippen: the tape and a tap", async ({ page }) => {
  test.setTimeout(90_000);
  const stage = await startGame(page, "ticker", "Ticker-Tippen");
  await expect(stage.getByTestId("ticker-option")).not.toHaveCount(0);
  // the tape moves: type the ticker instead of tapping it
  const ticker = (await stage.getByTestId("ticker-option").first().textContent()) ?? "";
  await page.keyboard.type(ticker);
  await expect(stage.getByText("Antwort abgegeben")).toBeVisible();
});

test("Mehr oder Weniger: the chart and a guess", async ({ page }) => {
  test.setTimeout(90_000);
  const stage = await startGame(page, "higher", "Mehr oder Weniger");
  await expect(stage.getByTestId("higher-choice")).toHaveCount(2);
  await page.keyboard.press("ArrowUp");
  await expect(stage.getByText(/Getippt/)).toBeVisible();
  await expect(stage.getByText(/Nächste Kerze/)).toBeVisible({ timeout: 10_000 });
});

test("Wer bietet mehr?: a sealed bid", async ({ page }) => {
  test.setTimeout(90_000);
  const stage = await startGame(page, "auction", "Wer bietet mehr?");
  await stage.getByRole("button", { name: "+100" }).click();
  await stage.getByTestId("auction-send").click();
  await expect(stage.getByText(/Geheimes Gebot/)).toBeVisible();
  await expect(stage.getByText(/Zuschlag|Niemand hat geboten/)).toBeVisible({ timeout: 15_000 });
});
