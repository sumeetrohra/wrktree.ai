import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TScenario } from "../scenario.ts";

export const housekeeping: TScenario = {
  n: 29,
  title: "Status, doctor, install and uninstall",
  summary:
    "The CLI reports what this computer is doing, what it's missing, and starts or stops the daemon at login",
  covers: [
    "Phase 4d: `agentdeck status` (chats, profiles, usage, relay), `agentdeck doctor` with a redacted log bundle",
    "Phase 4d: `agentdeck install` / `uninstall` plans for this OS",
  ],
  async run(h) {
    h.step("A repo, a profile and a chat that has done a turn");
    const ids = await h.quickstart();
    const since = h.mark();
    await h.send("chat.send", { chatId: ids.chatId, text: "hello" });
    await h.waitText(ids.chatId, "You said: hello", since);
    await h.waitSettled(ids.chatId);

    h.step("agentdeck status");
    const status = await h.cli(["status"]);
    await h.check("the daemon, the work and the profile's usage today", () => {
      assert.equal(status.code, 0, status.out);
      assert.match(status.stdout, /daemon running/);
      assert.match(status.stdout, /1 repos · 1 worktrees · 1 chats \(0 working\)/);
      assert.match(status.stdout, /Personal \(fake\)\s+available\s+today 5 in \/ \d+ out/);
      assert.match(status.stdout, /Relay\s+none \(local only\)/);
    });

    h.step("agentdeck doctor --bundle");
    const logs = join(h.home, "logs");
    mkdirSync(logs, { recursive: true });
    appendFileSync(
      join(logs, "zz-e2e.log"),
      '{"msg":"linked","email":"me@example.com","deviceToken":"dt.secret.value"}\nAuthorization: Bearer eyJsecret\n',
    );
    const bundle = join(h.root, "doctor.txt");
    const doctor = await h.cli(["doctor", "--bundle", bundle]);
    await h.check("every check reports, and nothing it needs is missing", () => {
      assert.equal(doctor.code, 0, doctor.out);
      for (const name of ["Node.js", "git", "Daemon", "Relay", "Worktree ports"])
        assert.match(doctor.stdout, new RegExp(name));
      assert.match(doctor.stdout, /Daemon\s+running/);
    });
    await h.check("the bundle has the checks and the logs, without tokens or emails", () => {
      const text = readFileSync(bundle, "utf8");
      assert.match(text, /\[ok\] Daemon: running/);
      assert.match(text, /===== zz-e2e\.log/);
      assert.doesNotMatch(text, /me@example\.com|dt\.secret\.value|eyJsecret/);
    });

    h.step("agentdeck install / uninstall --dry-run");
    const install = await h.cli(["install", "--dry-run"]);
    const uninstall = await h.cli(["uninstall", "--dry-run"]);
    await h.check("this OS's service plan, and its undo", () => {
      assert.equal(install.code, 0, install.out);
      assert.equal(uninstall.code, 0, uninstall.out);
      const service =
        process.platform === "darwin" ? /launchctl/ : process.platform === "win32" ? /schtasks/ : /systemctl/;
      assert.match(install.stdout, service);
      assert.match(uninstall.stdout, service);
      assert.match(uninstall.stdout, /Dry run: nothing changed/);
    });
  },
};
