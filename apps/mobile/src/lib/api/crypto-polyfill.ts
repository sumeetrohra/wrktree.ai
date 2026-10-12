import { getRandomValues } from "expo-crypto";

/** Fills any typed array through a byte view, which is all `expo-crypto` needs. */
function fill<T extends Exclude<BufferSource, ArrayBuffer>>(array: T): T {
  getRandomValues(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  return array;
}

/** Hermes has no Web Crypto; the crypto package only needs `getRandomValues`. */
export function installCryptoPolyfill(): void {
  const g: { crypto?: Partial<Crypto> } = globalThis;
  if (typeof g.crypto?.getRandomValues === "function") return;
  g.crypto = { ...g.crypto, getRandomValues: fill };
}
