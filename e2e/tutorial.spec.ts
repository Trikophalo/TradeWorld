import { expect, test, type Page } from "@playwright/test";

const tour = (page: Page, name: string) => page.locator(`[data-tour="${name}"]`).filter({ visible: true }).first();
const next = (page: Page) => page.locator("[data-tour-next]").click();
// Not by role: while the order sheet is open, the dialog hides everything else from the accessibility tree.
const finn = (page: Page) => page.locator("[data-tutorial]");

test("a new player is guided through the first session and cannot skip it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(finn(page)).toContainText("Hi, ich bin Finn");

  // A beginner sees a calm start page and no company tab.
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" }).filter({ visible: true });
  await expect(nav.getByRole("link", { name: "Firma" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tägliche Missionen" })).toHaveCount(0);

  // There is nothing to close, and Escape does nothing.
  await page.keyboard.press("Escape");
  await expect(finn(page)).toBeVisible();

  await next(page);
  await expect(finn(page)).toContainText("Das ist dein Vermögen");

  // Everything except the bubble is blocked: the markets tab cannot be used yet.
  await nav
    .getByRole("link", { name: "Märkte" })
    .click({ force: true, timeout: 2000 })
    .catch(() => undefined);
  await expect(page).toHaveURL("/");
  await next(page);

  await expect(finn(page)).toContainText("Tresor leeren");
  await tour(page, "vault-claim").click();

  await tour(page, "nav-markets").click();
  await expect(page).toHaveURL("/markets");
  await tour(page, "stock-row").click();
  await expect(page).toHaveURL(/\/markets\/[A-Z]+$/);
  await expect(finn(page)).toContainText("aktuelle Kurs");
  await next(page);

  await tour(page, "buy").click();
  await expect(finn(page)).toContainText("gedrückt");
  await tour(page, "order-confirm").locator("button").hover();
  await page.mouse.down();
  await expect(finn(page)).toContainText("Portfolio", { timeout: 5000 });
  await page.mouse.up();

  await tour(page, "nav-portfolio").click();
  await expect(page).toHaveURL("/portfolio");
  await next(page);
  await tour(page, "nav-profile").click();
  await expect(page).toHaveURL("/profile");
  await next(page);

  await expect(finn(page)).toContainText("Level 2");
  await next(page);
  await expect(finn(page)).toHaveCount(0);

  // The reward lifted the player to level 2, and more of the game is visible now.
  await expect(page.getByText("Level 2").filter({ visible: true }).first()).toBeVisible();
  await page.goto("/");
  await expect(finn(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tägliche Missionen" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the tutorial resumes at the same step after a reload and returns the player to the right page", async ({
  page,
}) => {
  await page.goto("/");
  await next(page);
  await next(page);
  await expect(finn(page)).toContainText("Tresor leeren");
  await page.goto("/profile");
  await expect(page).toHaveURL("/");
  await expect(finn(page)).toContainText("Tresor leeren");
});
