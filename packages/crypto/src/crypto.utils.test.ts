import sodium from "libsodium-wrappers-sumo";
import { beforeAll, describe, expect, it } from "vitest";

import { open, seal } from "./aead.utils.js";
import { fromB64, toB64, utf8ToBytes } from "./bytes.utils.js";
import { SecureChannel } from "./channel.service.js";
import { acceptHandshake, finishHandshake, startHandshake } from "./handshake.utils.js";
import { deviceIdFor, exportIdentity, generateIdentity, importIdentity } from "./keys.utils.js";
import { clientSessionKeys, serverSessionKeys } from "./kx.utils.js";
beforeAll(async () => {
  await sodium.ready;
});

describe("libsodium compatibility (cross-platform: any libsodium peer interoperates)", () => {
  it("session keys equal crypto_kx_*_session_keys", () => {
    const c = sodium.crypto_kx_keypair();
    const s = sodium.crypto_kx_keypair();
    const mine = clientSessionKeys({ pub: c.publicKey, sec: c.privateKey }, s.publicKey);
    const theirs = sodium.crypto_kx_client_session_keys(c.publicKey, c.privateKey, s.publicKey);
    expect(toB64(mine.rx)).toBe(toB64(theirs.sharedRx));
    expect(toB64(mine.tx)).toBe(toB64(theirs.sharedTx));
    const server = serverSessionKeys({ pub: s.publicKey, sec: s.privateKey }, c.publicKey);
    expect(toB64(server.tx)).toBe(toB64(mine.rx));
  });

  it("seal output opens with crypto_aead_xchacha20poly1305_ietf_decrypt, and back", () => {
    const key = sodium.randombytes_buf(32);
    const ad = utf8ToBytes("header");
    const box = seal(key, utf8ToBytes("hello"), ad);
    const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      box.subarray(24),
      ad,
      box.subarray(0, 24),
      key,
    );
    expect(sodium.to_string(plain)).toBe("hello");

    const nonce = sodium.randombytes_buf(24);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt("back", ad, null, nonce, key);
    const joined = new Uint8Array([...nonce, ...ct]);
    expect(new TextDecoder().decode(open(key, joined, ad) ?? new Uint8Array())).toBe("back");
  });
});

describe("aead", () => {
  const key = new Uint8Array(32).fill(7);
  it("rejects tampered ciphertext and additional data", () => {
    const box = seal(key, utf8ToBytes("x"), utf8ToBytes("ad"));
    const flipped = box.slice();
    flipped[30] = (flipped[30] ?? 0) ^ 1;
    expect(open(key, flipped, utf8ToBytes("ad"))).toBeNull();
    expect(open(key, box, utf8ToBytes("other"))).toBeNull();
    expect(open(key, box.subarray(0, 10), utf8ToBytes("ad"))).toBeNull();
  });
});

describe("identity", () => {
  it("round-trips and binds the device id to the key", () => {
    const id = generateIdentity();
    expect(toB64(importIdentity(exportIdentity(id)).signPub)).toBe(toB64(id.signPub));
    expect(deviceIdFor(id.signPub)).toMatch(/^d_[0-9a-f]{32}$/);
    expect(deviceIdFor(generateIdentity().signPub)).not.toBe(deviceIdFor(id.signPub));
    const other = exportIdentity(generateIdentity());
    expect(() => importIdentity({ ...other, signPub: exportIdentity(id).signPub })).toThrow();
  });
});

function pairedSession() {
  const phone = generateIdentity();
  const daemon = generateIdentity();
  const peers = { clientId: deviceIdFor(phone.signPub), serverId: deviceIdFor(daemon.signPub) };
  const { init, pending } = startHandshake(phone, peers);
  const accepted = acceptHandshake(daemon, phone.signPub, peers, init);
  if (!accepted) throw new Error("accept failed");
  const established = finishHandshake(daemon.signPub, peers, pending, accepted.accept);
  if (!established) throw new Error("finish failed");
  return {
    phone,
    daemon,
    peers,
    init,
    pending,
    accepted,
    phoneCh: new SecureChannel(established, peers.clientId, peers.serverId),
    daemonCh: new SecureChannel(accepted.session, peers.serverId, peers.clientId),
  };
}

