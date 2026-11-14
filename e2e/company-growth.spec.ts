import { expect, test, type Page } from "@playwright/test";

/*
 * Profit levers, endless growth and friends in demo mode (ADR-083, ADR-084).
 */
const TOURS = [
  "first_job",
  "limit_orders",
  "bonds",
  "found_garage",
  "visit_skill_map",
  "visit_company",
  "visit_listing",
  "artworks",
  "visit_artworks",
  "property",
  "visit_property",
];

async function preparePlayer(page: Page, nickname: string, xpTotal: number, cashCents: number) {
  await page.addInitScript(
    ({ nickname, xpTotal, cashCents, tours }) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({ demo: { status: "done", step: 0, seenTours: tours } }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({ nickname, cashCents, xpTotal, tutorialCompleted: true, curveVersion: 2 }),
      );
    },
    { nickname, xpTotal, cashCents, tours: TOURS },
  );
}

async function hold(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
  // Into the middle of the screen: at the lower edge the tab bar would cover it on phones.
  await button.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // Settle first: page content rises in (ADR-108), a press during that would miss.
  await expect(async () => {
    const a = await button.boundingBox();
    await page.waitForTimeout(100);
    const b = await button.boundingBox();
    expect(a && b && Math.abs(a.y - b.y) < 1).toBe(true);
  }).toPass();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1_200);
  await page.mouse.up();
}

async function found(page: Page, tier: string, name: string, idea = "Ein Produkt, das jeder braucht.") {
  await page.goto("/company");
  await page.locator(`[data-tier="${tier}"]`).getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill(name);
  await sheet.getByLabel("Deine Idee in einem Satz").fill(idea);
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();
}

