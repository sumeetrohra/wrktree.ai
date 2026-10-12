import { tryParseJson } from "@agentdeck/shared";
import { blake2b } from "@noble/hashes/blake2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { bytesToUtf8, equalBytes, framed, fromB64, toB64 } from "./bytes.utils.js";
import { LABELS, PAIRING_SECRET_BYTES } from "./crypto.constants.js";
import { deviceIdFor, sign, verify, type TIdentity } from "./keys.utils.js";
import { pairingOfferSchema, type TPairHello, type TPairingOffer, type TPairOk } from "./pairing.schema.js";

const LINK_PREFIX = "agentdeck://pair?o=";

/** Daemon side: the QR payload for a pairing id the relay just registered. */
export function createOffer(me: TIdentity, relayUrl: string, pairingId: string): TPairingOffer {
  return {
    v: 1,
    relayUrl,
    pairingId,
    daemonDeviceId: deviceIdFor(me.signPub),
    daemonSignPub: toB64(me.signPub),
    secret: toB64(randomBytes(PAIRING_SECRET_BYTES)),
  };
}

export function offerToLink(offer: TPairingOffer): string {
  return LINK_PREFIX + toB64(utf8ToBytes(JSON.stringify(offer)));
}

/** Parses a scanned QR code or a pasted link. Null for anything that isn't a valid offer. */
export function linkToOffer(link: string): TPairingOffer | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith(LINK_PREFIX)) return null;
  try {
    return tryParseJson(pairingOfferSchema, bytesToUtf8(fromB64(trimmed.slice(LINK_PREFIX.length)))) ?? null;
  } catch {
    return null;
  }
}

function helloMac(
  secret: Uint8Array,
  pairingId: string,
  phoneDeviceId: string,
  phoneSignPub: Uint8Array,
): Uint8Array {
  return hmac(sha256, secret, framed(LABELS.pairHello, pairingId, phoneDeviceId, phoneSignPub));
}

/** Phone side: only someone who saw the QR code can produce this MAC. */
export function createHello(phone: TIdentity, offer: TPairingOffer, deviceName: string): TPairHello {
  const phoneDeviceId = deviceIdFor(phone.signPub);
  return {
    t: "pair.hello",
    pairingId: offer.pairingId,
    phoneDeviceId,
    phoneSignPub: toB64(phone.signPub),
    deviceName,
    mac: toB64(helloMac(fromB64(offer.secret), offer.pairingId, phoneDeviceId, phone.signPub)),
  };
}

/** Both sides hash the same transcript; the short code and the daemon's signature cover it. */
export function pairingTranscript(offer: TPairingOffer, hello: TPairHello): Uint8Array {
  return sha256(
    framed(
      LABELS.pairTranscript,
      offer.pairingId,
      offer.daemonDeviceId,
      fromB64(offer.daemonSignPub),
      hello.phoneDeviceId,
      fromB64(hello.phoneSignPub),
    ),
  );
}

/** Daemon side: checks the MAC and that the device id matches the key. Null to reject. */
export function acceptHello(me: TIdentity, offer: TPairingOffer, hello: TPairHello): TPairOk | null {
  try {
    if (hello.pairingId !== offer.pairingId) return null;
    const phoneSignPub = fromB64(hello.phoneSignPub);
    if (deviceIdFor(phoneSignPub) !== hello.phoneDeviceId) return null;
    const expected = helloMac(fromB64(offer.secret), offer.pairingId, hello.phoneDeviceId, phoneSignPub);
    if (!equalBytes(expected, fromB64(hello.mac))) return null;
    const sig = sign(me, framed(LABELS.pairOk, pairingTranscript(offer, hello)));
    return { t: "pair.ok", pairingId: offer.pairingId, sig: toB64(sig) };
  } catch {
    return null;
  }
}

/** Phone side: true when the daemon from the QR code signed this exact transcript. */
export function verifyPairOk(offer: TPairingOffer, hello: TPairHello, ok: TPairOk): boolean {
  try {
    const msg = framed(LABELS.pairOk, pairingTranscript(offer, hello));
    return verify(fromB64(offer.daemonSignPub), msg, fromB64(ok.sig));
  } catch {
    return false;
  }
}

/** Six digits both screens show; the user confirms they match (guards a photographed QR code). */
export function shortCode(transcript: Uint8Array): string {
  const h = blake2b(framed(LABELS.shortCode, transcript), { dkLen: 4 });
  const n = new DataView(h.buffer, h.byteOffset, 4).getUint32(0);
  return String(n % 1_000_000).padStart(6, "0");
}
