import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PATCH_NOTES } from "../../config/patch-notes.generated";
import {
  cleanInline,
  summarize,
  SUMMARY_MAX,
  entryIds,
  inlineRuns,
  parseChangelog,
  slugify,
  unseenSince,
  type PatchNoteRelease,
} from "./changelog";

const CHANGELOG = readFileSync(fileURLToPath(new URL("../../../CHANGELOG.md", import.meta.url)), "utf8");

describe("patch notes", () => {
  it("match CHANGELOG.md (run `pnpm patchnotes` after editing the changelog)", () => {
    expect(PATCH_NOTES).toEqual(parseChangelog(CHANGELOG));
  });

  it("have unique ids and no leftover markdown", () => {
    const ids = [...PATCH_NOTES.map((release) => release.id), ...entryIds(PATCH_NOTES)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const release of PATCH_NOTES) {
      expect(release.title).not.toMatch(/ADR-|`/);
      for (const entry of release.entries) expect(`${entry.title ?? ""} ${entry.text}`).not.toMatch(/`|\(ADR-/);
    }
  });

  it("parses releases, lead-ins, continuation lines and notes, newest first", () => {
    const releases = parseChangelog(
      [
        "# Changelog",
        "",
        "## M0 Fundament",
        "",
        "Erste Fassung.",
        "",
        "- **Projekt:** Next.js, `pnpm`,",
        "  Vitest (ADR-001, ADR-002).",
        "- Ohne Titel, aber **fett**.",
        "",
        "Noch offen: Deploy.",
        "",
        "## Grafik-Update „handgemacht“ (ADR-108) (2026-11-14)",
        "",
        "- **Farben (ADR-108):** neu.",
      ].join("\n"),
    );
    expect(releases.map((release) => [release.title, release.date])).toEqual([
      ["Grafik-Update „handgemacht“", "2026-11-14"],
      ["M0 Fundament", null],
    ]);
    const [graphics, m0] = releases as [PatchNoteRelease, PatchNoteRelease];
    expect(graphics.entries).toEqual([
      { id: expect.stringMatching(/^grafik-update-handgemacht-/), title: "Farben", text: "neu." },
    ]);
    expect(m0.notes).toEqual([]);
    expect(m0.entries.map(({ title, text }) => ({ title, text }))).toEqual([
      { title: null, text: "Ohne Titel, aber **fett**." },
      { title: "Projekt", text: "Next.js, pnpm, Vitest." },
    ]);
  });

  it("keeps an entry's id while other entries are added", () => {
    const before = parseChangelog("## A\n\n- **Eins:** a\n- **Zwei:** b\n");
    const after = parseChangelog("## A\n\n- **Null:** z\n- **Eins:** a\n- **Zwei:** b\n- **Drei:** c\n");
    expect(entryIds(after)).toEqual(expect.arrayContaining(entryIds(before)));
  });

  it("counts entries newer than the last seen one", () => {
    const releases = parseChangelog("## Alt\n\n- a\n- b\n\n## Neu\n\n- c\n- d\n");
    const [d, c, b, a] = entryIds(releases) as [string, string, string, string];
    expect(unseenSince(releases, d)).toEqual([]);
    expect(unseenSince(releases, b)).toEqual([d, c]);
    expect(unseenSince(releases, a)).toEqual([d, c, b]);
    expect(unseenSince(releases, null)).toBeNull();
    expect(unseenSince(releases, "gone")).toBeNull();
  });

  it("cleans inline markdown and splits bold runs", () => {
    expect(cleanInline("Code `NEXA-K7Q2`  (ADR-111) bleibt")).toBe("Code NEXA-K7Q2 bleibt");
    expect(inlineRuns("a **b** c")).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
    expect(slugify("Nach M5a: Ruhigeres Menü, Börse")).toBe("nach-m5a-ruhigeres-menue-boerse");
  });
});

describe("compact patch notes", () => {
  it("keeps the first sentence and at most SUMMARY_MAX characters", () => {
    expect(summarize("Neu: der Chat. Er scrollt jetzt von selbst.")).toBe("Neu: der Chat.");
    expect(summarize("Etwa z. B. ein Hut. Und mehr.")).toBe("Etwa z. B. ein Hut.");
    expect(summarize("Preise ab 1.000 € steigen. Rest.")).toBe("Preise ab 1.000 € steigen.");
    const long = "Wort ".repeat(60).trim() + ".";
    const short = summarize(long);
    expect(short.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(short.endsWith("…")).toBe(true);
    for (const release of PATCH_NOTES)
      for (const entry of release.entries) expect(entry.text.length).toBeLessThanOrEqual(SUMMARY_MAX);
  });
});