test("profit coach, price strategy, contract work, IPO from the garage, staff open profiles", async ({ page }) => {
  // Level 9: going public is open (unlock order, ADR-099).
  await preparePlayer(page, "Kassenwart", 21_000, 2_000_000);
  await found(page, "garage", "Rechenhaus");

  // Before the first hour the coach waits; a demo quarter runs the hours.
  const coach = page.getByTestId("profit-coach");
  await expect(coach.getByText("Die erste Stunde läuft")).toBeVisible();
  await page.getByTestId("company-header").getByText("Demo: Quartal jetzt abschließen").click();
  await expect(coach.getByTestId("hour-flow")).toBeVisible();
  await expect(coach.getByTestId("hour-flow")).toContainText("Auftragsarbeit");
  await expect(coach.locator("[data-tip]").first()).toBeVisible();

  // Strategy: contract work runs on its own (ADR-127); switching to budget prices is saved.
  const strategy = page.getByTestId("strategy");
  await expect(strategy.getByTestId("contract-auto")).toBeVisible();
  await strategy.getByRole("radio", { name: "Günstig" }).click();
  await expect(page.getByText("Strategie gespeichert").first()).toBeVisible();
  await expect(strategy.getByRole("radio", { name: "Günstig" })).toHaveAttribute("aria-checked", "true");

  // A garage cannot expand yet; going public is open from level 9 (ADR-083, ADR-099).
  await expect(page.getByTestId("expansion-locked")).toBeVisible();
  await expect(page.getByTestId("listing").getByRole("button", { name: "Börsengang" })).toBeVisible();

  // Automatic CEO payout (ADR-086): set the share, the vault on the start page lists it as an income source.
  const payout = page.getByTestId("payout");
  await payout.getByRole("slider").focus();
  await page.keyboard.press("End");
  await expect(payout.getByTestId("payout-percent")).toHaveText("100 %");
  await payout.getByRole("button", { name: "Auszahlung speichern" }).click();
  await expect(page.getByText("Auszahlung gespeichert").first()).toBeVisible();
  await page.goto("/");
  const sources = page.getByTestId("vault-sources");
  // Open once the page is interactive (a click before hydration does nothing).
  await expect(async () => {
    if (!(await sources.isVisible())) await page.getByTestId("vault-open").click();
    await expect(sources).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(sources.locator('[data-source="basic"]')).toContainText("Grundeinkommen");
  await expect(sources.locator('[data-source="ceo"]')).toContainText("100 % vom Gewinn");
  await page.goto("/company");

  // Staff in the office open their profile (ADR-084).
  await page.getByTestId("office-person").first().click();
  await expect(page).toHaveURL(/\/players\/Kassenwart$/);
  await expect(page.getByTestId("business-card").or(page.locator("#main")).first()).toContainText("Kassenwart");
  // No friend button on one's own profile.
  await expect(page.getByTestId("friend-button")).toHaveCount(0);
});

test("found a GmbH directly and expand it, step after step", async ({ page }) => {
  await preparePlayer(page, "Grossdenker", 80_000, 30_000_000);
  await page.goto("/company");
  await expect(page.locator('[data-tier="gmbh"]')).toContainText("Markt × 15");
  await found(page, "gmbh", "Weitblick");
  await expect(page.getByTestId("company-header").getByText("GmbH")).toBeVisible();

  // The first expansion costs 100.000 €, from the company's cash: 60.000 € are in, the rest is missing.
  const expansion = page.getByTestId("expansion");
  await expect(expansion.getByText("Stufe 0")).toBeVisible();
  await expect(expansion.getByText(/fehlen noch 40\.000/)).toBeVisible();
  await page
    .getByTestId("treasury")
    .locator("..")
    .getByRole("button", { name: /Einzahlen/ })
    .click();
  const deposit = page.getByRole("dialog", { name: "Einzahlen" });
  await deposit.getByLabel(/Betrag/).fill("100000");
  await deposit.getByRole("button", { name: /100\.000 € einzahlen/ }).click();
  await expect(page.getByText(/eingezahlt/i).first()).toBeVisible();

  await hold(page, /Auf Stufe 1 ausbauen/);
  await expect(page.getByText("Ausgebaut! Mehr Markt, mehr Platz.")).toBeVisible();
  await expect(expansion.getByText("Stufe 1")).toBeVisible();
  // The next step costs more (× 1,8) and the office has more places.
  await expect(expansion.getByRole("button", { name: /Auf Stufe 2 ausbauen · 180\.000/ })).toBeVisible();
  await expect(page.getByText("0 von 30 Plätzen belegt")).toBeVisible();
});

test("friends page: empty list, add by name, helpful errors", async ({ page }) => {
  await preparePlayer(page, "Freundlich", 7_000, 2_000_000);
  await page.goto("/friends?tab=friends");
  await expect(page.getByRole("heading", { level: 1, name: "Freunde" })).toBeVisible();
  await expect(page.getByText("Noch keine Freunde")).toBeVisible();

  const name = page.getByLabel("Spielername");
  await expect(page.getByRole("button", { name: "Anfrage schicken" })).toBeDisabled();
  await name.fill("freundlich");
  await page.getByRole("button", { name: "Anfrage schicken" }).click();
  await expect(page.getByText("Das bist du selbst.", { exact: false })).toBeVisible();
  await name.fill("Niemand123");
  await page.getByRole("button", { name: "Anfrage schicken" }).click();
  await expect(page.getByText(/nicht gefunden|gibt es nicht/i).first()).toBeVisible();

  // The own profile links to the friends page.
  await page.goto("/profile");
  await page
    .getByRole("link", { name: /Freunde/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/friends/);
});

test("company situation: a crisis or chance, a strategy, a step, the news", async ({ page }) => {
  await preparePlayer(page, "Krisenchefin", 7_000, 2_000_000);
  await found(page, "garage", "Blitzdose", "Energy Drinks mit extra Taurin für Gamer.");
  // The idea names the product: the Mini-KI writes about it (ADR-091).
  await expect(page.getByTestId("situation-calm")).toBeVisible();
  await page.getByTestId("demo-trigger-event").click();
  const situation = page.getByTestId("situation");
  await expect(situation).toBeVisible();
  await expect(situation.getByTestId("situation-headline")).not.toBeEmpty();

  // Choose the first strategy that takes real work.
  const picker = situation.getByTestId("strategy-picker");
  const working = picker
    .locator("[data-strategy]")
    .filter({ has: page.getByText(/Schritte?$/) })
    .first();
  await working.getByRole("button", { name: "Diese Strategie" }).click();
  await expect(page.getByText("Strategie gewählt").first()).toBeVisible();
  const path = situation.getByTestId("step-path");
  await expect(path.locator('[data-step-status="next"]')).toHaveCount(1);

  // Start the first step (paid from the company's cash), finish it at once in the demo.
  await path.getByTestId("start-step").click();
  await expect(page.getByText("Schritt gestartet").first()).toBeVisible();
  await expect(path.locator('[data-step-status="running"]')).toHaveCount(1);
  await situation.getByTestId("demo-finish-step").click();
  await expect(path.locator('[data-step-status="running"]')).toHaveCount(0);
  await expect(path.locator('[data-step-status="done"], [data-step-status="failed"]').first()).toBeVisible();

  // The news tell the story.
  const news = page.getByTestId("company-news");
  await expect(news.locator('[data-kind="event_started"]')).toHaveCount(1);
  await expect(news.locator('[data-kind="event_step_done"], [data-kind="event_step_failed"]').first()).toBeVisible();
});

test("business moves fit the product, cost company cash and run for minutes (ADR-127)", async ({ page }) => {
  await preparePlayer(page, "Zugmeister", 21_000, 2_000_000);
  await found(page, "garage", "Zugwerk");

  const card = page.getByTestId("company-moves");
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText("Geschäftszüge")).toBeVisible();
  // Six moves for every company plus six for the product.
  await expect(card.locator('[data-testid^="move-"]')).toHaveCount(12);

  await card.getByRole("radio", { name: "Geld" }).click();
  const first = card.locator('[data-testid^="move-"]').first();
  await first.getByRole("button", { name: "Starten" }).click();
  await expect(page.getByText("Zug gestartet").first()).toBeVisible();
  await expect(card.getByTestId("moves-running")).toBeVisible();
  // A garage has one slot: every other move waits.
  await expect(card.getByText("Alle Plätze belegt").first()).toBeVisible();
});
