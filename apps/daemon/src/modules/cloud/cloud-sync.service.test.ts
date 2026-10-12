import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TJson, TWrite } from "@agentdeck/firebase-rest";
import type { TChat, TWorktree } from "@agentdeck/protocol";
import { newId, silentLogger } from "@agentdeck/shared";
import { describe, expect, it } from "vitest";

import { EventBus } from "#src/infra/bus/index.js";
import { openDb } from "#src/infra/db/index.js";
import type { TRuntime } from "#src/infra/runtime/index.js";
import { pathsFor } from "#src/shared/paths.utils.js";

import { CloudSync } from "./cloud-sync.service.js";
import type { ICloudSource, ICloudStore } from "./cloud.types.js";

const WT: TWorktree = {
  id: newId("wt"),
  repoId: newId("repo"),
  title: "Fix login",
  branch: "fix-login",
  baseRef: "main",
  path: "/tmp/x",
  status: "ready",
  port: null,
  setupError: null,
  createdAt: 1,
  archivedAt: null,
};
const CHAT: TChat = {
  id: newId("chat"),
  worktreeId: WT.id,
  agent: "fake",
  profileId: newId("prof"),
  title: "Login bug",
  status: "idle",
  resumed: false,
  queued: 0,
  model: "fake-large",
  createdAt: 2,
  updatedAt: 2,
};

/** A store that records what reaches "the cloud", and can be told to fail. */
class FakeStore implements ICloudStore {
  readonly uid = "uid-1";
  readonly hostId = "d_host";
  readonly hostName = "laptop";
  readonly docs = new Map<string, Record<string, TJson>>();
  readonly files = new Map<string, Uint8Array>();
  commits = 0;
  failNext = false;

  commit(writes: readonly TWrite[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("offline"));
    }
    this.commits++;
    for (const w of writes) {
      if (w.kind === "delete") this.docs.delete(w.path);
      else if (w.kind === "set") this.docs.set(w.path, { ...w.data });
      else this.docs.set(w.path, { ...(this.docs.get(w.path) ?? {}), ...w.data });
    }
    return Promise.resolve();
  }
  upload(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
    return Promise.resolve();
  }
  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "cloud-"));
  const db = openDb(join(dir, "db"));
  const bus = new EventBus(join(dir, "events"), db);
  const rt = { db, bus, log: silentLogger, paths: pathsFor(dir), opts: {} } as TRuntime;
  const source: ICloudSource = {
    repoIds: () => [WT.repoId],
    worktrees: () => [WT],
    worktree: () => WT,
    repoName: () => "shop",
    chats: () => [CHAT],
    chat: (id) => (id === CHAT.id ? CHAT : null),
    profileName: () => "Personal",
    blob: () => ({ bytes: new Uint8Array([1, 2]), mime: "image/png" }),
  };
  const store = new FakeStore();
  let signedIn = false;
  const sync = new CloudSync(rt, source, () => Promise.resolve(signedIn ? store : null));
  sync.start();
  sync.stop(); // the tests drive ticks themselves; the bus listener stays registered below
  const off = bus.on((e) => {
    sync.apply(e);
  });
  return {
    bus,
    store,
    sync,
    off,
    signIn: () => {
      signedIn = true;
    },
    signOut: () => {
      signedIn = false;
    },
  };
}

const base = "users/uid-1";
const item = (id: string, text: string) => ({ kind: "agent_text" as const, id, at: 3, text });

