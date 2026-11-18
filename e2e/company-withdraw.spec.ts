import { expect, test, type Page } from "@playwright/test";
import { hold, jumpClock, showPane, showOverview, unfoldCompany } from "./company-helpers";

/*
 * Withdrawals every 6 hours (ADR-213), demo mode: found a garage, take money out, the till counts down to the next
 * withdrawal and the button waits; 6 hours later it works again.
 */
async function preparePlayer(page: Page, theme: "dark" | "light") {
  await unfoldCompany(page);
  await page.addInitScript((mode) => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem("nexa-settings", JSON.stringify({ state: { theme: mode }, version: 1 }));
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({
        demo: {
          status: "done",
          step: 0,
          seenTours: ["first_job", "limit_orders", "bonds", "found_garage", "visit_skill_map", "visit_company"],
        },
      }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Kassenwart",
        cashCents: 2_000_000,
        xpTotal: 7_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  }, theme);
}

const SHOTS = process.env.NEXA_SHOT_DIR;

for (const theme of ["dark", "light"] as const) {
  test(`the founder withdraws once every 6 hours (${theme})`, async ({ page }, info) => {
    test.skip(theme === "light" && !SHOTS, "the light run only takes screenshots");
    const shot = async (name: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${info.project.name}.png` });
    };
    await page.clock.setFixedTime(new Date());
    await preparePlayer(page, theme);
    await page.goto("/company");
    await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
    const sheet = page.getByRole("dialog", { name: "Firma gründen" });
    await sheet.getByLabel("Firmenname").fill("Kassenhaus");
    await sheet.getByLabel("Deine Idee in einem Satz").fill("Kassen für alle.");
    await expect(sheet.getByText("Name ist frei")).toBeVisible();
    await hold(page, /Gedrückt halten zum Gründen/);
    await expect(page.getByText("Firma gegründet!")).toBeVisible();

    await showOverview(page);
    await showPane(page, "group-money", "Kasse & Auszahlung");
    const till = page.getByTestId("treasury").locator("..");
    await expect(till.getByTestId("withdraw-ready")).toContainText("alle 6 Stunden");
    const button = till.getByTestId("withdraw-button");
    await expect(button).toBeEnabled();
    await button.click();
    const withdraw = page.getByRole("dialog", { name: "Entnehmen" });
    await expect(withdraw.getByTestId("withdraw-rhythm")).toContainText("alle 6 Stunden");
    await withdraw.getByLabel(/Betrag/).fill("100");
    await withdraw.getByRole("button", { name: /100 € entnehmen/ }).click();
    await expect(withdraw).toBeHidden();

    // The pause: countdown in the till, the button waits and names the rest.
    const next = till.getByTestId("withdraw-next");
    await expect(next).toContainText("Nächste Entnahme in 0");
    await expect(button).toBeDisabled();
    await expect(button).toContainText("wieder in");
    await next.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await shot("withdraw-next");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // 6 hours later it works again.
    await jumpClock(page, 6);
    await page.reload();
    await showPane(page, "group-money", "Kasse & Auszahlung");
    await expect(till.getByTestId("withdraw-ready")).toBeVisible();
    await expect(button).toBeEnabled();
  });
}
