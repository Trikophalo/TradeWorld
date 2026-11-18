import { expect, test, type Page } from "@playwright/test";

/*
 * The clone (ADR-206) in demo mode: from level 20 the player creates a clone on the job tab, finds it a job in the
 * job portal ("Bewerben für: Meinen Klon"), signs and sees the clone's job next to the own one.
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
  "visit_nexamon",
];

async function preparePlayer(page: Page, xpTotal: number) {
  await page.addInitScript(
    ({ xpTotal, tours }) => {
      if (window.sessionStorage.getItem("nexa-test-prepared")) return;
      window.sessionStorage.setItem("nexa-test-prepared", "1");
      window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
      window.localStorage.setItem(
        "nexa-tutorial",
        JSON.stringify({ demo: { status: "done", step: 0, seenTours: tours } }),
      );
      window.localStorage.setItem(
        "nexa-demo-player-v2",
        JSON.stringify({
          nickname: "Klonfrau",
          cashCents: 10_000_000,
          xpTotal,
          tutorialCompleted: true,
          vaultClaimedAt: Date.now(),
          checkInDay: null,
          streakDays: 0,
          curveVersion: 2,
        }),
      );
    },
    { xpTotal, tours: TOURS },
  );
}

async function signContract(page: Page) {
  const contract = page.getByRole("dialog", { name: "Arbeitsvertrag" });
  await expect(contract).toContainText("Klon von Klonfrau");
  const sign = contract.getByRole("button", { name: "Unterschreiben" });
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
}

test("create a clone at level 22, apply for it and see its job", async ({ page }) => {
  // level 22
  await preparePlayer(page, 214_109);
  await page.goto("/job");
  const card = page.getByTestId("clone-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-clone", "none");
  await card.getByTestId("clone-create").click();
  await expect(page.getByText("Dein Klon ist da")).toBeVisible();
  await expect(page.getByTestId("clone-card")).toHaveAttribute("data-clone", "idle");

  await page.getByTestId("clone-portal").click();
  await expect(page).toHaveURL(/\/career\/jobs\?holder=clone/);
  const holder = page.getByTestId("holder-switch");
  await expect(holder).toBeVisible();
  await expect(holder.getByRole("radio", { name: "Meinen Klon" })).toHaveAttribute("aria-checked", "true");

  // Postings show the skill pay, the profit share and the share chance (ADR-206).
  const posting = page.locator("[data-posting]").filter({ hasText: "IT-Praktikum" }).first();
  await expect(posting.getByTestId("posting-perks")).toContainText("Gewinnbeteiligung ab Senior");
  await posting.getByRole("button", { name: "Bewerben" }).click();
  const apply = page.getByRole("dialog", { name: "Bewerbung für deinen Klon" });
  await expect(apply.getByTestId("ai-offer")).toBeVisible();
  await apply.getByRole("button", { name: "Bewerbung senden" }).click();
  await expect(page.getByText("Bewerbung gesendet")).toBeVisible();
  await expect(page.locator('[data-application="offered"]')).toBeVisible();
  await page.getByRole("button", { name: "Vertrag ansehen" }).click();
  await signContract(page);

  // The clone's job is on the job tab; the own one is still free.
  await page.goto("/job");
  await expect(page.getByText("Du hast gerade keinen Job.")).toBeVisible();
  const cloneJob = page.getByTestId("clone-job");
  await expect(cloneJob).toBeVisible();
  await expect(cloneJob).toContainText("Klon von Klonfrau");
  await expect(cloneJob).toContainText("KlarSoft");
  await expect(cloneJob.getByTestId("job-rewards")).toBeVisible();

  // Back in the portal for myself the clone's application does not count as mine.
  await page.goto("/career/jobs");
  await page.getByTestId("holder-switch").getByRole("radio", { name: "Mich" }).click();
  await expect(
    page
      .locator("[data-posting]")
      .filter({ hasText: "IT-Praktikum" })
      .first()
      .getByRole("button", { name: "Bewerben" }),
  ).toBeVisible();
});

test("below level 20 the clone is shown locked", async ({ page }) => {
  // level 16: disclosed (15), not yet usable (20)
  await preparePlayer(page, 120_000);
  await page.goto("/job");
  const card = page.getByTestId("clone-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("clone-create")).toHaveCount(0);
  await expect(card).toContainText("Ab Level 20");
});
