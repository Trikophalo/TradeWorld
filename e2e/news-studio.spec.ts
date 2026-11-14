import { expect, test } from "@playwright/test";

/*
 * The TV of the hourly news show (NEXA Nachrichten) on /dev/ui: a local driver plays standby → intro → three
 * stories → outro. The anchor's text is typed out, the effect chips pop in and the LIVE badge shows.
 */
test("news studio: the show plays on the TV", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto("/dev/ui");
  const demo = page.getByTestId("news-studio-demo");
  const studio = demo.getByTestId("news-studio");
  await demo.scrollIntoViewIfNeeded();
  const jump = (name: string) => demo.getByRole("button", { name, exact: true }).click();

  // The driver starts by itself: the dimmed studio with the countdown, not live yet.
  await expect(studio).toHaveAttribute("data-mode", "standby");
  await expect(studio.getByTestId("news-standby")).toContainText("Gleich live");
  await expect(studio.getByTestId("news-countdown")).toHaveText(/^(\d{2}:\d{2}|\d{1,2})$/);
  await expect(studio.getByTestId("news-live")).toHaveCount(0);
  await expect(studio.getByTestId("news-viewers")).toHaveText("3 schauen zu");

  // Title card.
  await jump("Intro");
  await expect(studio).toHaveAttribute("data-mode", "intro");
  await expect(studio.getByTestId("news-live")).toBeVisible();
  await expect(studio.getByRole("heading", { name: "NEXA Nachrichten" })).toBeAttached();
  await expect(studio.getByTestId("news-intro")).toContainText("mit Mr. Doodle Dangle");

  // First story: the text is typed out, the chips wait for 60 % of it.
  await jump("Meldung 1");
  await expect(studio).toHaveAttribute("data-mode", "live");
  await expect(studio.getByTestId("news-live")).toHaveText("Live");
  const speech = studio.getByTestId("news-speech");
  const typed = studio.getByTestId("news-typed");
  const chips = studio.getByTestId("news-effect");
  await expect(speech).toHaveAttribute("data-typing", "true");
  await expect(typed).toHaveText(/^Liebe Zuschauer/);
  await expect(typed).not.toHaveText(/Handelstag/);
  // Screen readers get the whole story at once instead of letter by letter.
  await expect(studio.getByTestId("news-spoken")).toHaveText(/^Boersenfuchs_7 verbrennt .* Handelstag\.$/);
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toHaveAttribute("data-shown", "false");
  await expect(studio.getByTestId("news-kind")).toHaveText("Pleite der Stunde");
  await expect(studio.getByTestId("news-headline")).toHaveText("Boersenfuchs_7 verbrennt 12.400 € mit Brezeln");
  await expect(studio.getByTestId("news-progress")).toHaveAccessibleName("Meldung 1 von 3");

  await expect(chips.first()).toHaveAttribute("data-shown", "true", { timeout: 10_000 });
  await expect(chips.first()).toHaveText("BRZ −12 %");
  await expect(chips.first()).toHaveAttribute("data-tone", "loss");
  await expect(speech).toHaveAttribute("data-typing", "false", { timeout: 10_000 });
  await expect(typed).toHaveText(/Morgen ist auch noch ein Handelstag\.$/);

  // The TV never makes the page scroll sideways, and the bubble stays inside the screen.
  const viewport = page.viewportSize()!;
  const tv = (await studio.boundingBox())!;
  const bubble = (await studio.getByTestId("news-bubble").boundingBox())!;
  const screen = (await studio.getByTestId("news-screen").boundingBox())!;
  expect(tv.x).toBeGreaterThanOrEqual(0);
  expect(tv.x + tv.width).toBeLessThanOrEqual(viewport.width);
  expect(bubble.x).toBeGreaterThanOrEqual(screen.x);
  expect(bubble.x + bubble.width).toBeLessThanOrEqual(screen.x + screen.width);
  await expect(studio).toHaveAttribute("data-layout", viewport.width >= 1024 ? "wide" : "compact");

  // The driver goes on to the next story by itself.
  await expect(studio.getByTestId("news-headline")).toHaveText(/KlarSoft/, { timeout: 10_000 });
  await expect(chips.first()).toHaveAttribute("data-tone", "gain");

  // The longest text still fits; a replay wears its own badge.
  await jump("Lange Meldung");
  await demo.getByRole("switch", { name: "Wiederholung" }).click();
  await expect(studio.getByTestId("news-replay")).toHaveText("Wiederholung");
  await expect(studio.getByTestId("news-live")).toHaveCount(0);
  await expect(studio.getByTestId("news-kind")).toHaveText("Skandal");
  const longBubble = (await studio.getByTestId("news-bubble").boundingBox())!;
  const longScreen = (await studio.getByTestId("news-screen").boundingBox())!;
  expect(longBubble.x + longBubble.width).toBeLessThanOrEqual(longScreen.x + longScreen.width);
  expect(longBubble.y).toBeGreaterThanOrEqual(longScreen.y);
  await demo.getByRole("switch", { name: "Wiederholung" }).click();

  // Goodbye, and a TV without a signal.
  await jump("Outro");
  await expect(studio).toHaveAttribute("data-mode", "outro");
  await expect(studio.getByTestId("news-headline")).toHaveText("Bis zur nächsten vollen Stunde!");
  await expect(typed).toHaveText(/^Das war/);
  await jump("Aus");
  await expect(studio).toHaveAttribute("data-mode", "off");
  await expect(studio.getByText("Kein Signal").first()).toBeVisible();

  expect(errors).toEqual([]);
});
