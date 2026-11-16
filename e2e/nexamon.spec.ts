import { expect, test, type Page } from "@playwright/test";

/*
 * The Nexamon pages in demo mode (ADR-165): shop and pack opening, binder, card page with listing and grading,
 * card market. A level 10+ player with plenty of cash; the locked state for a beginner.
 */
async function preparePlayer(page: Page, xpTotal = 90_000, cashCents = 50_000_000) {
  await page.addInitScript(
    ([xp, cash]) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({
          demo: {
            status: "done",
            step: 0,
            seenTours: [
              "first_job",
              "limit_orders",
              "bonds",
              "found_garage",
              "visit_skill_map",
              "artworks",
              "visit_artworks",
              "property",
              "visit_property",
              "visit_nexamon",
            ],
          },
        }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({
          nickname: "Sammlerin",
          cashCents: cash,
          xpTotal: xp,
          tutorialCompleted: true,
          curveVersion: 2,
        }),
      );
    },
    [xpTotal, cashCents] as const,
  );
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Opens the popup of the cheapest pack, buys it there and leaves the pack sealed on the table. */
async function buyPack(page: Page) {
  await page.getByTestId("buy-mystic_energy").click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", "preview");
  await page.getByTestId("confirm-buy").click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", "opening");
}

/** Tears the pack open: press on the upper seal and pull across it. */
async function tearPack(page: Page) {
  const pack = page.getByTestId("pack-tear");
  await pack.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = (await pack.boundingBox())!;
  const y = box.y + box.height * 0.1;
  await page.mouse.move(box.x + 6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 4 });
  await expect(pack).toHaveAttribute("data-ripping", "true");
  await page.mouse.move(box.x + box.width * 0.95, y, { steps: 8 });
  await page.mouse.up();
}

/** Buys a pack and jumps to the summary. Returns the keys of the pulled cards. */
async function buyAndSkip(page: Page): Promise<string[]> {
  await buyPack(page);
  await page.getByTestId("pack-skip").click();
  await expect(page.getByTestId("pull-row")).toHaveCount(5);
  const keys = await page
    .getByTestId("pull-row")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-card") ?? ""));
  await page.getByTestId("pack-close").click();
  await expect(page.getByTestId("pack-overlay")).toHaveCount(0);
  return keys;
}

test("a beginner sees what is coming instead of the shop", async ({ page }) => {
  await preparePlayer(page, 0);
  await page.goto("/nexamon");
  await expect(page.getByTestId("nexamon-locked")).toBeVisible();
  await expect(page.getByTestId("nexamon-shop")).toHaveCount(0);
  await expectNoSidewaysScroll(page);
});

