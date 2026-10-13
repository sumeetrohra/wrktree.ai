import { PAGES, REPO_URL, type TPage } from "./pages.constants.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page shell: header with navigation, the content, the footer. */
export function layout(page: TPage, body: string): string {
  const nav = PAGES.filter((p) => p.nav !== undefined)
    .map(
      (p) =>
        `<a href="${p.path}"${p.path === page.path ? ' aria-current="page"' : ""}>${esc(p.nav ?? "")}</a>`,
    )
    .join("");
  const wide = page.path === "/" ? " landing" : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(page.path === "/" ? page.title : `${page.title} · Agentdeck`)}</title>
<meta name="description" content="Drive Claude Code, Codex and Gemini CLI on your own computers from your phone." />
<link rel="icon" href="/favicon.png" />
<link rel="stylesheet" href="/style.css" />
</head>
<body>
<header class="site">
  <a class="brand" href="/"><img src="/icon.png" alt="" width="28" height="28" />Agentdeck</a>
  <nav>${nav}<a href="${REPO_URL}">GitHub</a></nav>
</header>
<main class="content${wide}">
${body}
</main>
<footer class="site">
  <span>MIT licensed · <a href="${REPO_URL}">Source</a></span>
  <span><a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a> · <a href="${REPO_URL}/blob/main/SECURITY.md">Report a vulnerability</a></span>
</footer>
</body>
</html>
`;
}
