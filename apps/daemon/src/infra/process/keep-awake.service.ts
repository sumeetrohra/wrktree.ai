import { spawn, type ChildProcess } from "node:child_process";

import type { ILogger } from "@agentdeck/shared";

/** ES_CONTINUOUS | ES_SYSTEM_REQUIRED: the system stays awake while this thread lives. */
const WINDOWS_SCRIPT =
  "$p = Add-Type -Name P -Namespace W -PassThru -MemberDefinition " +
  "'[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'; " +
  "[void]$p::SetThreadExecutionState(0x80000001); while ($true) { Start-Sleep -Seconds 3600 }";

/**
 * The program that holds a "don't sleep" lock while it runs (Phase 4d), or null on an OS without
 * one: `caffeinate` (macOS, ends with the daemon), `systemd-inhibit` (Linux), and on Windows
 * PowerShell calling SetThreadExecutionState. The display may still sleep.
 */
export function keepAwakeCommand(platform: NodeJS.Platform, daemonPid: number): string[] | null {
  switch (platform) {
    case "darwin":
      return ["caffeinate", "-i", "-w", String(daemonPid)];
    case "linux":
      return [
        "systemd-inhibit",
        "--what=idle:sleep",
        "--who=Agentdeck",
        "--why=An agent is working",
        "--mode=block",
        "sleep",
        "infinity",
      ];
    case "win32":
      return ["powershell", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT];
    default:
      return null;
  }
}

/**
 * Keeps the computer awake while `set(true)`: one helper process, started on demand and
 * stopped when nothing needs it. A missing helper is logged once and otherwise ignored.
 */
export class KeepAwake {
  private child: ChildProcess | null = null;
  private failed = false;

  constructor(
    private readonly command: string[] | null,
    private readonly log: ILogger,
  ) {}

  set(awake: boolean): void {
    if (awake && !this.child && !this.failed && this.command) {
      const [bin, ...args] = this.command;
      if (bin === undefined) return;
      const child = spawn(bin, args, { stdio: "ignore", windowsHide: true });
      child.on("error", (e) => {
        this.failed = true;
        this.child = null;
        this.log.warn({ err: e.message }, "keep-awake helper unavailable; the computer may sleep");
      });
      child.on("exit", () => {
        if (this.child === child) this.child = null;
      });
      this.child = child;
      this.log.info({}, "keeping the computer awake while agents work");
    } else if (!awake && this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  get active(): boolean {
    return this.child !== null;
  }
}
