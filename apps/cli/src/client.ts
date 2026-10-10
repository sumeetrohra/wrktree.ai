import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import {
  BLOB_PART_SIZE,
  type BlobRef,
  type CommandArgs,
  type CommandName,
  type CommandResult,
  type EvtFrame,
  type Inner,
  type ProtocolError,
} from "@agentdeck/protocol";
import { newId } from "@agentdeck/shared";
import { defaultHome, pathsFor } from "@agentdeck/daemon";

export class CommandError extends Error {
  constructor(readonly error: ProtocolError) {
    super(`${error.code}: ${error.message}`);
    this.name = "CommandError";
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * A client of the daemon's local transport: commands with exactly one reply each,
 * events pushed for subscribed topics, and blob frames for large payloads.
 */
export class DaemonClient {
  private pending = new Map<string, Pending>();
  private blobs = new Map<string, Buffer[]>();
  private listeners = new Set<(e: EvtFrame) => void>();
  /** Frame counters, for tests and debugging. */
  readonly stats = { blobFrames: 0, events: 0 };

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (raw) => this.onFrame(JSON.parse(raw.toString()) as Inner));
    ws.on("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("Connection to the daemon closed"));
      this.pending.clear();
    });
  }

  /** Connects using `daemon.json` and `local-token` from the daemon's home folder. */
  static async connect(home = defaultHome()): Promise<DaemonClient> {
    const paths = pathsFor(home);
    let info: { port: number };
    try {
      info = JSON.parse(readFileSync(paths.daemonJson, "utf8")) as { port: number };
    } catch {
      throw new Error(`No daemon running for ${home} (start one with \`agentdeck daemon\`)`);
    }
    const token = readFileSync(paths.localToken, "utf8").trim();
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/v1/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new DaemonClient(ws);
  }

  private onFrame(f: Inner): void {
    if (f.t === "evt") {
      this.stats.events++;
      for (const l of this.listeners) l(f);
    } else if (f.t === "blob") {
      this.stats.blobFrames++;
      const parts = this.blobs.get(f.blobId) ?? [];
      parts[f.part] = Buffer.from(f.bytes, "base64");
      this.blobs.set(f.blobId, parts);
    } else if (f.t === "res") {
      const p = this.pending.get(f.id);
      if (!p) return;
      this.pending.delete(f.id);
      if (!f.ok) return p.reject(new CommandError(f.error));
      const data = f.data as { $blob?: string } | null;
      if (
        data &&
        typeof data === "object" &&
        typeof data.$blob === "string" &&
        Object.keys(data).length === 1
      ) {
        const parts = this.blobs.get(data.$blob) ?? [];
        this.blobs.delete(data.$blob);
        p.resolve(JSON.parse(Buffer.concat(parts).toString("utf8")));
      } else {
        p.resolve(f.data);
      }
    }
  }

  private send(frame: Inner): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** Sends a command; pass `cmdId` to retry one idempotently. */
  call<N extends CommandName>(
    name: N,
    args: CommandArgs<N>,
    opts: { cmdId?: string } = {},
  ): Promise<CommandResult<N>> {
    return this.callRaw(name, args, opts) as Promise<CommandResult<N>>;
  }

  callRaw(name: string, args: unknown, opts: { cmdId?: string } = {}): Promise<unknown> {
    const id = opts.cmdId ?? newId("cmd");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ t: "cmd", id, name, args } as Inner);
    });
  }

  /** Subscribes to topics (`chat:*` style patterns allowed) and replays events after the cursors. */
  hello(cursors: Record<string, number>, deviceName = "cli") {
    return this.call("sync.hello", { deviceName, appVersion: "0.1.0", cursors });
  }

  onClose(fn: () => void): void {
    this.ws.on("close", fn);
  }

  onEvent(fn: (e: EvtFrame) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async upload(bytes: Buffer, mime: string): Promise<BlobRef> {
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

export const randomToken = () => randomBytes(8).toString("hex");
