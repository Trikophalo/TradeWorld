import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * The Nexamon card renderer on the showcase (ADR-165): a card turns around on click and on the keyboard, a slab
 * shows its grade, and a booster pack can be opened and emptied by dragging the cards away or with the keyboard.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/ui");
});

async function openPack(page: Page): Promise<Locator> {
  const opening = page.getByTestId("nexamon-opening").getByTestId("pack-opening");
  await opening.scrollIntoViewIfNeeded();
  await expect(opening).toHaveAttribute("data-phase", "sealed");
  await opening.getByTestId("pack-open").click();
  await expect(opening).toHaveAttribute("data-phase", "stack");
  await expect(opening).toHaveAttribute("data-index", "0");
  return opening;
}

/** Drags the top card of the stack by the given offset and lets go. */
async function dragTop(page: Page, opening: Locator, dx: number, dy: number) {
  const top = opening.getByTestId("pack-top-card");
  // Let the previous card settle or leave before taking hold of the next.
  await page.waitForTimeout(350);
  const box = await top.boundingBox();
  if (!box) throw new Error("no top card");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
  await page.waitForTimeout(150);
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test("a card turns around on click and with the keyboard", async ({ page }) => {
  const card = page.getByTestId("nexamon-fronts").getByTestId("nexamon-card").first();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveAttribute("data-face", "front");
  await card.click();
  await expect(card).toHaveAttribute("data-face", "back");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("data-face", "front");
  await page.keyboard.press("Space");
  await expect(card).toHaveAttribute("data-face", "back");
  // All five rarities are on the page.
  for (const rarity of ["common", "rare", "ultra", "prisma", "legendary"])
    await expect(page.getByTestId("nexamon-fronts").locator(`[data-rarity="${rarity}"]`).first()).toBeAttached();
});

test("a slab shows the grade with its word and turns around", async ({ page }) => {
  const slab = page.getByTestId("nexamon-slabs").getByTestId("nexamon-slab").first();
  await slab.scrollIntoViewIfNeeded();
  await expect(slab.getByTestId("slab-grade")).toHaveText("10");
  await expect(slab.getByTestId("slab-grade-word")).toHaveText("Gem Mint");
  await expect(slab.locator("[data-grade]")).toHaveAttribute("data-grade", "10");
  await expect(slab.getByText("ASP · Nr. 00481516")).toBeAttached();
  await slab.click();
  await expect(slab).toHaveAttribute("data-face", "back");
});

test("a pack is opened and emptied by dragging the cards away", async ({ page }) => {
  const opening = await openPack(page);
  const log = page.getByTestId("nexamon-reveal-log");
  await expect(log).toHaveText("1: Glimmfuchs");

  // Peeking: a short pull shows the next card and lets the top one fall back.
  await dragTop(page, opening, 50, -10);
  await expect(opening).toHaveAttribute("data-index", "0");

  for (let i = 1; i <= 4; i++) {
    await dragTop(page, opening, i % 2 ? 190 : -190, -30);
    await expect(opening).toHaveAttribute("data-index", String(i));
  }
  // The fourth card is a rare one: it glows; the last one is legendary.
  await expect(log).toContainText("5: Aurodrak");
  await expect(opening.getByTestId("pack-glow").last()).toHaveAttribute("data-rarity", "legendary");
  await dragTop(page, opening, 0, -200);
  await expect(opening).toHaveAttribute("data-phase", "summary");
  await expect(opening.locator('[data-card="demo-077"]').first()).toBeAttached();
  await expect(log).toHaveText("1: Glimmfuchs · 2: Moosel · 3: Bolzer · 4: Tropfel · 5: Aurodrak");
});

test("a pack is emptied with the keyboard", async ({ page }) => {
  const opening = await openPack(page);
  const stack = opening.getByTestId("pack-stack");
  await stack.focus();
  const keys = ["ArrowRight", "ArrowLeft", "Space", "ArrowUp", "Enter"];
  for (const [i, key] of keys.entries()) {
    await expect(opening.getByTestId("pack-counter")).toHaveText(`Karte ${i + 1} von 5`);
    await page.keyboard.press(key);
    if (i < 4) await expect(opening).toHaveAttribute("data-index", String(i + 1));
  }
  await expect(opening).toHaveAttribute("data-phase", "summary");
  await expect(opening.getByText("Deine Karten")).toBeVisible();
});

test("with reduced motion the card cross-fades and the pack opens without the show", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  // A page that hydrates with reduced motion rebuilds itself once; wait for that before clicking.
  await page.waitForTimeout(1500);
  const card = page.getByTestId("nexamon-fronts").getByTestId("nexamon-card").nth(3);
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(card).toHaveAttribute("data-face", "back");
  // Nothing leans: the control carries no 3D transform.
  expect(await card.evaluate((el) => getComputedStyle(el).transform)).toBe("none");

  const opening = await openPack(page);
  await opening.getByTestId("pack-stack").focus();
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press("ArrowRight");
    await expect(opening).toHaveAttribute("data-index", String(i));
  }
  await page.keyboard.press("ArrowRight");
  await expect(opening).toHaveAttribute("data-phase", "summary");
});

test("the card section never scrolls sideways", async ({ page }) => {
  await page.getByTestId("nexamon-showcase").scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
