import assert from "node:assert/strict";

import { newId } from "@agentdeck/shared";

import type { TScenario } from "../scenario.ts";

import { signedInPhone } from "./relay-helpers.ts";

const REVOKED = 4003;

export const relayRevoke: TScenario = {
  n: 11,
  title: "Tampering and removal",
  summary: "Flipped bytes, replays and forged headers are dropped; a removed phone is cut off",
  covers: [
    "Encryption: tampered header rejection, replay rejection",
    "Removal: the relay drops the device and its token; every host stops trusting it",
  ],
  relay: true,
  async run(h) {
    const phone = await signedInPhone(h);
    const settle = () => h.pause(400);

    h.step("A frame with one flipped ciphertext byte");
    const flippedId = newId("cmd");
    const frame = phone.seal({ t: "cmd", id: flippedId, name: "repo.list", args: {} });
    const body = Buffer.from(frame.body, "base64url");
    body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 1;
    phone.sendRaw({ ...frame, body: body.toString("base64url") });
    await settle();
    await h.check("is dropped: no reply", () => {
      assert.ok(!phone.replies.includes(flippedId));
    });

    h.step("A frame whose sequence number was rewritten");
    const seqId = newId("cmd");
    const f2 = phone.seal({ t: "cmd", id: seqId, name: "repo.list", args: {} });
    phone.sendRaw({ ...f2, seq: f2.seq + 7 });
    await settle();
    await h.check("is dropped: the header is authenticated", () => {
      assert.ok(!phone.replies.includes(seqId));
    });

    h.step("A valid frame, then the same frame replayed");
    const okId = newId("cmd");
    const f3 = phone.seal({ t: "cmd", id: okId, name: "repo.list", args: {} });
    phone.sendRaw(f3);
    await settle();
    phone.sendRaw(f3);
    await settle();
    await h.check("is answered once; the replay is dropped", () => {
      assert.equal(phone.replies.filter((id) => id === okId).length, 1);
    });
    await h.check("and the session still works afterwards", async () => {
      assert.deepEqual(await phone.call("repo.list", {}), []);
    });

    h.step("Desktop: `agentdeck devices revoke`");
    const { code, out } = await h.cli(["devices", "revoke", phone.deviceId]);
    await h.check("the relay closes the phone's socket as removed", async () => {
      assert.equal(code, 0, out);
      assert.equal(await phone.waitClosed(), REVOKED);
    });
    await h.check("its device token no longer works", async () => {
      await assert.rejects(phone.connect({ timeoutMs: 1500 }));
    });
    const list = await h.send("device.list", {});
    await h.check("the daemon no longer lists it", () => {
      assert.ok(!list.some((d) => d.id === phone.deviceId));
    });

    h.step("The phone signs in again");
    await phone.signIn("me");
    await phone.connect();
    await h.check("signing in is what membership means: it is back", async () => {
      assert.deepEqual(await phone.call("repo.list", {}), []);
    });
  },
};
