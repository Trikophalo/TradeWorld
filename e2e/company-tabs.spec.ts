import { expect, test, type Page } from "@playwright/test";
import { foundListedCompany, hold, jumpClock, prepareRichFounder, showPane, showTab } from "./company-helpers";

/*
 * The own company page in tabs (ADR-167): Dashboard first, Controlling with the levers, Mitarbeiter with the chat,
 * and for listed companies the growth catalogue, satisfaction, Buchhaltung and Geschäftsrat. Demo mode.
 */

async function foundPrivate(page: Page, name: string) {
  await page.goto("/company");
  await page.locator('[data-tier="small_business"]').getByRole("button", { name: "Gründen" }).click();
  const sheet = page.getByRole("dialog", { name: "Firma gründen" });
  await sheet.getByLabel("Firmenname").fill(name);
  await sheet.getByLabel("Deine Idee in einem Satz").fill("Schrauben für alle.");
  await expect(sheet.getByText("Name ist frei")).toBeVisible();
  await hold(page, /Gedrückt halten zum Gründen/);
  await expect(page.getByText("Firma gegründet!")).toBeVisible();
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("private company: dashboard first, levers in controlling, chat in the staff tab, old links", async ({ page }) => {
  await prepareRichFounder(page, "Privatier");
  await foundPrivate(page, "Schraubenkoenig");

  // The dashboard is the first thing: numbers, charts, the to-do count, strengths and weaknesses (ADR-187).
  const tabs = page.getByTestId("company-tabs");
  await expect(tabs.getByRole("tab", { name: /Dashboard/ })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab").first()).toHaveAttribute("data-tab", "dashboard");
  const dashboard = page.getByTestId("company-dashboard");
  await expect(dashboard.getByTestId("stat-todo")).toBeVisible();
  await expect(dashboard.getByTestId("stat-cash")).toBeVisible();
  await expect(dashboard.getByTestId("company-health")).toBeVisible();
  await expect(page.getByTestId("mira-open")).toBeVisible();
  await page.getByTestId("company-header").getByText("Demo: Quartal jetzt abschließen").click();
  await expect(dashboard.getByTestId("hours-chart")).toBeVisible();
  await expect(dashboard.getByTestId("stat-profit")).toContainText("€");
  // ADR-180: the simple view: what the last hour says, the autopilot
  await expect(dashboard.getByTestId("company-pulse")).toContainText("Bekanntheit");
  // Listed-only numbers stay away, the teaser says what going public brings.
  await expect(dashboard.getByTestId("stat-satisfaction")).toHaveCount(0);
  await expect(dashboard.getByTestId("listed-teaser")).toContainText("Das bringt der Börsengang");
  await noSidewaysScroll(page);

  // Controlling: every lever, in merged cards with one pane at a time (ADR-187).
  await showTab(page, "Controlling");
  await expect(page).toHaveURL(/tab=controlling/);
  const controlling = page.getByTestId("company-controlling");
  for (const [group, pane, ids] of [
    ["group-offer", "Preise & Strategie", ["strategy"]],
    ["group-offer", "Produktion", ["production"]],
    ["group-marketing", "Budget & Kampagnen", ["campaign"]],
    ["group-marketing", "Geschäftszüge", ["company-moves"]],
    ["group-money", "Kasse & Auszahlung", ["treasury", "payout"]],
    ["group-money", "Kapital & Börse", ["listing"]],
  ] as const) {
    await showPane(page, group, pane);
    for (const id of ids) await expect(controlling.getByTestId(id)).toBeVisible();
  }
  await expect(controlling.getByTestId("brand")).toBeVisible();
  await expect(controlling.getByTestId("danger-zone")).toBeVisible();
  await expect(controlling.getByTestId("research-tree")).toHaveCount(0);
  await noSidewaysScroll(page);

  // Mitarbeiter: the to-do center, the autopilot, the team and the chat in one tab.
  await showTab(page, "Mitarbeiter");
  const staff = page.getByTestId("company-staff");
  await expect(staff.getByTestId("company-todo")).toBeVisible();
  await expect(staff.getByTestId("company-autopilot")).toBeVisible();
  await expect(staff.getByTestId("office")).toBeVisible();
  await expect(staff.getByTestId("seats")).toBeVisible();
  await expect(staff.getByTestId("task-board")).toBeVisible();
  const chat = staff.getByTestId("staff-chat");
  await chat.getByPlaceholder("Nachricht an dein Team").fill("Hallo Team!");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.getByTestId("chat-messages").getByText("Hallo Team!")).toBeVisible();
  await expect(staff.getByTestId("satisfaction")).toHaveCount(0);
  await noSidewaysScroll(page);

  // Listed-only tabs are locked with a teaser.
  await showTab(page, "Buchhaltung");
  await expect(page.getByTestId("listed-teaser")).toContainText("Die Buchhaltung gibt es erst mit einer Aktie");
  await showTab(page, "Geschäftsrat");
  await expect(page.getByTestId("listed-teaser")).toContainText("Den Geschäftsrat gibt es erst");

  // Old addresses still lead somewhere sensible.
  await page.goto("/company?tab=overview&section=moves");
  await expect(tabs.getByRole("tab", { name: /Controlling/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("company-moves")).toBeVisible();
  await page.goto("/company?tab=chat");
  await expect(tabs.getByRole("tab", { name: /Mitarbeiter/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("chat-messages")).toBeVisible();
  await page.goto("/company?tab=mira");
  await expect(page.getByTestId("mira")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/company?section=situation");
  await expect(tabs.getByRole("tab", { name: /Mitarbeiter/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("firm-section-situation")).toBeVisible();
});

test("listed company: benefit, research, books, tax", async ({ page }) => {
  test.setTimeout(120_000);
  await prepareRichFounder(page);
  await foundListedCompany(page);

  // Dashboard: the listed numbers and the mood gauge.
  await showTab(page, "Dashboard");
  const dashboard = page.getByTestId("company-dashboard");
  await expect(dashboard.getByTestId("stat-share")).toBeVisible();
  await expect(dashboard.getByTestId("stat-reputation")).toContainText("/ 100");
  await expect(dashboard.getByTestId("dashboard-mood").getByTestId("zone-gauge")).toBeVisible();
  await expect(dashboard.getByTestId("stat-todo")).not.toHaveText(/^0$/);

  // Buy a benefit in the staff tab; the to-do center lists the books.
  await showTab(page, "Mitarbeiter");
  await expect(page.getByTestId("todo-books")).toBeVisible();
  await showPane(page, "group-team", "Stimmung");
  const satisfaction = page.getByTestId("satisfaction");
  await expect(satisfaction.getByTestId("zone-gauge").first()).toBeVisible();
  await expect(satisfaction.getByTestId("zone-history")).toBeVisible();
  await satisfaction.getByTestId("item-b_obstkorb").click();
  await expect(page.getByTestId("item-sheet")).toContainText("Jeden Montag frisch");
  await page.getByTestId("item-buy").click();
  await expect(page.getByText("Obstkorb ist aktiv")).toBeVisible();
  await expect(satisfaction.getByTestId("item-b_obstkorb")).toHaveAttribute("data-phase", "maxed");

  // Start a research in the tree; the next step stays locked, the dashboard shows the countdown.
  await showTab(page, "Controlling");
  await showPane(page, "group-growth", "Forschung");
  const tree = page.getByTestId("research-tree");
  await expect(tree.locator("[data-testid^='item-r_']")).toHaveCount(28);
  await expect(tree.getByTestId("item-r_quality_2")).toHaveAttribute("data-phase", "locked");
  await tree.getByTestId("item-r_quality_1").click();
  await page.getByTestId("item-buy").click();
  await expect(page.getByText("Qualitätslabor ist in Arbeit")).toBeVisible();
  await expect(tree.getByTestId("item-r_quality_1")).toHaveAttribute("data-phase", "running");
  await expect(page.getByTestId("upkeep-summary")).toBeVisible();
  await showPane(page, "group-money", "Dividenden");
  await expect(page.getByTestId("dividends")).toBeVisible();
  await showTab(page, "Dashboard");
  await expect(page.getByTestId("timer-item-r_quality_1")).toContainText("Qualitätslabor");

  // Books: the to-do center leads there; sort the three receipts, close, pay later.
  await showTab(page, "Mitarbeiter");
  await page.getByTestId("todo-books").click();
  await expect(page).toHaveURL(/tab=books/);
  const books = page.getByTestId("company-books");
  await expect(books.getByTestId("accounting-entries")).toBeVisible();
  await books.getByTestId("books-open").click();
  const sheet = page.getByTestId("books-sheet");
  await expect(page.getByTestId("books-close-later")).toBeDisabled();
  for (const id of [1, 2, 3]) await sheet.getByTestId(`receipt-${id}`).getByRole("radio").first().click();
  await page.getByTestId("books-close-later").click();
  await expect(page.getByTestId("books-result")).toContainText("Belegen richtig");
  await page.getByTestId("books-done").click();
  await expect(books.getByTestId("books-duty")).toContainText("Für heute erledigt");
  await expect(books.getByTestId("tax-period").first()).toBeVisible();

  // Two days without books: the tax office adds a late fee, which is paid from the tax card.
  await jumpClock(page, 45);
  await page.goto("/company?tab=books&section=taxes");
  const taxes = page.getByTestId("taxes");
  await expect(taxes.getByTestId("tax-pay")).toBeVisible();
  await expect(taxes.getByTestId("tax-due")).not.toHaveText("0 €");
  await taxes.getByTestId("tax-pay").click();
  await expect(page.getByText("Steuer gezahlt")).toBeVisible();
  await expect(taxes.getByTestId("tax-none")).toBeVisible();

  // The tax advisor takes the job over.
  await page.getByTestId("advisor-hire").click();
  await expect(page.getByText("Steuerberater eingestellt")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("listed company: propose a motion in the Geschäftsrat and vote on one", async ({ page }) => {
  test.setTimeout(120_000);
  await prepareRichFounder(page, "Ratsherr");
  await foundListedCompany(page, "Ratswerk");

  await showTab(page, "Geschäftsrat");
  const board = page.getByTestId("company-board");
  await expect(board.getByTestId("board-holder").first()).toContainText("Ratsherr");
  await expect(board.getByTestId("board-right")).toHaveAttribute("data-can-convene", "true");

  // Propose: reserve 500 € for research. Validation first.
  const propose = board.getByTestId("board-propose");
  await expect(propose.getByTestId("motion-submit")).toBeDisabled();
  await propose.getByTestId("motion-amount").fill("99999999");
  await expect(propose.getByText(/Höchstens .* \(80 % der Kasse\)/)).toBeVisible();
  await propose.getByTestId("motion-amount").fill("500");
  await propose.getByTestId("motion-submit").click();
  await expect(page.getByText("Antrag gestellt")).toBeVisible();
  // The founder holds the majority and agrees with the own motion: it passes at once.
  await expect(board.getByTestId("board-history-row").first()).toHaveAttribute("data-status", "passed");
  await expect(board.getByTestId("board-budgets")).toContainText("500 €");

  // A greedy founder: a big withdrawal ruins the reputation, the big shareholder brings a payout cap.
  await showTab(page, "Controlling");
  await page
    .getByTestId("treasury")
    .locator("..")
    .getByRole("button", { name: /Entnehmen/ })
    .click();
  const withdraw = page.getByRole("dialog", { name: "Entnehmen" });
  await withdraw.getByLabel(/Betrag/).fill("50000");
  await withdraw.getByRole("button", { name: /entnehmen/i }).click();
  await expect(withdraw).toBeHidden();
  await jumpClock(page, 12);
  await page.goto("/company?tab=board");
  const motion = page.getByTestId("board-motion").first();
  await expect(motion).toHaveAttribute("data-kind", "payout_cap");
  await expect(motion.getByTestId("board-tally")).toBeVisible();
  await expect(motion.getByTestId("board-quorum")).toBeVisible();
  await motion.getByTestId("vote-no").click();
  await expect(page.getByText("Mit Nein gestimmt")).toBeVisible();
  await expect(page.getByTestId("board-history-row").first()).toHaveAttribute("data-status", "rejected");
});
