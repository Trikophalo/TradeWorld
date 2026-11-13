import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * Upgrades, career ladder, skill point guide (ADR-093 to ADR-095), deals and trust, profit routes and campaigns
 * (ADR-096 to ADR-098) in demo mode.
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

const ZERO = { it: 0, finance: 0, law: 0, craft: 0, sales: 0, management: 0, science: 0, logistics: 0 };

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
  await target.scrollIntoViewIfNeeded();
  // Settle first: a click during a layout animation would miss.
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

test("upgrades: buy a bigger vault, the vault card links to the shop", async ({ page }) => {
  await preparePlayer(page, { nickname: "Sparfuchs", cashCents: 2_000_000, xpTotal: 7_000 });
  await page.goto("/");
  // The home page still moves while it loads; retry the click until the link has navigated.
  await expect(async () => {
    if (!page.url().endsWith("/upgrades")) await page.getByTestId("vault-upgrade").click();
    await expect(page).toHaveURL(/\/upgrades$/, { timeout: 1_500 });
  }).toPass();

  const vault = page.getByTestId("upgrade-vault");
  await expect(vault.getByTestId("upgrade-level")).toHaveText("Stufe 0 von 6");
  await expect(vault.getByTestId("upgrade-effect")).toContainText("8 h Platz");
  await expect(vault.getByTestId("upgrade-effect")).toContainText("10 h Platz");
  await hold(page, vault.getByRole("button", { name: /3\.000 €/ }));
  await expect(page.getByText("Verbessert!").first()).toBeVisible();
  await expect(vault.getByTestId("upgrade-level")).toHaveText("Stufe 1 von 6");
  await expect(vault.getByRole("button", { name: /6\.000 €/ })).toBeVisible();
  await expect(page.getByTestId("upgrades-cash")).toHaveText(/17\.000,00/);

  // Overtime needs level 5: the player is level 6, rhetoric too; nothing is locked here.
  await expect(page.getByTestId("upgrade-overtime").getByText("Ab Level 5")).toHaveCount(0);
});

test("career ladder: requirements, asking the boss, skill point guide", async ({ page }) => {
  const now = Date.now();
  await preparePlayer(page, {
    nickname: "Aufsteigerin",
    cashCents: 2_000_000,
    xpTotal: 7_000,
    career: {
      avatarKey: "coder",
      learned: [],
      bonusPoints: 0,
      spentFree: 0,
      branchPoints: ZERO,
      workMinutes: { ...ZERO, it: 120 },
      dailyDay: 0,
      dailyClaimedOn: null,
      freezeUsedWeek: null,
      applications: [],
      seq: 1,
      job: {
        id: "job-e2e",
        postingId: "posting-KLS-1",
        salary: 15_000,
        startedAt: now - 86_400_000,
        lastPaidAt: now,
        payDay: "",
        paidMinutesToday: 0,
        earnedTotal: 0,
        scoreAtRaise: 0,
        lastRaiseAt: null,
        signature: "",
        rankMinutes: 13 * 60,
      },
    },
  });
  await page.goto("/job");
  const ladder = page.getByTestId("career-ladder");
  await expect(ladder.locator('[data-rung="intern"]')).toHaveAttribute("data-state", "current");
  const next = ladder.getByTestId("next-rank");
  await expect(next).toContainText("Nächste Stufe: Junior");
  // Level and hours are met, IT is missing: the boss cannot be asked yet.
  await expect(next.locator('[data-requirement="level"]')).toHaveAttribute("data-met", "true");
  await expect(next.locator('[data-requirement="hours"]')).toHaveAttribute("data-met", "true");
  await expect(next.locator('[data-requirement="branch"]')).toHaveAttribute("data-met", "false");
  await expect(next.getByTestId("ask-promotion")).toBeDisabled();
  await expect(page.getByTestId("pay-routes")).toContainText("Beförderung");

  // The guide on the skill map explains where points come from.
  await next.getByRole("link", { name: "Zur Skill-Karte" }).click();
  await expect(page).toHaveURL(/\/career\/skills$/);
  const guide = page.getByTestId("skill-guide");
  await expect(guide.getByTestId("source-work")).toContainText("Alle 6 Arbeitsstunden");
  await expect(guide.getByTestId("source-level")).toContainText("bis Level");
  await expect(guide).toContainText("Was bringen Skills?");
});

