#!/usr/bin/env node
import { runDaemon } from "./run.js";

runDaemon().catch((e: unknown) => {
  process.stderr.write(`agentdeck daemon failed: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