test("buy a pack, open it card by card, and find the cards in the collection", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon");
  await expect(page.getByTestId("nexamon-odds")).toContainText("0,11 %");
  await expect(page.getByTestId("progress-mystic_energy")).toHaveText("0 von 77");
  await expectNoSidewaysScroll(page);

  // The popup first: price, balance, and further down every card of the set with its chance. Nothing is paid yet.
  await page.getByTestId("buy-mystic_energy").click();
  const popup = page.getByTestId("pack-overlay");
  await expect(popup).toHaveAttribute("data-stage", "preview");
  await expect(page.getByTestId("pack-price")).toContainText("200");
  await expect(page.getByTestId("pack-balance")).toContainText("500.000,00");
  const groups = page.getByTestId("contents-group");
  await expect(groups).toHaveCount(5);
  await expect(groups.first()).toHaveAttribute("data-rarity", "legendary");
  await expect(groups.first().getByTestId("contents-rate")).toContainText("1 in 900");
  await expect(groups.first().locator("li")).toHaveCount(2);
  await expect(groups.last().locator("li")).toHaveCount(50);
  await expect(groups.last().getByTestId("contents-owned")).toHaveText("0 von 50");
  await page.getByTestId("confirm-buy").click();
  await expect(popup).toHaveAttribute("data-stage", "opening");
  await expect(page.getByTestId("pack-balance")).toContainText("499.800,00");

  // A short pull is not enough: the strip falls back. Pulled across, the pack is open.
  const opening = page.getByTestId("pack-opening");
  await expect(opening).toHaveAttribute("data-phase", "sealed");
  await tearPack(page);
  await expect(opening).toHaveAttribute("data-phase", "stack");
  // The stack takes the keyboard by itself: five cards, five pulls.
  for (let i = 0; i < 5; i++) {
    await expect(opening).toHaveAttribute("data-index", String(i));
    await page.waitForTimeout(350);
    await page.keyboard.press("ArrowRight");
  }
  await expect(opening).toHaveAttribute("data-phase", "summary");
  const rows = page.getByTestId("pull-row");
  await expect(rows).toHaveCount(5);
  // A first pack is all new cards, each with condition and value.
  await expect(page.locator('[data-testid="pull-row"][data-new="true"]')).toHaveCount(5);
  await expect(rows.first().locator("[data-condition]")).toBeVisible();
  await expect(page.getByTestId("pack-worth")).toContainText("€");
  await expectNoSidewaysScroll(page);
  const first = (await rows.first().getAttribute("data-card"))!;

  // "Noch eins" is the next explicit purchase; the popup of the set now knows the own cards.
  await page.getByTestId("pack-close").click();
  await page.getByTestId("buy-mystic_energy").click();
  await expect(page.locator('[data-testid="set-contents"] li[data-owned="true"]')).toHaveCount(5);
  await page.getByTestId("pack-close").click();
  await page.goto("/nexamon?tab=collection");
  await expect(page.getByTestId("nexamon-binder")).toBeVisible();
  await expect(page.getByTestId("binder-copies")).toContainText("5");
  await expect(page.locator(`[data-testid="binder-tile"][data-card="${first}"]`)).toHaveAttribute("data-owned", "true");
  // Filters: only the own cards, then the missing ones of the set.
  await page.getByRole("radio", { name: "Meine" }).click();
  await expect(page.getByTestId("binder-tile")).toHaveCount(5);
  await page.getByRole("radio", { name: "Fehlt" }).click();
  await page.getByTestId("binder-set").selectOption("mystic_energy");
  await expect(page.getByTestId("binder-tile")).toHaveCount(72);
  await expectNoSidewaysScroll(page);
});

test("a pack that was not opened to the end keeps its cards after a reload", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon");
  await buyPack(page);
  await page.getByTestId("pack-close").click();
  await expect(page.getByTestId("pending-pack")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("pending-pack")).toBeVisible();
  await expect(page.getByTestId("progress-mystic_energy")).toHaveText("5 von 77");
  await page.getByTestId("pending-open").click();
  await expect(page.getByTestId("pack-opening")).toHaveAttribute("data-phase", "sealed");
  await page.getByTestId("pack-skip").click();
  await expect(page.getByTestId("pull-row")).toHaveCount(5);
  await page.getByTestId("pack-close").click();
  await expect(page.getByTestId("pending-pack")).toHaveCount(0);
});

test("inspect a card, list it and take it back, then send it to ASP", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon");
  const [key] = await buyAndSkip(page);
  await page.goto(`/nexamon/${key}`);
  await expect(page.getByTestId("inspect-name")).toBeVisible();
  await expect(page.getByTestId("card-value")).toContainText("€");
  await expect(page.getByTestId("card-population")).toBeVisible();
  // The big card turns around.
  const card = page.getByTestId("inspect-visual").getByTestId("nexamon-card");
  await expect(card).toHaveAttribute("data-face", "front");
  await card.click();
  await expect(card).toHaveAttribute("data-face", "back");
  await expectNoSidewaysScroll(page);

  // List it: the sheet shows the fee and what arrives.
  const row = page.getByTestId("copy-row").first();
  await expect(row).toHaveAttribute("data-status", "raw");
  await row.getByTestId("copy-sell").click();
  await expect(page.getByTestId("sell-sheet")).toBeVisible();
  await page.getByTestId("sell-price").fill("100");
  await expect(page.getByTestId("sell-net")).toContainText("95,00");
  await page.getByTestId("sell-confirm").click();
  await expect(row).toHaveAttribute("data-status", "listed");
  await expect(row.getByTestId("copy-listed")).toContainText("100,00");

  // It shows up under the own offers and can be taken back there.
  await page.goto("/nexamon?tab=market&view=mine");
  const own = page.getByTestId("own-listing");
  await expect(own).toHaveCount(1);
  await expect(own).toHaveAttribute("data-card", key!);
  await expectNoSidewaysScroll(page);
  await own.getByTestId("copy-unlist").click();
  await expect(page.getByTestId("own-listing")).toHaveCount(0);

  // Grading: fee, chance table, then the countdown on the card and at the desk.
  await page.goto(`/nexamon/${key}`);
  await page.getByTestId("copy-row").first().getByTestId("copy-grade").click();
  await expect(page.getByTestId("grade-sheet")).toBeVisible();
  await expect(page.getByTestId("grade-fee")).toContainText("€");
  await expect(page.getByTestId("grade-chances").locator("li").first()).toBeVisible();
  await page.getByTestId("grade-confirm").click();
  await expect(page.getByTestId("copy-row").first()).toHaveAttribute("data-status", "grading");
  await expect(page.getByTestId("copy-grading")).toBeVisible();
  await page.goto("/nexamon?tab=grading");
  await expect(page.getByTestId("grading-row")).toHaveCount(1);
  await expect(page.getByTestId("grading-running")).toContainText("1 / 10");
  await expectNoSidewaysScroll(page);
});

