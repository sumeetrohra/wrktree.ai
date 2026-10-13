import { PACK_MAGIC } from "./pack-dir.utils.js";

/**
 * The single-file build's main script (CommonJS, as Node's single executable applications want).
 * It unpacks the `app.pack` asset (the npm package with its installed dependencies, native modules
 * included; a gzipped `packDir`) once into the user's cache, then loads the CLI from there with `createRequire`, the
 * way a single executable reaches files on disk. `AGENTDECK_SEA_ASSET` stands in for the asset
 * when run by plain Node (tests); `AGENTDECK_CACHE_DIR` moves the cache.
 */
export function launcherSource(version: string, key: string): string {
  return `"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sea = require("node:sea");
const zlib = require("node:zlib");
const { createRequire } = require("node:module");

function cacheRoot() {
  if (process.env.AGENTDECK_CACHE_DIR) return process.env.AGENTDECK_CACHE_DIR;
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "agentdeck", "cache");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "agentdeck");
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "agentdeck");
}

function unpack(buf, to) {
  if (buf.toString("utf8", 0, ${String(PACK_MAGIC.length)}) !== ${JSON.stringify(PACK_MAGIC)}) throw new Error("agentdeck: the build is damaged");
  const n = buf.readUInt32LE(${String(PACK_MAGIC.length)});
  const index = JSON.parse(buf.toString("utf8", ${String(PACK_MAGIC.length + 4)}, ${String(PACK_MAGIC.length + 4)} + n));
  let at = ${String(PACK_MAGIC.length + 4)} + n;
  for (const f of index) {
    const target = path.join(to, ...f.p.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf.subarray(at, at + f.s), { mode: f.m });
    at += f.s;
  }
}

const dir = path.join(cacheRoot(), "app", ${JSON.stringify(`${version}-${key}`)});
if (!fs.existsSync(path.join(dir, ".complete"))) {
  const tmp = dir + ".tmp-" + process.pid;
  fs.rmSync(tmp, { recursive: true, force: true });
  const asset = sea.isSea() ? Buffer.from(sea.getAsset("app.pack")) : fs.readFileSync(process.env.AGENTDECK_SEA_ASSET);
  unpack(zlib.gunzipSync(asset), tmp);
  fs.writeFileSync(path.join(tmp, ".complete"), "");
  try {
    fs.renameSync(tmp, dir);
  } catch {
    // Another agentdeck unpacked the same build first.
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
createRequire(path.join(dir, "package.json"))(path.join(dir, "dist", "agentdeck.js"));
`;
}
