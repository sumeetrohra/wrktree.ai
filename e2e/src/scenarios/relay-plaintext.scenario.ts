import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { TScenario } from "../scenario.ts";

import { isEvent, pairPhone, type TRequested } from "./relay-helpers.ts";

const PROMPT_CANARY = "PROMPT-CANARY-7f3a9c";
const FILE_CANARY = "Demo app for the Agentdeck end-to-end tests";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

export const relayPlaintext: TScenario = {
  n: 12,
  title: "The relay never sees content",
  summary: "After a chat, a file read and an offline spell, the relay's database and log hold no plaintext",
  covers: ["Phase 2: relay database dump contains no plaintext message content (automated check)"],
  relay: true,
  async run(h) {
    const ids = await h.quickstart();
    const phone = await pairPhone(h);

    h.step("Phone: a prompt with a canary, and a file read");
    await phone.call("chat.send", {
      chatId: ids.chatId,
      text: `#script:golden file=NOTES.md ${PROMPT_CANARY}`,
    });
    const req = (
      await phone.waitFor(
        isEvent("permission.requested", (e) => e.chatId === ids.chatId),
        "permission",
      )
    ).event as TRequested;
    const read = await phone.call("fs.read", { worktreeId: ids.worktreeId, path: "README.md" });
    await h.check("the phone could read both", () => {
      assert.ok(read.text.includes(FILE_CANARY));
    });

    h.step("Offline while the turn finishes, so frames sit in the relay's buffer");
    phone.disconnect();
    await h.send("permission.respond", {
      chatId: ids.chatId,
      requestId: req.request.requestId,
      decision: "allow_once",
    });
    await h.waitSettled(ids.chatId);
    await h.pause(500);

    h.step("Dump everything the relay stored and logged");
    const stored = filesUnder(h.relayDir)
      .map((f) => readFileSync(f).toString("latin1"))
      .join("\n");
    const logged = h.relayLog.join("\n");
    const wire = phone.wire.join("\n");
    await h.check("the relay actually stored and forwarded frames", () => {
      assert.ok(stored.length > 0 && wire.length > 0);
    });
    for (const [label, needle] of [
      ["the prompt", PROMPT_CANARY],
      ["file contents", FILE_CANARY],
      ["the agent's reply", "Written by the fake agent"],
    ] as const) {
      await h.check(`no ${label} in the relay's database, log or wire traffic`, () => {
        assert.ok(!stored.includes(needle), "database");
        assert.ok(!logged.includes(needle), "log");
        assert.ok(!wire.includes(needle), "wire");
      });
    }
  },
};
