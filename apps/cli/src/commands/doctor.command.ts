import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { defaultHome, pathsFor, ptyAvailable } from "@agentdeck/daemon";

import { DaemonClient } from "#src/lib/daemon-client/index.js";
import { runCapture } from "#src/lib/process/index.js";
import { redact, runChecks, type IDoctorProbe, type TCheck } from "#src/shared/doctor/index.js";
import { c, print } from "#src/shared/output/index.js";

const LOG_LINES = 500;

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => {
      resolve(true);
    });
    s.listen(port, "127.0.0.1", () => {
      s.close(() => {
        resolve(false);
      });
    });
  });
}

const probe: IDoctorProbe = {
  platform: process.platform,
  nodeVersion: process.version,
  run: runCapture,
  daemonRunning: async () => {
    try {
      (await DaemonClient.connect()).close();
      return true;
    } catch {
      return false;
    }
  },
  relayUrl: async () => {
    try {
      const cl = await DaemonClient.connect();
      try {
        return (await cl.call("relay.status", {})).url;
      } finally {
        cl.close();
      }
    } catch {
      return process.env["AGENTDECK_RELAY_URL"] ?? null;
    }
  },
  reachable: async (url) => {
    try {
      return (await fetch(new URL("/health", url), { signal: AbortSignal.timeout(5000) })).ok;
    } catch {
      return false;
    }
  },
  portInUse,
  terminal: ptyAvailable,
};

const MARK: Record<TCheck["status"], string> = { ok: c.green("✓"), warn: c.yellow("!"), fail: c.red("✗") };

/** `agentdeck doctor [--bundle <file>]`: what's missing on this computer, and how to fix it. */
export async function doctorCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { bundle: { type: "string" } } });
  const range = /^(\d+)-\d+$/.exec(process.env["AGENTDECK_PORT_RANGE"] ?? "")?.[1];
  const checks = await runChecks(probe, range === undefined ? undefined : Number(range));
  const lines = checks.map(
    (ch) => `${MARK[ch.status]} ${ch.name.padEnd(30)} ${ch.detail}${ch.fix ? c.gray(`  → ${ch.fix}`) : ""}`,
  );
  for (const l of lines) print(l);
  const failed = checks.filter((ch) => ch.status === "fail").length;
  if (failed > 0) process.exitCode = 1;
  if (values.bundle === undefined) return;
  const logs = pathsFor(defaultHome()).logs;
  const parts = [
    `agentdeck doctor, ${new Date().toISOString()}, ${process.platform} ${process.arch}`,
    checks
      .map((ch) => `[${ch.status}] ${ch.name}: ${ch.detail}${ch.fix ? ` (fix: ${ch.fix})` : ""}`)
      .join("\n"),
  ];
  if (existsSync(logs)) {
    for (const name of readdirSync(logs).sort()) {
      const tail = readFileSync(join(logs, name), "utf8").split("\n").slice(-LOG_LINES).join("\n");
      parts.push(`===== ${name} (last ${String(LOG_LINES)} lines) =====\n${redact(tail)}`);
    }
  }
  writeFileSync(values.bundle, `${parts.join("\n\n")}\n`);
  print(
    c.gray(`\nWrote ${values.bundle}: these checks and the daemon's recent logs, tokens and emails removed.`),
  );
}
