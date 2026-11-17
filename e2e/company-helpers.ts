import { expect, type Page } from "@playwright/test";

/*
 * The own company page has five tabs (ADR-167): Dashboard first, then Controlling with every lever, Mitarbeiter with
 * team, tasks and chat, and for listed companies Buchhaltung and Geschäftsrat. Controlling and parts of the dashboard
 * fold into sections (ADR-138). Tests that check them open every section up front and switch to the tab.
 */
const ALL_SECTIONS = [
  // Dashboard
  "details",
  "situation",
  "numbers",
  "history",
  // Controlling
  "profit",
  "business",
  "marketing",
  "moves",
  "expansion",
  "money",
  "capital",
  "brand",
  "research",
  "growth",
  "dividends",
];

export async function unfoldCompany(page: Page) {
  await page.addInitScript((ids) => {
    try {
      window.localStorage.setItem("nexa-company-sections", JSON.stringify(ids));
    } catch {
      // ignore
    }
  }, ALL_SECTIONS);
}

export type CompanyTabName = "Dashboard" | "Controlling" | "Mitarbeiter" | "Buchhaltung" | "Geschäftsrat";

export async function showTab(page: Page, name: CompanyTabName) {
  const tab = page.getByTestId("company-tabs").getByRole("tab", { name: new RegExp(name) });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** The levers (the former overview) live on the Controlling tab. */
export async function showOverview(page: Page) {
  await showTab(page, "Controlling");
}

/**
 * Merged cards (ADR-187) show one pane at a time: switches the card `section-<group>` to the pane with that label.
 * Panes: group-offer (Preise & Strategie, Produktion), group-marketing (Budget & Kampagnen, Geschäftszüge),
 * group-money (Kasse & Auszahlung, Kapital & Börse, Dividenden), group-growth (Wachstum & Ausbau, Forschung,
 * Produkte & Märkte), group-team (Team & Plätze, Stimmung, Wert des Teams).
 */
export async function showPane(page: Page, group: string, label: string) {
  const card = page.getByTestId(`firm-section-${group}`);
  await expect(card).toBeVisible();
  const option = card.getByRole("radio", { name: label, exact: true });
  // A card with a single pane (e.g. growth of a private company) has no switch; while data reloads it may show up late.
  try {
    await option.waitFor({ timeout: 8_000 });
  } catch {
    if ((await card.getByRole("radio").count()) === 0) return;
    throw new Error(`pane "${label}" not found in ${group}`);
  }
  await option.click();
  await expect(option).toHaveAttribute("aria-checked", "true");
}

export async function showDashboard(page: Page) {
  await showTab(page, "Dashboard");
}

export async function showStaff(page: Page) {
  await showTab(page, "Mitarbeiter");
}

/** A level-12 founder with money, tutorial and tours done (once per browser session). */
export async function prepareRichFounder(page: Page, nickname = "Boersenstar") {
  await unfoldCompany(page);
  await page.addInitScript((name) => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({
        demo: {
          status: "done",
          step: 0,
          seenTours: [
            "first_job",
            "limit_orders",
            "bonds",
            "found_garage",
            "visit_skill_map",
            "visit_company",
            "visit_listing",
            "artworks",
            "visit_artworks",
          ],
        },
      }),
    );
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: name,
        cashCents: 30_000_000,
        xpTotal: 80_000,
        tutorialCompleted: true,
        curveVersion: 2,
      }),
    );
  }, nickname);
}

/** Press and hold a hold-button until it confirms. */
export async function hold(page: Page, name: RegExp) {
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

/**
 * Founds a small business and takes it public (demo: the subscription ends with the quarter). Ends on the
 * Controlling tab of a listed company with closed hours.
 */
export async function foundListedCompany(page: Page, name = "Pixelwerft") {
  await page.goto("/company");
  await page.locator('[data-tier="small_business"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill(name);
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Logos für alle Firmen der Welt.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();
  await showOverview(page);
  await showPane(page, "group-money", "Kapital & Börse");
  const listing = page.getByTestId("listing");
  await listing.getByRole("button", { name: "Börsengang" }).click();
  await page.getByRole("dialog", { name: "Börsengang" }).getByRole("button", { name: "Zeichnung starten" }).click();
  await expect(page.getByText("Börsengang gestartet")).toBeVisible();
  const header = page.getByTestId("company-header");
  await header.getByText("Demo: Quartal jetzt abschließen").click();
  await expect(listing.getByText(/An der Börse als/)).toBeVisible();
  // One more quarter: hours with revenue under the listed rules (books, history, reference revenue).
  await header.getByText("Demo: Quartal jetzt abschließen").click();
  await expect(page.getByTestId("company-tabs").getByRole("tab", { name: /Buchhaltung/ })).toBeVisible();
  // The demo button stamps those hours ahead of the clock; the books only count what lies in the past.
  await jumpClock(page, 13);
  await page.reload();
  await expect(page.getByTestId("company-tabs")).toBeVisible();
}

/**
 * Moves "now" forward (timers keep running, only the date jumps) so the demo engine catches up the hours in between.
 * The daily reward of the new day is marked as seen, it would cover the page. Reload or navigate afterwards.
 */
export async function jumpClock(page: Page, hours: number) {
  const next = (await page.evaluate(() => Date.now())) + hours * 3_600_000;
  await page.clock.setFixedTime(new Date(next));
  await page.evaluate((at) => {
    for (const offset of [0, 1]) {
      const day = new Date(at + offset * 86_400_000).toDateString();
      if (offset === 0) window.sessionStorage.setItem("nexa-daily-reward-seen", day);
    }
  }, next);
}
