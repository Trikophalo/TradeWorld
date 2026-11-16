import { expect, test } from "@playwright/test";

/*
 * Chats with friends (ADR-164) in demo mode with three made-up friends: a direct chat from the plaza and a group.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("nexa-test-prepared")) return;
    window.sessionStorage.setItem("nexa-test-prepared", "1");
    window.sessionStorage.setItem("nexa-daily-reward-seen", new Date().toDateString());
    window.localStorage.setItem(
      "nexa-tutorial",
      JSON.stringify({
        demo: {
          status: "done",
          step: 0,
          seenTours: ["first_job", "limit_orders", "bonds", "found_garage", "visit_skill_map", "property"],
        },
      }),
    );
    const friend = (nickname: string, tag: string, avatarKey: string, online: boolean) => ({
      nickname,
      tag,
      level: 5,
      avatarKey,
      accessories: [],
      online,
      since: "2026-11-01T10:00:00Z",
    });
    window.localStorage.setItem(
      "nexa-demo-player-v2",
      JSON.stringify({
        nickname: "Plaudertasche",
        tag: "P1A2",
        cashCents: 5_000_000,
        xpTotal: 7_000,
        tutorialCompleted: true,
        curveVersion: 2,
        friendList: [
          friend("Anna", "A1B2", "seller", true),
          friend("Bruno", "B3C4", "punk", false),
          friend("Clara", "C5D6", "rookie", true),
        ],
      }),
    );
  });
});

test("direct chat: open from the plaza, write, see it, back with Escape", async ({ page }) => {
  await page.goto("/friends");
  await page.getByTestId("friends-plaza").locator('[data-testid="chat-icon"][data-friend="Anna"]').click();
  await expect(page).toHaveURL(/tab=chats&chat=\d+/);
  const conversation = page.getByTestId("chat-conversation");
  await expect(conversation.getByTestId("chat-title")).toHaveText("Anna");

  await conversation.getByTestId("chat-input").fill("Hallo Anna, kaufst du heute?");
  await conversation.getByRole("button", { name: "🚀" }).click();
  await conversation.getByTestId("chat-send").click();
  const mine = conversation.locator('[data-testid="chat-line"][data-me="true"]');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText("Hallo Anna, kaufst du heute?🚀");
  await expect(conversation.getByTestId("chat-input")).toHaveValue("");

  // Anna answers a question after a moment (the demo's made-up friends).
  await expect(conversation.locator('[data-testid="chat-line"][data-me="false"]')).toHaveCount(1, { timeout: 15_000 });

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/tab=chats$/);
  const row = page.locator('[data-testid="chat-row"][data-name="Anna"]');
  await expect(row).toBeVisible();
  await expect(row.getByTestId("chat-unread")).toHaveCount(0);
});

test("group chat: two friends, a name, write; the admin renames it", async ({ page }) => {
  await page.goto("/friends?tab=chats");
  await page.getByTestId("chat-new-group").click();
  const form = page.getByTestId("chat-group-form");
  await form.getByTestId("chat-group-name").fill("Börsenclub");
  await form.locator('[data-testid="chat-group-pick"][data-nickname="Anna"]').click();
  await form.locator('[data-testid="chat-group-pick"][data-nickname="Bruno"]').click();
  await form.getByTestId("chat-group-create").click();

  await expect(page).toHaveURL(/tab=chats&chat=\d+/);
  const conversation = page.getByTestId("chat-conversation");
  await expect(conversation).toHaveAttribute("data-kind", "group");
  await expect(conversation.getByTestId("chat-title")).toHaveText("Börsenclub");
  await expect(conversation).toContainText("3 Mitglieder");
  await expect(conversation.locator('[data-testid="chat-line"][data-kind="system"]').first()).toContainText(
    "hat die Gruppe „Börsenclub“ gegründet.",
  );

  await conversation.getByTestId("chat-input").fill("Wer kauft mit?");
  await conversation.getByTestId("chat-input").press("Enter");
  await expect(conversation.locator('[data-testid="chat-line"][data-me="true"]')).toContainText("Wer kauft mit?");

  await conversation.getByTestId("chat-manage").click();
  const sheet = page.getByTestId("chat-manage-sheet");
  await sheet.getByTestId("chat-rename-input").fill("Die Bullen");
  await sheet.getByRole("button", { name: "Ändern" }).click();
  await expect(page.getByText("Gruppe umbenannt")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(conversation.getByTestId("chat-title")).toHaveText("Die Bullen");

  await conversation.getByTestId("chat-back").click();
  await expect(page.locator('[data-testid="chat-row"][data-kind="group"]')).toHaveAttribute("data-name", "Die Bullen");
});
