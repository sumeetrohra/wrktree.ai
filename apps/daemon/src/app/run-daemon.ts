import { join } from "node:path";

import { now } from "@agentdeck/shared";

import { createLogger } from "#src/infra/log/index.js";
import { defaultHome, pathsFor } from "#src/shared/paths.utils.js";
import { DAEMON_VERSION } from "#src/shared/version.constants.js";

import { Daemon, optionsFromEnv } from "./create-daemon.js";

const logFile = (home: string): string =>
  join(pathsFor(home).logs, `daemon-${new Date(now()).toISOString().slice(0, 10)}.jsonl`);

/**
 * Runs the daemon in the foreground until SIGINT/SIGTERM. Logs go to the daily JSONL file,
 * and to stderr too with AGENTDECK_LOG_STDERR=1.
 */
export async function runDaemon(): Promise<void> {
  const home = defaultHome();
  const log = createLogger(logFile(home), {
    stderr: process.env.AGENTDECK_LOG_STDERR === "1",
    base: { v: DAEMON_VERSION },
  });
  const daemon = new Daemon(optionsFromEnv(home), log);
  const port = await daemon.start(Number(process.env.AGENTDECK_LOCAL_PORT ?? 0));
  process.stdout.write(`agentdeck daemon ${DAEMON_VERSION} listening on 127.0.0.1:${String(port)}\n`);
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}
