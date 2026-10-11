import { readFileSync } from "node:fs";

import { defaultHome, pathsFor } from "@agentdeck/daemon";
import {
  BLOB_PART_SIZE,
  blobbedDataSchema,
  innerSchema,
  parseCommandResult,
  type TBlobRef,
  type TCommandArgs,
  type TCommandName,
  type TCommandResult,
  type TEvtFrame,
  type TInner,
  type TProtocolError,
} from "@agentdeck/protocol";
import { newId, parseJson, tryParseJson } from "@agentdeck/shared";
import WebSocket from "ws";
import { z } from "zod";

export class CommandError extends Error {
  override name = "CommandError";

  constructor(readonly error: TProtocolError) {
    super(`${error.code}: ${error.message}`);
  }
}

type TPending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const daemonInfoSchema = z.object({ port: z.number().int().positive(), pid: z.number().int(), version: z.string() });

/**
 * A client of the daemon's local transport: commands with exactly one reply each,
 * events pushed for subscribed topics, and blob frames for large payloads.
 * The only code in the CLI that opens a socket (L3).
 */
export class DaemonClient {
  private readonly pending = new Map<string, TPending>();
  private readonly blobs = new Map<string, Buffer[]>();
  private readonly listeners = new Set<(e: TEvtFrame) => void>();
  /** Frame counters, for tests and debugging. */
  readonly stats = { blobFrames: 0, events: 0 };

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (raw: Buffer) => {
      const frame = tryParseJson(innerSchema, raw.toString());
      if (frame) this.onFrame(frame);
    });
    ws.on("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("Connection to the daemon closed"));
      this.pending.clear();
    });
  }

  /** Connects using `daemon.json` and `local-token` from the daemon's home folder. */
  static async connect(home = defaultHome()): Promise<DaemonClient> {
    const paths = pathsFor(home);
    let info: z.infer<typeof daemonInfoSchema>;
    try {
      info = parseJson(daemonInfoSchema, readFileSync(paths.daemonJson, "utf8"));
    } catch {
      throw new Error(`No daemon running for ${home} (start one with \`agentdeck daemon\`)`);
    }
    const token = readFileSync(paths.localToken, "utf8").trim();
    const ws = new WebSocket(`ws://127.0.0.1:${String(info.port)}/v1/ws`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => {
        resolve();
      });
      ws.once("error", reject);
    });
    return new DaemonClient(ws);
  }

  private onFrame(f: TInner): void {
    switch (f.t) {
      case "evt":
        this.stats.events++;
        for (const l of this.listeners) l(f);
        return;
      case "blob": {
        this.stats.blobFrames++;
        const parts = this.blobs.get(f.blobId) ?? [];
        parts[f.part] = Buffer.from(f.bytes, "base64");
        this.blobs.set(f.blobId, parts);
        return;
      }
      case "res": {
        const p = this.pending.get(f.id);
        if (!p) return;
        this.pending.delete(f.id);
        if (!f.ok) {
          p.reject(new CommandError(f.error));
          return;
        }
        const blobbed = blobbedDataSchema.strict().safeParse(f.data);
        if (!blobbed.success) {
          p.resolve(f.data);
          return;
        }
        const parts = this.blobs.get(blobbed.data.$blob) ?? [];
        this.blobs.delete(blobbed.data.$blob);
        p.resolve(parseJson(z.unknown(), Buffer.concat(parts).toString("utf8")));
        return;
      }
      case "cmd":
        return;
    }
  }

  private send(frame: TInner): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** Sends a command; the reply is validated against the protocol's result schema (A2). */
  async call<N extends TCommandName>(
    name: N,
    args: TCommandArgs<N>,
    opts: { cmdId?: string } = {},
  ): Promise<TCommandResult<N>> {
    return parseCommandResult(name, await this.callRaw(name, args, opts));
  }

  /** Sends any command by name (for `agentdeck dev send`); the reply is not validated. */
  callRaw(name: string, args: unknown, opts: { cmdId?: string } = {}): Promise<unknown> {
    const id = opts.cmdId ?? newId("cmd");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ t: "cmd", id, name, args });
    });
  }

  /** Subscribes to topics (`chat:*` style patterns allowed) and replays events after the cursors. */
  hello(cursors: Record<string, number>, deviceName = "cli"): Promise<TCommandResult<"sync.hello">> {
    return this.call("sync.hello", { deviceName, appVersion: "0.1.0", cursors });
  }

  onClose(fn: () => void): void {
    this.ws.on("close", fn);
  }

  onEvent(fn: (e: TEvtFrame) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async upload(bytes: Buffer, mime: string): Promise<TBlobRef> {
    const uploadId = newId("up");
    const parts = Math.max(1, Math.ceil(bytes.length / BLOB_PART_SIZE));
    for (let i = 0; i < parts; i++) {
      this.send({
        t: "blob",
        blobId: uploadId,
        part: i,
        last: i === parts - 1,
        bytes: bytes.subarray(i * BLOB_PART_SIZE, (i + 1) * BLOB_PART_SIZE).toString("base64"),
      });
    }
    return this.call("blob.put", { mime, size: bytes.length, uploadId });
  }

  close(): void {
    this.ws.close();
  }
}
