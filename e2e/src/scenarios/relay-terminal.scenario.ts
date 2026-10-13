import assert from "node:assert/strict";

import type { TScenario } from "../scenario.ts";

import { isEvent, signedInPhone } from "./relay-helpers.ts";

const WIN = process.platform === "win32";
/** A sum, so seeing the answer proves the shell ran it (its echo doesn't contain the answer). */
const SUM = WIN ? "set /a 6*7+1000\r" : "echo sum-$((20+22))\r";
const ANSWER = WIN ? "1042" : "sum-42";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ESCAPES = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]|${ESC}\\][^${BEL}]*${BEL}`, "g");
/**
 * What a terminal shows, for matching: escape sequences and all whitespace removed. Windows'
 * ConPTY redraws with cursor moves instead of spaces and splits lines across events.
 */
const plain = (text: string): string => text.replace(ESCAPES, "").replace(/\s+/g, "");

/** Matches `needle` in everything the terminal printed so far (the events add up). */
function printed(termId: string, needle: string) {
  let seen = "";
  return isEvent("term.output", (e) => {
    if (e.termId !== termId) return false;
    seen += e.data;
    return plain(seen).includes(plain(needle));
  });
}
/** The prompt (the harness runs cmd.exe on Windows). */
const PROMPT = WIN ? /[A-Z]:\\[^>\r\n]*>/ : /[$#%>] ?$/m;

export const relayTerminal: TScenario = {
  n: 30,
  title: "A terminal from the phone",
  summary: "Off for other devices until the computer allows it; then a shell in the worktree, live",
  covers: [
    "Phase 5: `term.open/input/resize/close` with output on `term:<id>`, sealed like chats",
    "SEC25: terminals from other devices are off until `agentdeck config terminal remote on`",
  ],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo; phone: a worktree");
    const repo = await h.send("repo.add", { path: h.makeRepo("shell") });
    const phone = await signedInPhone(h);
    const wt = await phone.call("worktree.create", { repoId: repo.id, branch: "term", title: "Term" });
    await phone.waitFor(
      isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
      "worktree ready",
    );

    h.step("Phone: the terminal is off for other devices by default");
    await h.check("listed as disabled, and opening one is refused", async () => {
      assert.equal((await phone.call("term.list", { worktreeId: wt.id })).enabled, false);
      await assert.rejects(
        phone.call("term.open", { worktreeId: wt.id, cols: 80, rows: 24 }),
        /UNAUTHORIZED/,
      );
    });

    h.step("Desktop: agentdeck config terminal remote on");
    const on = await h.cli(["config", "terminal", "remote", "on"]);
    await h.check("the CLI turns it on, without a restart", async () => {
      assert.equal(on.code, 0, on.out);
      assert.equal((await phone.call("term.list", { worktreeId: wt.id })).enabled, true);
    });

    h.step("Phone: open a terminal and run commands in the worktree");
    const term = await phone.call("term.open", { worktreeId: wt.id, cols: 80, rows: 24 });
    await phone.follow(`term:${term.id}`);
    // Type at the prompt, as a person does.
    await phone.waitFor(
      isEvent("term.output", (e) => e.termId === term.id && PROMPT.test(e.data)),
      "the shell's prompt",
    );
    await phone.call("term.input", { termId: term.id, data: SUM });
    await phone.waitFor(printed(term.id, ANSWER), "the command's output");
    await phone.call("term.input", { termId: term.id, data: "git status\r" });
    await phone.waitFor(printed(term.id, "On branch term"), "git status in the worktree");
    await h.check("resize, and the scrollback reads back as one blob", async () => {
      assert.equal((await phone.call("term.resize", { termId: term.id, cols: 100, rows: 30 })).cols, 100);
      const { blob } = await phone.call("term.output", { termId: term.id });
      const { base64 } = await phone.call("blob.get", { blobId: blob.blobId });
      const text = Buffer.from(base64, "base64").toString();
      assert.ok(plain(text).includes(ANSWER));
      assert.ok(plain(text).includes("Onbranchterm"));
    });

    h.step("Phone: close it");
    const closed = await phone.call("term.close", { termId: term.id });
    await h.check("the shell has exited", () => {
      assert.equal(closed.status, "exited");
    });

    h.step("Desktop: agentdeck config terminal remote off");
    const off = await h.cli(["config", "terminal", "remote", "off"]);
    await h.check("refused again", async () => {
      assert.equal(off.code, 0, off.out);
      await assert.rejects(
        phone.call("term.open", { worktreeId: wt.id, cols: 80, rows: 24 }),
        /UNAUTHORIZED/,
      );
    });
  },
};
