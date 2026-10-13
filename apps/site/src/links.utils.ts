import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, posix, relative } from "node:path";

import { PAGES, REPO_URL } from "./pages.constants.js";

/**
 * A link in a rendered repo doc: to another page of the site when that file is one, to GitHub
 * for any other repo file, unchanged when external or an anchor.
 */
export function rewriteLink(href: string, source: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [file = "", hash = ""] = href.split("#");
  const target = posix.normalize(posix.join(posix.dirname(source), file));
  const page = PAGES.find((p) => p.source === target);
  const anchor = hash ? `#${hash}` : "";
  if (page) return `${page.path}${anchor}`;
  return `${REPO_URL}/blob/main/${target}${anchor}`;
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? htmlFiles(p) : p.endsWith(".html") ? [p] : [];
  });
}

/** Internal links (href and src) in the built site that point at nothing, as `page -> link`. */
export function brokenLinks(outDir: string): string[] {
  const broken: string[] = [];
  for (const file of htmlFiles(outDir)) {
    const html = readFileSync(file, "utf8");
    for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const link = m[1] ?? "";
      if (/^[a-z]+:/i.test(link) || link.startsWith("#")) continue;
      const path = link.split("#")[0] ?? "";
      const abs = path.startsWith("/") ? join(outDir, path) : normalize(join(dirname(file), path));
      const ok = existsSync(abs) && (statSync(abs).isFile() || existsSync(join(abs, "index.html")));
      if (!ok) broken.push(`${relative(outDir, file)} -> ${link}`);
    }
  }
  return broken;
}
