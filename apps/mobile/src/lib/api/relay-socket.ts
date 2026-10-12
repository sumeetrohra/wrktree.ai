import {
  RELAY_TOKEN_PROTOCOL_PREFIX,
  RELAY_WS_PROTOCOL,
  relayControlSchema,
  relayFrameSchema,
  type TRelayControl,
  type TRelayFrame,
} from "@agentdeck/protocol";
import { tryParseJson } from "@agentdeck/shared";

import { relayApi, RelayApiError } from "./relay-api";

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const REVOKED = 4003;
const MOVED = 4001;

/** One host's end of the shared socket. */
export interface IRelayPeer {
  onFrame(f: TRelayFrame): void;
  /** The socket (re)opened: start a handshake. */
  onOpen(): void;
  /** The socket closed: every session on it is gone. */
  onClose(): void;
}

/**
 * This device's one socket to the relay, shared by the sessions with every host on the account
 * (the relay keeps one socket per device). Reconnects with jittered backoff; stops for good once
 * the relay says this device was removed.
 */
export class RelaySocket {
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = false;
  private networkDown = false;
  private readonly peers = new Map<string, IRelayPeer>();
  private readonly controlListeners = new Set<(c: TRelayControl) => void>();
  private readonly removedListeners = new Set<() => void>();
  open = false;
  removed = false;

  constructor(
    readonly relayUrl: string,
    private readonly deviceToken: string,
    readonly myId: string,
  ) {}

  /** Routes frames from `hostId` to `peer`. Returns a detach function. */
  attach(hostId: string, peer: IRelayPeer): () => void {
    this.peers.set(hostId, peer);
    if (this.open) peer.onOpen();
    return () => {
      if (this.peers.get(hostId) === peer) this.peers.delete(hostId);
    };
  }

  onControl(fn: (c: TRelayControl) => void): () => void {
    this.controlListeners.add(fn);
    return () => this.controlListeners.delete(fn);
  }

  /** This device was removed from the account (or its token no longer works). */
  onRemoved(fn: () => void): () => void {
    this.removedListeners.add(fn);
    return () => this.removedListeners.delete(fn);
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
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
    if (!this.ws) this.connect();
  }

  send(f: TRelayFrame): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(f));
    return true;
  }

  private markRemoved(): void {
    if (this.removed) return;
    this.removed = true;
    this.stop();
    for (const l of this.removedListeners) l();
  }

  private connect(): void {
    if (this.stopped || this.networkDown) return;
    const url = `${this.relayUrl.replace(/^http/, "ws")}/v1/ws`;
    const ws = new WebSocket(url, [RELAY_WS_PROTOCOL, RELAY_TOKEN_PROTOCOL_PREFIX + this.deviceToken]);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.attempt = 0;
      this.open = true;
      for (const p of this.peers.values()) p.onOpen();
    };
    ws.onmessage = (msg: MessageEvent<string>) => {
      this.onText(msg.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.open = false;
      for (const p of this.peers.values()) p.onClose();
      if (this.stopped) return;
      // Refused before opening: browsers can't see why, so ask the relay whether we were removed.
      if (!opened && !this.networkDown) void this.checkRemoved();
      this.schedule();
    };
  }

  private async checkRemoved(): Promise<void> {
    try {
      await relayApi.me(this.relayUrl, this.deviceToken);
    } catch (e) {
      if (e instanceof RelayApiError && e.status === 401) this.markRemoved();
    }
  }

  private schedule(): void {
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 15000;
    this.attempt++;
    this.retryTimer = setTimeout(
      () => {
        this.connect();
      },
      base / 2 + Math.random() * (base / 2),
    );
  }

  private onText(text: string): void {
    const control = tryParseJson(relayControlSchema, text);
    if (control) {
      if (control.t === "relay.closed") {
        if (control.code === MOVED) this.attempt = 0;
        if (control.code === REVOKED) this.markRemoved();
        this.ws?.close();
      }
      for (const l of this.controlListeners) l(control);
      return;
    }
    const f = tryParseJson(relayFrameSchema, text);
    if (f?.to !== this.myId) return;
    this.peers.get(f.from)?.onFrame(f);
  }
}
