import {
  acceptHello,
  createOffer,
  offerToLink,
  pairingTranscript,
  shortCode,
  type TIdentity,
  type TPairHello,
  type TPairingOffer,
  type TPairMessage,
} from "@agentdeck/crypto";
import { AgentdeckError } from "@agentdeck/protocol";
import { now } from "@agentdeck/shared";

import type { IOfferSource, IPairedDevices, TPairingState } from "./pairing.types.js";

type TPending = {
  offer: TPairingOffer;
  expiresAt: number;
  state: TPairingState;
  hello?: TPairHello;
  code?: string;
};

/**
 * QR pairing, daemon side (spec: Pairing flow). `start` registers a one-time id with the relay
 * and returns the link the QR code encodes; the phone's `pair.hello` must carry a MAC made with
 * the link's secret; the user then compares the six-digit codes on both screens and confirms.
 */
export class PairingService {
  private readonly pending = new Map<string, TPending>();

  constructor(
    private readonly me: TIdentity,
    private readonly relay: IOfferSource | null,
    private readonly devices: IPairedDevices,
  ) {}

  private relayOrThrow(): IOfferSource {
    if (!this.relay)
      throw new AgentdeckError("BAD_STATE", "No relay configured: run `agentdeck relay set <url>` first");
    return this.relay;
  }

  async start(): Promise<{ pairingId: string; link: string; expiresAt: number }> {
    const relay = this.relayOrThrow();
    const { pairingId, expiresAt } = await relay.createOffer();
    const offer = createOffer(this.me, relay.relayUrl, pairingId);
    this.pending.set(pairingId, { offer, expiresAt, state: "waiting" });
    return { pairingId, link: offerToLink(offer), expiresAt };
  }

  private get(pairingId: string): TPending {
    const p = this.pending.get(pairingId);
    if (!p) throw new AgentdeckError("NOT_FOUND", `No pairing ${pairingId}`);
    if (p.state === "waiting" && p.expiresAt < now()) p.state = "expired";
    return p;
  }

  status(pairingId: string): {
    state: TPairingState;
    shortCode?: string;
    deviceId?: string;
    deviceName?: string;
  } {
    const p = this.get(pairingId);
    return {
      state: p.state,
      ...(p.code === undefined ? {} : { shortCode: p.code }),
      ...(p.hello ? { deviceId: p.hello.phoneDeviceId, deviceName: p.hello.deviceName } : {}),
    };
  }

  confirm(pairingId: string, accept: boolean): void {
    const p = this.get(pairingId);
    if (p.state !== "confirm" || !p.hello)
      throw new AgentdeckError("BAD_STATE", "No phone is waiting for confirmation");
    if (accept) this.devices.confirm(p.hello.phoneDeviceId);
    else this.devices.forgetPending(p.hello.phoneDeviceId);
    p.state = accept ? "paired" : "rejected";
  }

  /** A pairing message arrived through the relay. Returns the reply to send, if any. */
  onMessage(from: string, msg: TPairMessage): TPairMessage | null {
    if (msg.t !== "pair.hello" || msg.phoneDeviceId !== from) return null;
    const p = this.pending.get(msg.pairingId);
    if (p?.state !== "waiting" || p.expiresAt < now()) return { t: "pair.reject", pairingId: msg.pairingId };
    const ok = acceptHello(this.me, p.offer, msg);
    if (!ok) return { t: "pair.reject", pairingId: msg.pairingId };
    this.devices.addPending({
      id: msg.phoneDeviceId,
      name: msg.deviceName,
      kind: "phone",
      signPub: msg.phoneSignPub,
    });
    p.hello = msg;
    p.code = shortCode(pairingTranscript(p.offer, msg));
    p.state = "confirm";
    return ok;
  }
}
