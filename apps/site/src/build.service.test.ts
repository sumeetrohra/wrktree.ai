import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildSite } from "./build.service.js";
import { rewriteLink } from "./links.utils.js";
import { PAGES } from "./pages.constants.js";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("the site", () => {
  it("builds every page with no broken internal links", () => {
    const out = mkdtempSync(join(tmpdir(), "site-"));
    expect(buildSite(ROOT, out)).toEqual(PAGES.map((p) => p.path));
    const guide = readFileSync(join(out, "docs", "guide", "index.html"), "utf8");
    expect(guide).toContain("<title>Guide · Agentdeck</title>");
    expect(guide).toContain('<a href="/docs/guide/" aria-current="page">Guide</a>');
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain("npm install -g agentdeck");
  });

  it("points repo links at site pages or GitHub", () => {
    expect(rewriteLink("privacy.md", "docs/rules/security.md")).toBe(
      "https://github.com/sumeetrohra/wrktree.ai/blob/main/docs/rules/privacy.md",
    );
    expect(rewriteLink("../privacy.md#keeping", "docs/rules/security.md")).toBe("/privacy/#keeping");
    expect(rewriteLink("relay-deploy.md", "docs/guide.md")).toBe("/docs/self-host/");
    expect(rewriteLink("https://example.com", "docs/guide.md")).toBe("https://example.com");
  });
});
