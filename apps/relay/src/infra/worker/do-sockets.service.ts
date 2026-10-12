import type { IHubSockets } from "#src/shared/sockets.types.js";

const OPEN = 1;

/** One account's sockets via the WebSocket Hibernation API; each socket is tagged with its device id. */
export class DoSockets implements IHubSockets {
  constructor(private readonly state: ICfDurableObjectState) {}

  send(deviceId: string, text: string): boolean {
    const open = this.state.getWebSockets(deviceId).filter((ws) => ws.readyState === OPEN);
    for (const ws of open) ws.send(text);
    return open.length > 0;
  }

  close(deviceId: string, code: number, reason: string): void {
    for (const ws of this.state.getWebSockets(deviceId)) {
      ws.send(JSON.stringify({ t: "relay.closed", code, reason }));
      ws.close(code, reason);
    }
  }

  connected(): string[] {
    const ids = this.state
      .getWebSockets()
      .filter((ws) => ws.readyState === OPEN)
      .flatMap((ws) => this.state.getTags(ws));
    return [...new Set(ids)];
  }
}
