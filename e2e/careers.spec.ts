import { expect, test, type Page } from "@playwright/test";

/*
 * Daily reward, profile picture, skill tree, job portal and business card, in demo mode.
 * The player starts at level 6 (5 free skill points), like a returning player.
 */
async function preparePlayer(
  page: Page,
  options: { dailySeen?: boolean; xpTotal?: number; seenTours?: string[] } = {},
) {
  await page.addInitScript(
    ({ dailySeen, xpTotal, seenTours }) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      if (dailySeen) window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem("nexa-tutorial", JSON.stringify({ demo: { status: "done", step: 0, seenTours } }));
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({
          nickname: "Karrierefrau",
          cashCents: 1_000_000,
          xpTotal,
          tutorialCompleted: true,
          vaultClaimedAt: Date.now(),
          checkInDay: null,
          streakDays: 0,
        }),
      );
    },
    {
      dailySeen: options.dailySeen ?? true,
      xpTotal: options.xpTotal ?? 3_000,
      seenTours: options.seenTours ?? ["first_job", "limit_orders", "bonds"],
    },
  );
}

/** Press and hold a hold-to-confirm button until it fires. */
async function hold(page: Page, name: string | RegExp) {
  const button = page.getByRole("button", { name });
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
}

test("the daily reward opens once and pays day 1", async ({ page }) => {
  await preparePlayer(page, { dailySeen: false });
  await page.goto("/");
  const sheet = page.getByRole("dialog", { name: "Tägliche Belohnung" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Heute")).toBeVisible();
  await sheet.getByRole("button", { name: "Abholen" }).click();
  await expect(page.getByText("Tag 1 abgeholt")).toBeVisible();
  await expect(sheet.getByText("Abgeholt", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Weiter" }).click();
  await expect(sheet).toBeHidden();
  // Claimed: no reminder card on the start page, no popup after a reload.
  await page.reload();
  await expect(page.getByText("Dein Vermögen")).toBeVisible();
  await page.waitForTimeout(1_200);
  await expect(page.getByRole("dialog", { name: "Tägliche Belohnung" })).toBeHidden();
});

test("learn a skill on the map, apply to an AI company, sign, work and quit", async ({ page }) => {
  await preparePlayer(page);

  // Skill tree: 5 free points from the level-ups.
  await page.goto("/career/skills");
  await expect(page.getByTestId("free-points")).toHaveText("5");
  await page.locator('[data-skill="it_basics"]').click();
  await hold(page, "Für immer lernen");
  await expect(page.getByText("Neuer Skill: IT-Grundlagen")).toBeVisible();
  await expect(page.getByTestId("free-points")).toHaveText("4");
  await expect(page.locator('[data-skill="it_basics"]')).toHaveAttribute("data-state", "learned");
  await expect(page.locator('[data-skill="it_programming"]')).toHaveAttribute("data-state", "ok");

  // Job portal: the IT internship at KlarSoft.
  await page.goto("/career/jobs");
  const posting = page.locator("[data-posting]").filter({ hasText: "IT-Praktikum" }).first();
  await expect(posting).toBeVisible();
  await posting.getByRole("button", { name: "Bewerben" }).click();
  const apply = page.getByRole("dialog", { name: "Bewerbung" });
  // AI employers have no salary wish: they offer their maximum (ADR-064).
  await expect(apply.getByTestId("ai-offer")).toBeVisible();
  await apply.getByLabel("Ein Satz über dich").fill("Ich lerne schnell und liebe Code.");
  await apply.getByRole("button", { name: "Bewerbung senden" }).click();
  await expect(page.getByText("Bewerbung gesendet")).toBeVisible();

  // AI employers answer at once: an offer.
  await expect(page.locator('[data-application="offered"]')).toBeVisible();
  await page.getByRole("button", { name: "Vertrag ansehen" }).click();
  const contract = page.getByRole("dialog", { name: "Arbeitsvertrag" });
  const sign = contract.getByRole("button", { name: "Unterschreiben" });
  await expect(sign).toBeDisabled();
  const padArea = contract.getByTestId("signature-pad");
  await padArea.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600); // the sheet slides in
  const pad = (await padArea.boundingBox())!;
  await page.mouse.move(pad.x + 20, pad.y + pad.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(pad.x + 20 + i * 18, pad.y + pad.height * (i % 2 ? 0.35 : 0.65), { steps: 3 });
  }
  await page.mouse.up();
  await expect(sign).toBeEnabled();
  await sign.click();
  await expect(page.getByText("Willkommen im Team!")).toBeVisible();

  // The job tab (ADR-064): work runs by itself, the worker sits at the desk.
  await page.goto("/job");
  await expect(page.getByRole("heading", { name: "IT-Praktikum" })).toBeVisible();
  await expect(page.getByTestId("worker")).toBeVisible();
  await expect(page.getByText(/× KI-Kraft/)).toBeVisible();
  await expect(page.getByTestId("employer")).toContainText("KlarSoft");

  // The salary also shows next to the basic income at the vault.
  await page.goto("/");
  await expect(page.getByTestId("vault-job-income")).toBeVisible();

  // Quitting is free, with one day notice (ADR-063); it can be taken back.
  await page.goto("/job");
  await page.getByRole("button", { name: "Kündigen" }).click();
  await expect(page.getByText(/ohne Kosten mit einem Tag Frist/)).toBeVisible();
  await hold(page, "Gedrückt halten zum Kündigen");
  await expect(page.getByText("Gekündigt", { exact: true })).toBeVisible();
  await expect(page.getByTestId("notice")).toBeVisible();
  await page.getByRole("button", { name: "Kündigung zurücknehmen" }).click();
  await expect(page.getByText("Kündigung zurückgenommen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Kündigen" })).toBeVisible();
});

test("pick a profile picture and see it on the business card", async ({ page }) => {
  await preparePlayer(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Profilbild ändern" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Profilbild wählen" });
  // Level 6: the gamer (level 5) is free, the pilot (level 8) still locked.
  await expect(sheet.getByRole("radio", { name: "Pilotin, ab Level 8" })).toBeDisabled();
  await sheet.getByRole("radio", { name: "Gamerin" }).click();
  await sheet.getByRole("button", { name: "Profilbild ändern" }).click();
  await expect(page.getByText("Profilbild gespeichert")).toBeVisible();

  // The rich list links to the business card.
  await page.goto("/rich-list");
  await page.locator('a[href="/players/Karrierefrau"]').first().click();
  await expect(page).toHaveURL("/players/Karrierefrau");
  const card = page.getByTestId("business-card");
  await expect(card.getByText("Karrierefrau")).toBeVisible();
  await expect(card.getByText("Level 6", { exact: false })).toBeVisible();
});

test("reaching level 2 starts Finn's job tour", async ({ page }) => {
  // 80 XP: one trade (+20) reaches level 2 (100 XP).
  await preparePlayer(page, { xpTotal: 80, seenTours: [] });
  await page.goto("/markets/VLT");
  await page.locator('[data-tour="buy"]').filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "VLT kaufen" });
  await dialog.getByLabel("Betrag in Euro").fill("200");
  await dialog.locator('[data-tour="order-confirm"] button').hover();
  await page.mouse.down();
  await expect(page.getByText("Aufgestiegen!")).toBeVisible({ timeout: 8000 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Weiter" }).click();
  const finn = page.locator("[data-tutorial]");
  await expect(finn).toContainText("Neu freigeschaltet: Jobs!");
  await finn.getByRole("button").last().click();
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" }).filter({ visible: true });
  await nav.getByRole("link", { name: "Karriere" }).click();
  await expect(page).toHaveURL("/career");
  await expect(finn).toContainText("Hier steht dein Job");
});
