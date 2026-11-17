import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * The drag and see task games (ADR-186) on the showcase, with fixed puzzles: every game is played with the pointer
 * (drag on phone and desktop), some steps with tap-then-tap or the keyboard. The answer appears as a toast.
 */

async function center(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragTo(page: Page, from: Locator, x: number, y: number) {
  const a = await center(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + (x - a.x) / 3, a.y + (y - a.y) / 3, { steps: 4 });
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}

/** Drags onto a target; its position is read again just before the release (the showcase moves around). */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = await center(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 4, a.y + 10, { steps: 2 });
  const b = await center(to);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  const c = await center(to);
  await page.mouse.move(c.x, c.y, { steps: 2 });
  await page.mouse.up();
}

/** Scrolls a game into view and waits until the heavy showcase has hydrated. */
async function game(page: Page, id: string) {
  const g = page.getByTestId(`game-${id}`);
  await g.scrollIntoViewIfNeeded();
  // React has attached its handlers once the element carries a fiber
  await page.waitForFunction(
    (testId) => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
    },
    `game-${id}`,
    { timeout: 90_000 },
  );
  // late sections above still grow the page: wait until the game stands still
  let last = "";
  for (let calm = 0, i = 0; calm < 2 && i < 60; i++) {
    const top = await g.evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
    calm = String(top) === last ? calm + 1 : 0;
    last = String(top);
    await page.waitForTimeout(400);
  }
  await g.scrollIntoViewIfNeeded();
  return g;
}

const shot = (name: string) =>
  process.env.NEXA_SHOT_DIR
    ? `${process.env.NEXA_SHOT_DIR}/${name}-${test.info().project.name}.png`
    : test.info().outputPath(`${name}.png`);

// the showcase is heavy: hydration and every drag take a while, more so on the phone profile
test.describe.configure({ timeout: 240_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/ui");
  await page.waitForLoadState("networkidle");
});

test("tiles: slide two pieces into the gap by dragging; solved sends the moves", async ({ page }) => {
  const g = await game(page, "tiles");
  // board [0, 1, 2, 3, gap, 5, 6, 4, 7]: piece 5 up into the gap, then piece 8 left
  const tile4 = g.getByTestId("tile-4");
  await expect(async () => {
    const box = (await tile4.boundingBox())!;
    await dragTo(page, tile4, box.x + box.width / 2, box.y + box.height / 2 - box.height);
    await expect(tile4).toHaveAttribute("data-cell", "4", { timeout: 500 });
  }).toPass({ timeout: 30_000 });
  await expect(g.getByTestId("tiles-moves")).toHaveText("1 Zug");
  const tile7 = g.getByTestId("tile-7");
  const box = (await tile7.boundingBox())!;
  await dragTo(page, tile7, box.x + box.width / 2 - box.width, box.y + box.height / 2);
  await expect(page.getByText('{"moves":[7,8]}')).toBeVisible();
});

test("bins: drag crates onto the shelf of their colour; tap-then-tap works too (ADR-186)", async ({ page }) => {
  const bins = await game(page, "bins");
  // colours [0, 1, 2, 0, 1, 2]: by colour every crate onto its shelf
  const want = [0, 1, 2, 0, 1, 2];
  await expect(async () => {
    await drag(page, bins.getByTestId("bins-item-0"), bins.getByTestId("bins-shelf-0"));
    await expect(bins.getByTestId("bins-shelf-0").getByTestId("bins-item-0")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  for (const [k, b] of want.entries()) {
    if (k === 0 || k === 5) continue;
    await bins.scrollIntoViewIfNeeded();
    await drag(page, bins.getByTestId(`bins-item-${k}`), bins.getByTestId(`bins-shelf-${b}`));
    await expect(bins.getByTestId(`bins-shelf-${b}`).getByTestId(`bins-item-${k}`)).toBeVisible();
  }
  await bins.getByTestId("bins-item-5").click();
  await bins.getByRole("button", { name: "Regal Grün" }).click();
  await expect(bins.getByTestId("bins-shelf-2").getByTestId("bins-item-5")).toBeVisible();
  await bins.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByText('{"bins":[0,1,2,0,1,2]}')).toBeVisible();
});

test("align: drag every part onto the outline it fits (ADR-186)", async ({ page }) => {
  const align = await game(page, "align");
  // slots [3, 0, 5, 1, 4, 2], parts [0, 1, 2, 3]: stations 1, 3, 5, 0
  const at = [1, 3, 5, 0];
  for (const [k, s] of at.entries()) {
    await align.scrollIntoViewIfNeeded();
    await drag(page, align.getByTestId(`align-part-${k}`), align.getByTestId(`align-slot-${s}`));
    await expect(align.getByTestId(`align-slot-${s}`).getByTestId(`align-part-${k}`)).toBeVisible();
  }
  await align.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByText('{"at":[1,3,5,0]}')).toBeVisible();
});

test("untangle and pipes: drag a node until nothing crosses, turn two pipes (ADR-186)", async ({ page }) => {
  const g = await game(page, "untangle");
  await expect(g.getByTestId("untangle-count")).toHaveText("1 Kreuzung");
  const board = (await g.getByTestId("untangle-board").boundingBox())!;
  // node 2 from (3, 3) to (2, 0) on a 5 x 5 grid
  await dragTo(
    page,
    g.getByTestId("untangle-node-1"),
    board.x + (2.5 / 5) * board.width,
    board.y + (0.5 / 5) * board.height,
  );
  await expect(g.getByTestId("untangle-node-1")).toHaveAttribute("data-x", "2");
  await expect(g.getByTestId("untangle-count")).toHaveText("Keine Kreuzung");
  // keyboard: node 4 one row down
  await g.getByTestId("untangle-node-3").focus();
  await page.keyboard.press("ArrowDown");
  await expect(g.getByTestId("untangle-node-3")).toHaveAttribute("data-y", "4");
  await page.screenshot({ path: shot("task-games-untangle"), fullPage: false });
  await g.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByText('{"points":[[0,0],[2,0],[3,0],[0,4]]}')).toBeVisible();

  const pipes = await game(page, "pipes");
  await expect(pipes.getByTestId("pipes-status")).toHaveText("Noch nicht dicht");
  await pipes.getByTestId("pipe-4").click();
  await pipes.getByTestId("pipe-6").click();
  await expect(pipes.getByTestId("pipes-status")).toHaveText("Leitung steht!");
  await page.screenshot({ path: shot("task-games-pipes"), fullPage: false });
  await pipes.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByText('{"turns":[0,1,2,3,1,1,1,1,1,0,2,3,3,2,1,0]}')).toBeVisible();
});

