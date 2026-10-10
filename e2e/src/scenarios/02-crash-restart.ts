import assert from "node:assert/strict";
import { newId } from "@agentdeck/shared";
import { DaemonClient } from "@agentdeck/cli";
import type { EvtFrame } from "@agentdeck/protocol";
import type { Scenario } from "../scenario.ts";

export const crashRestart: Scenario = {
  n: 2,
  title: "Daemon crash & restart",
  summary: "kill -9 mid-turn: chats come back, the event log replays from any cursor, no command runs twice",
  covers: [
    "Kill the daemon mid-turn and restart it: chats come back, the event log replays from any cursor, and no command runs twice",
  ],
  async run(h) {
    h.step("Set up a repo, profile, worktree and chat");
    const ids = await h.quickstart();

    h.step("Create a worktree with a fixed command id");
    const cmdId = newId("cmd");
    const args = { repoId: ids.repoId, branch: "idempotent", title: "Idempotent create" };
    const first = await h.send("worktree.create", args, { cmdId });
    await h.waitReady(first.id);

    h.step("Start a long turn");
    let since = h.mark();
    await h.send("chat.send", { chatId: ids.chatId, text: "Refactor everything #script:slow ms=60000" });
    await h.waitText(ids.chatId, "Working on it", since);
    await h.check("the turn is running", async () => {
      const [chat] = await h.client.call("chat.list", { worktreeId: ids.worktreeId });
      assert.equal(chat!.status, "running");
    });
    const cursorBeforeKill = h.events.filter((e) => e.topic === `chat:${ids.chatId}`).at(-1)!.cursor;

    h.step("kill -9 the daemon");
    await h.stopWatcher();
    await h.killDaemon();

    h.step("Restart it");
    since = h.mark();
    await h.startDaemon();
    await h.startWatcher([`chat:${ids.chatId}`, "--from", String(cursorBeforeKill - 3)]);
    await h.waitStatus(ids.chatId, "idle", since);
    await h.check("the chat comes back and resumes its ACP session", async () => {
      const chats = await h.send("chat.list", { worktreeId: ids.worktreeId });
      assert.equal(chats.length, 1);
      assert.equal(chats[0]!.status, "idle");
      assert.equal(chats[0]!.resumed, false, "resumed via session/load, not a fresh session");
    });
    await h.check("the interrupted turn is reported in the chat", () =>
      assert.ok(h.systemText(ids.chatId, since).some((t) => t.includes("interrupted"))),
    );

    h.step("Re-send the same command id");
    const again = await h.send("worktree.create", args, { cmdId });
    await h.check("the stored result comes back, nothing runs twice", async () => {
      assert.equal(again.id, first.id);
      const list = await h.client.call("worktree.list", { repoId: ids.repoId });
      assert.equal(list.filter((w) => w.branch === "idempotent").length, 1);
    });

    h.step("Replay the chat's event log from any cursor");
    const topic = `chat:${ids.chatId}`;
    const live = h.events.filter((e) => e.topic === topic);
    const replay = async (from: number) => {
      const c = await DaemonClient.connect(h.home);
      const got: EvtFrame[] = [];
      c.onEvent((e) => got.push(e));
      const hello = await c.hello({ [topic]: from }, "replayer");
      const end = hello.topics[topic]!;
      while ((got.at(-1)?.cursor ?? from) < end) await new Promise((r) => setTimeout(r, 20));
      c.close();
      return got;
    };
    const all = await replay(0);
    const midCursor = Math.floor(all.length / 2);
    const mid = await replay(midCursor);
    const note = (s: string) => h.sink.write("cmd", `\x1b[90m  ${s}\x1b[0m\r\n`);
    note(
      `sync.hello {${topic.slice(0, 9)}…: 0}  → replayed ${all.length} events (#1…#${all.at(-1)!.cursor})`,
    );
    note(
      `sync.hello {${topic.slice(0, 9)}…: ${midCursor}} → replayed ${mid.length} events (#${mid[0]!.cursor}…#${mid.at(-1)!.cursor})`,
    );
    await h.check("replay from cursor 0 equals what was streamed live", () =>
      assert.deepEqual(
        all.map((e) => [e.cursor, e.event]),
        live.map((e) => [e.cursor, e.event]),
      ),
    );
    await h.check("replay from a middle cursor returns exactly the tail", () =>
      assert.deepEqual(mid, all.slice(Math.floor(all.length / 2))),
    );
    await h.check("no gaps or duplicates across the restart", () => assert.deepEqual(h.gaps, []));

    h.step("The chat keeps working");
    since = h.mark();
    await h.send("chat.send", { chatId: ids.chatId, text: "Are you still there?" });
    await h.waitText(ids.chatId, "You said: Are you still there?", since);
    await h.check("a new turn runs after the restart", () =>
      assert.match(h.agentText(ids.chatId, since), /still there/),
    );
  },
};
