import assert from "node:assert/strict";

import type { TDaemonEvent } from "@agentdeck/protocol";

import type { Harness } from "../harness.ts";
import { PhoneSim } from "../phone-sim.ts";

const LINK = /(agentdeck:\/\/pair\?o=[A-Za-z0-9_-]+)/;

/** `agentdeck pair --yes` on the desktop, a phone scanning the link: a paired, connected phone. */
export async function pairPhone(h: Harness, email = "me@example.com", name = "Pixel 9"): Promise<PhoneSim> {
  await h.waitRelayConnected();
  const pairing = h.cliStream(["pair", "--yes"]);
  const [, link = ""] = await pairing.waitFor(LINK);
  const phone = new PhoneSim(h.relayUrl, name);
  await phone.signIn(email);
  const { code, ok } = await phone.pair(link);
  const [, shown = ""] = await pairing.waitFor(/Pairing code: (\d{3} \d{3})/);
  const done = await pairing.done;
  await h.check("the phone verified the daemon's signature and both screens show the same code", () => {
    assert.ok(ok, "pair.ok signature");
    assert.equal(shown.replace(" ", ""), code);
    assert.equal(done.code, 0, done.out);
  });
  await phone.connect();
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
