#!/usr/bin/env node
import { runDaemon } from "#src/app/run-daemon.js";

runDaemon().catch((e: unknown) => {
  process.stderr.write(
    `agentdeck daemon failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
  );
  process.exit(1);
});
