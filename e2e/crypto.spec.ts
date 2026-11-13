import { expect, test, type Page } from "@playwright/test";

/*
 * Crypto market and the own coin (ADR-101) in demo mode: locked below level 10, trading against the pool, the coin
 * studio from founding to launch.
 */
const TOURS = [
  "first_job",
  "limit_orders",
  "bonds",
  "found_garage",
  "visit_skill_map",
  "visit_company",
  "visit_listing",
  "artworks",
  "visit_artworks",
  "property",
  "visit_property",
  "deals",
  "crypto",
];

async function preparePlayer(page: Page, player: Record<string, unknown>) {
  await page.addInitScript(
    ({ player, tours }) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({ demo: { status: "done", step: 0, seenTours: tours } }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({ tutorialCompleted: true, curveVersion: 2, ...player }),
      );
    },
    { player, tours: TOURS },
  );
}

test("crypto: locked below level 10", async ({ page }) => {
  await preparePlayer(page, { nickname: "Kleinanleger", xpTotal: 7_000 });
  await page.goto("/crypto");
  await expect(page.getByText("Ab Level 10 kannst du einsteigen.")).toBeVisible();
  await expect(page.getByTestId("crypto-guide")).toBeVisible();
});

test("crypto: market, buy a memecoin against the pool, sell it again", async ({ page }) => {
  await preparePlayer(page, { nickname: "Kryptofan", cashCents: 5_000_000, xpTotal: 30_000 });
  await page.goto("/crypto");
  await expect(page.getByTestId("crypto-regime")).toBeVisible();
  await expect(page.getByTestId("coin-row")).toHaveCount(15);

  await page.locator('[data-filter="meme"]').click();
  await expect(page.getByTestId("coin-row")).toHaveCount(5);
  await page.locator('[data-testid="coin-row"][data-ticker="HMR"]').click();

  await expect(page.getByTestId("coin-detail")).toHaveAttribute("data-ticker", "HMR");
  await page.getByTestId("coin-buy").click();
  await page.getByTestId("crypto-trade-input").fill("500");
  await expect(page.getByTestId("crypto-trade")).toContainText("Du bekommst etwa");
  await page.getByTestId("crypto-trade-submit").click();
  await expect(page.getByText("Gekauft", { exact: true })).toBeVisible();
  await expect(page.getByTestId("coin-position")).toContainText("HMR");

  await expect(page.getByTestId("coin-sell")).toBeEnabled();
  await page.getByTestId("coin-sell").click();
  await page.getByRole("button", { name: "Alles" }).click();
  await page.getByTestId("crypto-trade-submit").click();
  await expect(page.getByText("Verkauft", { exact: true })).toBeVisible();
  await expect(page.getByTestId("coin-position")).toContainText("Du hältst noch keine HMR.");
});

test("crypto: found an own coin, check the name, develop and see the launch rule", async ({ page }) => {
  await preparePlayer(page, { nickname: "Coinbauer", cashCents: 10_000_000, xpTotal: 70_000 });
  await page.goto("/crypto/studio");
  await expect(page.getByTestId("coin-studio")).toHaveAttribute("data-step", "create");

  await page.getByTestId("coin-name").fill("Kryptaler");
  await page.getByTestId("coin-ticker").fill("STRN");
  await expect(page.getByTestId("coin-name-check")).toContainText("schon jemand");
  await page.getByTestId("coin-name").fill("Sternmünze");
  await expect(page.getByTestId("coin-name-check")).toContainText("frei");

  const board = page.getByTestId("coin-logo-board");
  await board.scrollIntoViewIfNeeded();
  const box = (await board.boundingBox())!;
  const cell = box.width / 16;
  for (const row of [6, 7, 8, 9]) {
    await page.mouse.move(box.x + cell * 3.5, box.y + cell * (row + 0.5));
    await page.mouse.down();
    await page.mouse.move(box.x + cell * 12.5, box.y + cell * (row + 0.5), { steps: 10 });
    await page.mouse.up();
  }
  await expect(page.getByTestId("coin-create-submit")).toBeEnabled();
  await page.getByTestId("coin-create-submit").click();

  await expect(page.getByTestId("coin-studio")).toHaveAttribute("data-step", "develop");
  await expect(page.getByTestId("my-coin")).toContainText("Sternmünze");
  await expect(page.getByTestId("coin-launch")).toContainText("mindestens 20 Technik");
  await expect(page.getByTestId("coin-launch-submit")).toBeDisabled();

  await page.locator('[data-action="audit"]').getByRole("button", { name: "Starten" }).click();
  await expect(page.getByTestId("coin-action-running")).toContainText("Sicherheitsprüfung");
  // One task at a time.
  await expect(page.locator('[data-action="community"]').getByRole("button")).toBeDisabled();
});
