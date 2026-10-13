import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { marked, type Tokens } from "marked";

import { layout } from "./layout.utils.js";
import { brokenLinks, rewriteLink } from "./links.utils.js";
import { PAGES, type TPage } from "./pages.constants.js";

/** Static files: the site's own, plus the app icon so the site and the app look the same. */
const STATIC: [string, string][] = [
  ["apps/site/public/style.css", "style.css"],
  ["apps/mobile/assets/icon.png", "icon.png"],
  ["apps/mobile/assets/favicon.png", "favicon.png"],
];

function render(root: string, page: TPage): string {
  const text = readFileSync(join(root, page.source), "utf8");
  if (page.source.endsWith(".html")) return text;
  const renderer = new marked.Renderer();
  const link = renderer.link.bind(renderer);
  renderer.link = (token: Tokens.Link) => link({ ...token, href: rewriteLink(token.href, page.source) });
  return marked.parse(text, { renderer, async: false, gfm: true });
}

/** Builds every page into `outDir/<path>/index.html`; throws if a link points at nothing. */
export function buildSite(root: string, outDir: string): string[] {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [from, to] of STATIC) copyFileSync(join(root, from), join(outDir, to));
  const written: string[] = [];
  for (const page of PAGES) {
    const dir = join(outDir, page.path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), layout(page, render(root, page)));
    written.push(page.path);
  }
  const broken = brokenLinks(outDir);
  if (broken.length > 0) throw new Error(`Broken links:\n${broken.join("\n")}`);
  return written;
}
