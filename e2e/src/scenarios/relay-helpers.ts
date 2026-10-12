import assert from "node:assert/strict";

import type { TDaemonEvent } from "@agentdeck/protocol";

import type { Harness } from "../harness.ts";
import { PhoneSim } from "../phone-sim.ts";

/**
 * `agentdeck login --print` on the host, the code approved on a signed-in phone, then the daemon
 * collects its token and connects. Returns the host's device id.
 */
export async function linkHost(h: Harness, phone: PhoneSim): Promise<string> {
  const { code, out } = await h.cli(["login", "--print"]);
  const [, linkCode = ""] = /^([A-Z2-9]{4}-[A-Z2-9]{4}) (\S+)$/m.exec(out) ?? [];
  assert.equal(code, 0, out);
  const hostId = await h.deviceId();
  const approved = await phone.approve(linkCode);
  assert.equal(approved.deviceId, hostId);
  const end = Date.now() + 10_000;
  while ((await h.client.call("account.status", {})).state !== "linked") {
    if (Date.now() > end) throw new Error("the host never collected its token");
    await new Promise((r) => setTimeout(r, 100));
  }
  await h.waitRelayConnected();
  return hostId;
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
