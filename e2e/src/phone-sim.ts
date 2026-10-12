import {
  bytesToUtf8,
  deviceIdFor,
  finishHandshake,
  fromB64,
  generateIdentity,
  handshakeMessageSchema,
  SecureChannel,
  signRegistration,
  startHandshake,
  toB64,
  utf8ToBytes,
  type TIdentity,
} from "@agentdeck/crypto";
import { FirebaseAuth, Firestore, Storage, TokenSource } from "@agentdeck/firebase-rest";
import {
  blobbedDataSchema,
  innerSchema,
  RELAY_TOKEN_PROTOCOL_PREFIX,
  RELAY_WS_PROTOCOL,
  relayConfigSchema,
  relayControlSchema,
  relayFrameSchema,
  type TCommandName,
  type TCommandResult,
  type TDeviceKind,
  type TEvtFrame,
  type TInner,
  type TProtocolError,
  type TRelayDevice,
  type TRelayFrame,
} from "@agentdeck/protocol";
import { newId } from "@agentdeck/shared";

class PhoneCommandError extends Error {
  constructor(readonly error: TProtocolError) {
    super(`${error.code}: ${error.message}`);
  }
}

type TPending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** One host this phone talks to: its sealed session and the events it sent. */
type THostSession = {
  channel: SecureChannel | null;
  readonly events: TEvtFrame[];
  readonly lastCursor: Map<string, number>;
  readonly gaps: string[];
};

const enc = (v: unknown) => toB64(utf8ToBytes(JSON.stringify(v)));
const dec = (body: string): unknown => JSON.parse(bytesToUtf8(fromB64(body)));

/**
 * A phone, in a test: it signs in (a dev ID token standing in for Firebase), registers, finds the
 * account's hosts in the relay's device list, and talks to each only through end-to-end sealed
 * frames, exactly as the app does. Calls and event getters act on the current host (`use`).
 */
export class PhoneSim {
  readonly id: TIdentity = generateIdentity();
  readonly deviceId = deviceIdFor(this.id.signPub);
  idToken = "";
  uid = "";
  private deviceToken = "";
  private ws: WebSocket | null = null;
  private host: string | null = null;
  private readonly sessions = new Map<string, THostSession>();
  private readonly pending = new Map<string, TPending>();
  private readonly blobs = new Map<string, string[]>();
  private readonly waiters = new Set<() => void>();
  private readonly hsWaiters = new Map<string, (f: TRelayFrame) => void>();
  /** Raw frames the relay delivered (what an attacker on the relay would see). */
  readonly wire: string[] = [];
  /** Sealed frames this phone sent, for replay/tamper tests. */
  readonly sent: TRelayFrame[] = [];
  closeCode: number | null = null;
  dropped = 0;
  /** Ids of every command reply that arrived, answered or not. */
  readonly replies: string[] = [];

  constructor(
    readonly relayUrl: string,
    readonly name = "Test phone",
    readonly kind: TDeviceKind = "phone",
  ) {}

