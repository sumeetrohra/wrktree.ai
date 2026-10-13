import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { inject } from "postject";

import { npm } from "./npm.utils.js";
import { packDir } from "./pack-dir.utils.js";
import { launcherSource } from "./sea-launcher.utils.js";

/**
 * Drops what the native packages only need to build or for other platforms: C/C++ sources and
 * other platforms' prebuilt addons (node-pty ships every OS's; better-sqlite3 every libc's too).
 */
export function pruneNatives(
  app: string,
  platform: string = process.platform,
  arch: string = process.arch,
): void {
  const modules = join(app, "node_modules");
  const keep = (dir: string, wanted: (name: string) => boolean): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir))
      if (!wanted(name)) rmSync(join(dir, name), { recursive: true, force: true });
  };
  const target = `${platform}-${arch}`;
  for (const pkg of ["node-pty", "better-sqlite3"]) {
    const root = join(modules, pkg);
    for (const sources of ["deps", "src", "third_party", "scripts"])
      rmSync(join(root, sources), { recursive: true, force: true });
    keep(
      join(root, "prebuilds"),
      (n) => n === target || n === `${target}.node` || n === `${platform}musl-${arch}.node`,
    );
    keep(join(root, "build"), (n) => n === "Release");
    keep(join(root, "build", "Release"), (n) => !n.startsWith("obj") && n !== ".deps");
  }
}

/** Node's marker for where a single executable application's blob goes. */
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/** `agentdeck` or `agentdeck.exe` for this OS. */
const seaName = (platform: NodeJS.Platform = process.platform): string =>
  platform === "win32" ? "agentdeck.exe" : "agentdeck";

/** Where the single-file build goes under the release folder: `bin/agentdeck(.exe)`. */
export const seaPath = (out: string): string => join(out, "bin", seaName());

/**
 * The single-file `agentdeck` for this OS and CPU (Phase 5f): this Node binary with the CLI
 * injected as a single executable application. Its asset is the built npm package (`pkgDir`) with
 * its dependencies installed for this platform, native modules included.
 */
export async function buildSea(pkgDir: string, version: string, out: string): Promise<string> {
  const stage = join(out, "sea");
  rmSync(stage, { recursive: true, force: true });
  const app = join(stage, "app");
  mkdirSync(app, { recursive: true });
  execFileSync(process.execPath, [
    "-e",
    `require("node:fs").cpSync(${JSON.stringify(pkgDir)}, ${JSON.stringify(app)}, { recursive: true })`,
  ]);
  npm(["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], app);
  pruneNatives(app);
  const pack = gzipSync(packDir(app), { level: 9 });
  const key = createHash("sha256").update(pack).digest("hex").slice(0, 12);
  writeFileSync(join(stage, "app.pack"), pack);
  writeFileSync(join(stage, "launcher.cjs"), launcherSource(version, key));
  writeFileSync(
    join(stage, "sea-config.json"),
    JSON.stringify({
      main: join(stage, "launcher.cjs"),
      output: join(stage, "sea.blob"),
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      assets: { "app.pack": join(stage, "app.pack") },
    }),
  );
  execFileSync(process.execPath, ["--experimental-sea-config", join(stage, "sea-config.json")], {
    stdio: "inherit",
  });
  const bin = seaPath(out);
  mkdirSync(join(out, "bin"), { recursive: true });
  rmSync(bin, { force: true });
  copyFileSync(process.execPath, bin);
  if (process.platform === "darwin") execFileSync("codesign", ["--remove-signature", bin]);
  await inject(bin, "NODE_SEA_BLOB", readFileSync(join(stage, "sea.blob")), {
    sentinelFuse: SEA_FUSE,
    ...(process.platform === "darwin" ? { machoSegmentName: "NODE_SEA" } : {}),
  });
  // An ad-hoc signature, so Apple silicon runs it; distribution signing is the publisher's.
  if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", bin]);
  return bin;
}
