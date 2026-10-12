import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FirebaseError, type Firestore, type TDoc } from "@agentdeck/firebase-rest";

import { FIXTURES } from "../harness.ts";
import { PhoneSim } from "../phone-sim.ts";
import type { TScenario } from "../scenario.ts";

import { eventually } from "./relay-helpers.ts";

const itemsOf = (db: Firestore, uid: string, chatId: string): Promise<TDoc[]> =>
  db.list(`users/${uid}/chats/${chatId}/items`);

const textOf = (docs: TDoc[]): string =>
  docs.map((d) => (typeof d.data["text"] === "string" ? d.data["text"] : "")).join("\n");

export const relayCloud: TScenario = {
  n: 16,
  title: "Chats outlive the computer",
  summary: "The host writes every chat to Firestore and Storage; the phone reads it with the host off",
  covers: ["Phase 3a: chat history in Firebase per worktree, readable when the host is offline"],
  relay: true,
  async run(h) {
    h.step("Desktop: a repo, a worktree and a chat, before signing in");
    const ids = await h.quickstart();

    h.step("Phone and computer sign in as the same user (Firebase Auth emulator)");
    const phone = new PhoneSim(h.relayUrl, "Pixel 9");
    const { db, files, uid } = await phone.signInFirebase("me");
    const login = await h.cli(["login", "--dev", "me"]);
    assert.equal(login.code, 0, login.out);
    await h.waitRelayConnected();
    const hostId = await h.deviceId();

    await h.check("the host backfills its worktree and chat into Firestore", async () => {
      const wt = await eventually(
        "the worktree doc",
        () => db.get(`users/${uid}/worktrees/${hostId}__${ids.worktreeId}`),
        (d) => d !== null,
      );
      assert.ok(wt);
      assert.equal(wt.data["hostId"], hostId);
      assert.equal(wt.data["deletedAt"], null);
      const host = await db.get(`users/${uid}/hosts/${hostId}`);
      assert.equal(host?.data["name"], "laptop");
    });

    h.step("Desktop: send a prompt with a screenshot");
    const { stdout } = await h.cli(["dev", "blob", join(FIXTURES, "screenshot.png")], {
      show: "agentdeck dev blob e2e/fixtures/screenshot.png",
    });
    const image = JSON.parse(stdout) as { blobId: string; mime: string; size: number };
    const since = h.mark();
    await h.send("chat.send", { chatId: ids.chatId, text: "What's in this picture?", attachments: [image] });
    await h.waitStatus(ids.chatId, "idle", since);

    await h.check("the chat, its items and the screenshot reach Firebase", async () => {
      const chat = await eventually(
        "the chat doc",
        () => db.get(`users/${uid}/chats/${ids.chatId}`),
        (d) => d?.data["status"] === "idle",
      );
      assert.equal(chat?.data["worktreeKey"], `${hostId}__${ids.worktreeId}`);
      await eventually(
        "the agent's reply",
        () => itemsOf(db, uid, ids.chatId),
        (docs) => textOf(docs).includes("You said: What's in this picture?"),
      );
      await eventually(
        "the screenshot in Storage",
        () => files.exists(`users/${uid}/blobs/${image.blobId}`),
        (x) => x,
      );
    });

    h.step("kill -9 the computer");
    await h.stopWatcher();
    await h.killDaemon();

    await h.check("the phone still reads the whole chat, in order", async () => {
      const docs = await itemsOf(db, uid, ids.chatId);
      const ordered = [...docs].sort((a, b) => Number(a.data["seq"]) - Number(b.data["seq"]));
      const user = ordered.find((d) => d.data["kind"] === "user");
      assert.equal(user?.data["text"], "What's in this picture?");
      assert.ok(textOf(ordered).includes("You said: What's in this picture?"), textOf(ordered));
      assert.match(
        JSON.stringify(user.data["attachments"]),
        new RegExp(`"storagePath":"blobs/${image.blobId}"`),
      );
    });
    await h.check("the phone downloads the screenshot, byte for byte", async () => {
      const bytes = await files.download(`users/${uid}/blobs/${image.blobId}`);
      assert.deepEqual(Buffer.from(bytes), readFileSync(join(FIXTURES, "screenshot.png")));
    });

    h.step("Restart the computer and delete the worktree");
    await h.startDaemon();
    await h.startWatcher();
    await h.send("worktree.delete", { worktreeId: ids.worktreeId });

    await h.check("the worktree is marked deleted; its chat stays", async () => {
      await eventually(
        "deletedAt on the worktree",
        () => db.get(`users/${uid}/worktrees/${hostId}__${ids.worktreeId}`),
        (d) => typeof d?.data["deletedAt"] === "number",
      );
      assert.ok(await db.get(`users/${uid}/chats/${ids.chatId}`));
      assert.ok((await itemsOf(db, uid, ids.chatId)).length >= 2);
    });

    h.step("Another account tries to read it");
    const stranger = new PhoneSim(h.relayUrl, "Stranger");
    const other = await stranger.signInFirebase("other");
    await h.check("Firestore and Storage refuse another user", async () => {
      await assert.rejects(
        other.db.list(`users/${uid}/chats`),
        (e) => e instanceof FirebaseError && e.status === 403,
      );
      await assert.rejects(other.files.download(`users/${uid}/blobs/${image.blobId}`));
    });
  },
};
