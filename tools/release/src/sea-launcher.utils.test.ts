import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { packDir } from "./pack-dir.utils.js";
import { launcherSource } from "./sea-launcher.utils.js";
import { pruneNatives } from "./sea.service.js";

describe("the single-file launcher", () => {
  it("unpacks the app once into the cache and runs its CLI from there", () => {
    const dir = mkdtempSync(join(tmpdir(), "sea-"));
    const app = join(dir, "app");
    mkdirSync(join(app, "dist"), { recursive: true });
    mkdirSync(join(app, "node_modules", "dep", "bin"), { recursive: true });
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "agentdeck", type: "module" }));
    writeFileSync(join(app, "node_modules", "dep", "index.js"), "module.exports = 'from a dependency';");
    writeFileSync(join(app, "node_modules", "dep", "bin", "tool"), "#!/bin/sh\n", { mode: 0o755 });
    // ESM, like the real bundle: Node 22.12+ requires it synchronously.
    writeFileSync(
      join(app, "dist", "agentdeck.js"),
      "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\nconsole.log('hello ' + process.argv.slice(2).join(' ') + ' ' + require('dep'));\n",
    );
    writeFileSync(join(dir, "app.pack"), gzipSync(packDir(app)));
    writeFileSync(join(dir, "launcher.cjs"), launcherSource("1.2.3", "abc"));
    const env = {
      ...process.env,
      AGENTDECK_SEA_ASSET: join(dir, "app.pack"),
      AGENTDECK_CACHE_DIR: join(dir, "cache"),
    };
    const run = () =>
      execFileSync(process.execPath, [join(dir, "launcher.cjs"), "status", "--x"], { env, encoding: "utf8" });

    expect(run()).toBe("hello status --x from a dependency\n");
    const unpacked = join(dir, "cache", "app", "1.2.3-abc");
    if (process.platform !== "win32") {
      expect(statSync(join(unpacked, "node_modules", "dep", "bin", "tool")).mode & 0o111).not.toBe(0);
    }
    // The second run reuses the cache (no temp folders left behind either).
    expect(run()).toBe("hello status --x from a dependency\n");
    expect(readdirSync(join(dir, "cache", "app"))).toEqual(["1.2.3-abc"]);
  });
});

describe("pruneNatives", () => {
  it("keeps this platform's addon and the code that loads it, nothing else", () => {
    const app = mkdtempSync(join(tmpdir(), "prune-"));
    const files = [
      "node_modules/node-pty/lib/index.js",
      "node_modules/node-pty/src/unix/pty.cc",
      "node_modules/node-pty/third_party/conpty/x.dll",
      "node_modules/node-pty/prebuilds/darwin-arm64/pty.node",
      "node_modules/node-pty/prebuilds/win32-x64/pty.node",
      "node_modules/node-pty/build/Release/pty.node",
      "node_modules/node-pty/build/Release/obj.target/pty.o",
      "node_modules/node-pty/build/Makefile",
      "node_modules/better-sqlite3/lib/index.js",
      "node_modules/better-sqlite3/deps/sqlite3/sqlite3.c",
      "node_modules/better-sqlite3/prebuilds/linux-x64.node",
      "node_modules/better-sqlite3/prebuilds/linuxmusl-x64.node",
      "node_modules/better-sqlite3/prebuilds/darwin-arm64.node",
    ];
    for (const f of files) {
      mkdirSync(join(app, f, ".."), { recursive: true });
      writeFileSync(join(app, f), "");
    }
    pruneNatives(app, "linux", "x64");
    const left = files.filter((f) => existsSync(join(app, f)));
    expect(left).toEqual([
      "node_modules/node-pty/lib/index.js",
      "node_modules/node-pty/build/Release/pty.node",
      "node_modules/better-sqlite3/lib/index.js",
      "node_modules/better-sqlite3/prebuilds/linux-x64.node",
      "node_modules/better-sqlite3/prebuilds/linuxmusl-x64.node",
    ]);
  });
});