  private async http(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(this.relayUrl + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  /** Signs in as `uid` (the relay's dev issuer stands in for Firebase) and registers this device. */
  async signIn(uid: string): Promise<void> {
    this.uid = uid;
    const q = `uid=${encodeURIComponent(uid)}&email=${encodeURIComponent(`${uid}@example.com`)}`;
    this.idToken = String((await this.http("GET", `/v1/dev/id-token?${q}`))["idToken"]);
    const reg = await this.http(
      "POST",
      "/v1/devices/register",
      { ...signRegistration(this.id, Date.now()), kind: this.kind, name: this.name },
      this.idToken,
    );
    this.deviceToken = String(reg["deviceToken"]);
  }

  /**
   * Signs in like the app does against a relay with Firebase: through the Auth emulator as
   * `<uid>@example.com` (the same user `agentdeck login --dev <uid>` becomes), then registers.
   * Returns Firestore and Storage clients for that user.
   */
  async signInFirebase(uid: string): Promise<{ db: Firestore; files: Storage; uid: string }> {
    this.uid = uid;
    const res = await fetch(`${this.relayUrl}/v1/config`);
    const { firebase } = relayConfigSchema.parse(await res.json());
    if (!firebase) throw new Error("the relay has no Firebase project");
    const auth = new FirebaseAuth(firebase);
    const email = `${uid}@example.com`;
    const signed = await auth.signInWithEmailLink(email, await auth.emulatorSignInLink(email));
    const tokens = new TokenSource(auth, signed.session, () => undefined, signed);
    this.idToken = await tokens.idToken();
    const reg = await this.http(
      "POST",
      "/v1/devices/register",
      { ...signRegistration(this.id, Date.now()), kind: this.kind, name: this.name },
      this.idToken,
    );
    this.deviceToken = String(reg["deviceToken"]);
    const idToken = (): Promise<string> => tokens.idToken();
    return {
      db: new Firestore(firebase, idToken),
      files: new Storage(firebase, idToken),
      uid: signed.session.uid,
    };
  }

  /** The account's devices, from the relay. */
  async devices(): Promise<TRelayDevice[]> {
    return (await this.http("GET", "/v1/devices", undefined, this.idToken))["devices"] as TRelayDevice[];
  }

  /** The account's hosts (computers running the daemon). */
  async hosts(): Promise<TRelayDevice[]> {
    return (await this.devices()).filter((d) => d.kind === "daemon");
  }

  /** Removes a device from the account, as the app's Hosts and Devices screens do. */
  async remove(deviceId: string): Promise<void> {
    await this.http("DELETE", `/v1/devices/${deviceId}`, undefined, this.idToken);
  }

  async registerPush(token: string): Promise<void> {
    await this.http("POST", "/v1/push/register", { expoPushToken: token }, this.deviceToken);
  }

  /** Makes `hostId` the host that `connect`, `call` and the event getters act on. */
  use(hostId: string): this {
    this.host = hostId;
    if (!this.sessions.has(hostId)) {
      this.sessions.set(hostId, { channel: null, events: [], lastCursor: new Map(), gaps: [] });
    }
    return this;
  }

  get daemonId(): string {
    if (this.host === null) throw new Error("pick a host first (use)");
    return this.host;
  }

  private get current(): THostSession {
    const s = this.sessions.get(this.daemonId);
    if (!s) throw new Error("no session");
    return s;
  }

  get events(): TEvtFrame[] {
    return this.current.events;
  }

  get lastCursor(): Map<string, number> {
    return this.current.lastCursor;
  }

  get gaps(): string[] {
    return this.current.gaps;
  }

  private open(): Promise<void> {
    const url = `${this.relayUrl.replace(/^http/, "ws")}/v1/ws`;
    const ws = new WebSocket(url, [RELAY_WS_PROTOCOL, RELAY_TOKEN_PROTOCOL_PREFIX + this.deviceToken]);
    this.ws = ws;
    this.closeCode = null;
    ws.addEventListener("message", (e) => {
      this.onText(String(e.data));
    });
    ws.addEventListener("close", (e) => {
      this.closeCode ??= e.code;
      for (const p of this.pending.values()) p.reject(new Error("phone disconnected"));
      this.pending.clear();
      this.notify();
    });
    return new Promise((resolve, reject) => {
      ws.addEventListener("open", () => {
        resolve();
      });
      ws.addEventListener("error", () => {
        reject(new Error("relay refused the phone"));
      });
    });
  }

  /**
   * Opens the socket, runs the signed handshake with the current host (its key from the account's
   * device list), then `sync.hello` from the last cursors seen.
   */
  async connect(opts: { timeoutMs?: number } = {}): Promise<void> {
    const host = this.daemonId;
    const signPub = (await this.devices()).find((d) => d.id === host)?.signPub;
    if (signPub === undefined) throw new Error(`host ${host} is not on the account`);
    if (this.ws?.readyState !== WebSocket.OPEN) await this.open();
    const peers = { clientId: this.deviceId, serverId: host };
    const { init, pending } = startHandshake(this.id, peers);
    const accepted = new Promise<TRelayFrame>((resolve) => {
      this.hsWaiters.set(host, resolve);
    });
    this.sendFrame({
      v: 1,
      from: this.deviceId,
      to: host,
      seq: 0,
      kind: "hs",
      body: enc({ t: "session.init", ...init }),
    });
    const frame = await withTimeout(accepted, opts.timeoutMs ?? 10_000, "handshake");
    const msg = handshakeMessageSchema.parse(dec(frame.body));
    if (msg.t !== "session.accept") throw new Error("unexpected handshake reply");
    const session = finishHandshake(fromB64(signPub), peers, pending, msg);
    if (!session) throw new Error("forged handshake reply");
    const s = this.current;
    s.channel = new SecureChannel(session, this.deviceId, host);
    const cursors: Record<string, number> = { global: 0, "repo:*": 0, "chat:*": 0 };
    for (const [t, c] of s.lastCursor) cursors[t] = c;
    await this.call("sync.hello", { deviceName: this.name, appVersion: "e2e", cursors });
  }

  /** Simulates losing the network: the socket goes, the session with it. */
  disconnect(): void {
    for (const s of this.sessions.values()) s.channel = null;
    this.ws?.close();
  }

  private notify(): void {
    for (const w of this.waiters) w();
  }

  private sendFrame(f: TRelayFrame): void {
    this.ws?.send(JSON.stringify(f));
  }

  /** Seals an inner frame for the daemon (returned so tests can tamper with it or replay it). */
  seal(inner: TInner): TRelayFrame {
    const channel = this.current.channel;
    if (!channel) throw new Error("no session");
    const s = channel.seal(JSON.stringify(inner));
    const frame: TRelayFrame = {
      v: 1,
      from: this.deviceId,
      to: this.daemonId,
      seq: s.seq,
      sid: s.sessionId,
      kind: "msg",
      body: s.body,
    };
    this.sent.push(frame);
    return frame;
  }

  sendRaw(frame: TRelayFrame): void {
    this.sendFrame(frame);
  }

  call<N extends TCommandName>(
    name: N,
    args: unknown,
    opts: { cmdId?: string; timeoutMs?: number } = {},
  ): Promise<TCommandResult<N>> {
    const id = opts.cmdId ?? newId("cmd");
    const reply = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.sendFrame(this.seal({ t: "cmd", id, name, args }));
    return withTimeout(reply, opts.timeoutMs ?? 20_000, `${name} reply`) as Promise<TCommandResult<N>>;
  }

  private onText(text: string): void {
    this.wire.push(text);
    const control = relayControlSchema.safeParse(safeJson(text));
    if (control.success) {
      if (control.data.t === "relay.closed") {
        this.closeCode = control.data.code;
        this.ws?.close();
      }
      return;
    }
    const parsed = relayFrameSchema.safeParse(safeJson(text));
    if (!parsed.success) return;
    const f = parsed.data;
    if (f.kind === "hs") {
      this.hsWaiters.get(f.from)?.(f);
      return;
    }
    if (f.kind !== "msg") return;
    // Ack whatever arrives, readable or not, so the relay drops it from its buffer.
    this.sendFrame({
      v: 1,
      from: this.deviceId,
      to: f.from,
      seq: f.seq,
      kind: "ack",
      body: "",
      ...(f.sid ? { sid: f.sid } : {}),
    });
    const session = this.sessions.get(f.from);
    const plain =
      session?.channel && f.sid !== undefined
        ? session.channel.open({ from: f.from, to: f.to, seq: f.seq, sessionId: f.sid, body: f.body })
        : null;
    if (!session || plain === null) {
      this.dropped++;
      return;
    }
    const inner = innerSchema.parse(JSON.parse(plain));
    this.onInner(session, inner);
  }

  private onInner(session: THostSession, f: TInner): void {
    switch (f.t) {
      case "evt": {
        const last = session.lastCursor.get(f.topic) ?? 0;
        if (f.cursor <= last) return; // replay overlap after a reconnect
        if (f.cursor !== last + 1) session.gaps.push(`${f.topic}: ${last} → ${f.cursor}`);
        session.lastCursor.set(f.topic, f.cursor);
        session.events.push(f);
        this.notify();
        return;
      }
      case "blob": {
        const parts = this.blobs.get(f.blobId) ?? [];
        parts[f.part] = f.bytes;
        this.blobs.set(f.blobId, parts);
        return;
      }
      case "res": {
        this.replies.push(f.id);
        const p = this.pending.get(f.id);
        if (!p) return;
        this.pending.delete(f.id);
        if (!f.ok) {
          p.reject(new PhoneCommandError(f.error));
          return;
        }
        const blobbed = blobbedDataSchema.strict().safeParse(f.data);
        if (!blobbed.success) {
          p.resolve(f.data);
          return;
        }
        const parts = this.blobs.get(blobbed.data.$blob) ?? [];
        p.resolve(JSON.parse(Buffer.concat(parts.map((b) => Buffer.from(b, "base64"))).toString("utf8")));
        return;
      }
      case "cmd":
        return;
    }
  }

  waitFor(pred: (f: TEvtFrame) => boolean, what: string, timeoutMs = 20_000): Promise<TEvtFrame> {
    const events = this.events;
    return new Promise((resolve, reject) => {
      const scan = () => {
        const hit = events.find(pred);
        if (hit) {
          this.waiters.delete(scan);
          clearTimeout(timer);
          resolve(hit);
        }
      };
      const timer = setTimeout(() => {
        this.waiters.delete(scan);
        reject(new Error(`phone timed out waiting for ${what}`));
      }, timeoutMs);
      this.waiters.add(scan);
      scan();
    });
  }

  async waitClosed(timeoutMs = 5000): Promise<number> {
    const end = Date.now() + timeoutMs;
    while (this.closeCode === null) {
      if (Date.now() > end) throw new Error("phone socket was not closed");
      await new Promise((r) => setTimeout(r, 50));
    }
    return this.closeCode;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`timed out waiting for ${what}`));
      }, ms),
    ),
  ]);
}