test("career ladder: ready, the AI boss answers", async ({ page }) => {
  const now = Date.now();
  await preparePlayer(page, {
    nickname: "Bereitschaft",
    cashCents: 2_000_000,
    xpTotal: 7_000,
    career: {
      avatarKey: "coder",
      learned: [{ key: "it_programming", at: now - 3_600_000 }],
      bonusPoints: 0,
      spentFree: 0,
      branchPoints: ZERO,
      workMinutes: ZERO,
      dailyDay: 0,
      dailyClaimedOn: null,
      freezeUsedWeek: null,
      applications: [],
      seq: 1,
      job: {
        id: "job-e2e",
        postingId: "posting-KLS-1",
        salary: 15_000,
        startedAt: now - 86_400_000,
        lastPaidAt: now,
        payDay: "",
        paidMinutesToday: 0,
        earnedTotal: 0,
        scoreAtRaise: 0,
        lastRaiseAt: null,
        signature: "",
        rankMinutes: 13 * 60,
      },
    },
  });
  await page.goto("/job");
  const next = page.getByTestId("next-rank");
  await expect(next).toHaveAttribute("data-ready", "true");
  await expect(next.getByTestId("promotion-chance")).toContainText("40");
  await next.getByTestId("ask-promotion").click();
  // The answer is a dice roll: promoted (ladder moves up) or a no with a retry time.
  await expect(page.getByText(/Befördert!|Noch nicht/).first()).toBeVisible();
  await expect(
    page
      .getByTestId("career-ladder")
      .locator('[data-rung="junior"][data-state="current"]')
      .or(page.getByTestId("promotion-retry")),
  ).toBeVisible();
});

test("deals: accept a loan from the board, repay it on time, trust grows", async ({ page }) => {
  await preparePlayer(page, { nickname: "Vertrauensvoll", cashCents: 2_000_000, xpTotal: 7_000 });
  await page.goto("/deals");
  await expect(page.getByTestId("my-trust")).toContainText("50");
  await expect(page.getByTestId("my-trust")).toContainText("Unbeschrieben");

  const loan = page.getByTestId("deal").filter({ hasText: "Lina_Kontor" }).filter({ hasText: "Kredit" });
  await expect(loan.getByTestId("deal-you-get")).toContainText("Du bekommst 20.000 € und zahlst 21.200 € zurück.");
  await expect(loan.getByTestId("trust-badge")).toHaveAttribute("data-band", "rock");
  await hold(page, loan.getByRole("button", { name: /Annehmen/ }));
  await expect(page.getByText("Deal steht!").first()).toBeVisible();

  await page.goto("/deals?tab=mine");
  const running = page.locator('[data-section="running"]').getByTestId("deal");
  await expect(running).toHaveAttribute("data-status", "active");
  await running.getByTestId("deal-repay").click();
  await page.getByTestId("deal-repay-all").click();
  await expect(page.getByText("Zurückgezahlt").first()).toBeVisible();
  await expect(page.locator('[data-section="history"]').getByTestId("deal")).toHaveAttribute(
    "data-status",
    "completed",
  );
  // Repaid on time: +4.
  await expect(page.getByTestId("my-trust")).toContainText("54");
});

test("deals: propose a loan to a partner by name; the shaky partner shows a low trust", async ({ page }) => {
  await preparePlayer(page, { nickname: "Geldgeber", cashCents: 2_000_000, xpTotal: 7_000 });
  await page.goto("/deals?tab=board");
  await expect(
    page.getByTestId("deal").filter({ hasText: "Gluecksritter" }).first().getByTestId("trust-badge"),
  ).toHaveAttribute("data-band", "shaky");

  await page.goto("/deals?tab=new");
  const form = page.getByTestId("deal-form");
  await form.getByLabel("Mit wem? (Name oder #Tag)").fill("Werkbank_Ole");
  await form.getByLabel("Betrag in €").fill("5000");
  await form.getByLabel("Zinsen für die ganze Laufzeit in %").fill("5");
  await expect(form.getByTestId("deal-preview")).toContainText("Du verleihst 5.000 € und bekommst 5.250 € zurück.");
  await hold(page, form.getByRole("button", { name: /Senden/ }));
  await expect(page.getByText("Deal steht!").first()).toBeVisible();
  await expect(page).toHaveURL(/tab=mine/);
  await expect(page.locator('[data-section="running"]').getByTestId("deal").first()).toContainText("Werkbank_Ole");
});

test("company: profit routes name the bottleneck, a campaign starts", async ({ page }) => {
  await preparePlayer(page, { nickname: "Werbechefin", cashCents: 2_000_000, xpTotal: 7_000 });
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Lautwerk");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Kopfhörer für Baustellen.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, page.getByRole("button", { name: /Gedrückt halten zum Gründen/ }));
  await expect(page.getByText("Firma gegründet!")).toBeVisible();

  const routes = page.getByTestId("profit-routes");
  await expect(routes.getByTestId("bottleneck")).toHaveAttribute("data-kind", "waiting");
  await page.getByTestId("company-header").getByText("Demo: Quartal jetzt abschließen").click();
  await expect(routes.getByTestId("bottleneck")).not.toHaveAttribute("data-kind", "waiting");
  await expect(routes.locator('[data-route="contract"]')).toHaveAttribute("data-state", "active");
  await expect(routes.locator('[data-route="supplySell"]').getByRole("link", { name: "Zu den Deals" })).toBeVisible();

  const campaign = page.getByTestId("campaign");
  await hold(page, campaign.locator('[data-campaign="flyer"]').getByRole("button", { name: /Gedrückt halten/ }));
  await expect(page.getByText("Kampagne gestartet").first()).toBeVisible();
  await expect(campaign.getByTestId("campaign-running")).toContainText("Läuft: Flyer");
  await expect(routes.locator('[data-route="campaign"]')).toHaveAttribute("data-state", "active");
});