describe("CloudSync", () => {
  it("does nothing until signed in, then backfills existing worktrees, chats and items", async () => {
    const t = setup();
    t.bus.publish(`chat:${CHAT.id}`, { type: "chat.item", chatId: CHAT.id, item: item("i1", "Hello") });
    await t.sync.tick();
    expect(t.store.commits).toBe(0);
    expect(t.sync.outbox.size()).toBe(0);

    t.signIn();
    await t.sync.tick();
    expect(t.store.docs.get(`${base}/worktrees/d_host__${WT.id}`)).toMatchObject({
      repoName: "shop",
      branch: "fix-login",
      deletedAt: null,
    });
    expect(t.store.docs.get(`${base}/chats/${CHAT.id}`)).toMatchObject({
      worktreeKey: `d_host__${WT.id}`,
      agent: "fake",
      profileName: "Personal",
      model: "fake-large",
    });
    expect(t.store.docs.get(`${base}/chats/${CHAT.id}/items/i1`)).toMatchObject({ text: "Hello", seq: 1 });
    expect(t.store.docs.get(`${base}/hosts/d_host`)).toMatchObject({ name: "laptop" });
  });

  it("folds a streaming reply into one write per flush", async () => {
    const t = setup();
    t.signIn();
    await t.sync.tick();
    const before = t.store.commits;
    t.bus.publish(`chat:${CHAT.id}`, { type: "chat.item", chatId: CHAT.id, item: item("i2", "a") });
    for (const text of ["ab", "abc", "abcd"]) {
      t.bus.publish(`chat:${CHAT.id}`, {
        type: "chat.itemPatch",
        chatId: CHAT.id,
        itemId: "i2",
        patch: { text },
      });
    }
    expect(t.sync.outbox.size()).toBe(2); // the item and the chat's updatedAt
    await t.sync.tick();
    expect(t.store.commits).toBe(before + 1);
    expect(t.store.docs.get(`${base}/chats/${CHAT.id}/items/i2`)).toMatchObject({
      kind: "agent_text",
      text: "abcd",
    });
  });

  it("keeps chats when the worktree is deleted, marking the worktree deleted", async () => {
    const t = setup();
    t.signIn();
    await t.sync.tick();
    t.bus.publish(`repo:${WT.repoId}`, { type: "worktree.removed", worktreeId: WT.id });
    await t.sync.tick();
    expect(t.store.docs.get(`${base}/worktrees/d_host__${WT.id}`)).toMatchObject({ status: "deleted" });
    expect(t.store.docs.get(`${base}/chats/${CHAT.id}`)).toBeDefined();
  });

  it("marks a worktree deleted before signing in, from the repo's log", async () => {
    const t = setup();
    const gone = { ...WT, id: newId("wt"), branch: "old-idea" };
    t.bus.publish(`repo:${WT.repoId}`, { type: "worktree.updated", worktree: gone });
    t.bus.publish(`repo:${WT.repoId}`, { type: "worktree.removed", worktreeId: gone.id });
    t.signIn();
    await t.sync.tick();
    expect(t.store.docs.get(`${base}/worktrees/d_host__${gone.id}`)).toMatchObject({
      branch: "old-idea",
      status: "deleted",
    });
    expect(t.store.docs.get(`${base}/worktrees/d_host__${WT.id}`)).toMatchObject({ deletedAt: null });
  });

  it("retries after a failed commit and uploads each file once", async () => {
    const t = setup();
    t.signIn();
    await t.sync.tick();
    const blobRef = { blobId: "a".repeat(64), mime: "image/png", size: 2 };
    t.bus.publish(`chat:${CHAT.id}`, {
      type: "chat.item",
      chatId: CHAT.id,
      item: { kind: "user", id: "u1", at: 4, text: "look", attachments: [blobRef] },
    });
    t.store.failNext = true;
    await t.sync.tick();
    expect(t.store.docs.has(`${base}/chats/${CHAT.id}/items/u1`)).toBe(false);
    expect(t.store.files.has(`${base}/blobs/${blobRef.blobId}`)).toBe(true);
    expect(t.sync.outbox.size()).toBeGreaterThan(0);
    // Backed off: due again after the delay.
    t.sync.outbox.due(10, Date.now() + 120_000);
    const rows = t.sync.outbox.due(10, Date.now() + 120_000);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("forgets the queue when signed out", async () => {
    const t = setup();
    t.signIn();
    await t.sync.tick();
    t.signOut();
    await t.sync.tick();
    t.bus.publish(`chat:${CHAT.id}`, { type: "chat.item", chatId: CHAT.id, item: item("i9", "x") });
    expect(t.sync.outbox.size()).toBe(0);
    t.off();
  });
});
