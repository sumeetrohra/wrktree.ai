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
  RELAY_TOKEN_PROTOCOL_PREFIX,
  RELAY_WS_PROTOCOL,
  relayControlSchema,
  relayFrameSchema,
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

import { connStorage, type TMachine, type TQueued } from "./conn.storage";
import { ConnError, type IDaemonConnection, type TConnStatus } from "./connection.types";
import { InnerClient } from "./inner-client";
import { relayApi, RelayApiError } from "./relay-api";

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const HANDSHAKE_TIMEOUT_MS = 5000;
const REVOKED = 4003;
const MOVED = 4001;
/** Commands worth keeping while offline; they run once the phone reconnects (idempotent by id). */
const QUEUEABLE: readonly TCommandName[] = ["chat.send", "permission.respond", "chat.cancel"];
const DEFAULT_CURSORS: Readonly<Record<string, number>> = { global: 0, "repo:*": 0, "chat:*": 0 };

type TDeferred = { resolve: (v: unknown) => void; reject: (e: ConnError) => void };

const encode = (v: unknown): string => toB64(utf8ToBytes(JSON.stringify(v)));

/**
 * The phone's connection to its machine through the relay. Each socket starts with a signed
 * ephemeral handshake; everything after is sealed end to end. On reconnect it handshakes again
 * and `sync.hello` replays from the last cursors; queued commands then run with their original ids.
 */
export class RelayConnection implements IDaemonConnection {
  private ws: WebSocket | null = null;
  private channel: SecureChannel | null = null;
  private pendingHs: { sessionId: string; eph: TKxKeyPair } | null = null;
  private hsTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = false;
  private networkDown = false;
  private readonly inner = new InnerClient();
  private readonly statusListeners = new Set<(s: TConnStatus) => void>();
  private readonly eventListeners = new Set<(e: TEvtFrame) => void>();
  private readonly deferred = new Map<string, TDeferred>();
  private cursors: Record<string, number>;
  status: TConnStatus = "connecting";

  constructor(
    private readonly machine: TMachine,
    private readonly me: TIdentity,
    readonly myId: string,
    private readonly deviceToken: string,
    private readonly deviceName: string,
  ) {
    this.cursors = { ...DEFAULT_CURSORS, ...connStorage.cursors() };
    // Advance and persist the cursor first; a replayed event at or below it is an overlap.
    this.inner.onEvent((e) => {
      if (e.cursor <= (this.cursors[e.topic] ?? 0)) return;
      this.cursors[e.topic] = e.cursor;
      connStorage.setCursors(this.cursors);
      for (const l of this.eventListeners) l(e);
    });
  }

  start(): void {
    this.open();
  }

