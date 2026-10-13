import assert from "node:assert/strict";

import type { TScenario } from "../scenario.ts";

import { eventually, signedInPhone } from "./relay-helpers.ts";

export const relayCompare: TScenario = {
  n: 32,
  title: "One task, two agents, side by side",
  summary:
    "The phone gives a task to two profiles; each works in its own worktree; keep one, the other is archived",
  covers: [
    "Phase 5: `compare.start` (sibling worktrees from one base, chats started by the computer), `compare.pick`",
  ],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo and two profiles");
    const repo = await h.send("repo.add", { path: h.makeRepo("shop") });
    const work = await h.addProfile("Work");
    const personal = await h.addProfile("Personal");
    const phone = await signedInPhone(h);

    h.step("Phone: give the same task to both");
    const since = h.mark();
    const started = await phone.call("compare.start", {
      repoId: repo.id,
      branch: "dark-mode",
      title: "Dark mode",
      prompt: "add a dark mode toggle",
      targets: [
        { profileId: work, agent: "fake" },
        { profileId: personal, agent: "fake" },
      ],
    });
    await h.check("two worktrees from the same base, one per profile", async () => {
      assert.equal(started.entries.length, 2);
      const wts = await phone.call("worktree.list", { repoId: repo.id });
      const mine = wts.filter((w) => started.entries.some((e) => e.worktreeId === w.id));
      assert.deepEqual(mine.map((w) => w.branch).sort(), ["dark-mode-1", "dark-mode-2"]);
      assert.ok(mine.every((w) => w.baseRef === started.baseRef));
    });

    const running = await eventually(
      "both chats started by the computer",
      () => phone.call("compare.get", { compareId: started.id }),
      (c) => c.entries.every((e) => e.chatId !== null),
    );
    await h.check("each agent got the prompt and answered in its own worktree", async () => {
      for (const e of running.entries) {
        assert.ok(e.chatId !== null);
        await h.waitText(e.chatId, "You said: add a dark mode toggle", since);
      }
      const chats = await phone.call("chat.list", { worktreeId: running.entries[1]?.worktreeId ?? "" });
      assert.equal(chats[0]?.profileId, personal);
    });

    h.step("Phone: keep Work's version");
    const keep = running.entries[0]?.worktreeId ?? "";
    const other = running.entries[1]?.worktreeId ?? "";
    const picked = await phone.call("compare.pick", { compareId: started.id, worktreeId: keep });
    await h.check("the winner is kept; the other worktree is archived", async () => {
      assert.equal(picked.winner, keep);
      const wts = await phone.call("worktree.list", { repoId: repo.id });
      assert.equal(wts.find((w) => w.id === keep)?.archivedAt, null);
      assert.notEqual(wts.find((w) => w.id === other)?.archivedAt, null);
      assert.deepEqual(
        (await phone.call("compare.list", { repoId: repo.id })).map((c) => c.winner),
        [keep],
      );
    });

    h.step("Phone: what it refuses");
    await h.check("a profile given with the wrong agent", async () => {
      await assert.rejects(
        phone.call("compare.start", {
          repoId: repo.id,
          branch: "other",
          title: "Other",
          prompt: "x",
          targets: [
            { profileId: work, agent: "claude" },
            { profileId: personal, agent: "fake" },
          ],
        }),
        /INVALID_ARGS/,
      );
    });
    await h.check("branches that already exist: nothing is left behind", async () => {
      const before = (await phone.call("worktree.list", { repoId: repo.id })).length;
      await assert.rejects(
        phone.call("compare.start", {
          repoId: repo.id,
          branch: "dark-mode",
          title: "Again",
          prompt: "x",
          targets: [
            { profileId: work, agent: "fake" },
            { profileId: personal, agent: "fake" },
          ],
        }),
        /CONFLICT/,
      );
      assert.equal((await phone.call("worktree.list", { repoId: repo.id })).length, before);
    });
  },
};
