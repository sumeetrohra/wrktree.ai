#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { npm } from "./npm.utils.js";
import { packTarget } from "./pack.service.js";
import { publishIfNew } from "./publish.service.js";
import { smoke } from "./smoke.service.js";
import { TARGETS } from "./targets.constants.js";

/**
 * `agentdeck-release pack | smoke | publish` (run after `pnpm build` and the app's web export):
 * build the npm packages into release/, pack and install them in an empty project, or publish
 * the versions npm doesn't have yet.
 */
async function main(cmd: string | undefined): Promise<void> {
  const root = resolve(process.cwd());
  const out = join(root, "release");
  const built = [];
  for (const t of TARGETS) built.push({ t, ...(await packTarget(root, out, t)) });
  for (const b of built) process.stdout.write(`built ${b.t.name}@${b.version} in ${b.dir}\n`);
  if (cmd === "pack") return;
  if (cmd === "smoke") {
    const tarballs: Record<string, string> = {};
    for (const b of built) {
      npm(["pack", "--pack-destination", out], b.dir);
    }
    for (const f of readdirSync(out).filter((n) => n.endsWith(".tgz"))) tarballs[f] = join(out, f);
    await smoke(tarballs);
    return;
  }
  if (cmd === "publish") {
    for (const b of built)
      process.stdout.write(`${b.t.name}@${b.version}: ${publishIfNew(b.dir, b.t.name, b.version)}\n`);
    return;
  }
  throw new Error("usage: agentdeck-release pack | smoke | publish");
}

main(process.argv[2]).catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
