import { RELAY_WS_PROTOCOL, relayControlSchema } from "@agentdeck/protocol";
import { tryParseJson, type ILogger } from "@agentdeck/shared";
import WebSocket from "ws";

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000, 30000];
const REVOKED = 4003;
const MOVED = 4001;

export type TRelayLinkOptions = {
  url: string;
  token: string;
  /** The relay refused the token or removed this host: it is no longer on the account. */
  onRemoved: () => void;
  /** The relay refused the token; resolves true if the token is in fact still good (a blip). */
  stillValid: () => Promise<boolean>;
  onText: (text: string) => void;
  onState: (connected: boolean) => void;
  log: ILogger;
};

/**
 * The daemon's one outbound socket to its relay. Reconnects with jittered backoff; stops for good
 * only when this host was removed from its account.
 */
export class RelayLink {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  connected = false;

  constructor(private readonly o: TRelayLinkOptions) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.terminate();
  }

  send(text: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(text);
    return true;
  }

  private schedule(immediately: boolean): void {
    if (this.stopped) return;
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 30000;
    const delay = immediately ? 0 : base / 2 + Math.random() * (base / 2);
    this.attempt++;
    this.timer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private removed(): void {
    this.o.log.error({}, "this host was removed from its account; not reconnecting");
    this.stopped = true;
    this.o.onRemoved();
  }

  private async afterRefusal(): Promise<void> {
    let valid = true;
    try {
      valid = await this.o.stillValid();
    } catch (e) {
      this.o.log.warn({ err: e instanceof Error ? e.message : "error" }, "relay unreachable");
    }
    if (valid) this.schedule(false);
    else this.removed();
  }

  private connect(): void {
    if (this.stopped) return;
    const token = this.o.token;
    const url = new URL("/v1/ws", this.o.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, [RELAY_WS_PROTOCOL], { headers: { authorization: `Bearer ${token}` } });
    this.ws = ws;
    let refused = false;
    let closeCode = 0;
    ws.on("unexpected-response", (_req, res) => {
      refused = res.statusCode === 401;
      ws.terminate();
    });
    ws.on("open", () => {
      this.attempt = 0;
      this.connected = true;
      this.o.onState(true);
    });
    ws.on("message", (raw: Buffer) => {
      const text = raw.toString();
      const control = tryParseJson(relayControlSchema, text);
      if (control?.t === "relay.closed") {
        closeCode = control.code;
        ws.close();
        return;
      }
      this.o.onText(text);
    });
    ws.on("error", (e) => {
      this.o.log.debug({ err: e.message }, "relay socket error");
    });
    ws.on("close", (code) => {
      if (this.ws !== ws) return;
      this.ws = null;
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) this.o.onState(false);
      const why = closeCode || code;
      if (why === REVOKED) {
        this.removed();
        return;
      }
      if (refused) {
        void this.afterRefusal();
        return;
      }
      this.schedule(why === MOVED);
    });
  }
}
