import { pino } from "pino";
import type { Logger } from "@agentdeck/shared";
import { Daemon, DAEMON_VERSION, defaultHome, logFile, optionsFromEnv } from "./daemon.js";

/**
 * Runs the daemon in the foreground until SIGINT/SIGTERM. Logs go to the daily
 * JSONL file, and to stderr too with AGENTDECK_LOG_STDERR=1.
 */
export async function runDaemon(): Promise<void> {
  const home = defaultHome();
  const opts = optionsFromEnv(home);
  const streams: pino.StreamEntry[] = [
    { stream: pino.destination({ dest: logFile(home), mkdir: true, sync: true }) },
  ];
  if (process.env.AGENTDECK_LOG_STDERR === "1") streams.push({ stream: process.stderr });
  const log = pino({ base: { v: DAEMON_VERSION } }, pino.multistream(streams)) as unknown as Logger;
  const daemon = new Daemon(opts, log);
  const port = await daemon.start(Number(process.env.AGENTDECK_LOCAL_PORT ?? 0));
  process.stdout.write(`agentdeck daemon ${DAEMON_VERSION} listening on 127.0.0.1:${port}\n`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}
