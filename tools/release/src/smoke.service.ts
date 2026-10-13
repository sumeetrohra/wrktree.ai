import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { node, npm, run } from "./npm.utils.js";

/**
 * Starts the daemon (`agentdeck` is how to run the CLI: `[node, script]` or `[binary]`) in a fresh
 * home, waits for it, and asks `agentdeck status`.
 */
async function daemonStarts(
  agentdeck: readonly string[],
  dir: string,
  whileRunning: (env: NodeJS.ProcessEnv) => void = () => undefined,
): Promise<void> {
  const home = join(dir, "home");
  const env = { ...process.env, AGENTDECK_HOME: home, AGENTDECK_KEYSTORE: "file", AGENTDECK_KEEP_AWAKE: "0" };
  const [program = "", ...pre] = agentdeck;
  const daemon = spawn(program, [...pre, "daemon"], { env, stdio: "ignore" });
  try {
    const end = Date.now() + 60_000;
    while (!existsSync(join(home, "daemon.json"))) {
      if (Date.now() > end || daemon.exitCode !== null) throw new Error("the installed daemon did not start");
      await new Promise((r) => setTimeout(r, 250));
    }
    const status = run(agentdeck, ["status"], dir, env);
    if (!status.includes("daemon running")) throw new Error(`agentdeck status said:\n${status}`);
    whileRunning(env);
  } finally {
    daemon.kill();
  }
}

/**
 * Installs the packed tarballs in an empty project, as a user would, and runs them: the CLI
 * answers `--help` and its daemon starts (native modules load), the relay's bundle parses, the
 * protocol imports.
 */
export async function smoke(tarballs: Record<string, string>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "agentdeck-smoke-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }));
  npm(["install", "--no-audit", "--no-fund", ...Object.values(tarballs)], dir);
  const cli = join(dir, "node_modules", "agentdeck", "dist", "agentdeck.js");
  const help = node([cli, "--help"], dir);
  if (!help.includes("agentdeck — drive coding agents")) throw new Error(`agentdeck --help said:\n${help}`);
  if (!existsSync(join(dir, "node_modules", "agentdeck", "dist", "web", "index.html"))) {
    process.stdout.write("note: the package has no web UI (apps/mobile was not exported)\n");
  }
  await daemonStarts([process.execPath, cli], dir);
  node(["--check", join(dir, "node_modules", "@agentdeck", "relay", "dist", "relay.js")], dir);
  node(
    [
      "--input-type=module",
      "-e",
      "const p = await import('@agentdeck/protocol'); if (!p.commands) process.exit(1);",
    ],
    dir,
  );
  process.stdout.write(`smoke test passed in ${dir}\n`);
}

/**
 * Runs the single-file build like a user would: `--version`, `--help`, its daemon starts (the
 * native modules unpacked from inside it load) and `status` answers. The cache is a fresh folder.
 */
export async function smokeSea(bin: string, version: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "agentdeck-sea-"));
  const env = { ...process.env, AGENTDECK_CACHE_DIR: join(dir, "cache") };
  const v = run([bin], ["--version"], dir, env).trim();
  if (v !== version) throw new Error(`agentdeck --version said ${v}, expected ${version}`);
  const help = run([bin], ["--help"], dir, env);
  if (!help.includes("agentdeck — drive coding agents")) throw new Error(`agentdeck --help said:\n${help}`);
  process.env["AGENTDECK_CACHE_DIR"] = env.AGENTDECK_CACHE_DIR;
  await daemonStarts([bin], dir, (daemonEnv) => {
    // With the daemon up, every required check passes; the terminal's must too.
    const doctor = run([bin], ["doctor"], dir, daemonEnv);
    if (!doctor.includes("node-pty loads"))
      throw new Error(`the terminal's native module didn't load:\n${doctor}`);
  });
  process.stdout.write(`single-file smoke test passed: ${bin}\n`);
}
