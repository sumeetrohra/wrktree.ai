#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { archiveSea, buildInstallers } from "./installers.service.js";
import { npm } from "./npm.utils.js";
import { packTarget } from "./pack.service.js";
import { publishIfNew } from "./publish.service.js";
import { buildSea, seaPath } from "./sea.service.js";
import { smoke, smokeSea } from "./smoke.service.js";
import { TARGETS } from "./targets.constants.js";

/**
 * `agentdeck-release pack | smoke | sea | sea-smoke | publish` (run after `pnpm build` and the
 * app's web export): build the npm packages into release/, pack and install them in an empty
 * project, build or smoke-test the single-file `agentdeck` for this OS (Phase 5f), or publish the
 * versions npm doesn't have yet.
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
  if (cmd === "sea" || cmd === "sea-smoke") {
    const cli = built.find((b) => b.t.name === "agentdeck");
    if (!cli) throw new Error("the agentdeck package wasn't built");
    const bin = cmd === "sea" ? await buildSea(cli.dir, cli.version, out) : seaPath(out);
    process.stdout.write(`built ${bin}\n`);
    if (cmd === "sea") process.stdout.write(`packed ${archiveSea(bin, cli.version, dirname(bin))}\n`);
    if (cmd === "sea-smoke") await smokeSea(bin, cli.version);
    return;
  }
  if (cmd === "installers") {
    const cli = built.find((b) => b.t.name === "agentdeck");
    const archives = process.argv[3];
    if (!cli || archives === undefined)
      throw new Error("usage: agentdeck-release installers <folder of archives>");
    for (const f of buildInstallers(cli.version, resolve(archives), join(out, "installers"))) {
      process.stdout.write(`wrote ${f}\n`);
    }
    return;
  }
  if (cmd === "publish") {
    for (const b of built)
      process.stdout.write(`${b.t.name}@${b.version}: ${publishIfNew(b.dir, b.t.name, b.version)}\n`);
    return;
  }
  throw new Error("usage: agentdeck-release pack | smoke | sea | sea-smoke | installers <dir> | publish");
}

main(process.argv[2]).catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
