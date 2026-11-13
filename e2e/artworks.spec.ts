import { expect, test, type Page } from "@playwright/test";

/*
 * Artworks in demo mode (ADR-080): marketplace with the gallery, likes, bids, painting your own artwork and
 * putting it up for auction. Level 8 player with 100.000 €.
 */
async function preparePlayer(page: Page, xpTotal = 16_000) {
  await page.addInitScript((xp) => {
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
          ],
        },
      }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Sammlerin",
        cashCents: 10_000_000,
        xpTotal: xp,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  }, xpTotal);
}

async function hold(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
  // Into the middle of the screen: at the lower edge the tab bar would cover it on phones.
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // Settle first: page content rises in (ADR-108), a press during that would miss.
  await expect(async () => {
    const a = await button.boundingBox();
    await page.waitForTimeout(100);
    const b = await button.boundingBox();
    expect(a && b && Math.abs(a.y - b.y) < 1).toBe(true);
  }).toPass();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
}

test("artworks are locked below level 4 (ADR-099)", async ({ page }) => {
  await preparePlayer(page, 100);
  await page.goto("/artworks");
  // The sidebar's "Bald frei" names the level too (ADR-107): check the page itself.
  await expect(page.getByRole("main").getByText("Ab Level 4")).toBeVisible();
});

test("marketplace: gallery works, like, bid on an auction", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/artworks");
  const grid = page.getByTestId("art-grid");
  await expect(grid.getByTestId("artwork-card").first()).toBeVisible();
  // Every work is labelled: the gallery of the game or a player.
  await expect(grid.getByText("NEXA-Galerie").first()).toBeVisible();

  // Like a work: the heart count goes up.
  const card = grid.getByTestId("artwork-card").first();
  const like = card.getByRole("button", { name: "Gefällt mir" });
  const before = Number(await like.innerText());
  await like.click();
  await expect(card.getByRole("button", { name: "Gefällt mir nicht mehr" })).toContainText(String(before + 1));

  // Bid on a running gallery auction.
  await page.getByRole("switch", { name: "Nur Auktionen" }).click();
  await grid.getByTestId("artwork-card").first().click();
  const detail = page.getByTestId("artwork-detail");
  await expect(detail.getByText(/ART-\d{4}/).first()).toBeVisible();
  await detail
    .getByTestId("bid-box")
    .getByRole("button", { name: /bieten/ })
    .click();
  await expect(page.getByText("Gebot abgegeben")).toBeVisible();
  await expect(detail.getByText("Du führst")).toBeVisible();
});

test("paint an artwork, see it in the collection and put it up for auction", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/artworks");
  await expect(page.getByTestId("art-studio")).toContainText("15.000 €");
  await page.getByTestId("art-studio").getByRole("button", { name: "Kunstwerk malen" }).click();
  const editor = page.getByRole("dialog", { name: "Kunstwerk malen" });
  await expect(editor).toBeVisible();
  await page.waitForTimeout(400);
  const board = page.getByTestId("art-board");
  const box = (await board.boundingBox())!;
  const cell = box.width / 32;
  for (const row of [6, 7, 8]) {
    await page.mouse.move(box.x + cell * 4.5, box.y + cell * (row + 0.5));
    await page.mouse.down();
    await page.mouse.move(box.x + cell * 27.5, box.y + cell * (row + 0.5), { steps: 12 });
    await page.mouse.up();
  }
  await editor.getByLabel("Titel des Kunstwerks").fill("Morgenrot");
  await hold(page, /Gedrückt halten: für 15\.000 € malen/);
  await expect(page.getByText("Dein Kunstwerk ist fertig!")).toBeVisible();
  // The next one costs double.
  await expect(page.getByTestId("art-studio")).toContainText("30.000 €");

  await page.getByRole("radio", { name: "Meine Sammlung" }).click();
  const mine = page.getByTestId("collection").getByTestId("artwork-card");
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("Morgenrot");
  await expect(mine).toContainText("von Sammlerin");
  await mine.click();
  const sell = page.getByTestId("sell-box");
  await sell.getByLabel("Startpreis in €").fill("2000");
  await sell.getByRole("button", { name: "Auktion starten" }).click();
  await expect(page.getByText("Auktion gestartet")).toBeVisible();
  await expect(page.getByText("Das ist deine Auktion.")).toBeVisible();
});
