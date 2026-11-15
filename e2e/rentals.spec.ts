import { expect, test, type Locator, type Page } from "@playwright/test";

/* Wohnwert, renting out and renting in demo mode (ADR-158). */

/** The furnished flat of the SQL test: Wohnwert 90 on laminate. */
const FLAT = [
  ["bed_double", 0, 0],
  ["sofa_leather", 5, 0],
  ["table_oak", 5, 2],
  ["lamp_table", 5, 2],
  ["vase_flowers", 6, 3],
  ["kitchen_fridge", 7, 5],
  ["shower", 0, 5],
  ["plant_monstera", 7, 2],
  ["rug_wool", 1, 3],
] as const;

async function preparePlayer(page: Page, options: { home: boolean }) {
  await page.addInitScript(
    ([withHome, flat]) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({
          demo: { status: "done", step: 0, seenTours: ["property", "visit_property", "first_job", "artworks"] },
        }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({
          nickname: "Vermieterin",
          cashCents: 5_000_000,
          xpTotal: 16_000,
          tutorialCompleted: true,
          curveVersion: 2,
          home: withHome
            ? {
                tier: "flat",
                wallColor: "#f3efe4",
                floor: "laminate",
                floorsOwned: ["laminate"],
                furniture: flat.map(([itemKey, x, y], i) => ({ id: `f-${i + 1}`, itemKey, placed: { x, y, rot: 0 } })),
                cars: [],
                seq: flat.length,
              }
            : undefined,
        }),
      );
    },
    [options.home, FLAT] as const,
  );
}

async function hold(page: Page, button: Locator) {
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
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

test("the Wohnwert of a furnished flat, an offer, an AI tenant moves in, walks and pays", async ({ page }) => {
  await preparePlayer(page, { home: true });
  await page.goto("/property");
  const panel = page.getByTestId("rental-offer");
  await expect(panel.getByTestId("wohnwert-total")).toHaveText("90");
  await expect(panel.getByTestId("offer-status")).toHaveText("Noch kein Angebot");

  // the editor shows the Wohnwert live: one piece back into the inventory lowers it
  await page.getByTestId("furnish").click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByTestId("wohnwert-total")).toHaveText("90");
  await editor.locator('[data-piece="rug_wool"]').click();
  await editor.getByRole("button", { name: /Ins Inventar/ }).click();
  await expect(editor.getByTestId("wohnwert-total")).toHaveText("85");
  await expect(editor.getByTestId("wohnwert-tips")).toBeVisible();
  await page.keyboard.press("Escape");

  // the lowest price: an AI tenant moves in at once and pays the first hour
  const slider = panel.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(panel.getByTestId("ai-demand")).toHaveAttribute("data-demand", "high");
  await panel.getByTestId("offer-submit").click();
  await expect(panel.getByTestId("offer-status")).toHaveText("Angebot offen");
  await expect(panel.getByTestId("tenant-row")).toHaveCount(1);
  await expect(panel.getByTestId("tenant-row").first()).toHaveAttribute("data-ai", "true");
  await expect(panel.getByTestId("rent-earned")).toContainText(/7 Tage: [1-9]/);

  // the tenant stands in the room and walks from tile to tile
  const tenant = page.locator('[data-tour="home-room"]').getByTestId("tenant").first();
  await expect(tenant).toBeVisible();
  const before = await tenant.evaluate((el) => getComputedStyle(el).transform);
  await expect(async () => {
    expect(await tenant.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
  }).toPass({ timeout: 12_000 });

  // notice from the owner: the tenancy shows when it ends
  await panel.getByTestId("tenant-row").getByRole("button", { name: "Kündigen" }).click();
  await expect(panel.getByTestId("tenant-row")).toContainText("Endet in");
});

test("rent a place at another player: market, hold, the room with everyone in it", async ({ page }) => {
  await preparePlayer(page, { home: false });
  await page.goto("/property");
  await page.getByTestId("open-rental-market").click();
  await expect(page).toHaveURL(/\/property\/rentals/);
  const card = page.locator('[data-testid="rental-offer-card"][data-owner="Lena_Loft"]');
  await expect(card).toBeVisible();
  await expect(card.getByTestId("offer-wohnwert")).toContainText("Wohnwert");
  await expect(card.getByTestId("tenant")).toHaveCount(1);
  await hold(page, card.getByRole("button", { name: /Einmieten für/ }));
  await expect(page).toHaveURL(/\/property$/);
  const renting = page.getByTestId("renting-card");
  await expect(renting).toContainText("Apartment bei Lena_Loft");
  await expect(renting.getByTestId("tenant")).toHaveCount(2);
  await expect(renting.locator('[data-testid="tenant"][data-ai="false"]')).toHaveAttribute("data-name", "Vermieterin");
});
