import { expect, test } from "@playwright/test";

/*
 * The big popup when a task is delegated to you (ADR-143). Triggered from the showcase, which seeds a company_task
 * notification the real overlay then shows.
 */
test("a delegated task shows a big popup; dismissed it does not return", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.getByRole("button", { name: "Pop-up zeigen" }).click();
  const popup = page.getByTestId("delegated-task-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText("Chefin gibt dir eine Aufgabe");
  await popup.getByRole("button", { name: "Später" }).click();
  await expect(popup).toHaveCount(0);
  // Seeding the same list again does not reopen it (the id was dismissed), a new id does.
  await page.getByRole("button", { name: "Pop-up zeigen" }).click();
  await expect(page.getByTestId("delegated-task-popup")).toBeVisible();
});
