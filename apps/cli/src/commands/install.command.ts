import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { isSea } from "node:sea";
import { parseArgs } from "node:util";

import { runQuiet } from "#src/lib/process/index.js";
import { planFor } from "#src/shared/install/index.js";
import { c, print } from "#src/shared/output/index.js";

/** `agentdeck install [--dry-run]`: start the daemon at login (launchd, systemd or a scheduled task). */
export async function installCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { "dry-run": { type: "boolean" } } });
  // The single-file build (Phase 5f) is its own program; otherwise Node runs this script.
  const self = isSea() ? [process.execPath] : [process.execPath, resolve(process.argv[1] ?? "agentdeck")];
  const plan = planFor(process.platform, homedir(), self);
  for (const [path, contents] of Object.entries(plan.files)) {
    print(c.gray(`write ${path}`));
    if (values["dry-run"] === true) {
      print(contents);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, { mode: 0o644 });
  }
  for (const command of plan.commands) {
    print(c.gray(`run ${command.join(" ")}`));
    if (values["dry-run"] === true) continue;
    const r = await runQuiet(command);
    // launchctl unload fails harmlessly when nothing was loaded yet.
    if (r.code !== 0 && !(command[0] === "launchctl" && command[1] === "unload")) {
      throw new Error(`${command[0] ?? ""} failed: ${r.stderr.trim()}`);
    }
  }
  print(
    values["dry-run"] === true
      ? "Dry run: nothing changed."
      : c.green("The daemon now starts when you log in."),
  );
}
