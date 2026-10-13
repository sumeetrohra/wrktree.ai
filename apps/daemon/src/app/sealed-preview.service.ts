import { AgentdeckError, type TPreviewFrame } from "@agentdeck/protocol";
import { newId, type ILogger } from "@agentdeck/shared";

import type { EventBus } from "#src/infra/bus/index.js";
import { PreviewProxy, type IPreviewPorts } from "#src/infra/transport/index.js";

/** The same limits as the relay's tunnel (SEC23): one response's size, and how long it may stall. */
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

type TFetch = {
  resolve: (r: { status: number; headers: Record<string, string>; body: string }) => void;
  reject: (e: Error) => void;
  status: number;
  headers: Record<string, string>;
  parts: Buffer[];
  bytes: number;
  timer: NodeJS.Timeout;
};

/**
 * Sealed preview (Phase 5e): the device's requests and WebSockets arrive as end-to-end encrypted
 * commands and go through the same proxy as the relay tunnel (only an open preview's port, on
 * loopback). Responses go back as the command's result; WebSocket messages as `preview.ws` events
 * on `preview:<wsId>`, delivered live and never stored. The relay sees none of it.
 */
export class SealedPreview {
  private readonly proxy: PreviewProxy;
  private readonly fetches = new Map<string, TFetch>();
  /** WebSocket id → the token it was opened with. */
  private readonly sockets = new Map<string, string>();

  constructor(
    private readonly bus: EventBus,
    private readonly ports: IPreviewPorts,
    log: ILogger,
  ) {
    this.proxy = new PreviewProxy(
      (f) => {
        this.onFrame(f);
      },
      ports,
      log,
    );
  }

  fetch(
    token: string,
    req: { method: string; path: string; headers: Record<string, string>; body?: string | undefined },
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const id = newId("pws");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(id, "The dev server took too long to answer.", true);
      }, FETCH_TIMEOUT_MS);
      this.fetches.set(id, { resolve, reject, status: 502, headers: {}, parts: [], bytes: 0, timer });
      this.proxy.onFrame({
        t: "req",
        id,
        token,
        method: req.method,
        path: req.path,
        headers: req.headers,
        ...(req.body === undefined ? {} : { body: req.body }),
      });
    });
  }

  /** `wsId` is the client's (it subscribed to `preview:<wsId>` first). */
  wsOpen(wsId: string, token: string, path: string, headers: Record<string, string>): string {
    if (this.ports.portOf(token) === null) throw new AgentdeckError("NOT_FOUND", "This preview is closed.");
    if (this.sockets.has(wsId)) throw new AgentdeckError("CONFLICT", "That WebSocket id is in use.");
    this.sockets.set(wsId, token);
    this.proxy.onFrame({ t: "wsOpen", id: wsId, token, path, headers });
    return wsId;
  }

  /** The token a WebSocket was opened with (for the owner check), or null when it is gone. */
  socketToken(wsId: string): string | null {
    return this.sockets.get(wsId) ?? null;
  }

  wsSend(wsId: string, data: string, binary: boolean): void {
    this.proxy.onFrame({ t: "wsData", id: wsId, data, binary });
  }

  wsClose(wsId: string): void {
    this.sockets.delete(wsId);
    this.proxy.onFrame({ t: "wsClose", id: wsId });
  }

  private onFrame(f: TPreviewFrame): void {
    switch (f.t) {
      case "head": {
        const p = this.fetches.get(f.id);
        if (p) {
          p.status = f.status;
          p.headers = f.headers;
        }
        return;
      }
      case "chunk": {
        const p = this.fetches.get(f.id);
        if (!p) return;
        const part = Buffer.from(f.data, "base64");
        p.bytes += part.length;
        if (p.bytes > MAX_RESPONSE_BYTES) {
          this.fail(f.id, "The response is larger than 25 MB.", true);
          return;
        }
        p.parts.push(part);
        if (f.last) {
          clearTimeout(p.timer);
          this.fetches.delete(f.id);
          p.resolve({
            status: p.status,
            headers: p.headers,
            body: Buffer.concat(p.parts).toString("base64"),
          });
        }
        return;
      }
      case "error":
        this.fail(f.id, f.message, false);
        return;
      case "wsData":
        this.bus.emit(`preview:${f.id}`, { type: "preview.ws", wsId: f.id, data: f.data, binary: f.binary });
        return;
      case "wsClose":
        this.sockets.delete(f.id);
        this.bus.emit(`preview:${f.id}`, { type: "preview.ws", wsId: f.id, closed: true });
        return;
      case "req":
      case "cancel":
      case "wsOpen":
        return;
    }
  }

  private fail(id: string, message: string, cancel: boolean): void {
    const p = this.fetches.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.fetches.delete(id);
    if (cancel) this.proxy.onFrame({ t: "cancel", id });
    p.reject(new AgentdeckError("BAD_STATE", message));
  }

  close(): void {
    for (const id of [...this.fetches.keys()]) this.fail(id, "The computer is stopping.", false);
    this.sockets.clear();
    this.proxy.close();
  }
}