test("odd and sizes: spot the faulty goods, drag the parcels from small to big (ADR-186)", async ({ page }) => {
  const odd = await game(page, "odd");
  await expect(async () => {
    if (await odd.getByText("Runde 1 von 2").isVisible()) await odd.getByTestId("odd-cell").nth(5).click();
    await expect(odd.getByText("Runde 2 von 2")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await odd.getByTestId("odd-cell").nth(10).click();
  await expect(page.getByText('{"choices":[5,10]}')).toBeVisible();

  const sizes = await game(page, "sizes");
  // sizes [70, 40, 100, 55, 85, 30]: from small to big the parcels 5, 1, 3, 0, 4, 2
  await expect(async () => {
    const done = sizes.getByTestId("sizes-pos-5").getByTestId("parcel-0");
    if ((await done.count()) === 0) await drag(page, sizes.getByTestId("parcel-0"), sizes.getByTestId("sizes-pos-5"));
    await expect(done).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await sizes.getByTestId("parcel-2").click();
  await sizes.getByTestId("parcel-3").click();
  await expect(sizes.getByTestId("sizes-pos-2").getByTestId("parcel-3")).toBeVisible();
  await drag(page, sizes.getByTestId("parcel-2"), sizes.getByTestId("sizes-pos-5"));
  await expect(sizes.getByTestId("sizes-pos-5").getByTestId("parcel-2")).toBeVisible();
  await page.screenshot({ path: shot("task-games-sizes"), fullPage: false });
  await sizes.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByText('{"order":[5,1,3,0,4,2]}')).toBeVisible();
});

test("rebuild: put the goods back from memory (ADR-186)", async ({ page }) => {
  const g = await game(page, "rebuild");
  // layout: good 0 on cell 0, 1 on 4, 2 on 6, 3 on 8; shown for three seconds
  await expect(g.getByText("Stell alles wieder an seinen Platz", { exact: false })).toBeVisible({ timeout: 60_000 });
  for (const [item, cell] of [
    [0, 0],
    [1, 4],
    [3, 8],
  ] as const) {
    await drag(page, g.getByTestId(`rebuild-item-${item}`), g.getByTestId(`rebuild-cell-${cell}`));
    await expect(g.getByTestId(`rebuild-cell-${cell}`).getByTestId(`rebuild-item-${item}`)).toBeVisible();
  }
  await g.getByTestId("rebuild-item-2").click();
  await g.getByTestId("rebuild-cell-6").getByRole("button").click();
  // keyboard: the done button with Enter
  await g.getByRole("button", { name: "Fertig" }).press("Enter");
  await expect(page.getByText('{"layout":[0,-1,-1,-1,1,-1,2,-1,3]}')).toBeVisible();
});

test("conveyor: drag the goods off the belt into their bins in time (ADR-186)", async ({ page }) => {
  const belt = await game(page, "conveyor");
  // goods [0, 1, 2, 0], one every 6 s, a minute on the belt (slow on purpose, the showcase is heavy):
  // drag the first three, tap the bin for the last
  for (const k of [0, 1, 2]) {
    const item = belt.getByTestId(`conveyor-item-${k}`);
    await expect(item).toBeVisible({ timeout: 30_000 });
    await drag(page, item, belt.getByTestId(`conveyor-bin-${k}`));
    await expect(item).toHaveCount(0);
  }
  await expect(belt.getByTestId("conveyor-item-3")).toBeVisible({ timeout: 30_000 });
  await belt.getByTestId("conveyor-bin-0").getByRole("button").click();
  await expect(page.getByText('{"bins":[0,1,2,0]}')).toBeVisible();
});
