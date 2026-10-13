import { existsSync } from "node:fs";

import { AgentdeckError } from "@agentdeck/protocol";
import type * as NodePty from "node-pty";

/** A shell on a pseudo-terminal: what the terminals module needs from node-pty (L27). */
export interface IPtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (code: number) => void): void;
}

type TPtyModule = typeof NodePty;

let loaded: Promise<TPtyModule | null> | null = null;

/**
 * node-pty is an optional native addon: loaded on first use, so a computer where it didn't install
 * still runs everything but the terminal.
 */
function ptyModule(): Promise<TPtyModule | null> {
  loaded ??= import("node-pty").catch(() => null);
  return loaded;
}

/** The user's shell: `$SHELL` (or bash, then sh) on macOS and Linux, PowerShell on Windows. */
export function defaultShell(env: Readonly<Record<string, string | undefined>>): string {
  if (process.platform === "win32") return "powershell.exe";
  const shell = env["SHELL"];
  if (shell !== undefined && shell !== "" && existsSync(shell)) return shell;
  return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
}

/** Starts `shell` on a new pseudo-terminal. Throws BAD_STATE when node-pty isn't installed. */
export async function spawnPty(
  shell: string,
  opts: { cwd: string; env: Record<string, string>; cols: number; rows: number },
): Promise<IPtyProcess> {
  const pty = await ptyModule();
  if (pty === null) {
    throw new AgentdeckError(
      "BAD_STATE",
      "The terminal needs node-pty, which didn't install on this computer (agentdeck doctor)",
    );
  }
  const p = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: opts.env,
  });
  return {
    pid: p.pid,
    write: (data) => {
      p.write(data);
    },
    resize: (cols, rows) => {
      p.resize(cols, rows);
    },
    kill: () => {
      try {
        p.kill();
      } catch {
        // Already gone.
      }
    },
    onData: (listener) => {
      p.onData(listener);
    },
    onExit: (listener) => {
      p.onExit((e) => {
        listener(e.exitCode);
      });
    },
  };
}

/** Whether node-pty loads here (`agentdeck doctor`). */
export async function ptyAvailable(): Promise<boolean> {
  return (await ptyModule()) !== null;
}
