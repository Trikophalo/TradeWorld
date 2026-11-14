import { expect, test } from "@playwright/test";
import { PATCH_NOTES } from "../src/config/patch-notes.generated";

/*
 * Patch notes from CHANGELOG.md in the top bar (ADR-137): blue dot while something is new, sheet on phones, window on
 * desktop, opening clears the dot.
 */
const SEEN_KEY = "nexa-patch-notes-seen";
const [newest] = PATCH_NOTES;
const [, secondEntry] = newest?.entries ?? [];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem("nexa-tutorial", JSON.stringify({ demo: { status: "done", step: 0 } }));
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({ nickname: "Patchfuchs", tag: "P4TC", xpTotal: 7_000, tutorialCompleted: true, curveVersion: 2 }),
    );
  });
});

test("the patch notes open from the top bar and clear the blue dot", async ({ page }) => {
  await page.goto("/");
  const button = page.getByTestId("patch-notes-button");
  await expect(button).toBeVisible();
  await expect(page.getByTestId("patch-notes-dot")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow with the patch notes button").toBeLessThanOrEqual(0);
  // The top bar clips instead of scrolling: the avatar at its end must still be on screen.
  const profile = await page.locator('[data-tour="nav-profile"]').boundingBox();
  expect(profile!.x + profile!.width, "profile button pushed off screen").toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );

  await button.click();
  const panel = page.getByRole("dialog", { name: "Patchnotes" });
  await expect(panel).toBeVisible();
  const list = panel.getByTestId("patch-notes-list");
  // The newest release is open, its newest entry on top; older releases start closed.
  await expect(list.getByRole("button", { name: newest!.title })).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByText(newest!.entries[0]!.title ?? newest!.entries[0]!.text).first()).toBeVisible();
  const oldest = PATCH_NOTES[PATCH_NOTES.length - 1]!;
  const oldestTrigger = list.getByRole("button", { name: oldest.title });
  await expect(oldestTrigger).toHaveAttribute("aria-expanded", "false");
  await oldestTrigger.click();
  await expect(oldestTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByText(oldest.entries[0]!.text.slice(0, 40)).first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByTestId("patch-notes-dot")).toHaveCount(0);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), SEEN_KEY)).toBe(newest!.entries[0]!.id);

  await page.reload();
  await expect(page.getByTestId("patch-notes-button")).toBeVisible();
  await expect(page.getByTestId("patch-notes-dot")).toHaveCount(0);
});

test("entries since the last visit are marked as new", async ({ page }) => {
  test.skip(!secondEntry, "needs at least two entries in the newest release");
  await page.addInitScript(([key, id]) => window.localStorage.setItem(key!, id!), [SEEN_KEY, secondEntry!.id]);
  await page.goto("/");
  await expect(page.getByTestId("patch-notes-dot")).toBeVisible();
  await page.getByTestId("patch-notes-button").click();
  const panel = page.getByRole("dialog", { name: "Patchnotes" });
  await expect(panel.getByText("1 neu")).toBeVisible();
  await expect(panel.locator("li[data-fresh]")).toHaveCount(1);
});
