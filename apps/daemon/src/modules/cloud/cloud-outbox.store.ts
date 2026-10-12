import type { TJson, TWrite } from "@agentdeck/firebase-rest";
import { tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import type { TRuntime } from "#src/infra/runtime/index.js";

import type { TOutboxKind, TOutboxRow } from "./cloud.types.js";

type TRow = { key: string; kind: TOutboxKind; path: string; data_json: string; version: number };

const fieldsSchema = z.record(z.string(), z.json());

const fieldsOf = (json: string): Record<string, TJson> => tryParseJson(fieldsSchema, json) ?? {};

/**
 * Pending cloud writes, durable across restarts and offline spells. One row per document path:
 * a newer update of the same document folds into the pending one (a set stays a set with the
 * merged fields), so a streaming reply costs one write per flush, not one per patch.
 */
export class CloudOutbox {
  constructor(private readonly rt: TRuntime) {}

  /** Queues a document write; `set` replaces, `merge` updates fields. */
  put(kind: "set" | "merge", path: string, data: Record<string, TJson>): void {
    const existing = this.rt.db.prepare<[string], TRow>("SELECT * FROM cloud_outbox WHERE key = ?").get(path);
    let next: { kind: TOutboxKind; data: Record<string, TJson> } = { kind, data };
    if (existing && kind === "merge") {
      next = { kind: existing.kind, data: { ...fieldsOf(existing.data_json), ...data } };
    }
    this.upsert(path, next.kind, path, next.data);
  }

  /** Queues a Storage upload of a local blob (skipped at flush time if already uploaded). */
  putBlob(storagePath: string, blobId: string): void {
    const exists = this.rt.db.prepare("SELECT 1 FROM cloud_outbox WHERE key = ?").get(`blob:${blobId}`);
    if (!exists) this.upsert(`blob:${blobId}`, "blob", storagePath, { blobId });
  }

  private upsert(key: string, kind: TOutboxKind, path: string, data: Record<string, TJson>): void {
    this.rt.db
      .prepare(
        `INSERT INTO cloud_outbox (key, kind, path, data_json, version, attempts, next_at) VALUES (?, ?, ?, ?, 1, 0, 0)
         ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, path = excluded.path, data_json = excluded.data_json,
           version = cloud_outbox.version + 1`,
      )
      .run(key, kind, path, JSON.stringify(data));
  }

  /** Rows due now, oldest first. */
  due(limit: number, now: number): TOutboxRow[] {
    return this.rt.db
      .prepare<[number, number], TRow>("SELECT * FROM cloud_outbox WHERE next_at <= ? ORDER BY rowid LIMIT ?")
      .all(now, limit)
      .map((r) => ({
        key: r.key,
        kind: r.kind,
        path: r.path,
        data: fieldsOf(r.data_json),
        version: r.version,
      }));
  }

  /** Drops rows that were sent, unless they changed meanwhile (then they go again). */
  done(rows: readonly TOutboxRow[]): void {
    const del = this.rt.db.prepare("DELETE FROM cloud_outbox WHERE key = ? AND version = ?");
    for (const r of rows) del.run(r.key, r.version);
  }

  /** Backs off rows that failed: 2, 4, 8 … up to 60 seconds. */
  failed(rows: readonly TOutboxRow[], now: number): void {
    const upd = this.rt.db.prepare(
      "UPDATE cloud_outbox SET attempts = attempts + 1, next_at = ? + MIN(60000, 1000 * (1 << MIN(attempts + 1, 6))) WHERE key = ?",
    );
    for (const r of rows) upd.run(now, r.key);
  }

  size(): number {
    return this.rt.db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM cloud_outbox").get()?.n ?? 0;
  }

  clear(): void {
    this.rt.db.exec("DELETE FROM cloud_outbox; DELETE FROM cloud_chats;");
  }

  /** Remembers that a chat's document was written, so later events only merge into it. */
  markChat(chatId: string): boolean {
    return (
      this.rt.db.prepare("INSERT OR IGNORE INTO cloud_chats (chat_id) VALUES (?)").run(chatId).changes > 0
    );
  }

  state(key: string): string | null {
    return (
      this.rt.db.prepare<[string], { value: string }>("SELECT value FROM cloud_state WHERE key = ?").get(key)
        ?.value ?? null
    );
  }

  setState(key: string, value: string | null): void {
    if (value === null) this.rt.db.prepare("DELETE FROM cloud_state WHERE key = ?").run(key);
    else this.rt.db.prepare("INSERT OR REPLACE INTO cloud_state (key, value) VALUES (?, ?)").run(key, value);
  }
}

/** A queued document row as a Firestore write under the account root. */
export function toWrite(uid: string, r: TOutboxRow): TWrite {
  const path = `users/${uid}/${r.path}`;
  return r.kind === "set" ? { kind: "set", path, data: r.data } : { kind: "merge", path, data: r.data };
}
