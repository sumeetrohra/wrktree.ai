import type { IHubSockets } from "#src/shared/sockets.types.js";

import type { IRelaySocket } from "./node-server.service.js";

/** One account's open sockets in the self-host build. */
export class NodeSockets implements IHubSockets {
  private readonly byDevice = new Map<string, IRelaySocket>();

  attach(deviceId: string, socket: IRelaySocket): IRelaySocket | undefined {
    const previous = this.byDevice.get(deviceId);
    this.byDevice.set(deviceId, socket);
    return previous;
  }

  /** False when a newer socket already replaced this one. */
  detach(deviceId: string, socket: IRelaySocket): boolean {
    if (this.byDevice.get(deviceId) !== socket) return false;
    this.byDevice.delete(deviceId);
    return true;
  }

  send(deviceId: string, text: string): boolean {
    const s = this.byDevice.get(deviceId);
    if (!s) return false;
    s.send(text);
    return true;
  }

  close(deviceId: string, code: number, reason: string): void {
    const s = this.byDevice.get(deviceId);
    this.byDevice.delete(deviceId);
    s?.send(JSON.stringify({ t: "relay.closed", code, reason }));
    s?.close(code, reason);
  }

  connected(): string[] {
    return [...this.byDevice.keys()];
  }
}
