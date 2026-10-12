import type { TDeviceKind } from "@agentdeck/protocol";

/** The live sockets of one account, however the host holds them (port implemented by each host). */
export interface IHubSockets {
  /** False when the device has no open socket. */
  send(deviceId: string, text: string): boolean;
  close(deviceId: string, code: number, reason: string): void;
  connected(): string[];
}

export type TMember = { deviceId: string; kind: TDeviceKind };
