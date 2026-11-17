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

test("the Black Label slab has a black label with a 10, above the gold 10", async ({ page }) => {
  const block = page.getByTestId("nexamon-black-label");
  await block.scrollIntoViewIfNeeded();
  const slab = block.getByTestId("nexamon-slab").first();
  await expect(slab.getByTestId("slab-grade")).toHaveText("10");
  await expect(slab.getByTestId("slab-grade-word")).toHaveText("Black Label");
  await expect(slab.locator("[data-grade]")).toHaveAttribute("data-grade", "11");
  await expect(slab.locator("[data-grade]")).toHaveAttribute("data-label", "black");
  await expect(block.getByTestId("nexamon-slab").nth(1).locator("[data-grade]")).toHaveAttribute("data-label", "gold");
  await expect(block.locator("[data-black-label]").first()).toHaveText("ASP 10 · Black Label");
  if (process.env.NEXA_SHOTS) await page.waitForTimeout(1200);
  if (process.env.NEXA_SHOTS)
    await block.screenshot({ path: `${process.env.NEXA_SHOTS}/black-label-slab-${test.info().project.name}.png` });
});

test("a package from ASP is torn open and the grade is revealed slowly", async ({ page }) => {
  test.setTimeout(60_000);
  const reveal = page.getByTestId("reveal-demo-10").getByTestId("grade-reveal");
  await reveal.scrollIntoViewIfNeeded();
  await expect(reveal).toHaveAttribute("data-phase", "sealed");
  if (process.env.NEXA_SHOTS) await page.waitForTimeout(1200);
  if (process.env.NEXA_SHOTS)
    await reveal.screenshot({ path: `${process.env.NEXA_SHOTS}/grading-pack-sealed-${test.info().project.name}.png` });
  // Torn by hand, like a booster: press on the upper seal and pull across it.
  const pack = reveal.getByTestId("grade-tear");
  const box = (await pack.boundingBox())!;
  const y = box.y + box.height * 0.1;
  await page.mouse.move(box.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 4 });
  await expect(pack).toHaveAttribute("data-ripping", "true");
  await page.mouse.move(box.x + box.width * 0.95, y, { steps: 8 });
  await page.mouse.up();
  // The slab rises with its label covered, then the grade counts up; nothing is shown at once.
  await expect(reveal).toHaveAttribute("data-phase", "rising");
  await expect(reveal.getByTestId("grade-slab")).toHaveAttribute("data-covered", "true");
  await expect(reveal.getByTestId("grade-result")).toHaveCount(0);
  await expect(reveal).toHaveAttribute("data-phase", "counting");
  await expect(reveal.getByTestId("grade-count")).toHaveText(/^[1-6]$/);
  await expect(reveal.getByTestId("grade-slab")).toHaveAttribute("data-covered", "true");
  if (process.env.NEXA_SHOTS)
    await reveal.screenshot({
      path: `${process.env.NEXA_SHOTS}/grading-reveal-counting-${test.info().project.name}.png`,
    });
  await expect(reveal.getByTestId("grade-count")).toHaveText("9", { timeout: 10_000 });
  await expect(reveal).toHaveAttribute("data-phase", "result", { timeout: 10_000 });
  await expect(reveal).toHaveAttribute("data-tier", "ten");
  await expect(reveal.getByTestId("grade-slab")).toHaveAttribute("data-covered", "false");
  await expect(reveal.getByTestId("grade-result")).toContainText("ASP 10 · Gem Mint");
  await expect(reveal.getByTestId("grade-value")).toContainText("€");
});

