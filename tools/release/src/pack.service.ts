import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { parseJson } from "@agentdeck/shared";
import { build } from "esbuild";
import { z } from "zod";

import type { TTarget } from "./targets.constants.js";

const manifestSchema = z.looseObject({
  name: z.string(),
  version: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
});
type TManifest = z.infer<typeof manifestSchema>;

const WORKSPACE_DIRS = ["packages", "apps", "tools"];
const REPOSITORY = { type: "git", url: "git+https://github.com/sumeetrohra/wrktree.ai.git" };

const readManifest = (dir: string): TManifest =>
  parseJson(manifestSchema, readFileSync(join(dir, "package.json"), "utf8"));

/** Every workspace package by name → its folder. */
function workspace(root: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const top of WORKSPACE_DIRS) {
    const base = join(root, top);
    if (!existsSync(base)) continue;
    for (const e of readdirSync(base, { withFileTypes: true })) {
      const dir = join(base, e.name);
      if (e.isDirectory() && existsSync(join(dir, "package.json"))) map.set(readManifest(dir).name, dir);
    }
  }
  return map;
}

/**
 * The npm dependencies a bundle needs: every non-workspace dependency of the package and of the
 * workspace packages it pulls in, transitively, at the versions pinned in the repo.
 */
export function runtimeDeps(
  root: string,
  from: string,
  kind: "dependencies" | "optionalDependencies" = "dependencies",
): Record<string, string> {
  const ws = workspace(root);
  const deps: Record<string, string> = {};
  const seen = new Set<string>();
  const visit = (dir: string): void => {
    const m = readManifest(dir);
    if (seen.has(m.name)) return;
    seen.add(m.name);
    for (const [name, version] of Object.entries(m.dependencies ?? {})) {
      const local = ws.get(name);
      if (local !== undefined) visit(local);
      else if (kind === "dependencies") deps[name] = version;
    }
    if (kind === "optionalDependencies") Object.assign(deps, m.optionalDependencies ?? {});
  };
  visit(join(root, from));
  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
}

/** Builds one npm package into `<out>/<name>`; returns its folder and version. */
export async function packTarget(
  root: string,
  out: string,
  t: TTarget,
): Promise<{ dir: string; version: string }> {
  const dir = join(out, t.name.replace("/", "__"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { version } = readManifest(join(root, t.from));
  for (const b of t.bundle) {
    await build({
      entryPoints: [join(root, b.entry)],
      outfile: join(dir, b.out),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      // Workspace code is inlined; everything from npm stays a dependency.
      plugins: [
        {
          name: "npm-external",
          setup(pb) {
            pb.onResolve({ filter: /^[^./#]/ }, (args) =>
              // The entry and absolute paths (C:\… on Windows) are files, not packages.
              args.kind === "entry-point" || isAbsolute(args.path) || args.path.startsWith("@agentdeck/")
                ? undefined
                : { path: args.path, external: true },
            );
          },
        },
      ],
      banner: {
        js: "import { createRequire as __agentdeckRequire } from 'node:module'; const require = __agentdeckRequire(import.meta.url);",
      },
      legalComments: "none",
    });
  }
  for (const folder of t.copy ?? [])
    cpSync(join(root, t.from, folder), join(dir, folder), { recursive: true });
  if (t.extra && existsSync(join(root, t.extra.from))) {
    mkdirSync(dirname(join(dir, t.extra.to)), { recursive: true });
    cpSync(join(root, t.extra.from), join(dir, t.extra.to), { recursive: true });
  }
  const manifest = {
    name: t.name,
    version,
    description: t.description,
    license: "MIT",
    repository: REPOSITORY,
    homepage: "https://github.com/sumeetrohra/wrktree.ai#readme",
    type: "module",
    engines: { node: ">=22.12" },
    ...(t.bin ? { bin: t.bin } : {}),
    ...(t.exports ? { exports: t.exports } : {}),
    files: ["dist", "README.md", "LICENSE"],
    dependencies:
      t.bundle.length > 0 ? runtimeDeps(root, t.from) : (readManifest(join(root, t.from)).dependencies ?? {}),
    ...(t.bundle.length > 0 && Object.keys(runtimeDeps(root, t.from, "optionalDependencies")).length > 0
      ? { optionalDependencies: runtimeDeps(root, t.from, "optionalDependencies") }
      : {}),
    publishConfig: { access: "public", provenance: true },
  };
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync(join(root, "LICENSE"), join(dir, "LICENSE"));
  const readme = join(root, "tools", "release", "readmes", `${t.name.replace("@agentdeck/", "")}.md`);
  cpSync(existsSync(readme) ? readme : join(root, "README.md"), join(dir, "README.md"));
  return { dir, version };
}
