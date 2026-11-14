import type { Page } from "@playwright/test";

/*
 * The company page starts with Mira and folds its overview into sections (ADR-138). Tests that check the overview
 * open every section up front and switch to the overview tab.
 */
const ALL_SECTIONS = ["money", "moves", "situation", "history", "business", "profit", "boss"];

export async function unfoldCompany(page: Page) {
  await page.addInitScript((ids) => {
    try {
      window.localStorage.setItem("nexa-company-sections", JSON.stringify(ids));
    } catch {
      // ignore
    }
  }, ALL_SECTIONS);
}

export async function showOverview(page: Page) {
  await page.getByRole("tab", { name: /Übersicht/ }).click();
}
