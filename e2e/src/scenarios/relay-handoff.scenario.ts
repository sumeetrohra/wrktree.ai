import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { TScenario } from "../scenario.ts";

import { isEvent, signedInPhone, type TRequested } from "./relay-helpers.ts";

export const relayHandoff: TScenario = {
  n: 25,
  title: "Hand a limited chat to another profile",
  summary:
    "Profile A hits its limit mid-task; the phone continues on profile B in the same worktree, with a brief",
  covers: [
    "Phase 4b: hand-off to another profile, same worktree, brief built without a model call",
    "Phase 4 acceptance: a limit on one profile offers hand-off; the new chat continues the work",
  ],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo and two profiles of the same agent");
    const repoPath = h.makeRepo("shop");
    const repo = await h.send("repo.add", { path: repoPath });
    const work = await h.addProfile("Work");
    const personal = await h.addProfile("Personal");
    const phone = await signedInPhone(h);
    const wt = await phone.call("worktree.create", { repoId: repo.id, branch: "notes", title: "Notes" });
    const ready = await phone.waitFor(
      isEvent("worktree.updated", (e) => e.worktree.id === wt.id && e.worktree.status === "ready"),
      "worktree ready",
    );
    const wtPath = ready.event.type === "worktree.updated" ? ready.event.worktree.path : "";
    const a = await phone.call("chat.create", {
      worktreeId: wt.id,
      agent: "fake",
      profileId: work,
      title: "Release notes",
    });
    await phone.waitFor(
      isEvent("chat.status", (e) => e.chatId === a.id && e.status === "idle"),
      "chat idle",
    );

    h.step("Phone: on Work, the agent writes NOTES.md (approved), then hits the limit");
    await phone.call("chat.send", { chatId: a.id, text: "Write release notes #script:golden file=NOTES.md" });
    const req = (
      await phone.waitFor(
        isEvent("permission.requested", (e) => e.chatId === a.id),
        "permission",
      )
    ).event as TRequested;
    let mark = phone.events.length;
    const since = (pred: ReturnType<typeof isEvent>) => (f: (typeof phone.events)[number]) =>
      phone.events.indexOf(f) >= mark && pred(f);
    await phone.call("permission.respond", {
      chatId: a.id,
      requestId: req.request.requestId,
      decision: "allow_once",
    });
    await phone.waitFor(
      since(isEvent("chat.status", (e) => e.chatId === a.id && e.status === "idle")),
      "turn 1 done",
    );
    await phone.call("chat.send", { chatId: a.id, text: "Now the changelog #script:limit resetInMs=600000" });
    await phone.waitFor(
      isEvent("chat.status", (e) => e.chatId === a.id && e.status === "limited"),
      "limited",
    );
    await phone.call("chat.send", { chatId: a.id, text: "Then tidy the README" });

    h.step("Phone: Continue on Personal");
    mark = phone.events.length;
    const b = await phone.call("chat.handoff", { chatId: a.id, profileId: personal });
    await h.check("a new chat on Personal, same worktree, linked to the old one", () => {
      assert.equal(b.profileId, personal);
      assert.equal(b.worktreeId, wt.id);
      assert.equal(b.handedOffFrom, a.id);
      assert.equal(b.title, "Release notes");
    });
    await phone.follow(`chat:${b.id}`);
    const briefTurn = await phone.waitFor(
      isEvent(
        "chat.item",
        (e) => e.chatId === b.id && e.item.kind === "user" && e.item.text.includes("taking over"),
      ),
      "the brief",
    );
    await h.check("the brief carries the conversation, the changes and the profile it came from", () => {
      assert.ok(briefTurn.event.type === "chat.item" && briefTurn.event.item.kind === "user");
      const brief = briefTurn.event.item.text;
      assert.match(brief, /from fake \(profile "Work"\)[^\n]*it reached its usage limit/);
      assert.match(brief, /User: Write release notes #script:golden file=NOTES\.md/);
      assert.doesNotMatch(brief, /tidy the README/); // still queued: it follows as its own message
      assert.match(brief, /## Changes in the worktree so far\n\n- untracked NOTES\.md \(\+\d+ -0\)/);
    });
    await phone.waitFor(
      since(isEvent("chat.status", (e) => e.chatId === b.id && e.status === "idle" && (e.queued ?? 0) === 0)),
      "both turns on the new chat",
      30_000,
    );
    await h.check("the new agent got the brief, then the message queued on the old chat", async () => {
      const items = phone.events.flatMap((f) =>
        f.event.type === "chat.item" && f.event.chatId === b.id && f.event.item.kind === "user"
          ? [f.event.item.text]
          : [],
      );
      assert.equal(items.length, 2);
      assert.equal(items[1], "Then tidy the README");
      // It works in the same worktree: the file the first agent wrote is there.
      assert.match(readFileSync(join(wtPath, "NOTES.md"), "utf8"), /fake agent/);
      const old = await phone.call("chat.list", { worktreeId: wt.id });
      assert.equal(old.find((c) => c.id === a.id)?.queued, 0);
    });
    await h.check("the old chat says where the work went", async () => {
      await phone.waitFor(
        isEvent(
          "chat.item",
          (e) =>
            e.chatId === a.id &&
            e.item.kind === "system" &&
            e.item.text.includes("Continued in a new chat on Personal"),
        ),
        "the note",
      );
    });
    await h.check("handing off to the same profile is refused", async () => {
      await assert.rejects(phone.call("chat.handoff", { chatId: b.id, profileId: personal }), /INVALID_ARGS/);
    });
  },
};
