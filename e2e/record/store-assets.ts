/**
 * `pnpm --filter @agentdeck/e2e store:assets`: renders the app icon, Android adaptive icon, splash
 * mark and web favicon from one SVG (Chromium), into apps/mobile/assets/.
 */
import { join } from "node:path";

import { chromium } from "playwright-core";

import { REPO_ROOT } from "../src/harness.ts";

const OUT = join(REPO_ROOT, "apps", "mobile", "assets");

/** The mark: a deck of three cards, the front one a terminal prompt. */
const mark = (fg: string, accent: string) => `
  <g transform="translate(497 578) scale(1.12)">
    <rect x="-250" y="-300" width="440" height="330" rx="44" fill="${fg}" opacity="0.28" transform="rotate(-10)"/>
    <rect x="-230" y="-250" width="440" height="330" rx="44" fill="${fg}" opacity="0.5" transform="rotate(-4)"/>
    <rect x="-220" y="-150" width="440" height="330" rx="44" fill="${fg}"/>
    <path d="M -130 -40 L -40 15 L -130 70" fill="none" stroke="${accent}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="-10" y="60" width="140" height="40" rx="20" fill="${accent}"/>
  </g>`;

const BG = "#0f172a";
const FG = "#f8fafc";
const ACCENT = "#22c55e";

const svg = (size: number, body: string, background: string | null): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 1024 1024">${
    background ? `<rect width="1024" height="1024" fill="${background}"/>` : ""
  }${body}</svg>`;

const ASSETS: { file: string; size: number; svg: string; transparent: boolean }[] = [
  { file: "icon.png", size: 1024, svg: svg(1024, mark(FG, ACCENT), BG), transparent: false },
  // Android crops the adaptive foreground to a circle or squircle: keep the mark in the middle 66%.
  {
    file: "adaptive-icon.png",
    size: 1024,
    svg: svg(
      1024,
      `<g transform="translate(512 512) scale(0.72) translate(-512 -512)">${mark(FG, ACCENT)}</g>`,
      null,
    ),
    transparent: true,
  },
  { file: "splash-icon.png", size: 512, svg: svg(512, mark(FG, ACCENT), null), transparent: true },
  { file: "favicon.png", size: 64, svg: svg(64, mark(FG, ACCENT), BG), transparent: false },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const a of ASSETS) {
  await page.setViewportSize({ width: a.size, height: a.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${a.svg}</body></html>`);
  await page.locator("svg").screenshot({ path: join(OUT, a.file), omitBackground: a.transparent });
  process.stdout.write(`wrote ${a.file}\n`);
}
await browser.close();
