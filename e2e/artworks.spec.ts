import { expect, test, type Page } from "@playwright/test";

/*
 * NFTs in demo mode (ADR-080, ADR-135): marketplace with the gallery, likes, bids, minting your own NFT,
 * auctions, fixed prices and the offer chat with AI collectors. Level 8 player with 100.000 €.
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
  await expect(detail.getByText(/NFT-\d{4}/).first()).toBeVisible();
  await detail
    .getByTestId("bid-box")
    .getByRole("button", { name: /bieten/ })
    .click();
  await expect(page.getByText("Gebot abgegeben")).toBeVisible();
  await expect(detail.getByText("Du führst")).toBeVisible();
});

/** Paints three stripes in the editor and mints the NFT (hold to confirm). */
async function mint(page: Page, title: string, cost: RegExp) {
  await page.getByTestId("art-studio").getByRole("button", { name: "NFT prägen" }).click();
  const editor = page.getByRole("dialog", { name: "NFT prägen" });
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
  await editor.getByLabel("Titel des NFTs").fill(title);
  await hold(page, cost);
  await expect(page.getByText("Dein NFT ist geprägt!")).toBeVisible();
}

test("mint an NFT, see it in the collection and put it up for auction", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/artworks");
  await expect(page.getByTestId("art-studio")).toContainText("15.000 €");
  await mint(page, "Morgenrot", /Gedrückt halten: für 15\.000 € prägen/);
  // The next one costs 1.5 times as much (ADR-135).
  await expect(page.getByTestId("art-studio")).toContainText("22.500 €");

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

test("offer chat: AI collectors decline a low offer and accept a good one (ADR-135)", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/nfts");
  await expect(page).toHaveURL(/\/artworks$/);
  await page.getByRole("radio", { name: "Zum Verkauf" }).click();
  const grid = page.getByTestId("art-grid");
  await grid.getByTestId("artwork-card").first().click();
  const detail = page.getByTestId("artwork-detail");
  const chat = detail.getByTestId("nft-chat");
  await expect(detail.getByTestId("buy-box")).toBeVisible();
  const ask = Number((await detail.getByTestId("buy-box").getByText(/€/).first().innerText()).replace(/\D/g, ""));

  // A plain message.
  await chat.getByLabel("Nachricht").fill("Schönes Stück!");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.getByTestId("nft-message").filter({ hasText: "Schönes Stück!" })).toBeVisible();

  // Far too low: the collector declines in the chat.
  await chat.getByRole("switch", { name: "Mit Preisangebot" }).click();
  await chat.getByLabel("Dein Angebot in €").fill("100");
  await chat.getByRole("button", { name: /anbieten/ }).click();
  await expect(chat.getByTestId("nft-offer").first()).toContainText("abgelehnt");

  // At the asking price (125 % of the valuation, above the 105 % it needs): sold to me.
  await chat.getByRole("switch", { name: "Mit Preisangebot" }).click();
  await chat.getByLabel("Dein Angebot in €").fill(String(ask));
  await chat.getByRole("button", { name: /anbieten/ }).click();
  await expect(chat.getByText(/Verkauft an Sammlerin/)).toBeVisible();
  await expect(detail.getByTestId("price-box")).toBeVisible();
});

test("owner: a fixed price too high gets a lowball offer, accepting it sells the NFT (ADR-135)", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/artworks");
  await mint(page, "Abendstern", /Gedrückt halten: für 15\.000 € prägen/);
  await page.getByRole("radio", { name: "Meine Sammlung" }).click();
  await page.getByTestId("collection").getByTestId("artwork-card").click();
  const detail = page.getByTestId("artwork-detail");
  const price = detail.getByTestId("price-box");
  await price.getByLabel("Preis in €").fill("90000");
  await price.getByRole("button", { name: "Preis festlegen" }).click();
  await expect(page.getByText("Preis gespeichert")).toBeVisible();
  // Too expensive for the collectors: one of them writes a lowball offer instead of buying.
  const chat = detail.getByTestId("nft-chat");
  const offer = chat.getByTestId("nft-offer").first();
  await expect(offer).toContainText("offen");
  await offer.getByRole("button", { name: "Annehmen" }).click();
  await expect(page.getByText(/Verkauft für/)).toBeVisible();
  await expect(chat.getByText(/Verkauft an/)).toBeVisible();
  await expect(detail.getByTestId("price-box")).toHaveCount(0);
});
