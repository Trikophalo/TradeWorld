import { expect, test, type Page } from "@playwright/test";

/* Own home in demo mode (ADR-082): buy, shop, furnish, move up, garage and cars. */
async function preparePlayer(page: Page, xpTotal: number, cashCents: number) {
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
            ],
          },
        }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({
          nickname: "Mieterin",
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

async function hold(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name }).first();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
}

test("buy a flat, shop furniture and furnish it", async ({ page }) => {
  await preparePlayer(page, 5_000, 5_000_000);
  await page.goto("/property");
  await expect(page.getByTestId("tier-ladder")).toBeVisible();
  await hold(page, /kaufen für 25\.000 €/);
  await expect(page.getByText(/Willkommen in deinem neuen Zuhause/)).toBeVisible();
  await expect(page.getByTestId("home-header")).toContainText("Wohnung");

  // The furniture store: cheap to ultra.
  await page.getByRole("button", { name: "Möbelhaus" }).click();
  const shop = page.getByTestId("shop");
  await shop.locator('[data-item="chair_wood"]').getByRole("button").click();
  await expect(page.getByText("Gekauft").first()).toBeVisible();
  await shop.locator('[data-item="rug_basic"]').getByRole("button").click();
  await page.keyboard.press("Escape");

  // Furnish: rug, chair on top of it, save.
  await page.getByTestId("furnish").click();
  const editor = page.getByTestId("room-editor");
  await expect(page.getByTestId("inventory").getByRole("button")).toHaveCount(2);
  // The editor slides in and fits the room to the screen: measure once it stands still.
  await expect(async () => {
    const before = await editor.boundingBox();
    await page.waitForTimeout(200);
    expect(await editor.boundingBox()).toEqual(before);
  }).toPass();
  const box = (await editor.boundingBox())!;
  const tile = box.width / 8;
  // The editor slides in: pick until the right piece is really in hand (no click on a moving list).
  const pickUp = async (name: string) =>
    expect(async () => {
      await page.getByTestId("inventory").getByRole("button", { name }).click();
      await expect(page.getByText(`Du platzierst: ${name}`).first()).toBeVisible({ timeout: 1_000 });
    }).toPass();
  await pickUp("Läufer");
  await page.mouse.click(box.x + tile * 1.5, box.y + box.height - tile * 2.5);
  await pickUp("Holzstuhl");
  await page.mouse.click(box.x + tile * 1.5, box.y + box.height - tile * 2.5);
  await expect(page.getByTestId("inventory").getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Eingerichtet!")).toBeVisible();
  await expect(page.getByTestId("room").getByRole("img")).toHaveCount(2);
});

test("a house brings a garage; cars come from the dealer", async ({ page }) => {
  await preparePlayer(page, 120_000, 200_000_000);
  await page.goto("/property");
  await hold(page, /kaufen für 500\.000 €/);
  await expect(page.getByTestId("home-header")).toContainText("Haus");
  const garage = page.getByTestId("garage");
  await expect(garage.getByText("Freier Stellplatz")).toHaveCount(2);
  await garage.getByRole("button", { name: "Autohaus" }).click();
  await page.getByTestId("dealer").locator('[data-car="car_toro"]').getByRole("button").click();
  await expect(page.getByText("Neues Auto in der Garage!")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(garage.getByText("Toro Veloce Toro Furioso")).toBeVisible();
});
