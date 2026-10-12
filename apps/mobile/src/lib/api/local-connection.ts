import type { TBlobRef, TCommandArgs, TCommandName, TCommandResult, TEvtFrame } from "@agentdeck/protocol";

import { ConnError, type IDaemonConnection, type TConnStatus } from "./connection.types";
import { InnerClient } from "./inner-client";
import { caughtUp } from "./relay-connection";

const RETRY_MS = 2000;
/** The daemon accepts the token as a WebSocket subprotocol, because browsers can't set headers. */
const TOKEN_PROTOCOL_PREFIX = "agentdeck.token.";

/**
 * The desktop web UI served by the daemon itself: the local transport, no relay and no crypto
 * (the token the daemon put in the page authenticates it).
 */
export class LocalConnection implements IDaemonConnection {
  private ws: WebSocket | null = null;
  private readonly inner = new InnerClient();
  private readonly statusListeners = new Set<(s: TConnStatus) => void>();
  private readonly eventListeners = new Set<(e: TEvtFrame) => void>();
  private readonly cursors: Record<string, number> = { global: 0, "repo:*": 0, "chat:*": 0 };
  private stopped = false;
  status: TConnStatus = "connecting";

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {
    this.inner.onEvent((e) => {
      if (e.cursor <= (this.cursors[e.topic] ?? 0)) return;
      this.cursors[e.topic] = e.cursor;
      for (const l of this.eventListeners) l(e);
    });
  }

  start(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.url, ["agentdeck.v1", `${TOKEN_PROTOCOL_PREFIX}${this.token}`]);
    this.ws = ws;
    ws.onopen = () => {
      this.inner.attach((text) => {
        ws.send(text);
        return true;
      });
      void this.inner
        .call("sync.hello", { deviceName: "Desktop web", appVersion: "0.1.0", cursors: this.cursors })
        .then(({ topics }) => caughtUp(topics, this.cursors, (fn) => this.inner.onEvent(fn)))
        .then(() => {
          this.setStatus("online");
        });
    };
    ws.onmessage = (msg: MessageEvent<string>) => {
      this.inner.handle(msg.data);
    };
    ws.onclose = () => {
      this.inner.attach(null);
      this.inner.failAll(new ConnError("DISCONNECTED", "Connection to the daemon closed"));
      if (this.stopped) return;
      this.setStatus("offline");
      setTimeout(() => {
        this.start();
      }, RETRY_MS);
    };
  }

  stop(): void {
    this.stopped = true;
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

  onEvent(fn: (e: TEvtFrame) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  call<N extends TCommandName>(
    name: N,
    args: TCommandArgs<N>,
    opts: { cmdId?: string } = {},
  ): Promise<TCommandResult<N>> {
    return this.inner.call(name, args, opts.cmdId);
  }

  async upload(base64: string, mime: string): Promise<TBlobRef> {
    const { uploadId, size } = this.inner.sendBlob(base64);
    return this.inner.call("blob.put", { mime, size, uploadId });
  }
}
