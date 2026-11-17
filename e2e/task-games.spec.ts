import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * The hands-on task games (ADR-144) on the showcase, with fixed puzzles: drag cards into boxes, a piece into its gap
 * and draw a route, with the pointer on phone and desktop. The answer appears as a toast.
 */

async function center(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: Locator, to: Locator) {
  const a = await center(from);
  const b = await center(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/ui");
  // the showcase is heavy: let it hydrate before dragging
  await page.waitForLoadState("networkidle");
});

test("match: drag every card into the box its rule names (ADR-144)", async ({ page }) => {
  const game = page.getByTestId("game-match");
  await game.scrollIntoViewIfNeeded();
  // items [4, 0, 7, 2, 3, 8] of three groups of three: boxes 1, 0, 2, 0, 1, 2
  const want = [1, 0, 2, 0, 1, 2];
  for (const [k, b] of want.entries()) {
    await game.scrollIntoViewIfNeeded();
    await drag(page, game.getByTestId(`match-card-${k}`), game.getByTestId(`match-box-${b}`));
    await expect(game.getByTestId(`match-box-${b}`).getByTestId(`match-card-${k}`)).toBeVisible();
  }
  await expect(game.getByText("Noch 0 Karten")).toBeVisible();
  // tap fallback: card, then box header moves it back and forth
  await game.getByTestId("match-card-0").click();
  await game.getByRole("button", { name: "Finanzen" }).click();
  await expect(game.getByTestId("match-box-0").getByTestId("match-card-0")).toBeVisible();
  await game.getByTestId("match-card-0").click();
  await game.getByRole("button", { name: "Recht" }).click();
  await game.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByText('{"boxes":[1,0,2,0,1,2]}')).toBeVisible();
});

test("slider and path: drag the piece into its gap, draw the shortest route (ADR-144)", async ({ page }) => {
  const slider = page.getByTestId("game-slider");
  await slider.scrollIntoViewIfNeeded();
  const piece = slider.getByRole("slider", { name: "Karton A" });
  const rail = await slider.getByTestId("slider-0").boundingBox();
  const start = await center(piece);
  // the gap of Karton A sits at 34 % of the rail (rail = track − piece)
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + rail!.width * 0.34, start.y, { steps: 8 });
  await page.mouse.up();
  const value = Number(await slider.getByTestId("slider-0").getAttribute("data-value"));
  expect(Math.abs(value - 34)).toBeLessThanOrEqual(1);
  // keyboard: the other two pieces with the arrow keys
  await slider.getByRole("slider", { name: "Karton B" }).focus();
  for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowRight");
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
  await expect(slider.getByTestId("slider-1")).toHaveAttribute("data-value", "72");

  const path = page.getByTestId("game-path");
  await path.scrollIntoViewIfNeeded();
  const route = [10, 15, 16, 17, 12, 7, 2, 3, 4, 9];
  const first = await center(path.getByTestId(`path-cell-${route[0]}`));
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const cell of route.slice(1)) {
    const p = await center(path.getByTestId(`path-cell-${cell}`));
    await page.mouse.move(p.x, p.y, { steps: 3 });
  }
  await page.mouse.up();
  await expect(path.getByText("9 Schritte")).toBeVisible();
  await path.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByText(`{"path":[${route.join(",")}]}`)).toBeVisible();
});

test("rotate and sort: turn the dial by dragging, drop the card on its stack (ADR-144)", async ({ page }) => {
  const rotate = page.getByTestId("game-rotate");
  await rotate.scrollIntoViewIfNeeded();
  // dial 0 starts at 3 (135°) and has its mark at 0: drag to the top edge
  const dial = rotate.getByTestId("dial-0");
  const box = (await dial.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + 4, { steps: 6 });
  await page.mouse.up();
  await expect(dial).toHaveAttribute("data-value", "0");
  await rotate.getByRole("button", { name: "Büro nach links drehen" }).click();
  await expect(rotate.getByTestId("dial-1")).toHaveAttribute("data-value", "5");

  const sort = page.getByTestId("game-sort");
  await sort.scrollIntoViewIfNeeded();
  await expect(sort.getByText("Noch 8")).toBeVisible();
  await drag(page, sort.getByTestId("sort-card"), sort.getByRole("button", { name: /Offen/ }));
  await expect(sort.getByText("Noch 7")).toBeVisible();
});

test("memory and haggle: find the pairs, negotiate three rounds (ADR-173)", async ({ page }) => {
  const memory = page.getByTestId("game-memory");
  await memory.scrollIntoViewIfNeeded();
  // cards [2, 0, 3, 1, 0, 2, 1, 3]: the pairs are 0/5, 1/4, 3/6, 2/7
  const cards = memory.getByTestId("memory-card");
  // the showcase is heavy: wait until it reacts (hydrated) before playing
  await expect(async () => {
    await cards.nth(0).click();
    await expect(cards.nth(0)).not.toHaveAccessibleName(/verdeckt/, { timeout: 500 });
  }).toPass({ timeout: 30_000 });
  for (const i of [5, 1, 4, 3, 6, 2]) {
    await cards.nth(i).click();
    await expect(cards.nth(i)).not.toHaveAccessibleName(/verdeckt/);
  }
  // the last card completes the game: the answer goes out and the sample starts over
  await cards.nth(7).click();
  await expect(page.getByText(/"misses":0/)).toBeVisible();

  const haggle = page.getByTestId("game-haggle");
  await haggle.scrollIntoViewIfNeeded();
  // rounds [[1, 0, 2], [2, 1, 0], [0, 2, 1]]: the best reply sits at 1, 2 and 0
  for (const pos of [1, 2, 0]) await haggle.getByTestId("haggle-reply").nth(pos).click();
  await expect(page.getByText('{"choices":[1,2,0]}')).toBeVisible();
  await page.screenshot({
    path: process.env.NEXA_SHOT_DIR
      ? `${process.env.NEXA_SHOT_DIR}/games-${test.info().project.name}.png`
      : test.info().outputPath("games.png"),
    fullPage: false,
  });
});