  /** The device lost or regained its network: drop the socket now, or reconnect at once. */
  setNetwork(online: boolean): void {
    this.networkDown = !online;
    if (!online) {
      this.ws?.close();
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.attempt = 0;
    if (!this.ws) this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.hsTimer) clearTimeout(this.hsTimer);
    this.ws?.close();
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

  private open(): void {
    if (this.stopped || this.networkDown) return;
    this.setStatus("connecting");
    const url = `${this.machine.relayUrl.replace(/^http/, "ws")}/v1/ws`;
    const ws = new WebSocket(url, [RELAY_WS_PROTOCOL, RELAY_TOKEN_PROTOCOL_PREFIX + this.deviceToken]);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.handshake();
    };
    ws.onmessage = (msg: MessageEvent<string>) => {
      this.onText(msg.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.channel = null;
      this.inner.attach(null);
      this.inner.failAll(new ConnError("DISCONNECTED", "Connection to the machine was lost"));
      if (this.hsTimer) clearTimeout(this.hsTimer);
      if (this.stopped || this.status === "revoked") return;
      this.setStatus("offline");
      // Refused before opening: browsers can't see why, so ask the relay whether we were revoked.
      if (!opened && !this.networkDown) void this.checkRevoked();
      this.schedule();
    };
  }

  private async checkRevoked(): Promise<void> {
    try {
      await relayApi.me(this.machine.relayUrl, this.deviceToken);
    } catch (e) {
      if (e instanceof RelayApiError && e.status === 401) {
        this.setStatus("revoked");
        this.stop();
      }
    }
  }

  private schedule(immediately = false): void {
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 15000;
    this.attempt++;
    this.retryTimer = setTimeout(
      () => {
        this.open();
      },
      immediately ? 0 : base / 2 + Math.random() * (base / 2),
    );
  }

  private sendFrame(f: TRelayFrame): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(f));
    return true;
  }

  private handshake(): void {
    const peers = { clientId: this.myId, serverId: this.machine.daemonDeviceId };
    const { init, pending } = startHandshake(this.me, peers);
    this.pendingHs = pending;
    this.sendFrame({
      v: 1,
      from: this.myId,
      to: this.machine.daemonDeviceId,
      seq: 0,
      kind: "hs",
      body: encode({ t: "session.init", ...init }),
    });
    // A daemon that hasn't confirmed this phone yet doesn't answer: retry later.
    this.hsTimer = setTimeout(() => {
      this.ws?.close();
    }, HANDSHAKE_TIMEOUT_MS);
  }

  private onText(text: string): void {
    const control = tryParseJson(relayControlSchema, text);
    if (control) {
      if (control.t === "relay.closed") {
        if (control.code === REVOKED) this.setStatus("revoked");
        if (control.code === MOVED) this.attempt = 0;
        this.ws?.close();
      }
      return;
    }
    const f = tryParseJson(relayFrameSchema, text);
    if (f?.to !== this.myId || f.from !== this.machine.daemonDeviceId) return;
    if (f.kind === "hs") {
      this.onAccept(f);
      return;
    }
    if (f.kind !== "msg") return;
    this.sendFrame({
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
    const peers = { clientId: this.myId, serverId: this.machine.daemonDeviceId };
    const session = finishHandshake(fromB64(this.machine.daemonSignPub), peers, pending, msg);
    if (!session) return;
    if (this.hsTimer) clearTimeout(this.hsTimer);
    this.pendingHs = null;
    const channel = new SecureChannel(session, this.myId, this.machine.daemonDeviceId);
    this.channel = channel;
    this.inner.attach((plain) => {
      const s = channel.seal(plain);
      return this.sendFrame({
        v: 1,
        from: this.myId,
        to: this.machine.daemonDeviceId,
        seq: s.seq,
        sid: s.sessionId,
        kind: "msg",
        body: s.body,
      });
    });
    void this.afterSession();
  }

  private async afterSession(): Promise<void> {
    let topics: Record<string, number>;
    try {
      ({ topics } = await this.inner.call("sync.hello", {
        deviceName: this.deviceName,
        appVersion: "0.1.0",
        cursors: this.cursors,
      }));
    } catch {
      this.ws?.close();
      return;
    }
    this.attempt = 0;
    // "Online" means caught up: the replay that follows the reply has been applied.
    await caughtUp(topics, this.cursors, (fn) => this.inner.onEvent(fn));
    this.setStatus("online");
    await this.flushQueue();
  }

  /** A method, not a field read, because the status changes across awaits. */
  private isOnline(): boolean {
    return this.status === "online";
  }

  private async flushQueue(): Promise<void> {
    for (const item of connStorage.queue()) {
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
      connStorage.setQueue(connStorage.queue().filter((q) => q.id !== item.id));
    }
  }

  call<N extends TCommandName>(
    name: N,
    args: TCommandArgs<N>,
    opts: { cmdId?: string } = {},
  ): Promise<TCommandResult<N>> {
    if (this.status === "online") return this.inner.call(name, args, opts.cmdId);
    if (!QUEUEABLE.includes(name)) {
      return Promise.reject(new ConnError("DISCONNECTED", "Not connected to the machine"));
    }
    const item: TQueued = { id: opts.cmdId ?? newId("cmd"), name, args };
    connStorage.setQueue([...connStorage.queue(), item]);
    return new Promise<unknown>((resolve, reject) => {
      this.deferred.set(item.id, { resolve, reject });
    }).then((data) => parseCommandResult(name, data));
  }

  async upload(base64: string, mime: string): Promise<TBlobRef> {
    if (this.status !== "online") throw new ConnError("DISCONNECTED", "Not connected to the machine");
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
