import {
  acceptHandshake,
  bytesToUtf8,
  fromB64,
  handshakeMessageSchema,
  SecureChannel,
  toB64,
  utf8ToBytes,
  type TIdentity,
} from "@agentdeck/crypto";
import {
  innerSchema,
  previewFrameSchema,
  RELAY_SELF,
  relayControlSchema,
  relayFrameSchema,
  type TChatStatus,
  type TInner,
  type TRelayFrame,
} from "@agentdeck/protocol";
import { tryParseJson, type ILogger } from "@agentdeck/shared";
import type { z } from "zod";

import type { EventBus } from "../bus/index.js";
import type { Router } from "../rpc/index.js";

import { Connection } from "./connection.service.js";
import { PreviewProxy, type IPreviewPorts } from "./preview-proxy.service.js";

/** Who may open a session: consumers on the account (port, implemented by the app's `Remote`). */
export interface IRelayPeers {
  /** The device's signing key, or null if it isn't a consumer on this host's account. */
  signPubOf(deviceId: string): Promise<Uint8Array | null>;
  seen(deviceId: string): void;
  /** A device of the account came online or went offline. */
  onPresence(deviceId: string, online: boolean): void;
}

/** The relay socket, as far as the transport cares. */
export interface IRelaySend {
  send(text: string): boolean;
}

type TPeer = { channel: SecureChannel; conn: Connection; online: boolean };

const WAKE_STATUSES: readonly TChatStatus[] = ["limited", "crashed"];

const encode = (value: unknown): string => toB64(utf8ToBytes(JSON.stringify(value)));

function decode<S extends z.ZodType>(schema: S, body: string): z.infer<S> | undefined {
  try {
    return tryParseJson(schema, bytesToUtf8(fromB64(body)));
  } catch {
    return undefined;
  }
}

/**
 * End-to-end encrypted sessions with the account's consumers (phones, browsers), carried by the relay. Each phone connection
 * starts with a signed ephemeral handshake; after that every inner frame is sealed with the
 * session's keys and bound to its routing header, so the relay only ever handles ciphertext.
 * Behind each session sits an ordinary `Connection`, so the phone gets exactly the local API.
 */
export class RelayTransport {
  private readonly peers = new Map<string, TPeer>();
  /**
   * Handshakes run one at a time, in arrival order: checking a key may wait for the account's
   * device list, and a later handshake must never be overtaken by an earlier one (the device
   * would be left holding a session this side already replaced).
   */
  private handshakes: Promise<void> = Promise.resolve();
  /** Last status per chat, to wake the phone at the end of a turn (running → idle). */
  private readonly lastStatus = new Map<string, TChatStatus>();
  /** Preview tunnel traffic (Phase 3c): plain frames from the relay itself, not sealed. */
  private readonly preview: PreviewProxy | null;

  constructor(
    private readonly me: TIdentity,
    readonly myId: string,
    private readonly link: IRelaySend,
    private readonly bus: EventBus,
    private readonly router: Router,
    private readonly devices: IRelayPeers,
    private readonly log: ILogger,
    previewPorts: IPreviewPorts | null = null,
  ) {
    this.preview =
      previewPorts &&
      new PreviewProxy(
        (f) => {
          this.link.send(this.frame(RELAY_SELF, "preview", JSON.stringify(f)));
        },
        previewPorts,
        log,
      );
  }

  private frame(
    to: string,
    kind: TRelayFrame["kind"],
    body: string,
    extra: Partial<TRelayFrame> = {},
  ): string {
    const f: TRelayFrame = { v: 1, to, from: this.myId, seq: 0, kind, body, ...extra };
    return JSON.stringify(f);
  }

