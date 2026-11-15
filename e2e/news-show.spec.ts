import { expect, test, type Page } from "@playwright/test";

/*
 * NEXA Nachrichten (ADR-150) in demo mode: the TV counts down to the full hour; a show airs live with the chat
 * beside it; afterwards it can be watched again.
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
        nickname: "Zuschauerin",
        cashCents: 2_000_000,
        xpTotal: 7_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
});

/** In the first minutes of an hour the demo airs this hour's show by itself; otherwise the demo button starts one. */
async function startShow(page: Page) {
  await expect(page.getByTestId("news-show")).toBeVisible();
  const button = page.getByTestId("demo-start-show");
  if (await button.isVisible()) await button.click();
}

test("the live news show: countdown, live segments with effects, chat with emojis", async ({ page }) => {
  await page.goto("/news");
  const show = page.getByTestId("news-show");
  await expect(show).toBeVisible();
  const tv = show.locator("[data-show-mode]");

  await startShow(page);
  // It goes live: the intro, then the anchor reads the first segment.
  await expect(tv).toHaveAttribute("data-show-live", "true", { timeout: 20_000 });
  await expect(tv).toHaveAttribute("data-show-mode", "live", { timeout: 25_000 });
  await expect(show.getByTestId("news-studio")).toBeVisible();

  // The chat: the audience writes, and so do I, with an emoji from the bar.
  const chat = page.getByTestId("news-show-chat");
  await expect(chat.getByText(/schauen zu|schaut zu/)).toBeVisible();
  const height = (await chat.boundingBox())!.height;
  await chat.getByTestId("news-show-input").fill("stark ");
  await chat.getByRole("button", { name: "💀" }).click();
  await chat.getByTestId("news-show-send").click();
  await expect(chat.getByText("stark 💀")).toBeVisible();
  // The chat keeps its size however much is written: it scrolls inside and stays at the newest line.
  for (const line of ["eins", "zwei", "drei", "vier", "fünf", "sechs"]) {
    await chat.getByTestId("news-show-input").fill(line);
    await chat.getByTestId("news-show-send").click();
    await expect(chat.getByText(line, { exact: true })).toBeVisible();
  }
  expect(Math.abs((await chat.boundingBox())!.height - height)).toBeLessThanOrEqual(1);
  await expect(chat.getByText("sechs", { exact: true })).toBeInViewport();

  // What was said is in the feed's world now: no horizontal overflow on the page.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the studio audience: my figure, speech bubbles, and me on the TV in a story about me", async ({ page }) => {
  await page.goto("/news");
  await startShow(page);
  const show = page.getByTestId("news-show");
  const tv = show.locator("[data-show-mode]");
  await expect(tv).toHaveAttribute("data-show-mode", "live", { timeout: 30_000 });

  // I stand in the audience under the TV, marked as me
  const audience = show.getByTestId("news-audience");
  await expect(audience).toBeVisible();
  const me = audience.locator('[data-testid="audience-figure"][data-me="true"]');
  await expect(me).toHaveAttribute("data-nickname", "Zuschauerin");

  // The first story is gossip about me: my figure on the topic screen, with a caption
  const figure = show.getByTestId("news-figure");
  await expect(figure).toHaveAttribute("data-nickname", "Zuschauerin", { timeout: 15_000 });
  await expect(figure).toHaveAttribute("data-frame", "gossip");

  // What I write pops up above my figure as a speech bubble
  await page.getByTestId("news-show-input").fill("Winke winke 👋");
  await page.getByTestId("news-show-send").click();
  const bubble = audience.locator('[data-testid="audience-bubble"][data-nickname="Zuschauerin"]');
  await expect(bubble).toContainText("Winke winke 👋");

  // The made-up viewers come into the studio as they write
  await expect(audience.locator('[data-testid="audience-figure"][data-bot="true"]').first()).toBeVisible({
    timeout: 30_000,
  });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
