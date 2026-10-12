import { bytesToUtf8 } from "@agentdeck/crypto";
import {
  BLOB_PART_SIZE,
  blobbedDataSchema,
  innerSchema,
  parseCommandResult,
  type TCommandName,
  type TCommandResult,
  type TEvtFrame,
  type TInner,
} from "@agentdeck/protocol";
import { newId, parseJson, tryParseJson } from "@agentdeck/shared";
import { z } from "zod";

import { ConnError } from "./connection.types";

type TPending = { name: TCommandName; resolve: (v: unknown) => void; reject: (e: ConnError) => void };

/**
 * The inner protocol both connections speak once a channel is up: commands with exactly one
 * reply, events, and blob frames for large payloads. Replies are validated against the protocol.
 */
export class InnerClient {
  private readonly pending = new Map<string, TPending>();
  private readonly blobs = new Map<string, string[]>();
  private readonly eventListeners = new Set<(e: TEvtFrame) => void>();

  constructor(private send: ((text: string) => boolean) | null = null) {}

  attach(send: ((text: string) => boolean) | null): void {
    this.send = send;
  }

  onEvent(fn: (e: TEvtFrame) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** Rejects everything in flight (the channel went away). */
  failAll(error: ConnError): void {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  handle(text: string): void {
    const f = tryParseJson(innerSchema, text);
    if (!f) return;
    switch (f.t) {
      case "evt":
        for (const l of this.eventListeners) l(f);
        return;
      case "blob": {
        const parts = this.blobs.get(f.blobId) ?? [];
        parts[f.part] = f.bytes;
        this.blobs.set(f.blobId, parts);
        return;
      }
      case "res": {
        const p = this.pending.get(f.id);
        if (!p) return;
        this.pending.delete(f.id);
        if (!f.ok) {
          p.reject(new ConnError(f.error.code, f.error.message));
          return;
        }
        const blobbed = blobbedDataSchema.strict().safeParse(f.data);
        if (!blobbed.success) {
          p.resolve(f.data);
          return;
        }
        const parts = this.blobs.get(blobbed.data.$blob) ?? [];
        this.blobs.delete(blobbed.data.$blob);
        p.resolve(parseJson(z.unknown(), decodeBase64Parts(parts)));
        return;
      }
      case "cmd":
        return;
    }
  }

  private write(frame: TInner): boolean {
    return this.send?.(JSON.stringify(frame)) ?? false;
  }

  /** Sends a command; resolves with the validated reply. Rejects at once if the channel is down. */
  call<N extends TCommandName>(
    name: N,
    args: unknown,
    cmdId: string = newId("cmd"),
  ): Promise<TCommandResult<N>> {
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(cmdId, { name, resolve, reject });
      if (!this.write({ t: "cmd", id: cmdId, name, args })) {
        this.pending.delete(cmdId);
        reject(new ConnError("DISCONNECTED", "Not connected to the machine"));
      }
    }).then((data) => parseCommandResult(name, data));
  }

  /** Sends bytes as blob frames under a fresh upload id; returns the id for `blob.put`. */
  sendBlob(base64: string): { uploadId: string; size: number } {
    const uploadId = newId("up");
    const partChars = (BLOB_PART_SIZE / 3) * 4;
    const parts = Math.max(1, Math.ceil(base64.length / partChars));
    for (let i = 0; i < parts; i++) {
      const bytes = base64.slice(i * partChars, (i + 1) * partChars);
      this.write({ t: "blob", blobId: uploadId, part: i, last: i === parts - 1, bytes });
    }
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return { uploadId, size: (base64.length / 4) * 3 - padding };
  }
}

function decodeBase64Parts(parts: string[]): string {
  let bin = "";
  for (const p of parts) bin += atob(p);
  return bytesToUtf8(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}
