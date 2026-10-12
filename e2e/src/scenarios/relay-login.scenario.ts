import assert from "node:assert/strict";

import { PhoneSim } from "../phone-sim.ts";
import type { TScenario } from "../scenario.ts";

import { linkHost } from "./relay-helpers.ts";

export const relayLogin: TScenario = {
  n: 8,
  title: "Sign in, link a computer",
  summary: "Phone signs in; `agentdeck login` shows a code the phone approves; other accounts get nothing",
  covers: [
    "Phase 2c: consumers sign in; a host links once with a device code (no pairing)",
    "Phase 2c: the account's device list on the relay is the trust root",
  ],
  relay: true,
  async run(h) {
    h.step("A computer with a relay but no account yet");
    const before = await h.send("account.status", {});
    await h.check("the daemon is unlinked and not connected", async () => {
      assert.equal(before.state, "unlinked");
      assert.equal((await h.client.call("relay.status", {})).connected, false);
    });

    h.step("Phone: sign in (Firebase in production, the relay's dev issuer here)");
    const phone = new PhoneSim(h.relayUrl, "Pixel 9");
    await phone.signIn("me");
    await h.check("the account has no computers yet", async () => {
      assert.deepEqual(await phone.hosts(), []);
    });

    h.step("A mistyped code is refused");
    await h.check("approving an unknown code fails", async () => {
      await assert.rejects(phone.approve("ZZZZ-ZZZZ"), /410/);
    });

    h.step("Desktop: `agentdeck login`, the phone approves the code");
    const hostId = await linkHost(h, phone);
    const hosts = await phone.hosts();
    await h.check("the phone now sees the computer, online", () => {
      assert.deepEqual(
        hosts.map((d) => [d.id, d.name, d.connected]),
        [[hostId, "laptop", true]],
      );
    });

    h.step("The phone opens an end-to-end session with it");
    await phone.use(hostId).connect();
    const repos = await phone.call("repo.list", {});
    const { stdout } = await h.cli(["devices"]);
    await h.check("the phone gets replies, and the desktop lists it", () => {
      assert.deepEqual(repos, []);
      assert.ok(stdout.includes(phone.deviceId) && stdout.includes("Pixel 9"), stdout);
    });
    await h.check("linking and pairing commands are refused from the phone (desktop only)", async () => {
      await assert.rejects(phone.call("account.link", {}), /UNAUTHORIZED/);
      await assert.rejects(phone.call("pair.start", {}), /UNAUTHORIZED/);
    });

    h.step("A phone signed in to another account");
    const stranger = new PhoneSim(h.relayUrl, "Stranger");
    await stranger.signIn("someone-else");
    await h.check("sees no computers", async () => {
      assert.deepEqual(await stranger.hosts(), []);
    });
    await h.check("and the daemon refuses its handshake", async () => {
      stranger.use(hostId);
      await assert.rejects(stranger.connect({ timeoutMs: 1500 }));
      assert.equal(stranger.replies.length, 0);
    });

    h.step("Restart the daemon: the sealed device token survives");
    await h.killDaemon();
    await h.startDaemon();
    await h.waitRelayConnected();
    await phone.connect();
    await h.check("still linked, and the phone reconnects", async () => {
      assert.equal((await h.send("account.status", {})).state, "linked");
      assert.deepEqual(await phone.call("repo.list", {}), []);
    });

    h.step("Desktop: `agentdeck logout`");
    const out = await h.cli(["logout"]);
    await h.check("the computer leaves the account", async () => {
      assert.equal(out.code, 0, out.out);
      assert.deepEqual(await phone.hosts(), []);
      assert.equal((await h.send("account.status", {})).state, "unlinked");
    });
  },
};