test("a finished grading is revealed at the desk", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon");
  await buyAndSkip(page);
  // The hour at ASP is over and the slab is back (written into the saved demo state, as the server would have it).
  await page.evaluate(() => {
    const player = JSON.parse(window.localStorage.getItem("nexa-demo-player-v2")!);
    player.nexamon.copies[0].grade = 9;
    player.nexamon.copies[0].gradedAt = Date.now() - 1_000;
    window.localStorage.setItem("nexa-demo-player-v2", JSON.stringify(player));
  });
  await page.goto("/nexamon?tab=grading");
  const reveal = page.getByTestId("slab-reveal");
  await expect(reveal).toHaveCount(1);
  await expect(reveal).toHaveAttribute("data-open", "false");
  // The slab waits in a sealed package; the grade is nowhere to be seen yet.
  await expect(reveal.getByTestId("grading-pack")).toBeVisible();
  await expect(reveal.locator("[data-grade]")).toHaveCount(0);
  await reveal.getByTestId("reveal-button").click();
  const overlay = page.getByTestId("grading-overlay");
  const show = overlay.getByTestId("grade-reveal");
  await expect(show).toHaveAttribute("data-phase", "sealed");
  // Closed before opening: the package stays sealed and can be opened later, also after a reload.
  await overlay.getByTestId("grading-close").click();
  await expect(overlay).toHaveCount(0);
  await expect(reveal).toHaveAttribute("data-open", "false");
  await page.reload();
  await expect(reveal).toHaveAttribute("data-open", "false");
  await reveal.getByTestId("reveal-pack").click();
  await show.getByTestId("grade-open").click();
  // Closed in the middle of the show: still sealed.
  await expect(show).toHaveAttribute("data-phase", /tearing|rising/);
  await overlay.getByTestId("grading-close").click();
  await expect(reveal).toHaveAttribute("data-open", "false");
  // Opened to the end (skipping the wait): the grade is on the table.
  await reveal.getByTestId("reveal-button").click();
  await show.getByTestId("grade-open").click();
  await show.getByTestId("grade-skip").click();
  await expect(show).toHaveAttribute("data-phase", "result");
  await expect(show).toHaveAttribute("data-tier", "good");
  await expect(show.getByTestId("grade-result")).toContainText("ASP 9");
  await overlay.getByTestId("grading-close").click();
  await expect(reveal).toHaveAttribute("data-open", "true");
  await expect(reveal.getByTestId("reveal-value")).toContainText("€");
  await expect(reveal.locator("[data-grade]").first()).toBeVisible();
  // Seen once: after a reload the slab is part of the history.
  await page.reload();
  await expect(page.getByTestId("history-row")).toHaveCount(1);
  await expect(page.getByTestId("slab-reveal")).toHaveCount(0);
  // The card page shows the slab and offers to crack it.
  await page.getByTestId("history-row").locator("a").click();
  await expect(page.getByTestId("inspect-visual")).toHaveAttribute("data-slab", "true");
  await page.getByTestId("copy-crack").click();
  await expect(page.getByTestId("crack-sheet")).toContainText("nicht zurück");
  await page.getByTestId("crack-confirm").click();
  await expect(page.getByTestId("copy-row").first()).toHaveAttribute("data-status", "raw");
});

