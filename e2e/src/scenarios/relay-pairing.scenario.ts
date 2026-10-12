import assert from "node:assert/strict";

import { PhoneSim } from "../phone-sim.ts";
import type { TScenario } from "../scenario.ts";

import { pairPhone } from "./relay-helpers.ts";

export const relayPairing: TScenario = {
  n: 8,
  title: "Pairing through the relay",
  summary: "QR link → claim → MAC'd hello → signed reply → matching short codes; strangers get nothing",
  covers: [
    "Phase 2: pair a phone with a daemon through the relay",
    "Pairing flow: only someone who saw the QR code can pair; short codes match",
  ],
  relay: true,
  async run(h) {
    h.step("The daemon registers with the relay");
    await h.waitRelayConnected();

    h.step("Pair a phone: `agentdeck pair`, the phone scans the link");
    const phone = await pairPhone(h);

    h.step("The paired phone talks to the daemon, end to end encrypted");
    const repos = await phone.call("repo.list", {});
    const { stdout } = await h.cli(["devices"]);
    await h.check("the phone gets replies, and the desktop lists it as active", () => {
      assert.deepEqual(repos, []);
      assert.ok(stdout.includes(phone.deviceId) && stdout.includes("active"), stdout);
    });

    await h.check("pairing commands are refused from the phone (desktop only)", async () => {
      await assert.rejects(phone.call("pair.start", {}), /UNAUTHORIZED/);
    });

    h.step("A stranger with the pairing id but not the QR secret");
    const pairing = h.cliStream(["pair", "--yes"]);
    const [, link = ""] = await pairing.waitFor(/(agentdeck:\/\/pair\?o=[A-Za-z0-9_-]+)/);
    const stranger = new PhoneSim(h.relayUrl, "Stranger");
    await stranger.signIn("me@example.com");
    const forged = await stranger.pair(link, { forgeSecret: true });
    await h.check("the daemon rejects a hello made without the secret", () => {
      assert.equal(forged.ok, false);
    });
    await h.check("an unconfirmed device can't open a session", async () => {
      await assert.rejects(stranger.connect({ timeoutMs: 1500 }), /timed out/);
    });
    await h.check("and its frames never reach the daemon's API", () => {
      assert.ok(!stranger.replies.length);
    });
    pairing.kill();
  },
};
