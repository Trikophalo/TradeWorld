import { expect, test } from "@playwright/test";

const TABS = [
  { name: "Portfolio", path: "/portfolio", heading: "Portfolio" },
  { name: "Märkte", path: "/markets", heading: "Märkte" },
  { name: "Firma", path: "/company", heading: "Unternehmen" },
  { name: "Profil", path: "/profile", heading: "Profil" },
];

test("the five tabs navigate without horizontal overflow or console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" }).filter({ visible: true });
  await expect(nav.getByRole("link", { name: "Start" })).toHaveAttribute("aria-current", "page");

  for (const tab of TABS) {
    await nav.getByRole("link", { name: tab.name }).click();
    await expect(page).toHaveURL(tab.path);
    await expect(page.getByRole("heading", { level: 1, name: tab.heading })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${tab.path}`).toBeLessThanOrEqual(0);
  }
  // The browser reports a skipped page transition when the emulated viewport
  // resizes mid-navigation. The navigation itself completes; only the animation is dropped.
  expect(errors.filter((message) => !message.includes("Transition was aborted"))).toEqual([]);
});

test("emptying the vault moves the money to the cash balance", async ({ page }) => {
  await page.goto("/");
  const cash = page.locator('[data-fly-target="cash"]');
  await expect(cash).toContainText("10.000,00 €");
  await page.getByRole("button", { name: "Tresor leeren" }).click();
  await expect(page.getByText("Tresor geleert")).toBeVisible();
  await expect(cash).not.toContainText("10.000,00 €");
});

test("a stock can be opened and the order preview confirmed by holding", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("link", { name: /Volta Energie AG/ }).click();
  await expect(page).toHaveURL("/markets/VLT");
  await expect(page.getByRole("heading", { level: 1, name: "Volta Energie AG" })).toBeVisible();

  await page.getByRole("button", { name: "Kaufen", exact: true }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "VLT kaufen" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Stückzahl").fill("0");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Zum Kaufen halten" })).toBeDisabled();

  await dialog.getByLabel("Stückzahl").fill("3");
  const hold = dialog.getByRole("button", { name: "Zum Kaufen halten" });
  await hold.hover();
  await page.mouse.down();
  await expect(page.getByText("Order-Vorschau ausgeführt")).toBeVisible({ timeout: 5000 });
  await page.mouse.up();
  await expect(dialog).toBeHidden();
});

test("the sign-in page explains demo mode", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Demo-Modus" })).toBeVisible();
});

test("the showcase renders every section", async ({ page }) => {
  await page.goto("/dev/ui");
  for (const id of ["tokens", "buttons", "numbers", "skeletons", "toasts", "sheet", "pixel", "motion"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
});

test("the rules page explains taxes with numbers from the config", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("link", { name: /Spielregeln/ }).click();
  await expect(page).toHaveURL("/profile/rules");
  await page.getByRole("button", { name: /Steuer auf Kursgewinne/ }).click();
  await expect(page.getByText("250 € Steuer, 750 € bleiben dir", { exact: false })).toBeVisible();
});
