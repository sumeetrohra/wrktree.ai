import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { framed, fromB64, toB64 } from "./bytes.utils.js";
import { LABELS } from "./crypto.constants.js";

/** A device's long-term identity: an Ed25519 signing key pair. Session keys come from ephemerals. */
export type TIdentity = { signPub: Uint8Array; signSec: Uint8Array };

/** The form an identity is stored in (sealed by the platform keystore). */
export type TStoredIdentity = { signPub: string; signSec: string };

export function generateIdentity(): TIdentity {
  const signSec = ed25519.utils.randomSecretKey();
  return { signPub: ed25519.getPublicKey(signSec), signSec };
}

export function exportIdentity(id: TIdentity): TStoredIdentity {
  return { signPub: toB64(id.signPub), signSec: toB64(id.signSec) };
}

/** Throws when the stored public key doesn't belong to the stored secret. */
export function importIdentity(stored: TStoredIdentity): TIdentity {
  const signSec = fromB64(stored.signSec);
  const signPub = ed25519.getPublicKey(signSec);
  if (toB64(signPub) !== stored.signPub) throw new Error("identity public key mismatch");
  return { signPub, signSec };
}

/** Device ids are bound to the signing key, so a relay can check who registers an id. */
export function deviceIdFor(signPub: Uint8Array): string {
  return `d_${bytesToHex(sha256(framed(LABELS.deviceId, signPub))).slice(0, 32)}`;
}

export function sign(id: TIdentity, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, id.signSec);
}

/** False (never throws) for malformed keys or signatures. */
export function verify(signPub: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, signPub);
  } catch {
    return false;
  }
}
