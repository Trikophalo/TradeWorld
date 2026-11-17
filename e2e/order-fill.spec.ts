import { expect, test } from "@playwright/test";

// ADR-189: the order sheet shows what the order really costs or brings, including its own price impact.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("nexa-tutorial", JSON.stringify({ demo: { status: "done", step: 0 } }));
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
  });
});

const euros = (text: string) => Number(text.replace(/[^\d,]/g, "").replace(",", "."));

test("the order sheet shows the expected amount and the price impact, and the fill matches it", async ({ page }) => {
  await page.goto("/markets/QSL");
  await page.locator('[data-tour="buy"]').filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "QSL kaufen" });
  await expect(dialog).toBeVisible();

  // A small order: little impact, no warning.
  await dialog.getByLabel("Betrag in €").fill("100");
  await expect(dialog.getByText("Du zahlst ca.")).toBeVisible();
  await expect(dialog.getByTestId("order-impact")).toHaveText(/^\+0,\d+\s?%$/);
  await expect(dialog.getByTestId("order-high-impact")).toHaveCount(0);

  // All cash in a penny stock: about 10 % impact, the sheet warns with the exact amount.
  await dialog.getByRole("button", { name: "Max", exact: true }).click();
  await expect(dialog.getByTestId("order-high-impact")).toContainText("Große Order");
  await expect(dialog.getByTestId("order-impact")).toHaveText(/^\+\d+(,\d+)?\s?%$/);
  // the warning names the exact amount (the total row animates)
  const warning = (await dialog.getByTestId("order-high-impact").textContent()) ?? "";
  const net = euros(/ca\. ([\d.,]+)/.exec(warning)?.[1] ?? "");
  expect(net).toBeGreaterThan(9_000);
  expect(net).toBeLessThanOrEqual(10_000);

  await dialog.screenshot({ path: "test-results/order-fill-sheet.png" });

  await expect(dialog.locator('[data-tour="order-confirm"] button')).toBeEnabled();
  await dialog.locator('[data-tour="order-confirm"] button').hover();
  await page.mouse.down();
  await expect(page.getByText("Gekauft")).toBeVisible({ timeout: 5000 });
  await page.mouse.up();
  await expect(dialog).toBeHidden();
  // what was shown is what was paid
  await page.goto("/");
  await expect(page.locator('[data-fly-target="cash"]')).toContainText(
    new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2 }).format(10_000 - net),
  );
});
