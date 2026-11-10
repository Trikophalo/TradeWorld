/**
 * Renders the app icons from the pixel coin: favicon (SVG) and the PWA PNGs.
 * Run with `pnpm tsx scripts/gen-icons.ts` (needs the Playwright browser).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { COIN } from "../src/components/pixel/art";
import { buildPixelPaths } from "../src/components/pixel/pixel-icon";

const BACKGROUND = "#0a0c10";

/** `inset` is the empty border in art pixels around the 16×16 coin. */
function svg(inset: number, rounded: boolean): string {
  const size = 16 + inset * 2;
  const paths = buildPixelPaths(COIN.grid, COIN.palette)
    .map(({ color, d }) => `<path fill="${color}" d="${d}"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="${BACKGROUND}"/>` +
    `<g transform="translate(${inset} ${inset})">${paths}</g></svg>`
  );
}

async function main() {
  const root = process.cwd();
  writeFileSync(join(root, "src/app/icon.svg"), svg(2, true));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const targets = [
    { file: "icon-192.png", size: 192, inset: 4, rounded: false },
    { file: "icon-512.png", size: 512, inset: 4, rounded: false },
    // Maskable icons keep the motif inside the central 80 % safe zone.
    { file: "icon-maskable-512.png", size: 512, inset: 8, rounded: false },
    { file: "apple-touch-icon.png", size: 180, inset: 4, rounded: false },
  ];
  for (const target of targets) {
    await page.setViewportSize({ width: target.size, height: target.size });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg(target.inset, target.rounded)}`,
    );
    await page.screenshot({ path: join(root, "public/icons", target.file) });
    console.log(target.file);
  }
  await browser.close();
}

void main();
