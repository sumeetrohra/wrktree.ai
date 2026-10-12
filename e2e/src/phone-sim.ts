import {
  bytesToUtf8,
  createHello,
  deviceIdFor,
  finishHandshake,
  fromB64,
  generateIdentity,
  handshakeMessageSchema,
  linkToOffer,
  pairingTranscript,
  pairMessageSchema,
  SecureChannel,
  shortCode,
  signRegistration,
  startHandshake,
  toB64,
  utf8ToBytes,
  verifyPairOk,
  type TIdentity,
  type TPairHello,
  type TPairingOffer,
} from "@agentdeck/crypto";
import {
  blobbedDataSchema,
  innerSchema,
  RELAY_TOKEN_PROTOCOL_PREFIX,
  RELAY_WS_PROTOCOL,
  relayControlSchema,
  relayFrameSchema,
  type TCommandName,
  type TCommandResult,
  type TEvtFrame,
  type TInner,
  type TProtocolError,
  type TRelayFrame,
} from "@agentdeck/protocol";
import { newId } from "@agentdeck/shared";

class PhoneCommandError extends Error {
  constructor(readonly error: TProtocolError) {
    super(`${error.code}: ${error.message}`);
  }
}

type TPending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const enc = (v: unknown) => toB64(utf8ToBytes(JSON.stringify(v)));
const dec = (body: string): unknown => JSON.parse(bytesToUtf8(fromB64(body)));

/**
 * A phone, in a test: it signs in to the relay, claims a pairing offer, proves it saw the QR code,
 * and then talks to the daemon only through end-to-end sealed frames, exactly as the app will.
 */
export class PhoneSim {
  readonly id: TIdentity = generateIdentity();
  readonly deviceId = deviceIdFor(this.id.signPub);
  private session = "";
  private deviceToken = "";
  private offer: TPairingOffer | null = null;
  private ws: WebSocket | null = null;
  private channel: SecureChannel | null = null;
  private readonly pending = new Map<string, TPending>();
  private readonly blobs = new Map<string, string[]>();
  private readonly waiters = new Set<() => void>();
  private pairWaiter: ((f: TRelayFrame) => void) | null = null;
  private hsWaiter: ((f: TRelayFrame) => void) | null = null;
  readonly events: TEvtFrame[] = [];
  readonly lastCursor = new Map<string, number>();
  readonly gaps: string[] = [];
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

  /** Magic-link sign-in (reads the dev outbox) and device registration. */
  async signIn(email: string): Promise<void> {
    await this.http("POST", "/v1/auth/start", { email });
    const { messages } = (await this.http("GET", "/v1/dev/outbox")) as {
      messages: { to: string; code: string }[];
    };
    const code = messages.filter((m) => m.to === email).at(-1)?.code;
    const fin = await this.http("POST", "/v1/auth/finish", { email, code });
    this.session = String(fin["sessionToken"]);
    const reg = await this.http(
      "POST",
      "/v1/devices/register",
      { ...signRegistration(this.id, Date.now()), kind: "phone", name: this.name },
      this.session,
    );
    this.deviceToken = String(reg["deviceToken"]);
  }

  async registerPush(token: string): Promise<void> {
    await this.http("POST", "/v1/push/register", { expoPushToken: token }, this.deviceToken);
  }

  /** Scans the link: claims the offer, sends pair.hello, checks pair.ok. Returns the short code. */
  async pair(link: string, opts: { forgeSecret?: boolean } = {}): Promise<{ code: string; ok: boolean }> {
    const offer = linkToOffer(link);
    if (!offer) throw new Error("not a pairing link");
    this.offer = offer;
    await this.http(
      "POST",
      "/v1/pair/claim",
      { pairingId: offer.pairingId, phoneDeviceId: this.deviceId },
      this.session,
    );
    await this.open();
    const helloOffer = opts.forgeSecret ? { ...offer, secret: toB64(new Uint8Array(32)) } : offer;
    const hello: TPairHello = createHello(this.id, helloOffer, this.name);
    const reply = new Promise<TRelayFrame>((resolve) => {
      this.pairWaiter = resolve;
    });
    this.sendFrame({
      v: 1,
      from: this.deviceId,
      to: offer.daemonDeviceId,
      seq: 0,
      kind: "pair",
      body: enc(hello),
    });
    const frame = await withTimeout(reply, 10_000, "pair reply");
    const msg = pairMessageSchema.parse(dec(frame.body));
    const ok = msg.t === "pair.ok" && verifyPairOk(offer, hello, msg);
    return { code: shortCode(pairingTranscript(offer, hello)), ok };
  }

  get daemonId(): string {
    if (!this.offer) throw new Error("not paired");
    return this.offer.daemonDeviceId;
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

  /** Opens the socket, runs the signed handshake, then `sync.hello` from the last cursors seen. */
  async connect(opts: { timeoutMs?: number } = {}): Promise<void> {
    if (!this.offer) throw new Error("pair first");
    if (this.ws?.readyState !== WebSocket.OPEN) await this.open();
    const peers = { clientId: this.deviceId, serverId: this.offer.daemonDeviceId };
    const { init, pending } = startHandshake(this.id, peers);
    const accepted = new Promise<TRelayFrame>((resolve) => {
      this.hsWaiter = resolve;
    });
    this.sendFrame({
      v: 1,
      from: this.deviceId,
      to: this.offer.daemonDeviceId,
      seq: 0,
      kind: "hs",
      body: enc({ t: "session.init", ...init }),
    });
    const frame = await withTimeout(accepted, opts.timeoutMs ?? 10_000, "handshake");
    const msg = handshakeMessageSchema.parse(dec(frame.body));
    if (msg.t !== "session.accept") throw new Error("unexpected handshake reply");
    const session = finishHandshake(fromB64(this.offer.daemonSignPub), peers, pending, msg);
    if (!session) throw new Error("forged handshake reply");
    this.channel = new SecureChannel(session, this.deviceId, this.offer.daemonDeviceId);
    const cursors: Record<string, number> = { global: 0, "repo:*": 0, "chat:*": 0 };
    for (const [t, c] of this.lastCursor) cursors[t] = c;
    await this.call("sync.hello", { deviceName: this.name, appVersion: "e2e", cursors });
  }

  /** Simulates losing the network: the socket goes, the session with it. */
  disconnect(): void {
    this.channel = null;
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
    if (!this.channel || !this.offer) throw new Error("no session");
    const s = this.channel.seal(JSON.stringify(inner));
    const frame: TRelayFrame = {
      v: 1,
      from: this.deviceId,
      to: this.offer.daemonDeviceId,
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
    if (f.kind === "pair") {
      this.pairWaiter?.(f);
      return;
    }
    if (f.kind === "hs") {
      this.hsWaiter?.(f);
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
    const plain =
      this.channel && f.sid !== undefined
        ? this.channel.open({ from: f.from, to: f.to, seq: f.seq, sessionId: f.sid, body: f.body })
        : null;
    if (plain === null) {
      this.dropped++;
      return;
    }
    const inner = innerSchema.parse(JSON.parse(plain));
    this.onInner(inner);
  }

  private onInner(f: TInner): void {
    switch (f.t) {
      case "evt": {
        const last = this.lastCursor.get(f.topic) ?? 0;
        if (f.cursor <= last) return; // replay overlap after a reconnect
        if (f.cursor !== last + 1) this.gaps.push(`${f.topic}: ${last} → ${f.cursor}`);
        this.lastCursor.set(f.topic, f.cursor);
        this.events.push(f);
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
    return new Promise((resolve, reject) => {
      const scan = () => {
        const hit = this.events.find(pred);
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
