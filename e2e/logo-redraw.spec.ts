import { expect, test, type Page } from "@playwright/test";
import { showOverview, unfoldCompany } from "./company-helpers";

/*
 * Redrawing the company logo (ADR-200), demo mode: found a GmbH, draw the first logo, then redraw it for 50.000 € from
 * the company cash in Controlling → Marke & Firma. The second redraw waits for the cooldown.
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
        nickname: "Logomalerin",
        cashCents: 30_000_000,
        xpTotal: 200_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  }, theme);
}

async function hold(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_600);
  await page.mouse.up();
}

async function paint(page: Page, row: number) {
  const board = page.getByTestId("logo-board");
  await page.waitForTimeout(900); // the panel slides in
  const box = (await board.boundingBox())!;
  const cell = box.width / 16;
  await page.mouse.move(box.x + cell * 2.5, box.y + cell * (row + 0.5));
  await page.mouse.down();
  for (let x = 3; x < 8; x++) await page.mouse.move(box.x + cell * (x + 0.5), box.y + cell * (row + 0.5), { steps: 2 });
  await page.mouse.up();
}

const SHOTS = process.env.NEXA_SHOT_DIR;

for (const theme of ["dark", "light"] as const) {
  test(`the founder redraws the logo for 50.000 € (${theme})`, async ({ page }, info) => {
    test.skip(theme === "light" && !SHOTS, "the light run only takes screenshots");
    const shot = async (name: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${info.project.name}.png` });
    };
    await preparePlayer(page, theme);
    await page.goto("/company");
    await page.locator('[data-tier="gmbh"]').getByRole("button", { name: "Gründen" }).click();
    const sheet = page.getByRole("dialog", { name: "Firma gründen" });
    await sheet.getByLabel("Firmenname").fill("Pinselwerk");
    await sheet.getByLabel("Deine Idee in einem Satz").fill("Neue Logos für alte Firmen.");
    await expect(sheet.getByText("Name ist frei")).toBeVisible();
    await hold(page, /Gedrückt halten zum Gründen/);
    await expect(page.getByText("Firma gegründet!")).toBeVisible();

    await page.getByTestId("logo-prompt").getByRole("button", { name: "Logo zeichnen" }).click();
    await paint(page, 4);
    await hold(page, /Gedrückt halten: Logo festlegen/);
    await expect(page.getByText("Logo gespeichert")).toBeVisible();

    await showOverview(page);
    const brand = page.getByTestId("brand");
    const redraw = brand.getByTestId("logo-redraw");
    await expect(redraw).toHaveText("Logo neu zeichnen · 50.000 €");
    await redraw.scrollIntoViewIfNeeded();
    await shot("brand");
    await redraw.click();

    const editor = page.getByRole("dialog", { name: "Logo neu zeichnen" });
    await expect(editor).toBeVisible();
    // Starts with the current logo: nothing changed yet, so "Weiter" waits.
    await expect(page.getByTestId("logo-redraw-next")).toBeDisabled();
    await paint(page, 9);
    await expect(page.getByTestId("logo-redraw-next")).toBeEnabled();
    await shot("editor");
    await page.getByTestId("logo-redraw-next").click();

    const confirm = page.getByTestId("logo-redraw-sheet");
    await expect(confirm).toBeVisible();
    await page.waitForTimeout(600);
    await shot("confirm");
    await confirm.getByTestId("logo-redraw-confirm").click();
    await expect(page.getByText("Dein neues Logo ist überall zu sehen.")).toBeVisible();

    // Once a day: the button waits for the cooldown.
    await expect(redraw).toBeDisabled();
    await expect(brand.getByTestId("logo-redraw-block")).toContainText("Wieder möglich in");
    await page.waitForTimeout(600);
    await shot("cooldown");
  });
}
