import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";

import { defaultHome } from "@agentdeck/daemon";

import { runQuiet } from "#src/lib/process/index.js";
import { uninstallPlanFor } from "#src/shared/install/index.js";
import { c, print } from "#src/shared/output/index.js";

/** `agentdeck uninstall [--dry-run]`: stop starting the daemon at login. Data stays. */
export async function uninstallCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { "dry-run": { type: "boolean" } } });
  const dry = values["dry-run"] === true;
  const plan = uninstallPlanFor(process.platform, homedir());
  for (const command of plan.commands) {
    print(c.gray(`run ${command.join(" ")}`));
    // Nothing installed is fine: there is nothing to undo.
    if (!dry) await runQuiet(command);
  }
  for (const path of plan.remove) {
    print(c.gray(`remove ${path}`));
    if (!dry) rmSync(path, { force: true });
  }
  print(dry ? "Dry run: nothing changed." : c.green("The daemon no longer starts when you log in."));
  print(c.gray(`Chats, profiles and settings stay in ${defaultHome()}; delete that folder to remove them.`));
}
