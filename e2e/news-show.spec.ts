import { expect, test } from "@playwright/test";

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

test("the live news show: countdown, live segments with effects, chat with emojis", async ({ page }) => {
  await page.goto("/news");
  const show = page.getByTestId("news-show");
  await expect(show).toBeVisible();
  const tv = show.locator("[data-show-mode]");

  await page.getByTestId("demo-start-show").click();
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
