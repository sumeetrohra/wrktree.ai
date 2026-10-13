import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { FAKE_GH_LOGGED_OUT_FILE } from "@agentdeck/fake-gh";

import type { TScenario } from "../scenario.ts";

import { isEvent, signedInPhone, type TRequested } from "./relay-helpers.ts";

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export const relayShip: TScenario = {
  n: 18,
  title: "Ship it from the phone",
  summary: "Commit, push, an agent-drafted PR, merge; and asking the agent about specific lines",
  covers: [
    "Phase 3b: commit and push the worktree's branch from the phone",
    "Phase 3b: the agent drafts the PR; create it and merge it from the phone (GitHub CLI on the computer)",
    "Phase 3b: comment on lines → the agent gets the quoted code",
  ],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo with a GitHub-style origin, and a profile");
    const repoPath = h.makeRepo("shop", {}, { origin: true });
    const origin = h.origin("shop");
    const repo = await h.send("repo.add", { path: repoPath });
    const profileId = await h.addProfile("Personal");
    const phone = await signedInPhone(h);

    h.step("Phone: a task; the agent writes NOTES.md (approved)");
    const wt = await phone.call("worktree.create", { repoId: repo.id, branch: "notes", title: "Notes" });
    await phone.waitFor(
      isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
      "worktree ready",
    );
    const chat = await phone.call("chat.create", { worktreeId: wt.id, agent: "fake", profileId });
    await phone.waitFor(
      isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle"),
      "chat idle",
    );
    await phone.call("chat.send", { chatId: chat.id, text: "#script:golden file=NOTES.md" });
    const req = (
      await phone.waitFor(
        isEvent("permission.requested", (e) => e.chatId === chat.id),
        "permission",
      )
    ).event as TRequested;
    let before = phone.events.length;
    await phone.call("permission.respond", {
      chatId: chat.id,
      requestId: req.request.requestId,
      decision: "allow_once",
    });
    await phone.waitFor(
      (f) =>
        phone.events.indexOf(f) >= before &&
        isEvent("chat.status", (e) => e.chatId === chat.id && e.status === "idle")(f),
      "turn finished",
    );

    h.step("Phone: status, commit, push");
    const dirty = await phone.call("git.status", { worktreeId: wt.id });
    await h.check("the phone sees one uncommitted file on a branch with a remote", () => {
      assert.equal(dirty.branch, "notes");
      assert.equal(dirty.dirty, 1);
      assert.equal(dirty.hasRemote, true);
      assert.equal(dirty.upstream, null);
    });
    const { sha } = await phone.call("git.commit", {
      worktreeId: wt.id,
      message: "Add release notes",
      all: true,
    });
    await phone.call("git.push", { worktreeId: wt.id });
    const pushed = await phone.call("git.status", { worktreeId: wt.id });
    await h.check("the commit is on origin, and the branch tracks it", () => {
      assert.equal(git(origin, "rev-parse", "notes"), sha);
      assert.equal(pushed.upstream, "origin/notes");
      assert.equal(pushed.dirty, 0);
      assert.equal(pushed.ahead, 0);
    });

    h.step("Phone: “Draft with the agent”");
    const draft = await phone.call("pr.draft", { chatId: chat.id });
    await h.check("the agent's reply becomes a title and a body", () => {
      assert.equal(draft.title, "Update the notes");
      assert.match(draft.body, /Adds `NOTES.md`/);
    });

    h.step("Phone: create the PR, then merge it (gh on the computer)");
    assert.equal(await phone.call("pr.status", { worktreeId: wt.id }), null);
    const pr = await phone.call("pr.create", { worktreeId: wt.id, title: draft.title, body: draft.body });
    await h.check("the PR is open", async () => {
      assert.equal(pr.state, "open");
      assert.match(pr.url, /\/pull\/1$/);
      assert.deepEqual(await phone.call("pr.status", { worktreeId: wt.id }), pr);
    });
    const merged = await phone.call("pr.merge", { worktreeId: wt.id, method: "squash" });
    await h.check("merged: origin's main has the notes", () => {
      assert.equal(merged.state, "merged");
      assert.match(git(origin, "show", "main:NOTES.md"), /\S/);
    });

    h.step("Phone: select lines 1–2 of src/app.ts → “Ask the agent about this”");
    before = phone.events.length;
    await phone.call("chat.send", {
      chatId: chat.id,
      text: "Why does this return a boolean?",
      context: [{ path: "src/app.ts", line: 1, endLine: 2 }],
    });
    const reply = await phone.waitFor(
      (f) =>
        phone.events.indexOf(f) >= before &&
        f.event.type === "chat.item" &&
        f.event.item.kind === "agent_text" &&
        f.event.item.text.includes("Why does this"),
      "the agent's reply",
    );
    await h.check("the agent got the quoted lines with the question", () => {
      assert.ok(reply.event.type === "chat.item" && reply.event.item.kind === "agent_text");
      assert.match(reply.event.item.text, /From `src\/app.ts` lines 1–2/);
      assert.match(reply.event.item.text, /export function login\(user: string\)/);
    });
    await h.check("the chat shows the message with what it quoted", () => {
      const sent = phone.events.find(
        (f) =>
          f.event.type === "chat.item" && f.event.item.kind === "user" && f.event.item.text.startsWith("Why"),
      );
      assert.ok(sent?.event.type === "chat.item" && sent.event.item.kind === "user");
      assert.deepEqual(sent.event.item.context, [{ path: "src/app.ts", line: 1, endLine: 2 }]);
    });
    await h.check("lines outside the worktree can't be quoted", async () => {
      await assert.rejects(
        phone.call("chat.send", { chatId: chat.id, text: "x", context: [{ path: "../../home/x", line: 1 }] }),
        /FORBIDDEN_PATH/,
      );
    });

    h.step("Desktop: `gh` signs out");
    writeFileSync(join(repoPath, ".git", FAKE_GH_LOGGED_OUT_FILE), "");
    await h.check("the phone is told to run `gh auth login` on the computer", async () => {
      await assert.rejects(
        phone.call("pr.status", { worktreeId: wt.id }),
        /NOT_AUTHENTICATED: .*gh auth login/,
      );
    });
  },
};
