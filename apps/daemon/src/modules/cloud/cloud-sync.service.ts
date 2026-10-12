import type { TDaemonEvent, TLoggedEvent } from "@agentdeck/protocol";
import { now } from "@agentdeck/shared";

import type { TRuntime } from "#src/infra/runtime/index.js";

import { blobsOf, chatDoc, itemDoc, patchFields, paths, worktreeDoc } from "./cloud-docs.utils.js";
import { CloudOutbox, toWrite } from "./cloud-outbox.store.js";
import type { ICloudSource, ICloudStore, TOutboxRow } from "./cloud.types.js";

const FLUSH_MS = 1000;
/** Firestore commits take at most 500 writes. */
const BATCH = 400;
const HOST_EVERY_MS = 5 * 60 * 1000;

const message = (e: unknown): string => (e instanceof Error ? e.message : "error");

/**
 * Cloud chat history: every worktree, chat, chat item and file this host produces goes to the
 * account's Firestore and Storage, so any device can read it, even with this host offline or the
 * worktree deleted (Firestore keeps it; the worktree gets `deletedAt`). Writes queue in a durable
 * outbox and flush about once a second; the first sign-in backfills what already exists.
 */
export class CloudSync {
  readonly outbox: CloudOutbox;
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private lastHostAt = 0;
  private stopListening: (() => void) | null = null;

  constructor(
    private readonly rt: TRuntime,
    private readonly source: ICloudSource,
    private readonly access: () => Promise<ICloudStore | null>,
  ) {
    this.outbox = new CloudOutbox(rt);
  }

  start(): void {
    this.stopListening = this.rt.bus.on((e) => {
      if (this.enabledFor() !== null) this.apply(e);
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, FLUSH_MS);
    this.timer.unref();
  }

  stop(): void {
    this.stopListening?.();
    if (this.timer) clearInterval(this.timer);
  }

  /** The account history is being kept for, or null (not signed in with Firebase). */
  private enabledFor(): string | null {
    return this.outbox.state("uid");
  }

  /** One daemon event, as cloud writes. */
  apply(logged: TLoggedEvent): void {
    const hostId = this.outbox.state("hostId");
    if (hostId === null) return;
    const e: TDaemonEvent = logged.event;
    switch (e.type) {
      case "worktree.updated":
        this.outbox.put(
          "set",
          paths.worktree(hostId, e.worktree.id),
          worktreeDoc(hostId, e.worktree, this.source.repoName(e.worktree.repoId)),
        );
        return;
      case "worktree.removed":
        // The worktree is gone from this computer; its chats and files stay in the cloud.
        this.outbox.put("merge", paths.worktree(hostId, e.worktreeId), {
          deletedAt: now(),
          status: "deleted",
          updatedAt: now(),
        });
        return;
      case "chat.item": {
        this.ensureChat(hostId, e.chatId);
        this.outbox.put("set", paths.item(e.chatId, e.item.id), itemDoc(e.item, logged.cursor));
        for (const blobId of blobsOf(e.item)) this.outbox.putBlob(paths.blob(blobId), blobId);
        this.outbox.put("merge", paths.chat(e.chatId), { updatedAt: logged.at, lastItemAt: logged.at });
        return;
      }
      case "chat.itemPatch":
        this.ensureChat(hostId, e.chatId);
        this.outbox.put("merge", paths.item(e.chatId, e.itemId), patchFields(e.patch));
        return;
      case "chat.status":
        this.ensureChat(hostId, e.chatId);
        this.outbox.put("merge", paths.chat(e.chatId), { status: e.status, updatedAt: logged.at });
        return;
      case "permission.requested":
        this.ensureChat(hostId, e.chatId);
        this.outbox.put("merge", paths.chat(e.chatId), { pendingPermission: e.request.title });
        return;
      case "permission.resolved":
        this.outbox.put("merge", paths.chat(e.chatId), { pendingPermission: null });
        return;
      case "usage.updated":
      case "proc.output":
      case "preview.status":
      case "device.updated":
        return;
    }
  }

  /** The chat's document, written once with everything known about it. */
  private ensureChat(hostId: string, chatId: string): void {
    if (!this.outbox.markChat(chatId)) return;
    const chat = this.source.chat(chatId);
    if (!chat) return;
    this.outbox.put(
      "set",
      paths.chat(chatId),
      chatDoc(hostId, chat, this.source.profileName(chat.profileId)),
    );
  }

  /** Every worktree and chat this host has, replayed from the event logs, into the outbox. */
  backfill(hostId: string): void {
    for (const wt of this.source.worktrees()) {
      this.outbox.put(
        "set",
        paths.worktree(hostId, wt.id),
        worktreeDoc(hostId, wt, this.source.repoName(wt.repoId)),
      );
      for (const chat of this.source.chats(wt.id)) {
        this.ensureChat(hostId, chat.id);
        for (const logged of this.rt.bus.replay(`chat:${chat.id}`, 0)) this.apply(logged);
      }
    }
  }

  /** Picks up sign-in and sign-out, then flushes what is due. */
  async tick(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const store = await this.access();
      this.adopt(store);
      if (store) await this.flush(store);
    } catch (e) {
      this.rt.log.warn({ err: message(e) }, "cloud sync failed; will retry");
    } finally {
      this.flushing = false;
    }
  }

  /** A new account (or none): reset the outbox and backfill for the new one. */
  private adopt(store: ICloudStore | null): void {
    const before = this.enabledFor();
    if (!store) {
      if (before !== null) {
        this.outbox.clear();
        this.outbox.setState("uid", null);
        this.outbox.setState("hostId", null);
      }
      return;
    }
    if (before === store.uid && this.outbox.state("hostId") === store.hostId) return;
    this.outbox.clear();
    this.outbox.setState("uid", store.uid);
    this.outbox.setState("hostId", store.hostId);
    this.backfill(store.hostId);
    this.rt.log.info({ pending: this.outbox.size() }, "cloud history: backfill queued");
  }

  private async flush(store: ICloudStore): Promise<void> {
    if (now() - this.lastHostAt > HOST_EVERY_MS) {
      this.outbox.put("set", paths.host(store.hostId), { name: store.hostName, lastSeenAt: now() });
      this.lastHostAt = now();
    }
    for (;;) {
      const rows = this.outbox.due(BATCH, now());
      if (rows.length === 0) return;
      const blobs = rows.filter((r) => r.kind === "blob");
      const docs = rows.filter((r) => r.kind !== "blob");
      await this.uploadBlobs(store, blobs);
      if (docs.length === 0) continue;
      try {
        await store.commit(docs.map((r) => toWrite(store.uid, r)));
        this.outbox.done(docs);
      } catch (e) {
        this.outbox.failed(docs, now());
        throw e;
      }
      if (rows.length < BATCH) return;
    }
  }

  private async uploadBlobs(store: ICloudStore, rows: readonly TOutboxRow[]): Promise<void> {
    for (const r of rows) {
      const blobId = r.data["blobId"];
      const blob = typeof blobId === "string" ? this.source.blob(blobId) : null;
      try {
        const path = `users/${store.uid}/${r.path}`;
        if (blob && !(await store.exists(path))) await store.upload(path, blob.bytes, blob.mime);
        this.outbox.done([r]);
      } catch (e) {
        this.outbox.failed([r], now());
        this.rt.log.warn({ err: message(e) }, "cloud upload failed; will retry");
      }
    }
  }
}
