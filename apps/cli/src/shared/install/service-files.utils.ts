import { join } from "node:path";

/** How the daemon is started at login, per OS (spec: `agentdeck install`). */
export type TInstallPlan = {
  /** Files to write: absolute path → contents. */
  files: Record<string, string>;
  /** Programs to run after writing, without a shell. */
  commands: string[][];
};

const LABEL = "dev.agentdeck.daemon";

const xml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** macOS: a LaunchAgent that starts at login and restarts on crash. */
function launchdPlan(home: string, node: string, cli: string): TInstallPlan {
  const path = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(cli)}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
  return {
    files: { [path]: plist },
    commands: [
      ["launchctl", "unload", path],
      ["launchctl", "load", "-w", path],
    ],
  };
}

const quoteSystemd = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Linux: a systemd user service. */
function systemdPlan(home: string, node: string, cli: string): TInstallPlan {
  const path = join(home, ".config", "systemd", "user", "agentdeck.service");
  const unit = `[Unit]
Description=Agentdeck daemon
After=network-online.target

[Service]
ExecStart=${quoteSystemd(node)} ${quoteSystemd(cli)} daemon
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
  return {
    files: { [path]: unit },
    commands: [
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "agentdeck.service"],
    ],
  };
}

/** Windows: a scheduled task that runs at logon with the user's rights. */
function windowsPlan(node: string, cli: string): TInstallPlan {
  const tr = `"${node}" "${cli}" daemon`;
  return {
    files: {},
    commands: [
      ["schtasks", "/Create", "/TN", "Agentdeck", "/SC", "ONLOGON", "/RL", "LIMITED", "/F", "/TR", tr],
    ],
  };
}

export function planFor(platform: NodeJS.Platform, home: string, node: string, cli: string): TInstallPlan {
  switch (platform) {
    case "darwin":
      return launchdPlan(home, node, cli);
    case "win32":
      return windowsPlan(node, cli);
    default:
      return systemdPlan(home, node, cli);
  }
}

/** Undoing `install`: files to delete and programs to run (missing ones are fine). */
export type TUninstallPlan = { remove: string[]; commands: string[][] };

export function uninstallPlanFor(platform: NodeJS.Platform, home: string): TUninstallPlan {
  switch (platform) {
    case "darwin": {
      const path = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
      return { remove: [path], commands: [["launchctl", "unload", "-w", path]] };
    }
    case "win32":
      return { remove: [], commands: [["schtasks", "/Delete", "/TN", "Agentdeck", "/F"]] };
    default:
      return {
        remove: [join(home, ".config", "systemd", "user", "agentdeck.service")],
        commands: [
          ["systemctl", "--user", "disable", "--now", "agentdeck.service"],
          ["systemctl", "--user", "daemon-reload"],
        ],
      };
  }
}