test("the reveal can be skipped, and the Black Label gets the biggest moment", async ({ page }) => {
  const reveal = page.getByTestId("reveal-demo-11").getByTestId("grade-reveal");
  await reveal.scrollIntoViewIfNeeded();
  await reveal.getByTestId("grade-open").click();
  await expect(reveal).toHaveAttribute("data-phase", /tearing|rising/);
  await reveal.getByTestId("grade-skip").click();
  await expect(reveal).toHaveAttribute("data-phase", "result");
  await expect(reveal).toHaveAttribute("data-tier", "black");
  await expect(reveal.getByTestId("black-label-stamp")).toBeVisible();
  await expect(reveal.getByTestId("grade-result")).toContainText("ASP 10 · Black Label");
  await expect(reveal.getByTestId("grade-result")).toContainText("×10");
  await page.waitForTimeout(900);
  if (process.env.NEXA_SHOTS)
    await reveal.screenshot({
      path: `${process.env.NEXA_SHOTS}/grading-reveal-black-label-${test.info().project.name}.png`,
    });
  // A low grade ends quietly.
  const low = page.getByTestId("reveal-demo-6").getByTestId("grade-reveal");
  await low.getByTestId("grade-open").click();
  await low.getByTestId("grade-skip").click();
  await expect(low).toHaveAttribute("data-tier", "low");
});

test("with reduced motion the package opens straight to the grade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  // A page that hydrates with reduced motion rebuilds itself once; wait for that before clicking.
  await page.waitForTimeout(1500);
  const reveal = page.getByTestId("reveal-demo-9").getByTestId("grade-reveal");
  await reveal.scrollIntoViewIfNeeded();
  await reveal.getByTestId("grade-open").click();
  await expect(reveal).toHaveAttribute("data-phase", "result");
  await expect(reveal).toHaveAttribute("data-tier", "good");
  await expect(reveal.getByTestId("grade-result")).toContainText("ASP 9");
});

test("a tooltip shows on hover and on keyboard focus", async ({ page }) => {
  const trigger = page.getByTestId("showcase-tip-trigger");
  await trigger.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // Scrolling closes a tooltip, and a page that still hydrates loses the focus: try until it stays.
  await expect(async () => {
    await page.waitForTimeout(400);
    await trigger.blur();
    await trigger.focus();
    await expect(page.getByTestId("showcase-tip")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
});

test("a pack is opened and emptied by dragging the cards away", async ({ page }) => {
  // six drags with pauses on a big /dev/ui page: close to 30 s on a busy machine
  test.setTimeout(60_000);
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

test("a slab with a half grade shows 9,5", async ({ page }) => {
  const slab = page.getByTestId("nexamon-slabs").getByTestId("nexamon-slab").nth(1);
  await slab.scrollIntoViewIfNeeded();
  await expect(slab.getByTestId("slab-grade")).toHaveText("9,5");
  await expect(slab.getByTestId("slab-grade-word")).toHaveText("Mint+");
  await expect(slab.locator("[data-grade]")).toHaveAttribute("data-grade", "9.5");
});

test("a click turns the top card of an opened pack around, a drag still throws it", async ({ page }) => {
  const opening = await openPack(page);
  const tilt = opening.getByTestId("pack-top-card-tilt");
  await expect(tilt).toHaveAttribute("data-face", "front");
  await page.waitForTimeout(350);
  await opening.getByTestId("pack-top-card").click();
  await expect(tilt).toHaveAttribute("data-face", "back");
  await expect(opening).toHaveAttribute("data-index", "0");
  await opening.getByTestId("pack-top-card").click();
  await expect(tilt).toHaveAttribute("data-face", "front");
  // F on the focused stack turns it too
  await opening.getByTestId("pack-stack").focus();
  await page.keyboard.press("f");
  await expect(tilt).toHaveAttribute("data-face", "back");
  // a turned card is still thrown away by a drag
  await dragTop(page, opening, 420, 0);
  await expect(opening).toHaveAttribute("data-index", "1");
  for (let i = 1; i < 10 && (await opening.getAttribute("data-phase")) !== "summary"; i++) {
    await opening.getByTestId("pack-stack").focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);
  }
  await expect(opening).toHaveAttribute("data-phase", "summary");
  // the cards of the summary turn around on click as well
  const card = opening.locator('[data-testid^="pack-summary-card"]:visible').first();
  await expect(card).toHaveAttribute("data-face", "front");
  await card.click();
  await expect(card).toHaveAttribute("data-face", "back");
});
