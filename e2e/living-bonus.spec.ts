import { expect, test, type Page } from "@playwright/test";

/* Living bonus, furniture prices by home, furnished home value and free rent prices in demo mode (ADR-161). */

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

async function preparePlayer(page: Page, tier: "flat" | "house", furnished: boolean) {
  await page.addInitScript(
    ([homeTier, withFurniture, flat]) => {
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
          nickname: "Bewohnerin",
          cashCents: 5_000_000,
          xpTotal: 16_000,
          tutorialCompleted: true,
          curveVersion: 2,
          home: {
            tier: homeTier,
            wallColor: "#f3efe4",
            floor: "laminate",
            floorsOwned: ["laminate"],
            furniture: withFurniture
              ? flat.map(([itemKey, x, y], i) => ({ id: `f-${i + 1}`, itemKey, placed: { x, y, rot: 0 } }))
              : [],
            cars: [],
            seq: flat.length,
          },
        }),
      );
    },
    [tier, furnished, FLAT] as const,
  );
}

test("the furnished flat pays a living bonus every hour and the furniture adds to the home value", async ({ page }) => {
  await preparePlayer(page, "flat", true);
  await page.goto("/property");
  const bonus = page.getByTestId("living-bonus");
  await expect(bonus).toHaveAttribute("data-source", "own");
  // flat at Wohnwert 90: 18,80 EUR and 2 base XP (x 2 in the alpha) per hour
  await expect(bonus.getByTestId("living-bonus-amount")).toContainText("18,80");
  await expect(bonus.getByTestId("living-bonus-amount")).toContainText("+4 XP");
  await expect(bonus.getByTestId("living-bonus-tips")).toContainText("Wohnwert 100");
  await expect(bonus.getByTestId("living-bonus-tips")).toContainText("Apartment");
  // the placed furniture (8.060 EUR) counts at 60 % in the value of the home
  await expect(page.getByTestId("home-furnishing")).toContainText("4.836");

  // the vault lists the living bonus among the income sources
  await page.goto("/");
  await page.getByTestId("vault-open").click();
  await expect(page.getByTestId("vault-sources")).toContainText("Wohnbonus");
});

test("furniture costs more in a bigger home; the owner sets the rent freely", async ({ page }) => {
  await preparePlayer(page, "house", false);
  await page.goto("/property");
  await page.locator('[data-tour="home-shop"]').click();
  const shop = page.getByRole("dialog");
  await expect(shop.getByTestId("shop-price-factor")).toContainText("1,5-Fache");
  // wooden chair: 80 EUR in the catalogue, 120 EUR in the house
  await expect(shop.locator('[data-item="chair_wood"]').getByTestId("shop-price")).toContainText("120");
  await page.keyboard.press("Escape");

  const panel = page.getByTestId("rental-offer");
  const input = panel.getByTestId("offer-price-input");
  // far above the fair rent: allowed, but no AI tenant would come
  await input.fill("5000");
  await expect(panel.getByTestId("ai-demand")).toHaveAttribute("data-demand", "none");
  await expect(panel.getByTestId("offer-submit")).toBeEnabled();
  // zero is not a price
  await input.fill("0");
  await expect(panel.getByTestId("offer-submit")).toBeDisabled();
  await panel.getByTestId("offer-quick-fair").click();
  await expect(panel.getByTestId("offer-submit")).toBeEnabled();
  await panel.getByTestId("offer-submit").click();
  await expect(panel.getByTestId("offer-status")).toHaveText("Angebot offen");
});
