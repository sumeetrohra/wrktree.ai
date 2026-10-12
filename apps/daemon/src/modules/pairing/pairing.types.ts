import type { TDeviceKind } from "@agentdeck/protocol";

/** Where paired phones are recorded (port, implemented by the devices module). */
export interface IPairedDevices {
  addPending(d: { id: string; name: string; kind: TDeviceKind; signPub: string }): void;
  confirm(id: string): void;
  forgetPending(id: string): void;
}

/** Registers one-time pairing ids with the relay (port, implemented by infra/relay). */
export interface IOfferSource {
  readonly relayUrl: string;
  createOffer(): Promise<{ pairingId: string; expiresAt: number }>;
}

export type TPairingState = "waiting" | "confirm" | "paired" | "rejected" | "expired";
