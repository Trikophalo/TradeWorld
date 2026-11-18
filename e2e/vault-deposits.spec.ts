import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * ADR-201 in demo mode: the open vault shows its yield with the level bonus and the Festgeld; the upgrade groups fold
 * open and closed and remember it.
 */
const TOURS = ["first_job", "limit_orders", "bonds", "found_garage", "visit_skill_map", "artworks", "property"];

async function preparePlayer(page: Page, player: Record<string, unknown>) {
  await page.addInitScript(
    ({ player, tours }) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({ demo: { status: "done", step: 0, seenTours: tours } }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({ tutorialCompleted: true, curveVersion: 2, ...player }),
      );
    },
    { player, tours: TOURS },
  );
}

async function hold(page: Page, target: Locator) {
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(async () => {
    const a = await target.boundingBox();
    await page.waitForTimeout(100);
    const b = await target.boundingBox();
    expect(a && b && Math.abs(a.y - b.y) < 1).toBe(true);
  }).toPass();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
}

test("vault: yield with the level bonus, Festgeld in and out", async ({ page }) => {
  await preparePlayer(page, { nickname: "Tresorfan", cashCents: 2_000_000, xpTotal: 20_000 });
  await page.goto("/");
  const sources = page.getByTestId("vault-sources");
  await expect(async () => {
    if (!(await sources.isVisible())) await page.getByTestId("vault-open").click();
    await expect(sources).toBeVisible({ timeout: 1_500 });
  }).toPass();

  // a level above 1 pays more than the plain 100 € an hour
  await expect(page.getByTestId("vault-yield-level")).toContainText(/\+\d+,00\s%/);
  await expect(page.getByTestId("vault-boosts").locator('[data-boost="deposits"]')).toBeVisible();

  const deposits = page.getByTestId("vault-deposits");
  await deposits.getByTestId("vault-deposit-amount").fill("2000");
  await deposits.getByRole("radio", { name: /1 Tag/ }).click();
  await expect(deposits.getByTestId("vault-deposit-preview")).toContainText("2.030,00");
  await deposits.getByTestId("vault-deposit-submit").click();
  await expect(page.getByText("Festgeld angelegt").first()).toBeVisible();
  const row = deposits.getByTestId("vault-deposit");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("+30,00");

  await hold(page, row.getByRole("button", { name: /Auflösen/ }));
  await expect(page.getByText("Festgeld aufgelöst").first()).toBeVisible();
  await expect(deposits.getByTestId("vault-deposit")).toHaveCount(0);
});

test("upgrades: groups fold, say what they hold and remember it", async ({ page }) => {
  await preparePlayer(page, { nickname: "Klappfan", cashCents: 2_000_000, xpTotal: 20_000 });
  await page.goto("/upgrades");
  const vaultGroup = page.getByTestId("upgrade-group-vault");
  // something is buyable: open on the first visit
  await expect(vaultGroup).toHaveAttribute("data-open", "true");
  await expect(page.getByTestId("upgrade-vault")).toBeVisible();
  const toggle = page.getByTestId("section-upgrades-vault");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(vaultGroup).toHaveAttribute("data-open", "false");
  await expect(page.getByTestId("upgrade-vault")).toBeHidden();
  await expect(toggle).toContainText(/0\/30 gekauft · nächste ab/);

  await page.reload();
  await expect(page.getByTestId("upgrade-group-vault")).toHaveAttribute("data-open", "false");
  await page.getByTestId("section-upgrades-vault").click();
  await expect(page.getByTestId("upgrade-vault")).toBeVisible();
});
