import { expect, test, type Page } from "@playwright/test";
import { showDashboard } from "./company-helpers";

/*
 * Company health (ADR-162) in demo mode: the overview shows the eight factors as a chart and as bars, the weakest
 * on top; "Mit Mira angehen" opens Mira with the question and she answers with steps.
 */
async function foundCompany(page: Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({
        demo: { status: "done", step: 0, seenTours: ["first_job", "bonds", "found_garage", "visit_company"] },
      }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Gruenderin",
        cashCents: 2_000_000,
        xpTotal: 7_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  });
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Gesundwerk");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Bedruckte T-Shirts mit lustigen Sprüchen.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  const button = page.getByRole("button", { name: /Gedrückt halten zum Gründen/ });
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
  await expect(page.getByText("Firma gegründet!")).toBeVisible();
}

test("the overview shows eight factors and the chart; a factor goes to Mira with the question", async ({ page }) => {
  await foundCompany(page);

  // Mira (her own panel since ADR-187) raises the weakest point on her own.
  await showDashboard(page);
  await page.getByTestId("mira-open").click();
  await expect(page.getByTestId("mira").getByText(/Hier verlierst du gerade am meisten:/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mira")).toBeHidden();

  // ADR-183: nothing folds; the full panel stands in the section "Stärken und Diagnose" (jump bar)
  await page.getByTestId("dashboard-nav").getByTestId("nav-diagnosis").click();
  const panel = page.getByTestId("company-health");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("health-radar")).toBeVisible();
  await expect(panel.getByTestId("health-factor")).toHaveCount(8);
  for (const key of ["awareness", "capacity", "quality", "image", "price", "team", "cash", "momentum"])
    await expect(panel.locator(`[data-testid="health-factor"][data-factor="${key}"]`)).toHaveCount(1);
  await expect(panel.getByTestId("health-weakest")).toContainText("Hier verlierst du am meisten:");
  await expect(panel.getByTestId("health-profit")).toContainText("/h");
  // One view with the long-term strengths (ADR-187): six of the eight topics carry one.
  await expect(panel.getByTestId("health-longterm")).toHaveCount(6);
  await expect(panel.getByTestId("strengths-overall")).toContainText("/ 100");

  // No horizontal scroll on the phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // "Mit Mira angehen" on awareness: Mira (same tab) gets the question and answers with her steps.
  await panel.locator('[data-factor="awareness"]').getByTestId("health-ask").click();
  const mira = page.getByTestId("mira");
  await expect(mira).toBeVisible();
  await expect(mira.getByTestId("mira-me").last()).toContainText("Wie steigere ich die Bekanntheit?");
  await expect(mira.getByText(/^Bekanntheit \(\d+ von 100\):/)).toBeVisible();
  await expect(mira.getByText("Das kannst du jetzt tun:").last()).toBeVisible();
  await expect(mira.getByTestId("mira-option").filter({ hasText: "Tipp" }).last()).toBeVisible();

  // Typing works the same way.
  await mira.getByTestId("mira-input").fill("Wie verbessere ich die Qualität?");
  await mira.getByTestId("mira-send").click();
  await expect(mira.getByText(/^Qualität \(\d+ von 100\):/)).toBeVisible();
});
