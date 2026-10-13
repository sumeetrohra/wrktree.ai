import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { planFor, uninstallPlanFor } from "./service-files.utils.js";

describe("install plans", () => {
  it("macOS: a LaunchAgent with escaped paths", () => {
    const plan = planFor("darwin", "/Users/me", ["/opt/node", "/opt/a&b/cli.js"]);
    const [path, plist] = Object.entries(plan.files)[0] ?? [];
    expect(path).toBe(join("/Users/me", "Library", "LaunchAgents", "dev.agentdeck.daemon.plist"));
    expect(plist).toContain("<string>/opt/a&amp;b/cli.js</string>");
    expect(plan.commands.at(-1)).toEqual(["launchctl", "load", "-w", path]);
  });

  it("Linux: a systemd user unit", () => {
    const plan = planFor("linux", "/home/me", ["/usr/bin/node", "/opt/cli.js"]);
    expect(Object.keys(plan.files)).toEqual([
      join("/home/me", ".config", "systemd", "user", "agentdeck.service"),
    ]);
    expect(Object.values(plan.files)[0]).toContain('ExecStart="/usr/bin/node" "/opt/cli.js" daemon');
    expect(plan.commands).toContainEqual(["systemctl", "--user", "enable", "--now", "agentdeck.service"]);
  });

  it("Windows: a logon task, no files", () => {
    const plan = planFor("win32", "C:\\Users\\me", ["C:\\node.exe", "C:\\cli.js"]);
    expect(plan.files).toEqual({});
    expect(plan.commands[0]).toContain('"C:\\node.exe" "C:\\cli.js" daemon');
  });

  it("the single-file build runs itself: no separate script", () => {
    const unit = Object.values(planFor("linux", "/home/me", ["/usr/local/bin/agentdeck"]).files)[0];
    expect(unit).toContain('ExecStart="/usr/local/bin/agentdeck" daemon');
    expect(planFor("win32", "C:\\Users\\me", ["C:\\agentdeck.exe"]).commands[0]).toContain(
      '"C:\\agentdeck.exe" daemon',
    );
  });

  it("uninstall undoes each OS's install", () => {
    const mac = uninstallPlanFor("darwin", "/Users/me");
    expect(mac.remove).toEqual([join("/Users/me", "Library", "LaunchAgents", "dev.agentdeck.daemon.plist")]);
    expect(mac.commands).toEqual([["launchctl", "unload", "-w", mac.remove[0]]]);
    expect(uninstallPlanFor("linux", "/home/me").commands[0]).toEqual([
      "systemctl",
      "--user",
      "disable",
      "--now",
      "agentdeck.service",
    ]);
    expect(uninstallPlanFor("win32", "C:\\Users\\me")).toEqual({
      remove: [],
      commands: [["schtasks", "/Delete", "/TN", "Agentdeck", "/F"]],
    });
  });
});
