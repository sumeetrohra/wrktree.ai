import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";

import { concatBytes } from "./bytes.utils.js";
import { NONCE_BYTES } from "./crypto.constants.js";

/** XChaCha20-Poly1305 (libsodium `crypto_aead_xchacha20poly1305_ietf`). Output: nonce ‖ ciphertext. */
export function seal(key: Uint8Array, plaintext: Uint8Array, ad: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE_BYTES);
  return concatBytes(nonce, xchacha20poly1305(key, nonce, ad).encrypt(plaintext));
}

/** Null when the ciphertext, nonce or additional data was tampered with. */
export function open(key: Uint8Array, box: Uint8Array, ad: Uint8Array): Uint8Array | null {
  if (box.length < NONCE_BYTES + 16) return null;
  try {
    return xchacha20poly1305(key, box.subarray(0, NONCE_BYTES), ad).decrypt(box.subarray(NONCE_BYTES));
  } catch {
    return null;
  }
}