  /** The relay socket delivered something: a control frame or a frame from a device. */
  onText(text: string): void {
    const control = tryParseJson(relayControlSchema, text);
    if (control) {
      if (control.t === "relay.presence") {
        const peer = this.peers.get(control.deviceId);
        if (peer && !control.online) peer.online = false;
        this.devices.onPresence(control.deviceId, control.online);
      }
      return;
    }
    const frame = tryParseJson(relayFrameSchema, text);
    if (frame?.to !== this.myId) return;
    switch (frame.kind) {
      case "hs":
        this.handshakes = this.handshakes.then(() => this.onHandshake(frame)).catch(() => undefined);
        return;
      case "msg":
        this.onSealed(frame);
        return;
      case "preview": {
        const f = frame.from === RELAY_SELF ? tryParseJson(previewFrameSchema, frame.body) : undefined;
        if (f) this.preview?.onFrame(f);
        return;
      }
      case "pair": // QR pairing was removed in Phase 2c
      case "ack":
      case "ping":
        return;
    }
  }

  private async onHandshake(frame: TRelayFrame): Promise<void> {
    const msg = decode(handshakeMessageSchema, frame.body);
    const signPub = msg?.t === "session.init" ? await this.devices.signPubOf(frame.from) : null;
    if (msg?.t !== "session.init" || !signPub) {
      this.log.warn({ from: frame.from }, "refused relay handshake");
      return;
    }
    const peers = { clientId: frame.from, serverId: this.myId };
    const accepted = acceptHandshake(this.me, signPub, peers, msg);
    if (!accepted) {
      this.log.warn({ from: frame.from }, "forged relay handshake");
      return;
    }
    this.dropPeer(frame.from);
    const channel = new SecureChannel(accepted.session, this.myId, frame.from);
    const conn = new Connection(
      `relay-${frame.from}`,
      {
        send: (text) => {
          this.sendSealed(frame.from, text);
        },
        close: () => {
          this.dropPeer(frame.from);
        },
      },
      this.bus,
      this.router,
      this.log,
    );
    this.peers.set(frame.from, { channel, conn, online: true });
    this.devices.seen(frame.from);
    this.link.send(this.frame(frame.from, "hs", encode({ t: "session.accept", ...accepted.accept })));
  }

  private onSealed(frame: TRelayFrame): void {
    // Ack everything, readable or not, so the relay can drop it from its buffer.
    this.link.send(
      this.frame(frame.from, "ack", "", { seq: frame.seq, ...(frame.sid ? { sid: frame.sid } : {}) }),
    );
    const peer = this.peers.get(frame.from);
    if (!peer || frame.sid === undefined) return;
    const plain = peer.channel.open({
      from: frame.from,
      to: frame.to,
      seq: frame.seq,
      sessionId: frame.sid,
      body: frame.body,
    });
    if (plain === null) {
      this.log.warn({ from: frame.from }, "dropped a frame that failed to open");
      return;
    }
    peer.online = true;
    void peer.conn.receive(plain);
  }

  /** Frames to an offline phone only go out when they should wake it; the rest replay on reconnect. */
  private sendSealed(to: string, text: string): void {
    const peer = this.peers.get(to);
    if (!peer) return;
    const inner = tryParseJson(innerSchema, text);
    const wake = inner !== undefined && this.wakes(inner);
    if (!peer.online && !wake) return;
    const sealed = peer.channel.seal(text);
    this.link.send(
      this.frame(to, "msg", sealed.body, {
        seq: sealed.seq,
        sid: sealed.sessionId,
        ...(wake ? { wake: true } : {}),
      }),
    );
  }

  /** Permission requests, limits, crashes and the end of a turn are worth a push. */
  private wakes(inner: TInner): boolean {
    if (inner.t !== "evt") return false;
    const e = inner.event;
    if (e.type === "permission.requested") return true;
    if (e.type !== "chat.status") return false;
    const before = this.lastStatus.get(e.chatId);
    this.lastStatus.set(e.chatId, e.status);
    if (WAKE_STATUSES.includes(e.status)) return true;
    return e.status === "idle" && before === "running";
  }

  /** Ends a device's session (removed from the account, or replaced by a new handshake). */
  dropPeer(deviceId: string): void {
    const peer = this.peers.get(deviceId);
    if (!peer) return;
    peer.conn.dispose();
    this.peers.delete(deviceId);
  }

  /** The relay socket dropped: the relay ended every preview request through it. */
  linkDown(): void {
    this.preview?.close();
  }

  close(): void {
    this.preview?.close();
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
  }
}
