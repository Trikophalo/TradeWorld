import { expect, test } from "@playwright/test";
import { hold, prepareRichFounder } from "./company-helpers";

/*
 * Company overhaul (ADR-180) in demo mode: the simple dashboard (numbers, what the last hour says, to-dos), the
 * autopilot switch, and two of the five new task games on the showcase.
 */

test("dashboard: key numbers, the last hour in words, the autopilot switch", async ({ page }) => {
  await prepareRichFounder(page, "Autopilotin");
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Nachtschicht");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Arbeit, die nachts von allein passiert.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();

  const dashboard = page.getByTestId("company-dashboard");
  await expect(dashboard.getByTestId("stat-cash")).toBeVisible();
  await expect(dashboard.getByTestId("company-todo")).toBeVisible();
  const autopilot = dashboard.getByTestId("company-autopilot");
  await expect(autopilot).toContainText("Autopilot");
  await expect(autopilot.getByTestId("autopilot-chance")).toContainText("%");

  const toggle = autopilot.getByRole("switch", { name: "Autopilot" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.getByText("Autopilot an. Er übernimmt ab jetzt alle Aufgaben.")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // after closed hours the dashboard says where the awareness came from
  await page.getByTestId("company-header").getByText("Demo: Quartal jetzt abschließen").click();
  await expect(dashboard.getByTestId("pulse-awareness")).toContainText("Bekanntheit");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("new task games: receipts and pattern on the showcase (ADR-180)", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.waitForLoadState("networkidle");

  const receipts = page.getByTestId("game-receipts");
  await receipts.scrollIntoViewIfNeeded();
  // amounts [23, 48, 15, 72, 9, 31], total 87 = 15 + 72
  for (const i of [2, 3]) {
    const r = receipts.getByTestId("receipt").nth(i);
    // the showcase is heavy: a tap before hydration is lost, so tap until it sticks
    await expect(async () => {
      if ((await r.getAttribute("aria-pressed")) !== "true") await r.click();
      await expect(r).toHaveAttribute("aria-pressed", "true", { timeout: 500 });
    }).toPass();
  }
  await expect(receipts.getByText(/Ausgewählt 87/)).toBeVisible();
  await receipts.getByRole("button", { name: "Fertig" }).click();
  await expect(page.getByText('{"picked":[2,3]}')).toBeVisible();

  const pattern = page.getByTestId("game-pattern");
  await pattern.scrollIntoViewIfNeeded();
  // 3, 7, 11, 15 -> 19 (second option); 2, 4, 8, 16 -> 32 (first option)
  await pattern.getByRole("button", { name: "19" }).click();
  await pattern.getByRole("button", { name: "32" }).click();
  await expect(page.getByText('{"choices":[1,0]}')).toBeVisible();
});
