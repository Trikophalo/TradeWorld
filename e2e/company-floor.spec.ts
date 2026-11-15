import { expect, test, type Page } from "@playwright/test";

/*
 * The company floor (ADR-156): everybody at the workplace as their dressed figure, speech bubbles over the figures.
 * Demo mode: an employee of an AI company with made-up colleagues, and a founder writing into the office.
 */
const TOURS = [
  "first_job",
  "limit_orders",
  "bonds",
  "found_garage",
  "visit_skill_map",
  "visit_company",
  "visit_listing",
  "property",
  "visit_property",
];
const ZERO = { it: 0, finance: 0, law: 0, craft: 0, sales: 0, management: 0, science: 0, logistics: 0 };

async function hold(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
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

async function prepare(page: Page, player: Record<string, unknown>) {
  await page.addInitScript(
    ({ player, tours }) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({ demo: { status: "done", step: 0, seenTours: tours } }),
      );
      window.localStorage.setItem("nexa-demo-player-v2", JSON.stringify(player));
    },
    { player, tours: TOURS },
  );
}

test("job page: the colleagues stand in the office as dressed figures and open their profile", async ({ page }) => {
  const now = Date.now();
  await prepare(page, {
    nickname: "Buerofee",
    cashCents: 2_000_000,
    xpTotal: 7_000,
    tutorialCompleted: true,
    curveVersion: 2,
    wardrobe: { owned: ["cowboy_hat"], worn: ["cowboy_hat"] },
    career: {
      avatarKey: "coder",
      learned: [],
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
      },
    },
  });
  await page.goto("/job");
  const office = page.getByTestId("office");
  await expect(office).toBeVisible();
  await expect(office).toContainText("KlarSoft");
  const people = office.getByTestId("office-person");
  await expect(people).toHaveCount(4);
  const me = office.locator('[data-testid="office-person"][data-me="true"]');
  await expect(me).toHaveAttribute("data-nickname", "Buerofee");
  // One colleague is away and sleeps; at an AI company nobody can write into the office.
  await expect(office.locator('[data-online="false"]')).toHaveCount(1);
  await expect(office.getByTestId("office-zzz")).toHaveCount(1);
  await expect(office.getByTestId("office-say")).toHaveCount(0);
  // The scene never scrolls the page sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const colleague = office.locator('[data-testid="office-person"][data-me="false"]').first();
  const name = (await colleague.getAttribute("data-nickname"))!;
  await colleague.click();
  await expect(page).toHaveURL(new RegExp(`/players/${name}$`));
  await expect(page.locator("#main")).toContainText(name);
});

test("company page: writing into the office shows a bubble over my figure and lands in the chat", async ({ page }) => {
  await prepare(page, {
    nickname: "Plaudertasche",
    cashCents: 2_000_000,
    xpTotal: 7_000,
    tutorialCompleted: true,
    curveVersion: 2,
  });
  await page.goto("/company");
  await page.locator('[data-tier="garage"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill("Schnackwerk");
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Kaffee für alle Büros.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();

  const office = page.getByTestId("office");
  const me = office.locator('[data-testid="office-person"][data-me="true"]');
  await expect(me).toHaveAttribute("data-nickname", "Plaudertasche");
  await expect(me.getByTestId("floor-bubble")).toHaveCount(0);

  const say = office.getByTestId("office-say");
  await say.getByPlaceholder("Sag was ins Büro …").fill("Kaffee ist fertig!");
  await say.getByRole("button", { name: "Sagen" }).click();
  await expect(me.getByTestId("floor-bubble")).toHaveText("Kaffee ist fertig!");
  await expect(say.getByPlaceholder("Sag was ins Büro …")).toHaveValue("");

  // The same words stand in the company chat.
  await page.getByRole("tab", { name: /Chat/ }).click();
  await expect(page.getByTestId("chat-messages")).toContainText("Kaffee ist fertig!");

  // My figure opens my profile.
  await me.click();
  await expect(page).toHaveURL(/\/players\/Plaudertasche$/);
});
