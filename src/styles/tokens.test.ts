import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Reads the hex tokens of one theme block from tokens.css. */
function readTheme(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
const themes = {
  dark: readTheme(css, ':root[data-theme="dark"]'),
  light: readTheme(css, ':root[data-theme="light"] {'),
};

describe("design tokens meet WCAG AA", () => {
  for (const [name, t] of Object.entries(themes)) {
    describe(name, () => {
      // Text has to work on every surface it can sit on.
      for (const fg of ["fg-1", "fg-2", "fg-3", "gain", "loss", "warn", "info", "accent"]) {
        for (const bg of ["bg-0", "bg-1", "bg-2"]) {
          it(`${fg} on ${bg} is at least 4.5:1`, () => {
            expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
          });
        }
      }
      it("button labels are readable", () => {
        expect(contrast(t["on-accent"]!, t["accent-strong"]!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["on-semantic"]!, t["gain"]!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["on-semantic"]!, t["loss"]!)).toBeGreaterThanOrEqual(4.5);
      });
      it("strong lines are visible against surfaces (3:1 is not required for decoration)", () => {
        expect(contrast(t["line-2"]!, t["bg-1"]!)).toBeGreaterThan(1.3);
      });
    });
  }
});
