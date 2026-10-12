import { concatBytes, randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export { concatBytes, randomBytes, utf8ToBytes };

const textDecoder = new TextDecoder();

export function bytesToUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/** URL-safe base64 without padding, the encoding for every key and ciphertext on the wire. */
export function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Throws on characters outside the base64url alphabet. */
export function fromB64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("invalid base64url");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Length-prefixes each part so concatenations can't be ambiguous ("ab"+"c" vs "a"+"bc"). */
export function framed(...parts: (Uint8Array | string)[]): Uint8Array {
  return concatBytes(
    ...parts.flatMap((p) => {
      const bytes = typeof p === "string" ? utf8ToBytes(p) : p;
      const len = new Uint8Array(4);
      new DataView(len.buffer).setUint32(0, bytes.length);
      return [len, bytes];
    }),
  );
}

/** Constant-time comparison. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
