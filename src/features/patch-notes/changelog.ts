/*
 * Patch notes (ADR-137): CHANGELOG.md is the only source. `pnpm patchnotes` runs this parser and writes the result to
 * src/config/patch-notes.generated.ts; a test fails when that file no longer matches the changelog.
 *
 * Plain TypeScript without imports, so the generator script and Vitest can both run it.
 */

export interface PatchNoteEntry {
  /** Stable while the entry's text stays the same: release slug plus a hash of the text. */
  id: string;
  /** The bold lead-in ("**Krypto:** …") without the colon, or null for entries without one. */
  title: string | null;
  /** The first sentence, at most SUMMARY_MAX characters; `**bold**` kept, backticks and ADR references removed. */
  text: string;
}

export interface PatchNoteRelease {
  id: string;
  title: string;
  /** ISO date (YYYY-MM-DD) when the heading ends with one, e.g. "## M6 Clans (2026-12-01)". */
  date: string | null;
  /** Paragraphs outside the bullet list ("Erste, navigierbare Fassung …", "Noch offen: …"). */
  notes: string[];
  /** Newest first. */
  entries: PatchNoteEntry[];
}

const DATE_SUFFIX = /\s*(?:\(\s*(\d{4}-\d{2}-\d{2})\s*\)|[–—-]\s*(\d{4}-\d{2}-\d{2}))\s*$/;
const ADR_REFERENCE = /\s*\(\s*ADR-\d+(?:\s*,\s*ADR-\d+)*\s*\)/g;
const LEAD_IN = /^\*\*(.+?):\*\*\s*/;

/** Players do not read the ADRs: references and code ticks go, bold stays. */
export function cleanInline(text: string): string {
  return text
    .replace(ADR_REFERENCE, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "release"
  );
}

/** FNV-1a, 32 bit, as 8 hex digits: short and deterministic in every runtime. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Patch notes stay short: at most this many characters per entry. */
export const SUMMARY_MAX = 150;
const ABBREVIATIONS =
  /(?:(?:^|[\s(])[a-zA-Z]|z\.\s?B|d\.\s?h|u\.\s?a|bzw|ca|etc|evtl|ggf|inkl|max|min|Mio|Mrd|Nr|usw|vgl|Std|Min|Dr|Mr)\.$/;

/**
 * The gist of an entry: its first sentence (abbreviations like "z. B." do not end one), cut at a word boundary with
 * "…" when it is still longer than `max`.
 */
export function summarize(text: string, max = SUMMARY_MAX): string {
  let end = -1;
  const sentence = /[.!?](?=\s+["„(]?[A-ZÄÖÜ0-9])/g;
  for (let m = sentence.exec(text); m; m = sentence.exec(text)) {
    if (!ABBREVIATIONS.test(text.slice(Math.max(0, m.index - 6), m.index + 1))) {
      end = m.index + 1;
      break;
    }
  }
  const first = end > 0 ? text.slice(0, end) : text;
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

function toEntry(raw: string): Omit<PatchNoteEntry, "id"> & { full: string } {
  const lead = LEAD_IN.exec(raw);
  if (!lead) {
    const full = cleanInline(raw);
    return { title: null, text: summarize(full), full };
  }
  const full = cleanInline(raw.slice(lead[0].length));
  return { title: cleanInline(lead[1] ?? ""), text: summarize(full), full };
}

/**
 * Reads the changelog: every `## ` heading is a release, every `- ` bullet (with indented continuation lines) an
 * entry, other paragraphs are notes. Releases and entries come out newest first, since the file grows downwards.
 */
export function parseChangelog(markdown: string): PatchNoteRelease[] {
  const releases: { title: string; date: string | null; notes: string[]; bullets: string[] }[] = [];
  let current: (typeof releases)[number] | null = null;
  let block: { kind: "bullet" | "note"; lines: string[] } | null = null;

  const flush = () => {
    if (block && current) {
      const text = block.lines.join(" ");
      if (block.kind === "bullet") current.bullets.push(text);
      else current.notes.push(cleanInline(text));
    }
    block = null;
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^##\s/.test(line)) {
      flush();
      const heading = line.replace(/^##\s+/, "").trim();
      const date = DATE_SUFFIX.exec(heading);
      const release = {
        title: cleanInline(date ? heading.slice(0, date.index) : heading),
        date: date ? (date[1] ?? date[2] ?? null) : null,
        notes: [],
        bullets: [],
      };
      releases.push(release);
      current = release;
    } else if (/^#\s/.test(line) || !current) {
      flush();
    } else if (/^[-*]\s+/.test(line)) {
      flush();
      block = { kind: "bullet", lines: [line.replace(/^[-*]\s+/, "").trim()] };
    } else if (line.trim() === "") {
      flush();
    } else if (block && /^\s/.test(line)) {
      block.lines.push(line.trim());
    } else if (block?.kind === "note") {
      block.lines.push(line.trim());
    } else {
      flush();
      block = { kind: "note", lines: [line.trim()] };
    }
  }
  flush();

  return releases.reverse().map((release) => {
    const id = slugify(release.title);
    const used = new Set<string>();
    const entries = release.bullets
      .map(toEntry)
      .reverse()
      .map(({ full, ...entry }) => {
        // the id follows the full text, so shortening the notes does not mark old entries as new
        const base = `${id}-${hashText(`${entry.title ?? ""}\n${full}`)}`;
        let entryId = base;
        for (let n = 2; used.has(entryId); n++) entryId = `${base}-${n}`;
        used.add(entryId);
        return { id: entryId, ...entry };
      });
    // compact: the release's prose paragraphs stay in the changelog, the notes show the entries only
    return { id, title: release.title, date: release.date, notes: [], entries };
  });
}

/** The TypeScript module the generator writes (formatted by Prettier afterwards). */
export function renderPatchNotesModule(releases: readonly PatchNoteRelease[]): string {
  return [
    "// Generated by `pnpm patchnotes` from CHANGELOG.md (ADR-137). Do not edit by hand.",
    'import type { PatchNoteRelease } from "@/features/patch-notes/changelog";',
    "",
    `export const PATCH_NOTES: readonly PatchNoteRelease[] = ${JSON.stringify(releases, null, 2)};`,
    "",
  ].join("\n");
}

/** Ids of all entries, newest first. */
export function entryIds(releases: readonly PatchNoteRelease[]): string[] {
  return releases.flatMap((release) => release.entries.map((entry) => entry.id));
}

/**
 * Entries newer than the last one the player has seen. `null` when nothing is remembered or the remembered entry is
 * gone (edited, removed): then everything counts as unseen, but no single entry is singled out.
 */
export function unseenSince(releases: readonly PatchNoteRelease[], seenId: string | null): string[] | null {
  const ids = entryIds(releases);
  const index = seenId ? ids.indexOf(seenId) : -1;
  return index < 0 ? null : ids.slice(0, index);
}

/** Splits text into plain and bold runs for rendering. */
export function inlineRuns(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter((run) => run.text !== "");
}