test("the pack popup shows what a card of the set is worth on hover, focus and tap", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon");
  await page.getByTestId("buy-mystic_energy").click();
  await expect(page.getByTestId("pack-overlay")).toHaveAttribute("data-stage", "preview");
  const cards = page.getByTestId("set-contents").getByTestId("contents-card");
  const first = cards.first();
  await first.scrollIntoViewIfNeeded();
  const tip = page.getByTestId("contents-tip");
  if (test.info().project.name === "phone") await first.tap();
  else await first.hover();
  await expect(tip).toBeVisible();
  await expect(tip.getByTestId("contents-tip-value")).toContainText("€");
  await expect(tip).toContainText("Marktwert");
  await expect(first).toHaveAttribute("aria-label", /Marktwert .*€/);
  if (process.env.NEXA_SHOTS)
    await page.screenshot({ path: `${process.env.NEXA_SHOTS}/pack-popup-card-value-${test.info().project.name}.png` });
  // The keyboard reaches the next card and gets its value too.
  const firstText = await tip.innerText();
  await cards.nth(1).focus();
  await expect(tip).toHaveCount(1);
  await expect(tip).not.toHaveText(firstText);
  await expect(tip.getByTestId("contents-tip-value")).toContainText("€");
  await expectNoSidewaysScroll(page);
});

test("buy a card from an AI seller on the market", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nexamon?tab=market");
  await expect(page.getByTestId("market-list")).toBeVisible();
  await expect(page.getByTestId("market-page")).toContainText("Seite 1");
  await expectNoSidewaysScroll(page);
  // Filters and sorting go to the server: only rares, cheapest first.
  await page.getByTestId("market-rarity").selectOption("rare");
  await page.getByTestId("market-sort").selectOption("price_asc");
  const rows = page.getByTestId("listing-row");
  await expect(rows.first().locator('[data-rarity="rare"]').first()).toBeVisible();
  const first = rows.first();
  const key = (await first.getAttribute("data-card"))!;
  await expect(first.locator('[data-ai="true"]')).toBeVisible();
  await first.getByTestId("listing-buy").click();
  await expect(page.getByTestId("buy-sheet")).toBeVisible();
  await page.getByTestId("buy-confirm").click();
  await expect(page.getByTestId("buy-sheet")).toHaveCount(0);
  // The card is in the collection, and its page lists the sale.
  await page.goto(`/nexamon/${key}`);
  await expect(page.getByTestId("copy-row")).toHaveCount(1);
  await expect(page.getByTestId("sale-row").first()).toHaveAttribute("data-kind", "market");
  // From the card page the market opens filtered to this card.
  await page.getByRole("link", { name: "Im Markt zeigen" }).click();
  await expect(page.getByTestId("market-card-filter")).toBeVisible();
  await expect(page.locator(`[data-testid="listing-row"]:not([data-card="${key}"])`)).toHaveCount(0);
});

/** Left and right edge of a text node's ink (a range), so squeezed text is measured as drawn. */
async function textEdges(page: Page, part: string): Promise<{ left: number; right: number }> {
  return page
    .getByTestId("inspect-visual")
    .locator(`[data-part="${part}"]`)
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
}

for (const key of ["me-073", "pp-077", "me-001"]) {
  test(`long names stay clear of the numbers on ${key}`, async ({ page }) => {
    await preparePlayer(page);
    await page.goto(`/nexamon/${key}`);
    await expect(page.getByTestId("inspect-visual").getByTestId("nexamon-card")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const name = await textEdges(page, "name");
    const hp = await textEdges(page, "hp");
    expect(name.right).toBeLessThan(hp.left);
    const attack = await textEdges(page, "attack");
    const damage = await textEdges(page, "damage");
    if (damage.right > damage.left) expect(attack.right).toBeLessThan(damage.left);
    // Nothing is cut off: the text is not wider than its box.
    for (const part of ["name", "attack"]) {
      const clipped = await page
        .getByTestId("inspect-visual")
        .locator(`[data-part="${part}"]`)
        .evaluate((el) => {
          const span = el.firstElementChild as HTMLElement;
          return span.getBoundingClientRect().right - el.getBoundingClientRect().right;
        });
      expect(clipped).toBeLessThanOrEqual(0.5);
    }
  });
}
