import { expect, test } from "@playwright/test";

// Every tab is visible from the start; the company has its own tab, the profile sits in the top bar on phones.
const TABS = [
  { name: "Portfolio", path: "/portfolio", heading: "Portfolio" },
  { name: "Märkte", path: "/markets", heading: "Märkte" },
  { name: /^Job/, path: "/job", heading: "Job" },
  { name: /Karriere/, path: "/career", heading: "Karriere" },
  { name: /^Firma/, path: "/company", heading: "Firma" },
  { name: /^Profil/, path: "/profile", heading: "Profil" },
];

// These tests look at the game after the first session: mark the tutorial as done.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("nexa-tutorial", JSON.stringify({ demo: { status: "done", step: 0 } }));
    // The daily reward popup is covered in careers.spec.ts.
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
  });
});

test("the tabs navigate without horizontal overflow or console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" }).filter({ visible: true });
  await expect(nav.getByRole("link", { name: "Start" })).toHaveAttribute("aria-current", "page");

  for (const tab of TABS) {
    // On phones the profile is the avatar in the top bar.
    await page.getByRole("link", { name: tab.name }).filter({ visible: true }).first().click();
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
  await expect(cash).toContainText("10.200");
});

test("buying by euro amount, seeing the position and selling it again", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("link", { name: /Volta Energie AG/ }).click();
  await expect(page).toHaveURL("/markets/VLT");
  await expect(page.getByRole("heading", { level: 1, name: "Volta Energie AG" })).toBeVisible();

  // Buy for 500 € (the default input is an amount; fractions of shares are bought).
  await page.locator('[data-tour="buy"]').filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "VLT kaufen" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Betrag in Euro").fill("500");
  await expect(dialog.getByText(/Dafür bekommst du etwa 4,4\d* Stück/)).toBeVisible();
  // The slider and quick buttons fill the field without typing.
  await dialog.getByRole("button", { name: "25 %" }).click();
  await expect(dialog.getByLabel("Betrag in Euro")).toHaveValue("2500,00");
  await dialog.getByLabel("Betrag in Euro").fill("500");

  // Limit orders are visible but locked for a new player.
  await dialog.getByRole("radio", { name: /Limit/ }).click();
  await expect(page.getByText("Ab Level 3")).toBeVisible();

  const hold = dialog.locator('[data-tour="order-confirm"] button');
  await hold.hover();
  await page.mouse.down();
  await expect(page.getByText("Gekauft")).toBeVisible({ timeout: 5000 });
  await page.mouse.up();
  await expect(dialog).toBeHidden();

  // The position shows up on the stock page and in the portfolio.
  await expect(page.getByText("Deine Position")).toBeVisible();
  await page.locator('[data-tour="nav-portfolio"]').filter({ visible: true }).first().click();
  await expect(page.getByText(/4,4\d* Stück · Einstand/)).toBeVisible();

  // Sell everything again.
  await page.getByRole("link", { name: /Volta Energie AG/ }).click();
  await page.getByRole("button", { name: "Verkaufen", exact: true }).filter({ visible: true }).first().click();
  const sell = page.getByRole("dialog", { name: "VLT verkaufen" });
  await sell.getByRole("button", { name: "Alle", exact: true }).click();
  await sell.locator('[data-tour="order-confirm"] button').hover();
  await page.mouse.down();
  await expect(page.getByText("Verkauft")).toBeVisible({ timeout: 5000 });
  await page.mouse.up();
  await expect(page.getByText("Deine Position")).toHaveCount(0);
});

test("later features are visible but locked", async ({ page }) => {
  await page.goto("/markets");
  await page.getByRole("radio", { name: /Anleihen/ }).click();
  await expect(page.getByText("Staatsanleihe 10 Jahre")).toBeVisible();
  await expect(page.getByRole("button", { name: "Kaufen" })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByText("Später freischaltbar")).toBeVisible();
});

test("the sign-in page explains demo mode", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Demo-Modus" })).toBeVisible();
});

test("the showcase renders every section", async ({ page }) => {
  await page.goto("/dev/ui");
  for (const id of ["tokens", "buttons", "numbers", "skeletons", "toasts", "sheet", "mascot", "pixel", "motion"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
});

test("the rules page explains taxes with numbers from the config", async ({ page }) => {
  await page.goto("/profile");
  // The level arrives with the portfolio and reveals the career card above the link; wait until the layout settled.
  await expect(page.getByRole("heading", { name: "Karriere" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole("link", { name: /Spielregeln/ }).click();
  await expect(page).toHaveURL("/profile/rules");
  await page.getByRole("button", { name: /Steuer auf Kursgewinne/ }).click();
  await expect(page.getByText("250 € Steuer, 750 € bleiben dir", { exact: false })).toBeVisible();
});

test("on desktop the company has its own tab in the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Hauptnavigation" }).filter({ visible: true });
  await sidebar.getByRole("link", { name: /Firma/ }).click();
  await expect(page).toHaveURL("/company");
  await expect(sidebar.getByRole("link", { name: /Firma/ })).toHaveAttribute("aria-current", "page");
  await expect(sidebar.getByRole("link", { name: /Karriere/ })).not.toHaveAttribute("aria-current", "page");
});

test("on phones the bottom bar has six short tabs and Mehr, the profile is in the top bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company");
  const bar = page.getByRole("navigation", { name: "Hauptnavigation" }).filter({ visible: true });
  await expect(bar.getByRole("link")).toHaveCount(6);
  await expect(bar.getByRole("button", { name: "Mehr" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(bar.getByRole("link", { name: /^Firma/ })).toHaveAttribute("aria-current", "page");
  await expect(bar.getByRole("link", { name: /^Profil/ })).toHaveCount(0);
  await page.getByRole("banner").getByRole("link", { name: "Profil" }).click();
  await expect(page).toHaveURL("/profile");
});
