/**
 * Writes src/config/patch-notes.generated.ts from CHANGELOG.md (ADR-137).
 * Run with `pnpm patchnotes` after every change to the changelog; `patch-notes.test.ts` fails otherwise.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";
import { parseChangelog, renderPatchNotesModule } from "../src/features/patch-notes/changelog";

async function main() {
  const root = process.cwd();
  const target = join(root, "src/config/patch-notes.generated.ts");
  const releases = parseChangelog(readFileSync(join(root, "CHANGELOG.md"), "utf8"));
  const config = (await resolveConfig(target)) ?? {};
  const source = await format(renderPatchNotesModule(releases), { ...config, filepath: target });
  writeFileSync(target, source);
  const entries = releases.reduce((n, release) => n + release.entries.length, 0);
  console.log(`patch notes: ${releases.length} releases, ${entries} entries -> ${target}`);
}

void main();
