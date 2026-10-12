import {
  finishHandshake,
  fromB64,
  handshakeMessageSchema,
  SecureChannel,
  startHandshake,
  toB64,
  utf8ToBytes,
  bytesToUtf8,
  type TIdentity,
  type TKxKeyPair,
} from "@agentdeck/crypto";
import {
  isCommandName,
  parseCommandResult,
  type TBlobRef,
  type TCommandArgs,
  type TCommandName,
  type TCommandResult,
  type TEvtFrame,
  type TRelayFrame,
} from "@agentdeck/protocol";
import { newId, tryParseJson } from "@agentdeck/shared";

import { connStorage, type TQueued } from "./conn.storage";
import { ConnError, type IDaemonConnection, type TConnStatus } from "./connection.types";
import { InnerClient } from "./inner-client";
import type { IRelayPeer, RelaySocket } from "./relay-socket";

const HANDSHAKE_BACKOFF_MS = [3000, 5000, 10000, 20000, 30000];
/** Commands worth keeping while offline; they run once the host is back (idempotent by id). */
const QUEUEABLE: readonly TCommandName[] = ["chat.send", "permission.respond", "chat.cancel"];
const DEFAULT_CURSORS: Readonly<Record<string, number>> = { global: 0, "repo:*": 0, "chat:*": 0 };

type TDeferred = { resolve: (v: unknown) => void; reject: (e: ConnError) => void };

const encode = (v: unknown): string => toB64(utf8ToBytes(JSON.stringify(v)));

/** A host on the account: its id and the signing key the account's device list vouches for. */
export type THostKey = { id: string; signPub: string };

/**
 * This device's session with one host, over the shared relay socket. It starts with a signed
 * ephemeral handshake; everything after is sealed end to end. When the socket reopens (or a host
 * that was away answers) it handshakes again and `sync.hello` replays from the last cursors;
 * queued commands then run with their original ids.
 */
export class RelayConnection implements IDaemonConnection, IRelayPeer {
  private channel: SecureChannel | null = null;
  private pendingHs: { sessionId: string; eph: TKxKeyPair } | null = null;
  private hsTimer: ReturnType<typeof setTimeout> | null = null;
  private hsAttempt = 0;
  private detach: (() => void) | null = null;
  private readonly inner = new InnerClient();
  private readonly statusListeners = new Set<(s: TConnStatus) => void>();
  private readonly eventListeners = new Set<(e: TEvtFrame) => void>();
  private readonly deferred = new Map<string, TDeferred>();
  private cursors: Record<string, number>;
  status: TConnStatus = "connecting";

  constructor(
    private readonly host: THostKey,
    private readonly socket: RelaySocket,
    private readonly me: TIdentity,
    private readonly deviceName: string,
  ) {
    this.cursors = { ...DEFAULT_CURSORS, ...connStorage.cursors(host.id) };
    // Advance and persist the cursor first; a replayed event at or below it is an overlap.
    this.inner.onEvent((e) => {
      if (e.cursor <= (this.cursors[e.topic] ?? 0)) return;
      this.cursors[e.topic] = e.cursor;
      connStorage.setCursors(host.id, this.cursors);
      for (const l of this.eventListeners) l(e);
    });
  }

  private get myId(): string {
    return this.socket.myId;
  }

  start(): void {
    this.detach = this.socket.attach(this.host.id, this);
  }

  stop(): void {
    if (this.hsTimer) clearTimeout(this.hsTimer);
    this.detach?.();
    this.dropSession();
  }

