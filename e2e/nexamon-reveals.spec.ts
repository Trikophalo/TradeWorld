import { expect, test, type Page } from "@playwright/test";

/*
 * ADR-204 in demo mode: the new "Boni" tab, the result screen of ten packs at once, the big reveal of the last two
 * slots (RareReveal on /dev/ui) and the staged ASP reveal of a 10 and a Black Label. Screenshots go to
 * NEXA_SHOT_DIR when set (light and dark, at the viewport of the project: 390 px phone, 1440 px desktop).
 */
const SHOTS = process.env.NEXA_SHOT_DIR;

type Theme = "dark" | "light";

async function preparePlayer(page: Page, theme: Theme, grade: number | null = null) {
  await page.addInitScript(
    ([mode, g]) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem("nexa-settings", JSON.stringify({ state: { theme: mode }, version: 1 }));
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({ demo: { status: "done", step: 0, seenTours: ["visit_nexamon"] } }),
      );
      const now = Date.now();
      const copy = (id: string, cardKey: string, grade: number | null, gradedAt: number | null) => ({
        id,
        cardKey,
        serial: 3,
        condition: "mint",
        grade,
        gradingUntil: null,
        gradedAt,
        acquiredAt: now - 86_400_000,
        listing: null,
      });
      const copies =
        g === null
          ? [
              copy("e2e-1", "me-072", 9.5, now - 86_400_000),
              copy("e2e-2", "me-001", null, null),
              copy("e2e-3", "me-002", null, null),
              copy("e2e-4", "sa-003", null, null),
            ]
          : [copy("e2e-g", "me-064", g, now - 1_000)];
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({
          nickname: "Sammlerin",
          tag: "K7Q2",
          cashCents: 500_000_000,
          xpTotal: 90_000,
          tutorialCompleted: true,
          curveVersion: 2,
          nexamon: {
            cards: {},
            copies,
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
    [theme, grade] as const,
  );
}

async function shot(page: Page, name: string, fullPage = false) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()?.width}.png`, fullPage });
}

async function noSideways(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const theme of ["dark", "light"] as const) {
  test(`the Boni tab: rings, what is next, folded sets (${theme})`, async ({ page }) => {
    await preparePlayer(page, theme);
    await page.goto("/nexamon?tab=bonuses");
    const view = page.getByTestId("nexamon-bonuses");
    await expect(view).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("bonus-total-vault")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("bonus-next")).toBeVisible();
    // the set with progress is open, the others folded
    await expect(page.getByTestId("bonus-set-mystic_energy")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("bonus-set-cosmic_winds")).toHaveAttribute("data-open", "false");
    await page.getByTestId("bonus-set-toggle-cosmic_winds").click();
    await expect(page.getByTestId("bonus-set-cosmic_winds")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("bonus-set-mystic_energy")).toHaveAttribute("data-open", "false");
    await page.getByTestId("bonus-set-toggle-mystic_energy").click();
    // the rule and the missing bonus cards are one tap away
    await page.getByTestId("bonus-rule-toggle").click();
    await expect(view).toContainText("Black Label das Doppelte");
    await page.getByTestId("bonus-cards-toggle").click();
    await expect(page.getByTestId("bonus-cards-missing")).toBeVisible();
    await noSideways(page);
    await page.getByTestId("bonus-rule-toggle").click();
    await page.getByTestId("bonus-cards-toggle").click();
    await shot(page, `bonuses-${theme}`, true);
  });
}

test("ten packs at once: the verdict stays on top, best hits, a sorted grid with a filter", async ({ page }) => {
  test.setTimeout(60_000);
  await preparePlayer(page, "dark");
  await page.goto("/nexamon?tab=shop");
  await page.getByTestId("buy-mystic_energy").click();
  for (let i = 0; i < 9; i++) await page.getByTestId("pack-count-more").click();
  await expect(page.getByTestId("pack-count-value")).toHaveText("10");
  await page.getByTestId("confirm-buy").click();
  await expect(page.getByTestId("pack-series")).toHaveText("Pack 1 von 10");
  await page.getByTestId("pack-skip-all").click();
  const result = page.getByTestId("pack-result");
  await expect(result).toHaveAttribute("data-multi", "true");
  await expect(page.getByTestId("pack-all-title")).toContainText("10 Packs");
  await expect(page.getByTestId("multi-profit")).toContainText("€");
  await expect(result.getByTestId("pull-row")).toHaveCount(50);
  // sorted by value, best first
  const values = await result
    .getByTestId("pull-row")
    .evaluateAll((tiles) =>
      tiles.map((t) => Number((t.textContent ?? "").replace(/[^\d,]/g, "").replace(",", ".")) || 0),
    );
  expect([...values].sort((a, b) => b - a)).toEqual(values);
  await expect(page.getByTestId("instant-sell")).toBeVisible();
  await shot(page, "multi-summary");
  // the verdict sticks while the grid scrolls
  await page.getByTestId("multi-per-pack-toggle").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("multi-verdict")).toBeInViewport();
  await page.getByTestId("multi-per-pack-toggle").click();
  await expect(page.getByTestId("multi-pack-row")).toHaveCount(10);
  await shot(page, "multi-summary-scrolled");
  // filter: only commons
  await page.getByTestId("multi-filter-common").click();
  await expect(result.locator('[data-testid="pull-row"]:not([data-rarity="common"])')).toHaveCount(0);
  await page.getByTestId("multi-filter-all").click();
  await expect(result.getByTestId("pull-row")).toHaveCount(50);
  await noSideways(page);
});

test("the big reveal charges up, turns, and shows banner and value", async ({ page }) => {
  await page.goto("/dev/ui");
  const block = page.getByTestId("nexamon-rare-reveal");
  await block.scrollIntoViewIfNeeded();
  const reveal = block.getByTestId("rare-reveal");
  await expect(reveal).toHaveAttribute("data-phase", "veiled");
  // the big /dev/ui page may still hydrate: click until the button reacts
  await expect(async () => {
    await block.getByTestId("rare-reveal-play").click();
    await expect(reveal).not.toHaveAttribute("data-phase", "veiled", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(reveal).toHaveAttribute("data-phase", "revealed", { timeout: 5_000 });
  await expect(reveal.getByTestId("rare-reveal-banner")).toBeVisible();
  await page.waitForTimeout(900);
  await shot(page, "rare-reveal");
  await expect(reveal.getByTestId("rare-reveal-value")).toContainText("€");
});

test("with reduced motion the big reveal turns at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dev/ui");
  await page.waitForTimeout(1500);
  const block = page.getByTestId("nexamon-rare-reveal");
  await block.scrollIntoViewIfNeeded();
  const reveal = block.getByTestId("rare-reveal");
  await expect(async () => {
    await block.getByTestId("rare-reveal-play").click();
    await expect(reveal).toHaveAttribute("data-phase", "revealed", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(reveal.getByTestId("rare-reveal-value")).toContainText("€");
});

for (const [grade, tier] of [
  [10, "ten"],
  [11, "black"],
] as const) {
  test(`an ASP package with a ${tier === "black" ? "Black Label" : "10"} builds up to its moment`, async ({ page }) => {
    test.setTimeout(60_000);
    await preparePlayer(page, "dark", grade);
    await page.goto("/nexamon?tab=grading");
    const waiting = page.getByTestId("slab-reveal");
    await expect(waiting).toHaveCount(1);
    await waiting.getByTestId("reveal-button").click();
    const show = page.getByTestId("grading-overlay").getByTestId("grade-reveal");
    await expect(show).toHaveAttribute("data-phase", "sealed");
    await expect(show.getByTestId("grade-skip")).toBeVisible();
    await show.getByTestId("grade-open").click();
    await expect(show).toHaveAttribute("data-phase", "rising");
    // face down while it rises, then the count with the scanner
    await expect(show.getByTestId("nexamon-slab")).toHaveAttribute("data-face", "back");
    await expect(show).toHaveAttribute("data-phase", "counting", { timeout: 5_000 });
    await expect(show.getByTestId("grade-scan")).toBeAttached();
    await expect(show).toHaveAttribute("data-holding", "true", { timeout: 15_000 });
    if (tier === "black") await expect(page.getByTestId("grade-blackout")).toBeAttached();
    await shot(page, `grade-${tier}-hold`);
    await expect(show).toHaveAttribute("data-phase", "result", { timeout: 8_000 });
    await expect(show).toHaveAttribute("data-tier", tier);
    if (tier === "black") await expect(show.getByTestId("black-label-stamp")).toBeVisible();
    await page.waitForTimeout(700);
    await shot(page, `grade-${tier}-result`);
    await expect(show.getByTestId("grade-value")).toHaveAttribute("data-done", "true", { timeout: 5_000 });
    await expect(show.getByTestId("grade-value-row")).toContainText("Wert ×");
    await noSideways(page);
  });
}
