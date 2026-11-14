import { expect, test } from "@playwright/test";

/*
 * The TV of the hourly news show (NEXA Nachrichten) on /dev/ui: a local driver plays standby → intro → three
 * stories → outro. The intro is a montage that follows the clock shot by shot, the anchor's text is typed out, the
 * effect chips pop in, the LIVE badge shows, and every story gives him a mood.
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

  // The opener: a montage about the anchor. Every shot follows from the elapsed time alone, whatever the length
  // of the intro: the scrubber sets the clock (and stops it).
  await jump("Intro");
  await expect(studio).toHaveAttribute("data-mode", "intro");
  await expect(studio.getByTestId("news-live")).toBeVisible();
  const scrub = demo.getByTestId("news-studio-scrub");
  const introMs = Number(await scrub.getAttribute("max"));
  expect(introMs).toBeGreaterThanOrEqual(4000);
  const at = (share: number) => String(Math.round((introMs * share) / 50) * 50);
  await scrub.fill(at(0.5 / 7));
  await expect(studio).toHaveAttribute("data-intro-shot", "comb");
  await expect(studio.getByRole("heading", { name: "NEXA Nachrichten" })).toBeAttached();
  await expect(studio.getByTestId("news-intro")).toContainText("mit Mr. Doodle Dangle");
  await expect(studio.getByTestId("news-intro-caption")).toHaveText("Der Schnurrbart");
  // With the clock running again the montage moves on by itself.
  const clock = demo.getByRole("switch", { name: "Uhr läuft" });
  await expect(clock).toHaveAttribute("aria-checked", "false");
  await clock.click();
  await expect(studio).toHaveAttribute("data-intro-shot", "point", { timeout: 6_000 });
  for (const [share, shot] of [
    [5.5 / 7, "title"],
    [0.5 / 7, "comb"],
    [1.5 / 7, "point"],
    [2.5 / 7, "mug"],
    [3.5 / 7, "money"],
    [4.5 / 7, "hero"],
    [6.5 / 7, "title"],
  ] as const) {
    await scrub.fill(at(share));
    await expect(studio).toHaveAttribute("data-intro-shot", shot);
    await expect(studio.getByTestId("news-intro")).toHaveAttribute("data-intro-shot", shot);
  }
  // The title card is not one of the captioned shots.
  await expect(studio.getByTestId("news-intro-caption")).toHaveCount(0);

  // First story: the text is typed out, the chips wait for 60 % of it. A player who lost money gets the smug face.
  await jump("Meldung 1");
  await expect(studio).toHaveAttribute("data-mode", "live");
  await expect(studio).not.toHaveAttribute("data-intro-shot");
  await expect(studio).toHaveAttribute("data-mood", "smug");
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

  // The mood picker gives the story that is on another face: every mood shows on the studio, starts with a short
  // reaction and then he reads on.
  await jump("Meldung 1");
  for (const [label, mood] of [
    ["Schock", "shocked"],
    ["Weinen", "crying"],
    ["Lachen", "laughing"],
    ["Wut", "angry"],
    ["Süffisant", "smug"],
    ["Verwirrt", "confused"],
    ["Stolz", "proud"],
  ] as const) {
    await jump(label);
    await expect(studio).toHaveAttribute("data-mood", mood);
    await expect(studio).toHaveAttribute("data-mode", "live");
  }
  // 0.6 s in, the reaction is at its peak and he has not said a word; later he reads with the same face.
  await jump("Schock");
  await scrub.fill("600");
  await expect(studio).toHaveAttribute("data-reacting", "true");
  await expect(studio.getByTestId("news-mood-mark").first()).toBeVisible();
  await expect(typed).toHaveText("");
  await scrub.fill("3000");
  await expect(studio).not.toHaveAttribute("data-reacting");
  await expect(typed).toHaveText(/^Liebe Zuschauer/);
  await expect(studio).toHaveAttribute("data-mood", "shocked");
  // A straight face has no reaction and no marks; "Automatisch" gives the story its own mood back.
  await jump("Neutral");
  await expect(studio).toHaveAttribute("data-mood", "neutral");
  await expect(studio.getByTestId("news-mood-mark")).toHaveCount(0);
  await jump("Automatisch");
  await expect(studio).toHaveAttribute("data-mood", "smug");

  // The kinds that came later have their own caption and their own default mood.
  await jump("NFT");
  await expect(studio.getByTestId("news-kind")).toHaveText("NFT-Markt");
  await expect(studio).toHaveAttribute("data-mood", "smug");
  await jump("Klatsch");
  await expect(studio.getByTestId("news-kind")).toHaveText("Klatsch");
  await jump("Abschweifung");
  await expect(studio.getByTestId("news-kind")).toHaveText("Abgeschweift");
  await expect(studio).toHaveAttribute("data-mood", "confused");

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

/* With reduced motion the montage is only its last picture and a mood is one still pose with the whole text. */
test("news studio: reduced motion shows the title card and still moods", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dev/ui");
  const demo = page.getByTestId("news-studio-demo");
  const studio = demo.getByTestId("news-studio");
  await demo.scrollIntoViewIfNeeded();
  await expect(studio).toHaveAttribute("data-mode", "standby");

  await demo.getByRole("button", { name: "Intro", exact: true }).click();
  await expect(studio).toHaveAttribute("data-intro-shot", "title");
  await expect(studio.getByTestId("news-intro-caption")).toHaveCount(0);
  await expect(studio.getByTestId("news-intro")).toContainText("Volle Stunde, volle Wahrheit.");

  await demo.getByRole("button", { name: "Weinen", exact: true }).click();
  await expect(studio).toHaveAttribute("data-mood", "crying");
  await expect(studio).not.toHaveAttribute("data-reacting");
  await expect(studio.getByTestId("news-speech")).toHaveAttribute("data-typing", "false");
  await expect(studio.getByTestId("news-typed")).toHaveText(/Morgen ist auch noch ein Handelstag\.$/);
});