  private setStatus(s: TConnStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  onStatus(fn: (s: TConnStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** New events only, in cursor order per topic. */
  onEvent(fn: (e: TEvtFrame) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  onOpen(): void {
    this.hsAttempt = 0;
    this.handshake();
  }

  onClose(): void {
    if (this.hsTimer) clearTimeout(this.hsTimer);
    this.dropSession();
    this.setStatus("offline");
  }

  private dropSession(): void {
    this.channel = null;
    this.pendingHs = null;
    this.inner.attach(null);
    this.inner.failAll(new ConnError("DISCONNECTED", "Connection to the computer was lost"));
  }

  private handshake(): void {
    if (this.hsTimer) clearTimeout(this.hsTimer);
    if (!this.channel) this.setStatus("connecting");
    const peers = { clientId: this.myId, serverId: this.host.id };
    const { init, pending } = startHandshake(this.me, peers);
    this.pendingHs = pending;
    this.socket.send({
      v: 1,
      from: this.myId,
      to: this.host.id,
      seq: 0,
      kind: "hs",
      body: encode({ t: "session.init", ...init }),
    });
    // A host that is offline doesn't answer: try again, backing off, while the socket is up.
    const wait = HANDSHAKE_BACKOFF_MS[Math.min(this.hsAttempt, HANDSHAKE_BACKOFF_MS.length - 1)] ?? 30000;
    this.hsAttempt++;
    this.hsTimer = setTimeout(() => {
      if (this.channel) return;
      this.setStatus("offline");
      if (this.socket.open) this.handshake();
    }, wait);
  }

  /** The host came back online (relay presence): handshake now instead of waiting. */
  hostOnline(): void {
    if (this.socket.open && !this.channel) {
      this.hsAttempt = 0;
      this.handshake();
    }
  }

  /** The host went away: its session is gone; a new one starts when it returns. */
  hostOffline(): void {
    if (!this.channel) return;
    this.dropSession();
    this.setStatus("offline");
  }

  onFrame(f: TRelayFrame): void {
    if (f.kind === "hs") {
      this.onAccept(f);
      return;
    }
    if (f.kind !== "msg") return;
    this.socket.send({
      v: 1,
      from: this.myId,
      to: f.from,
      seq: f.seq,
      kind: "ack",
      body: "",
      ...(f.sid ? { sid: f.sid } : {}),
    });
    if (!this.channel || f.sid === undefined) return;
    const plain = this.channel.open({ from: f.from, to: f.to, seq: f.seq, sessionId: f.sid, body: f.body });
    if (plain !== null) this.inner.handle(plain);
  }

  private onAccept(f: TRelayFrame): void {
    const pending = this.pendingHs;
    if (!pending) return;
    const msg = decodeBody(f.body);
    if (msg?.t !== "session.accept") return;
    const peers = { clientId: this.myId, serverId: this.host.id };
    const session = finishHandshake(fromB64(this.host.signPub), peers, pending, msg);
    if (!session) return;
    if (this.hsTimer) clearTimeout(this.hsTimer);
    this.pendingHs = null;
    const channel = new SecureChannel(session, this.myId, this.host.id);
    this.channel = channel;
    this.inner.attach((plain) => {
      const s = channel.seal(plain);
      return this.socket.send({
        v: 1,
        from: this.myId,
        to: this.host.id,
        seq: s.seq,
        sid: s.sessionId,
        kind: "msg",
        body: s.body,
      });
    });
    void this.afterSession(channel);
  }

  private async afterSession(channel: SecureChannel): Promise<void> {
    let topics: Record<string, number>;
    try {
      ({ topics } = await this.inner.call("sync.hello", {
        deviceName: this.deviceName,
        appVersion: "0.1.0",
        cursors: this.cursors,
      }));
    } catch {
      if (this.channel === channel) this.hostOffline();
      return;
    }
    this.hsAttempt = 0;
    // "Online" means caught up: the replay that follows the reply has been applied.
    await caughtUp(topics, this.cursors, (fn) => this.inner.onEvent(fn));
    if (this.channel !== channel) return;
    this.setStatus("online");
    await this.flushQueue();
  }

  /** A method, not a field read, because the status changes across awaits. */
  private isOnline(): boolean {
    return this.status === "online";
  }

  private async flushQueue(): Promise<void> {
    for (const item of connStorage.queue(this.host.id)) {
      if (!this.isOnline()) return;
      if (isCommandName(item.name)) {
        try {
          const data: unknown = await this.inner.call(item.name, item.args, item.id);
          this.deferred.get(item.id)?.resolve(data);
        } catch (e) {
          if (!this.isOnline()) return;
          this.deferred.get(item.id)?.reject(toConnError(e));
        }
      }
      this.deferred.delete(item.id);
      connStorage.setQueue(
        this.host.id,
        connStorage.queue(this.host.id).filter((q) => q.id !== item.id),
      );
    }
  }

  call<N extends TCommandName>(
    name: N,
    args: TCommandArgs<N>,
    opts: { cmdId?: string } = {},
  ): Promise<TCommandResult<N>> {
    if (this.status === "online") return this.inner.call(name, args, opts.cmdId);
    if (!QUEUEABLE.includes(name)) {
      return Promise.reject(new ConnError("DISCONNECTED", "Not connected to the computer"));
    }
    const item: TQueued = { id: opts.cmdId ?? newId("cmd"), name, args };
    connStorage.setQueue(this.host.id, [...connStorage.queue(this.host.id), item]);
    return new Promise<unknown>((resolve, reject) => {
      this.deferred.set(item.id, { resolve, reject });
    }).then((data) => parseCommandResult(name, data));
  }

  async upload(base64: string, mime: string): Promise<TBlobRef> {
    if (this.status !== "online") throw new ConnError("DISCONNECTED", "Not connected to the computer");
    const { uploadId, size } = this.inner.sendBlob(base64);
    return this.inner.call("blob.put", { mime, size, uploadId });
  }
}

const CATCH_UP_TIMEOUT_MS = 10_000;

/** Resolves once every topic's cursor reached what `sync.hello` reported (or after a timeout). */
export function caughtUp(
  target: Readonly<Record<string, number>>,
  cursors: Readonly<Record<string, number>>,
  subscribe: (fn: () => void) => () => void,
): Promise<void> {
  const done = (): boolean => Object.entries(target).every(([t, c]) => (cursors[t] ?? 0) >= c);
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, CATCH_UP_TIMEOUT_MS);
    const unsubscribe = subscribe(() => {
      if (done()) finish();
    });
  });
}

function decodeBody(body: string): ReturnType<typeof handshakeMessageSchema.parse> | undefined {
  try {
    return tryParseJson(handshakeMessageSchema, bytesToUtf8(fromB64(body)));
  } catch {
    return undefined;
  }
}

function toConnError(e: unknown): ConnError {
  if (e instanceof ConnError) return e;
  return new ConnError("INTERNAL", e instanceof Error ? e.message : "Something went wrong");
}
