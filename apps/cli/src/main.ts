#!/usr/bin/env node
import { runDaemon } from "@agentdeck/daemon";

import { devCommand } from "#src/commands/dev.command.js";
import { HELP } from "#src/commands/help.constants.js";
import { profileCommand } from "#src/commands/profile.command.js";
import { repoCommand } from "#src/commands/repo.command.js";
import { CommandError } from "#src/lib/daemon-client/index.js";
import { c, print, printError } from "#src/shared/output/index.js";

async function main(argv: readonly string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
      print(HELP);
      return;
    case "daemon":
      return runDaemon();
    case "repo":
      return repoCommand(rest);
    case "profile":
      return profileCommand(rest);
    case "dev":
      return devCommand(rest);
    default:
      throw new Error(`Unknown command: ${argv.join(" ")}\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  if (e instanceof CommandError) print(`${c.red(`error ${e.error.code}`)}: ${e.error.message}`);
  else printError(`${c.red("error")}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
