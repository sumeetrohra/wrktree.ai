import assert from "node:assert/strict";

import type { TDaemonEvent } from "@agentdeck/protocol";

import type { Harness } from "../harness.ts";
import { PhoneSim } from "../phone-sim.ts";

/**
 * `agentdeck login --dev <uid>` on the host: it signs in as the same user as `phone` (the dev
 * issuer, or the Auth emulator as `<uid>@example.com`), registers and connects. Returns its id.
 */
export async function linkHost(h: Harness, phone: PhoneSim): Promise<string> {
  const { code, out } = await h.cli(["login", "--dev", phone.uid]);
  assert.equal(code, 0, out);
  await h.waitRelayConnected();
  return h.deviceId();
}

/** A phone signed in as `uid`, with this host linked to the same account, connected end to end. */
export async function signedInPhone(h: Harness, uid = "me", name = "Pixel 9"): Promise<PhoneSim> {
  const phone = new PhoneSim(h.relayUrl, name);
  await phone.signIn(uid);
  const hostId = await linkHost(h, phone);
  await phone.use(hostId).connect();
  return phone;
}

export type TRequested = Extract<TDaemonEvent, { type: "permission.requested" }>;

export const isEvent =
  <T extends TDaemonEvent["type"]>(
    type: T,
    pred: (e: Extract<TDaemonEvent, { type: T }>) => boolean = () => true,
  ) =>
  (f: { event: TDaemonEvent }): boolean =>
    f.event.type === type && pred(f.event as Extract<TDaemonEvent, { type: T }>);
