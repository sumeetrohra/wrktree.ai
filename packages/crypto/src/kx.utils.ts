import { x25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { concatBytes } from "@noble/hashes/utils.js";

/** One key per direction. */
export type TSessionKeys = { rx: Uint8Array; tx: Uint8Array };
export type TKxKeyPair = { pub: Uint8Array; sec: Uint8Array };

export function kxKeyPair(): TKxKeyPair {
  const sec = x25519.utils.randomSecretKey();
  return { pub: x25519.getPublicKey(sec), sec };
}

/** BLAKE2b-512(q ‖ client_pk ‖ server_pk), byte-for-byte libsodium's `crypto_kx`. */
function sharedKeys(q: Uint8Array, clientPub: Uint8Array, serverPub: Uint8Array): Uint8Array {
  return blake2b(concatBytes(q, clientPub, serverPub), { dkLen: 64 });
}

/** libsodium `crypto_kx_client_session_keys`; throws on a low-order (all-zero) shared point. */
export function clientSessionKeys(client: TKxKeyPair, serverPub: Uint8Array): TSessionKeys {
  const h = sharedKeys(x25519.getSharedSecret(client.sec, serverPub), client.pub, serverPub);
  return { rx: h.slice(0, 32), tx: h.slice(32) };
}

/** libsodium `crypto_kx_server_session_keys`. */
export function serverSessionKeys(server: TKxKeyPair, clientPub: Uint8Array): TSessionKeys {
  const h = sharedKeys(x25519.getSharedSecret(server.sec, clientPub), clientPub, server.pub);
  return { rx: h.slice(32), tx: h.slice(0, 32) };
}
