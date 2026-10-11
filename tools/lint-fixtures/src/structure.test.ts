import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import picomatch from "picomatch";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Every file under `dir`, as `/`-separated paths relative to `root`. */
function files(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, root) : [relative(root, p).split(sep).join("/")];
  });
}

const SUFFIX = "{service,types,schema,constants,utils}";

/** Every source file must match one of its package's layout globs (S5, docs/rules/structure.md). */
const LAYOUTS: Record<string, string[]> = {
  "apps/daemon/src": [
    "main.ts",
    "index.ts",
    "app/*.ts",
    "app/handlers/index.ts",
    "app/handlers/*.handlers.ts",
    "modules/*/index.ts",
    "modules/*/*.ts",
    "infra/*/index.ts",
    "infra/*/*.ts",
    `shared/*.${SUFFIX}.ts`,
  ],
  "apps/cli/src": [
    "main.ts",
    "index.ts",
    "commands/*.command.ts",
    `commands/*.${SUFFIX}.ts`,
    "lib/*/index.ts",
    "lib/*/*.ts",
    "shared/*/index.ts",
    `shared/*/*.${SUFFIX}.ts`,
  ],
  "packages/protocol/src": ["index.ts", "*.schema.ts", "*.test.ts"],
  "packages/shared/src": ["index.ts", `*.${SUFFIX}.ts`, `*.${SUFFIX}.test.ts`],
  "apps/mobile/src": [
    "app/**/*.tsx",
    "pages/*/index.ts",
    "pages/*/*-page.tsx",
    "pages/*/*.test.tsx",
    "modules/*/index.ts",
    "modules/*/{components,hooks,stores,api,schemas,types,utils,constants}/*.{ts,tsx}",
    "lib/*/index.ts",
    "lib/*/*.{ts,tsx}",
    "providers/*.tsx",
    "providers/index.ts",
    "shared/components/ui/*.tsx",
    "shared/components/ui/README.md",
    "shared/{components,hooks,stores,utils,types,constants}/*.{ts,tsx}",
    "shared/i18n/*.ts",
    "shared/i18n/locales/*.json",
    "*.d.ts",
    "global.css",
  ],
};

/** Folders whose existence implies a public entry file. */
const ENTRY_FILES: [string, string][] = [
  ["apps/daemon/src/modules", "index.ts"],
  ["apps/daemon/src/infra", "index.ts"],
  ["apps/cli/src/lib", "index.ts"],
  ["apps/mobile/src/modules", "index.ts"],
  ["apps/mobile/src/pages", "index.ts"],
];

describe("every file sits in a known layer", () => {
  for (const [dir, globs] of Object.entries(LAYOUTS)) {
    it(dir, () => {
      const allowed = picomatch(globs);
      const stray = files(join(ROOT, dir)).filter((f) => !allowed(f));
      expect(stray).toEqual([]);
    });
  }

  it.each(ENTRY_FILES)("each folder in %s has %s", (dir, entry) => {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return;
    const missing = readdirSync(abs).filter(
      (d) => statSync(join(abs, d)).isDirectory() && !existsSync(join(abs, d, entry)),
    );
    expect(missing).toEqual([]);
  });
});