describe("handshake", () => {
  it("both sides derive matching keys", () => {
    const { phoneCh, daemonCh, peers } = pairedSession();
    const f = phoneCh.seal("ping");
    expect(daemonCh.open({ from: peers.clientId, to: peers.serverId, ...f })).toBe("ping");
    const g = daemonCh.seal("pong");
    expect(phoneCh.open({ from: peers.serverId, to: peers.clientId, ...g })).toBe("pong");
  });

  it("rejects an init signed by another key", () => {
    const { daemon, peers, init } = pairedSession();
    expect(acceptHandshake(daemon, generateIdentity().signPub, peers, init)).toBeNull();
  });

  it("rejects an accept signed by another key or for another session", () => {
    const { peers, pending, accepted } = pairedSession();
    expect(finishHandshake(generateIdentity().signPub, peers, pending, accepted.accept)).toBeNull();
    const { accepted: other, daemon } = pairedSession();
    expect(finishHandshake(daemon.signPub, peers, pending, other.accept)).toBeNull();
  });

  it("uses fresh keys every session (forward secrecy)", () => {
    const a = pairedSession();
    const b = startHandshake(a.phone, a.peers);
    expect(b.init.ephPub).not.toBe(a.init.ephPub);
    expect(b.init.sessionId).not.toBe(a.init.sessionId);
  });
});

describe("SecureChannel", () => {
  it("rejects replayed, reordered, redirected, cross-session and tampered frames", () => {
    const { phoneCh, daemonCh, peers } = pairedSession();
    const route = { from: peers.clientId, to: peers.serverId };
    const one = phoneCh.seal("1");
    const two = phoneCh.seal("2");
    expect(daemonCh.open({ ...route, ...two })).toBe("2");
    expect(daemonCh.open({ ...route, ...one })).toBeNull(); // reordered
    expect(daemonCh.open({ ...route, ...two })).toBeNull(); // replayed
    const three = phoneCh.seal("3");
    expect(daemonCh.open({ from: peers.clientId, to: "d_someone_else", ...three })).toBeNull();
    expect(daemonCh.open({ ...route, ...three, seq: three.seq + 5 })).toBeNull(); // seq is authenticated
    expect(daemonCh.open({ ...route, ...three, sessionId: "other" })).toBeNull();
    const body = fromB64(three.body);
    body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 1;
    expect(daemonCh.open({ ...route, ...three, body: toB64(body) })).toBeNull();
    expect(daemonCh.open({ ...route, ...three, body: "%%%" })).toBeNull();
    expect(daemonCh.open({ ...route, ...three })).toBe("3");
  });
});

describe("relay auth signatures", () => {
  it("accepts a fresh registration and rejects stale, forged or rebound ones", async () => {
    const { signRegistration, verifyRegistration, signLinkPoll, verifyLinkPoll } =
      await import("./relay-auth.utils.js");
    const me = generateIdentity();
    const t = 1_800_000_000_000;
    const reg = signRegistration(me, t);
    expect(verifyRegistration(reg, t + 1000)).toBe(true);
    expect(verifyRegistration(reg, t + 10 * 60 * 1000)).toBe(false);
    expect(verifyRegistration({ ...reg, deviceId: deviceIdFor(generateIdentity().signPub) }, t)).toBe(false);
    expect(verifyRegistration({ ...reg, at: t + 1 }, t)).toBe(false);
    const sig = signLinkPoll(me, "link_x", t);
    expect(verifyLinkPoll(reg.signPub, "link_x", t, sig, t)).toBe(true);
    expect(verifyLinkPoll(reg.signPub, "link_y", t, sig, t)).toBe(false);
    expect(verifyLinkPoll(reg.signPub, "link_x", t, sig, t + 10 * 60 * 1000)).toBe(false);
  });
});

describe("bytesToUtf8 without TextDecoder", () => {
  it("decodes multi-byte text the same way", async () => {
    const { bytesToUtf8 } = await import("./bytes.utils.js");
    const text = "héllo → 世界 🚀";
    const saved = globalThis.TextDecoder;
    // @ts-expect-error -- reason: simulate a runtime without TextDecoder
    delete globalThis.TextDecoder;
    try {
      expect(bytesToUtf8(utf8ToBytes(text))).toBe(text);
    } finally {
      globalThis.TextDecoder = saved;
    }
  });
});
